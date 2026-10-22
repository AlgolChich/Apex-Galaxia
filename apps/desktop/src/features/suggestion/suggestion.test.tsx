import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApexClient, MockTransport, setClient } from '../../api/index.js';
import type { LintReport } from '../../api/types.js';
import { useStore, type PendingSuggestion } from '../../state/store.js';
import { useDialogs } from '../diff/store.js';
import { SuggestionBlock } from './index.js';

const lint: LintReport = {
  hits: [{ rule: 'banned-phrase', severity: 'warning', category: 'cliche', start: 0, end: 5, line: 1, column: 1, excerpt: 'Hello', message: { en: 'Banned phrase', ru: 'Запрещённая фраза' } }],
  counts: { info: 0, warning: 1, error: 0 },
  words: 4,
  paragraphs: 1,
};

function pendingSuggestion(): PendingSuggestion {
  return {
    front: { id: 'sug-1', task: 'write.continue', created: '2026-01-01', model: 'scripted', status: 'pending' },
    text: 'Hello there, world.',
    lint,
    costUsd: 0.0123,
    model: 'scripted',
    warnings: ['short'],
    mode: 'continue',
    cursor: 10,
    chapterNumber: 2,
    params: {},
  };
}

describe('SuggestionBlock', () => {
  beforeEach(() => {
    setClient(new ApexClient(new MockTransport({})));
    useStore.setState({ ui: { ...useStore.getState().ui, language: 'en' }, suggestion: { pending: undefined, stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } } });
    useDialogs.setState({ chronicleUpdate: undefined });
  });
  afterEach(cleanup);

  it('renders nothing when idle', () => {
    const { container } = render(<SuggestionBlock />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the arriving text while streaming and cancels', () => {
    const cancelWrite = vi.fn();
    useStore.setState({ cancelWrite, suggestion: { pending: undefined, stream: { active: true, text: 'Snow fell', mode: 'guided', startedAt: Date.now() - 65_000, abort: undefined } } });
    render(<SuggestionBlock />);
    expect(screen.getByText('Snow fell')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelWrite).toHaveBeenCalled();
  });

  it('shows the pending suggestion with lint counts, meta and accepts the edited text', async () => {
    const acceptSuggestion = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ acceptSuggestion, suggestion: { pending: pendingSuggestion(), stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } } });
    render(<SuggestionBlock />);
    expect(screen.getByText(/scripted · \$0.0123 · 3 words/)).toBeTruthy();
    expect(screen.getByText(/Warnings: short/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Linter: 0 errors · 1 warnings/ }));
    expect(screen.getByText(/Banned phrase/)).toBeTruthy();
    const editor = screen.getByRole('textbox', { name: /Suggestion text/ });
    fireEvent.change(editor, { target: { value: 'Hello there, edited world.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(acceptSuggestion).toHaveBeenCalledWith('Hello there, edited world.'));
  });

  it('accepts unedited text without an override and then offers the chronicle update', async () => {
    const acceptSuggestion = vi.fn(async () => {
      useStore.setState((s) => ({ suggestion: { ...s.suggestion, pending: undefined } }));
    });
    useStore.setState({ acceptSuggestion, suggestion: { pending: pendingSuggestion(), stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } } });
    render(<SuggestionBlock />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    });
    expect(acceptSuggestion).toHaveBeenCalledWith(undefined);
    const bar = await screen.findByText('Update the chronicle for chapter 2?');
    expect(bar).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(useDialogs.getState().chronicleUpdate).toEqual({ chapter: 2 });
  });

  it('retries with a note and discards after a confirmation', async () => {
    const retrySuggestion = vi.fn().mockResolvedValue(undefined);
    const discardSuggestion = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ retrySuggestion, discardSuggestion, suggestion: { pending: pendingSuggestion(), stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } } });
    render(<SuggestionBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry with a note' }));
    const note = screen.getByRole('textbox', { name: 'Retry with a note' });
    fireEvent.change(note, { target: { value: 'less snow' } });
    fireEvent.submit(note.closest('form')!);
    expect(retrySuggestion).toHaveBeenCalledWith('less snow');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByText('Discard the suggestion?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(discardSuggestion).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: /Suggestion text/ }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(discardSuggestion).toHaveBeenCalled());
  });

  it('collapses to a one-line bar', () => {
    useStore.setState({ suggestion: { pending: pendingSuggestion(), stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } } });
    render(<SuggestionBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.getByText('Suggestion: 3 words')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Suggestion text/ })).toBeNull();
  });
});
