import { z } from 'zod';

/**
 * Schemas for every file type in a story project (Section 9). They are the single source
 * of truth: the core validates on load and refuses to write an invalid file, and
 * `scripts/write-schemas.ts` exports them as JSON Schema into `packages/core/schemas/`
 * for editors and other tools.
 */
export const FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// Enumerations shared by settings, narrator profiles and prompts
// ---------------------------------------------------------------------------

export const LanguageSchema = z.enum(['ru', 'en']);
export type Language = z.infer<typeof LanguageSchema>;

export const StorytellerSchema = z.enum(['cassandra', 'phoebe', 'randy']);
export type Storyteller = z.infer<typeof StorytellerSchema>;

export const HarshnessSchema = z.number().int().min(1).max(6);

export const RatingSchema = z.enum(['soft', 'medium', 'high', 'heavy']);
export type Rating = z.infer<typeof RatingSchema>;

export const LengthClassSchema = z.enum(['short', 'medium', 'long', 'very_long']);
export type LengthClass = z.infer<typeof LengthClassSchema>;

export const PovSchema = z.enum(['first', 'third']);
export const TenseSchema = z.enum(['past', 'present']);
export const CliffhangerModeSchema = z.enum(['none', 'chapters', 'chapters_and_finale']);
export const EndingSchema = z.enum(['happy', 'bittersweet', 'tragic', 'open', 'narrator']);
export const PresetSchema = z.enum(['fast', 'balanced', 'best']);
export type Preset = z.infer<typeof PresetSchema>;

