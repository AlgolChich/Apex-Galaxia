import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApexClient, MockTransport, setClient } from '../../api/index.js';
import type { DiffBlock, LintReport } from '../../api/types.js';
import { useStore } from '../../state/store.js';
import { composeParagraphs, composeReplacement, nothingAccepted } from './compose.js';
import type { EditorEvent } from './editor-bridge.js';
import { paragraphAt } from './editor-bridge.js';
import { DiffDialog } from './index.js';
import { wordDiff } from './lcs.js';
import { openDiff, useDialogs } from './store.js';

const lint: LintReport = { hits: [], counts: { info: 0, warning: 0, error: 0 }, words: 10, paragraphs: 3 };

const blocks: DiffBlock[] = [
  { kind: 'same', before: ['Первый абзац.'], after: ['Первый абзац.'] },
  { kind: 'changed', before: ['Он пошёл домой медленно.'], after: ['Он пошёл домой быстро.'] },
  { kind: 'added', before: [], after: ['Пахло снегом.'] },
  { kind: 'removed', before: ['Лишний абзац.'], after: [] },
];

describe('word-level LCS', () => {
  it('marks only the words that differ', () => {
    const d = wordDiff('Он пошёл домой медленно.', 'Он пошёл домой быстро.');
    expect(d.before.map((s) => [s.kind, s.text])).toEqual([
      ['same', 'Он пошёл домой '],
      ['removed', 'медленно.'],
    ]);
    expect(d.after.map((s) => [s.kind, s.text])).toEqual([
      ['same', 'Он пошёл домой '],
      ['added', 'быстро.'],
    ]);
  });

  it('handles insertions in the middle and identical text', () => {
    const d = wordDiff('a b c', 'a x b c');
    expect(d.after.map((s) => [s.kind, s.text])).toEqual([
      ['same', 'a '],
      ['added', 'x '],
      ['same', 'b c'],
    ]);
    expect(d.before.every((s) => s.kind === 'same')).toBe(true);
    expect(wordDiff('same', 'same')).toEqual({ before: [{ text: 'same', kind: 'same' }], after: [{ text: 'same', kind: 'same' }] });
  });
});

describe('compose', () => {
  it('takes after for accepted blocks and before for rejected ones', () => {
    expect(composeParagraphs(blocks, [true, true, true, true])).toEqual(['Первый абзац.', 'Он пошёл домой быстро.', 'Пахло снегом.']);
    expect(composeParagraphs(blocks, [true, false, false, false])).toEqual(['Первый абзац.', 'Он пошёл домой медленно.', 'Лишний абзац.']);
    expect(nothingAccepted(blocks, [true, false, false, false])).toBe(true);
    expect(nothingAccepted(blocks, [true, true, false, false])).toBe(false);
  });

  it('keeps the leading and trailing whitespace of the original passage', () => {
    const before = '\n\nПервый абзац.\n\nОн пошёл домой медленно.\n\nЛишний абзац.\n';
    expect(composeReplacement(before, blocks, [true, true, false, true])).toBe('\n\nПервый абзац.\n\nОн пошёл домой быстро.\n');
  });
});

describe('paragraphAt', () => {
  it('finds the paragraph around an offset, trimmed', () => {
    const body = 'One.\n\n  Two two.  \n\nThree.';
    expect(paragraphAt(body, 0)).toEqual({ from: 0, to: 4, text: 'One.' });
    expect(paragraphAt(body, 10)).toEqual({ from: 8, to: 16, text: 'Two two.' });
    expect(paragraphAt(body, body.length)).toEqual({ from: 20, to: 26, text: 'Three.' });
  });
});

describe('DiffDialog', () => {
  const before = 'Первый абзац.\n\nОн пошёл домой медленно.\n\nЛишний абзац.';
  beforeEach(() => {
    setClient(
      new ApexClient(
        new MockTransport({
          lessons_propose: () => ({ category: 'rhythm', rule: 'Short verbs first.', language: 'ru' }),
          lessons_add: (args) => ({ lesson: { id: 'L9', ...args } }),
        }),
      ),
    );
    useStore.setState({ ui: { ...useStore.getState().ui, language: 'en' } });
    useDialogs.setState({ diff: undefined, busy: undefined });
  });
  afterEach(cleanup);

  it('composes the text from accepted blocks and replaces the original range', async () => {
    const events: EditorEvent[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent<EditorEvent>).detail);
    window.addEventListener('apex:editor', listener);
    openDiff({ op: 'tighten', from: 100, to: 100 + before.length, before, result: { text: 'x', diff: blocks, lint } });
    render(<DiffDialog />);
    expect(screen.getByRole('dialog', { name: /Rewrite: Tighten/ })).toBeTruthy();
    const removedGroup = screen.getByRole('group', { name: 'removed 4' });
    fireEvent.click(removedGroup.querySelector('button:last-child')!);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ type: 'replace', from: 100, to: 100 + before.length, text: 'Первый абзац.\n\nОн пошёл домой быстро.\n\nПахло снегом.\n\nЛишний абзац.' });
    expect(useDialogs.getState().diff).toBeUndefined();
    window.removeEventListener('apex:editor', listener);
  });

  it('refuses to apply when every block is rejected', () => {
    openDiff({ op: 'deai', from: 0, to: before.length, before, result: { text: 'x', diff: blocks, lint } });
    render(<DiffDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(useStore.getState().ui.toasts.at(-1)?.text).toMatch(/nothing to apply/);
    expect(useDialogs.getState().diff).toBeDefined();
  });

  it('proposes a lesson after applying when asked', async () => {
    openDiff({ op: 'tone', from: 0, to: before.length, before, result: { text: 'x', diff: blocks, lint } });
    render(<DiffDialog />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Propose a lesson/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Short verbs first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to lessons' }));
    await waitFor(() => expect(useDialogs.getState().diff).toBeUndefined());
    expect(useStore.getState().ui.toasts.at(-1)?.text).toMatch(/Lesson added/);
  });

  it('shows a busy card with Cancel while a rewrite runs', () => {
    useDialogs.setState({ busy: { op: 'deai', nonce: 1 } });
    render(<DiffDialog />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useDialogs.getState().busy).toBeUndefined();
  });
});
