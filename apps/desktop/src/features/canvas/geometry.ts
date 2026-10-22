/** Link geometry: where a curve leaves one card and enters another, and the path itself. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Anchor extends Point {
  side: Side;
}

const NORMAL: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The point on the border of `rect` where the ray from its centre towards `towards` leaves it. */
export function edgePoint(rect: Rect, towards: Point): Anchor {
  const c = centerOf(rect);
  const vx = towards.x - c.x;
  const vy = towards.y - c.y;
  if (vx === 0 && vy === 0) return { x: rect.x + rect.width, y: c.y, side: 'right' };
  const tx = vx === 0 ? Infinity : rect.width / 2 / Math.abs(vx);
  const ty = vy === 0 ? Infinity : rect.height / 2 / Math.abs(vy);
  if (tx < ty) {
    return { x: c.x + vx * tx, y: c.y + vy * tx, side: vx > 0 ? 'right' : 'left' };
  }
  return { x: c.x + vx * ty, y: c.y + vy * ty, side: vy > 0 ? 'bottom' : 'top' };
}

export interface Curve {
  d: string;
  /** Where a label sits: the midpoint of the curve. */
  mid: Point;
  /** The end point, where the arrowhead is drawn. */
  end: Point;
}

/** A cubic curve between two cards, leaving and entering along the sides it crosses. */
export function linkCurve(from: Rect, to: Rect): Curve {
  const a = edgePoint(from, centerOf(to));
  const b = edgePoint(to, centerOf(from));
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const pull = Math.max(32, Math.min(160, distance / 2.5));
  const na = NORMAL[a.side];
  const nb = NORMAL[b.side];
  const c1 = { x: a.x + na.x * pull, y: a.y + na.y * pull };
  const c2 = { x: b.x + nb.x * pull, y: b.y + nb.y * pull };
  const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 };
  const r = (n: number) => Math.round(n * 10) / 10;
  return { d: `M ${r(a.x)} ${r(a.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(b.x)} ${r(b.y)}`, mid, end: b };
}
