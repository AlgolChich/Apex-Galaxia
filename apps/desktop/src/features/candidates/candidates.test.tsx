import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateResult, CandidatesResult, CriticResult, LintReport } from '../../api/types.js';
import { useStore } from '../../state/store.js';
import { useDialogs } from '../diff/store.js';
import { callsOf, mockClient, openSampleProject, resetStore } from '../wizard/test-utils.js';
import { CandidatesDialog, criticPick, pairFor, useCandidates } from './index.js';

const lint: LintReport = { hits: [], counts: { info: 0, warning: 0, error: 0 }, words: 12, paragraphs: 1 };
const hit: LintReport = { hits: [{ rule: 'banned-phrase', severity: 'warning', category: 'cliche', start: 0, end: 5, line: 1, column: 1, excerpt: 'Hello', message: { en: 'Banned', ru: 'Запрещено' } }], counts: { info: 0, warning: 1, error: 0 }, words: 12, paragraphs: 1 };

function critic(score: number, verdict: CriticResult['verdict'] = 'pass'): CriticResult {
  return { scores: { voice: score, subtext: score, rhythm: score, cliche: score, ai_tell: score, continuity: score, language: score }, quotes: [], verdict };
}

function candidate(id: string, text: string, score: number | null, extra: Partial<CandidateResult> = {}): CandidateResult {
  return { suggestion: { id, task: 'write.continue', created: '2026-10-22', model: 'scripted', status: 'pending', chapter: 1 }, text, lint, critic: score === null ? null : critic(score), score, model: 'scripted', costUsd: 0.01, ...extra };
}

function twoCandidates(): CandidatesResult {
  return { mode: 'continue', candidates: [candidate('sug-a', 'Снег лёг на крыльцо.', 4.4, { lint: hit }), candidate('sug-b', 'Фёдор молчал до рассвета.', 3.6, { critic: critic(3.6, 'revise') })], ranking: ['sug-a', 'sug-b'], costUsd: 0.02 };
}

function threeCandidates(): CandidatesResult {
  return { mode: 'guided', candidates: [candidate('sug-1', 'One.', 3.0), candidate('sug-2', 'Two.', 4.6), candidate('sug-3', 'Three.', 4.0)], ranking: ['sug-2', 'sug-3', 'sug-1'], costUsd: 0.03 };
}

const openEvent = (detail: Record<string, unknown> = { mode: 'continue' }) =>
  act(async () => {
    window.dispatchEvent(new CustomEvent('apex:candidates', { detail }));
  });

function setup(result: CandidatesResult, extra: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  return mockClient({
    write_candidates: async (_args, emit, request) => {
      const token = (request.params as { _meta?: { progressToken?: string | number } })._meta?.progressToken;
      if (token !== undefined) {
        emit({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: 1, total: result.candidates.length, message: 'candidate 1/2' } });
      }
      return result;
    },
    suggestion_accept: () => ({ chapter: { number: 1, title: 'One', status: 'draft', words: 950 }, path: '/tmp/story/chapters/01-one.md', stem: '01-one' }),
    suggestion_discard: (args) => ({ id: args['id'], status: 'discarded' }),
    ab_record: (args) => ({ record: { ts: 'now', task: args['task'], left: args['left'], right: args['right'], choice: args['choice'], critic_preferred: args['critic_preferred'] ?? null, agreed: null } }),
    ab_list: () => ({ records: [], count: 4, judged: 3, critic_agreement: 0.667 }),
    project_chapters: () => ({ chapters: [{ number: 1, title: 'One', status: 'draft', words: 950 }] }),
    project_open: () => ({ root: '/tmp/story', config: useStore.getState().project.config, chapters: [], spentUsd: 0.12 }),
    chapter_get: () => ({ front: { number: 1, title: 'One', status: 'draft' }, stem: '01-one', path: '/tmp/story/chapters/01-one.md', body: 'Hello. Снег лёг на крыльцо.' }),
    lint: () => lint,
    ...extra,
  });
}

