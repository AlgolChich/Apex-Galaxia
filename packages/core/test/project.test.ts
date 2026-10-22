import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApexError,
  ChronicleStateSchema,
  FORMAT_VERSION,
  ProjectStore,
  chapterFileStem,
  createProject,
  migrateProject,
  parseFrontMatter,
  renderJsonSchemas,
  serializeFrontMatter,
  slugify,
  splitSections,
  type Migration,
} from '@apex-galaxia/core';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('slugs', () => {
  it('transliterates Cyrillic and keeps file names portable', () => {
    expect(slugify('Старые друзья')).toBe('starye-druzya');
    expect(slugify('Черепа и Кости: часть 1')).toBe('cherepa-i-kosti-chast-1');
    expect(slugify('  The Engineer!  ')).toBe('the-engineer');
    expect(slugify('***')).toBe('untitled');
    expect(chapterFileStem(3, 'Ночь в ангаре')).toBe('03-noch-v-angare');
  });
});

describe('front matter', () => {
  it('round-trips data and body', () => {
    const text = serializeFrontMatter({ number: 1, title: 'Глава' }, 'Текст главы.\n');
    const doc = parseFrontMatter<{ number: number; title: string }>(text);
    expect(doc.data.number).toBe(1);
    expect(doc.data.title).toBe('Глава');
    expect(doc.body).toBe('Текст главы.\n');
    expect(parseFrontMatter('---\na: 1\n---\nNo blank line.').body).toBe('No blank line.');
  });

  it('treats a file without front matter as an empty mapping', () => {
    const doc = parseFrontMatter('Just prose.');
    expect(doc.data).toEqual({});
    expect(doc.body).toBe('Just prose.');
  });

  it('rejects invalid YAML with an INVALID_FILE error', () => {
    expect(() => parseFrontMatter('---\n: :\n  - [\n---\nbody', 'x.md')).toThrow(ApexError);
  });

  it('splits sections by level-two headings', () => {
    const sections = splitSections('intro\n\n## Summary\n\nOne line.\n\n## Voice\n\nShort words.\n');
    expect(sections.get('')).toBe('intro');
    expect(sections.get('Summary')).toBe('One line.');
    expect(sections.get('Voice')).toBe('Short words.');
  });
});

