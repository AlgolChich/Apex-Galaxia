import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap } from '@codemirror/view';
import { getClient } from '../../api/index.js';
import type { LintHit } from '../../api/types.js';
import { pick, translate } from '../../i18n/index.js';
import { useStore, type AppState } from '../../state/store.js';
import { useEditorSettings } from './editor-store.js';
import { EDITOR_EVENT, SELECTION_EVENT, editorMounted, editorUnmounted, isEditorCommand, type EditorCommand, type EditorSelectionDetail } from './events.js';
import { lintField, lintHover, proseHighlight, proseTheme, searchPhrases, setLintHits, typewriterScrolling } from './extensions.js';

export const BODY_DEBOUNCE_MS = 150;
export const SELECTION_DEBOUNCE_MS = 100;
export const LINT_IDLE_MS = 1500;
export const SAVE_IDLE_MS = 2000;

export interface EditorController {
  readonly view: EditorView;
  /** Push the document into the store now (normally debounced). */
  flush(): void;
  destroy(): void;
}

/** The smallest single change that turns `before` into `after` (common prefix and suffix). */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix += 1;
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) };
}

function contentAttributes(state: AppState): Record<string, string> {
  return {
    spellcheck: 'true',
    autocorrect: 'on',
    autocapitalize: 'sentences',
    lang: state.project.config?.language ?? state.ui.language,
    'aria-label': translate(state.ui.language, 'editor.label'),
  };
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The hover card of a lint underline: severity, rule id, the message, one-click whitelist. */
function renderLintTip(hit: LintHit): HTMLElement {
  const language = useStore.getState().ui.language;
  const root = element('div', 'editor-lint-tip');
  const head = element('div', 'editor-lint-tip__head');
  head.append(
    element('span', `editor-lint-tip__severity editor-lint-tip__severity--${hit.severity}`, translate(language, `editor.lint.severity.${hit.severity}`)),
    element('code', 'editor-lint-tip__rule', hit.rule),
  );
  const message = element('div', 'editor-lint-tip__message', pick(language, hit.message));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small editor-lint-tip__action';
  button.textContent = translate(language, 'editor.lint.whitelist');
  button.addEventListener('click', () => {
    button.disabled = true;
    void whitelist(hit).finally(() => {
      button.disabled = false;
    });
  });
  root.append(head, message, button);
  return root;
}

async function whitelist(hit: LintHit): Promise<void> {
  const state = useStore.getState();
  const language = state.ui.language;
  try {
    const result = await getClient().lintWhitelistAdd(hit.excerpt);
    state.toast('success', translate(language, result.added ? 'editor.lint.whitelisted' : 'editor.lint.alreadyWhitelisted', { phrase: result.phrase }));
    await useStore.getState().runLint();
  } catch (error) {
    state.toast('error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Mount CodeMirror into `host` for the chapter `stem` and keep it in step with the store:
 * edits flow to `setBody` (debounced), external bodies flow back as minimal changes, lint
 * hits become underlines, `apex:editor` commands are executed, and idle timers lint and save.
 */
export function mountEditor(host: HTMLElement, stem: string): EditorController {
  const store = useStore;
  const initial = store.getState();
  const typewriterSlot = new Compartment();
  const phrasesSlot = new Compartment();
  const attributesSlot = new Compartment();

  let synced = initial.editor.body;
  let destroyed = false;
  let bodyTimer: number | undefined;
  let selectionTimer: number | undefined;
  let lintTimer: number | undefined;
  let saveTimer: number | undefined;
  let lastSelection = { from: -1, to: -1, head: -1 };

  const clear = (id: number | undefined) => {
    if (id !== undefined) window.clearTimeout(id);
  };

  function flush(): void {
    clear(bodyTimer);
    bodyTimer = undefined;
    if (destroyed) return;
    const text = view.state.doc.toString();
    if (text === synced) return;
    synced = text;
    store.getState().setBody(text);
  }

  function scheduleBody(): void {
    clear(bodyTimer);
    bodyTimer = window.setTimeout(flush, BODY_DEBOUNCE_MS);
  }

  function scheduleIdle(): void {
    clear(lintTimer);
    lintTimer = window.setTimeout(() => {
      lintTimer = undefined;
      flush();
      const state = store.getState();
      if (state.project.root && state.editor.stem === stem) void state.runLint();
    }, LINT_IDLE_MS);
    clear(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      save();
    }, SAVE_IDLE_MS);
  }

  function save(): void {
    flush();
    clear(saveTimer);
    saveTimer = undefined;
    const state = store.getState();
    if (state.editor.stem === stem) void state.saveChapter();
  }

  function syncSelection(state: EditorState): void {
    const { from, to, head } = state.selection.main;
    if (from === lastSelection.from && to === lastSelection.to && head === lastSelection.head) return;
    lastSelection = { from, to, head };
    store.getState().setCursor(head, { from, to });
    clear(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      selectionTimer = undefined;
      if (destroyed) return;
      const main = view.state.selection.main;
      const detail: EditorSelectionDetail = { from: main.from, to: main.to, text: view.state.sliceDoc(main.from, main.to) };
      window.dispatchEvent(new CustomEvent<EditorSelectionDetail>(SELECTION_EVENT, { detail }));
    }, SELECTION_DEBOUNCE_MS);
  }

  const cursor = Math.max(0, Math.min(initial.editor.cursor, initial.editor.body.length));
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: initial.editor.body,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              save();
              return true;
            },
          },
          {
            key: 'Mod-Enter',
            run: () => {
              flush();
              void store.getState().write('continue');
              return true;
            },
          },
          {
            key: 'Mod-Shift-f',
            run: () => {
              store.getState().toggleFocus();
              return true;
            },
          },
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        history(),
        drawSelection(),
        dropCursor(),
        search({ top: true }),
        markdown(),
        EditorView.lineWrapping,
        proseTheme,
        proseHighlight,
        lintField,
        lintHover(renderLintTip),
        attributesSlot.of(EditorView.contentAttributes.of(contentAttributes(initial))),
        phrasesSlot.of(searchPhrases(initial.ui.language)),
        typewriterSlot.of(useEditorSettings.getState().typewriter ? typewriterScrolling : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            scheduleBody();
            scheduleIdle();
          }
          if (update.docChanged || update.selectionSet) syncSelection(update.state);
        }),
        EditorView.domEventHandlers({
          blur: () => {
            save();
          },
        }),
      ],
    }),
  });

  function applyExternalBody(next: string): void {
    const current = view.state.doc.toString();
    clear(bodyTimer);
    bodyTimer = undefined;
    synced = next;
    if (current === next) return;
    const change = minimalChange(current, next);
    view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
  }

  function applyLint(state: AppState): void {
    const hits = state.lint.report && state.lint.stem === stem ? state.lint.report.hits : [];
    view.dispatch({ effects: setLintHits.of(hits) });
  }

  function runCommand(command: EditorCommand): void {
    const length = view.state.doc.length;
    const clamp = (n: number) => Math.max(0, Math.min(Math.floor(n), length));
    switch (command.type) {
      case 'goto': {
        const from = clamp(command.from);
        const to = command.to === undefined ? from : clamp(command.to);
        view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
        view.focus();
        break;
      }
      case 'replace': {
        const from = clamp(command.from);
        const to = Math.max(from, clamp(command.to));
        const end = from + command.text.length;
        view.dispatch({
          changes: { from, to, insert: command.text },
          selection: EditorSelection.cursor(end),
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
          userEvent: 'input.replace',
        });
        flush();
        scheduleIdle();
        break;
      }
      case 'insert': {
        const at = clamp(command.at);
        view.dispatch({
          changes: { from: at, insert: command.text },
          selection: EditorSelection.cursor(at + command.text.length),
          effects: EditorView.scrollIntoView(at, { y: 'center' }),
          userEvent: 'input.insert',
        });
        flush();
        scheduleIdle();
        break;
      }
      case 'focus':
        view.focus();
        break;
    }
  }

  const onCommand = (event: Event) => {
    if (destroyed) return;
    const detail = (event as CustomEvent<unknown>).detail;
    if (isEditorCommand(detail)) runCommand(detail);
  };
  window.addEventListener(EDITOR_EVENT, onCommand);

  // Clicks in the margins beside the measure still place the caret and focus the editor.
  const onHostMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (!target || view.contentDOM.contains(target) || !view.scrollDOM.contains(target)) return;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    view.dispatch({ selection: EditorSelection.cursor(pos) });
    view.focus();
    event.preventDefault();
  };
  host.addEventListener('mousedown', onHostMouseDown);

  const unsubscribeStore = store.subscribe((state, prev) => {
    if (destroyed || state.editor.stem !== stem) return;
    if (state.editor.body !== prev.editor.body && state.editor.body !== synced) applyExternalBody(state.editor.body);
    if (state.lint.report !== prev.lint.report || state.lint.stem !== prev.lint.stem) applyLint(state);
    if (state.ui.language !== prev.ui.language || state.project.config?.language !== prev.project.config?.language) {
      view.dispatch({
        effects: [phrasesSlot.reconfigure(searchPhrases(state.ui.language)), attributesSlot.reconfigure(EditorView.contentAttributes.of(contentAttributes(state)))],
      });
    }
  });

  const unsubscribeSettings = useEditorSettings.subscribe((settings, prev) => {
    if (destroyed || settings.typewriter === prev.typewriter) return;
    view.dispatch({ effects: typewriterSlot.reconfigure(settings.typewriter ? typewriterScrolling : []) });
    if (settings.typewriter) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
  });

  applyLint(initial);
  syncSelection(view.state);
  view.dispatch({ effects: EditorView.scrollIntoView(cursor, { y: 'center' }) });
  view.focus();
  const pending = editorMounted();
  if (pending) runCommand(pending);

  return {
    view,
    flush,
    destroy() {
      if (destroyed) return;
      unsubscribeStore();
      unsubscribeSettings();
      window.removeEventListener(EDITOR_EVENT, onCommand);
      host.removeEventListener('mousedown', onHostMouseDown);
      clear(lintTimer);
      clear(selectionTimer);
      // Leaving the chapter (another view, app close): keep what was typed in the last 150 ms.
      if (store.getState().editor.stem === stem) save();
      else clear(bodyTimer);
      destroyed = true;
      editorUnmounted();
      view.destroy();
    },
  };
}
