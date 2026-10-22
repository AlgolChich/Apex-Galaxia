import { create } from 'zustand';
import type { WriteMode } from '../../state/store.js';

export const CANDIDATE_MODES: WriteMode[] = ['continue', 'guided', 'scene', 'chapter'];

/** What opens the dialog: the `apex:candidates` window event carries the mode and, optionally, a beat or a title. */
export interface CandidatesRequest {
  mode: WriteMode;
  instruction?: string;
  title?: string;
  /** Bumped per open so the dialog body remounts with a clean form. */
  nonce: number;
}

interface CandidatesState {
  request: CandidatesRequest | undefined;
  open(request: Omit<CandidatesRequest, 'nonce'>): void;
  close(): void;
}

let nonce = 0;

/**
 * The small store of the candidates feature: whether the dialog is open and with what. The
 * phases inside (form, drafting, comparison, chronicle offer) live in the component.
 */
export const useCandidates = create<CandidatesState>((set) => ({
  request: undefined,
  open(request) {
    nonce += 1;
    set({ request: { ...request, nonce } });
  },
  close() {
    set({ request: undefined });
  },
}));

/** The event detail as the palette (and anything else) dispatches it; unknown modes fall back to `continue`. */
export function requestOfDetail(detail: unknown): Omit<CandidatesRequest, 'nonce'> {
  const d = (detail ?? {}) as { mode?: unknown; instruction?: unknown; title?: unknown };
  const mode = CANDIDATE_MODES.find((m) => m === d.mode) ?? 'continue';
  return {
    mode,
    ...(typeof d.instruction === 'string' && d.instruction.trim() ? { instruction: d.instruction } : {}),
    ...(typeof d.title === 'string' && d.title.trim() ? { title: d.title } : {}),
  };
}

/** Open the candidates dialog from code (the palette dispatches the window event instead). */
export function openCandidates(request: Omit<CandidatesRequest, 'nonce'>): void {
  useCandidates.getState().open(request);
}