describe('pairFor and criticPick', () => {
  it('records two candidates as left and right with the critic’s side', () => {
    expect(pairFor(twoCandidates(), 'sug-b')).toEqual({ left: 'sug-a', right: 'sug-b', choice: 'right', critic_preferred: 'left' });
    expect(pairFor(twoCandidates(), 'sug-a')).toEqual({ left: 'sug-a', right: 'sug-b', choice: 'left', critic_preferred: 'left' });
    expect(pairFor(twoCandidates(), null)).toEqual({ left: 'sug-a', right: 'sug-b', choice: 'tie', critic_preferred: 'left' });
    expect(criticPick(twoCandidates())).toBe('sug-a');
  });

  it('pairs the chosen one of three with the critic’s favourite other, the first two on a tie', () => {
    expect(pairFor(threeCandidates(), 'sug-3')).toEqual({ left: 'sug-2', right: 'sug-3', choice: 'right', critic_preferred: 'left' });
    expect(pairFor(threeCandidates(), 'sug-1')).toEqual({ left: 'sug-1', right: 'sug-2', choice: 'left', critic_preferred: 'right' });
    expect(pairFor(threeCandidates(), null)).toEqual({ left: 'sug-1', right: 'sug-2', choice: 'tie', critic_preferred: 'right' });
  });

  it('has no critic side when the critic read neither candidate', () => {
    const result: CandidatesResult = { mode: 'continue', candidates: [candidate('x', 'X', null), candidate('y', 'Y', null)], ranking: ['x', 'y'], costUsd: 0 };
    expect(pairFor(result, 'y')).toEqual({ left: 'x', right: 'y', choice: 'right', critic_preferred: null });
    expect(criticPick(result)).toBeUndefined();
  });
});

