import path from 'node:path';
import { z } from 'zod';
import { ApexError } from '../util/errors.js';
import { countWords, isoNow, sha256, shortId } from '../util/fs.js';
import { CachedTokenCounter, HeuristicTokenCounter, type TokenCounter } from '../context/tokens.js';
import { assemblePrompt, chapterHeading, type AssembleRequest, type AssembledPrompt } from '../context/assembler.js';
import { loadBible, renderEntry, type BibleSnapshot } from '../bible/entries.js';
import { Chronicle } from '../chronicle/chronicle.js';
import { renderStateYaml } from '../chronicle/chronicle.js';
import { rollD20, type Rng } from '../narrator/dice.js';
import { loadNarrator, lengthDef, type NarratorProfile } from '../narrator/profile.js';
import { PromptLibrary } from '../prompts/templates.js';
import { ProjectStore, type ChapterFile, type SuggestionFile } from '../project/store.js';
import {
  BeatSheetSchema,
  BibleProposalsSchema,
  ChaptersPlanSchema,
  ChronicleProposalSchema,
  CriticResultSchema,
  DescribeOptionsSchema,
  DirectionsSchema,
  LessonProposalSchema,
  SummaryFrontMatterSchema,
  schemaByName,
  type BeatSheet,
  type BibleProposals,
  type ChronicleProposal,
  type CriticResult,
  type DescribeOptions,
  type Directions,
  type LessonProposal,
  type Roll,
} from '../project/schemas.js';
import { resolveResources, type Resources } from '../resources.js';
import { loadStyleMemory, type StyleMemory } from '../style/memory.js';
import { ModelRegistry } from '../adapters/models.js';
import { generateLogged, type LoggedResult } from '../adapters/logged.js';
import { estimateCost, type GenerateOptions, type ModelAdapter } from '../adapters/types.js';
import { formatLintReport, lintText, normalizeRussianDialogue, type LintReport } from '../lint/index.js';
import { enforceJsonContract, enforceProseContract } from './contracts.js';
import { diffParagraphs, type DiffBlock } from './diff.js';

export interface HarnessOptions {
  adapter: ModelAdapter;
  resources?: Resources;
  counter?: TokenCounter;
  registry?: ModelRegistry;
  /** Deterministic dice for tests and reproducible runs. */
  rng?: Rng;
}

export interface TaskRun<T = unknown> {
  assembled: AssembledPrompt;
  result: LoggedResult;
  /** Contract-enforced prose (for prose tasks). */
  text: string;
  /** Validated JSON (for json tasks). */
  json: T | undefined;
  violations: string[];
  retried: boolean;
  warnings: string[];
}

export type WriteMode = 'continue' | 'guided' | 'scene' | 'chapter';

export interface WriteParams {
  chapter?: ChapterFile;
  cursor?: number;
  targetWords?: number;
  instruction?: string;
  sceneCard?: string;
  chapterNumber?: number;
  title?: string;
  beatSheet?: BeatSheet;
  pins?: string[];
  onDelta?: (text: string) => void;
}

export interface WriteOutcome {
  mode: WriteMode;
  suggestion: SuggestionFile;
  text: string;
  lint: LintReport;
  run: TaskRun;
  costUsd: number;
  model: string;
}

export interface Estimate {
  model: string;
  inputTokens: number;
  expectedOutputTokens: number;
  costUsd: number;
  exact: boolean;
}

/** Everything a client needs to run a task with its own model and hand the output back. */
export interface Prepared {
  handle: string;
  task: string;
  request: AssembleRequest;
  assembled: AssembledPrompt;
  estimate: Estimate;
  expectHeading?: { number: number; title: string };
  chapterNumber?: number;
  title?: string;
  chapterStem?: string;
  cursor?: number;
  roll?: Roll;
}

export interface PrepareParams extends WriteParams {
  /** Task name; write modes are `write.continue` etc. */
  vars?: Record<string, string>;
  selection?: string;
  plannerView?: boolean;
  hint?: string;
}

export interface SubmitResult {
  task: string;
  text: string;
  json: unknown;
  violations: string[];
  /** For write tasks: the suggestion and its lint report. */
  suggestion?: SuggestionFile;
  lint?: LintReport;
  diff?: DiffBlock[];
  /** Task-specific outcome (beat sheet, proposal preview, summary file, …). */
  outcome?: unknown;
  callId: string;
}

const OUTPUT_TOKENS: Record<string, number> = {
  prose: 6_000,
  planning: 4_000,
  critique: 3_000,
  extraction: 3_000,
  summary: 800,
  lint: 4_000,
};

