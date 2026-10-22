import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, exportBook, renderMarkdown, type ProjectStore } from '@apex-galaxia/core';

let dir: string;
let store: ProjectStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-export-'));
  store = await createProject(path.join(dir, 's'), { title: 'Маяк на Собачьей косе', language: 'ru' });
  await store.createChapter(1, 'Смена', 'Насос завёлся с третьего раза.\n\n— Ты один? — спросила она.\n');
  await store.createChapter(2, 'Радио', 'Вечером радио ожило.\n');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('exports', () => {
  it('renders Markdown with headings in the story language', async () => {
    const result = await exportBook(store, 'md');
    const text = await fs.readFile(result.file, 'utf8');
    expect(text).toContain('# Маяк на Собачьей косе');
    expect(text).toContain('## Глава 1. Смена');
    expect(text).toContain('## Глава 2. Радио');
    expect(result.words).toBe(12);
    expect(renderMarkdown({ title: 'T', language: 'en', author: undefined, chapters: [] })).toBe('# T\n\n');
  });

  it('writes a DOCX package with the chapters in document.xml', async () => {
    const result = await exportBook(store, 'docx');
    const zip = await JSZip.loadAsync(await fs.readFile(result.file));
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Глава 1. Смена');
    expect(xml).toContain('Насос завёлся с третьего раза.');
    expect(xml).toContain('— Ты один? — спросила она.');
    expect(xml).toContain('Глава 2. Радио');
  });

  it('writes a valid EPUB 3 structure: stored mimetype first, container, opf, nav, chapters', async () => {
    const result = await exportBook(store, 'epub');
    const buffer = await fs.readFile(result.file);
    // The mimetype entry must be the first file and stored (uncompressed): bytes 30..38 spell "mimetype".
    expect(buffer.subarray(30, 38).toString('ascii')).toBe('mimetype');
    expect(buffer.subarray(38, 58).toString('ascii')).toBe('application/epub+zip');
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(names).toEqual(expect.arrayContaining(['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter-01.xhtml', 'OEBPS/chapter-02.xhtml', 'OEBPS/style.css']));
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<dc:title>Маяк на Собачьей косе</dc:title>');
    expect(opf).toContain('<dc:language>ru</dc:language>');
    expect(opf).toContain('<itemref idref="ch1"/>');
    expect(opf).toContain('properties="nav"');
    const chapter = await zip.file('OEBPS/chapter-01.xhtml')!.async('string');
    expect(chapter).toContain('<h1>Глава 1. Смена</h1>');
    expect(chapter).toContain('<p class="first">Насос завёлся с третьего раза.</p>');
    expect(chapter).toContain('<p>— Ты один? — спросила она.</p>');
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(nav).toContain('Оглавление');
    expect(nav).toContain('chapter-02.xhtml');
  });
});
