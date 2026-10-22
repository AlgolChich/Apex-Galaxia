import { create } from 'zustand';

/**
 * Palette-local state shared with the global shortcut listener: a shortcut that needs
 * input (a beat, a title, rewrite variables) opens the palette straight on that action's
 * form instead of running blind.
 */
interface PaletteState {
  formAction: string | undefined;
  setFormAction(id: string | undefined): void;
}

export const usePaletteState = create<PaletteState>((set) => ({
  formAction: undefined,
  setFormAction(id) {
    set({ formAction: id });
  },
}));

const RECENT_KEY = 'apex.palette.recent';
const RECENT_MAX = 8;

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string): string[] {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: recency just does not persist
  }
  return next;
}
