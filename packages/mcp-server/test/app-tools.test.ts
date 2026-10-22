import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const serverEntry = path.resolve(here, '..', 'src', 'bin.ts');

let dir: string;
let client: Client;
let transport: StdioClientTransport;
const runEvents: Array<Record<string, unknown>> = [];

function structured<T = Record<string, unknown>>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent;
}

function text(result: unknown): string {
  return (result as { content: Array<{ text?: string }> }).content.map((c) => c.text ?? '').join('\n');
}

async function waitFor(predicate: () => boolean, ms = 15_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error('timed out waiting for a run event');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-app-'));
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', serverEntry],
    // The scripted stand-in model is selected explicitly; a key in the environment is ignored on purpose.
    env: { ...process.env, APEX_GALAXIA_RESOURCES: repoRoot, APEX_GALAXIA_HOME: path.join(dir, 'home'), ANTHROPIC_API_KEY: '', APEX_GALAXIA_SCRIPTED: '1' },
    cwd: repoRoot,
    stderr: 'pipe',
  });
  client = new Client({ name: 'apex-app-test', version: '0.0.0' });
  client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
    if (n.params.logger === 'apex.run') runEvents.push(n.params.data as Record<string, unknown>);
  });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client.close().catch(() => undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

describe('app tools over stdio (scripted model)', () => {
  it('reports the scripted stand-in honestly and never a key', async () => {
    const status = structured(await client.callTool({ name: 'model_status', arguments: {} }));
    expect(status['provider']).toBe('replay');
    expect(status['key_source']).toBe('scripted');
    expect(status['scripted']).toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-');
  });

  it('creates a project, saves the Author\'s own edits, updates settings, lists the Bible and the plan', async () => {
    const root = path.join(dir, 'story');
    await client.callTool({ name: 'project_create', arguments: { path: root, title: 'Штрек', language: 'ru', idea: 'Грузовик ночью.', length: 'short' } });
    await client.callTool({ name: 'bible_upsert', arguments: { kind: 'character', name: 'Ольга', aliases_ru: ['Оля'], always_on: true, body: '## Кратко\n\nФельдшер посёлка.' } });
    await client.callTool({ name: 'bible_upsert', arguments: { kind: 'location', name: 'Верхний Кут', body: '## Кратко\n\nПосёлок у шахты.' } });

    const created = structured(await client.callTool({ name: 'chapter_create', arguments: { title: 'Фары' } }));
    expect((created['front'] as { number: number }).number).toBe(1);
    const saved = structured(await client.callTool({ name: 'chapter_save', arguments: { chapter: 1, body: 'Бабка Нюра не уходила.\n\nМанжета лежала в ящике.', status: 'revised' } }));
    expect((saved['front'] as { words: number; status: string }).words).toBe(8);
    expect((saved['front'] as { status: string }).status).toBe('revised');
    const chapter = structured(await client.callTool({ name: 'chapter_get', arguments: { chapter: 1 } }));
    expect(chapter['body']).toContain('Манжета');

    const settings = structured(await client.callTool({ name: 'project_settings_update', arguments: { settings: { storyteller: 'randy', harshness: 5, preset: 'fast' } } }));
    const config = settings['config'] as { storyteller: string; harshness: number; preset: string };
    expect(config.storyteller).toBe('randy');
    expect(config.harshness).toBe(5);
    const invalid = await client.callTool({ name: 'project_settings_update', arguments: { settings: { harshness: 9 } } });
    expect((invalid as { isError?: boolean }).isError).toBe(true);
    const reopened = structured(await client.callTool({ name: 'project_open', arguments: { path: root } }));
    expect((reopened['config'] as { harshness: number }).harshness).toBe(5);

    const bible = structured(await client.callTool({ name: 'bible_list', arguments: {} }))['entries'] as Array<{ kind: string; slug: string; always_on: boolean }>;
    expect(bible.map((e) => e.slug).sort()).toEqual(['olga', 'verkhniy-kut']);
    expect(bible.find((e) => e.slug === 'olga')?.always_on).toBe(true);
    const characters = structured(await client.callTool({ name: 'bible_list', arguments: { kind: 'character' } }))['entries'] as unknown[];
    expect(characters).toHaveLength(1);
    const removed = structured(await client.callTool({ name: 'bible_remove', arguments: { kind: 'location', slug: 'verkhniy-kut' } }));
    expect(String(removed['trashed'])).toContain('_trash');
    expect((structured(await client.callTool({ name: 'bible_list', arguments: {} }))['entries'] as unknown[]).length).toBe(1);

    const plan = structured(await client.callTool({ name: 'plan_get', arguments: {} }));
    expect(plan['outline']).toContain('План');
    expect(plan['beats']).toEqual([]);
    const savedPlan = structured(await client.callTool({ name: 'plan_save', arguments: { outline: '# План\n\n1. Фары\n2. Штрек', chapters: { chapters: [{ number: 2, title: 'Штрек', beats: ['Спуск.'] }, { number: 1, title: 'Фары' }] } } }));
    expect((savedPlan['chapters'] as { chapters: unknown[] }).chapters).toHaveLength(2);
    const planAgain = structured(await client.callTool({ name: 'plan_get', arguments: {} }));
    expect(planAgain['outline']).toContain('2. Штрек');
    const badPlan = await client.callTool({ name: 'plan_save', arguments: { chapters: { chapters: [{ title: 'no number' }] } } });
    expect((badPlan as { isError?: boolean }).isError).toBe(true);

    const user = structured(await client.callTool({ name: 'user_config_set', arguments: { settings: { ui_language: 'en' } } }));
    expect((user['config'] as { ui_language: string }).ui_language).toBe('en');
    const userAgain = structured(await client.callTool({ name: 'user_config_get', arguments: {} }));
    expect((userAgain['config'] as { ui_language: string }).ui_language).toBe('en');
    const leak = await client.callTool({ name: 'user_config_set', arguments: { settings: { api_key: 'sk-nope' } } });
    expect((leak as { isError?: boolean }).isError).toBe(true);
    expect(await fs.readFile(path.join(dir, 'home', 'config.yaml'), 'utf8')).not.toContain('sk-nope');
  });

  it('whitelists a lint phrase, explains the narrator options and distills a voice card', async () => {
    const options = structured(await client.callTool({ name: 'narrator_options', arguments: {} }));
    expect((options['storytellers'] as Array<{ id: string }>).map((s) => s.id)).toEqual(['cassandra', 'phoebe', 'randy']);
    expect((options['harshness'] as unknown[]).length).toBe(6);
    expect((options['lengths'] as Array<{ id: string; plan_approval: boolean }>).find((l) => l.id === 'long')?.plan_approval).toBe(true);
    expect(options['brief_template']).toContain('Universe');

    const before = structured(await client.callTool({ name: 'lint', arguments: { text: 'По спине пробежал холодок.' } }));
    expect((before['hits'] as unknown[]).length).toBeGreaterThan(0);
    const added = structured(await client.callTool({ name: 'lint_whitelist_add', arguments: { phrase: 'по спине пробежал холодок', note: 'the Author likes it here' } }));
    expect(added['added']).toBe(true);
    const again = structured(await client.callTool({ name: 'lint_whitelist_add', arguments: { phrase: 'По спине пробежал холодок' } }));
    expect(again['added']).toBe(false);
    const after = structured(await client.callTool({ name: 'lint', arguments: { text: 'По спине пробежал холодок.' } }));
    expect((after['hits'] as Array<{ rule: string }>).filter((h) => h.rule === 'banned-phrase')).toEqual([]);

    const card = structured(await client.callTool({ name: 'voice_card', arguments: { sample: 'Она села. Сказала: ладно.' } }));
    expect(card['card']).toContain('голоса');
    expect(await fs.readFile(card['file'] as string, 'utf8')).toContain('голоса');
  });

  it('streams write output as progress notifications and accepts an edited suggestion', async () => {
    const deltas: string[] = [];
    const result = await client.callTool({ name: 'write_continue', arguments: { chapter: 1, target_words: 200 } }, undefined, {
      onprogress: (p) => {
        if (p.message) deltas.push(p.message);
      },
    });
    const out = structured(result);
    const suggestion = out['suggestion'] as { id: string };
    expect(suggestion.id).toMatch(/^sug-/);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toContain(out['text'] as string);
    const edited = `${out['text'] as string}\n\nОна закурила на крыльце.`;
    const accepted = structured(await client.callTool({ name: 'suggestion_accept', arguments: { id: suggestion.id, edited_text: edited } }));
    expect((accepted['chapter'] as { number: number }).number).toBe(1);
    const chapter = structured(await client.callTool({ name: 'chapter_get', arguments: { chapter: 1 } }));
    expect(chapter['body']).toContain('Она закурила на крыльце.');
    expect(chapter['body']).toContain('Манжета лежала');
  });

  it('runs the book in the background with progress events, pauses at a stage boundary and resumes', async () => {
    runEvents.length = 0;
    const started = structured(await client.callTool({ name: 'run_start', arguments: { chapters: 3, reader_report: false } }));
    const id = started['id'] as string;
    expect(id).toMatch(/^run-/);
    await waitFor(() => runEvents.some((e) => e['run_id'] === id && typeof e['delta'] === 'string'));
    const paused = structured(await client.callTool({ name: 'run_pause', arguments: { id } }));
    expect(paused['status']).toBe('pausing');
    await waitFor(() => runEvents.some((e) => e['run_id'] === id && e['final'] === true));
    const state = structured(await client.callTool({ name: 'run_get', arguments: { id } }))['state'] as { status: string; completed: number[]; target_chapters: number };
    expect(state.status).toBe('paused');
    expect(state.completed.length).toBeLessThan(3);
    const listed = structured(await client.callTool({ name: 'run_list', arguments: {} }))['runs'] as Array<{ id: string }>;
    expect(listed.map((r) => r.id)).toContain(id);

    runEvents.length = 0;
    const resumed = structured(await client.callTool({ name: 'run_start', arguments: { resume: id, reader_report: false } }));
    expect(resumed['id']).toBe(id);
    await waitFor(() => runEvents.some((e) => e['run_id'] === id && e['final'] === true), 60_000);
    const final = structured(await client.callTool({ name: 'run_get', arguments: { id } }))['state'] as { status: string; completed: number[] };
    expect(final.status).toBe('completed');
    expect(final.completed).toEqual([2, 3, 4].slice(0, final.completed.length));
    expect(final.completed.length).toBe(3);
    const chapters = structured(await client.callTool({ name: 'project_chapters', arguments: {} }))['chapters'] as Array<{ number: number; summary: boolean }>;
    expect(chapters.length).toBeGreaterThanOrEqual(4);
    expect(chapters.filter((c) => c.summary).length).toBeGreaterThanOrEqual(3);
    expect(text(await client.callTool({ name: 'chronicle_get', arguments: {} }))).toContain('last_chapter');
  }, 90_000);
});
