import { create } from 'zustand';
import { getClient } from '../api/index.js';
import { ToolError } from '../api/mcp.js';
import type { ChapterFront, ChapterSummary, LintReport, ModelStatus, ProjectConfig, ProjectCreateOptions, SuggestionFront, WriteResult } from '../api/types.js';

export type UiLanguage = 'ru' | 'en';
export type Theme = 'light' | 'dark' | 'system';
export type View = 'editor' | 'bible' | 'chronicle' | 'plan' | 'run' | 'settings' | 'canvas';
export type Panel = 'bible' | 'chronicle' | 'lint' | 'critic' | 'inspector';
export type WriteMode = 'continue' | 'guided' | 'scene' | 'chapter';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface PendingSuggestion {
  front: SuggestionFront;
  text: string;
  lint: LintReport;
  costUsd: number;
  model: string;
  warnings: string[];
  mode: WriteMode;
  /** Where the continuation attaches in the chapter body (chapter mode: a new chapter). */
  cursor: number | undefined;
  chapterNumber: number | undefined;
}

export interface StreamState {
  active: boolean;
  text: string;
  mode: WriteMode;
  startedAt: number;
  abort: AbortController | undefined;
}

export interface AppState {
  connection: { status: 'idle' | 'connecting' | 'ready' | 'error'; error?: string; model?: ModelStatus; keySource?: string };
  project: { root?: string; config?: ProjectConfig; chapters: ChapterSummary[]; spentUsd: number };
  editor: {
    stem?: string;
    front?: ChapterFront;
    body: string;
    savedBody: string;
    dirty: boolean;
    /** Caret offset and selection in the body; the editor feature keeps them current. */
    cursor: number;
    selection: { from: number; to: number };
    saving: boolean;
  };
  lint: { report?: LintReport; stem?: string; running: boolean };
  suggestion: { pending: PendingSuggestion | undefined; stream: StreamState };
  ui: {
    language: UiLanguage;
    theme: Theme;
    view: View;
    panel: Panel | null;
    treeOpen: boolean;
    focusMode: boolean;
    paletteOpen: boolean;
    wizard: 'none' | 'first-run' | 'new-story';
    toasts: Toast[];
    recent: string[];
  };

  // ---- actions: connection and project -----------------------------------------------
  connect(): Promise<void>;
  refreshModelStatus(): Promise<void>;
  openProject(root: string): Promise<void>;
  createProject(options: ProjectCreateOptions): Promise<void>;
  reloadChapters(): Promise<void>;
  updateSettings(settings: Partial<ProjectConfig>): Promise<void>;

  // ---- actions: editor -----------------------------------------------------------------
  loadChapter(ref: number | string): Promise<void>;
  createChapter(title: string): Promise<void>;
  setBody(body: string): void;
  setCursor(cursor: number, selection?: { from: number; to: number }): void;
  saveChapter(): Promise<void>;
  runLint(): Promise<void>;

  // ---- actions: write ------------------------------------------------------------------
  write(mode: WriteMode, params?: { instruction?: string; targetWords?: number; title?: string; chapterNumber?: number }): Promise<void>;
  cancelWrite(): void;
  acceptSuggestion(editedText?: string): Promise<void>;
  discardSuggestion(): Promise<void>;
  retrySuggestion(note?: string): Promise<void>;

  // ---- actions: ui ---------------------------------------------------------------------
  setLanguage(language: UiLanguage): void;
  setTheme(theme: Theme): void;
  setView(view: View): void;
  togglePanel(panel: Panel | null): void;
  toggleTree(open?: boolean): void;
  toggleFocus(on?: boolean): void;
  setPalette(open: boolean): void;
  setWizard(wizard: AppState['ui']['wizard']): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
}

const RECENT_KEY = 'apex.recent';
const UI_KEY = 'apex.ui';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or a test environment without storage
  }
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

const savedUi = readLocal<{ language?: UiLanguage; theme?: Theme }>(UI_KEY, {});
const systemLanguage: UiLanguage = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
let toastId = 0;

