import { useStore } from '../../state/store.js';

/**
 * The contract between the action features and the editor feature. The editor owns the
 * document; everything else asks it to move, select or replace through `apex:editor`
 * CustomEvents and learns the current selection from `apex:editor-selection` events (the
 * store mirrors it in `editor.selection`). Offsets are character offsets into
 * `store.editor.body`. Nothing here depends on CodeMirror.
 */
export type EditorEvent =
  | { type: 'goto'; from: number; to?: number }
  | { type: 'replace'; from: number; to: number; text: string }
  | { type: 'insert'; at: number; text: string }
  | { type: 'focus' };

export const EDITOR_EVENT = 'apex:editor';
export const SELECTION_EVENT = 'apex:editor-selection';

export function dispatchEditor(detail: EditorEvent): void {
  window.dispatchEvent(new CustomEvent<EditorEvent>(EDITOR_EVENT, { detail }));
}

export interface Range {
  from: number;
  to: number;
  text: string;
}

/** The paragraph (a run of text between blank lines) around an offset, trimmed. */
export function paragraphAt(body: string, offset: number): Range {
  const at = Math.max(0, Math.min(offset, body.length));
  const separator = /\n[ \t]*\n/g;
  const paragraphs: Array<{ from: number; to: number }> = [];
  let start = 0;
  for (let m = separator.exec(body); m; m = separator.exec(body)) {
    paragraphs.push({ from: start, to: m.index });
    start = m.index + m[0].length;
  }
  paragraphs.push({ from: start, to: body.length });
  let found = paragraphs.find((p) => p.from <= at && at <= p.to);
  if (!found) found = [...paragraphs].reverse().find((p) => p.to < at) ?? paragraphs[0]!;
  let { from, to } = found;
  while (from < to && /\s/.test(body[from]!)) from += 1;
  while (to > from && /\s/.test(body[to - 1]!)) to -= 1;
  return { from, to, text: body.slice(from, to) };
}

/** The current selection as the store knows it, normalized so that from <= to. */
export function currentSelection(): Range {
  const { body, selection } = useStore.getState().editor;
  const from = Math.max(0, Math.min(selection.from, selection.to, body.length));
  const to = Math.max(from, Math.min(Math.max(selection.from, selection.to), body.length));
  return { from, to, text: body.slice(from, to) };
}

export interface SelectionOrParagraph extends Range {
  kind: 'selection' | 'paragraph';
  paragraph: Range;
}

/** The selection, or the paragraph under the caret when nothing is selected. */
export function selectionOrParagraph(): SelectionOrParagraph {
  const { body, cursor } = useStore.getState().editor;
  const selection = currentSelection();
  if (selection.text.trim().length > 0) {
    return { ...selection, kind: 'selection', paragraph: paragraphAt(body, selection.from) };
  }
  const paragraph = paragraphAt(body, cursor);
  return { ...paragraph, kind: 'paragraph', paragraph };
}

/**
 * Mirror `apex:editor-selection` events into the store so every feature reads one source
 * of truth. The editor may call `setCursor` itself; the mirror only writes when it differs.
 */
export function installSelectionMirror(): () => void {
  const onSelection = (event: Event) => {
    const detail = (event as CustomEvent<{ from: number; to: number; text?: string }>).detail;
    if (!detail || typeof detail.from !== 'number' || typeof detail.to !== 'number') return;
    const { selection, cursor } = useStore.getState().editor;
    if (selection.from === detail.from && selection.to === detail.to && cursor === detail.to) return;
    useStore.getState().setCursor(detail.to, { from: detail.from, to: detail.to });
  };
  window.addEventListener(SELECTION_EVENT, onSelection);
  return () => window.removeEventListener(SELECTION_EVENT, onSelection);
}
