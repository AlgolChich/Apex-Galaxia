import { describe, expect, it } from 'vitest';
import { normalizeBoard, outlineMarkdown, readingOrder } from './api.js';
import { edgePoint, linkCurve } from './geometry.js';
import { CARD_MIN_HEIGHT, CARD_WIDTH, DEFAULT_VIEWPORT, LANE_WIDTH, MAX_SCALE, MIN_SCALE, boundsOf, fitViewport, freeSpot, laneAt, loadViewport, placeAtCenter, saveViewport, screenToWorld, snap, worldToScreen, zoomAt } from './viewport.js';

describe('viewport math', () => {
  it('snaps to the 8 px grid', () => {
    expect(snap(0)).toBe(0);
    expect(snap(3)).toBe(0);
    expect(snap(4)).toBe(8);
    expect(snap(53)).toBe(56);
    expect(snap(-13)).toBe(-16);
  });

  it('zooms around the cursor: the world point under it stays put', () => {
    const vp = { x: 100, y: 50, scale: 1 };
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(vp, cursor.x, cursor.y);
    const zoomed = zoomAt(vp, 2, cursor.x, cursor.y);
    expect(zoomed.scale).toBe(2);
    const after = screenToWorld(zoomed, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    const back = worldToScreen(zoomed, before.x, before.y);
    expect(back.x).toBeCloseTo(cursor.x);
    expect(back.y).toBeCloseTo(cursor.y);
  });

  it('clamps the scale to the limits', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0.001, 0, 0).scale).toBe(MIN_SCALE);
  });

  it('fits the cards into the surface without zooming past 100%', () => {
    const size = { width: 1000, height: 600 };
    const cards = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2000, y: 1000 },
    ];
    const bounds = boundsOf(cards)!;
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 2000 + CARD_WIDTH, maxY: 1000 + CARD_MIN_HEIGHT });
    const vp = fitViewport(bounds, size, 48);
    const topLeft = worldToScreen(vp, bounds.minX, bounds.minY);
    const bottomRight = worldToScreen(vp, bounds.maxX, bounds.maxY);
    expect(topLeft.x).toBeGreaterThanOrEqual(48 - 1e-6);
    expect(topLeft.y).toBeGreaterThanOrEqual(48 - 1e-6);
    expect(bottomRight.x).toBeLessThanOrEqual(size.width - 48 + 1e-6);
    expect(bottomRight.y).toBeLessThanOrEqual(size.height - 48 + 1e-6);
    // Centred: equal margins on the tight axis.
    expect(topLeft.x).toBeCloseTo(size.width - bottomRight.x);

    const one = fitViewport(boundsOf([{ id: 'a', x: 500, y: 500 }]), size);
    expect(one.scale).toBe(1);
    expect(worldToScreen(one, 500 + CARD_WIDTH / 2, 500 + CARD_MIN_HEIGHT / 2)).toEqual({ x: 500, y: 300 });

    expect(fitViewport(undefined, size)).toEqual(DEFAULT_VIEWPORT);
    expect(boundsOf([])).toBeUndefined();
  });

  it('places a new card at the centre of the view, snapped', () => {
    const at = placeAtCenter({ x: 48, y: 48, scale: 1 }, { width: 800, height: 600 });
    expect(at).toEqual({ x: 232, y: 208 });
    expect(at.x % 8).toBe(0);
    expect(at.y % 8).toBe(0);
    const zoomedIn = placeAtCenter({ x: 0, y: 0, scale: 2 }, { width: 800, height: 600 });
    expect(zoomedIn).toEqual({ x: snap(200 - CARD_WIDTH / 2), y: snap(150 - CARD_MIN_HEIGHT / 2) });
  });

  it('moves a new card down to the first free spot', () => {
    const cards = [
      { id: 'a', x: 232, y: 208 },
      { id: 'b', x: 232, y: 328 },
    ];
    expect(freeSpot([], undefined, { x: 232, y: 208 })).toEqual({ x: 232, y: 208 });
    const spot = freeSpot(cards, new Map([['b', 150]]), { x: 232, y: 208 });
    expect(spot.x).toBe(232);
    expect(spot.y).toBeGreaterThanOrEqual(328 + 150 + 24);
    expect(spot.y % 8).toBe(0);
    // Far enough to the side, the start is free already.
    expect(freeSpot(cards, undefined, { x: 232 + CARD_WIDTH + 40, y: 208 })).toEqual({ x: 512, y: 208 });
  });

  it('finds the lane band under an x', () => {
    const lanes = ['Act I', 'Act II', 'Act III'];
    expect(laneAt(0, lanes)).toBe('Act I');
    expect(laneAt(LANE_WIDTH - 1, lanes)).toBe('Act I');
    expect(laneAt(LANE_WIDTH, lanes)).toBe('Act II');
    expect(laneAt(LANE_WIDTH * 3, lanes)).toBeUndefined();
    expect(laneAt(-10, lanes)).toBeUndefined();
    expect(laneAt(100, [])).toBeUndefined();
  });

  it('persists the viewport per project', () => {
    localStorage.clear();
    expect(loadViewport('/p/one')).toEqual(DEFAULT_VIEWPORT);
    saveViewport('/p/one', { x: 10, y: -20, scale: 1.5 });
    expect(loadViewport('/p/one')).toEqual({ x: 10, y: -20, scale: 1.5 });
    expect(loadViewport('/p/two')).toEqual(DEFAULT_VIEWPORT);
    localStorage.setItem('apex.canvas.viewport:/p/bad', '{"x":"no"}');
    expect(loadViewport('/p/bad')).toEqual(DEFAULT_VIEWPORT);
    expect(loadViewport(undefined)).toEqual(DEFAULT_VIEWPORT);
  });
});

