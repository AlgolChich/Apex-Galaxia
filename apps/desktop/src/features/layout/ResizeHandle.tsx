import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  /** Which edge of its parent the handle sits on; dragging away from the parent widens it. */
  side: 'left' | 'right';
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange(px: number): void;
}

/**
 * A drag handle on the edge of a column. Pointer events with capture, so the drag survives
 * leaving the handle; arrow keys, Home and End for the keyboard; ARIA separator semantics.
 */
export function ResizeHandle({ side, value, min, max, step = 16, label, onChange }: Props) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
  const [active, setActive] = useState(false);
  const sign = side === 'right' ? 1 : -1;
  const clamp = (px: number) => Math.round(Math.max(min, Math.min(max, px)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value };
    setActive(true);
    document.body.classList.add('frame-resizing');
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    onChange(clamp(state.startValue + sign * (event.clientX - state.startX)));
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    setActive(false);
    document.body.classList.remove('frame-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined;
    if (event.key === 'ArrowLeft') next = value - sign * step;
    else if (event.key === 'ArrowRight') next = value + sign * step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={`frame-handle frame-handle--${side}${active ? ' frame-handle--active' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  );
}
