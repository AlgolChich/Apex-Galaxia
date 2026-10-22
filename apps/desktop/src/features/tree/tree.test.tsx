import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { installMockClient, openChapter, resetStore } from '../editor/test-helpers.js';
import { ProjectTree } from './index.js';

const CHAPTERS = [
  { number: 1, title: 'One', status: 'final' as const, stem: '01-one', words: 100 },
  { number: 2, title: 'Two', status: 'draft' as const, stem: '02-two', words: 50 },
];

describe('ProjectTree', () => {
  afterEach(() => {
    cleanup();
    setClient(undefined);
    vi.restoreAllMocks();
  });

  it('lists chapters with status and words, opens one on click and switches views', async () => {
    const gets: unknown[] = [];
    installMockClient({
      chapter_get: (args) => {
        gets.push(args['chapter']);
        return { front: { number: 2, title: 'Two', status: 'draft' }, stem: '02-two', path: '/p/chapters/02-two.md', body: 'Текст.' };
      },
    });
    openChapter('Один.', { project: { root: '/p', chapters: CHAPTERS, spentUsd: 0 } });
    useStore.setState((s) => ({ editor: { ...s.editor, stem: '01-one', front: { number: 1, title: 'One', status: 'final' } } }));
    render(<ProjectTree />);
    const one = screen.getByRole('button', { name: '1. One, Final, 100 words, current' });
    expect(one.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '2. Two, Draft, 50 words' }));
    await waitFor(() => expect(useStore.getState().editor.stem).toBe('02-two'));
    expect(gets).toEqual(['02-two']);
    fireEvent.click(screen.getByRole('button', { name: 'Chronicle' }));
    expect(useStore.getState().ui.view).toBe('chronicle');
    expect(screen.getByRole('button', { name: 'Chronicle' }).getAttribute('aria-current')).toBe('page');
  });

  it('moves focus between rows with the arrow keys', () => {
    installMockClient();
    openChapter('Один.', { project: { root: '/p', chapters: CHAPTERS, spentUsd: 0 } });
    render(<ProjectTree />);
    const nav = screen.getByRole('navigation', { name: 'Project tree' });
    const first = screen.getByRole('button', { name: /^1\. One/ });
    first.focus();
    fireEvent.keyDown(nav, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^2\. Two/ }));
    fireEvent.keyDown(nav, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Settings');
    fireEvent.keyDown(nav, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('renames a chapter and sets its status through chapter_save', async () => {
    const saves: Array<Record<string, unknown>> = [];
    installMockClient({
      chapter_save: (args) => {
        saves.push(args);
        return { front: { number: 2, title: args['title'] ?? 'Two', status: args['status'] ?? 'draft', words: 1 }, stem: '02-two', path: '/p/chapters/02-two.md' };
      },
      chapter_get: () => ({ front: { number: 2, title: 'Two', status: 'draft' }, stem: '02-two', path: '/p/chapters/02-two.md', body: 'Текст второй.' }),
      project_chapters: () => ({ chapters: CHAPTERS }),
    });
    openChapter('Один.', { project: { root: '/p', chapters: CHAPTERS, spentUsd: 0 } });
    vi.spyOn(window, 'prompt').mockReturnValue('Second');
    render(<ProjectTree />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for chapter 2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ chapter: '02-two', body: 'Текст второй.', title: 'Second' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for chapter 2' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Final' }));
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]).toMatchObject({ chapter: '02-two', status: 'final' });
  });

  it('creates a chapter from the heading button', async () => {
    const created: string[] = [];
    installMockClient({
      chapter_create: (args) => {
        created.push(args['title'] as string);
        return { front: { number: 3, title: args['title'], status: 'draft' }, stem: '03-three', path: '/p/chapters/03-three.md' };
      },
    });
    openChapter('Один.', { project: { root: '/p', chapters: CHAPTERS, spentUsd: 0 } });
    vi.spyOn(window, 'prompt').mockReturnValue('Three');
    render(<ProjectTree />);
    fireEvent.click(screen.getByRole('button', { name: 'New chapter' }));
    await waitFor(() => expect(created).toEqual(['Three']));
  });
});

describe('Welcome', () => {
  afterEach(() => {
    cleanup();
    setClient(undefined);
  });

  it('opens a typed path, lists recent projects and shows the model state', async () => {
    const opened: unknown[] = [];
    installMockClient({
      project_open: (args) => {
        opened.push(args['path']);
        return { root: args['path'], config: { title: 'Маяк', language: 'ru' }, chapters: [], spentUsd: 0 };
      },
    });
    resetStore({
      connection: { status: 'ready', model: { provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: null } },
      ui: { language: 'en', theme: 'system', view: 'editor', panel: null, treeOpen: true, focusMode: false, paletteOpen: false, wizard: 'none', toasts: [], recent: ['/stories/mayak'] },
    });
    render(<ProjectTree.Welcome />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Apex Galaxia');
    expect(screen.getByText(/Scripted stand-in/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open mayak' }));
    await waitFor(() => expect(opened).toEqual(['/stories/mayak']));
    fireEvent.change(screen.getByPlaceholderText('Path to a story folder'), { target: { value: '/stories/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    await waitFor(() => expect(useStore.getState().project.root).toBe('/stories/new'));
    fireEvent.click(screen.getByRole('button', { name: 'New story' }));
    expect(useStore.getState().ui.wizard).toBe('new-story');
  });
});
