import type { Language } from './schemas.js';
import type { ChapterFile, ProjectStore } from './store.js';
import { countWords } from '../util/fs.js';
import { upsertEntry, type BibleEntry } from '../bible/entries.js';
import type { EntryKind } from './layout.js';

/**
 * Import of existing stories (Section 4.2): a Markdown or plain-text manuscript becomes
 * chapters, a Markdown file with one section per entry becomes Bible entries. Nothing is
 * rewritten: headings decide the split, the text is kept as it is.
 */
export interface ImportedChapter {
  title: string;
  body: string;
}

const CHAPTER_HEADING = /^(?:#{1,3}\s+)?(?:(?:Глава|Chapter|Часть|Part)\s+([IVXLC\d]+)[.:)]?\s*(.*)|#{1,3}\s+(.+))$/iu;

function titleOf(match: RegExpMatchArray, index: number, language: Language): string {
  const numbered = match[1] !== undefined;
  const rest = (numbered ? match[2] : match[3])?.trim().replace(/^[.:—–-]\s*/, '') ?? '';
  if (rest) return rest;
  return language === 'ru' ? `Глава ${index}` : `Chapter ${index}`;
}

/**
 * Split a manuscript into chapters. Markdown headings (`#`, `##`, `###`) and plain lines such
 * as «Глава 3. Фары» or "Chapter 3: Eleven" open a chapter; a single leading `# Title` with
 * no text before the first chapter is the book title and is dropped. Text without headings is
 * one chapter.
 */
export function splitManuscript(text: string, language: Language): ImportedChapter[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').split('\n');
  const chapters: ImportedChapter[] = [];
  let current: { title: string; lines: string[] } | undefined;
  const preface: string[] = [];
  let bookTitle: string | undefined;
  for (const line of lines) {
    const match = CHAPTER_HEADING.exec(line.trim());
    const isHeading = match !== null && line.trim().length > 0 && line.trim().length < 120;
    if (isHeading) {
      // A lone level-one heading before any chapter text is the book title, not a chapter.
      if (!current && chapters.length === 0 && /^#\s+/.test(line.trim()) && match[1] === undefined && preface.every((l) => l.trim() === '') && bookTitle === undefined) {
        bookTitle = match[3]?.trim();
        continue;
      }
      if (current) chapters.push({ title: current.title, body: current.lines.join('\n').trim() });
      current = { title: titleOf(match, chapters.length + 1, language), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preface.push(line);
  }
  if (current) chapters.push({ title: current.title, body: current.lines.join('\n').trim() });
  const prefaceText = preface.join('\n').trim();
  if (chapters.length === 0) {
    if (!prefaceText) return [];
    return [{ title: bookTitle ?? (language === 'ru' ? 'Глава 1' : 'Chapter 1'), body: prefaceText }];
  }
  if (prefaceText) chapters.unshift({ title: bookTitle ?? (language === 'ru' ? 'Пролог' : 'Prologue'), body: prefaceText });
  return chapters.filter((c) => c.body.length > 0);
}

export interface ImportManuscriptOptions {
  /** Number of the first imported chapter; default: after the last existing chapter. */
  startNumber?: number;
  status?: 'draft' | 'revised' | 'final';
}

/** Append the chapters of a manuscript to a project through the store (the only chapter writer). */
export async function importManuscript(store: ProjectStore, text: string, options: ImportManuscriptOptions = {}): Promise<ChapterFile[]> {
  const parts = splitManuscript(text, store.config.language);
  const existing = await store.listChapters();
  let number = options.startNumber ?? (existing[existing.length - 1]?.front.number ?? 0) + 1;
  const created: ChapterFile[] = [];
  for (const part of parts) {
    created.push(await store.createChapter(number, part.title, part.body, { status: options.status ?? 'draft' }));
    number += 1;
  }
  return created;
}

export interface ImportedEntrySection {
  name: string;
  body: string;
}

/** Split a Markdown file into Bible entries: one `#` or `##` heading per entry, the section as its body. */
export function splitEntries(text: string): ImportedEntrySection[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ImportedEntrySection[] = [];
  let current: { name: string; lines: string[] } | undefined;
  for (const line of lines) {
    const match = /^#{1,2}\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) out.push({ name: current.name, body: current.lines.join('\n').trim() });
      current = { name: match[1]!, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push({ name: current.name, body: current.lines.join('\n').trim() });
  return out;
}

/** Create or update entries of one kind from a Markdown file; the summary line comes from the first paragraph as usual. */
export async function importBibleEntries(store: ProjectStore, text: string, kind: EntryKind): Promise<BibleEntry[]> {
  const sections = splitEntries(text);
  const entries: BibleEntry[] = [];
  for (const section of sections) {
    const body = section.body || (store.config.language === 'ru' ? `## Кратко\n\n${section.name}.` : `## Summary\n\n${section.name}.`);
    entries.push(await upsertEntry(store, { kind, front: { name: section.name }, body }));
  }
  return entries;
}

export function manuscriptWords(chapters: ImportedChapter[]): number {
  return chapters.reduce((n, c) => n + countWords(c.body), 0);
}
