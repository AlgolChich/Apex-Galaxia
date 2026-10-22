import { create } from 'zustand';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type { RewriteResult } from '../../api/types.js';
import { translate } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { currentSelection, type Range } from './editor-bridge.js';

/**
 * The small store the action features share: which dialog is open and with what payload.
 * The global store (`src/state/store.ts`) stays untouched; features that need a dialog
 * call `openDiff`, `openDescribe` or `openChronicleUpdate` here.
 */
export interface DiffPayload {
  /** What produced the result: a rewrite op (`tone`, `deai`…) or `weave`. */
  op: string;
  from: number;
  to: number;
  /** The original passage, exactly as it stands in the chapter body. */
  before: string;
  result: RewriteResult;
  model?: string;
  costUsd?: number;
}

export interface DescribePayload extends Range {
  kind: 'selection' | 'paragraph';
  paragraph: Range;
}

export interface CriticRequest {
  kind: 'critic' | 'bible';
  scope: 'chapter' | 'selection';
  nonce: number;
}

export type RewriteVars = { percent?: string; tone?: string; instruction?: string; viewpoint?: string; pov?: string; tense?: string };

export interface DialogsState {
  diff: DiffPayload | undefined;
  /** A rewrite or weave is running; the diff dialog shows a busy card meanwhile. */
  busy: { op: string; nonce: number } | undefined;
  describe: DescribePayload | undefined;
  chronicleUpdate: { chapter: number } | undefined;
  /** Bumped after `chronicle_apply` so the chronicle panel reloads. */
  chronicleVersion: number;
  criticRequest: CriticRequest | undefined;

  openDiff(payload: DiffPayload): void;
  closeDiff(): void;
  /** Rewrite the current selection with `op` and open the diff; a toast when nothing is selected. */
  runRewrite(op: string, vars?: RewriteVars): Promise<void>;
  /** Weave a detail into a paragraph range and open the diff for that range. */
  runWeave(paragraph: Range, detail: string): Promise<void>;
  cancelBusy(): void;
  openDescribe(payload: DescribePayload): void;
  closeDescribe(): void;
  openChronicleUpdate(chapter: number): void;
  closeChronicleUpdate(): void;
  bumpChronicle(): void;
  requestCritic(kind: CriticRequest['kind'], scope: CriticRequest['scope']): void;
}

let nonce = 0;

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export const useDialogs = create<DialogsState>((set) => ({
  diff: undefined,
  busy: undefined,
  describe: undefined,
  chronicleUpdate: undefined,
  chronicleVersion: 0,
  criticRequest: undefined,

  openDiff(payload) {
    set({ diff: payload, busy: undefined });
  },

  closeDiff() {
    set({ diff: undefined });
  },

  async runRewrite(op, vars = {}) {
    const selection = currentSelection();
    const language = useStore.getState().ui.language;
    if (selection.text.trim().length === 0) {
      useStore.getState().toast('info', translate(language, 'diff.needSelection'));
      return;
    }
    await runDiffTask(op, selection, () => getClient().rewrite(op, selection.text, vars));
  },

  async runWeave(paragraph, detail) {
    await runDiffTask('weave', paragraph, () => getClient().weave(paragraph.text, detail));
  },

  cancelBusy() {
    set({ busy: undefined });
  },

  openDescribe(payload) {
    set({ describe: payload });
  },

  closeDescribe() {
    set({ describe: undefined });
  },

  openChronicleUpdate(chapter) {
    set({ chronicleUpdate: { chapter } });
  },

  closeChronicleUpdate() {
    set({ chronicleUpdate: undefined });
  },

  bumpChronicle() {
    set((s) => ({ chronicleVersion: s.chronicleVersion + 1 }));
  },

  requestCritic(kind, scope) {
    nonce += 1;
    set({ criticRequest: { kind, scope, nonce } });
    const app = useStore.getState();
    if (app.ui.panel !== 'critic') app.togglePanel('critic');
  },

}));

/** Run a model call that yields a RewriteResult for a range, with a busy card and a cancel token. */
async function runDiffTask(op: string, range: Range, task: () => Promise<RewriteResult>): Promise<void> {
  nonce += 1;
  const mine = nonce;
  useDialogs.setState({ busy: { op, nonce: mine }, diff: undefined });
  try {
    const result = await task();
    if (useDialogs.getState().busy?.nonce !== mine) return; // cancelled meanwhile
    useDialogs.getState().openDiff({ op, from: range.from, to: range.to, before: range.text, result, ...(result.model ? { model: result.model } : {}), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) });
  } catch (error) {
    if (useDialogs.getState().busy?.nonce === mine) useDialogs.setState({ busy: undefined });
    useStore.getState().toast('error', errorText(error));
  }
}

/** Open the diff dialog for a passage; the palette and the Describe feature use it. */
export function openDiff(payload: DiffPayload): void {
  useDialogs.getState().openDiff(payload);
}

/** Open the Describe dialog for a range of the chapter body. */
export function openDescribe(payload: DescribePayload): void {
  useDialogs.getState().openDescribe(payload);
}

/** Open the chronicle update dialog for a chapter number. */
export function openChronicleUpdate(chapter: number): void {
  useDialogs.getState().openChronicleUpdate(chapter);
}
