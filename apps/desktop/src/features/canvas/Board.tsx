import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Card, type CardContext } from './Card.js';
import { Links } from './Links.js';
import { useCanvas } from './store.js';
import { CARD_MIN_HEIGHT, CARD_WIDTH, FALLBACK_SIZE, GRID, LANE_HEIGHT, LANE_TOP, LANE_WIDTH, ZOOM_STEP, boundsOf, fitViewport, freeSpot, laneAt, laneLeft, loadViewport, panBy, placeAtCenter, saveViewport, snap, worldToScreen, zoomAt, type Size, type Viewport } from './viewport.js';

export interface BoardHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Where a new card goes: centred in the view, moved down to the first free spot. */
  placeAtCenter(): { x: number; y: number };
  /** A spot for a proposed card: to the right of `near` when given, else from the centre; free of overlap. */
  placeNear(near?: { x: number; y: number }): { x: number; y: number };
  viewport(): Viewport;
}

interface Props {
  ref?: Ref<BoardHandle>;
  /** Called when a pan or zoom ends (the toolbar shows the zoom level). */
  onViewportChange?: (viewport: Viewport) => void;
}

interface Pan {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const WHEEL_COMMIT_MS = 160;

/**
 * The surface: one transformed container holds the lane bands, the SVG link layer and the
 * cards, so a pan or zoom touches a single style property. The viewport lives in a ref;
 * React hears about it only when a gesture ends.
 */
export function Board({ ref, onViewportChange }: Props) {
  const t = useT();
  const root = useStore((s) => s.project.root);
  const board = useCanvas((s) => s.board);
  const selectedId = useCanvas((s) => s.selectedId);
  const linking = useCanvas((s) => s.linking);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef(root);
  const vpRef = useRef<Viewport>(loadViewport(root));
  const sizeRef = useRef<Size>(FALLBACK_SIZE);
  const heightsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(heightsRef.current);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | undefined>(undefined);
  const dragFrame = useRef<number | undefined>(undefined);
  const pendingDrag = useRef<{ id: string; x: number; y: number } | undefined>(undefined);
  const pan = useRef<Pan | undefined>(undefined);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changeRef = useRef(onViewportChange);
  changeRef.current = onViewportChange;

  const cards = board?.cards ?? [];
  const lanes = board?.lanes ?? [];
  const order = useMemo(() => {
    const map = new Map<string, number>();
    (board?.order ?? []).forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [board?.order]);

  /** Write the viewport to the DOM: the world transform, the dot grid, the lane headers. */
  const apply = useCallback(() => {
    const vp = vpRef.current;
    const world = worldRef.current;
    if (world) world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`;
    const surface = surfaceRef.current;
    if (surface) {
      const step = GRID * 4 * vp.scale;
      surface.style.backgroundSize = `${step}px ${step}px`;
      surface.style.backgroundPosition = `${vp.x}px ${vp.y}px`;
    }
    const heads = headsRef.current;
    if (heads) {
      let i = 0;
      for (const child of Array.from(heads.children)) {
        const el = child as HTMLElement;
        el.style.left = `${laneLeft(i) * vp.scale + vp.x}px`;
        el.style.width = `${LANE_WIDTH * vp.scale}px`;
        i += 1;
      }
    }
  }, []);

  const commit = useCallback(() => {
    saveViewport(rootRef.current, vpRef.current);
    changeRef.current?.(vpRef.current);
  }, []);

  const setViewport = useCallback(
    (next: Viewport) => {
      vpRef.current = next;
      apply();
      commit();
    },
    [apply, commit],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const size = sizeRef.current;
      setViewport(zoomAt(vpRef.current, factor, size.width / 2, size.height / 2));
    },
    [setViewport],
  );

  const fit = useCallback(() => {
    const all = useCanvas.getState().board?.cards ?? [];
    setViewport(fitViewport(boundsOf(all, heightsRef.current), sizeRef.current));
  }, [setViewport]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      fit,
      placeAtCenter: () => freeSpot(useCanvas.getState().board?.cards ?? [], heightsRef.current, placeAtCenter(vpRef.current, sizeRef.current)),
      placeNear: (near) => {
        const all = useCanvas.getState().board?.cards ?? [];
        const start = near ? { x: snap(near.x + CARD_WIDTH + 48), y: snap(near.y) } : placeAtCenter(vpRef.current, sizeRef.current);
        return freeSpot(all, heightsRef.current, start);
      },
      viewport: () => vpRef.current,
    }),
    [fit, zoomBy],
  );

  // The project changed: its own saved viewport.
  useEffect(() => {
    rootRef.current = root;
    vpRef.current = loadViewport(root);
    apply();
    commit();
  }, [root, apply, commit]);

  // Track the surface size for zoom-around-centre, fit and placing new cards.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => {
      sizeRef.current = { width: el.clientWidth || FALLBACK_SIZE.width, height: el.clientHeight || FALLBACK_SIZE.height };
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  // Non-passive wheel listener: zoom around the cursor, commit after the gesture settles.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const unit = event.deltaMode === 1 ? 0.05 : event.ctrlKey ? 0.01 : 0.0015;
      vpRef.current = zoomAt(vpRef.current, Math.exp(-event.deltaY * unit), sx, sy);
      apply();
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(commit, WHEEL_COMMIT_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [apply, commit]);

  // Lane headers are positioned imperatively; a new lane list needs a pass.
  useLayoutEffect(() => {
    apply();
  }, [lanes, apply]);

  // Measure card heights after each board render so links meet the card borders.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = new Map<string, number>();
    let changed = false;
    for (const el of Array.from(world.querySelectorAll<HTMLElement>('[data-card-id]'))) {
      const id = el.dataset['cardId'];
      if (!id) continue;
      const h = el.offsetHeight;
      next.set(id, h);
      if (heightsRef.current.get(id) !== h) changed = true;
    }
    if (changed || next.size !== heightsRef.current.size) {
      heightsRef.current = next;
      setHeights(next);
    }
  }, [board, selectedId]);

  // A card selected from elsewhere (after Add, after a proposal) gets focus and comes into view.
  useEffect(() => {
    if (!selectedId) return;
    const world = worldRef.current;
    const card = useCanvas.getState().board?.cards.find((c) => c.id === selectedId);
    if (!world || !card) return;
    const el = Array.from(world.querySelectorAll<HTMLElement>('[data-card-id]')).find((node) => node.dataset['cardId'] === selectedId);
    const size = sizeRef.current;
    const vp = vpRef.current;
    const topLeft = worldToScreen(vp, card.x, card.y);
    const bottomRight = worldToScreen(vp, card.x + CARD_WIDTH, card.y + (heightsRef.current.get(selectedId) || CARD_MIN_HEIGHT));
    if (topLeft.x < 0 || topLeft.y < 0 || bottomRight.x > size.width || bottomRight.y > size.height) {
      const cx = card.x + CARD_WIDTH / 2;
      const cy = card.y + (heightsRef.current.get(selectedId) || CARD_MIN_HEIGHT) / 2;
      setViewport({ ...vp, x: size.width / 2 - cx * vp.scale, y: size.height / 2 - cy * vp.scale });
    }
    const active = document.activeElement;
    const sheetHasFocus = active instanceof HTMLElement && active.closest('.canvas__sheet, .dlg') !== null;
    if (el && active !== el && !sheetHasFocus) el.focus({ preventScroll: true });
  }, [selectedId, setViewport]);

  const ctx = useMemo<CardContext>(
    () => ({
      scale: () => vpRef.current.scale,
      onDragMove: (id, x, y) => {
        pendingDrag.current = { id, x, y };
        if (typeof requestAnimationFrame !== 'function') {
          setDrag(pendingDrag.current);
          return;
        }
        if (dragFrame.current === undefined) {
          dragFrame.current = requestAnimationFrame(() => {
            dragFrame.current = undefined;
            if (pendingDrag.current) setDrag(pendingDrag.current);
          });
        }
      },
      onDrop: (id, x, y) => {
        if (dragFrame.current !== undefined && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(dragFrame.current);
          dragFrame.current = undefined;
        }
        pendingDrag.current = undefined;
        setDrag(undefined);
        void useCanvas.getState().moveCard(id, x, y);
      },
      onActivate: (id) => {
        const state = useCanvas.getState();
        if (state.linking) {
          if (id !== state.linking.from) void state.link(state.linking.from, id, state.linking.label.trim() || undefined);
        } else state.select(id);
      },
      onFocus: (id) => {
        const state = useCanvas.getState();
        if (!state.linking && state.selectedId !== id) state.select(id);
      },
      onOpen: (id) => useCanvas.getState().openEditor(id),
    }),
    [],
  );

  // ---- background: pan with the pointer, click to deselect ------------------------------
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest('.ccard')) return;
    const vp = vpRef.current;
    pan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: vp.x, originY: vp.y, moved: false };
    const el = event.currentTarget;
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(event.pointerId);
    el.classList.add('canvas__surface--panning');
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p || p.pointerId !== event.pointerId) return;
    const dx = event.clientX - p.startX;
    const dy = event.clientY - p.startY;
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    vpRef.current = { ...vpRef.current, x: p.originX + dx, y: p.originY + dy };
    apply();
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = pan.current;
    if (!p || p.pointerId !== event.pointerId) return;
    pan.current = undefined;
    const el = event.currentTarget;
    el.classList.remove('canvas__surface--panning');
    if (typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // capture already gone
      }
    }
    if (p.moved) commit();
    else if (!cancelled) {
      const state = useCanvas.getState();
      if (state.linking) state.cancelLinking();
      else state.select(undefined);
      el.focus({ preventScroll: true });
    }
  };

  // ---- keyboard: arrows move the card or pan, +/- zoom, Enter edits, Delete removes ------
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button')) return;
    const state = useCanvas.getState();
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const [dx, dy] = arrow;
      if (state.selectedId && !state.linking) {
        const step = event.shiftKey ? 40 : GRID;
        state.nudgeCard(state.selectedId, dx * step, dy * step);
      } else {
        const step = event.shiftKey ? 200 : 40;
        setViewport(panBy(vpRef.current, -dx * step, -dy * step));
      }
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      fit();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const id = target.closest<HTMLElement>('[data-card-id]')?.dataset['cardId'];
      if (state.linking) {
        if (id && id !== state.linking.from) {
          event.preventDefault();
          void state.link(state.linking.from, id, state.linking.label.trim() || undefined);
        }
        return;
      }
      if (event.key === 'Enter' && state.selectedId) {
        event.preventDefault();
        state.openEditor();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selectedId && !state.linking) {
        event.preventDefault();
        state.askRemove(state.selectedId);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (state.linking) state.cancelLinking();
      else if (state.editorOpen) state.closeEditor();
      else if (state.selectedId) {
        state.select(undefined);
        surfaceRef.current?.focus({ preventScroll: true });
      }
    }
  };

  const className = ['canvas__surface', linking ? 'canvas__surface--linking' : ''].filter(Boolean).join(' ');

  return (
    <div ref={surfaceRef} className={className} role="application" aria-label={t('canvas.surface')} tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => endPan(event, false)} onPointerCancel={(event) => endPan(event, true)} onKeyDown={onKeyDown}>
      <div ref={worldRef} className="canvas__world">
        {lanes.length > 0 ? (
          <div className="canvas__lanes" aria-hidden="true">
            {lanes.map((lane, i) => (
              <div key={lane} className="canvas__lane" style={{ left: laneLeft(i), top: LANE_TOP, width: LANE_WIDTH, height: LANE_HEIGHT }} />
            ))}
          </div>
        ) : null}
        <Links cards={cards} heights={heights} drag={drag} selectedId={selectedId} />
        <div className="canvas__cards" role="listbox" aria-label={t('canvas.cards')} aria-multiselectable={false}>
          {cards.map((card) => {
            const band = laneAt(card.x, lanes);
            return <Card key={card.id} card={card} selected={card.id === selectedId} order={order.get(card.id) ?? 0} laneMismatch={card.lane && card.lane !== band ? card.lane : undefined} linkTarget={Boolean(linking) && linking?.from !== card.id} ctx={ctx} />;
          })}
        </div>
      </div>
      <div ref={headsRef} className="canvas__lane-heads">
        {lanes.map((lane) => (
          <div key={lane} className="canvas__lane-head" title={lane}>
            {lane}
          </div>
        ))}
      </div>
      {selectedId ? <div className="canvas__status">{t('canvas.hint.keys')}</div> : null}
    </div>
  );
}