export function renderBeatSheet(sheet: BeatSheet): string {
  const lines = [`Title: ${sheet.title}`, `Goal: ${sheet.goal}`, ...sheet.beats.map((b, i) => `${i + 1}. ${b}`), `Breather scene: ${sheet.breather_scene}`];
  if (sheet.world_tick.length > 0) lines.push(`World tick (offstage, only where noticed): ${sheet.world_tick.join('; ')}`);
  if (sheet.guns.length > 0) lines.push(`Guns: ${sheet.guns.join('; ')}`);
  lines.push(`Ending image: ${sheet.ending_image}`);
  if (sheet.cliffhanger) lines.push(`Cliffhanger: ${sheet.cliffhanger}`);
  return lines.join('\n');
}

/**
 * The harness: one object that holds a project, its narrator, style memory, Bible, chronicle,
 * prompt library and model adapter, and runs every task through the same pipeline:
 * assemble → estimate and budget check → generate (logged) → output contract → lint.
 * Nothing here rewrites a chapter; prose comes back as a suggestion the client accepts.
 */
export class Harness {
  readonly chronicle: Chronicle;
  readonly library: PromptLibrary;
  readonly registry: ModelRegistry;
  readonly counter: TokenCounter;
  private readonly rng: Rng | undefined;

  private constructor(
    readonly store: ProjectStore,
    readonly resources: Resources,
    readonly adapter: ModelAdapter,
    public narrator: NarratorProfile,
    public style: StyleMemory,
    public bible: BibleSnapshot,
    options: HarnessOptions,
  ) {
    this.chronicle = new Chronicle(store);
    this.library = new PromptLibrary(resources);
    this.registry = options.registry ?? new ModelRegistry();
    this.rng = options.rng;
    if (options.counter) {
      this.counter = options.counter;
    } else if (adapter.exactTokenCounts) {
      const model = store.config.models.prose;
      this.counter = new CachedTokenCounter({ exact: true, count: (text) => adapter.countTokens({ model, text }) });
    } else {
      this.counter = new HeuristicTokenCounter();
    }
  }

  static async open(root: string, options: HarnessOptions): Promise<Harness> {
    const store = await ProjectStore.open(root);
    const resources = options.resources ?? (await resolveResources());
    const narrator = await loadNarrator(resources, store.config.narrator);
    const style = await loadStyleMemory(store, resources);
    const bible = await loadBible(store);
    return new Harness(store, resources, options.adapter, narrator, style, bible, options);
  }

  /** Reload Bible and style memory after files changed on disk. */
  async refresh(): Promise<void> {
    this.style = await loadStyleMemory(this.store, this.resources);
    this.bible = await loadBible(this.store);
  }

  get language() {
    return this.store.config.language;
  }

  async assemble(request: AssembleRequest): Promise<AssembledPrompt> {
    return assemblePrompt(
      {
        store: this.store,
        narrator: this.narrator,
        style: this.style,
        bible: this.bible,
        state: await this.chronicle.readState(),
        library: this.library,
        counter: this.counter,
      },
      request,
    );
  }

