import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PromptLibrary, fill, renderTemplate, resolveResources, schemaByName, type Resources } from '@apex-galaxia/core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-prompts-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('prompt library', () => {
  it('loads every shipped template, expands partials and points json outputs at real schemas', async () => {
    const library = new PromptLibrary(resources);
    const files = (await fs.readdir(path.join(repoRoot, 'prompts'))).filter((f) => f.endsWith('.md') && f !== 'README.md');
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const task = file.replace(/\.md$/, '');
      const template = await library.get(task);
      expect(template.task).toBe(task);
      expect(template.body).not.toContain('{{>');
      if (template.jsonSchemaName) {
        expect(schemaByName(template.jsonSchemaName), `${task} points at schema ${template.jsonSchemaName}`).toBeDefined();
      }
    }
    const chapter = await library.get('write.chapter');
    expect(chapter.contract).toBe('contract.prose');
    expect((await library.get('contract.prose')).body).toContain('Output contract');
    expect(chapter.body).not.toContain('Output contract');
    expect(chapter.placeholders).toEqual(expect.arrayContaining(['chapter_number', 'beat_sheet', 'heading']));
    expect((await library.get('contract.prose')).placeholders).toEqual(['stop_marker']);
    expect(chapter.lessons).toContain('dialogue');
  });

  it('fails loudly on a missing placeholder and renders when all are given', async () => {
    const library = new PromptLibrary(resources);
    const t = await library.get('summary.chapter');
    expect(() => renderTemplate(t, {})).toThrow(/Missing placeholder/);
    const rendered = renderTemplate(t, { language_name: 'Russian', chapter_text: 'Текст.', stop_marker: '[[END]]' });
    expect(rendered).toContain('Текст.');
    expect(rendered).not.toContain('{{');
    expect(fill('a {{x}} b', { x: '1' })).toBe('a 1 b');
  });

  it('loads language modules and lets a user override win', async () => {
    const library = new PromptLibrary(resources);
    const ru = await library.languageModule('ru', { yo_policy: 'ё везде', banned_examples: 'x' });
    expect(ru).toContain('Реплика');
    const override = path.join(dir, 'home', 'prompts');
    await fs.mkdir(override, { recursive: true });
    await fs.writeFile(path.join(override, 'summary.chapter.md'), '---\ntask: summary.chapter\nkind: summary\nrole: summary\noutput: prose\n---\nCustom {{chapter_text}}\n');
    const fresh = new PromptLibrary(resources);
    expect((await fresh.get('summary.chapter')).body).toBe('Custom {{chapter_text}}');
  });
});