export const ModelRoleSchema = z.enum(['plan', 'prose', 'critic', 'extract', 'summary', 'lint']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

// ---------------------------------------------------------------------------
// project.yaml
// ---------------------------------------------------------------------------

export const ModelRolesSchema = z.object({
  plan: z.string().default('claude-fable-5-1'),
  prose: z.string().default('claude-opus-5-5'),
  critic: z.string().default('claude-fable-5-1'),
  extract: z.string().default('claude-haiku-5-5'),
  summary: z.string().default('claude-haiku-5-5'),
  lint: z.string().default('claude-haiku-5-5'),
});
export type ModelRoles = z.infer<typeof ModelRolesSchema>;

export const BudgetSchema = z.object({
  /** Context budget for one generation, in tokens (Section 10.3). */
  context_tokens: z.number().int().positive().default(60_000),
  /** Hard stop for the whole project, in US dollars; null means no cap. */
  project_usd: z.number().nonnegative().nullable().default(null),
  /** Warn when the project has spent this much. */
  warn_at_usd: z.number().nonnegative().nullable().default(null),
});

/** The Muse Layer stages (Section 4.6); the preset fills the defaults, these override. */
export const MuseSchema = z.object({
  /** Run the critic pass after each prose generation. */
  critic: z.boolean().optional(),
  /** Bounded revision loop: at most this many passes, each fixing only what the critic quoted. */
  max_revisions: z.number().int().min(0).max(2).optional(),
  /** Stop revising when every rubric score reaches this value. */
  min_score: z.number().int().min(1).max(5).optional(),
});

export const WindowSchema = z.object({
  /** Words of the previous chapter's tail included with the current chapter (10.4). */
  previous_tail_words: z.number().int().nonnegative().default(1500),
  /** Words of the current chapter kept in full before trimming starts. */
  current_chapter_words: z.number().int().positive().default(12_000),
});

export const ProjectConfigSchema = z
  .object({
    format_version: z.number().int().positive(),
    title: z.string().min(1),
    language: LanguageSchema,
    narrator: z.string().min(1).default('gwen'),
    storyteller: StorytellerSchema.default('cassandra'),
    harshness: HarshnessSchema.default(3),
    rating: RatingSchema.default('medium'),
    length: LengthClassSchema.default('medium'),
    pov: PovSchema.default('third'),
    tense: TenseSchema.default('past'),
    cliffhangers: CliffhangerModeSchema.default('chapters'),
    ending: EndingSchema.default('narrator'),
    /** Russian only: write ё consistently (`yo`) or е everywhere (`ye`). */
    yo_policy: z.enum(['yo', 'ye']).default('yo'),
    /** English only. */
    spelling: z.enum(['us', 'uk']).default('us'),
    original_characters: z.enum(['no', 'yes', 'narrator']).default('no'),
    preset: PresetSchema.default('balanced'),
    muse: MuseSchema.optional(),
    models: ModelRolesSchema.prefault({}),
    budget: BudgetSchema.prefault({}),
    window: WindowSchema.prefault({}),
    /** Path to a shared Bible folder for a series (relative to the project root). */
    series_bible: z.string().optional(),
    created: z.string().optional(),
  })
  .loose();
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ---------------------------------------------------------------------------
// Bible entries (front matter of bible/<kind>s/<slug>.md)
// ---------------------------------------------------------------------------

export const AliasesSchema = z.object({
  ru: z.array(z.string()).default([]),
  en: z.array(z.string()).default([]),
});
export type Aliases = z.infer<typeof AliasesSchema>;

export const EntryFrontMatterSchema = z
  .object({
    name: z.string().min(1),
    aliases: AliasesSchema.prefault({}),
    kind: z.enum(['canon', 'original']).default('original'),
    always_on: z.boolean().default(false),
    pinned: z.boolean().default(false),
    age: z.union([z.string(), z.number()]).optional(),
    first_appears: z.string().optional(),
    tags: z.array(z.string()).default([]),
  })
  .loose();
export type EntryFrontMatter = z.infer<typeof EntryFrontMatterSchema>;

/** Body sections of an entry, in the order of Section 9. Missing sections are allowed. */
export const ENTRY_SECTIONS = [
  'Summary',
  'True now',
  'History',
  'Appearance',
  'Voice',
  'Wants, needs, obstacle',
  'Relationships',
  'Secrets',
  'Sources',
] as const;

export const RelationshipPairSchema = z.object({
  between: z.tuple([z.string(), z.string()]),
  trust: z.string().optional(),
  debts: z.array(z.string()).default([]),
  grudges: z.array(z.string()).default([]),
  history: z.string().optional(),
});

export const RelationshipsFileSchema = z.object({
  pairs: z.array(RelationshipPairSchema).default([]),
});
export type RelationshipsFile = z.infer<typeof RelationshipsFileSchema>;

export const ResearchFrontMatterSchema = z
  .object({
    topic: z.string().min(1),
    sources: z
      .array(
        z.object({
          url: z.string(),
          title: z.string().optional(),
          kind: z.enum(['official', 'wiki', 'analysis', 'fanon', 'other']).default('other'),
          accessed: z.string().optional(),
        }),
      )
      .default([]),
    canon_point: z.string().optional(),
    unconfirmed: z.array(z.string()).default([]),
  })
  .loose();
export type ResearchFrontMatter = z.infer<typeof ResearchFrontMatterSchema>;

// ---------------------------------------------------------------------------
// Chapters (front matter of chapters/NN-<slug>.md)
// ---------------------------------------------------------------------------

export const ChapterStatusSchema = z.enum(['planned', 'draft', 'revised', 'final']);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterFrontMatterSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    status: ChapterStatusSchema.default('draft'),
    words: z.number().int().nonnegative().optional(),
    pov: z.string().optional(),
    in_story_date: z.string().optional(),
  })
  .loose();
export type ChapterFrontMatter = z.infer<typeof ChapterFrontMatterSchema>;

export const SummaryFrontMatterSchema = z.object({
  chapter: z.number().int().positive(),
  source_hash: z.string(),
  generated_at: z.string(),
  model: z.string(),
  words: z.number().int().nonnegative().optional(),
});
export type SummaryFrontMatter = z.infer<typeof SummaryFrontMatterSchema>;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const PlannedChapterSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().default(''),
  slug: z.string().optional(),
  status: ChapterStatusSchema.default('planned'),
  target_words: z.number().int().positive().optional(),
  beats: z.array(z.string()).default([]),
  turning_point: z.string().optional(),
  cliffhanger: z.string().optional(),
});
export type PlannedChapter = z.infer<typeof PlannedChapterSchema>;

export const ChaptersPlanSchema = z.object({
  chapters: z.array(PlannedChapterSchema).default([]),
});
export type ChaptersPlan = z.infer<typeof ChaptersPlanSchema>;

// ---------------------------------------------------------------------------
// Chronicle state (chronicle/state.yaml)
// ---------------------------------------------------------------------------

export const ConditionSchema = z.object({
  wounds: z.array(z.string()).default([]),
  fatigue: z.string().optional(),
  mood: z.string().optional(),
  notes: z.string().optional(),
});

