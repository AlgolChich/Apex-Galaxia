import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { Editor, type EditorSelectionDetail } from './index.js';
import { minimalChange } from './controller.js';
import { countWords } from './words.js';
import { findView, installMockClient, openChapter, resetStore } from './test-helpers.js';

const BODY = 'Первый абзац про маяк.\n\nВторой абзац — про катер.';

describe('Editor', () => {
  beforeEach(() => {
    installMockClient();
  });

  afterEach(() => {
    cleanup();
    setClient(undefined);
    vi.restoreAllMocks();
  });

  it('renders the chapter body and syncs edits into the store', async () => {
    openChapter(BODY);
    const { container } = render(<Editor />);
    expect(container.querySelector('.cm-content')?.textContent).toContain('Первый абзац');
    expect(container.querySelector('.cm-content')?.getAttribute('spellcheck')).toBe('true');
    const view = findView(container);
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' Третий.' }, userEvent: 'input.type' }));
    await waitFor(() => expect(useStore.getState().editor.body).toBe(`${BODY} Третий.`));
    expect(useStore.getState().editor.dirty).toBe(true);
    expect(useStore.getState().editor.cursor).toBe(0);
  });

  it("executes 'apex:editor' replace, insert and goto commands and reports the selection", async () => {
    openChapter('abc def');
    const { container } = render(<Editor />);
    const view = findView(container);
    const selections: EditorSelectionDetail[] = [];
    const listener = (event: Event) => selections.push((event as CustomEvent<EditorSelectionDetail>).detail);
    window.addEventListener('apex:editor-selection', listener);

    act(() => window.dispatchEvent(new CustomEvent('apex:editor', { detail: { type: 'replace', from: 4, to: 7, text: 'xyz!' } })));
    expect(view.state.doc.toString()).toBe('abc xyz!');
    expect(useStore.getState().editor.body).toBe('abc xyz!');

    act(() => window.dispatchEvent(new CustomEvent('apex:editor', { detail: { type: 'goto', from: 0, to: 3 } })));
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);
    expect(useStore.getState().editor.selection).toEqual({ from: 0, to: 3 });
    await waitFor(() => expect(selections.at(-1)).toEqual({ from: 0, to: 3, text: 'abc' }));

    act(() => window.dispatchEvent(new CustomEvent('apex:editor', { detail: { type: 'insert', at: 8, text: ' end' } })));
    expect(view.state.doc.toString()).toBe('abc xyz! end');
    expect(useStore.getState().editor.body).toBe('abc xyz! end');
    window.removeEventListener('apex:editor-selection', listener);
  });

  it('applies external body changes as a minimal edit without losing the caret', () => {
    openChapter('Раз два три.');
    const { container } = render(<Editor />);
    const view = findView(container);
    act(() => view.dispatch({ selection: { anchor: 3 } }));
    act(() => useStore.getState().setBody('Раз два три. Четыре.'));
    expect(view.state.doc.toString()).toBe('Раз два три. Четыре.');
    expect(view.state.selection.main.head).toBe(3);
    expect(minimalChange('Раз два три.', 'Раз два три. Четыре.')).toEqual({ from: 12, to: 12, insert: ' Четыре.' });
    expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
  });

  it('underlines lint hits with a class per severity and the rule id', () => {
    openChapter('Это было очень важно.');
    const { container } = render(<Editor />);
    act(() =>
      useStore.setState({
        lint: {
          running: false,
          stem: '01-smena',
          report: {
            hits: [{ rule: 'ru.intensifier', severity: 'warning', category: 'style', start: 9, end: 14, line: 1, column: 10, excerpt: 'очень', message: { ru: 'Усилитель', en: 'Intensifier' } }],
            counts: { error: 0, warning: 1, info: 0 },
            words: 4,
            paragraphs: 1,
          },
        },
      }),
    );
    const mark = container.querySelector('.editor-lint.editor-lint--warning');
    expect(mark?.textContent).toBe('очень');
    expect(mark?.getAttribute('data-rule')).toBe('ru.intensifier');
    // The underline follows edits before the next report.
    const view = findView(container);
    act(() => view.dispatch({ changes: { from: 0, insert: 'Да. ' } }));
    expect(container.querySelector('.editor-lint--warning')?.textContent).toBe('очень');
  });

  it('saves on Ctrl+S and starts a continuation on Ctrl+Enter', async () => {
    const saves: string[] = [];
    const writes: number[] = [];
    installMockClient({
      chapter_save: (args) => {
        saves.push(args['body'] as string);
        return { front: { number: 1, title: 'Смена', status: 'draft', words: 3 }, stem: '01-smena', path: '/p/chapters/01-smena.md' };
      },
      write_continue: (args) => {
        writes.push(args['cursor'] as number);
        return { suggestion: { id: 's1', task: 'write_continue', created: '', model: 'scripted', status: 'pending' }, text: 'Дальше.', lint: { hits: [], counts: { error: 0, warning: 0, info: 0 }, words: 1, paragraphs: 1 }, costUsd: 0, model: 'scripted', warnings: [] };
      },
    });
    openChapter('Раз два.');
    const { container } = render(<Editor />);
    const view = findView(container);
    act(() => view.dispatch({ changes: { from: 8, insert: ' Три.' }, selection: { anchor: 13 }, userEvent: 'input.type' }));
    fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saves).toEqual(['Раз два. Три.']));
    await waitFor(() => expect(useStore.getState().editor.dirty).toBe(false));
    fireEvent.keyDown(view.contentDOM, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(writes).toEqual([13]));
  });

  it('offers to create a chapter when none is open', async () => {
    const created: string[] = [];
    installMockClient({
      chapter_create: (args) => {
        created.push(args['title'] as string);
        return { front: { number: 1, title: args['title'], status: 'draft' }, stem: '01-novaya', path: '/p/chapters/01-novaya.md' };
      },
      chapter_get: () => ({ front: { number: 1, title: 'Новая', status: 'draft' }, stem: '01-novaya', path: '/p/chapters/01-novaya.md', body: '' }),
    });
    resetStore({ project: { root: '/p', chapters: [], spentUsd: 0 } });
    vi.spyOn(window, 'prompt').mockReturnValue('Новая');
    render(<Editor />);
    expect(screen.getByText('No chapter is open')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New chapter' }));
    await waitFor(() => expect(created).toEqual(['Новая']));
    await waitFor(() => expect(useStore.getState().editor.stem).toBe('01-novaya'));
  });

  it('counts Cyrillic and Latin words alike', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('Насос завёлся с третьего раза.')).toBe(5);
    expect(countWords('— Вы Фёдор Ильич, — сказал он.')).toBe(5);
    expect(countWords("It's a well-known «rule» — ask anyone.")).toBe(6);
  });
});
