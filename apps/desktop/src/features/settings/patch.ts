import type { ModelRoles, ProjectConfig } from '../../api/types.js';

export const ROLES: Array<keyof ModelRoles> = ['plan', 'prose', 'critic', 'extract', 'summary', 'lint'];

/** The project settings form; numbers stay strings until the patch is built. */
export interface SettingsDraft {
  title: string;
  storyteller: ProjectConfig['storyteller'];
  harshness: number;
  rating: ProjectConfig['rating'];
  length: ProjectConfig['length'];
  pov: ProjectConfig['pov'];
  tense: ProjectConfig['tense'];
  cliffhangers: ProjectConfig['cliffhangers'];
  ending: ProjectConfig['ending'];
  original_characters: ProjectConfig['original_characters'];
  yo_policy: ProjectConfig['yo_policy'];
  spelling: ProjectConfig['spelling'];
  preset: ProjectConfig['preset'];
  models: ModelRoles;
  budget: { context_tokens: string; project_usd: string; warn_at_usd: string };
  window: { previous_tail_words: string; current_chapter_words: string };
}

const SIMPLE = ['title', 'storyteller', 'harshness', 'rating', 'length', 'pov', 'tense', 'cliffhangers', 'ending', 'original_characters', 'yo_policy', 'spelling', 'preset'] as const;

export function draftOf(config: ProjectConfig): SettingsDraft {
  return {
    title: config.title,
    storyteller: config.storyteller,
    harshness: config.harshness,
    rating: config.rating,
    length: config.length,
    pov: config.pov,
    tense: config.tense,
    cliffhangers: config.cliffhangers,
    ending: config.ending,
    original_characters: config.original_characters,
    yo_policy: config.yo_policy,
    spelling: config.spelling,
    preset: config.preset,
    models: { ...config.models },
    budget: { context_tokens: String(config.budget.context_tokens), project_usd: config.budget.project_usd === null ? '' : String(config.budget.project_usd), warn_at_usd: config.budget.warn_at_usd === null ? '' : String(config.budget.warn_at_usd) },
    window: { previous_tail_words: String(config.window.previous_tail_words), current_chapter_words: String(config.window.current_chapter_words) },
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): unknown => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : value);
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function intOr(text: string, fallback: number): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : fallback;
}

function nullableNumber(text: string, fallback: number | null): number | null {
  if (text.trim() === '') return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Only the top-level keys that changed go to `project_settings_update`, which merges them
 * into project.yaml; nested objects (models, budget, window) go whole when any field inside
 * changed, because the server would fill a partial object with schema defaults.
 */
export function patchOf(draft: SettingsDraft, config: ProjectConfig): Partial<ProjectConfig> {
  const patch: Record<string, unknown> = {};
  for (const key of SIMPLE) {
    const value = key === 'title' ? draft.title.trim() : draft[key];
    if (value !== config[key]) patch[key] = value;
  }
  const models: ModelRoles = { ...config.models };
  for (const role of ROLES) models[role] = draft.models[role].trim() || config.models[role];
  if (!sameJson(models, config.models)) patch['models'] = models;
  const budget = { context_tokens: intOr(draft.budget.context_tokens, config.budget.context_tokens), project_usd: nullableNumber(draft.budget.project_usd, config.budget.project_usd), warn_at_usd: nullableNumber(draft.budget.warn_at_usd, config.budget.warn_at_usd) };
  if (!sameJson(budget, config.budget)) patch['budget'] = budget;
  const window = { previous_tail_words: intOr(draft.window.previous_tail_words, config.window.previous_tail_words), current_chapter_words: intOr(draft.window.current_chapter_words, config.window.current_chapter_words) };
  if (!sameJson(window, config.window)) patch['window'] = window;
  return patch as Partial<ProjectConfig>;
}
