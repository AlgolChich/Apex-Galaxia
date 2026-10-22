import { memo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../../i18n/index.js';
import type { BoardCard } from './api.js';
import { snap } from './viewport.js';

/** Callbacks a card needs from the board; one stable object so memoized cards never re-render on pan. */
export interface CardContext {
  scale(): number;
  onDragMove(id: string, x: number, y: number): void;
  onDrop(id: string, x: number, y: number): void;
  /** A click (pointer down and up without a drag): select, or link in link mode. */
  onActivate(id: string): void;
  onFocus(id: string): void;
  /** Double click: open the editor. */
  onOpen(id: string): void;
}

interface Props {
  card: BoardCard;
  selected: boolean;
  /** 1-based reading order. */
  order: number;
  /** The card's lane when it differs from the band it sits in, shown as a chip. */
  laneMismatch: string | undefined;
  /** Link mode is on and this card can be the target. */
  linkTarget: boolean;
  ctx: CardContext;
}

const DRAG_THRESHOLD = 4;

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  x: number;
  y: number;
}

/**
 * One card: an absolutely positioned div moved with a transform. While dragging, the
 * transform is written straight to the DOM; React learns the new position on drop.
 */
export const Card = memo(function Card({ card, selected, order, laneMismatch, linkTarget, ctx }: Props) {
  const t = useT();
  const drag = useRef<Drag | undefined>(undefined);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, x: card.x, y: card.y };
    const el = event.currentTarget;
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.active = true;
      event.currentTarget.classList.add('ccard--drag');
    }
    const scale = ctx.scale();
    d.x = card.x + dx / scale;
    d.y = card.y + dy / scale;
    event.currentTarget.style.transform = `translate(${d.x}px, ${d.y}px)`;
    ctx.onDragMove(card.id, d.x, d.y);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = undefined;
    const el = event.currentTarget;
    if (typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // capture already gone
      }
    }
    if (d.active) {
      el.classList.remove('ccard--drag');
      const x = cancelled ? card.x : snap(d.x);
      const y = cancelled ? card.y : snap(d.y);
      el.style.transform = `translate(${x}px, ${y}px)`;
      ctx.onDrop(card.id, x, y);
    } else if (!cancelled) {
      ctx.onActivate(card.id);
    }
  };

  const kind = t(`canvas.kind.${card.kind}`);
  const className = ['ccard', `ccard--${card.kind}`, selected ? 'ccard--on' : '', linkTarget ? 'ccard--target' : ''].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={{ transform: `translate(${card.x}px, ${card.y}px)` }}
      data-card-id={card.id}
      role="option"
      aria-selected={selected}
      aria-label={t('canvas.card.label', { kind, title: card.title })}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onDoubleClick={() => ctx.onOpen(card.id)}
      onFocus={() => ctx.onFocus(card.id)}
    >
      <div className="ccard__head">
        <span className="ccard__title">{card.title}</span>
        <span className="ccard__order" title={t('canvas.order', { n: order })}>
          {order}
        </span>
      </div>
      <div className="ccard__meta">
        <span className="ccard__kind">{kind}</span>
        {laneMismatch ? <span className="ccard__lane">{laneMismatch}</span> : null}
      </div>
      {card.text ? <div className="ccard__text">{card.text}</div> : null}
    </div>
  );
});
