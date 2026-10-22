import { useEffect } from 'react';
import { getClient, type ApexClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import { translate } from '../../i18n/index.js';
import { useStore, type AppState, type Panel, type View } from '../../state/store.js';
import { currentSelection, selectionOrParagraph } from '../diff/editor-bridge.js';
import { useDialogs, type DialogsState, type RewriteVars } from '../diff/store.js';
import { acceptPending } from '../suggestion/draft.js';
import { fuzzyMatch, type FuzzyMatch } from './fuzzy.js';
import { pushRecent, usePaletteState } from './state.js';

/**
 * Every action of the app in one list: the palette searches it, the global shortcut
 * listener (`useGlobalShortcuts`) runs it, and other features may reuse it for menus.
 * Labels are string keys; `run` receives the stores, the client and the form values.
 */
export interface Shortcut {
  /** `event.key` value: a letter, a digit or a named key such as `Enter`. */
  key: string;
  /** Ctrl on Windows and Linux, Cmd on macOS. Every global shortcut sets it. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type Need = 'project' | 'chapter' | 'selection' | 'pending';
export type ActionGroup = 'write' | 'rewrite' | 'craft' | 'quality' | 'chronicle' | 'export' | 'view' | 'app';
export const GROUPS: ActionGroup[] = ['write', 'rewrite', 'craft', 'quality', 'chronicle', 'export', 'view', 'app'];

export interface FormField {
  id: string;
  /** String key of the label. */
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'select';
  required?: boolean;
  defaultValue?: string | ((app: AppState) => string);
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface ActionContext {
  app: AppState;
  dialogs: DialogsState;
  client: ApexClient;
  t: Translate;
  values: Record<string, string>;
}

export interface PaletteAction {
  id: string;
  /** String key of the label. */
  label: string;
  /** String key of a one-line explanation shown muted. */
  hint?: string;
  group: ActionGroup;
  shortcut?: Shortcut;
  /** Inline form the palette shows before running. */
  form?: FormField[];
  /** What must be there before the action runs; an unmet need shows as a toast. */
  needs?: Need[];
  run(ctx: ActionContext): void | Promise<void>;
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

function openPanel(app: AppState, panel: Panel): void {
  if (app.ui.panel !== panel) app.togglePanel(panel);
}

function rewriteVars(values: Record<string, string>): RewriteVars {
  const vars: RewriteVars = {};
  for (const key of ['percent', 'tone', 'instruction', 'viewpoint', 'pov', 'tense'] as const) {
    const value = values[key]?.trim();
    if (value) vars[key] = value;
  }
  return vars;
}

const POV_FIELDS: FormField[] = [
  { id: 'viewpoint', label: 'palette.field.viewpoint', kind: 'text', required: true, placeholder: 'palette.field.viewpoint.placeholder' },
  {
    id: 'pov',
    label: 'palette.field.pov',
    kind: 'select',
    defaultValue: (app) => app.project.config?.pov ?? 'third',
    options: [
      { value: 'first', label: 'palette.pov.first' },
      { value: 'third', label: 'palette.pov.third' },
    ],
  },
  {
    id: 'tense',
    label: 'palette.field.tense',
    kind: 'select',
    defaultValue: (app) => app.project.config?.tense ?? 'past',
    options: [
      { value: 'past', label: 'palette.tense.past' },
      { value: 'present', label: 'palette.tense.present' },
    ],
  },
];

function rewrite(op: string, extra: Partial<PaletteAction> = {}): PaletteAction {
  return {
    id: `rewrite.${op}`,
    label: `palette.action.rewrite.${op}`,
    hint: 'palette.hint.rewrite',
    group: 'rewrite',
    needs: ['selection'],
    run: ({ dialogs, values }) => dialogs.runRewrite(op, rewriteVars(values)),
    ...extra,
  };
}

// Views take Ctrl+1..6 (the top bar binds the same chords; this listener runs first and stops
// the event, so each fires once); panels take Ctrl+Shift+1..5.
function panel(id: Panel, digit: string): PaletteAction {
  return { id: `panel.${id}`, label: `palette.action.panel.${id}`, group: 'view', shortcut: { key: digit, mod: true, shift: true }, needs: ['project'], run: ({ app }) => app.togglePanel(id) };
}

function view(id: View, digit: string): PaletteAction {
  return { id: `view.${id}`, label: `palette.action.view.${id}`, group: 'view', shortcut: { key: digit, mod: true }, needs: ['project'], run: ({ app }) => app.setView(id) };
}

function exportAction(format: 'md' | 'docx' | 'epub'): PaletteAction {
  return {
    id: `export.${format}`,
    label: `palette.action.export.${format}`,
    group: 'export',
    needs: ['project'],
    async run({ app, client, t }) {
      app.toast('info', t('palette.toast.exporting'));
      const result = await client.exportBook(format);
      app.toast('success', t('palette.toast.exported', { file: result.file }));
    },
  };
}

export const ACTIONS: PaletteAction[] = [
  { id: 'write.continue', label: 'palette.action.write.continue', hint: 'palette.hint.write.continue', group: 'write', shortcut: { key: 'Enter', mod: true }, needs: ['chapter'], run: ({ app }) => app.write('continue') },
  {
    id: 'write.guided',
    label: 'palette.action.write.guided',
    hint: 'palette.hint.write.guided',
    group: 'write',
    shortcut: { key: 'g', mod: true, shift: true },
    needs: ['chapter'],
    form: [{ id: 'instruction', label: 'palette.field.beat', kind: 'textarea', required: true, placeholder: 'palette.field.beat.placeholder' }],
    run: ({ app, values }) => app.write('guided', { instruction: values['instruction'] ?? '' }),
  },
  {
    id: 'write.scene',
    label: 'palette.action.write.scene',
    hint: 'palette.hint.write.scene',
    group: 'write',
    needs: ['chapter'],
    form: [{ id: 'instruction', label: 'palette.field.sceneCard', kind: 'textarea', required: true, placeholder: 'palette.field.sceneCard.placeholder' }],
    run: ({ app, values }) => app.write('scene', { instruction: values['instruction'] ?? '' }),
  },
  {
    id: 'write.chapter',
    label: 'palette.action.write.chapter',
    hint: 'palette.hint.write.chapter',
    group: 'write',
    shortcut: { key: 'n', mod: true, shift: true },
    needs: ['project'],
    form: [{ id: 'title', label: 'palette.field.title', kind: 'text', placeholder: 'palette.field.title.placeholder' }],
    run: ({ app, values }) => app.write('chapter', values['title']?.trim() ? { title: values['title'].trim() } : {}),
  },
  {
    id: 'suggestion.accept',
    label: 'palette.action.suggestion.accept',
    group: 'write',
    shortcut: { key: 'Enter', mod: true, shift: true },
    needs: ['pending'],
    run: () => acceptPending(),
  },
  { id: 'suggestion.discard', label: 'palette.action.suggestion.discard', group: 'write', needs: ['pending'], run: ({ app }) => app.discardSuggestion() },

  rewrite('tone', { form: [{ id: 'tone', label: 'palette.field.tone', kind: 'text', required: true, placeholder: 'palette.field.tone.placeholder' }] }),
  rewrite('dialogue'),
  rewrite('show'),
  rewrite('tighten', { form: [{ id: 'percent', label: 'palette.field.percent', kind: 'number', defaultValue: '20', min: 5, max: 80 }] }),
  rewrite('expand', { form: [{ id: 'percent', label: 'palette.field.percent', kind: 'number', defaultValue: '30', min: 5, max: 200 }] }),
  rewrite('pov', { form: POV_FIELDS }),
  rewrite('punctuation'),
  rewrite('deai', { shortcut: { key: 'a', mod: true, shift: true }, hint: 'palette.hint.rewrite.deai' }),
  rewrite('quick', { shortcut: { key: 'r', mod: true, shift: true }, form: [{ id: 'instruction', label: 'palette.field.instruction', kind: 'textarea', required: true, placeholder: 'palette.field.instruction.placeholder' }] }),

  { id: 'describe', label: 'palette.action.describe', hint: 'palette.hint.describe', group: 'craft', shortcut: { key: 'd', mod: true, shift: true }, needs: ['chapter'], run: ({ dialogs }) => dialogs.openDescribe(selectionOrParagraph()) },
  { id: 'weave', label: 'palette.action.weave', hint: 'palette.hint.weave', group: 'craft', needs: ['chapter'], run: ({ dialogs }) => dialogs.openDescribe(selectionOrParagraph()) },

  {
    id: 'lint.run',
    label: 'palette.action.lint',
    hint: 'palette.hint.lint',
    group: 'quality',
    shortcut: { key: 'l', mod: true, shift: true },
    needs: ['chapter'],
    run: ({ app }) => {
      openPanel(app, 'lint');
      return app.runLint();
    },
  },
  { id: 'critic.run', label: 'palette.action.critic', hint: 'palette.hint.critic', group: 'quality', needs: ['chapter'], run: ({ dialogs }) => dialogs.requestCritic('critic', 'chapter') },
  { id: 'critic.selection', label: 'palette.action.critic.selection', group: 'quality', needs: ['selection'], run: ({ dialogs }) => dialogs.requestCritic('critic', 'selection') },
  { id: 'bible.check', label: 'palette.action.bible.check', hint: 'palette.hint.bible.check', group: 'quality', needs: ['chapter'], run: ({ dialogs }) => dialogs.requestCritic('bible', 'chapter') },
  { id: 'panel.inspector', label: 'palette.action.panel.inspector', hint: 'palette.hint.inspector', group: 'quality', shortcut: { key: '5', mod: true, shift: true }, needs: ['project'], run: ({ app }) => app.togglePanel('inspector') },

  {
    id: 'chronicle.update',
    label: 'palette.action.chronicle.update',
    hint: 'palette.hint.chronicle.update',
    group: 'chronicle',
    shortcut: { key: 'u', mod: true, shift: true },
    needs: ['chapter'],
    run: ({ app, dialogs }) => {
      const number = app.editor.front?.number;
      if (number !== undefined) dialogs.openChronicleUpdate(number);
    },
  },
  {
    id: 'chapter.summarize',
    label: 'palette.action.chapter.summarize',
    hint: 'palette.hint.chapter.summarize',
    group: 'chronicle',
    needs: ['chapter'],
    async run({ app, client, t }) {
      const number = app.editor.front?.number;
      if (number === undefined) return;
      app.toast('info', t('palette.toast.summarizing', { n: number }));
      await client.summarizeChapter(number);
      app.toast('success', t('palette.toast.summarized', { n: number }));
      await app.reloadChapters();
    },
  },

  exportAction('md'),
  exportAction('docx'),
  exportAction('epub'),

  { id: 'chapter.save', label: 'palette.action.save', group: 'app', shortcut: { key: 's', mod: true }, needs: ['chapter'], run: ({ app }) => app.saveChapter() },
  { id: 'focus.toggle', label: 'palette.action.focus', hint: 'palette.hint.focus', group: 'view', shortcut: { key: 'f', mod: true, shift: true }, run: ({ app }) => app.toggleFocus() },
  { id: 'tree.toggle', label: 'palette.action.tree', group: 'view', shortcut: { key: 'b', mod: true }, run: ({ app }) => app.toggleTree() },
  panel('bible', '1'),
  panel('chronicle', '2'),
  panel('lint', '3'),
  panel('critic', '4'),
  {
    id: 'panel.close',
    label: 'palette.action.panel.close',
    group: 'view',
    run: ({ app }) => {
      if (app.ui.panel) app.togglePanel(app.ui.panel);
    },
  },
  view('editor', '1'),
  view('bible', '2'),
  view('chronicle', '3'),
  view('plan', '4'),
  view('run', '5'),
  view('settings', '6'),

  { id: 'language.ru', label: 'palette.action.language.ru', group: 'app', run: ({ app }) => app.setLanguage('ru') },
  { id: 'language.en', label: 'palette.action.language.en', group: 'app', run: ({ app }) => app.setLanguage('en') },
  { id: 'theme.light', label: 'palette.action.theme.light', group: 'app', run: ({ app }) => app.setTheme('light') },
  { id: 'theme.dark', label: 'palette.action.theme.dark', group: 'app', run: ({ app }) => app.setTheme('dark') },
  { id: 'theme.system', label: 'palette.action.theme.system', group: 'app', run: ({ app }) => app.setTheme('system') },
];

export function findAction(id: string): PaletteAction | undefined {
  return ACTIONS.find((action) => action.id === id);
}

/** The first unmet requirement of an action, or undefined when it can run. */
export function unmetNeed(action: PaletteAction, app: AppState): Need | undefined {
  for (const need of action.needs ?? []) {
    if (need === 'project' && !app.project.root) return need;
    if (need === 'chapter' && (!app.project.root || !app.editor.stem || !app.editor.front)) return 'chapter';
    if (need === 'selection' && (!app.editor.stem || currentSelection().text.trim().length === 0)) return need;
    if (need === 'pending' && !app.suggestion.pending) return need;
  }
  return undefined;
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run an action from anywhere (palette, shortcut, a menu). Without `values`, an action
 * that has a form opens the palette on that form instead of running blind. Errors become
 * toasts; the action is remembered as recently used.
 */
export async function runAction(action: PaletteAction, values?: Record<string, string>): Promise<void> {
  const app = useStore.getState();
  const t: Translate = (key, vars) => translate(app.ui.language, key, vars);
  const need = unmetNeed(action, app);
  if (need) {
    app.toast('info', t(`palette.need.${need}`));
    return;
  }
  if (action.form && values === undefined) {
    usePaletteState.getState().setFormAction(action.id);
    app.setPalette(true);
    return;
  }
  pushRecent(action.id);
  try {
    await action.run({ app, dialogs: useDialogs.getState(), client: getClient(), t, values: values ?? {} });
  } catch (error) {
    useStore.getState().toast('error', errorText(error));
  }
}

// ---- shortcuts ------------------------------------------------------------------------

/** Display parts of a shortcut, e.g. ['Ctrl', 'Shift', 'Enter'] (Cmd on macOS). */
export function shortcutParts(shortcut: Shortcut): string[] {
  const parts: string[] = [];
  if (shortcut.mod) parts.push(IS_MAC ? 'Cmd' : 'Ctrl');
  if (shortcut.alt) parts.push(IS_MAC ? 'Option' : 'Alt');
  if (shortcut.shift) parts.push('Shift');
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts;
}

export function formatShortcut(shortcut: Shortcut): string {
  return shortcutParts(shortcut).join('+');
}

/** Match by `event.key`, and by `event.code` too so a Cyrillic layout still fires Ctrl+S. */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (Boolean(shortcut.mod) !== (event.ctrlKey || event.metaKey)) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  if (Boolean(shortcut.alt) !== event.altKey) return false;
  const key = shortcut.key;
  if (/^[a-z]$/i.test(key)) return event.key.toLowerCase() === key.toLowerCase() || event.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return event.key === key || event.code === `Digit${key}`;
  return event.key === key;
}

function dialogOpen(): boolean {
  const d = useDialogs.getState();
  return Boolean(d.diff || d.busy || d.describe || d.chronicleUpdate);
}

/**
 * One keydown listener for every action shortcut. Mounted by `DiffDialog`, which App renders
 * at all times (the palette and the right panel exist only on demand). It stays quiet while
 * the palette or one of the dialogs is open: they handle their own keys. It listens in the
 * capture phase so an app-level shortcut wins over an editor keymap binding that happens to
 * share the chord (CodeMirror resolves Ctrl+Shift+A to select-all on some key events).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (useStore.getState().ui.paletteOpen || dialogOpen()) return;
      const action = ACTIONS.find((a) => a.shortcut && matchesShortcut(event, a.shortcut));
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      void runAction(action);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

// ---- search ---------------------------------------------------------------------------

export interface RankedAction {
  action: PaletteAction;
  match: FuzzyMatch;
  recent: boolean;
}

/**
 * Filter and order actions for a query. Empty query: recently used first (most recent on
 * top), then the rest in group order. With a query: by fuzzy score, ties to recent ones.
 */
export function rankActions(actions: PaletteAction[], query: string, recent: string[], text: (action: PaletteAction) => string): RankedAction[] {
  const recentIndex = new Map(recent.map((id, index) => [id, index]));
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    const recents = recent.map((id) => actions.find((a) => a.id === id)).filter((a): a is PaletteAction => Boolean(a));
    const rest = actions.filter((a) => !recentIndex.has(a.id)).sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    return [...recents.map((action) => ({ action, match: { score: 0, indexes: [] }, recent: true })), ...rest.map((action) => ({ action, match: { score: 0, indexes: [] }, recent: false }))];
  }
  const ranked: RankedAction[] = [];
  for (const action of actions) {
    const match = fuzzyMatch(trimmed, text(action));
    if (match) ranked.push({ action, match, recent: recentIndex.has(action.id) });
  }
  ranked.sort((a, b) => b.match.score - a.match.score || (recentIndex.get(a.action.id) ?? 99) - (recentIndex.get(b.action.id) ?? 99));
  return ranked;
}
