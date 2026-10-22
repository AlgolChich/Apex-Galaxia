import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  ChaptersPlanSchema,
  ChapterStatusSchema,
  ENTRY_KINDS,
  ProjectConfigSchema,
  UserConfigSchema,
  createProject,
  defaultUserDir,
  getEntry,
  importBibleEntries,
  importManuscript,
  isApexError,
  loadNarrator,
  matchNarratorCommand,
  splitManuscript,
  type Harness,
  type Language,
  type ModelAdapter,
  type ProjectStore,
  ProjectStore as Store,
  type Resources,
  type RunState,
} from '@apex-galaxia/core';

/** What the app tools need from the server: the open project and the adapter, never the key. */
export interface AppContext {
  getHarness(): Promise<Harness>;
  getStore(): Promise<ProjectStore>;
  getAdapter(): Promise<ModelAdapter>;
  getResources(): Promise<Resources>;
  /** Where the model key came from (`env`, `env-file`, `none`, `replay`, `scripted`, `custom`). */
  keySource(): string;
  projectRoot(): string | undefined;
  /** Make a (new) folder the open project, as project_open does. */
  openProject(root: string): Promise<void>;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function ok(data: unknown, text?: string): ToolResult {
  const structured = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : { result: data };
  return { content: [{ type: 'text', text: text ?? JSON.stringify(data, null, 2) }], structuredContent: structured };
}

function fail(error: unknown): ToolResult {
  const message = isApexError(error) ? `[${error.code}] ${error.message}` : error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

interface LiveRun {
  controller: AbortController;
  state: RunState;
  done: Promise<RunState>;
}

/**
 * Tools the desktop app needs beyond the headless set: saving the Author's own edits, project
 * and user settings, the plan files, the Bible index, the model status and autonomous runs
 * driven in the background with progress as MCP logging notifications (`logger: apex.run`).
 * Everything still goes through the core; nothing here writes a chapter from model output.
 */
export function registerAppTools(server: McpServer, ctx: AppContext): void {
  const runs = new Map<string, LiveRun>();
  const onProjectChanged = (root: string) => ctx.openProject(root);

  const notify = async (logger: string, data: Record<string, unknown>): Promise<void> => {
    try {
      await server.server.sendLoggingMessage({ level: 'info', logger, data });
    } catch {
      // a client without the logging capability loses nothing but the live view
    }
  };

  server.registerTool(
    'model_status',
    { title: 'Model status', description: 'Which adapter is active (anthropic, replay cassette, scripted stand-in or none), where the key came from (never the key), and the configured model roles.', inputSchema: {} },
    async () => {
      try {
        const adapter = await ctx.getAdapter();
        const source = ctx.keySource();
        const root = ctx.projectRoot();
        const store = root ? await ctx.getStore() : undefined;
        return ok({
          provider: adapter.provider,
          key_source: source,
          scripted: source === 'scripted',
          has_model: adapter.provider === 'anthropic' || source === 'replay' || source === 'scripted',
          exact_token_counts: adapter.exactTokenCounts,
          models: store?.config.models ?? null,
          project: root ?? null,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- Chapters: the Author's own edits ----------------------------------------------
  server.registerTool(
    'chapter_save',
    {
      title: 'Save the Author\'s edit of a chapter',
      description: 'Persist the chapter text the Author edited in the app (word count and status updated). Model output never comes through here; it goes through suggestion_accept.',
      inputSchema: { chapter: z.union([z.number().int(), z.string()]), body: z.string(), title: z.string().optional(), status: ChapterStatusSchema.optional(), in_story_date: z.string().optional() },
    },
    async ({ chapter, body, title, status, in_story_date }) => {
      try {
        const store = await ctx.getStore();
        const current = await store.getChapter(chapter);
        const saved = await store.saveChapter(current, body, {
          ...(title !== undefined ? { title } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(in_story_date !== undefined ? { in_story_date } : {}),
        });
        return ok({ front: saved.front, stem: saved.stem, path: saved.path });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'chapter_create',
    { title: 'Create an empty chapter', description: 'Add a chapter the Author will write by hand (number defaults to the next one).', inputSchema: { number: z.number().int().positive().optional(), title: z.string(), body: z.string().optional() } },
    async ({ number, title, body }) => {
      try {
        const store = await ctx.getStore();
        const chapters = await store.listChapters();
        const n = number ?? (chapters[chapters.length - 1]?.front.number ?? 0) + 1;
        const created = await store.createChapter(n, title, body ?? '');
        return ok({ front: created.front, stem: created.stem, path: created.path });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- Settings ------------------------------------------------------------------------
  server.registerTool(
    'project_settings_update',
    { title: 'Update project settings', description: 'Merge a partial settings object into project.yaml after validation (storyteller, harshness, rating, preset, models, budget, window…).', inputSchema: { settings: z.record(z.string(), z.unknown()) } },
    async ({ settings }) => {
      try {
        const harness = await ctx.getHarness();
        const merged = ProjectConfigSchema.parse({ ...harness.store.config, ...settings });
        harness.store.config = merged;
        await harness.store.saveConfig();
        await harness.refresh();
        return ok({ config: merged });
      } catch (error) {
        return fail(error);
      }
    },
  );

  const userConfigFile = () => path.join(defaultUserDir(), 'config.yaml');
  server.registerTool('user_config_get', { title: 'Read user settings', description: 'The per-user config (~/.apex-galaxia/config.yaml): UI language, default models and budget. Never the key.', inputSchema: {} }, async () => {
    try {
      const text = await fs.readFile(userConfigFile(), 'utf8').catch(() => '');
      const config = UserConfigSchema.parse(parseYaml(text) ?? {});
      return ok({ config, file: userConfigFile() });
    } catch (error) {
      return fail(error);
    }
  });

  server.registerTool(
    'user_config_set',
    { title: 'Update user settings', description: 'Merge values into ~/.apex-galaxia/config.yaml (ui_language, models, budget, provider, base_url).', inputSchema: { settings: z.record(z.string(), z.unknown()) } },
    async ({ settings }) => {
      try {
        const file = userConfigFile();
        const text = await fs.readFile(file, 'utf8').catch(() => '');
        const current = (parseYaml(text) ?? {}) as Record<string, unknown>;
        if ('api_key' in settings || 'ANTHROPIC_API_KEY' in settings) throw new Error('Keys never go into config.yaml; use the keychain or the .env file.');
        const merged = UserConfigSchema.parse({ ...current, ...settings });
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, stringifyYaml(merged, { lineWidth: 0 }), 'utf8');
        return ok({ config: merged, file });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- Bible index -----------------------------------------------------------------------
  server.registerTool(
    'bible_list',
    { title: 'List Bible entries', description: 'Every entry of the open project (optionally one kind) with name, aliases, summary and flags.', inputSchema: { kind: z.enum(ENTRY_KINDS).optional() } },
    async ({ kind }) => {
      try {
        const harness = await ctx.getHarness();
        const entries = harness.bible.entries
          .filter((e) => !kind || e.kind === kind)
          .map((e) => ({ kind: e.kind, slug: e.slug, name: e.front.name, aliases: e.front.aliases, summary: e.summary, always_on: e.front.always_on, canon: e.front.kind === 'canon', shared: e.shared, path: e.path }));
        return ok({ entries });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bible_remove',
    { title: 'Remove a Bible entry', description: 'Move an entry to the project\'s _trash folder (recoverable). Only after the Author confirmed.', inputSchema: { kind: z.enum(ENTRY_KINDS), slug: z.string() } },
    async ({ kind, slug }) => {
      try {
        const harness = await ctx.getHarness();
        const entry = await getEntry(harness.store, kind, slug);
        const trashed = await harness.store.trash(entry.path);
        await harness.refresh();
        return ok({ kind, slug, trashed });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- Plan ------------------------------------------------------------------------------
  server.registerTool('plan_get', { title: 'Read the plan', description: 'plan/outline.md, plan/chapters.yaml and which chapters have a stored beat sheet.', inputSchema: {} }, async () => {
    try {
      const harness = await ctx.getHarness();
      const store = harness.store;
      const outline = (await store.readText(store.layout.plan.outline)) ?? '';
      const chapters = (await store.readYaml(store.layout.plan.chapters, ChaptersPlanSchema)) ?? { chapters: [] };
      const beatFiles = await fs.readdir(store.layout.plan.beats).catch(() => [] as string[]);
      const beats = beatFiles.filter((f) => f.endsWith('.json')).map((f) => Number(f.replace(/\.json$/, ''))).filter((n) => Number.isFinite(n));
      return ok({ outline, chapters, beats });
    } catch (error) {
      return fail(error);
    }
  });

  server.registerTool(
    'plan_save',
    { title: 'Save the plan', description: 'Write plan/outline.md and/or plan/chapters.yaml (validated) after the Author edited or reordered them.', inputSchema: { outline: z.string().optional(), chapters: z.record(z.string(), z.unknown()).optional() } },
    async ({ outline, chapters }) => {
      try {
        const store = await ctx.getStore();
        if (outline !== undefined) await store.writeText(store.layout.plan.outline, outline.endsWith('\n') ? outline : `${outline}\n`);
        let plan;
        if (chapters !== undefined) {
          plan = ChaptersPlanSchema.parse(chapters);
          await store.writeYaml(store.layout.plan.chapters, ChaptersPlanSchema, plan);
        }
        return ok({ outline: outline !== undefined, chapters: plan ?? null });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- Import of existing stories ----------------------------------------------------------
  server.registerTool(
    'project_import',
    {
      title: 'Import a manuscript',
      description: 'Split a Markdown or plain-text manuscript into chapters (headings such as «Глава 3. Фары» or "Chapter 3: Eleven" open a chapter) and add them to a project; creates the project in `path` when it has none (title and language then apply). preview=true only reports the split.',
      inputSchema: { path: z.string(), text: z.string().optional(), file: z.string().optional(), title: z.string().optional(), language: z.enum(['ru', 'en']).optional(), status: z.enum(['draft', 'revised', 'final']).optional(), preview: z.boolean().optional() },
    },
    async ({ path: p, text, file, title, language, status, preview }) => {
      try {
        const manuscript = text ?? (file ? await fs.readFile(path.resolve(file), 'utf8') : undefined);
        if (manuscript === undefined) throw new Error('Pass text or file');
        const root = path.resolve(p);
        const cyrillic = (manuscript.match(/[Ѐ-ӿ]/g) ?? []).length;
        const latin = (manuscript.match(/[A-Za-z]/g) ?? []).length;
        const lang: Language = language ?? (cyrillic > latin ? 'ru' : 'en');
        if (preview) {
          const parts = splitManuscript(manuscript, lang);
          return ok({ root, language: lang, chapters: parts.map((c, i) => ({ number: i + 1, title: c.title, words: c.body.split(/\s+/).filter(Boolean).length })) });
        }
        let store: ProjectStore;
        let created = false;
        try {
          store = await Store.open(root);
        } catch {
          store = await createProject(root, { title: title ?? path.basename(root), language: lang });
          created = true;
        }
        const chapters = await importManuscript(store, manuscript, status ? { status } : {});
        await onProjectChanged(store.layout.root);
        return ok({ root: store.layout.root, created, chapters: chapters.map((c) => ({ number: c.front.number, title: c.front.title, stem: c.stem, words: c.front.words })) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bible_import',
    { title: 'Import Bible entries', description: 'Create or update entries of one kind from Markdown: one # or ## heading per entry, the section as its body. Only after the Author confirmed.', inputSchema: { kind: z.enum(ENTRY_KINDS), text: z.string().optional(), file: z.string().optional() } },
    async ({ kind, text, file }) => {
      try {
        const harness = await ctx.getHarness();
        const markdown = text ?? (file ? await fs.readFile(path.resolve(file), 'utf8') : undefined);
        if (markdown === undefined) throw new Error('Pass text or file');
        const entries = await importBibleEntries(harness.store, markdown, kind);
        await harness.refresh();
        return ok({ entries: entries.map((e) => ({ kind: e.kind, slug: e.slug, name: e.front.name, summary: e.summary, path: e.path })) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- The narrator outside the story, candidates and A/B ---------------------------------
  const deltaSender = (extra: RequestHandlerExtra<ServerRequest, ServerNotification>): ((text: string) => void) | undefined => {
    const token = extra._meta?.progressToken;
    if (token === undefined) return undefined;
    let progress = 0;
    return (text: string) => {
      progress += text.length;
      void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, message: text } }).catch(() => undefined);
    };
  };

  server.registerTool(
    'narrator_chat',
    {
      title: 'Talk with the narrator (model)',
      description: 'One turn with the narrator persona outside the story: a short honest reply in the interface language, and an `action` when the Author asked for a command (next, plan, chronicle, directions, rating…). Slash commands and bare command words are recognized without a model call. Streams the reply with a progress token.',
      inputSchema: { message: z.string().min(1), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(), ui_language: z.enum(['ru', 'en']).optional() },
    },
    async ({ message, history, ui_language }, extra) => {
      try {
        const harness = await ctx.getHarness();
        const command = matchNarratorCommand(message, harness.narrator.commands);
        const ui = ui_language ?? harness.language;
        if (command && ctx.keySource() === 'none') {
          const reply = ui === 'ru' ? `Поняла: ${command.id}${command.argument ? ` ${command.argument}` : ''}. Модели нет, поэтому без комментариев.` : `Understood: ${command.id}${command.argument ? ` ${command.argument}` : ''}. No model here, so no commentary.`;
          return ok({ reply, action: command, command, model: null, costUsd: 0 }, reply);
        }
        const onDelta = deltaSender(extra);
        const result = await harness.chat({ message, ...(history ? { history } : {}), uiLanguage: ui, ...(onDelta ? { onDelta } : {}) });
        const action = result.action ?? command;
        return ok({ reply: result.reply, action: action ?? null, command: command ?? null, model: result.run.result.model, costUsd: result.run.result.costUsd, warnings: result.run.warnings }, result.reply);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'write_candidates',
    {
      title: 'Write: candidates (model)',
      description: 'Draft two or three candidates for one Write and rank them with the critic. Each is a pending suggestion: accept one with suggestion_accept, discard the rest, record the choice with ab_record. Progress notifications count finished candidates.',
      inputSchema: { mode: z.enum(['continue', 'guided', 'scene', 'chapter']).optional(), count: z.number().int().min(2).max(3).optional(), chapter: z.number().int().optional(), instruction: z.string().optional(), scene_card: z.string().optional(), target_words: z.number().int().optional(), cursor: z.number().int().optional(), chapter_number: z.number().int().optional(), title: z.string().optional(), pins: z.array(z.string()).optional() },
    },
    async (input, extra) => {
      try {
        const harness = await ctx.getHarness();
        const mode = input.mode ?? (input.instruction ? 'guided' : 'continue');
        const chapter = input.chapter !== undefined ? await harness.store.getChapter(input.chapter) : undefined;
        const token = extra._meta?.progressToken;
        const outcome = await harness.writeCandidates(mode, {
          ...(input.count !== undefined ? { count: input.count } : {}),
          ...(chapter ? { chapter } : {}),
          ...(input.instruction ? { instruction: input.instruction } : {}),
          ...(input.scene_card ? { sceneCard: input.scene_card } : {}),
          ...(input.target_words !== undefined ? { targetWords: input.target_words } : {}),
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.chapter_number !== undefined ? { chapterNumber: input.chapter_number } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.pins ? { pins: input.pins } : {}),
          onCandidate: (done, total) => {
            if (token !== undefined) void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message: `candidate ${done}/${total}` } }).catch(() => undefined);
          },
        });
        return ok(
          { mode: outcome.mode, candidates: outcome.candidates.map((c) => ({ suggestion: c.suggestion.front, text: c.text, lint: c.lint, critic: c.critic ?? null, score: c.score, model: c.model, costUsd: c.costUsd })), ranking: outcome.ranking, costUsd: outcome.costUsd },
          outcome.candidates.map((c, i) => `=== ${c.suggestion.front.id} (${i + 1}/${outcome.candidates.length}${c.score !== null ? `, score ${c.score}` : ''})\n${c.text}`).join('\n\n'),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'ab_record',
    { title: 'Record a pairwise choice', description: 'The Author chose between two suggestions («which continuation is better?»); the choice and whether it agreed with the critic go to history/ab.jsonl and the eval record.', inputSchema: { left: z.string(), right: z.string(), choice: z.enum(['left', 'right', 'tie']), note: z.string().optional(), task: z.string().optional(), critic_preferred: z.enum(['left', 'right']).nullable().optional() } },
    async ({ left, right, choice, note, task, critic_preferred }) => {
      try {
        const harness = await ctx.getHarness();
        const record = await harness.recordAb({ left, right, choice, ...(note ? { note } : {}), ...(task ? { task } : {}), criticPreferred: critic_preferred ?? null });
        return ok({ record });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool('ab_list', { title: 'List pairwise choices', description: 'Every A/B choice of the open project with the critic agreement rate.', inputSchema: {} }, async () => {
    try {
      const harness = await ctx.getHarness();
      const records = await harness.listAb();
      const judged = records.filter((r) => r.agreed !== null);
      const agreed = judged.filter((r) => r.agreed === true).length;
      return ok({ records, count: records.length, judged: judged.length, critic_agreement: judged.length > 0 ? Math.round((agreed / judged.length) * 1000) / 1000 : null });
    } catch (error) {
      return fail(error);
    }
  });

  // ---- Lint whitelist, voice card, narrator options -----------------------------------------
  server.registerTool(
    'lint_whitelist_add',
    { title: 'Whitelist a phrase for the linter', description: 'Append a phrase to the project\'s style/lint-whitelist.txt so the linter stops flagging it (the Author\'s one-click decision).', inputSchema: { phrase: z.string().min(1), note: z.string().optional() } },
    async ({ phrase, note }) => {
      try {
        const harness = await ctx.getHarness();
        const file = harness.store.layout.style.whitelist;
        const current = (await harness.store.readText(file)) ?? '';
        const line = note ? `${phrase.trim()} | ${note.trim()}` : phrase.trim();
        if (harness.style.whitelist.some((w) => w.toLowerCase() === phrase.trim().toLowerCase())) return ok({ phrase: phrase.trim(), added: false, file });
        await harness.store.writeText(file, `${current.trimEnd()}\n${line}\n`.replace(/^\n/, ''));
        await harness.refresh();
        return ok({ phrase: phrase.trim(), added: true, file });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'voice_card',
    { title: 'Voice card from a sample (model)', description: 'Distill the Author\'s own prose sample into the voice card (style/voice-card.md) the prose prompts carry. Needs a model.', inputSchema: { sample: z.string().min(1), save: z.boolean().optional() } },
    async ({ sample, save }) => {
      try {
        const harness = await ctx.getHarness();
        const { card, run } = await harness.voiceCard(sample);
        let file: string | null = null;
        if (save !== false) {
          file = harness.store.layout.style.voiceCard;
          await harness.store.writeText(file, card.trimEnd() + '\n');
          await harness.refresh();
        }
        return ok({ card, file, costUsd: run.result.costUsd, model: run.result.model }, card);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'narrator_options',
    { title: 'Narrator options', description: 'The storytellers, harshness levels, ratings and length classes of a narrator profile with their bilingual names and one-line explanations, for wizards and settings. No project needed.', inputSchema: { narrator: z.string().optional() } },
    async ({ narrator }) => {
      try {
        const profile = await loadNarrator(await ctx.getResources(), narrator ?? 'gwen');
        return ok({
          name: profile.name,
          display_name: profile.displayName,
          defaults: profile.defaults,
          storytellers: profile.storytellers.map((s) => ({ id: s.id, name: s.name, rhythm: s.rhythm, expect: s.expect, default: s.default ?? false })),
          harshness: profile.harshness.map((h) => ({ level: h.level, name: h.name, allowed: h.allowed, default: h.default ?? false })),
          ratings: profile.ratings.map((r) => ({ id: r.id, name: r.name, allowed: r.allowed, default: r.default ?? false })),
          lengths: profile.lengths.map((l) => ({ id: l.id, name: l.name, pages: l.pages, words: l.words, chapters: l.chapters, plan_approval: l.plan_approval, default: l.default ?? false })),
          chapter_words: profile.chapterWords,
          brief_template: profile.briefTemplate,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  // ---- Autonomous runs in the background ---------------------------------------------------
  server.registerTool(
    'run_start',
    {
      title: 'Start or resume an autonomous run',
      description: 'Write the story unattended in the background (plan → write → chronicle → summary per chapter, Muse Layer on). Returns the run id at once; progress, streamed text and the final state arrive as logging notifications with logger "apex.run". Pause with run_pause, read with run_get. A run stops with status awaiting_decision when a chapter plans irreversible choices; resume it with approve_decision after the Author agreed, or edit plan/beats/<nn>.json and resume.',
      inputSchema: { chapters: z.number().int().positive().optional(), resume: z.string().optional(), approve_outline: z.boolean().optional(), approve_decision: z.boolean().optional(), reader_report: z.boolean().optional() },
    },
    async ({ chapters, resume, approve_outline, approve_decision, reader_report }) => {
      try {
        if (resume && runs.get(resume)?.state.status === 'running') return fail(new Error(`Run ${resume} is already running`));
        const harness = await ctx.getHarness();
        const controller = new AbortController();
        let resolveId: (state: RunState) => void = () => undefined;
        const first = new Promise<RunState>((resolve) => {
          resolveId = resolve;
        });
        const live: { current?: LiveRun } = {};
        const done = harness.runBook({
          ...(chapters !== undefined ? { chapters } : {}),
          ...(resume ? { resume } : {}),
          ...(approve_outline !== undefined ? { approveOutline: approve_outline } : {}),
          ...(approve_decision !== undefined ? { approveDecision: approve_decision } : {}),
          ...(reader_report !== undefined ? { readerReport: reader_report } : {}),
          signal: controller.signal,
          onProgress: (state, message) => {
            if (live.current) live.current.state = state;
            resolveId(state);
            void notify('apex.run', { run_id: state.id, status: state.status, stage: state.stage, next_chapter: state.next_chapter, completed: state.completed.length, target: state.target_chapters, cost_usd: state.cost_usd, message, ...(state.pending_decision ? { pending_decision: state.pending_decision } : {}) });
          },
          onDelta: (text) => {
            const id = live.current?.state.id;
            if (id) void notify('apex.run', { run_id: id, delta: text });
          },
        });
        const state = await Promise.race([first, done]);
        live.current = { controller, state, done };
        runs.set(state.id, live.current);
        void done.then((final) => {
          live.current!.state = final;
          void notify('apex.run', { run_id: final.id, status: final.status, stage: final.stage, completed: final.completed.length, target: final.target_chapters, cost_usd: final.cost_usd, final: true, ...(final.error ? { error: final.error } : {}) });
        });
        return ok({ id: state.id, state });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool('run_pause', { title: 'Pause a run', description: 'Stop a background run at the next stage boundary; its state is saved and can be resumed with run_start {resume}.', inputSchema: { id: z.string() } }, async ({ id }) => {
    const live = runs.get(id);
    if (!live) return fail(new Error(`Run ${id} is not running in this session`));
    live.controller.abort();
    return ok({ id, status: 'pausing' });
  });

  server.registerTool('run_get', { title: 'Read a run', description: 'The latest state of a run (live if it is running in this session, else from history/runs).', inputSchema: { id: z.string() } }, async ({ id }) => {
    try {
      const live = runs.get(id);
      if (live) return ok({ state: live.state, live: live.state.status === 'running' });
      const harness = await ctx.getHarness();
      return ok({ state: await harness.readRun(id), live: false });
    } catch (error) {
      return fail(error);
    }
  });

  server.registerTool('run_list', { title: 'List runs', description: 'Every saved run of the open project, oldest first.', inputSchema: {} }, async () => {
    try {
      const harness = await ctx.getHarness();
      const saved = await harness.listRuns();
      return ok({ runs: saved.map((s) => runs.get(s.id)?.state ?? s) });
    } catch (error) {
      return fail(error);
    }
  });
}
