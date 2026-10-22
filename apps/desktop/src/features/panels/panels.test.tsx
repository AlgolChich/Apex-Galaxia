import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApexClient, MockTransport, setClient } from '../../api/index.js';
import type { LintReport } from '../../api/types.js';
import { useStore } from '../../state/store.js';
import type { EditorEvent } from '../diff/editor-bridge.js';
import { useDialogs } from '../diff/store.js';
import { aliasesInBody } from './bible.js';
import { markdownParagraphs } from './chronicle.js';
import { RightPanel } from './index.js';
import { usePanels } from './state.js';

const body = 'Гриша вышел к воротам. Было очень холодно, и ему стало страшно.';
const report: LintReport = {
  hits: [
    { rule: 'banned-phrase', severity: 'warning', category: 'cliche', start: 23, end: 36, line: 1, column: 24, excerpt: 'очень холодно', message: { en: 'Banned phrase', ru: 'Запрещённая фраза' } },
    { rule: 'label-tag', severity: 'error', category: 'labeling', start: 46, end: 60, line: 1, column: 47, excerpt: 'стало страшно', message: { en: 'Named emotion', ru: 'Названная эмоция' } },
  ],
  counts: { info: 0, warning: 1, error: 1 },
  words: 10,
  paragraphs: 1,
};

function captureEditorEvents(): EditorEvent[] {
  const events: EditorEvent[] = [];
  window.addEventListener('apex:editor', (e) => events.push((e as CustomEvent<EditorEvent>).detail));
  return events;
}

