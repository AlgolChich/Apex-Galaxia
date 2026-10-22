import { create } from 'zustand';
import type { RunEvent, RunState } from '../../api/types.js';

/** The streamed chapter text is capped so a long run never grows the DOM without bound. */
export const TEXT_CAP = 20_000;

export interface LiveRun {
  id: string;
  status: RunState['status'] | undefined;
  stage: RunState['stage'] | undefined;
  nextChapter: number | undefined;
  completed: number | undefined;
  target: number | undefined;
  costUsd: number | undefined;
  error: string | undefined;
  log: string[];
  text: string;
  final: boolean;
  pausing: boolean;
}

export interface RunStore {
  runs: RunState[];
  live: LiveRun | undefined;
  setRuns(runs: RunState[]): void;
  /** Make a run the one on screen, seeded from its saved state. */
  watch(state: RunState): void;
  applyEvent(event: RunEvent): void;
  setPausing(id: string): void;
  clear(): void;
}

export function liveOf(state: RunState): LiveRun {
  return { id: state.id, status: state.status, stage: state.stage, nextChapter: state.next_chapter, completed: state.completed.length, target: state.target_chapters, costUsd: state.cost_usd, error: state.error, log: [...state.log], text: '', final: state.status === 'completed' || state.status === 'failed', pausing: false };
}

export const useRunStore = create<RunStore>((set) => ({
  runs: [],
  live: undefined,
  setRuns: (runs) => set({ runs }),
  watch: (state) => set({ live: liveOf(state) }),
  applyEvent: (event) =>
    set((s) => {
      const current = s.live && s.live.id === event.run_id ? s.live : { id: event.run_id, status: undefined, stage: undefined, nextChapter: undefined, completed: undefined, target: undefined, costUsd: undefined, error: undefined, log: [], text: '', final: false, pausing: false };
      if (s.live && s.live.id !== event.run_id && s.live.status === 'running' && !event.final) return s;
      const text = event.delta ? (current.text + event.delta).slice(-TEXT_CAP) : current.text;
      const next: LiveRun = {
        ...current,
        status: event.status ?? current.status,
        stage: event.stage ?? current.stage,
        nextChapter: event.next_chapter ?? current.nextChapter,
        completed: event.completed ?? current.completed,
        target: event.target ?? current.target,
        costUsd: event.cost_usd ?? current.costUsd,
        error: event.error ?? current.error,
        log: event.message ? [...current.log, event.message] : current.log,
        text,
        final: current.final || Boolean(event.final),
        pausing: event.final || event.status === 'paused' ? false : current.pausing,
      };
      return { live: next };
    }),
  setPausing: (id) => set((s) => (s.live && s.live.id === id ? { live: { ...s.live, pausing: true } } : s)),
  clear: () => set({ live: undefined }),
}));
