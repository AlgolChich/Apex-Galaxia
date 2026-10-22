import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockTool } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { callsOf, mockClient, openSampleProject, resetStore, sampleConfig } from '../wizard/test-utils.js';
import { CanvasView } from './index.js';
import { resetCanvasStore, useCanvas } from './store.js';

const CARDS = [
  { id: 'card_a', kind: 'scene', title: 'Смена', text: 'Фёдор принимает смену у маяка.', x: 0, y: 0, lane: 'Act I', links: [{ to: 'card_b', label: 'потом' }] },
  { id: 'card_b', kind: 'twist', title: 'Гость', text: 'Кто-то стучит в дверь.', x: 320, y: 0, lane: 'Act II', links: [] },
  { id: 'card_c', kind: 'question', title: 'Зачем он пришёл?', text: '', x: 320, y: 160, links: [] },
];

function boardTools(options: { template?: string; lanes?: string[]; cards?: unknown[] } = {}): Record<string, MockTool> {
  const cards = options.cards ?? CARDS;
  return {
    canvas_get: () => ({ board: { format_version: 1, template: options.template ?? 'three_act', cards }, lanes: options.lanes ?? ['Act I', 'Act II', 'Act III'] }),
    canvas_update: (args) => ({ card: { ...(cards.find((c) => (c as { id: string }).id === args['id']) as object), ...args } }),
    canvas_add: (args) => ({ id: 'card_new', kind: args['kind'], title: args['title'], text: args['text'] ?? '', x: 0, y: cards.length * 120, links: [], ...(args['lane'] ? { lane: args['lane'] } : {}) }),
    canvas_link: (args) => ({ from: args['from'], to: args['to'] }),
    canvas_remove: (args) => ({ id: args['id'] }),
    canvas_template: (args) => ({ template: args['template'], lanes: args['template'] === 'three_act' ? ['Act I', 'Act II', 'Act III'] : [] }),
    project_open: () => ({ root: '/tmp/story', config: sampleConfig(), chapters: [], spentUsd: 0.0123 }),
    project_chapters: () => ({ chapters: [] }),
  };
}

const card = (name: RegExp) => screen.findByRole('option', { name });
/** The cards on the board (the toolbar's <select> options carry the same role). */
const cards = () => within(screen.getByRole('listbox', { name: 'Cards' })).queryAllByRole('option');