describe('RightPanel', () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  beforeEach(() => {
    calls.length = 0;
    const record = (name: string) => (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return undefined;
    };
    setClient(
      new ApexClient(
        new MockTransport({
          lint_whitelist_add: (args) => {
            calls.push({ name: 'lint_whitelist_add', args });
            return { phrase: args['phrase'], added: true, file: 'style/whitelist.txt' };
          },
          critic_review: (args) => {
            calls.push({ name: 'critic_review', args });
            return { scores: { voice: 4, subtext: 3, rhythm: 2, cliche: 5, ai_tell: 5, continuity: 4, language: 4 }, quotes: [{ quote: 'стало страшно', issue: 'Named emotion', category: 'labeling', severity: 'medium', fix: 'Show it.' }], verdict: 'revise' };
          },
          bible_list: () => ({ entries: [{ kind: 'character', slug: 'grisha', name: 'Гриша', aliases: { ru: ['Григорий'], en: [] }, summary: 'The deckhand.', always_on: true }, { kind: 'location', slug: 'mine', name: 'Штрек', aliases: { ru: [], en: ['the channel'] }, summary: 'Old mine.', always_on: false }] }),
          bible_search: record('bible_search'),
          chronicle_get: (args) => ({ state: { in_story_time: 'Thursday, before dawn', last_chapter: 2, locations: { lead: 'at the gate' }, condition: {}, inventory: {}, knowledge: [], relations: [], open_threads: [{ id: 'gate', text: 'Who opened the gate?', since_chapter: 2, status: 'open' }, { id: 'old', text: 'Done', status: 'resolved' }], planted_guns: [], pending_consequences: [{ id: 'bp', text: 'June comes by in the morning', done: false }], rolls: [] }, log: '# Chapter 2\n\nThe strangers came at night.', ...(args['full'] ? { handover: 'HANDOVER', hidden: 'The chart pays off underground.' } : {}) }),
          inspect: () => ({ inspector: { task: 'write.continue', template: 'write.continue', model: 'scripted', kind: 'prose', budgetTokens: 1000, totalTokens: 400, exactCounts: false, layers: [{ name: 'persona', tokens: 100, included: true, action: 'kept' }, { name: 'bible', tokens: 300, included: true, action: 'compacted', note: 'two entries' }], bible: [{ slug: 'grisha', kind: 'character', reason: 'always_on', matchedAliases: ['Гриша'], hits: 3, included: true, full: true }], lessons: [{ id: 'L1', category: 'dialogue', rule: 'No motive speeches.' }], rolls: [], promptHashHint: 'abc' }, estimate: { model: 'scripted', inputTokens: 400, expectedOutputTokens: 900, costUsd: 0.01, exact: false } }),
        }),
      ),
    );
    useStore.setState({
      project: { root: '/story', chapters: [], spentUsd: 0 },
      editor: { stem: '02-gate', front: { number: 2, title: 'Gate', status: 'draft' }, body, savedBody: body, dirty: false, cursor: 0, selection: { from: 0, to: 0 }, saving: false },
      lint: { report, stem: '02-gate', running: false },
      ui: { ...useStore.getState().ui, language: 'en', panel: 'lint' },
    });
    usePanels.setState({ critic: undefined, handledCritic: 0 });
    useDialogs.setState({ criticRequest: undefined, chronicleVersion: 0 });
  });
  afterEach(cleanup);

  it('lint: groups hits by severity, goes to a hit, whitelists a banned phrase', async () => {
    const runLint = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ runLint });
    const events = captureEditorEvents();
    render(<RightPanel panel="lint" />);
    expect(screen.getByRole('region', { name: 'Errors' }).textContent).toContain('Named emotion');
    expect(screen.getByRole('region', { name: 'Warnings' }).textContent).toContain('Banned phrase');
    fireEvent.click(screen.getByRole('button', { name: /Named emotion/ }));
    expect(events.at(-1)).toEqual({ type: 'goto', from: 46, to: 60 });
    expect(screen.getAllByRole('button', { name: 'Whitelist' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Whitelist' }));
    await waitFor(() => expect(runLint).toHaveBeenCalled());
    expect(calls.find((c) => c.name === 'lint_whitelist_add')?.args).toEqual({ phrase: 'очень холодно' });
  });

  it('critic: runs on the chapter, shows scores and verdict, goes to a quote', async () => {
    const events = captureEditorEvents();
    render(<RightPanel panel="critic" />);
    fireEvent.click(screen.getByRole('button', { name: 'Critic: whole chapter' }));
    expect(await screen.findByText('revise')).toBeTruthy();
    expect(calls.find((c) => c.name === 'critic_review')?.args).toEqual({ chapter: 2 });
    expect(screen.getByText('2 / 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to' }));
    expect(events.at(-1)).toEqual({ type: 'goto', from: body.indexOf('стало страшно'), to: body.indexOf('стало страшно') + 'стало страшно'.length });
  });

  it('critic: a palette request runs once', async () => {
    useDialogs.getState().requestCritic('critic', 'chapter');
    render(<RightPanel panel="critic" />);
    await waitFor(() => expect(calls.filter((c) => c.name === 'critic_review')).toHaveLength(1));
    cleanup();
    render(<RightPanel panel="critic" />);
    expect(await screen.findByText('revise')).toBeTruthy();
    expect(calls.filter((c) => c.name === 'critic_review')).toHaveLength(1);
  });

  it('bible: lists entries and highlights those present in the chapter', async () => {
    render(<RightPanel panel="bible" />);
    const grisha = await screen.findByRole('button', { name: /Гриша/ });
    expect(grisha.textContent).toContain('in this chapter');
    expect(screen.getByRole('button', { name: /Штрек/ }).textContent).not.toContain('in this chapter');
    fireEvent.click(grisha);
    expect(screen.getByText('The deckhand.')).toBeTruthy();
    expect(aliasesInBody({ kind: 'character', slug: 'g', name: 'Гриша', aliases: { ru: ['Григорий'], en: [] }, summary: '', always_on: false }, body)).toEqual(['Гриша']);
  });

  it('chronicle: shows the state, the log and the hidden block on request', async () => {
    render(<RightPanel panel="chronicle" />);
    expect(await screen.findByText('Thursday, before dawn')).toBeTruthy();
    expect(screen.getByText(/Who opened the gate/)).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.getByText('The strangers came at night.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full handover' }));
    expect(await screen.findByText('The chart pays off underground.')).toBeTruthy();
    expect(screen.getByText(/Not for the reader/)).toBeTruthy();
    expect(markdownParagraphs('# Title\n\n- one\n- two\n\n**bold** text')).toEqual(['Title', 'one two', 'bold text']);
  });

  it('inspector: shows layers, the budget bar and the estimate', async () => {
    render(<RightPanel panel="inspector" />);
    expect(await screen.findByText(/400 of 1000 tokens/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('400');
    expect(screen.getByText('compacted')).toBeTruthy();
    expect(screen.getByText(/No motive speeches/)).toBeTruthy();
    expect(screen.getByText(/scripted · 400 in · ~900 out/)).toBeTruthy();
  });

  it('tabs switch through the store', () => {
    const togglePanel = vi.fn();
    useStore.setState({ togglePanel });
    render(<RightPanel panel="lint" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Critic' }));
    expect(togglePanel).toHaveBeenCalledWith('critic');
    fireEvent.click(screen.getByRole('tab', { name: 'Lint' }));
    expect(togglePanel).toHaveBeenCalledTimes(1);
  });
});
