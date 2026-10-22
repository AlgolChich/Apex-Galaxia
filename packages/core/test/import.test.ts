import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, importBibleEntries, importManuscript, loadBible, splitEntries, splitManuscript } from '@apex-galaxia/core';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-import-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('manuscript import', () => {
  it('splits a Russian Markdown manuscript by chapter headings and drops the book title', () => {
    const text = '# Штрек\n\n## Глава 1. Фары\n\nБабка Нюра не уходила.\n\n## Глава 2. Штрек\n\nУтром над посёлком стоял туман.\n';
    const parts = splitManuscript(text, 'ru');
    expect(parts.map((p) => p.title)).toEqual(['Фары', 'Штрек']);
    expect(parts[0]?.body).toBe('Бабка Нюра не уходила.');
    expect(parts[1]?.body).toBe('Утром над посёлком стоял туман.');
  });

  it('accepts plain-text headings in both languages, numbers untitled chapters and keeps a preface', () => {
    const ru = splitManuscript('Пролог без заголовка.\n\nГлава 1\n\nТекст первой.\n\nГлава 2: Ночь\n\nТекст второй.', 'ru');
    expect(ru.map((p) => p.title)).toEqual(['Пролог', 'Глава 1', 'Ночь']);
    const en = splitManuscript('Chapter 1. Eleven\n\nThe fog came up the inlet.\n\nCHAPTER 2\n\nThe launch came back.', 'en');
    expect(en.map((p) => p.title)).toEqual(['Eleven', 'Chapter 2']);
    expect(splitManuscript('Just prose, no headings.\n\nSecond paragraph.', 'en')).toEqual([{ title: 'Chapter 1', body: 'Just prose, no headings.\n\nSecond paragraph.' }]);
    expect(splitManuscript('   \n', 'ru')).toEqual([]);
  });

  it('creates chapters through the store after the existing ones, with word counts', async () => {
    const store = await createProject(path.join(dir, 'p'), { title: 'Штрек', language: 'ru' });
    await store.createChapter(1, 'Существующая', 'Уже была.');
    const created = await importManuscript(store, '## Глава 1. Фары\n\nБабка Нюра не уходила.\n\n## Глава 2. Штрек\n\nУтром над посёлком стоял туман и копёр торчал из него.', { status: 'revised' });
    expect(created.map((c) => [c.front.number, c.front.title, c.front.words, c.front.status])).toEqual([
      [2, 'Фары', 4, 'revised'],
      [3, 'Штрек', 10, 'revised'],
    ]);
    const all = await store.listChapters();
    expect(all.map((c) => c.stem)).toEqual(['01-sushchestvuyushchaya', '02-fary', '03-shtrek']);
  });

  it('imports Bible entries from Markdown sections', async () => {
    const store = await createProject(path.join(dir, 'b'), { title: 'Штрек', language: 'ru' });
    const sections = splitEntries('# Ольга\n\n## Кратко\n\nФельдшер посёлка.\n\n# Гриша\n\n## Кратко\n\nБывший взрывник.\n\n## Голос\n\nМало слов.\n');
    expect(sections.map((s) => s.name)).toEqual(['Ольга', 'Кратко', 'Гриша', 'Кратко', 'Голос']);
    const entries = await importBibleEntries(store, '# Ольга\n\nФельдшер посёлка, сорок четыре года.\n\n# Гриша\n\nБывший взрывник.\n', 'character');
    expect(entries.map((e) => e.slug)).toEqual(['olga', 'grisha']);
    const bible = await loadBible(store);
    expect(bible.entries.find((e) => e.slug === 'olga')?.summary).toContain('Фельдшер');
  });
});
