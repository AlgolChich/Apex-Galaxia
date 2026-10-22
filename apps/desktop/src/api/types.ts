/**
 * Shapes of what the MCP tools return, as the app uses them. They mirror the core's schemas
 * (packages/core/src/project/schemas.ts) and the tool code in packages/mcp-server/src.
 */
export type Language = 'ru' | 'en';
export type Storyteller = 'cassandra' | 'phoebe' | 'randy';
export type Rating = 'soft' | 'medium' | 'high' | 'heavy';
export type LengthClass = 'short' | 'medium' | 'long' | 'very_long';
export type Preset = 'fast' | 'balanced' | 'best';
export type ChapterStatus = 'planned' | 'draft' | 'revised' | 'final';
export type EntryKind = 'character' | 'location' | 'faction' | 'item';

export interface ModelRoles {
  plan: string;
  prose: string;
  critic: string;
  extract: string;
  summary: string;
  lint: string;
}

export interface ProjectConfig {
  format_version: number;
  title: string;
  language: Language;
  narrator: string;
  storyteller: Storyteller;
  harshness: number;
  rating: Rating;
  length: LengthClass;
  pov: 'first' | 'third';
  tense: 'past' | 'present';
  cliffhangers: 'none' | 'chapters' | 'chapters_and_finale';
  ending: 'happy' | 'bittersweet' | 'tragic' | 'open' | 'narrator';
  yo_policy: 'yo' | 'ye';
  spelling: 'us' | 'uk';
  original_characters: 'no' | 'yes' | 'narrator';
  preset: Preset;
  muse?: { critic?: boolean; max_revisions?: number; min_score?: number };
  models: ModelRoles;
  budget: { context_tokens: number; project_usd: number | null; warn_at_usd: number | null };
  window: { previous_tail_words: number; current_chapter_words: number };
  series_bible?: string;
  created?: string;
  [key: string]: unknown;
}

export interface ChapterSummary {
  number: number;
  title: string;
  stem?: string;
  words?: number;
  status: ChapterStatus;
  /** Whether a cached summary exists (project_chapters only). */
  summary?: boolean;
}

export interface ChapterFront {
  number: number;
  title: string;
  status: ChapterStatus;
  words?: number;
  pov?: string;
  in_story_date?: string;
  [key: string]: unknown;
}

export interface ChapterFull {
  front: ChapterFront;
  stem: string;
  path: string;
  body: string;
}

export interface ProjectOpened {
  root: string;
  config: ProjectConfig;
  chapters: ChapterSummary[];
  spentUsd: number;
}

export interface LintHit {
  rule: string;
  severity: 'info' | 'warning' | 'error';
  category: string;
  start: number;
  end: number;
  line: number;
  column: number;
  excerpt: string;
  message: { en: string; ru: string };
}

export interface LintReport {
  hits: LintHit[];
  counts: { info: number; warning: number; error: number };
  words: number;
  paragraphs: number;
}

export interface SuggestionFront {
  id: string;
  task: string;
  created: string;
  model: string;
  status: 'pending' | 'accepted' | 'discarded';
  chapter?: number;
  title?: string;
  cost_usd?: number;
  call_id?: string;
  cursor?: number;
  [key: string]: unknown;
}

export interface InspectorLayer {
  name: string;
  tokens: number;
  included: boolean;
  action: 'kept' | 'compacted' | 'truncated' | 'dropped';
  note?: string;
}

export interface InspectorRecord {
  task: string;
  template: string;
  model: string;
  kind: string;
  budgetTokens: number;
  totalTokens: number;
  exactCounts: boolean;
  layers: InspectorLayer[];
  bible: Array<{ slug: string; kind: string; reason: string; matchedAliases: string[]; hits: number; included: boolean; full: boolean }>;
  lessons: Array<{ id: string; category: string; rule: string }>;
  rolls: unknown[];
  promptHashHint: string;
}

export interface Estimate {
  model: string;
  inputTokens: number;
  expectedOutputTokens: number;
  costUsd: number;
  exact: boolean;
}