export const KnowledgeFactSchema = z.object({
  id: z.string(),
  fact: z.string(),
  known_by: z.array(z.string()).default([]),
  since_chapter: z.number().int().optional(),
});

export const RelationStateSchema = z.object({
  between: z.tuple([z.string(), z.string()]),
  trust: z.string().optional(),
  promises: z.array(z.string()).default([]),
  debts: z.array(z.string()).default([]),
  grudges: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const ThreadSchema = z.object({
  id: z.string(),
  text: z.string(),
  since_chapter: z.number().int().optional(),
  status: z.enum(['open', 'resolved']).default('open'),
});

export const PlantedGunSchema = z.object({
  id: z.string(),
  what: z.string(),
  planted_in: z.number().int().optional(),
  payoff: z.string().optional(),
  fired_in: z.number().int().optional(),
});

export const ConsequenceSchema = z.object({
  id: z.string(),
  text: z.string(),
  due: z.string().optional(),
  done: z.boolean().default(false),
});

export const RollOutcomeSchema = z.enum(['luck', 'lull', 'trouble', 'catastrophe']);
export type RollOutcome = z.infer<typeof RollOutcomeSchema>;

export const RollSchema = z.object({
  chapter: z.number().int(),
  die: z.literal('d20').default('d20'),
  result: z.number().int().min(1).max(20),
  outcome: RollOutcomeSchema,
  at: z.string().optional(),
  note: z.string().optional(),
});
export type Roll = z.infer<typeof RollSchema>;

export const ChronicleStateSchema = z.object({
  format_version: z.number().int().positive().default(FORMAT_VERSION),
  in_story_time: z.string().default(''),
  last_chapter: z.number().int().nonnegative().default(0),
  locations: z.record(z.string(), z.string()).default({}),
  condition: z.record(z.string(), ConditionSchema).default({}),
  inventory: z.record(z.string(), z.array(z.string())).default({}),
  knowledge: z.array(KnowledgeFactSchema).default([]),
  relations: z.array(RelationStateSchema).default([]),
  open_threads: z.array(ThreadSchema).default([]),
  planted_guns: z.array(PlantedGunSchema).default([]),
  pending_consequences: z.array(ConsequenceSchema).default([]),
  rolls: z.array(RollSchema).default([]),
});
export type ChronicleState = z.infer<typeof ChronicleStateSchema>;

/** One operation of a state diff. Paths are dot-separated keys into `state.yaml`. */
export const StateOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: z.string().min(1), value: z.unknown() }),
  z.object({ op: z.literal('merge'), path: z.string().min(1), value: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('append'), path: z.string().min(1), value: z.unknown() }),
  z.object({
    op: z.literal('remove'),
    path: z.string().min(1),
    where: z.record(z.string(), z.unknown()).optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ op: z.literal('unset'), path: z.string().min(1) }),
]);
export type StateOp = z.infer<typeof StateOpSchema>;

/** What the model proposes after a chapter (contract of `chronicle.propose`). */
export const ChronicleProposalSchema = z.object({
  chapter: z.number().int().positive(),
  /** Reader-safe log entry, 2–4 sentences: what changed, what is ripening, what is open. */
  summary: z.string().min(1),
  /** Planned twists and planted guns; goes to hidden.md, never to reader output. */
  hidden: z.string().optional(),
  in_story_time: z.string().optional(),
  ops: z.array(StateOpSchema).default([]),
});
export type ChronicleProposal = z.infer<typeof ChronicleProposalSchema>;

// ---------------------------------------------------------------------------
// History (history/calls.jsonl, history/suggestions/<id>.md)
// ---------------------------------------------------------------------------

export const CallRecordSchema = z.object({
  id: z.string(),
  ts: z.string(),
  task: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_hash: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative().default(0),
  cache_write_tokens: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().nonnegative(),
  accepted: z.boolean().nullable().default(null),
  suggestion: z.string().optional(),
  replay: z.boolean().default(false),
  note: z.string().optional(),
});
export type CallRecord = z.infer<typeof CallRecordSchema>;

export const SuggestionStatusSchema = z.enum(['pending', 'accepted', 'discarded']);

