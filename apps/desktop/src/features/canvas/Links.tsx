import { memo, type ReactNode } from 'react';
import type { BoardCard } from './api.js';
import { linkCurve, type Rect } from './geometry.js';
import { CARD_MIN_HEIGHT, CARD_WIDTH } from './viewport.js';

interface Props {
  cards: readonly BoardCard[];
  /** Measured card heights by id; unmeasured cards use the nominal height. */
  heights: ReadonlyMap<string, number>;
  /** The card being dragged and where it is right now, so its links follow. */
  drag: { id: string; x: number; y: number } | undefined;
  selectedId: string | undefined;
}

/**
 * Every link of the board in one SVG inside the transformed world, so panning and zooming
 * cost nothing here. Links touching the selected card are drawn last and highlighted.
 */
export const Links = memo(function Links({ cards, heights, drag, selectedId }: Props) {
  const rects = new Map<string, Rect>();
  for (const card of cards) {
    const at = drag && drag.id === card.id ? drag : card;
    rects.set(card.id, { x: at.x, y: at.y, width: CARD_WIDTH, height: heights.get(card.id) || CARD_MIN_HEIGHT });
  }
  const quiet: ReactNode[] = [];
  const loud: ReactNode[] = [];
  for (const card of cards) {
    const from = rects.get(card.id);
    if (!from) continue;
    for (const link of card.links) {
      const to = rects.get(link.to);
      if (!to) continue;
      const on = selectedId === card.id || selectedId === link.to;
      const curve = linkCurve(from, to);
      const node = (
        <g key={`${card.id}->${link.to}`} className={on ? 'canvas__linkg canvas__linkg--on' : 'canvas__linkg'}>
          <path className="canvas__link" d={curve.d} markerEnd={on ? 'url(#canvas-arrow-on)' : 'url(#canvas-arrow)'} />
          {link.label ? (
            <text className="canvas__link-label" x={curve.mid.x} y={curve.mid.y - 5}>
              {link.label}
            </text>
          ) : null}
        </g>
      );
      (on ? loud : quiet).push(node);
    }
  }
  return (
    <svg className="canvas__links" aria-hidden="true" focusable="false">
      <defs>
        <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
          <path className="canvas__arrow" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
        <marker id="canvas-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
          <path className="canvas__arrow canvas__arrow--on" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {quiet}
      {loud}
    </svg>
  );
});
