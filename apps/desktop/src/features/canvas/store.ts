import { create } from 'zustand';
import { ToolError } from '../../api/mcp.js';
import type { EntryKind } from '../../api/types.js';
import { translate } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { canvasAdd, canvasGet, canvasLink, canvasPromoteToBible, canvasPromoteToPlan, canvasRemove, canvasTemplate, canvasUpdate, readingOrder, type BoardCard, type BoardState, type BoardTemplate, type CardPatch, type NewCardInput } from './api.js';
import { laneAt, snap } from './viewport.js';

export type AiAction = 'directions' | 'expand' | 'whatif' | 'guns' | 'collapse';

export interface CanvasState {
  board: BoardState | undefined;
  /** The project root the board belongs to; a different root reloads. */
  root: string | undefined;
  loading: boolean;
  error: string | undefined;
  selectedId: string | undefined;
  /** Link mode: the source card and the label typed so far. */
  linking: { from: string; label: string } | undefined;
  editorOpen: boolean;
  addOpen: boolean;
  /** The card a confirmation dialog asks about. */
  removing: string | undefined;
  ai: AiAction | undefined;

  load(root: string | undefined): Promise<void>;
  select(id: string | undefined): void;
  /** Drop after a drag: snap to the grid, send x/y (and the lane when the band under the card changed). */
  moveCard(id: string, x: number, y: number): Promise<void>;
  /** Keyboard nudge: moves at once, the server call follows after a pause. */
  nudgeCard(id: string, dx: number, dy: number): void;
  patchCard(id: string, patch: CardPatch): Promise<boolean>;
  addCard(input: NewCardInput, at: { x: number; y: number } | undefined): Promise<BoardCard | undefined>;
  removeCard(id: string): Promise<void>;
  link(from: string, to: string, label?: string): Promise<boolean>;
  setTemplate(template: BoardTemplate): Promise<void>;
  promoteToBible(id: string, kind: EntryKind): Promise<void>;
  promoteToPlan(id: string, chapter: number): Promise<void>;

