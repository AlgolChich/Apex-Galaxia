import { create } from 'zustand';
import type { IrreversibleChoice, RunEvent, RunState } from '../../api/types.js';

/** The streamed chapter text is capped so a long run never grows the DOM without bound. */
export const TEXT_CAP = 20_000;

/** The ASK gate as the screen shows it: the chapter and the choices the story cannot take back. */
export interface PendingDecision {
  chapter: number;
  items: IrreversibleChoice[];
}

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
  /** Set while the run waits at the ASK gate (status `awaiting_decision`). */
  pendingDecision: PendingDecision | undefined;
  /** The decision card is on screen; Stop hides it, Decide in the list brings it back. */
  decisionOpen: boolean;
}

export interface RunStore {
  runs: RunState[];
  live: LiveRun | undefined;
  setRuns(runs: RunState[]): void;
  /** Make a run the one on screen, seeded from its saved state. */
  watch(state: RunState): void;
  applyEvent(event: RunEvent): void;
  setPausing(id: string): void;
  /** Hide the decision card of the live run without resuming it (the run stays paused at the gate). */
  dismissDecision(id: string): void;
  /** Bring a hidden decision card back (the Decide button). */
  reopenDecision(id: string): void;
  clear(): void;
}

function emptyLive(id: string): LiveRun {
  return { id, status: undefined, stage: undefined, nextChapter: undefined, completed: undefined, target: undefined, costUsd: undefined, error: undefined, log: [], text: '', final: false, pausing: false, pendingDecision: undefined, decisionOpen: false };
}

export function liveOf(state: RunState): LiveRun {
  const pendingDecision = state.status === 'awaiting_decision' && state.pending_decision ? state.pending_decision : undefined;
  return {
    ...emptyLive(state.id),
    status: state.status,
    stage: state.stage,
    nextChapter: state.next_chapter,
    completed: state.completed.length,
    target: state.target_chapters,
    costUsd: state.cost_usd,
    error: state.error,
    log: [...state.log],
    final: state.status === 'completed' || state.status === 'failed',
    pendingDecision,
    decisionOpen: pendingDecision !== undefined,
  };
}

/** The decision after an event: a new one opens the card; any other status clears it. */
function decisionAfter(current: LiveRun, event: RunEvent): Pick<LiveRun, 'pendingDecision' | 'decisionOpen'> {
  if (event.pending_decision) return { pendingDecision: event.pending_decision, decisionOpen: true };
  if (event.status && event.status !== 'awaiting_decision') return { pendingDecision: undefined, decisionOpen: false };
  return { pendingDecision: current.pendingDecision, decisionOpen: current.decisionOpen };
}

export const useRunStore = create<RunStore>((set) => ({
  runs: [],
  live: undefined,
  setRuns: (runs) => set({ runs }),
  watch: (state) => set({ live: liveOf(state) }),
  applyEvent: (event) =>
    set((s) => {
      const current = s.live && s.live.id === event.run_id ? s.live : emptyLive(event.run_id);
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
        ...decisionAfter(current, event),
      };
      return { live: next };
    }),
  setPausing: (id) => set((s) => (s.live && s.live.id === id ? { live: { ...s.live, pausing: true } } : s)),
  dismissDecision: (id) => set((s) => (s.live && s.live.id === id ? { live: { ...s.live, decisionOpen: false } } : s)),
  reopenDecision: (id) => set((s) => (s.live && s.live.id === id && s.live.pendingDecision ? { live: { ...s.live, decisionOpen: true } } : s)),
  clear: () => set({ live: undefined }),
}));