export interface WriteResult {
  suggestion: SuggestionFront;
  text: string;
  lint: LintReport;
  costUsd: number;
  model: string;
  warnings: string[];
  inspector?: InspectorRecord;
}

export interface DiffBlock {
  kind: 'same' | 'changed' | 'added' | 'removed';
  before: string[];
  after: string[];
}

export interface RewriteResult {
  text: string;
  diff: DiffBlock[];
  lint: LintReport;
  model?: string;
  costUsd?: number;
}

export interface DescribeOption {
  sense: 'sound' | 'smell' | 'touch' | 'temperature' | 'light' | 'taste' | 'object' | 'body';
  text: string;
}

export interface CriticResult {
  scores: { voice: number; subtext: number; rhythm: number; cliche: number; ai_tell: number; continuity: number; language: number };
  quotes: Array<{ quote: string; issue: string; category: string; severity: 'low' | 'medium' | 'high'; fix?: string }>;
  verdict: 'pass' | 'revise' | 'reject';
  notes?: string;
}

export interface BibleEntrySummary {
  kind: EntryKind;
  slug: string;
  name: string;
  aliases: { ru: string[]; en: string[] };
  summary: string;
  always_on: boolean;
  canon?: boolean;
  shared?: boolean;
  path?: string;
}

export interface BibleEntryFull extends Omit<BibleEntrySummary, 'always_on'> {
  front: { name: string; aliases: { ru: string[]; en: string[] }; always_on?: boolean; kind?: 'canon' | 'original'; [key: string]: unknown };
  body: string;
}

export interface ChronicleState {
  format_version?: number;
  in_story_time: string;
  last_chapter: number;
  locations: Record<string, string>;
  condition: Record<string, { wounds: string[]; fatigue?: string; mood?: string; notes?: string }>;
  inventory: Record<string, string[]>;
  knowledge: Array<{ id: string; fact: string; known_by: string[]; since_chapter?: number }>;
  relations: Array<{ between: [string, string]; trust?: string; promises: string[]; debts: string[]; grudges: string[]; notes?: string }>;
  open_threads: Array<{ id: string; text: string; since_chapter?: number; status: 'open' | 'resolved' }>;
  planted_guns: Array<{ id: string; what: string; planted_in?: number; payoff?: string; fired_in?: number }>;
  pending_consequences: Array<{ id: string; text: string; due?: string; done: boolean }>;
  rolls: Array<{ chapter: number; die: 'd20'; result: number; outcome: string; at?: string; note?: string }>;
}

export interface ChronicleProposal {
  chapter: number;
  summary: string;
  hidden?: string;
  in_story_time?: string;
  ops: Array<Record<string, unknown>>;
}

export interface BeatSheet {
  chapter: number;
  title: string;
  goal: string;
  beats: string[];
  breather_scene: string;
  ending_image: string;
  world_tick: string[];
  guns: string[];
  cliffhanger?: string;
}

export interface Roll {
  chapter: number;
  die: 'd20';
  result: number;
  outcome: 'luck' | 'lull' | 'trouble' | 'catastrophe';
  at?: string;
  note?: string;
}

export interface PlannedChapter {
  number: number;
  title: string;
  slug?: string;
  status: ChapterStatus;
  target_words?: number;
  beats: string[];
  turning_point?: string;
  cliffhanger?: string;
}

export interface PlanFiles {
  outline: string;
  chapters: { chapters: PlannedChapter[] };
  /** Chapter numbers that have a stored beat sheet. */
  beats: number[];
}

export interface RunState {
  id: string;
  started_at: string;
  updated_at: string;
  status: 'running' | 'awaiting_outline_approval' | 'paused' | 'completed' | 'failed';
  target_chapters: number;
  next_chapter: number;
  stage: 'outline' | 'plan' | 'write' | 'chronicle' | 'summary' | 'report' | 'done';
  completed: number[];
  cost_usd: number;
  outline_approved: boolean;
  pending_suggestion?: string;
  error?: string;
  log: string[];
}

