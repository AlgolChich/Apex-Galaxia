import { McpConnection, payload, resultText, type CallOptions } from './mcp.js';
import type { Transport } from './transport.js';
import type {
  BeatSheet,
  BibleEntryFull,
  BibleEntrySummary,
  ChapterFront,
  ChapterFull,
  ChapterStatus,
  ChapterSummary,
  ChronicleProposal,
  ChronicleState,
  CriticResult,
  DescribeOption,
  DiffBlock,
  Direction,
  EntryKind,
  Estimate,
  InspectorRecord,
  Language,
  Lesson,
  LessonProposal,
  LintReport,
  ModelStatus,
  NarratorOptions,
  PlanFiles,
  PlannedChapter,
  PreparedTask,
  ProjectConfig,
  ProjectCreateOptions,
  ProjectOpened,
  RewriteResult,
  Roll,
  RunEvent,
  RunState,
  SubmitResult,
  SuggestionFront,
  UserConfig,
  WriteResult,
} from './types.js';

export type StreamHandler = (delta: string) => void;

function streaming(onDelta: StreamHandler | undefined, options: CallOptions = {}): CallOptions {
  if (!onDelta) return options;
  return {
    ...options,
    onProgress: (event) => {
      if (event.message) onDelta(event.message);
      options.onProgress?.(event);
    },
  };
}

/**
 * Typed wrappers over the MCP tools the app uses. One method per tool; names follow the
 * server (`packages/mcp-server/src/server.ts`, `app-tools.ts`). Results are the tools'
 * structured payloads. Model-backed calls that stream take an `onDelta`.
 */
export class ApexClient {
  readonly connection: McpConnection;

  constructor(transport: Transport) {
    this.connection = new McpConnection(transport);
  }

  get transport(): Transport {
    return this.connection.transport;
  }

  connect(): Promise<void> {
    return this.connection.connect();
  }

  private async call<T>(name: string, args: Record<string, unknown> = {}, options?: CallOptions): Promise<T> {
    return payload<T>(await this.connection.callTool(name, args, options));
  }

  // ---- Project -----------------------------------------------------------------------
  modelStatus(): Promise<ModelStatus> {
    return this.call('model_status');
  }

  projectOpen(path: string): Promise<ProjectOpened> {
    return this.call('project_open', { path });
  }

  projectCreate(options: ProjectCreateOptions): Promise<{ root: string; config: ProjectConfig }> {
    return this.call('project_create', { ...options });
  }

  projectChapters(): Promise<{ chapters: ChapterSummary[] }> {
    return this.call('project_chapters');
  }

  projectSettingsUpdate(settings: Partial<ProjectConfig>): Promise<{ config: ProjectConfig }> {
    return this.call('project_settings_update', { settings });
  }

  userConfigGet(): Promise<{ config: UserConfig; file: string }> {
    return this.call('user_config_get');
  }

  userConfigSet(settings: Partial<UserConfig>): Promise<{ config: UserConfig; file: string }> {
    return this.call('user_config_set', { settings });
  }

  // ---- Chapters ----------------------------------------------------------------------
  chapterGet(chapter: number | string): Promise<ChapterFull> {
    return this.call('chapter_get', { chapter });
  }

  chapterSave(chapter: number | string, body: string, front: { title?: string; status?: ChapterStatus; in_story_date?: string } = {}): Promise<{ front: ChapterFront; stem: string; path: string }> {
    return this.call('chapter_save', { chapter, body, ...front });
  }

  chapterCreate(title: string, options: { number?: number; body?: string } = {}): Promise<{ front: ChapterFront; stem: string; path: string }> {
    return this.call('chapter_create', { title, ...options });
  }

  // ---- Bible -------------------------------------------------------------------------
  bibleList(kind?: EntryKind): Promise<{ entries: BibleEntrySummary[] }> {
    return this.call('bible_list', kind ? { kind } : {});
  }

  bibleSearch(query: string): Promise<{ entries: BibleEntrySummary[] }> {
    return this.call('bible_search', { query });
  }

