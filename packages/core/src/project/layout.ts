import path from 'node:path';

/**
 * Paths inside a story project (Section 9 of the build prompt). Everything the harness
 * touches goes through this map so the layout is documented in one place.
 */
export const PROJECT_FILE = 'project.yaml';

export interface ProjectLayout {
  root: string;
  projectFile: string;
  bible: {
    dir: string;
    premise: string;
    style: string;
    characters: string;
    locations: string;
    factions: string;
    items: string;
    worldRules: string;
    timeline: string;
    glossary: string;
    relationships: string;
    research: string;
  };
  chronicle: {
    dir: string;
    state: string;
    log: string;
    hidden: string;
    summaries: string;
  };
  plan: {
    dir: string;
    brief: string;
    outline: string;
    chapters: string;
  };
  chapters: string;
  canvas: { dir: string; board: string };
  style: {
    dir: string;
    voiceCard: string;
    lessons: string;
    bannedRu: string;
    bannedEn: string;
    whitelist: string;
  };
  history: { dir: string; calls: string; suggestions: string; chronicleLog: string };
  exports: string;
  trash: string;
}

export function projectLayout(root: string): ProjectLayout {
  const r = path.resolve(root);
  const j = (...parts: string[]) => path.join(r, ...parts);
  return {
    root: r,
    projectFile: j(PROJECT_FILE),
    bible: {
      dir: j('bible'),
      premise: j('bible', 'premise.md'),
      style: j('bible', 'style.md'),
      characters: j('bible', 'characters'),
      locations: j('bible', 'locations'),
      factions: j('bible', 'factions'),
      items: j('bible', 'items'),
      worldRules: j('bible', 'world-rules.md'),
      timeline: j('bible', 'timeline.md'),
      glossary: j('bible', 'glossary.md'),
      relationships: j('bible', 'relationships.yaml'),
      research: j('bible', 'research'),
    },
    chronicle: {
      dir: j('chronicle'),
      state: j('chronicle', 'state.yaml'),
      log: j('chronicle', 'chronicle.md'),
      hidden: j('chronicle', 'hidden.md'),
      summaries: j('chronicle', 'summaries'),
    },
    plan: {
      dir: j('plan'),
      brief: j('plan', 'brief.md'),
      outline: j('plan', 'outline.md'),
      chapters: j('plan', 'chapters.yaml'),
    },
    chapters: j('chapters'),
    canvas: { dir: j('canvas'), board: j('canvas', 'board.json') },
    style: {
      dir: j('style'),
      voiceCard: j('style', 'voice-card.md'),
      lessons: j('style', 'lessons.md'),
      bannedRu: j('style', 'banned-phrases.ru.txt'),
      bannedEn: j('style', 'banned-phrases.en.txt'),
      whitelist: j('style', 'lint-whitelist.txt'),
    },
    history: {
      dir: j('history'),
      calls: j('history', 'calls.jsonl'),
      suggestions: j('history', 'suggestions'),
      chronicleLog: j('history', 'chronicle-diffs.jsonl'),
    },
    exports: j('exports'),
    trash: j('_trash'),
  };
}

export const ENTRY_KINDS = ['character', 'location', 'faction', 'item'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export function entryDir(layout: ProjectLayout, kind: EntryKind): string {
  switch (kind) {
    case 'character':
      return layout.bible.characters;
    case 'location':
      return layout.bible.locations;
    case 'faction':
      return layout.bible.factions;
    case 'item':
      return layout.bible.items;
  }
}