export const SuggestionFrontMatterSchema = z.object({
  id: z.string(),
  task: z.string(),
  created: z.string(),
  model: z.string(),
  status: SuggestionStatusSchema.default('pending'),
  chapter: z.number().int().positive().optional(),
  /** Chapter title, for suggestions that create a chapter. */
  title: z.string().optional(),
  /** Character offset in the chapter body where the suggestion attaches. */
  anchor: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  call_id: z.string().optional(),
  note: z.string().optional(),
});
export type SuggestionFrontMatter = z.infer<typeof SuggestionFrontMatterSchema>;

// ---------------------------------------------------------------------------
// Style memory (style/lessons.md entries, parsed from Markdown)
// ---------------------------------------------------------------------------

export const LessonCategorySchema = z.enum([
  'dialogue',
  'exposition',
  'cliche',
  'rhythm',
  'labeling',
  'pacing',
  'continuity',
  'voice',
  'sensory',
  'other',
]);
export type LessonCategory = z.infer<typeof LessonCategorySchema>;

export const LessonSchema = z.object({
  id: z.string(),
  date: z.string(),
  category: LessonCategorySchema,
  rule: z.string().min(1),
  provenance: z.string().default(''),
  before: z.string().optional(),
  after: z.string().optional(),
  weight: z.number().int().positive().default(1),
  language: z.enum(['ru', 'en', 'both']).default('both'),
});
export type Lesson = z.infer<typeof LessonSchema>;

// ---------------------------------------------------------------------------
// Canvas (canvas/board.json)
// ---------------------------------------------------------------------------

export const CardKindSchema = z.enum(['idea', 'scene', 'arc', 'twist', 'branch', 'question']);

export const CardSchema = z.object({
  id: z.string(),
  kind: CardKindSchema,
  title: z.string(),
  text: z.string().default(''),
  x: z.number().default(0),
  y: z.number().default(0),
  lane: z.string().optional(),
  links: z.array(z.object({ to: z.string(), label: z.string().optional() })).default([]),
});

export const BoardSchema = z.object({
  format_version: z.number().int().positive().default(FORMAT_VERSION),
  template: z
    .enum(['none', 'three_act', 'heros_journey', 'save_the_cat', 'romancing_the_beat', 'kishotenketsu'])
    .default('none'),
  cards: z.array(CardSchema).default([]),
});
export type Board = z.infer<typeof BoardSchema>;

// ---------------------------------------------------------------------------
// Model output contracts (Section 10.5)
// ---------------------------------------------------------------------------

export const CriticScoresSchema = z.object({
  voice: z.number().int().min(1).max(5),
  subtext: z.number().int().min(1).max(5),
  rhythm: z.number().int().min(1).max(5),
  cliche: z.number().int().min(1).max(5),
  ai_tell: z.number().int().min(1).max(5),
  continuity: z.number().int().min(1).max(5),
  language: z.number().int().min(1).max(5),
});

