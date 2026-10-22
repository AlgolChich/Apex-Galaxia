import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  ChaptersPlanSchema,
  ChapterStatusSchema,
  ENTRY_KINDS,
  ProjectConfigSchema,
  UserConfigSchema,
  defaultUserDir,
  getEntry,
  isApexError,
  type Harness,
  type ModelAdapter,
  type ProjectStore,
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

  // ---- Autonomous runs in the background ---------------------------------------------------
  server.registerTool(
    'run_start',
    {
      title: 'Start or resume an autonomous run',
      description: 'Write the story unattended in the background (plan → write → chronicle → summary per chapter, Muse Layer on). Returns the run id at once; progress, streamed text and the final state arrive as logging notifications with logger "apex.run". Pause with run_pause, read with run_get.',
      inputSchema: { chapters: z.number().int().positive().optional(), resume: z.string().optional(), approve_outline: z.boolean().optional(), reader_report: z.boolean().optional() },
    },
    async ({ chapters, resume, approve_outline, reader_report }) => {
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
          ...(reader_report !== undefined ? { readerReport: reader_report } : {}),
          signal: controller.signal,
          onProgress: (state, message) => {
            if (live.current) live.current.state = state;
            resolveId(state);
            void notify('apex.run', { run_id: state.id, status: state.status, stage: state.stage, next_chapter: state.next_chapter, completed: state.completed.length, target: state.target_chapters, cost_usd: state.cost_usd, message });
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