  bibleGet(kind: EntryKind, slug: string): Promise<BibleEntryFull> {
    return this.call('bible_get', { kind, slug });
  }

  bibleUpsert(input: { kind: EntryKind; name: string; slug?: string; aliases_ru?: string[]; aliases_en?: string[]; always_on?: boolean; canon?: boolean; body?: string }): Promise<{ kind: EntryKind; slug: string; path: string }> {
    return this.call('bible_upsert', { ...input });
  }

  bibleRemove(kind: EntryKind, slug: string): Promise<{ kind: EntryKind; slug: string; trashed: string }> {
    return this.call('bible_remove', { kind, slug });
  }

  bibleExtract(chapter: number): Promise<{ proposals: unknown[] }> {
    return this.call('bible_extract', { chapter });
  }

  checkBible(chapter: number): Promise<CriticResult> {
    return this.call('check_bible', { chapter });
  }

  // ---- Chronicle ---------------------------------------------------------------------
  chronicleGet(full = false): Promise<{ state: ChronicleState; log: string; handover?: string; hidden?: string }> {
    return this.call('chronicle_get', { full });
  }

  chroniclePropose(chapter: number): Promise<{ proposal: ChronicleProposal; described: string[] }> {
    return this.call('chronicle_propose', { chapter });
  }

  chronicleApply(proposal: ChronicleProposal, by: 'author' | 'auto' = 'author'): Promise<{ applied: string[]; last_chapter: number }> {
    return this.call('chronicle_apply', { proposal: { ...proposal }, by });
  }

  summarizeChapter(chapter: number): Promise<{ file: string; summary?: string }> {
    return this.call('summarize_chapter', { chapter });
  }

  // ---- Writing -----------------------------------------------------------------------
  writeContinue(params: { chapter?: number; instruction?: string; target_words?: number; cursor?: number; pins?: string[] }, onDelta?: StreamHandler, options?: CallOptions): Promise<WriteResult> {
    return this.call('write_continue', { ...params }, streaming(onDelta, options));
  }

  writeChapter(params: { chapter_number?: number; title?: string; target_words?: number }, onDelta?: StreamHandler, options?: CallOptions): Promise<WriteResult> {
    return this.call('write_chapter', { ...params }, streaming(onDelta, options));
  }

  planChapter(chapter_number: number, options: { title?: string; hint?: string } = {}): Promise<{ sheet: BeatSheet; roll: Roll | null }> {
    return this.call('plan_chapter', { chapter_number, ...options });
  }

  suggestionGet(id: string): Promise<{ front: SuggestionFront; body: string }> {
    return this.call('suggestion_get', { id });
  }

  suggestionsList(all = false): Promise<{ suggestions: SuggestionFront[] }> {
    return this.call('suggestions_list', { all });
  }

  suggestionAccept(id: string, editedText?: string): Promise<{ chapter: ChapterFront; path: string; stem: string }> {
    return this.call('suggestion_accept', { id, ...(editedText !== undefined ? { edited_text: editedText } : {}) });
  }

  suggestionDiscard(id: string): Promise<{ id: string; status: 'discarded' }> {
    return this.call('suggestion_discard', { id });
  }

  // ---- Prepare / submit (the app can act as the model too) ----------------------------
  taskPrepare(task: string, params: Record<string, unknown> = {}): Promise<PreparedTask> {
    return this.call('task_prepare', { task, ...params });
  }

  taskSubmit(handle: string, output: string): Promise<SubmitResult> {
    return this.call('task_submit', { handle, output });
  }

  // ---- Quality -----------------------------------------------------------------------
  lint(input: { text?: string; chapter?: number; file?: string; language?: Language }): Promise<LintReport> {
    return this.call('lint', { ...input });
  }

  criticReview(input: { chapter?: number; passage?: string }): Promise<CriticResult> {
    return this.call('critic_review', { ...input });
  }

