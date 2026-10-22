import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state/store.js';
import { callsOf, mockClient, openSampleProject, resetStore } from '../wizard/test-utils.js';
import { SettingsView } from './index.js';

const lintReport = '# Eval 2026-10-22 (baseline)\n\n- Fault set: 12 passages, linter coverage 0.83\n';
const plannerReport = '# Planner eval 2026-10-22\n\n- Distance between the beats of the lowest and the highest harshness: mayak 0.62\n';

describe('Settings: Evals', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
  });
  afterEach(cleanup);

  it('runs the linter and the planner evals without the critic and shows the report and the A/B summary', async () => {
    const transport = mockClient({
      user_config_get: () => ({ config: {}, file: '/home/me/.apex-galaxia/config.yaml' }),
      ab_list: () => ({ records: [], count: 7, judged: 4, critic_agreement: 0.75 }),
      eval_run: (args) => (args['planner'] ? { results: { ran_at: '2026-10-22T00:00:00Z', models: { plan: 'scripted' }, judged: false, cases: [], summary: { costUsd: 0 } }, report: plannerReport } : { results: { ran_at: '2026-10-22T00:00:00Z', variant: 'baseline', models: { lint: 'scripted' }, passages: [], summary: { costUsd: 0.0123 } }, report: lintReport }),
    });
    render(<SettingsView />);
    expect(await screen.findByText('Choices: 7, judged by the critic: 4, agreement: 75%')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run the linter eval' }));
    });
    const report = (await screen.findByLabelText('Report')) as HTMLPreElement;
    expect(report.textContent).toBe(lintReport);
    expect(screen.getByText(/Models: scripted · Cost: \$0\.0123/)).toBeTruthy();
    expect(callsOf(transport, 'eval_run')).toEqual([{ critic: false }]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run the planner eval (deterministic distance only)' }));
    });
    expect((await screen.findByLabelText('Report')).textContent).toBe(plannerReport);
    expect(callsOf(transport, 'eval_run')[1]).toEqual({ planner: true, critic: false });

    // With a model the judge checkbox is live; it changes the planner label and the call.
    const judge = screen.getByLabelText(/Judge with the critic model/) as HTMLInputElement;
    expect(judge.disabled).toBe(false);
    fireEvent.click(judge);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run the planner eval (judged by the critic)' }));
    });
    expect(callsOf(transport, 'eval_run')[2]).toEqual({ planner: true, critic: true });
  });

  it('keeps the judge checkbox off without a model and shows an eval error inline', async () => {
    mockClient({
      ab_list: () => ({ records: [], count: 0, judged: 0, critic_agreement: null }),
      eval_run: () => {
        throw new Error('[NO_RESOURCES] evals/fault-set not found');
      },
    });
    useStore.setState((s) => ({ connection: { ...s.connection, model: { provider: 'none', key_source: 'none', scripted: false, has_model: false, exact_token_counts: false, models: null, project: null } } }));
    render(<SettingsView />);
    expect(await screen.findByText(/No pairwise choices yet/)).toBeTruthy();
    const judge = screen.getByLabelText(/Judge with the critic model/) as HTMLInputElement;
    expect(judge.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run the linter eval' }));
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('NO_RESOURCES');
    expect(useStore.getState().ui.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });
});
