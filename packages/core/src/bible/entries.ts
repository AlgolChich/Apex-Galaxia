import path from 'node:path';
import { ApexError } from '../util/errors.js';
import { listFiles } from '../util/fs.js';
import { slugify } from '../util/slug.js';
import { getSection, splitSections } from '../project/frontmatter.js';
import { ENTRY_KINDS, entryDir, projectLayout, type EntryKind, type ProjectLayout } from '../project/layout.js';
import {
  EntryFrontMatterSchema,
  RelationshipsFileSchema,
  ResearchFrontMatterSchema,
  type EntryFrontMatter,
  type RelationshipsFile,
  type ResearchFrontMatter,
} from '../project/schemas.js';
import type { ProjectStore } from '../project/store.js';

export interface BibleEntry {
  kind: EntryKind;
  slug: string;
  path: string;
  front: EntryFrontMatter;
  body: string;
  sections: Map<string, string>;
  /** The one-line summary injected whenever the entry triggers. */
  summary: string;
  /** True when the entry comes from a series Bible rather than this project. */
  shared: boolean;
}

export interface ResearchDossier {
  topic: string;
  path: string;
  front: ResearchFrontMatter;
  body: string;
}

export interface BibleSnapshot {
  entries: BibleEntry[];
  premise: string;
  style: string;
  worldRules: string;
  timeline: string;
  glossary: string;
  relationships: RelationshipsFile;
  research: ResearchDossier[];
}

/** Section headings are recognized in English and Russian so either reads naturally. */
export const SECTION_ALIASES: Record<string, string[]> = {
  summary: ['Summary', 'Кратко', 'Суть'],
  trueNow: ['True now', 'Сейчас', 'Текущее состояние'],
  history: ['History', 'История'],
  appearance: ['Appearance', 'Внешность'],
  voice: ['Voice', 'Голос', 'Речь'],
  wants: ['Wants, needs, obstacle', 'Хочет, нужно, мешает', 'Желания'],
  relationships: ['Relationships', 'Отношения'],
  secrets: ['Secrets', 'Тайны', 'Секреты'],
  sources: ['Sources', 'Источники'],
  details: ['Details', 'Подробности'],
};

export function section(entry: BibleEntry, key: keyof typeof SECTION_ALIASES): string | undefined {
  const names = SECTION_ALIASES[key] ?? [];
  return getSection(entry.sections, ...names);
}

function firstParagraph(body: string): string {
  const text = body.replace(/^#.*$/gm, '').trim();
  const para = text.split(/\n\s*\n/)[0] ?? '';
  return para.replace(/\s+/g, ' ').trim();
}

export function parseEntry(kind: EntryKind, file: string, front: EntryFrontMatter, body: string, shared = false): BibleEntry {
  const sections = splitSections(body);
  const summary = (getSection(sections, ...(SECTION_ALIASES['summary'] ?? [])) ?? firstParagraph(body))
    .split(/\r?\n/)[0]
    ?.trim() ?? '';
  return {
    kind,
    slug: path.basename(file, '.md'),
    path: file,
    front,
    body,
    sections,
    summary,
    shared,
  };
}

export async function loadEntries(store: ProjectStore, kind: EntryKind, layout: ProjectLayout = store.layout, shared = false): Promise<BibleEntry[]> {
  const files = await listFiles(entryDir(layout, kind), '.md');
  const entries: BibleEntry[] = [];
  for (const file of files) {
    const doc = await store.readMarkdown(file, EntryFrontMatterSchema);
    if (doc) {
      entries.push(parseEntry(kind, file, doc.front, doc.body, shared));
    }
  }
  return entries;
}

export async function loadResearch(store: ProjectStore, layout: ProjectLayout = store.layout): Promise<ResearchDossier[]> {
  const files = await listFiles(layout.bible.research, '.md');
  const out: ResearchDossier[] = [];
  for (const file of files) {
    const doc = await store.readMarkdown(file, ResearchFrontMatterSchema);
    if (doc) {
      out.push({ topic: doc.front.topic, path: file, front: doc.front, body: doc.body });
    }
  }
  return out;
}

/**
 * Load the whole Bible. With a `series_bible` path in project.yaml, entries of the shared
 * Bible are merged in; a project entry with the same slug overrides the shared one.
 */
export async function loadBible(store: ProjectStore): Promise<BibleSnapshot> {
  const layouts: Array<{ layout: ProjectLayout; shared: boolean }> = [{ layout: store.layout, shared: false }];
  if (store.config.series_bible) {
    const seriesRoot = path.resolve(store.layout.root, store.config.series_bible);
    layouts.push({ layout: { ...projectLayout(path.dirname(seriesRoot)), bible: projectLayout(path.dirname(seriesRoot)).bible }, shared: true });
    // A series Bible is a folder laid out like `bible/`; point the layout at it directly.
    const shared = layouts[1]!;
    shared.layout = { ...shared.layout, bible: { ...projectLayout(seriesRoot).bible, dir: seriesRoot, characters: path.join(seriesRoot, 'characters'), locations: path.join(seriesRoot, 'locations'), factions: path.join(seriesRoot, 'factions'), items: path.join(seriesRoot, 'items'), research: path.join(seriesRoot, 'research'), premise: path.join(seriesRoot, 'premise.md'), style: path.join(seriesRoot, 'style.md'), worldRules: path.join(seriesRoot, 'world-rules.md'), timeline: path.join(seriesRoot, 'timeline.md'), glossary: path.join(seriesRoot, 'glossary.md'), relationships: path.join(seriesRoot, 'relationships.yaml') } };
  }

  const bySlug = new Map<string, BibleEntry>();
  for (const { layout, shared } of [...layouts].reverse()) {
    for (const kind of ENTRY_KINDS) {
      for (const entry of await loadEntries(store, kind, layout, shared)) {
        bySlug.set(`${kind}:${entry.slug}`, entry);
      }
    }
  }

  const text = async (file: string) => (await store.readText(file)) ?? '';
  const main = store.layout;
  const relationships = (await store.readYaml(main.bible.relationships, RelationshipsFileSchema)) ?? { pairs: [] };
  const research = await loadResearch(store);
  for (const { layout, shared } of layouts) {
    if (shared) {
      research.push(...(await loadResearch(store, layout)));
    }
  }

  return {
    entries: [...bySlug.values()],
    premise: await text(main.bible.premise),
    style: await text(main.bible.style),
    worldRules: await text(main.bible.worldRules),
    timeline: await text(main.bible.timeline),
    glossary: await text(main.bible.glossary),
    relationships,
    research,
  };
}

export interface UpsertEntryInput {
  kind: EntryKind;
  slug?: string;
  front: Partial<EntryFrontMatter> & { name: string };
  body: string;
}

/** Write an entry (confirmed by the Author); never called silently by extraction. */
export async function upsertEntry(store: ProjectStore, input: UpsertEntryInput): Promise<BibleEntry> {
  const slug = input.slug ?? slugify(input.front.name);
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new ApexError('INVALID_ARGUMENT', `Entry slug must be lowercase latin: ${slug}`, { slug });
  }
  const file = path.join(entryDir(store.layout, input.kind), `${slug}.md`);
  const existing = await store.readMarkdown(file, EntryFrontMatterSchema);
  const front = EntryFrontMatterSchema.parse({ ...(existing?.front ?? {}), ...input.front });
  await store.writeMarkdown(file, EntryFrontMatterSchema, front, input.body);
  return parseEntry(input.kind, file, front, input.body);
}

