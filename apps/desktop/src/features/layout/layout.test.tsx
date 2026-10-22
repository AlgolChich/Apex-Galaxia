import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { installMockClient, openChapter } from '../editor/test-helpers.js';
import { StatusBar, TopBar, describeModel } from './index.js';
import { clampWidth, useFrame } from './frame-store.js';

describe('StatusBar', () => {
  afterEach(() => {
    cleanup();
    setClient(undefined);
  });

  it('counts words of the chapter, the project and the selection; shows date, cost and lint', () => {
    installMockClient();
    openChapter('Раз два три четыре', {
      project: {
        root: '/p',
        chapters: [
          { number: 1, title: 'One', status: 'final', stem: '01-one', words: 100 },
          { number: 2, title: 'Two', status: 'draft', stem: '02-two', words: 50 },
        ],
        spentUsd: 1.234,
      },
    });
    useStore.setState((s) => ({
      editor: { ...s.editor, stem: '02-two', front: { number: 2, title: 'Two', status: 'draft', in_story_date: '4 октября, утро' }, selection: { from: 0, to: 7 } },
      lint: { running: false, stem: '02-two', report: { hits: [], counts: { error: 1, warning: 2, info: 0 }, words: 4, paragraphs: 1 } },
    }));
    render(<StatusBar />);
    expect(screen.getByTestId('status-chapter-words').textContent).toBe('4 words');
    expect(screen.getByTestId('status-project-words').textContent).toBe('104 words');
    expect(screen.getByTestId('status-selected-words').textContent).toBe('2 words');
    expect(screen.getByText('4 октября, утро')).toBeTruthy();
    expect(screen.getByTestId('status-cost').textContent).toBe('$1.23');
    expect(screen.getByTestId('status-lint').textContent).toBe('1 error · 2 warnings');
    fireEvent.click(screen.getByTestId('status-lint'));
    expect(useStore.getState().ui.panel).toBe('lint');
    expect(screen.getByText('Scripted stand-in')).toBeTruthy();
  });

  it('toggles typewriter scrolling and shows the focus indicator', () => {
    installMockClient();
    openChapter('Текст.');
    useStore.setState((s) => ({ ui: { ...s.ui, focusMode: true } }));
    render(<StatusBar />);
    const typewriter = screen.getByRole('button', { name: 'Typewriter scrolling' });
    const before = typewriter.getAttribute('aria-pressed');
    fireEvent.click(typewriter);
    expect(typewriter.getAttribute('aria-pressed')).not.toBe(before);
    expect(screen.getByText(/Focus mode/)).toBeTruthy();
  });
});

describe('TopBar', () => {
  afterEach(() => {
    cleanup();
    setClient(undefined);
  });

  it('switches views with the buttons and Ctrl+1..6, toggles panels and the language', () => {
    installMockClient();
    openChapter('Текст.');
    render(<TopBar />);
    const views = within(screen.getByRole('navigation', { name: 'View' }));
    fireEvent.click(views.getByRole('button', { name: 'Bible' }));
    expect(useStore.getState().ui.view).toBe('bible');
    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    expect(useStore.getState().ui.view).toBe('chronicle');
    const panels = within(screen.getByRole('group', { name: 'Panel' }));
    fireEvent.click(panels.getByRole('button', { name: 'Lint' }));
    expect(useStore.getState().ui.panel).toBe('lint');
    fireEvent.click(panels.getByRole('button', { name: 'Lint' }));
    expect(useStore.getState().ui.panel).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Interface language/ }));
    expect(useStore.getState().ui.language).toBe('ru');
    expect(screen.getByRole('navigation', { name: 'Вид' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, shiftKey: true });
    expect(useStore.getState().ui.focusMode).toBe(true);
  });

  it('describes the model situation', () => {
    const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${Object.values(vars).join(',')}` : key);
    expect(describeModel({ status: 'connecting' }, t).tone).toBe('offline');
    expect(describeModel({ status: 'ready' }, t)).toMatchObject({ label: 'layout.model.noKey', tone: 'none' });
    expect(describeModel({ status: 'ready', model: { provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: null } }, t)).toMatchObject({ label: 'layout.model.scripted', tone: 'scripted' });
    const ready = describeModel({ status: 'ready', keySource: 'keychain', model: { provider: 'anthropic', key_source: 'env', scripted: false, has_model: true, exact_token_counts: true, models: { plan: 'a', prose: 'prose-model', critic: 'a', extract: 'a', summary: 'a', lint: 'a' }, project: '/p' } }, t);
    expect(ready).toMatchObject({ label: 'layout.model.claude', tone: 'ready' });
    expect(ready.detail).toContain('prose-model');
    expect(ready.detail).toContain('layout.key.keychain');
  });

  it('clamps frame widths', () => {
    expect(clampWidth(100, 180, 480)).toBe(180);
    expect(clampWidth(9999, 180, 480)).toBe(480);
    expect(clampWidth(Number.NaN, 180, 480)).toBe(180);
    useFrame.getState().setTreeWidth(300);
    expect(useFrame.getState().treeWidth).toBe(300);
  });
});
