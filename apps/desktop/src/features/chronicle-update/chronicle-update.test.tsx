import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApexClient, MockTransport, setClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { useDialogs } from '../diff/store.js';
import { ChronicleUpdateDialog, openChronicleUpdate } from './index.js';

const proposal = { chapter: 2, summary: 'The strangers came at night.', hidden: 'The chart pays off underground.', in_story_time: 'Thursday, before dawn', ops: [{ op: 'set', path: 'locations.lead', value: 'at the gate' }] };

describe('ChronicleUpdateDialog', () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  beforeEach(() => {
    calls.length = 0;
    setClient(
      new ApexClient(
        new MockTransport({
          chronicle_propose: (args) => {
            calls.push({ name: 'chronicle_propose', args });
            return { proposal, described: ['set locations.lead = "at the gate"'] };
          },
          chronicle_apply: (args) => {
            calls.push({ name: 'chronicle_apply', args });
            return { applied: ['set locations.lead = "at the gate"'], last_chapter: 2 };
          },
          summarize_chapter: (args) => {
            calls.push({ name: 'summarize_chapter', args });
            return { file: 'chapters/summaries/02.md', summary: 'Recap.' };
          },
          project_chapters: () => ({ chapters: [] }),
          project_open: () => ({ root: '/story', config: {}, chapters: [], spentUsd: 0 }),
        }),
      ),
    );
    useStore.setState({ project: { root: '/story', chapters: [], spentUsd: 0 }, ui: { ...useStore.getState().ui, language: 'en' } });
    useDialogs.setState({ chronicleUpdate: undefined, chronicleVersion: 0 });
  });
  afterEach(cleanup);

  it('proposes, shows the proposal and applies it as the author, then offers the summary', async () => {
    openChronicleUpdate(2);
    render(<ChronicleUpdateDialog />);
    expect(screen.getByRole('dialog', { name: 'Update the chronicle: chapter 2' })).toBeTruthy();
    expect(await screen.findByText('The strangers came at night.')).toBeTruthy();
    expect(screen.getByText('The chart pays off underground.')).toBeTruthy();
    expect(screen.getByText('set locations.lead = "at the gate"')).toBeTruthy();
    expect(calls[0]).toEqual({ name: 'chronicle_propose', args: { chapter: 2 } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Summarize chapter 2 now?')).toBeTruthy();
    expect(calls[1]).toEqual({ name: 'chronicle_apply', args: { proposal, by: 'author' } });
    expect(useDialogs.getState().chronicleVersion).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    await waitFor(() => expect(useDialogs.getState().chronicleUpdate).toBeUndefined());
    expect(calls[2]).toEqual({ name: 'summarize_chapter', args: { chapter: 2 } });
  });

  it('cancels without applying', async () => {
    openChronicleUpdate(3);
    render(<ChronicleUpdateDialog />);
    await screen.findByText('The strangers came at night.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useDialogs.getState().chronicleUpdate).toBeUndefined();
    expect(calls.map((c) => c.name)).toEqual(['chronicle_propose']);
  });
});
