import { create } from 'zustand';

export const TREE_MIN = 180;
export const TREE_MAX = 480;
export const TREE_DEFAULT = 256;
export const PANEL_MIN = 240;
export const PANEL_MAX = 720;
export const PANEL_DEFAULT = 352;

const KEY = 'apex.frame';

interface Persisted {
  tree?: number;
  panel?: number;
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function write(value: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // private mode or a test environment without storage
  }
}

export function clampWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.max(min, Math.min(max, value)));
}

/** Widths of the tree and the right panel in pixels, persisted per machine. */
export interface FrameState {
  treeWidth: number;
  panelWidth: number;
  setTreeWidth(px: number): void;
  setPanelWidth(px: number): void;
}

const saved = read();

export const useFrame = create<FrameState>((set, get) => ({
  treeWidth: clampWidth(saved.tree ?? TREE_DEFAULT, TREE_MIN, TREE_MAX),
  panelWidth: clampWidth(saved.panel ?? PANEL_DEFAULT, PANEL_MIN, PANEL_MAX),
  setTreeWidth(px) {
    const treeWidth = clampWidth(px, TREE_MIN, TREE_MAX);
    if (treeWidth === get().treeWidth) return;
    set({ treeWidth });
    write({ tree: treeWidth, panel: get().panelWidth });
  },
  setPanelWidth(px) {
    const panelWidth = clampWidth(px, PANEL_MIN, PANEL_MAX);
    if (panelWidth === get().panelWidth) return;
    set({ panelWidth });
    write({ tree: get().treeWidth, panel: panelWidth });
  },
}));
