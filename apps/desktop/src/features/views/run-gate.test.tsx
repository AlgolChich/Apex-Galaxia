import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonRpcMessage } from '../../api/index.js';
import type { RunState } from '../../api/types.js';
import { useStore } from '../../state/store.js';
import { callsOf, mockClient, openSampleProject, resetStore } from '../wizard/test-utils.js';
import { RunView } from './index.js';
import { liveOf, useRunStore } from './run-store.js';

const flush = () => act(async () => undefined);

const decision = { chapter: 2, items: [{ who: 'Медик', what: 'гибнет под обломками ангара' }, { who: 'Скаут', what: 'сжигает записку' }] };

function waiting(): RunState {
  return { id: 'run-7', started_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:05:00Z', status: 'awaiting_decision', target_chapters: 3, next_chapter: 2, stage: 'plan', completed: [1], cost_usd: 0.3, outline_approved: true, pending_decision: decision, approved_decisions: [], log: ['run started', 'chapter 2 plans irreversible choices; waiting for the Author'] };
}

function running(): RunState {
  return { id: 'run-7', started_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:06:00Z', status: 'running', target_chapters: 3, next_chapter: 2, stage: 'plan', completed: [1], cost_usd: 0.3, outline_approved: true, approved_decisions: [2], log: ['run started', 'irreversible choices of chapter 2 approved by the Author'] };
}

describe('RunView: the ASK gate', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
    useRunStore.getState().clear();
  });
  afterEach(cleanup);

  it('seeds the live view with the pending decision only while the run waits', () => {
    const live = liveOf(waiting());
    expect(live.pendingDecision).toEqual(decision);
    expect(live.decisionOpen).toBe(true);
    const resumed = liveOf({ ...running(), pending_decision: decision });
    expect(resumed.pendingDecision).toBeUndefined();
  });

  it('lists a waiting run with Decide, opens the card and approves with run_start', async () => {
    const transport = mockClient({
      run_list: () => ({ runs: [waiting()] }),
      run_get: () => ({ state: waiting(), live: false }),
      run_start: () => ({ id: 'run-7', state: running() }),
    });
    render(<RunView />);
    const list = await screen.findByRole('list', { name: 'Saved runs' });
    expect(within(list).getByText('awaiting the Author’s decision')).toBeTruthy();
    expect(screen.queryByTestId('run-decision')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Decide: run-7' }));
    });
    expect(callsOf(transport, 'run_get')).toEqual([{ id: 'run-7' }]);
    const card = screen.getByRole('region', { name: 'Chapter 2 plans choices the story cannot take back' });
    const items = within(card).getByRole('list', { name: 'Irreversible choices' });
    expect(within(items).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Медик: гибнет под обломками ангара', 'Скаут: сжигает записку']);
    expect(within(card).getByText(/plan\/beats\/02\.json/)).toBeTruthy();
    expect(screen.getByText('Chapter 2 waits for the Author’s decision; nothing has been written.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Approve and continue' }));
    });
    expect(callsOf(transport, 'run_start')).toEqual([{ resume: 'run-7', approve_decision: true, reader_report: false }]);
    expect(screen.queryByTestId('run-decision')).toBeNull();
    expect(screen.getByRole('region', { name: /Current run/ }).textContent).toContain('running');
  });

  it('updates the card live from a run event with pending_decision, hides it on Stop and brings it back with Decide', async () => {
    let emit: ((n: JsonRpcMessage) => void) | undefined;
    const started: RunState = { ...running(), approved_decisions: [], completed: [], next_chapter: 1, log: ['run started'] };
    mockClient({
      run_list: () => ({ runs: [started] }),
      run_start: (_args, e) => {
        emit = e;
        return { id: 'run-7', state: started };
      },
    });
    render(<RunView />);
    await screen.findByRole('list', { name: 'Saved runs' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
    expect(screen.queryByTestId('run-decision')).toBeNull();

    const event = (data: Record<string, unknown>) => emit!({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'apex.run', data: { run_id: 'run-7', ...data } } });
    event({ status: 'awaiting_decision', stage: 'plan', next_chapter: 2, completed: 1, target: 3, cost_usd: 0.3, message: 'chapter 2 plans irreversible choices; waiting for the Author', pending_decision: { chapter: 2, items: [decision.items[0]] } });
    await flush();
    const card = screen.getByTestId('run-decision');
    expect(within(card).getByText('Chapter 2 plans choices the story cannot take back')).toBeTruthy();
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('region', { name: /Current run/ }).textContent).toContain('awaiting the Author’s decision');

    // A later event with more items replaces the card's content.
    event({ pending_decision: decision });
    await flush();
    expect(within(screen.getByTestId('run-decision')).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByTestId('run-decision')).toBeNull();
    expect(useRunStore.getState().live?.status).toBe('awaiting_decision');
    fireEvent.click(screen.getByRole('button', { name: 'Decide' }));
    expect(screen.getByTestId('run-decision')).toBeTruthy();

    // Once the run moves on, the gate is gone.
    event({ status: 'running', stage: 'write', message: 'chapter 2: planned' });
    await flush();
    expect(screen.queryByTestId('run-decision')).toBeNull();
    expect(useRunStore.getState().live?.pendingDecision).toBeUndefined();
  });

  it('hands off to the plan view with a toast naming the beat sheet file', async () => {
    mockClient({
      run_list: () => ({ runs: [waiting()] }),
      run_get: () => ({ state: waiting(), live: false }),
    });
    render(<RunView />);
    await screen.findByRole('list', { name: 'Saved runs' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Decide: run-7' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit the plan' }));
    expect(useStore.getState().ui.view).toBe('plan');
    expect(useStore.getState().ui.toasts.at(-1)?.text).toContain('plan/beats/02.json');
  });
});
