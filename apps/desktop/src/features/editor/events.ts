/**
 * The cross-feature contract of the editor. Other features (panels, palette, diffs) never hold
 * the CodeMirror view; they dispatch `apex:editor` CustomEvents on `window` and listen for
 * `apex:editor-selection`. Offsets are character offsets into `store.editor.body`, the chapter
 * body without front matter, the same offsets the linter reports.
 */
export const EDITOR_EVENT = 'apex:editor';
export const SELECTION_EVENT = 'apex:editor-selection';

export type EditorCommand =
  /** Scroll to and select the range (a caret when `to` is missing), then focus the editor. */
  | { type: 'goto'; from: number; to?: number }
  /** Replace the range with `text`; the store body follows at once. */
  | { type: 'replace'; from: number; to: number; text: string }
  /** Insert `text` at `at`; the store body follows at once. */
  | { type: 'insert'; at: number; text: string }
  | { type: 'focus' };

export interface EditorSelectionDetail {
  from: number;
  to: number;
  text: string;
}

export function sendEditorCommand(command: EditorCommand): void {
  window.dispatchEvent(new CustomEvent<EditorCommand>(EDITOR_EVENT, { detail: command }));
}

export function isEditorCommand(value: unknown): value is EditorCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  switch (v['type']) {
    case 'goto':
      return typeof v['from'] === 'number' && (v['to'] === undefined || typeof v['to'] === 'number');
    case 'replace':
      return typeof v['from'] === 'number' && typeof v['to'] === 'number' && typeof v['text'] === 'string';
    case 'insert':
      return typeof v['at'] === 'number' && typeof v['text'] === 'string';
    case 'focus':
      return true;
    default:
      return false;
  }
}

// A command sent while no editor is mounted (for example right after `setView('editor')`,
// before React has rendered it) is kept until the next editor mounts, so a lint-panel click
// from another view still lands.
let mounted = 0;
let pending: EditorCommand | undefined;

if (typeof window !== 'undefined') {
  window.addEventListener(EDITOR_EVENT, (event) => {
    if (mounted > 0) return;
    const detail = (event as CustomEvent<unknown>).detail;
    if (isEditorCommand(detail)) pending = detail;
  });
}

/** Called by the editor controller at mount; returns a command that arrived before it. */
export function editorMounted(): EditorCommand | undefined {
  mounted += 1;
  const command = pending;
  pending = undefined;
  return command;
}

export function editorUnmounted(): void {
  mounted = Math.max(0, mounted - 1);
}