  inspect(task?: string, chapter?: number): Promise<{ inspector: InspectorRecord; estimate: Estimate }> {
    return this.call('inspect', { ...(task ? { task } : {}), ...(chapter !== undefined ? { chapter } : {}) });
  }

  // ---- Craft -------------------------------------------------------------------------
  describe(selection: string, options: { surrounding?: string; count?: number; intensity?: 'low' | 'medium' | 'high'; perceiver?: string; avoid?: string[] } = {}): Promise<{ options: DescribeOption[] }> {
    return this.call('describe', { selection, ...options });
  }

  rewrite(op: string, passage: string, vars: { percent?: string; tone?: string; instruction?: string; viewpoint?: string; pov?: string; tense?: string } = {}): Promise<RewriteResult> {
    return this.call('rewrite', { op, passage, ...vars });
  }

  weave(paragraph: string, detail: string): Promise<{ text: string; diff: DiffBlock[]; lint: LintReport }> {
    return this.call('weave', { paragraph, detail });
  }

  canvasDirections(options: { count?: number; focus?: string; twist?: boolean } = {}): Promise<{ options: Direction[] }> {
    return this.call('canvas_directions', { ...options });
  }

  lessonsPropose(before: string, after: string, note?: string): Promise<LessonProposal> {
    return this.call('lessons_propose', { before, after, ...(note ? { note } : {}) });
  }

  lessonsAdd(lesson: { category: string; rule: string; provenance: string; before?: string; after?: string; language?: 'ru' | 'en' | 'both'; weight?: number }): Promise<{ lesson?: Lesson; duplicate?: string; file?: string }> {
    return this.call('lessons_add', { ...lesson });
  }

  exportBook(format: 'md' | 'docx' | 'epub', options: { out?: string; author?: string } = {}): Promise<{ file: string; words?: number; chapters?: number }> {
    return this.call('export_book', { format, ...options });
  }

  lintWhitelistAdd(phrase: string, note?: string): Promise<{ phrase: string; added: boolean; file: string }> {
    return this.call('lint_whitelist_add', { phrase, ...(note ? { note } : {}) });
  }

  voiceCard(sample: string, save = true): Promise<{ card: string; file: string | null; costUsd: number; model: string }> {
    return this.call('voice_card', { sample, save });
  }

  narratorOptions(narrator?: string): Promise<NarratorOptions> {
    return this.call('narrator_options', narrator ? { narrator } : {});
  }

  // ---- Plan and runs -----------------------------------------------------------------
  planGet(): Promise<PlanFiles> {
    return this.call('plan_get');
  }

  planSave(input: { outline?: string; chapters?: { chapters: PlannedChapter[] } }): Promise<{ outline: boolean; chapters: { chapters: PlannedChapter[] } | null }> {
    return this.call('plan_save', { ...input });
  }

  runStart(options: { chapters?: number; resume?: string; approve_outline?: boolean; reader_report?: boolean } = {}): Promise<{ id: string; state: RunState }> {
    return this.call('run_start', { ...options });
  }

  runPause(id: string): Promise<{ id: string; status: 'pausing' }> {
    return this.call('run_pause', { id });
  }

  runGet(id: string): Promise<{ state: RunState; live: boolean }> {
    return this.call('run_get', { id });
  }

  runList(): Promise<{ runs: RunState[] }> {
    return this.call('run_list');
  }

  /** Live events of background runs (`notifications/message` with logger `apex.run`). */
  onRunEvent(handler: (event: RunEvent) => void): () => void {
    return this.connection.onNotification('notifications/message', (params) => {
      const p = params as { logger?: string; data?: unknown };
      if (p.logger === 'apex.run' && p.data && typeof p.data === 'object') handler(p.data as RunEvent);
    });
  }

  /** The sidecar restarted or died; callers reload what they showed. */
  onReset(handler: () => void): () => void {
    return this.connection.onNotification('apex://reset', () => handler());
  }

  /** Raw text of a tool result, for tools that return Markdown (handover, reports). */
  async callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    return resultText(await this.connection.callTool(name, args));
  }
}