/** A logging notification from the sidecar with logger `apex.run`. */
export interface RunEvent {
  run_id: string;
  status?: RunState['status'];
  stage?: RunState['stage'];
  next_chapter?: number;
  completed?: number;
  target?: number;
  cost_usd?: number;
  message?: string;
  delta?: string;
  final?: boolean;
  error?: string;
}

export interface ModelStatus {
  provider: 'anthropic' | 'replay' | string;
  key_source: 'env' | 'env-file' | 'none' | 'replay' | 'scripted' | 'custom' | 'unknown';
  scripted: boolean;
  has_model: boolean;
  exact_token_counts: boolean;
  models: ModelRoles | null;
  project: string | null;
}

export interface UserConfig {
  ui_language?: Language;
  provider?: string;
  base_url?: string;
  models?: Partial<ModelRoles>;
  budget?: { context_tokens?: number; project_usd?: number | null; warn_at_usd?: number | null };
  [key: string]: unknown;
}

export interface Lesson {
  id: string;
  date: string;
  category: string;
  rule: string;
  provenance: string;
  weight: number;
  language: 'ru' | 'en' | 'both';
  before?: string;
  after?: string;
}

export interface LessonProposal {
  category: string;
  rule: string;
  before?: string;
  after?: string;
  language: 'ru' | 'en' | 'both';
}

export interface Direction {
  title: string;
  text: string;
  obvious: boolean;
  recommended: boolean;
}

export interface ProjectCreateOptions {
  path: string;
  title: string;
  language: Language;
  universe?: string;
  canon_point?: string;
  leads?: string;
  supporting?: string;
  idea?: string;
  genre_tone?: string;
  storyteller?: Storyteller;
  harshness?: number;
  rating?: Rating;
  length?: LengthClass;
  pov?: 'first' | 'third';
  tense?: 'past' | 'present';
  cliffhangers?: 'none' | 'chapters' | 'chapters_and_finale';
  ending?: 'happy' | 'bittersweet' | 'tragic' | 'open' | 'narrator';
  original_characters?: 'no' | 'yes' | 'narrator';
  must_have_scenes?: string;
  taboos?: string;
  yo_policy?: 'yo' | 'ye';
  spelling?: 'us' | 'uk';
}

export interface PreparedTask {
  handle: string;
  task: string;
  model: string;
  output: string;
  schema: string | null;
  expect_heading: { number: number; title: string } | null;
  roll: Roll | null;
  system: string[];
  user: string;
  inspector: InspectorRecord;
  estimate: Estimate;
}

export interface SubmitResult {
  task: string;
  text: string;
  json: unknown;
  violations: string[];
  suggestion: SuggestionFront | null;
  lint?: LintReport;
  diff?: DiffBlock[];
  outcome?: unknown;
  callId: string;
}

export interface Bilingual {
  en: string;
  ru: string;
}

/** What `narrator_options` returns: everything a wizard or a settings form explains. */
export interface NarratorOptions {
  name: string;
  display_name: Bilingual;
  defaults: { storyteller: Storyteller; harshness: number; rating: Rating; length: LengthClass; pov: 'first' | 'third'; tense: 'past' | 'present'; cliffhangers: 'none' | 'chapters' | 'chapters_and_finale'; original_characters: 'no' | 'yes' | 'narrator'; ending: 'happy' | 'bittersweet' | 'tragic' | 'open' | 'narrator' };
  storytellers: Array<{ id: Storyteller; name: Bilingual; rhythm: Bilingual; expect: Bilingual; default: boolean }>;
  harshness: Array<{ level: number; name: Bilingual; allowed: Bilingual; default: boolean }>;
  ratings: Array<{ id: Rating; name: Bilingual; allowed: Bilingual; default: boolean }>;
  lengths: Array<{ id: LengthClass; name: Bilingual; pages: [number, number]; words: [number, number]; chapters: [number, number]; plan_approval: boolean; default: boolean }>;
  chapter_words: { min: number; max: number };
  brief_template: string;
}
