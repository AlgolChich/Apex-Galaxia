import path from 'node:path';
import { readTextIfExists, writeTextAtomic } from '../util/fs.js';
import { LessonSchema, type Language, type Lesson, type LessonCategory } from '../project/schemas.js';
import type { ProjectStore } from '../project/store.js';
import { resolveDataFile, type Resources } from '../resources.js';

export interface BannedPhrase {
  phrase: string;
  note?: string;
}

export interface StyleMemory {
  /** style/house-rules.md: the shipped seed, or the user's override. */
  houseRules: string;
  /** bible/style.md of the project. */
  projectStyle: string;
  /** Project voice card, falling back to the global one. */
  voiceCard: string;
  lessons: Lesson[];
  banned: { ru: BannedPhrase[]; en: BannedPhrase[] };
  whitelist: string[];
  rubric: string;
  sources: Record<string, string>;
}

export function parsePhraseList(text: string): BannedPhrase[] {
  const out: BannedPhrase[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [phrase, ...rest] = line.split('|');
    const cleaned = (phrase ?? '').trim();
    if (!cleaned) continue;
    const note = rest.join('|').trim();
    out.push(note ? { phrase: cleaned, note } : { phrase: cleaned });
  }
  return out;
}

const HEADING = /^##\s+(\S+)\s+·\s+(\d{4}-\d{2}-\d{2})\s+·\s+([a-z_]+)\s*$/;

/** Parse lessons.md (format described at the top of the shipped file). Malformed entries are skipped. */
export function parseLessons(markdown: string): Lesson[] {
  const lessons: Lesson[] = [];
  const lines = markdown.split(/\r?\n/);
  let current: Record<string, unknown> | undefined;
  let quoteTarget: 'before' | 'after' | undefined;
  const flush = () => {
    if (!current) return;
    const parsed = LessonSchema.safeParse(current);
    if (parsed.success) lessons.push(parsed.data);
    current = undefined;
    quoteTarget = undefined;
  };
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      current = { id: heading[1], date: heading[2], category: heading[3] };
      continue;
    }
    if (!current) continue;
    const field = /^(Rule|Provenance|Weight|Language):\s*(.*)$/.exec(line);
    if (field) {
      quoteTarget = undefined;
      const key = field[1]!.toLowerCase();
      const value = field[2]!.trim();
      if (key === 'weight') current['weight'] = Number(value);
      else current[key] = value;
      continue;
    }
    if (/^Before:\s*$/.test(line)) {
      quoteTarget = 'before';
      continue;
    }
    if (/^After:\s*$/.test(line)) {
      quoteTarget = 'after';
      continue;
    }
    if (quoteTarget && line.startsWith('>')) {
      const text = line.replace(/^>\s?/, '');
      const prev = current[quoteTarget];
      current[quoteTarget] = typeof prev === 'string' && prev.length > 0 ? `${prev}\n${text}` : text;
      continue;
    }
    if (line.trim() === '' ) {
      quoteTarget = quoteTarget && current[quoteTarget] ? undefined : quoteTarget;
    }
  }
  flush();
  return lessons;
}

export function serializeLesson(lesson: Lesson): string {
  const lines = [
    `## ${lesson.id} · ${lesson.date} · ${lesson.category}`,
    '',
    `Rule: ${lesson.rule}`,
    `Provenance: ${lesson.provenance}`,
    `Weight: ${lesson.weight}`,
    `Language: ${lesson.language}`,
  ];
  if (lesson.before) {
    lines.push('', 'Before:', ...lesson.before.split('\n').map((l) => `> ${l}`));
  }
  if (lesson.after) {
    lines.push('', 'After:', ...lesson.after.split('\n').map((l) => `> ${l}`));
  }
  return lines.join('\n') + '\n';
}

/** Append a confirmed lesson to a lessons.md file (creating it with a header if needed). */
export async function appendLesson(file: string, lesson: Lesson): Promise<void> {
  const current = (await readTextIfExists(file)) ?? '# Lessons\n';
  const text = current.trimEnd() + '\n\n' + serializeLesson(lesson);
  await writeTextAtomic(file, text);
}

export function nextLessonId(existing: Lesson[]): string {
  let max = 0;
  for (const l of existing) {
    const m = /^lesson-(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `lesson-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Pick the lessons for a task: category matches first, then weight, then recency.
 * The house rules travel whole; lessons are retrieved (Section 6.3).
 */
export function selectLessons(lessons: Lesson[], categories: LessonCategory[], language: Language, limit = 8): Lesson[] {
  const wanted = new Set(categories);
  return lessons
    .filter((l) => l.language === 'both' || l.language === language)
    .map((l) => ({ l, score: (wanted.has(l.category) ? 100 : 0) + l.weight * 10 }))
    .sort((a, b) => b.score - a.score || b.l.date.localeCompare(a.l.date))
    .slice(0, limit)
    .map((x) => x.l);
}

export function renderLessons(lessons: Lesson[]): string {
  return lessons.map((l) => `- [${l.category}] ${l.rule}${l.before ? ` (not: «${l.before.split('\n')[0]}»)` : ''}`).join('\n');
}

async function readGlobal(resources: Resources, rel: string): Promise<{ text: string; source: string }> {
  const file = await resolveDataFile(resources, rel);
  if (!file) return { text: '', source: '' };
  return { text: (await readTextIfExists(file)) ?? '', source: file };
}

/** Load the style memory: global files (user override wins) plus project additions. */
export async function loadStyleMemory(store: ProjectStore, resources: Resources): Promise<StyleMemory> {
  const houseRules = await readGlobal(resources, path.join('style', 'house-rules.md'));
  const rubric = await readGlobal(resources, path.join('style', 'rubric.md'));
  const globalLessons = await readGlobal(resources, path.join('style', 'lessons.md'));
  const globalVoice = await readGlobal(resources, path.join('style', 'voice-card.md'));
  const bannedRu = await readGlobal(resources, path.join('style', 'banned-phrases.ru.txt'));
  const bannedEn = await readGlobal(resources, path.join('style', 'banned-phrases.en.txt'));

  const projectStyle = (await store.readText(store.layout.bible.style)) ?? '';
  const projectVoice = (await store.readText(store.layout.style.voiceCard)) ?? '';
  const projectLessons = (await store.readText(store.layout.style.lessons)) ?? '';
  const projectBannedRu = (await store.readText(store.layout.style.bannedRu)) ?? '';
  const projectBannedEn = (await store.readText(store.layout.style.bannedEn)) ?? '';
  const whitelist = parsePhraseList((await store.readText(store.layout.style.whitelist)) ?? '').map((p) => p.phrase);

  const lessons = [...parseLessons(globalLessons.text), ...parseLessons(projectLessons)];
  const voiceHasContent = /^(?!#)(?!_)\S/m.test(projectVoice.replace(/^##.*$/gm, '').trim());

  return {
    houseRules: houseRules.text,
    projectStyle,
    voiceCard: voiceHasContent ? projectVoice : globalVoice.text,
    lessons,
    banned: {
      ru: [...parsePhraseList(bannedRu.text), ...parsePhraseList(projectBannedRu)],
      en: [...parsePhraseList(bannedEn.text), ...parsePhraseList(projectBannedEn)],
    },
    whitelist,
    rubric: rubric.text,
    sources: {
      houseRules: houseRules.source,
      rubric: rubric.source,
      globalLessons: globalLessons.source,
      projectLessons: store.layout.style.lessons,
      bannedRu: bannedRu.source,
      bannedEn: bannedEn.source,
    },
  };
}