describe('createProject and ProjectStore', () => {
  it('scaffolds a valid Russian project from an empty brief and reopens it', async () => {
    const root = path.join(dir, 'story');
    const created = await createProject(root, { title: 'Черепа и Кости', language: 'ru' });
    expect(created.config.storyteller).toBe('cassandra');
    expect(created.config.harshness).toBe(3);
    expect(created.config.rating).toBe('medium');
    expect(created.config.format_version).toBe(FORMAT_VERSION);

    const reopened = await ProjectStore.open(root);
    expect(reopened.config.title).toBe('Черепа и Кости');
    expect(reopened.config.models.prose).toBe('claude-opus-5-5');

    const state = await reopened.readYaml(reopened.layout.chronicle.state, ChronicleStateSchema);
    expect(state?.last_chapter).toBe(0);
    const brief = await reopened.readText(reopened.layout.plan.brief);
    expect(brief).toContain('Рассказчик / Storyteller: Кассандра');
    expect(brief).toContain('Жёсткость судьбы / Harshness: 3');
  });

  it('refuses to create over an existing project', async () => {
    const root = path.join(dir, 'story');
    await createProject(root, { title: 'A', language: 'en' });
    await expect(createProject(root, { title: 'B', language: 'en' })).rejects.toMatchObject({
      code: 'PROJECT_EXISTS',
    });
  });

  it('creates, lists, finds and saves chapters with word counts', async () => {
    const store = await createProject(path.join(dir, 's'), { title: 'Test', language: 'en' });
    const ch = await store.createChapter(1, 'Old Friends', 'The hangar smelled of oil.\n');
    expect(ch.stem).toBe('01-old-friends');
    expect(ch.front.words).toBe(5);
    await store.createChapter(2, 'Night', 'Short.');
    const list = await store.listChapters();
    expect(list.map((c) => c.front.number)).toEqual([1, 2]);
    const saved = await store.saveChapter(ch, 'The hangar smelled of oil and rain.\n', { status: 'revised' });
    expect(saved.front.words).toBe(7);
    expect((await store.getChapter(1)).front.status).toBe('revised');
    expect((await store.getChapter('01-old-friends')).front.title).toBe('Old Friends');
    await expect(store.getChapter(9)).rejects.toMatchObject({ code: 'CHAPTER_NOT_FOUND' });
    await expect(store.createChapter(1, 'Dup')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('refuses to write an invalid file and reports where', async () => {
    const store = await createProject(path.join(dir, 's'), { title: 'Test', language: 'en' });
    await expect(
      store.writeYaml(store.layout.chronicle.state, ChronicleStateSchema, { last_chapter: -1 }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    const text = await store.readText(store.layout.chronicle.state);
    expect(text).toContain('last_chapter: 0');
  });

  it('writes suggestions to history and records acceptance in the append-only log', async () => {
    const store = await createProject(path.join(dir, 's'), { title: 'Test', language: 'en' });
    await store.appendCall({
      id: 'call-1',
      ts: new Date().toISOString(),
      task: 'write.continue',
      provider: 'replay',
      model: 'claude-opus-5-5',
      prompt_hash: 'abc',
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0.0014,
      latency_ms: 10,
      accepted: null,
      replay: true,
    });
    const sug = await store.writeSuggestion({ task: 'write.continue', model: 'claude-opus-5-5', call_id: 'call-1', chapter: 1 }, 'New prose.');
    expect(sug.front.status).toBe('pending');
    const accepted = await store.setSuggestionStatus(sug.front.id, 'accepted');
    expect(accepted.front.status).toBe('accepted');
    const calls = await store.readCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.accepted).toBe(true);
    expect(await store.spentUsd()).toBeCloseTo(0.0014);
  });

  it('moves files to _trash instead of deleting', async () => {
    const store = await createProject(path.join(dir, 's'), { title: 'Test', language: 'en' });
    const ch = await store.createChapter(1, 'Gone', 'bye');
    const target = await store.trash(ch.path);
    expect(target).toContain('_trash');
    expect(await store.listChapters()).toHaveLength(0);
    expect(await fs.readFile(target, 'utf8')).toContain('bye');
  });
});

describe('migrations', () => {
  it('rejects a newer format than the build understands', async () => {
    await expect(migrateProject(dir, { format_version: FORMAT_VERSION + 5 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT_VERSION',
    });
  });

  it('applies migrations in order, backs up the old config and rewrites project.yaml', async () => {
    const root = path.join(dir, 'old');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'project.yaml'), 'format_version: 1\ntitle: Old\nlanguage: en\nlegacy: true\n');
    const fake: Migration = {
      from: 1,
      to: 2,
      describe: 'rename legacy flag',
      apply: async (ctx) => {
        delete ctx.config['legacy'];
        ctx.config['narrator'] = 'gwen';
        await ctx.writeText('MIGRATED.txt', 'yes');
      },
    };
    const result = await migrateProject(root, { format_version: 1, title: 'Old', language: 'en', legacy: true }, [fake], 2);
    expect(result.applied).toEqual(['1→2: rename legacy flag']);
    expect(result.config['format_version']).toBe(2);
    expect(result.config['legacy']).toBeUndefined();
    expect(await fs.readFile(path.join(root, 'MIGRATED.txt'), 'utf8')).toBe('yes');
    const backups = await fs.readdir(path.join(root, 'history', 'migrations'));
    expect(backups.some((b) => b.startsWith('project.v1.'))).toBe(true);
    const rewritten = await fs.readFile(path.join(root, 'project.yaml'), 'utf8');
    expect(rewritten).toContain('format_version: 2');
    expect(rewritten).toContain('narrator: gwen');
  });

  it('reports a missing migration step', async () => {
    await expect(migrateProject(dir, { format_version: 1 }, [], 2)).rejects.toMatchObject({
      code: 'MIGRATION_REQUIRED',
    });
  });

  it('rejects a project.yaml without a valid format_version', async () => {
    await expect(migrateProject(dir, { title: 'x' })).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});

describe('JSON schemas', () => {
  it('match the committed files in packages/core/schemas', async () => {
    const schemasDir = path.resolve(__dirname, '..', 'schemas');
    for (const [name, json] of renderJsonSchemas()) {
      const file = path.join(schemasDir, `${name}.schema.json`);
      const committed = await fs.readFile(file, 'utf8');
      expect(committed, `${name}.schema.json is stale; run pnpm schemas`).toBe(json);
    }
  });
});