describe('CandidatesDialog', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
    useStore.setState({ editor: { stem: '01-one', front: { number: 1, title: 'One', status: 'draft' }, body: 'Hello.', savedBody: 'Hello.', dirty: false, cursor: 6, selection: { from: 6, to: 6 }, saving: false } });
    useCandidates.setState({ request: undefined });
    useDialogs.setState({ chronicleUpdate: undefined });
  });
  afterEach(cleanup);

  it('opens on the event, drafts with the form values, shows both candidates and records the choice', async () => {
    const transport = setup(twoCandidates());
    const { container } = render(<CandidatesDialog />);
    expect(container.innerHTML).toBe('');

    await openEvent({ mode: 'continue' });
    const dialog = await screen.findByRole('dialog', { name: 'Candidates' });
    expect(await within(dialog).findByText(/A\/B so far: 4 choices, the critic agreed in 67%/)).toBeTruthy();
    expect((screen.getByLabelText('What to write') as HTMLSelectElement).value).toBe('continue');
    fireEvent.change(screen.getByLabelText('How many candidates'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Target words'), { target: { value: '400' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 2 candidates' }));
    });
    expect(callsOf(transport, 'write_candidates')).toEqual([{ mode: 'continue', count: 2, chapter: 1, cursor: 6, target_words: 400 }]);

    expect(await screen.findByText('Which one is better?')).toBeTruthy();
    const first = screen.getByTestId('candidate-1');
    const second = screen.getByTestId('candidate-2');
    expect(within(first).getByText('Снег лёг на крыльцо.')).toBeTruthy();
    expect(within(first).getByText('Critic: 4.4 of 5')).toBeTruthy();
    expect(within(first).getByText('pass')).toBeTruthy();
    expect(within(first).getByText('critic’s pick')).toBeTruthy();
    expect(within(first).getByText('Linter: 0 errors · 1 warnings · 0 notes')).toBeTruthy();
    expect(within(first).getByText('scripted · $0.0100')).toBeTruthy();
    expect(within(second).getByText('Critic: 3.6 of 5')).toBeTruthy();
    expect(within(second).getByText('revise')).toBeTruthy();
    expect(within(second).queryByText('critic’s pick')).toBeNull();
    expect(screen.getByText('Total: $0.0200 for 2 candidates')).toBeTruthy();

    const accept = screen.getByRole('button', { name: 'Choose a candidate' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Choose this one: candidate 2' }));
    fireEvent.change(screen.getByLabelText('A note on the choice (optional)'), { target: { value: 'quieter' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept candidate 2' }));
    });

    expect(await screen.findByText('Candidate 2 accepted into chapter 1.')).toBeTruthy();
    expect(callsOf(transport, 'suggestion_accept')).toEqual([{ id: 'sug-b' }]);
    expect(callsOf(transport, 'suggestion_discard')).toEqual([{ id: 'sug-a' }]);
    expect(callsOf(transport, 'ab_record')).toEqual([{ left: 'sug-a', right: 'sug-b', choice: 'right', note: 'quieter', task: 'write.continue', critic_preferred: 'left' }]);
    expect(callsOf(transport, 'project_chapters')).toHaveLength(2);
    expect(callsOf(transport, 'chapter_get')).toEqual([{ chapter: '01-one' }]);
    expect(useStore.getState().editor.body).toContain('Снег лёг на крыльцо.');

    fireEvent.click(screen.getByRole('button', { name: 'Update the chronicle' }));
    expect(useDialogs.getState().chronicleUpdate).toEqual({ chapter: 1 });
    expect(useCandidates.getState().request).toBeUndefined();
  });

  it('selects with the digit keys and confirms with Enter', async () => {
    const transport = setup(twoCandidates());
    render(<CandidatesDialog />);
    await openEvent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 2 candidates' }));
    });
    const group = await screen.findByRole('radiogroup', { name: 'Which one is better?' });
    fireEvent.keyDown(group, { key: '1' });
    expect((screen.getByRole('radio', { name: 'Choose this one: candidate 1' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Accept candidate 1' })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(group, { key: 'Enter' });
    });
    await screen.findByText('Candidate 1 accepted into chapter 1.');
    expect(callsOf(transport, 'suggestion_accept')).toEqual([{ id: 'sug-a' }]);
    expect(callsOf(transport, 'ab_record')).toEqual([{ left: 'sug-a', right: 'sug-b', choice: 'left', task: 'write.continue', critic_preferred: 'left' }]);
  });

  it('records a tie and keeps the critic’s pick', async () => {
    const transport = setup(twoCandidates());
    render(<CandidatesDialog />);
    await openEvent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 2 candidates' }));
    });
    await screen.findByText('Which one is better?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tie' }));
    });
    await screen.findByText('Candidate 1 accepted into chapter 1.');
    expect(callsOf(transport, 'suggestion_accept')).toEqual([{ id: 'sug-a' }]);
    expect(callsOf(transport, 'suggestion_discard')).toEqual([{ id: 'sug-b' }]);
    expect(callsOf(transport, 'ab_record')).toEqual([{ left: 'sug-a', right: 'sug-b', choice: 'tie', task: 'write.continue', critic_preferred: 'left' }]);
  });

  it('with three candidates records the chosen one against the critic’s favourite other', async () => {
    const transport = setup(threeCandidates());
    render(<CandidatesDialog />);
    await openEvent({ mode: 'guided', instruction: 'The gate opens.' });
    expect((screen.getByLabelText('Beat') as HTMLTextAreaElement).value).toBe('The gate opens.');
    fireEvent.change(screen.getByLabelText('How many candidates'), { target: { value: '3' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 3 candidates' }));
    });
    expect(callsOf(transport, 'write_candidates')).toEqual([{ mode: 'guided', count: 3, chapter: 1, cursor: 6, target_words: 300, instruction: 'The gate opens.' }]);
    await screen.findByText('Which one is better?');
    expect(within(screen.getByTestId('candidate-2')).getByText('critic’s pick')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose this one: candidate 3' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept candidate 3' }));
    });
    await screen.findByText('Candidate 3 accepted into chapter 1.');
    expect(callsOf(transport, 'suggestion_accept')).toEqual([{ id: 'sug-3' }]);
    expect(callsOf(transport, 'suggestion_discard')).toEqual([{ id: 'sug-1' }, { id: 'sug-2' }]);
    expect(callsOf(transport, 'ab_record')).toEqual([{ left: 'sug-2', right: 'sug-3', choice: 'right', task: 'write.guided', critic_preferred: 'left' }]);
  });

  it('discards every candidate without recording, after a confirmation', async () => {
    const transport = setup(twoCandidates());
    render(<CandidatesDialog />);
    await openEvent();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 2 candidates' }));
    });
    await screen.findByText('Which one is better?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard all' }));
    expect(screen.getByText('Discard the candidates? They are already paid for.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(screen.queryByText('Discard the candidates? They are already paid for.')).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, discard' }));
    });
    await waitFor(() => expect(callsOf(transport, 'suggestion_discard')).toEqual([{ id: 'sug-a' }, { id: 'sug-b' }]));
    expect(callsOf(transport, 'suggestion_accept')).toHaveLength(0);
    expect(callsOf(transport, 'ab_record')).toHaveLength(0);
    expect(useCandidates.getState().request).toBeUndefined();
  });

  it('shows the progress while drafting and discards what arrives after a cancel', async () => {
    let finish: ((result: CandidatesResult) => void) | undefined;
    const slow = mockClient({
      write_candidates: (_args, emit, request) =>
        new Promise<CandidatesResult>((resolve) => {
          const token = (request.params as { _meta?: { progressToken?: string | number } })._meta?.progressToken;
          emit({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token!, progress: 1, total: 2, message: 'candidate 1/2' } });
          finish = resolve;
        }),
      suggestion_discard: (args) => ({ id: args['id'], status: 'discarded' }),
      ab_list: () => ({ records: [], count: 0, judged: 0, critic_agreement: null }),
      project_chapters: () => ({ chapters: [] }),
      project_open: () => ({ root: '/tmp/story', config: useStore.getState().project.config, chapters: [], spentUsd: 0 }),
    });
    render(<CandidatesDialog />);
    await openEvent();
    expect(await screen.findByText('No A/B choices yet: the first one feeds the project’s eval record.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 2 candidates' }));
    });
    expect(await screen.findByText('1 of 2 ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useCandidates.getState().request).toBeUndefined();
    await act(async () => {
      finish!(twoCandidates());
    });
    await waitFor(() => expect(callsOf(slow, 'suggestion_discard')).toEqual([{ id: 'sug-a' }, { id: 'sug-b' }]));
    expect(useStore.getState().ui.toasts.at(-1)?.text).toBe('Candidates discarded');
  });

  it('asks for a chapter in the continuation modes and drafts a new chapter without one', async () => {
    const transport = setup({ ...twoCandidates(), mode: 'chapter' });
    useStore.setState({ editor: { body: '', savedBody: '', dirty: false, cursor: 0, selection: { from: 0, to: 0 }, saving: false } });
    render(<CandidatesDialog />);
    await openEvent({ mode: 'continue' });
    expect(screen.getByText('Open a chapter: the candidates continue it from the caret.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Draft 2 candidates' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What to write'), { target: { value: 'chapter' } });
    expect(screen.getByText('Empty: the beat sheet’s title. This will be chapter 2.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Chapter title'), { target: { value: 'Фары' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Draft 2 candidates' }));
    });
    expect(callsOf(transport, 'write_candidates')).toEqual([{ mode: 'chapter', count: 2, chapter_number: 2, title: 'Фары', target_words: 300 }]);
  });
});