describe('CanvasView', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore('en');
    resetCanvasStore();
    openSampleProject();
  });
  afterEach(cleanup);

  it('renders the cards, the lanes and the reading order from canvas_get', async () => {
    mockClient(boardTools());
    render(<CanvasView />);
    const first = await card(/Смена/);
    expect(cards()).toHaveLength(3);
    expect(first.style.transform).toBe('translate(0px, 0px)');
    expect(within(first).getByText('Scene')).toBeTruthy();
    expect(within(first).getByText('1')).toBeTruthy();
    const third = await card(/Зачем/);
    expect(within(third).getByText('3')).toBeTruthy();
    expect(screen.getByText('Act I')).toBeTruthy();
    expect(screen.getByText('Act II')).toBeTruthy();
    expect(screen.getByText('Act III')).toBeTruthy();
    expect(screen.getByText('потом')).toBeTruthy();
    expect((screen.getByLabelText('Template') as HTMLSelectElement).value).toBe('three_act');
  });

  it('moves a card with the pointer and calls canvas_update with the snapped position', async () => {
    const transport = mockClient(boardTools({ template: 'none', lanes: [] }));
    render(<CanvasView />);
    const first = await card(/Смена/);
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 153, clientY: 131 });
    expect(first.style.transform).toBe('translate(53px, 31px)');
    await act(async () => {
      fireEvent.pointerUp(first, { pointerId: 1, clientX: 153, clientY: 131 });
    });
    expect(callsOf(transport, 'canvas_update')).toEqual([{ id: 'card_a', x: 56, y: 32 }]);
    expect(first.style.transform).toBe('translate(56px, 32px)');
  });

  it('sends the lane too when a card is dropped in another band', async () => {
    const transport = mockClient(boardTools());
    render(<CanvasView />);
    const first = await card(/Смена/);
    fireEvent.pointerDown(first, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(first, { pointerId: 2, clientX: 330, clientY: 300 });
    await act(async () => {
      fireEvent.pointerUp(first, { pointerId: 2, clientX: 330, clientY: 300 });
    });
    expect(callsOf(transport, 'canvas_update')).toEqual([{ id: 'card_a', x: 328, y: 304, lane: 'Act II' }]);
  });

  it('a click selects, Enter opens the sheet, arrows nudge by 8 px and commit after a pause', async () => {
    const transport = mockClient(boardTools({ template: 'none', lanes: [] }));
    render(<CanvasView />);
    const third = await card(/Зачем/);
    fireEvent.pointerDown(third, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    await act(async () => {
      fireEvent.pointerUp(third, { pointerId: 3, clientX: 10, clientY: 10 });
    });
    expect(third.getAttribute('aria-selected')).toBe('true');
    expect(callsOf(transport, 'canvas_update')).toHaveLength(0);

    fireEvent.keyDown(third, { key: 'ArrowRight' });
    fireEvent.keyDown(third, { key: 'ArrowDown', shiftKey: true });
    expect(third.style.transform).toBe('translate(328px, 200px)');
    await waitFor(() => expect(callsOf(transport, 'canvas_update')).toEqual([{ id: 'card_c', x: 328, y: 200 }]), { timeout: 2000 });

    fireEvent.keyDown(third, { key: 'Enter' });
    const sheet = await screen.findByRole('complementary', { name: 'Card' });
    expect((within(sheet).getByLabelText('Title') as HTMLInputElement).value).toBe('Зачем он пришёл?');
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Зачем он пришёл ночью?' } });
    fireEvent.change(within(sheet).getByLabelText('Kind'), { target: { value: 'twist' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    });
    expect(callsOf(transport, 'canvas_update').at(-1)).toEqual({ id: 'card_c', title: 'Зачем он пришёл ночью?', text: '', kind: 'twist', lane: '' });
    expect(await card(/ночью/)).toBeTruthy();
  });

  it('adds a card through the dialog: one canvas_add with its position at the view centre', async () => {
    const transport = mockClient(boardTools({ template: 'none', lanes: [] }));
    render(<CanvasView />);
    await card(/Смена/);
    fireEvent.click(screen.getByRole('button', { name: '+ Card' }));
    const dialog = await screen.findByRole('dialog', { name: 'New card' });
    expect(callsOf(transport, 'canvas_add')).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Шторм' } });
    fireEvent.change(within(dialog).getByLabelText('Kind'), { target: { value: 'twist' } });
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'К ночи поднимается ветер.' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    });
    const added_ = callsOf(transport, 'canvas_add');
    expect(added_).toHaveLength(1);
    expect(added_[0]).toMatchObject({ kind: 'twist', title: 'Шторм', text: 'К ночи поднимается ветер.' });
    expect((added_[0]!['x'] as number) % 8).toBe(0);
    expect((added_[0]!['y'] as number) % 8).toBe(0);
    expect(callsOf(transport, 'canvas_update')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    const added = await card(/Шторм/);
    expect(added.getAttribute('aria-selected')).toBe('true');
    expect(cards()).toHaveLength(4);
  });

  it('renders the empty state with the three ways to start', async () => {
    mockClient(boardTools({ template: 'none', lanes: [], cards: [] }));
    render(<CanvasView />);
    expect(await screen.findByText('The board is empty')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a card' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick a template' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for directions' })).toBeTruthy();
    expect(cards()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ask for directions' }));
    expect(await screen.findByRole('dialog', { name: 'Directions' })).toBeTruthy();
  });

  it('shows a directions proposal and adds a branch card only on Add', async () => {
    const transport = mockClient({
      ...boardTools({ template: 'none', lanes: [] }),
      canvas_directions: () => ({
        options: [
          { title: 'He takes them himself', text: 'He agrees so he can watch their hands.', obvious: true, recommended: false },
          { title: 'June goes first', text: 'She goes down before them.', obvious: false, recommended: true },
        ],
      }),
    });
    render(<CanvasView />);
    await card(/Смена/);
    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Directions' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }));
    });
    await within(dialog).findByText('June goes first');
    expect(callsOf(transport, 'canvas_directions')).toEqual([{ count: 3 }]);
    expect(within(dialog).getByText('recommended')).toBeTruthy();
    expect(within(dialog).getByText('obvious')).toBeTruthy();
    expect(within(dialog).getByText(/Model: model-a/)).toBeTruthy();
    expect(within(dialog).getByText(/\$0\.0123/)).toBeTruthy();
    expect(callsOf(transport, 'canvas_add')).toHaveLength(0);
    expect(cards()).toHaveLength(3);

    const buttons = within(dialog).getAllByRole('button', { name: 'Add as card' });
    expect(buttons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(buttons[1] as HTMLButtonElement);
    });
    expect(callsOf(transport, 'canvas_add')).toHaveLength(1);
    expect(callsOf(transport, 'canvas_add')[0]).toMatchObject({ kind: 'branch', title: 'June goes first', text: 'She goes down before them.' });
    expect(within(dialog).getAllByRole('button', { name: 'Added' })).toHaveLength(1);
    expect(cards()).toHaveLength(4);
  });

  it('links two cards in link mode and removes one after confirmation', async () => {
    const transport = mockClient(boardTools({ template: 'none', lanes: [] }));
    render(<CanvasView />);
    const first = await card(/Смена/);
    const third = await card(/Зачем/);
    act(() => useCanvas.getState().openEditor('card_a'));
    const sheet = await screen.findByRole('complementary', { name: 'Card' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Link to…' }));
    const bar = await screen.findByRole('status');
    fireEvent.change(within(bar).getByLabelText('Link label (optional)'), { target: { value: 'почему' } });
    fireEvent.pointerDown(third, { button: 0, pointerId: 4, clientX: 5, clientY: 5 });
    await act(async () => {
      fireEvent.pointerUp(third, { pointerId: 4, clientX: 5, clientY: 5 });
    });
    expect(callsOf(transport, 'canvas_link')).toEqual([{ from: 'card_a', to: 'card_c', label: 'почему' }]);
    expect(screen.getByText('почему')).toBeTruthy();
    expect(useCanvas.getState().linking).toBeUndefined();

    fireEvent.keyDown(first, { key: 'Delete' });
    const confirm = await screen.findByRole('alertdialog');
    expect(callsOf(transport, 'canvas_remove')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    });
    expect(callsOf(transport, 'canvas_remove')).toEqual([{ id: 'card_a' }]);
    expect(cards()).toHaveLength(2);
    expect(useStore.getState().ui.toasts.some((toast) => toast.text === 'Card removed')).toBe(true);
  });

  it('switches the template through canvas_template and shows the lanes', async () => {
    const transport = mockClient(boardTools({ template: 'none', lanes: [], cards: CARDS.map(({ lane: _lane, ...rest }) => rest) }));
    render(<CanvasView />);
    await card(/Смена/);
    expect(screen.queryByText('Act I')).toBeNull();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'three_act' } });
    });
    expect(callsOf(transport, 'canvas_template')).toEqual([{ template: 'three_act' }]);
    expect(screen.getByText('Act III')).toBeTruthy();
  });
});