export const useStore = create<AppState>((set, get) => ({
  connection: { status: 'idle' },
  project: { chapters: [], spentUsd: 0 },
  editor: { body: '', savedBody: '', dirty: false, cursor: 0, selection: { from: 0, to: 0 }, saving: false },
  lint: { running: false },
  suggestion: { pending: undefined, stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } },
  ui: {
    language: savedUi.language ?? systemLanguage,
    theme: savedUi.theme ?? 'system',
    view: 'editor',
    panel: null,
    treeOpen: true,
    focusMode: false,
    paletteOpen: false,
    wizard: 'none',
    toasts: [],
    recent: readLocal<string[]>(RECENT_KEY, []),
  },

  async connect() {
    const client = getClient();
    set((s) => ({ connection: { ...s.connection, status: 'connecting' } }));
    try {
      await client.connect();
      const model = await client.modelStatus();
      const status = await client.transport.status().catch(() => undefined);
      set({ connection: { status: 'ready', model, ...(status ? { keySource: status.keySource } : {}) } });
      client.onReset(() => {
        set((s) => ({ connection: { ...s.connection, status: 'connecting' } }));
        void get().connect().then(() => {
          const root = get().project.root;
          if (root) void get().openProject(root);
        });
      });
    } catch (error) {
      set({ connection: { status: 'error', error: errorText(error) } });
    }
  },

  async refreshModelStatus() {
    try {
      const model = await getClient().modelStatus();
      set((s) => ({ connection: { ...s.connection, model } }));
    } catch (error) {
      get().toast('error', errorText(error));
    }
  },

  async openProject(root) {
    try {
      const opened = await getClient().projectOpen(root);
      const recent = [opened.root, ...get().ui.recent.filter((r) => r !== opened.root)].slice(0, 8);
      writeLocal(RECENT_KEY, recent);
      set((s) => ({
        project: { root: opened.root, config: opened.config, chapters: opened.chapters, spentUsd: opened.spentUsd },
        editor: { body: '', savedBody: '', dirty: false, cursor: 0, selection: { from: 0, to: 0 }, saving: false },
        lint: { running: false },
        suggestion: { pending: undefined, stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } },
        ui: { ...s.ui, recent, view: 'editor', wizard: 'none' },
      }));
      const last = opened.chapters[opened.chapters.length - 1];
      if (last) await get().loadChapter(last.number);
      await get().refreshModelStatus();
    } catch (error) {
      get().toast('error', errorText(error));
      throw error;
    }
  },

  async createProject(options) {
    const created = await getClient().projectCreate(options);
    await get().openProject(created.root);
  },

  async reloadChapters() {
    const client = getClient();
    const root = get().project.root;
    if (!root) return;
    const [{ chapters }, opened] = await Promise.all([client.projectChapters(), client.projectOpen(root)]);
    set((s) => ({ project: { ...s.project, chapters, spentUsd: opened.spentUsd, config: opened.config } }));
  },

  async updateSettings(settings) {
    try {
      const { config } = await getClient().projectSettingsUpdate(settings);
      set((s) => ({ project: { ...s.project, config } }));
      get().toast('success', get().ui.language === 'ru' ? 'Настройки сохранены' : 'Settings saved');
    } catch (error) {
      get().toast('error', errorText(error));
      throw error;
    }
  },

  async loadChapter(ref) {
    const { editor } = get();
    if (editor.dirty) await get().saveChapter();
    try {
      const chapter = await getClient().chapterGet(ref);
      set({ editor: { stem: chapter.stem, front: chapter.front, body: chapter.body, savedBody: chapter.body, dirty: false, cursor: chapter.body.length, selection: { from: chapter.body.length, to: chapter.body.length }, saving: false } });
      void get().runLint();
    } catch (error) {
      get().toast('error', errorText(error));
    }
  },

  async createChapter(title) {
    try {
      const created = await getClient().chapterCreate(title);
      await get().reloadChapters();
      await get().loadChapter(created.stem);
    } catch (error) {
      get().toast('error', errorText(error));
    }
  },

  setBody(body) {
    set((s) => ({ editor: { ...s.editor, body, dirty: body !== s.editor.savedBody } }));
  },

  setCursor(cursor, selection) {
    set((s) => ({ editor: { ...s.editor, cursor, selection: selection ?? { from: cursor, to: cursor } } }));
  },

  async saveChapter() {
    const { editor } = get();
    if (!editor.stem || !editor.dirty || editor.saving) return;
    set((s) => ({ editor: { ...s.editor, saving: true } }));
    try {
      const saved = await getClient().chapterSave(editor.stem, editor.body);
      set((s) => ({ editor: { ...s.editor, front: saved.front, savedBody: editor.body, dirty: s.editor.body !== editor.body, saving: false } }));
      await get().reloadChapters();
    } catch (error) {
      set((s) => ({ editor: { ...s.editor, saving: false } }));
      get().toast('error', errorText(error));
    }
  },

  async runLint() {
    const { editor, project } = get();
    if (!project.root || !editor.stem) return;
    set((s) => ({ lint: { ...s.lint, running: true } }));
    try {
      const report = await getClient().lint({ text: editor.body });
      set({ lint: { report, stem: editor.stem, running: false } });
    } catch (error) {
      set((s) => ({ lint: { ...s.lint, running: false } }));
      get().toast('error', errorText(error));
    }
  },

  async write(mode, params = {}) {
    const client = getClient();
    const { editor, project, suggestion } = get();
    if (suggestion.stream.active) return;
    if (editor.dirty) await get().saveChapter();
    const abort = new AbortController();
    set({ suggestion: { ...get().suggestion, stream: { active: true, text: '', mode, startedAt: Date.now(), abort } } });
    const onDelta = (delta: string) => set((s) => ({ suggestion: { ...s.suggestion, stream: { ...s.suggestion.stream, text: s.suggestion.stream.text + delta } } }));
    try {
      let result: WriteResult;
      let chapterNumber: number | undefined;
      let cursor: number | undefined;
      if (mode === 'chapter') {
        chapterNumber = params.chapterNumber ?? (project.chapters[project.chapters.length - 1]?.number ?? 0) + 1;
        result = await client.writeChapter({ chapter_number: chapterNumber, ...(params.title ? { title: params.title } : {}), ...(params.targetWords ? { target_words: params.targetWords } : {}) }, onDelta, { signal: abort.signal });
      } else {
        chapterNumber = editor.front?.number;
        cursor = editor.cursor;
        result = await client.writeContinue(
          {
            ...(chapterNumber !== undefined ? { chapter: chapterNumber } : {}),
            ...(params.instruction ? { instruction: params.instruction } : {}),
            ...(params.targetWords ? { target_words: params.targetWords } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          },
          onDelta,
          { signal: abort.signal },
        );
      }
      set((s) => ({
        suggestion: {
          pending: { front: result.suggestion, text: result.text, lint: result.lint, costUsd: result.costUsd, model: result.model, warnings: result.warnings ?? [], mode, cursor, chapterNumber },
          stream: { ...s.suggestion.stream, active: false, abort: undefined },
        },
      }));
      await get().reloadChapters();
    } catch (error) {
      set((s) => ({ suggestion: { ...s.suggestion, stream: { ...s.suggestion.stream, active: false, abort: undefined } } }));
      if (!abort.signal.aborted) get().toast('error', errorText(error));
    }
  },

  cancelWrite() {
    get().suggestion.stream.abort?.abort();
  },

  async acceptSuggestion(editedText) {
    const pending = get().suggestion.pending;
    if (!pending) return;
    try {
      const accepted = await getClient().suggestionAccept(pending.front.id, editedText);
      set((s) => ({ suggestion: { ...s.suggestion, pending: undefined } }));
      await get().reloadChapters();
      await get().loadChapter(accepted.stem);
    } catch (error) {
      get().toast('error', errorText(error));
    }
  },

  async discardSuggestion() {
    const pending = get().suggestion.pending;
    if (!pending) return;
    try {
      await getClient().suggestionDiscard(pending.front.id);
    } catch (error) {
      get().toast('error', errorText(error));
    }
    set((s) => ({ suggestion: { ...s.suggestion, pending: undefined } }));
  },

  async retrySuggestion(note) {
    const pending = get().suggestion.pending;
    if (!pending) return;
    await get().discardSuggestion();
    if (pending.mode === 'chapter') {
      await get().write('chapter', { ...(pending.chapterNumber !== undefined ? { chapterNumber: pending.chapterNumber } : {}), ...(note ? { instruction: note } : {}) });
    } else {
      await get().write(note ? 'guided' : pending.mode, note ? { instruction: note } : {});
    }
  },

  setLanguage(language) {
    writeLocal(UI_KEY, { language, theme: get().ui.theme });
    set((s) => ({ ui: { ...s.ui, language } }));
    document.documentElement.lang = language;
  },

  setTheme(theme) {
    writeLocal(UI_KEY, { language: get().ui.language, theme });
    set((s) => ({ ui: { ...s.ui, theme } }));
  },

  setView(view) {
    set((s) => ({ ui: { ...s.ui, view } }));
  },

  togglePanel(panel) {
    set((s) => ({ ui: { ...s.ui, panel: s.ui.panel === panel ? null : panel } }));
  },

  toggleTree(open) {
    set((s) => ({ ui: { ...s.ui, treeOpen: open ?? !s.ui.treeOpen } }));
  },

  toggleFocus(on) {
    set((s) => {
      const focusMode = on ?? !s.ui.focusMode;
      return { ui: { ...s.ui, focusMode, ...(focusMode ? { treeOpen: false, panel: null } : {}) } };
    });
  },

  setPalette(open) {
    set((s) => ({ ui: { ...s.ui, paletteOpen: open } }));
  },

  setWizard(wizard) {
    set((s) => ({ ui: { ...s.ui, wizard } }));
  },

  toast(kind, text) {
    const id = ++toastId;
    set((s) => ({ ui: { ...s.ui, toasts: [...s.ui.toasts, { id, kind, text }] } }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4000);
  },

  dismissToast(id) {
    set((s) => ({ ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) } }));
  },
}));

/** Current chapter number, or undefined when no chapter is open. */
export function currentChapterNumber(state: AppState): number | undefined {
  return state.editor.front?.number;
}
