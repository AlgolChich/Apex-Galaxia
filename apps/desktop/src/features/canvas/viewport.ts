/**
 * Viewport math for the board. World coordinates are the card x/y the server stores; the
 * screen shows `world * scale + offset`. Everything here is pure so the tests can pin it down.
 */

export interface Viewport {
  /** Screen offset of the world origin, in CSS pixels. */
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const GRID = 8;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;
export const ZOOM_STEP = 1.2;
/** Cards share one width so links and lanes can be laid out without measuring text. */
export const CARD_WIDTH = 240;
/** Height assumed before the DOM has been measured (title, kind, three lines of text). */
export const CARD_MIN_HEIGHT = 96;
export const LANE_WIDTH = 320;
/** Lanes are drawn as very tall bands so they look infinite at any zoom the limits allow. */
export const LANE_TOP = -4000;
export const LANE_HEIGHT = 40000;
export const DEFAULT_VIEWPORT: Viewport = { x: 48, y: 48, scale: 1 };
/** A surface that has not been laid out yet (tests, the first frame) gets this size. */
export const FALLBACK_SIZE: Size = { width: 800, height: 600 };

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zoom by `factor` keeping the world point under the screen point (sx, sy) where it is. */
export function zoomAt(viewport: Viewport, factor: number, sx: number, sy: number): Viewport {
  const scale = clampScale(viewport.scale * factor);
  const ratio = scale / viewport.scale;
  return { x: sx - (sx - viewport.x) * ratio, y: sy - (sy - viewport.y) * ratio, scale };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

export function screenToWorld(viewport: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - viewport.x) / viewport.scale, y: (sy - viewport.y) / viewport.scale };
}

export function worldToScreen(viewport: Viewport, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * viewport.scale + viewport.x, y: wy * viewport.scale + viewport.y };
}

/** The world point at the centre of the surface. */
export function centerWorld(viewport: Viewport, size: Size): { x: number; y: number } {
  return screenToWorld(viewport, size.width / 2, size.height / 2);
}

/** Where a new card goes so it sits centred in the view, snapped to the grid. */
export function placeAtCenter(viewport: Viewport, size: Size, height = CARD_MIN_HEIGHT): { x: number; y: number } {
  const c = centerWorld(viewport, size);
  return { x: snap(c.x - CARD_WIDTH / 2), y: snap(c.y - height / 2) };
}

/**
 * The first spot at or below `start` where a new card overlaps nothing (with a margin), so a
 * proposal added from a dialog does not land on top of a card already there.
 */
export function freeSpot(cards: ReadonlyArray<{ id: string; x: number; y: number }>, heights: ReadonlyMap<string, number> | undefined, start: { x: number; y: number }, height = CARD_MIN_HEIGHT, gap = 24, attempts = 80): { x: number; y: number } {
  const x = snap(start.x);
  const overlaps = (y: number) =>
    cards.some((card) => {
      const h = heights?.get(card.id) || CARD_MIN_HEIGHT;
      return x < card.x + CARD_WIDTH + gap && x + CARD_WIDTH + gap > card.x && y < card.y + h + gap && y + height + gap > card.y;
    });
  let y = snap(start.y);
  for (let i = 0; i < attempts && overlaps(y); i += 1) y += snap(height + gap);
  return { x, y };
}

export function boundsOf(cards: ReadonlyArray<{ id: string; x: number; y: number }>, heights?: ReadonlyMap<string, number>): Bounds | undefined {
  if (cards.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const card of cards) {
    const h = heights?.get(card.id) || CARD_MIN_HEIGHT;
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + CARD_WIDTH);
    maxY = Math.max(maxY, card.y + h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fit the bounds into the surface with a margin, never zooming past 100% (one card should
 * not fill the window) and never below the minimum scale; an empty board gets the default.
 */
export function fitViewport(bounds: Bounds | undefined, size: Size, padding = 48): Viewport {
  if (!bounds) return { ...DEFAULT_VIEWPORT };
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2);
  const scale = clampScale(Math.min(1, availW / width, availH / height));
  return {
    x: (size.width - width * scale) / 2 - bounds.minX * scale,
    y: (size.height - height * scale) / 2 - bounds.minY * scale,
    scale,
  };
}

export function zoomPercent(viewport: Viewport): number {
  return Math.round(viewport.scale * 100);
}

/** Lane bands sit side by side from the world origin; index of the band under a world x. */
export function laneIndexAt(x: number, laneCount: number): number | undefined {
  if (laneCount === 0 || x < 0) return undefined;
  const index = Math.floor(x / LANE_WIDTH);
  return index < laneCount ? index : undefined;
}

export function laneAt(x: number, lanes: readonly string[]): string | undefined {
  const index = laneIndexAt(x, lanes.length);
  return index === undefined ? undefined : lanes[index];
}

export function laneLeft(index: number): number {
  return index * LANE_WIDTH;
}

// ---- persistence per project -----------------------------------------------------------

const STORAGE_PREFIX = 'apex.canvas.viewport:';

function isViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['x'] === 'number' && typeof v['y'] === 'number' && typeof v['scale'] === 'number' && Number.isFinite(v['x']) && Number.isFinite(v['y']) && Number.isFinite(v['scale']);
}

export function loadViewport(projectRoot: string | undefined): Viewport {
  if (!projectRoot) return { ...DEFAULT_VIEWPORT };
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectRoot);
    if (!raw) return { ...DEFAULT_VIEWPORT };
    const parsed: unknown = JSON.parse(raw);
    return isViewport(parsed) ? { x: parsed.x, y: parsed.y, scale: clampScale(parsed.scale) } : { ...DEFAULT_VIEWPORT };
  } catch {
    return { ...DEFAULT_VIEWPORT };
  }
}

export function saveViewport(projectRoot: string | undefined, viewport: Viewport): void {
  if (!projectRoot) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + projectRoot, JSON.stringify(viewport));
  } catch {
    // private mode or a test environment without storage
  }
}
