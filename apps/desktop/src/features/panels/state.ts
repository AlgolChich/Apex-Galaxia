import { create } from 'zustand';
import type { CriticResult } from '../../api/types.js';

/**
 * Results the right panel keeps across tab switches: the last critic or Bible check and
 * which palette request it already handled. The panel itself unmounts when closed.
 */
export interface CriticState {
  kind: 'critic' | 'bible';
  scope: 'chapter' | 'selection';
  result: CriticResult | undefined;
  error: string | undefined;
  busy: boolean;
}

interface PanelsState {
  critic: CriticState | undefined;
  handledCritic: number;
  setCritic(state: CriticState | undefined): void;
  setHandledCritic(nonce: number): void;
}

export const usePanels = create<PanelsState>((set) => ({
  critic: undefined,
  handledCritic: 0,
  setCritic(critic) {
    set({ critic });
  },
  setHandledCritic(handledCritic) {
    set({ handledCritic });
  },
}));