  /** Tokens and cost before any model call (Section 8.7). */
  estimateFor(assembled: AssembledPrompt, maxTokens?: number): Estimate {
    const expectedOutputTokens = maxTokens ?? OUTPUT_TOKENS[assembled.kind] ?? 2_000;
    const info = this.registry.get(assembled.model);
    const costUsd = estimateCost(info, {
      inputTokens: assembled.inspector.totalTokens,
      outputTokens: expectedOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    return { model: assembled.model, inputTokens: assembled.inspector.totalTokens, expectedOutputTokens, costUsd, exact: assembled.inspector.exactCounts };
  }

  async estimate(request: AssembleRequest, maxTokens?: number): Promise<Estimate> {
    return this.estimateFor(await this.assemble(request), maxTokens);
  }

  /** Hard stop at the project budget (Section 5.9, 8.7). */
  async checkBudget(nextCostUsd: number): Promise<{ spent: number; cap: number | null; warning?: string }> {
    const cap = this.store.config.budget.project_usd;
    const warnAt = this.store.config.budget.warn_at_usd;
    const spent = await this.store.spentUsd();
    if (cap !== null && spent + nextCostUsd > cap) {
      throw new ApexError('BUDGET_EXCEEDED', `Project budget reached: spent $${spent.toFixed(2)} of $${cap.toFixed(2)}; this call would add about $${nextCostUsd.toFixed(3)}`, { spent, cap, next: nextCostUsd });
    }
    const out: { spent: number; cap: number | null; warning?: string } = { spent, cap };
    if (warnAt !== null && spent + nextCostUsd > warnAt) {
      out.warning = `Spend is past the warning mark: $${(spent + nextCostUsd).toFixed(2)} of $${warnAt.toFixed(2)}`;
    }
    return out;
  }

  /**
   * Run one task: assemble, check the budget, generate with the log, enforce the output
   * contract, retry once with the validation error appended (Section 10.5).
   */
  async runTask<T = unknown>(
    request: AssembleRequest,
    options: { maxTokens?: number; onDelta?: (text: string) => void; expectHeading?: { number: number; title: string }; fallbacks?: boolean } = {},
  ): Promise<TaskRun<T>> {
    const assembled = await this.assemble(request);
    const estimate = this.estimateFor(assembled, options.maxTokens);
    const budget = await this.checkBudget(estimate.costUsd);
    const warnings: string[] = budget.warning ? [budget.warning] : [];
    const schemaName = assembled.jsonSchemaName;
    const zodSchema = schemaName ? schemaByName(schemaName) : undefined;
    const jsonSchema = zodSchema ? (z.toJSONSchema(zodSchema, { target: 'draft-2020-12' }) as Record<string, unknown>) : undefined;

    const base: GenerateOptions = {
      model: assembled.model,
      system: assembled.system,
      messages: assembled.messages,
      task: request.task,
      kind: assembled.kind,
      maxTokens: options.maxTokens ?? OUTPUT_TOKENS[assembled.kind] ?? 4_000,
      stopSequences: assembled.stopSequences,
      ...(jsonSchema && schemaName ? { jsonSchema, jsonSchemaName: schemaName } : {}),
      ...(options.onDelta ? { onDelta: options.onDelta } : {}),
      ...(options.fallbacks !== undefined ? { fallbacks: options.fallbacks } : {}),
    };

    let result = await generateLogged(this.adapter, this.store, base);
    let retried = false;
    const check = (r: LoggedResult) => {
      if (schemaName) {
        const c = enforceJsonContract<T>(r.json ?? r.text, schemaName);
        return { text: r.text, json: c.value, violations: c.violations };
      }
      const heading = options.expectHeading ? { language: this.language, number: options.expectHeading.number, title: options.expectHeading.title } : undefined;
      const c = enforceProseContract(r.text, heading ? { heading } : {});
      return { text: c.value, json: undefined as T | undefined, violations: c.violations };
    };

    if (result.stopReason === 'refusal') {
      warnings.push(`The model declined this request${result.refusal?.category ? ` (${result.refusal.category})` : ''}. Soften the scene (a fade, an ellipsis, a transition) or adjust the brief; the story is not broken.`);
      return { assembled, result, text: '', json: undefined, violations: ['refusal'], retried, warnings };
    }

    let checked = check(result);
    if (checked.violations.length > 0) {
      retried = true;
      const retry: GenerateOptions = {
        ...base,
        messages: [
          ...assembled.messages,
          { role: 'assistant', content: result.text || '(empty)' },
          {
            role: 'user',
            content: `Your response violated the output contract:\n- ${checked.violations.join('\n- ')}\nReturn the corrected output only, following the contract exactly.`,
          },
        ],
      };
      result = await generateLogged(this.adapter, this.store, retry);
      checked = check(result);
      if (checked.violations.length > 0) {
        warnings.push(`Output contract still violated after one retry: ${checked.violations.join('; ')}`);
      }
    }
    return { assembled, result, text: checked.text, json: checked.json, violations: checked.violations, retried, warnings };
  }

  lint(text: string): LintReport {
    const c = this.store.config;
    return lintText(text, {
      language: c.language,
      banned: this.style.banned,
      whitelist: this.style.whitelist,
      yoPolicy: c.yo_policy,
      spelling: c.spelling,
    });
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /** Stored beat sheet for a chapter, if the planner wrote one. */
  async readBeatSheet(number: number): Promise<BeatSheet | undefined> {
    const text = await this.store.readText(path.join(this.store.layout.plan.beats, `${String(number).padStart(2, '0')}.json`));
    if (!text) return undefined;
    const parsed = BeatSheetSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  }

  /** Build the request for a write mode; shared by the API path and the prepare/submit path. */
  private async prepareWrite(mode: WriteMode, params: WriteParams, planIfMissing: boolean): Promise<Omit<Prepared, 'handle' | 'assembled' | 'estimate'>> {
    const chapters = await this.store.listChapters();
    const chapter = params.chapter ?? (mode === 'chapter' ? undefined : chapters[chapters.length - 1]);
    const targetWords = params.targetWords ?? (mode === 'chapter' ? this.defaultChapterWords() : 300);
    const vars: Record<string, string> = { target_words: String(targetWords) };
    const request: AssembleRequest = { task: `write.${mode}`, vars };
    if (chapter) request.chapter = chapter;
    if (params.cursor !== undefined) request.cursor = params.cursor;
    if (params.pins) request.pins = params.pins;
    const out: Omit<Prepared, 'handle' | 'assembled' | 'estimate'> = { task: `write.${mode}`, request };
    if (chapter) {
      out.chapterNumber = chapter.front.number;
      out.title = chapter.front.title;
      out.chapterStem = chapter.stem;
      out.cursor = params.cursor ?? chapter.body.length;
    }

    if (mode === 'guided') {
      if (!params.instruction) throw new ApexError('INVALID_ARGUMENT', 'Guided continue needs an instruction');
      vars['instruction'] = params.instruction;
    }
    if (mode === 'scene') {
      if (!params.sceneCard) throw new ApexError('INVALID_ARGUMENT', 'Scene mode needs a scene card');
      vars['scene_card'] = params.sceneCard;
    }
    if (mode === 'chapter') {
      const chapterNumber = params.chapterNumber ?? (chapters[chapters.length - 1]?.front.number ?? 0) + 1;
      let sheet = params.beatSheet ?? (await this.readBeatSheet(chapterNumber));
      if (!sheet) {
        if (!planIfMissing) {
          throw new ApexError('INVALID_ARGUMENT', `Chapter ${chapterNumber} has no beat sheet yet; prepare and submit plan.chapter first`, { chapterNumber });
        }
        sheet = (await this.planChapter(chapterNumber, params.title ? { title: params.title } : {})).sheet;
      }
      const title = params.title ?? sheet.title;
      vars['chapter_number'] = String(chapterNumber);
      vars['beat_sheet'] = renderBeatSheet(sheet);
      vars['heading'] = chapterHeading(this.language, chapterNumber, title);
      vars['chapter_title'] = title;
      request.unlockSecretsFor = sheet.guns.filter((g) => g.startsWith('fires:')).map((g) => g.slice(6).trim());
      out.expectHeading = { number: chapterNumber, title };
      out.chapterNumber = chapterNumber;
      out.title = title;
    }
    return out;
  }

  /** Russian prose passes the punctuation normalizer before it is shown (Section 4.1). */
  private normalize(text: string): { text: string; changes: string[] } {
    if (this.language !== 'ru') return { text, changes: [] };
    return normalizeRussianDialogue(text);
  }

  private async finishWrite(prepared: Omit<Prepared, 'handle' | 'assembled' | 'estimate'>, raw: string, meta: { model: string; callId: string; costUsd: number; warnings: string[] }): Promise<{ suggestion: SuggestionFile; lint: LintReport; text: string }> {
    const { text, changes } = this.normalize(raw);
    const lint = this.lint(text);
    const notes = [...meta.warnings, ...(changes.length > 0 ? [`punctuation normalized: ${changes.join('; ')}`] : [])];
    const suggestion = await this.store.writeSuggestion(
      {
        task: prepared.task,
        model: meta.model,
        call_id: meta.callId,
        cost_usd: meta.costUsd,
        ...(prepared.chapterNumber !== undefined ? { chapter: prepared.chapterNumber } : {}),
        ...(prepared.title !== undefined ? { title: prepared.title } : {}),
        ...(prepared.cursor !== undefined && prepared.task !== 'write.chapter' ? { anchor: prepared.cursor } : {}),
        ...(notes.length > 0 ? { note: notes.join(' | ') } : {}),
      },
      text,
    );
    return { suggestion, lint, text };
  }

  async write(mode: WriteMode, params: WriteParams = {}): Promise<WriteOutcome> {
    const prepared = await this.prepareWrite(mode, params, true);
    const run = await this.runTask(prepared.request, {
      ...(params.onDelta ? { onDelta: params.onDelta } : {}),
      ...(prepared.expectHeading ? { expectHeading: prepared.expectHeading } : {}),
      maxTokens: mode === 'chapter' ? 8_000 : 4_000,
    });
    const { suggestion, lint, text } = await this.finishWrite(prepared, run.text, { model: run.result.model, callId: run.result.callId, costUsd: run.result.costUsd, warnings: run.warnings });
    return { mode, suggestion, text, lint, run, costUsd: run.result.costUsd, model: run.result.model };
  }

  // -------------------------------------------------------------------------
  // Prepare / submit: the client's own model does the generation
  // -------------------------------------------------------------------------

  /**
   * Assemble the prompt for any task so a client (Claude Code in headless mode) can generate
   * the output itself. For `plan.chapter` with Randy the d20 is rolled here and logged.
   */
  async prepare(task: string, params: PrepareParams = {}): Promise<Prepared> {
    const handle = shortId('prep');
    const vars = { ...(params.vars ?? {}) };
    let base: Omit<Prepared, 'handle' | 'assembled' | 'estimate'>;
    if (task.startsWith('write.')) {
      const mode = task.slice(6) as WriteMode;
      if (!['continue', 'guided', 'scene', 'chapter'].includes(mode)) {
        throw new ApexError('INVALID_ARGUMENT', `Unknown write mode ${mode}`);
      }
      base = await this.prepareWrite(mode, params, false);
      if (params.vars) base.request.vars = { ...(base.request.vars ?? {}), ...params.vars };
    } else if (task === 'plan.chapter') {
      const chapters = await this.store.listChapters();
      const number = params.chapterNumber ?? (chapters[chapters.length - 1]?.front.number ?? 0) + 1;
      let roll: Roll | undefined;
      if (this.store.config.storyteller === 'randy') {
        roll = rollD20(number, this.rng, 'before planning the chapter');
        await this.chronicle.recordRoll(roll);
      }
      const hint = await this.planningHint(number, params.title, params.hint);
      base = {
        task,
        request: { task, plannerView: true, ...(roll ? { latestRoll: roll } : {}), vars: { chapter_number: String(number), chapter_plan_hint: hint, ...vars } },
        chapterNumber: number,
        ...(params.title ? { title: params.title } : {}),
        ...(roll ? { roll } : {}),
      };
    } else {
      const chapter = params.chapter ?? (params.chapterNumber !== undefined ? await this.store.getChapter(params.chapterNumber) : undefined);
      const state = await this.chronicle.readState();
      const defaults: Record<string, string> = {
        chapter_number: chapter ? String(chapter.front.number) : String(params.chapterNumber ?? 0),
        chapter_text: chapter?.body ?? '',
        state_yaml: renderStateYaml(state, { hidden: false }) + (task === 'chronicle.propose' ? renderStateYaml(state, { hidden: true }) : ''),
        passage: params.selection ?? chapter?.body ?? '',
        selection: params.selection ?? '',
        lint_hits: params.selection || chapter ? formatLintReport(this.lint(params.selection ?? chapter?.body ?? '')) : '',
        bible_index: this.bible.entries.map((e) => `- ${e.kind}/${e.slug}: ${e.front.name} — ${e.summary}`).join('\n') || '(empty)',
        bible_full: `${this.bible.worldRules}\n\n${this.bible.timeline}\n\n${this.bible.entries.map((e) => renderEntry(e, { full: true, includeSecrets: true })).join('\n\n')}`,
        existing_lessons: this.style.lessons.map((l) => `- ${l.id} [${l.category}] ${l.rule}`).join('\n') || '(none)',
        count: '3',
        focus: '',
        intensity: 'medium',
        perceiver: 'the viewpoint character',
        avoid: 'none beyond the banned list',
        surrounding: '',
        percent: '20',
        tone: '',
        viewpoint: '',
        instruction: '',
        before: '',
        after: '',
        note: '',
        sample: '',
        findings: '',
        text: chapter?.body ?? params.selection ?? '',
        what: 'ideas',
        request: '',
        topic: '',
        universe: '',
        canon_point: '',
      };
      base = {
        task,
        request: {
          task,
          ...(chapter ? { chapter } : {}),
          ...(params.selection ? { selection: params.selection } : {}),
          ...(params.plannerView || ['canvas.directions', 'twist'].includes(task) ? { plannerView: true } : {}),
          vars: { ...defaults, ...vars },
        },
        ...(chapter ? { chapterNumber: chapter.front.number, chapterStem: chapter.stem } : {}),
      };
    }
    const assembled = await this.assemble(base.request);
    const estimate = this.estimateFor(assembled);
    return { ...base, handle, assembled, estimate };
  }

  private async planningHint(number: number, title?: string, hint?: string): Promise<string> {
    const plan = (await this.store.readYaml(this.store.layout.plan.chapters, ChaptersPlanSchema)) ?? { chapters: [] };
    const planned = plan.chapters.find((c) => c.number === number);
    const outline = (await this.store.readText(this.store.layout.plan.outline)) ?? '';
    const brief = (await this.store.readText(this.store.layout.plan.brief)) ?? '';
    return [
      brief.trim() ? `<brief>\n${brief.trim()}\n</brief>` : '',
      outline.trim() ? `<outline>\n${outline.trim()}\n</outline>` : '',
      planned ? `The outline plans this chapter as: ${planned.title}${planned.beats.length ? `; beats: ${planned.beats.join('; ')}` : ''}${planned.turning_point ? `; turning point: ${planned.turning_point}` : ''}.` : '',
      title ? `The Author set the title: «${title}».` : '',
      hint ?? '',
    ]
      .filter((s) => s.length > 0)
      .join('\n\n');
  }

  private async storeBeatSheet(sheet: BeatSheet): Promise<void> {
    await this.store.writeText(path.join(this.store.layout.plan.beats, `${String(sheet.chapter).padStart(2, '0')}.json`), JSON.stringify(sheet, null, 2) + '\n');
    const plan = (await this.store.readYaml(this.store.layout.plan.chapters, ChaptersPlanSchema)) ?? { chapters: [] };
    const planned = plan.chapters.find((c) => c.number === sheet.chapter);
    const nextPlan = {
      chapters: [
        ...plan.chapters.filter((c) => c.number !== sheet.chapter),
        { ...(planned ?? { number: sheet.chapter, status: 'planned' as const }), number: sheet.chapter, title: sheet.title, beats: sheet.beats, ...(sheet.cliffhanger ? { cliffhanger: sheet.cliffhanger } : {}), target_words: planned?.target_words ?? this.defaultChapterWords() },
      ].sort((a, b) => a.number - b.number),
    };
    await this.store.writeYaml(this.store.layout.plan.chapters, ChaptersPlanSchema, nextPlan);
  }

  /**
   * Take the client's output for a prepared task through the same pipeline a model result
   * goes through: output contract, then the task's finisher (suggestion, beat sheet, preview…).
   * The call is logged with provider `client`, cost zero.
   */
  async submit(prepared: Prepared, output: string, provider = 'client'): Promise<SubmitResult> {
    const schemaName = prepared.assembled.jsonSchemaName;
    const callId = shortId('call');
    await this.store.appendCall({
      id: callId,
      ts: isoNow(),
      task: prepared.task,
      provider,
      model: provider,
      prompt_hash: prepared.assembled.inspector.promptHashHint,
      input_tokens: prepared.assembled.inspector.totalTokens,
      output_tokens: countWords(output),
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0,
      latency_ms: 0,
      accepted: null,
      replay: false,
    });
    let text = output;
    let json: unknown;
    let violations: string[];
    if (schemaName) {
      const c = enforceJsonContract(output, schemaName);
      json = c.value;
      violations = c.violations;
    } else {
      const heading = prepared.expectHeading ? { language: this.language, number: prepared.expectHeading.number, title: prepared.expectHeading.title } : undefined;
      const c = enforceProseContract(output, heading ? { heading } : {});
      text = c.value;
      violations = c.violations;
    }
    const result: SubmitResult = { task: prepared.task, text, json, violations, callId };
    if (violations.length > 0) return result;

    if (prepared.task.startsWith('write.')) {
      const finished = await this.finishWrite(prepared, text, { model: provider, callId, costUsd: 0, warnings: [] });
      result.suggestion = finished.suggestion;
      result.lint = finished.lint;
      result.text = finished.text;
    } else if (prepared.task === 'plan.chapter') {
      const sheet = BeatSheetSchema.parse({ ...(json as object), chapter: prepared.chapterNumber, ...(prepared.title ? { title: prepared.title } : {}) });
      await this.storeBeatSheet(sheet);
      result.outcome = sheet;
    } else if (prepared.task === 'chronicle.propose') {
      const proposal = ChronicleProposalSchema.parse({ ...(json as object), chapter: prepared.chapterNumber });
      result.outcome = await this.chronicle.preview(proposal);
    } else if (prepared.task === 'summary.chapter' && prepared.chapterStem) {
      const chapter = await this.store.getChapter(prepared.chapterStem);
      const file = path.join(this.store.layout.chronicle.summaries, `${chapter.stem}.md`);
      await this.store.writeMarkdown(file, SummaryFrontMatterSchema, { chapter: chapter.front.number, source_hash: sha256(chapter.body), generated_at: isoNow(), model: provider, words: countWords(text) }, text);
      result.outcome = { file };
    } else if (prepared.task.startsWith('rewrite.') || prepared.task === 'revise') {
      const passage = prepared.request.vars?.['passage'] ?? '';
      result.diff = diffParagraphs(passage, text);
      result.lint = this.lint(text);
    } else if (schemaName) {
      result.outcome = json;
    }
    return result;
  }

  /**
   * Accept a suggestion: insert it into its chapter at the anchor, or create the chapter for
   * chapter-mode suggestions. This is the only path by which generated prose reaches a chapter.
   */
  async accept(suggestionId: string): Promise<ChapterFile> {
    const suggestion = await this.store.readSuggestion(suggestionId);
    if (suggestion.front.status !== 'pending') {
      throw new ApexError('INVALID_ARGUMENT', `Suggestion ${suggestionId} is already ${suggestion.front.status}`);
    }
    const chapters = await this.store.listChapters();
    const number = suggestion.front.chapter;
    let chapter = number !== undefined ? chapters.find((c) => c.front.number === number) : undefined;
    let body = suggestion.body.trim();
    if (suggestion.front.task === 'write.chapter') {
      const heading = chapterHeading(this.language, number ?? 0, suggestion.front.title ?? '');
      if (body.toLowerCase().startsWith(heading.toLowerCase())) {
        body = body.slice(heading.length).trim();
      }
    }
    if (chapter) {
      const anchor = Math.min(suggestion.front.anchor ?? chapter.body.length, chapter.body.length);
      const before = chapter.body.slice(0, anchor).replace(/\s+$/u, '');
      const after = chapter.body.slice(anchor).replace(/^\s+/u, '');
      const joined = [before, body, after].filter((s) => s.length > 0).join('\n\n') + '\n';
      chapter = await this.store.saveChapter(chapter, joined, { status: 'draft' });
    } else {
      const n = number ?? (chapters[chapters.length - 1]?.front.number ?? 0) + 1;
      chapter = await this.store.createChapter(n, suggestion.front.title ?? (this.language === 'ru' ? 'Без названия' : 'Untitled'), body + '\n');
    }
    await this.store.setSuggestionStatus(suggestionId, 'accepted');
    return chapter;
  }

  async discard(suggestionId: string): Promise<void> {
    await this.store.setSuggestionStatus(suggestionId, 'discarded');
  }

  // -------------------------------------------------------------------------
  // Planning, chronicle, summaries
  // -------------------------------------------------------------------------

  /** Plan a chapter: roll Randy's die in code when needed, then get a beat sheet. */
  async planChapter(number: number, options: { title?: string; hint?: string } = {}): Promise<{ sheet: BeatSheet; roll?: Roll; run: TaskRun<BeatSheet> }> {
    let roll: Roll | undefined;
    if (this.store.config.storyteller === 'randy') {
      roll = rollD20(number, this.rng, 'before planning the chapter');
      await this.chronicle.recordRoll(roll);
    }
    const hint = await this.planningHint(number, options.title, options.hint);
    const run = await this.runTask<BeatSheet>(
      {
        task: 'plan.chapter',
        plannerView: true,
        ...(roll ? { latestRoll: roll } : {}),
        vars: { chapter_number: String(number), chapter_plan_hint: hint },
      },
      { maxTokens: 4_000 },
    );
    if (!run.json) {
      throw new ApexError('CONTRACT_VIOLATION', `The planner returned no valid beat sheet: ${run.violations.join('; ')}`);
    }
    const sheet = BeatSheetSchema.parse({ ...run.json, chapter: number, ...(options.title ? { title: options.title } : {}) });
    await this.storeBeatSheet(sheet);
    return { sheet, ...(roll ? { roll } : {}), run };
  }

  defaultChapterWords(): number {
    const def = lengthDef(this.narrator, this.store.config.length);
    const chapters = Math.max(1, def.chapters[1]);
    const perChapter = Math.round(def.words[1] / chapters);
    return Math.min(this.narrator.chapterWords.max, Math.max(this.narrator.chapterWords.min, perChapter));
  }

  async proposeChronicle(chapter: ChapterFile): Promise<{ proposal: ChronicleProposal; run: TaskRun<ChronicleProposal> }> {
    const state = await this.chronicle.readState();
    const run = await this.runTask<ChronicleProposal>({
      task: 'chronicle.propose',
      chapter,
      vars: { chapter_number: String(chapter.front.number), chapter_text: chapter.body, state_yaml: renderStateYaml(state, { hidden: false }) + renderStateYaml(state, { hidden: true }) },
    });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid chronicle proposal: ${run.violations.join('; ')}`);
    return { proposal: ChronicleProposalSchema.parse({ ...run.json, chapter: chapter.front.number }), run };
  }

  /** Generate and cache the reader-safe summary of an accepted chapter (Section 10.4). */
  async summarizeChapter(chapter: ChapterFile): Promise<{ summary: string; file: string; run: TaskRun }> {
    const run = await this.runTask({ task: 'summary.chapter', chapter, vars: { chapter_text: chapter.body } }, { maxTokens: 800 });
    const file = path.join(this.store.layout.chronicle.summaries, `${chapter.stem}.md`);
    await this.store.writeMarkdown(
      file,
      SummaryFrontMatterSchema,
      { chapter: chapter.front.number, source_hash: sha256(chapter.body), generated_at: isoNow(), model: run.result.model, words: countWords(run.text) },
      run.text,
    );
    return { summary: run.text, file, run };
  }

  // -------------------------------------------------------------------------
  // Critique, Bible checks and extraction
  // -------------------------------------------------------------------------

  async critique(passage: string, chapter?: ChapterFile): Promise<{ result: CriticResult; run: TaskRun<CriticResult> }> {
    const lint = this.lint(passage);
    const run = await this.runTask<CriticResult>({
      task: 'critic',
      ...(chapter ? { chapter } : {}),
      selection: passage,
      vars: { passage, lint_hits: formatLintReport(lint) },
    });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid critic result: ${run.violations.join('; ')}`);
    return { result: CriticResultSchema.parse(run.json), run };
  }

  async checkBible(chapter: ChapterFile): Promise<{ result: CriticResult; run: TaskRun<CriticResult> }> {
    const state = await this.chronicle.readState();
    const full = this.bible.entries.map((e) => renderEntry(e, { full: true, includeSecrets: true })).join('\n\n');
    const run = await this.runTask<CriticResult>({
      task: 'check.bible',
      chapter,
      vars: { bible_full: `${this.bible.worldRules}\n\n${this.bible.timeline}\n\n${full}`, state_yaml: renderStateYaml(state, { hidden: false }), chapter_text: chapter.body },
    });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid check result: ${run.violations.join('; ')}`);
    return { result: CriticResultSchema.parse(run.json), run };
  }

  async extractBible(chapter: ChapterFile): Promise<{ proposals: BibleProposals; run: TaskRun<BibleProposals> }> {
    const index = this.bible.entries.map((e) => `- ${e.kind}/${e.slug}: ${e.front.name} — ${e.summary}`).join('\n');
    const run = await this.runTask<BibleProposals>({ task: 'extract.bible', chapter, vars: { bible_index: index || '(empty)', chapter_text: chapter.body } });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid extraction: ${run.violations.join('; ')}`);
    return { proposals: BibleProposalsSchema.parse(run.json), run };
  }

  // -------------------------------------------------------------------------
  // Describe, Rewrite, lessons, directions, voice card
  // -------------------------------------------------------------------------

  async describe(selection: string, options: { surrounding?: string; count?: number; intensity?: 'low' | 'medium' | 'high'; perceiver?: string; avoid?: string[]; chapter?: ChapterFile } = {}): Promise<{ options: DescribeOptions; run: TaskRun<DescribeOptions> }> {
    const run = await this.runTask<DescribeOptions>({
      task: 'describe',
      selection,
      ...(options.chapter ? { chapter: options.chapter } : {}),
      vars: {
        selection,
        surrounding: options.surrounding ?? '',
        count: String(options.count ?? 5),
        intensity: options.intensity ?? 'medium',
        perceiver: options.perceiver ?? 'the viewpoint character',
        avoid: (options.avoid ?? []).join(', ') || 'none beyond the banned list',
      },
    });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid describe options: ${run.violations.join('; ')}`);
    return { options: DescribeOptionsSchema.parse(run.json), run };
  }

  async rewrite(op: string, passage: string, vars: Record<string, string> = {}, chapter?: ChapterFile): Promise<{ text: string; diff: DiffBlock[]; lint: LintReport; run: TaskRun }> {
    const lint = this.lint(passage);
    const run = await this.runTask({
      task: `rewrite.${op}`,
      selection: passage,
      ...(chapter ? { chapter } : {}),
      vars: { passage, lint_hits: formatLintReport(lint), percent: '20', tone: '', pov: this.store.config.pov, tense: this.store.config.tense, viewpoint: '', instruction: '', ...vars },
    });
    return { text: run.text, diff: diffParagraphs(passage, run.text), lint: this.lint(run.text), run };
  }

  async lessonFromEdit(before: string, after: string, note = ''): Promise<{ proposal: LessonProposal; run: TaskRun<LessonProposal> }> {
    const existing = this.style.lessons.map((l) => `- ${l.id} [${l.category}] ${l.rule}`).join('\n');
    const run = await this.runTask<LessonProposal>({ task: 'lesson.extract', vars: { before, after, note, existing_lessons: existing || '(none)' } });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid lesson: ${run.violations.join('; ')}`);
    return { proposal: LessonProposalSchema.parse(run.json), run };
  }

  async directions(options: { count?: number; focus?: string; twist?: boolean } = {}): Promise<{ directions: Directions; run: TaskRun<Directions> }> {
    const run = await this.runTask<Directions>({
      task: options.twist ? 'twist' : 'canvas.directions',
      plannerView: true,
      vars: { count: String(options.count ?? 3), focus: options.focus ? `The Author's focus: ${options.focus}` : '' },
    });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid directions: ${run.violations.join('; ')}`);
    return { directions: DirectionsSchema.parse(run.json), run };
  }

  async voiceCard(sample: string): Promise<{ card: string; run: TaskRun }> {
    const run = await this.runTask({ task: 'voice.card', vars: { sample } }, { maxTokens: 2_000 });
    return { card: run.text, run };
  }
}