export async function getEntry(store: ProjectStore, kind: EntryKind, slug: string): Promise<BibleEntry> {
  const file = path.join(entryDir(store.layout, kind), `${slug}.md`);
  const doc = await store.readMarkdown(file, EntryFrontMatterSchema);
  if (!doc) {
    throw new ApexError('ENTRY_NOT_FOUND', `${kind} entry ${slug} not found`, { kind, slug });
  }
  return parseEntry(kind, file, doc.front, doc.body);
}

export interface RenderEntryOptions {
  /** Full details instead of the summary line. */
  full: boolean;
  /** Include the Secrets section (only when the chapter plan unlocks it). */
  includeSecrets?: boolean;
}

/** Render an entry for a prompt: summary first, details after (Section 10.2). */
export function renderEntry(entry: BibleEntry, options: RenderEntryOptions): string {
  const names = [entry.front.name, ...entry.front.aliases.ru, ...entry.front.aliases.en].filter(
    (n, i, arr) => arr.indexOf(n) === i,
  );
  const header = `### ${entry.front.name} (${entry.kind}${entry.front.kind === 'canon' ? ', canon' : ''})`;
  const lines = [header, `Aliases: ${names.join(', ')}`, `Summary: ${entry.summary}`];
  if (options.full) {
    for (const key of ['trueNow', 'history', 'appearance', 'voice', 'wants', 'relationships', 'details'] as const) {
      const text = section(entry, key);
      if (text) {
        lines.push('', `${SECTION_ALIASES[key]?.[0] ?? key}:`, text);
      }
    }
    if (options.includeSecrets) {
      const secrets = section(entry, 'secrets');
      if (secrets) {
        lines.push('', 'Secrets (unlocked for this chapter):', secrets);
      }
    }
  }
  return lines.join('\n');
}

/** A character entry as the Section 9 template, used by `apex bible add` and the wizard. */
export function entryTemplate(kind: EntryKind, language: 'ru' | 'en', name: string): string {
  const ru = language === 'ru';
  const hint = (en: string, r: string) => `_${ru ? r : en}_`;
  const parts: string[] = [`# ${name}`, ''];
  parts.push('## Summary', '', hint('One line, injected whenever the entry triggers.', 'Одна строка: попадает в контекст при каждом упоминании.'), '');
  parts.push('## True now', '', hint('State the reader has seen.', 'Состояние, которое читатель уже видел.'), '');
  parts.push('## History', '', '');
  if (kind === 'character') {
    parts.push('## Appearance', '', hint('3–5 precise details and one unexpected; materials and colors.', '3–5 точных деталей и одна неожиданная; материалы и цвета.'), '');
    parts.push('## Voice', '', hint('Lexicon, rhythm, catchphrases, forms of address for each other character, what they never say. For fandoms: the official localization page.', 'Лексика, ритм, формулы, обращения к каждому, чего никогда не говорит. Для фандомов: страница официальной локализации.'), '');
    parts.push('## Wants, needs, obstacle', '', '');
    parts.push('## Relationships', '', '');
  } else {
    parts.push('## Details', '', '');
  }
  parts.push('## Secrets', '', hint('Hidden from Write until the plan unlocks them.', 'Скрыто от Write, пока план не откроет.'), '');
  parts.push('## Sources', '', '');
  return parts.join('\n');
}
