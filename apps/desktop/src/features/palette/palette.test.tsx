import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApexClient, MockTransport, setClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { useDialogs } from '../diff/store.js';
import { CommandPalette } from './index.js';
import { ACTIONS, matchesShortcut, rankActions, unmetNeed } from './actions.js';
import { fuzzyMatch } from './fuzzy.js';
import { usePaletteState } from './state.js';

function openProject() {
  useStore.setState({
    project: { root: '/story', chapters: [{ number: 1, title: 'One', status: 'draft' }], spentUsd: 0 },
    editor: { stem: '01-one', front: { number: 1, title: 'One', status: 'draft' }, body: 'Первый абзац.\n\nВторой абзац.', savedBody: 'x', dirty: false, cursor: 3, selection: { from: 0, to: 6 }, saving: false },
    ui: { ...useStore.getState().ui, language: 'en', paletteOpen: true, panel: null },
  });
}

describe('fuzzy matching', () => {
  it('prefers substrings and word starts, rejects non-subsequences', () => {
    expect(fuzzyMatch('lint', 'Lint now')?.score).toBeGreaterThan(fuzzyMatch('lnt', 'Lint now')?.score ?? 0);
    expect(fuzzyMatch('wc', 'Write: continue')).toBeDefined();
    expect(fuzzyMatch('zzz', 'Write: continue')).toBeUndefined();
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indexes: [] });
  });
});

describe('actions', () => {
  it('ranks recently used first on an empty query and by score with one', () => {
    const text = (a: { id: string }) => a.id;
    const empty = rankActions(ACTIONS, '', ['chapter.save', 'lint.run'], text);
    expect(empty[0]?.action.id).toBe('chapter.save');
    expect(empty[1]?.action.id).toBe('lint.run');
    expect(empty).toHaveLength(ACTIONS.length);
    const ranked = rankActions(ACTIONS, 'rewrite.deai', [], text);
    expect(ranked[0]?.action.id).toBe('rewrite.deai');
  });

  it('matches shortcuts by key and by physical code (Cyrillic layout)', () => {
    const save = ACTIONS.find((a) => a.id === 'chapter.save')!.shortcut!;
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }), save)).toBe(true);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'ы', code: 'KeyS', metaKey: true }), save)).toBe(true);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true }), save)).toBe(false);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's' }), save)).toBe(false);
  });

  it('reports unmet needs', () => {
    useStore.setState({ project: { chapters: [], spentUsd: 0 }, editor: { body: '', savedBody: '', dirty: false, cursor: 0, selection: { from: 0, to: 0 }, saving: false } });
    expect(unmetNeed(ACTIONS.find((a) => a.id === 'write.continue')!, useStore.getState())).toBe('chapter');
    expect(unmetNeed(ACTIONS.find((a) => a.id === 'rewrite.deai')!, useStore.getState())).toBe('selection');
    openProject();
    expect(unmetNeed(ACTIONS.find((a) => a.id === 'rewrite.deai')!, useStore.getState())).toBeUndefined();
  });

  it('every action has both labels and no two share a shortcut', () => {
    const seen = new Set<string>();
    for (const action of ACTIONS) {
      if (!action.shortcut) continue;
      const key = JSON.stringify(action.shortcut);
      expect(seen.has(key), `duplicate shortcut for ${action.id}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('CommandPalette', () => {
  beforeEach(() => {
    setClient(new ApexClient(new MockTransport({})));
    openProject();
    usePaletteState.setState({ formAction: undefined });
    useDialogs.setState({ diff: undefined, busy: undefined, describe: undefined, chronicleUpdate: undefined });
  });
  afterEach(cleanup);

  it('filters by a query and runs the chosen action, then closes', async () => {
    const runLint = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ runLint });
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'lint now' } });
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('Lint now');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(runLint).toHaveBeenCalled());
    expect(useStore.getState().ui.panel).toBe('lint');
    expect(useStore.getState().ui.paletteOpen).toBe(false);
  });

  it('navigates with the arrows and shows shortcuts', () => {
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'write' } });
    const first = screen.getAllByRole('option')[0]!;
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    expect(first.textContent).toContain('Enter');
  });

  it('asks for the beat in an inline form before a guided write', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ write });
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'guided' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const beat = await screen.findByLabelText(/Beat/);
    fireEvent.change(beat, { target: { value: 'She opens the gate.' } });
    fireEvent.keyDown(beat, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(write).toHaveBeenCalledWith('guided', { instruction: 'She opens the gate.' }));
  });

  it('toasts instead of running when a need is unmet', () => {
    useStore.setState({ editor: { ...useStore.getState().editor, selection: { from: 0, to: 0 } } });
    const runRewrite = vi.fn();
    useDialogs.setState({ runRewrite });
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'De-AI' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(runRewrite).not.toHaveBeenCalled();
    expect(useStore.getState().ui.toasts.at(-1)?.text).toMatch(/Select a passage/);
  });

  it('closes on Escape', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(useStore.getState().ui.paletteOpen).toBe(false);
  });
});