describe('link geometry', () => {
  const a = { x: 0, y: 0, width: 240, height: 100 };

  it('leaves a card through the side that faces the target', () => {
    expect(edgePoint(a, { x: 1000, y: 50 })).toEqual({ x: 240, y: 50, side: 'right' });
    expect(edgePoint(a, { x: -1000, y: 50 })).toEqual({ x: 0, y: 50, side: 'left' });
    expect(edgePoint(a, { x: 120, y: 1000 })).toEqual({ x: 120, y: 100, side: 'bottom' });
    expect(edgePoint(a, { x: 120, y: -1000 })).toEqual({ x: 120, y: 0, side: 'top' });
  });

  it('draws a cubic curve ending at the target border', () => {
    const b = { x: 400, y: 0, width: 240, height: 100 };
    const curve = linkCurve(a, b);
    expect(curve.d.startsWith('M 240 50 C ')).toBe(true);
    expect(curve.d.endsWith(', 400 50')).toBe(true);
    expect(curve.end).toEqual({ x: 400, y: 50, side: 'left' });
    expect(curve.mid.x).toBeCloseTo(320);
    expect(curve.mid.y).toBeCloseTo(50);
  });
});

describe('board payloads', () => {
  it('normalizes the server shape and computes the reading order', () => {
    const board = normalizeBoard({
      board: {
        format_version: 1,
        template: 'three_act',
        cards: [
          { id: 'c', kind: 'question', title: 'C', text: '', x: 0, y: 0, links: [] },
          { id: 'b', kind: 'scene', title: 'B', x: 400, y: 10, lane: 'Act II', links: [{ to: 'a', label: 'then' }] },
          { id: 'a', kind: 'scene', title: 'A', x: 0, y: 300, lane: 'Act I', links: [{ to: 'b' }, { to: 'zzz' }] },
          { id: 'z', kind: 'nope', title: 'Z', x: 0, y: 0, lane: 'Extra', links: 'bad' },
        ],
      },
      lanes: ['Act I', 'Act II', 'Act III', 'Extra'],
    });
    expect(board.template).toBe('three_act');
    expect(board.lanes).toEqual(['Act I', 'Act II', 'Act III', 'Extra']);
    expect(board.cards.map((c) => c.id)).toEqual(['c', 'b', 'a', 'z']);
    expect(board.cards[1]!.text).toBe('');
    expect(board.cards[3]!.kind).toBe('idea');
    expect(board.cards[3]!.links).toEqual([]);
    expect(board.order).toEqual(['a', 'b', 'z', 'c']);
    expect(readingOrder(board.cards, [])).toEqual(['c', 'z', 'b', 'a']);
  });

  it('accepts the flat shape with an order and tolerates garbage', () => {
    const flat = normalizeBoard({ template: 'none', lanes: [], cards: [{ id: 'x', kind: 'idea', title: 'X' }], order: ['x'] });
    expect(flat.cards).toEqual([{ id: 'x', kind: 'idea', title: 'X', text: '', x: 0, y: 0, links: [] }]);
    expect(flat.order).toEqual(['x']);
    expect(normalizeBoard(undefined)).toEqual({ template: 'none', lanes: [], cards: [], order: [] });
    expect(normalizeBoard({ text: 'not json' })).toEqual({ template: 'none', lanes: [], cards: [], order: [] });
  });

  it('renders an outline proposal as the plan file', () => {
    const text = outlineMarkdown({ chapters: [{ number: 1, title: 'Смена', line: 'Фёдор принимает смену.' }] }, 'ru');
    expect(text).toBe('# План\n\n- Глава 1. Смена: Фёдор принимает смену.\n');
    expect(outlineMarkdown({ chapters: [{ number: 2, title: 'Guest', line: 'Someone knocks.' }] }, 'en')).toBe('# Outline\n\n- Chapter 2. Guest: Someone knocks.\n');
  });
});