  startLinking(from: string): void;
  setLinkLabel(label: string): void;
  cancelLinking(): void;
  openEditor(id?: string): void;
  closeEditor(): void;
  openAdd(): void;
  closeAdd(): void;
  askRemove(id: string): void;
  cancelRemove(): void;
  openAi(action: AiAction): void;
  closeAi(): void;
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function tr(key: string, vars?: Record<string, string | number>): string {
  return translate(useStore.getState().ui.language, key, vars);
}

function toast(kind: 'info' | 'error' | 'success', text: string): void {
  useStore.getState().toast(kind, text);
}

function withCards(board: BoardState, cards: BoardCard[]): BoardState {
  return { ...board, cards, order: readingOrder(cards, board.lanes) };
}

function replaceCard(board: BoardState, id: string, next: BoardCard): BoardState {
  return withCards(
    board,
    board.cards.map((c) => (c.id === id ? next : c)),
  );
}

/** Lanes the server lists plus any lane a card now mentions, in the server's order. */
function withLane(board: BoardState, lane: string | undefined): string[] {
  if (!lane || board.lanes.includes(lane)) return board.lanes;
  return [...board.lanes, lane];
}

const nudgeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const NUDGE_COMMIT_MS = 350;

export const useCanvas = create<CanvasState>((set, get) => ({
  board: undefined,
  root: undefined,
  loading: false,
  error: undefined,
  selectedId: undefined,
  linking: undefined,
  editorOpen: false,
  addOpen: false,
  removing: undefined,
  ai: undefined,

  async load(root) {
    if (!root) {
      set({ board: undefined, root: undefined, selectedId: undefined, linking: undefined, editorOpen: false });
      return;
    }
    const switching = root !== get().root;
    set({ loading: true, error: undefined, root, ...(switching ? { board: undefined, selectedId: undefined, linking: undefined, editorOpen: false } : {}) });
    try {
      const board = await canvasGet();
      const selected = get().selectedId;
      set({ board, loading: false, selectedId: selected && board.cards.some((c) => c.id === selected) ? selected : undefined });
    } catch (error) {
      set({ loading: false, error: errorText(error) });
    }
  },

  select(id) {
    set({ selectedId: id, ...(id === undefined ? { editorOpen: false } : {}) });
  },

  async moveCard(id, x, y) {
    const board = get().board;
    const card = board?.cards.find((c) => c.id === id);
    if (!board || !card) return;
    const nx = snap(x);
    const ny = snap(y);
    const band = laneAt(nx, board.lanes);
    const laneChanged = band !== undefined && band !== card.lane;
    const patch: CardPatch = { x: nx, y: ny, ...(laneChanged ? { lane: band } : {}) };
    if (nx === card.x && ny === card.y && !laneChanged) return;
    const next: BoardCard = { ...card, x: nx, y: ny, ...(laneChanged ? { lane: band } : {}) };
    set({ board: replaceCard(board, id, next) });
    try {
      await canvasUpdate(id, patch);
    } catch (error) {
      const current = get().board;
      if (current) set({ board: replaceCard(current, id, card) });
      toast('error', errorText(error));
    }
  },

  nudgeCard(id, dx, dy) {
    const board = get().board;
    const card = board?.cards.find((c) => c.id === id);
    if (!board || !card) return;
    const next: BoardCard = { ...card, x: snap(card.x + dx), y: snap(card.y + dy) };
    set({ board: replaceCard(board, id, next) });
    const pending = nudgeTimers.get(id);
    if (pending) clearTimeout(pending);
    nudgeTimers.set(
      id,
      setTimeout(() => {
        nudgeTimers.delete(id);
        const latest = get().board?.cards.find((c) => c.id === id);
        if (!latest) return;
        const band = laneAt(latest.x, get().board?.lanes ?? []);
        const laneChanged = band !== undefined && band !== latest.lane;
        if (laneChanged) {
          const current = get().board;
          if (current) set({ board: replaceCard(current, id, { ...latest, lane: band }) });
        }
        canvasUpdate(id, { x: latest.x, y: latest.y, ...(laneChanged ? { lane: band } : {}) }).catch((error: unknown) => toast('error', errorText(error)));
      }, NUDGE_COMMIT_MS),
    );
  },

  async patchCard(id, patch) {
    const board = get().board;
    const card = board?.cards.find((c) => c.id === id);
    if (!board || !card) return false;
    try {
      const saved = await canvasUpdate(id, patch);
      const { lane, ...merged } = { ...card, ...patch };
      const next: BoardCard = saved ?? { ...merged, ...(lane ? { lane } : {}) };
      const current = get().board ?? board;
      set({ board: withCards({ ...current, lanes: withLane(current, next.lane) }, current.cards.map((c) => (c.id === id ? next : c))) });
      return true;
    } catch (error) {
      toast('error', errorText(error));
      return false;
    }
  },

  async addCard(input, at) {
    try {
      // The position travels with the add call; the server stores it, so one call places the card.
      const placed = at ? { x: snap(at.x), y: snap(at.y) } : undefined;
      const band = placed && !input.lane ? laneAt(placed.x, get().board?.lanes ?? []) : undefined;
      const created = await canvasAdd({ ...input, ...(placed ?? {}), ...(band ? { lane: band } : {}) });
      const card = placed ? { ...created, ...placed, ...(band ? { lane: band } : {}) } : created;
      const board = get().board ?? { template: 'none', lanes: [], cards: [], order: [] };
      set({ board: withCards({ ...board, lanes: withLane(board, card.lane) }, [...board.cards.filter((c) => c.id !== card.id), card]), selectedId: card.id });
      return card;
    } catch (error) {
      toast('error', errorText(error));
      return undefined;
    }
  },

  async removeCard(id) {
    const board = get().board;
    if (!board) return;
    try {
      await canvasRemove(id);
      const current = get().board ?? board;
      const cards = current.cards.filter((c) => c.id !== id).map((c) => ({ ...c, links: c.links.filter((l) => l.to !== id) }));
      set({ board: withCards(current, cards), removing: undefined, ...(get().selectedId === id ? { selectedId: undefined, editorOpen: false } : {}), ...(get().linking?.from === id ? { linking: undefined } : {}) });
      toast('success', tr('canvas.removed'));
    } catch (error) {
      set({ removing: undefined });
      toast('error', errorText(error));
    }
  },

  async link(from, to, label) {
    const board = get().board;
    if (!board) return false;
    if (from === to) {
      toast('error', tr('canvas.link.self'));
      return false;
    }
    const source = board.cards.find((c) => c.id === from);
    if (!source || !board.cards.some((c) => c.id === to)) return false;
    try {
      await canvasLink(from, to, label);
      const current = get().board ?? board;
      const src = current.cards.find((c) => c.id === from) ?? source;
      if (!src.links.some((l) => l.to === to)) {
        set({ board: replaceCard(current, from, { ...src, links: [...src.links, label ? { to, label } : { to }] }) });
      }
      set({ linking: undefined });
      toast('success', tr('canvas.link.done'));
      return true;
    } catch (error) {
      toast('error', errorText(error));
      return false;
    }
  },

  async setTemplate(template) {
    const board = get().board;
    try {
      const templateLanes = await canvasTemplate(template);
      const current = get().board ?? board;
      if (!current) return;
      const extra = [...new Set(current.cards.map((c) => c.lane).filter((l): l is string => Boolean(l) && !templateLanes.includes(l as string)))].sort();
      const lanes = [...templateLanes, ...extra];
      set({ board: { ...current, template, lanes, order: readingOrder(current.cards, lanes) } });
    } catch (error) {
      toast('error', errorText(error));
    }
  },

  async promoteToBible(id, kind) {
    try {
      const result = await canvasPromoteToBible(id, kind);
      toast('success', tr('canvas.promote.bible.done', { entry: `${kind}/${result.entry}` }));
      await get().load(get().root);
    } catch (error) {
      toast('error', errorText(error));
    }
  },

  async promoteToPlan(id, chapter) {
    try {
      await canvasPromoteToPlan(id, chapter);
      toast('success', tr('canvas.promote.plan.done', { chapter }));
      await get().load(get().root);
    } catch (error) {
      toast('error', errorText(error));
    }
  },

  startLinking(from) {
    set({ linking: { from, label: '' }, selectedId: from });
  },

  setLinkLabel(label) {
    const linking = get().linking;
    if (linking) set({ linking: { ...linking, label } });
  },

  cancelLinking() {
    set({ linking: undefined });
  },

  openEditor(id) {
    const selectedId = id ?? get().selectedId;
    if (!selectedId) return;
    set({ selectedId, editorOpen: true });
  },

  closeEditor() {
    set({ editorOpen: false });
  },

  openAdd() {
    set({ addOpen: true });
  },

  closeAdd() {
    set({ addOpen: false });
  },

  askRemove(id) {
    set({ removing: id });
  },

  cancelRemove() {
    set({ removing: undefined });
  },

  openAi(action) {
    set({ ai: action });
  },

  closeAi() {
    set({ ai: undefined });
  },
}));

/** The selected card, if any. */
export function selectedCard(state: CanvasState): BoardCard | undefined {
  return state.selectedId ? state.board?.cards.find((c) => c.id === state.selectedId) : undefined;
}

/** For tests: forget everything (the shared client may have been replaced). */
export function resetCanvasStore(): void {
  for (const timer of nudgeTimers.values()) clearTimeout(timer);
  nudgeTimers.clear();
  useCanvas.setState({ board: undefined, root: undefined, loading: false, error: undefined, selectedId: undefined, linking: undefined, editorOpen: false, addOpen: false, removing: undefined, ai: undefined });
}