export const CriticQuoteSchema = z.object({
  quote: z.string().min(1),
  issue: z.string().min(1),
  category: LessonCategorySchema.default('other'),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const CriticResultSchema = z.object({
  scores: CriticScoresSchema,
  quotes: z.array(CriticQuoteSchema).default([]),
  verdict: z.enum(['pass', 'revise', 'reject']),
  notes: z.string().optional(),
});
export type CriticResult = z.infer<typeof CriticResultSchema>;

export const BibleProposalSchema = z.object({
  kind: z.enum(['character', 'location', 'faction', 'item', 'world_rule', 'glossary', 'timeline']),
  slug: z.string().min(1),
  action: z.enum(['create', 'update']),
  name: z.string().optional(),
  summary: z.string().optional(),
  /** Markdown describing the new or changed sections. */
  diff: z.string().min(1),
  reason: z.string().optional(),
});

export const BibleProposalsSchema = z.object({
  proposals: z.array(BibleProposalSchema).default([]),
});
export type BibleProposals = z.infer<typeof BibleProposalsSchema>;

/** One line per chapter, without the main twist (Section 5.6). */
export const OutlineSchema = z.object({
  chapters: z
    .array(
      z.object({
        number: z.number().int().positive(),
        title: z.string().min(1),
        line: z.string().min(1),
      }),
    )
    .min(1),
});
export type Outline = z.infer<typeof OutlineSchema>;

/** State of an autonomous run (history/runs/<id>.json), enough to resume after a crash. */
export const RunStateSchema = z.object({
  id: z.string(),
  started_at: z.string(),
  updated_at: z.string(),
  status: z.enum(['running', 'awaiting_outline_approval', 'paused', 'completed', 'failed']),
  target_chapters: z.number().int().positive(),
  next_chapter: z.number().int().positive(),
  stage: z.enum(['outline', 'plan', 'write', 'chronicle', 'summary', 'report', 'done']),
  completed: z.array(z.number().int()).default([]),
  cost_usd: z.number().nonnegative().default(0),
  outline_approved: z.boolean().default(false),
  pending_suggestion: z.string().optional(),
  error: z.string().optional(),
  log: z.array(z.string()).default([]),
});
export type RunState = z.infer<typeof RunStateSchema>;

export const BeatSheetSchema = z.object({
  chapter: z.number().int().positive(),
  title: z.string().min(1),
  goal: z.string().min(1),
  beats: z.array(z.string().min(1)).min(3),
  breather_scene: z.string().min(1),
  ending_image: z.string().min(1),
  world_tick: z.array(z.string()).default([]),
  guns: z.array(z.string()).default([]),
  cliffhanger: z.string().optional(),
});
export type BeatSheet = z.infer<typeof BeatSheetSchema>;

export const DescribeOptionsSchema = z.object({
  options: z
    .array(
      z.object({
        sense: z.enum(['sound', 'smell', 'touch', 'temperature', 'light', 'taste', 'object', 'body']),
        text: z.string().min(1),
      }),
    )
    .min(1),
});
export type DescribeOptions = z.infer<typeof DescribeOptionsSchema>;

export const DirectionsSchema = z.object({
  options: z
    .array(
      z.object({
        title: z.string().min(1),
        text: z.string().min(1),
        obvious: z.boolean().default(false),
        recommended: z.boolean().default(false),
      }),
    )
    .min(1),
});
export type Directions = z.infer<typeof DirectionsSchema>;

export const LessonProposalSchema = z.object({
  category: LessonCategorySchema,
  rule: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
  language: z.enum(['ru', 'en', 'both']).default('both'),
});
export type LessonProposal = z.infer<typeof LessonProposalSchema>;

// ---------------------------------------------------------------------------
// User-level config (~/.apex-galaxia/config.yaml)
// ---------------------------------------------------------------------------

export const UserConfigSchema = z
  .object({
    /** Interface language; when unset, clients follow the project's story language. */
    ui_language: LanguageSchema.optional(),
    provider: z.enum(['anthropic', 'openai-compatible', 'ollama']).default('anthropic'),
    base_url: z.string().optional(),
    models: ModelRolesSchema.partial().default({}),
    budget: BudgetSchema.partial().default({}),
    research_provider: z.enum(['none', 'claude-web']).default('none'),
  })
  .loose();
export type UserConfig = z.infer<typeof UserConfigSchema>;

/** Registry used by the schema export script. Keys become file names. */
export const SCHEMA_REGISTRY = {
  'project.yaml': ProjectConfigSchema,
  'bible-entry.frontmatter': EntryFrontMatterSchema,
  'bible-relationships.yaml': RelationshipsFileSchema,
  'bible-research.frontmatter': ResearchFrontMatterSchema,
  'chapter.frontmatter': ChapterFrontMatterSchema,
  'summary.frontmatter': SummaryFrontMatterSchema,
  'plan-chapters.yaml': ChaptersPlanSchema,
  'chronicle-state.yaml': ChronicleStateSchema,
  'chronicle-proposal': ChronicleProposalSchema,
  'history-call': CallRecordSchema,
  'suggestion.frontmatter': SuggestionFrontMatterSchema,
  'lesson': LessonSchema,
  'canvas-board.json': BoardSchema,
  'critic-result': CriticResultSchema,
  'bible-proposals': BibleProposalsSchema,
  'beat-sheet': BeatSheetSchema,
  'outline': OutlineSchema,
  'run-state': RunStateSchema,
  'describe-options': DescribeOptionsSchema,
  'directions': DirectionsSchema,
  'lesson-proposal': LessonProposalSchema,
  'user-config.yaml': UserConfigSchema,
} as const;

export type SchemaName = keyof typeof SCHEMA_REGISTRY;

export function schemaByName(name: string): z.ZodType | undefined {
  return (SCHEMA_REGISTRY as Record<string, z.ZodType>)[name];
}
