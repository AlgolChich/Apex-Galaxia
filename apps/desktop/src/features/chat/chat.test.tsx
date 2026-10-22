import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApexClient, MockTransport, setClient, type MockTool } from '../../api/index.js';
import type { ChatResult, ModelStatus, NarratorOptions, ProjectConfig } from '../../api/types.js';
import { useStore } from '../../state/store.js';
import { resetNarratorOptions } from '../wizard/narrator-options.js';
import { NarratorPanel, parseSettingArgument, storageKey, toHistory, useChat } from './index.js';

const config: ProjectConfig = {
  format_version: 1,
  title: 'Штрек',
  language: 'ru',
  narrator: 'gwen',
  storyteller: 'cassandra',
  harshness: 3,
  rating: 'medium',
  length: 'medium',
  pov: 'third',
  tense: 'past',
  cliffhangers: 'chapters',
  ending: 'narrator',
  yo_policy: 'yo',
  spelling: 'us',
  original_characters: 'narrator',
  preset: 'balanced',
  models: { plan: 'm', prose: 'm', critic: 'm', extract: 'm', summary: 'm', lint: 'm' },
  budget: { context_tokens: 100000, project_usd: null, warn_at_usd: null },
  window: { previous_tail_words: 500, current_chapter_words: 2000 },
};

const model: ModelStatus = {
  provider: 'anthropic',
  key_source: 'env',
  scripted: false,
  has_model: true,
  exact_token_counts: true,
  models: config.models,
  project: '/story',
};

const narratorOptions: NarratorOptions = {
  name: 'gwen',
  display_name: { en: 'Gwen', ru: 'Гвин' },
  defaults: {
    storyteller: 'cassandra',
    harshness: 3,
    rating: 'medium',
    length: 'medium',
    pov: 'third',
    tense: 'past',
    cliffhangers: 'chapters',
    original_characters: 'narrator',
    ending: 'narrator',
  },
  storytellers: [],
  harshness: [
    {
      level: 3,
      name: { en: 'Adventure story', ru: 'Приключенческая история' },
      allowed: { en: '', ru: '' },
      default: true,
    },
    {
      level: 5,
      name: { en: 'Blood and dust', ru: 'Кровь и пыль' },
      allowed: { en: '', ru: '' },
      default: false,
    },
  ],
  ratings: [],
  lengths: [],
  chapter_words: { min: 1000, max: 2500 },
  brief_template: '# Brief\n\nUniverse: …',
};

/** A chat tool that streams `pieces` as progress notifications and then answers with `result`. */
function chatTool(answer: (message: string) => { pieces: string[]; result: ChatResult }): MockTool {
  return (args, emit, request) => {
    const { pieces, result } = answer(String(args['message']));
    const token = (request.params as { _meta?: { progressToken?: number | string } })._meta
      ?.progressToken;
    for (const piece of pieces)
      emit({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: token, progress: 1, message: piece },
      });
    return result;
  };
}

const plain = (reply: string): { pieces: string[]; result: ChatResult } => ({
  pieces: reply.split(/(?<= )/),
  result: { reply, action: null, command: null, model: 'test-model', costUsd: 0.002 },
});

describe('NarratorPanel', () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let chat: MockTool;

  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    resetNarratorOptions();
    chat = chatTool(() => plain('Listening, Author.'));
    setClient(
      new ApexClient(
        new MockTransport({
          narrator_chat: (args, emit, request) => {
            calls.push({ name: 'narrator_chat', args });
            return chat(args, emit, request);
          },
          narrator_options: () => narratorOptions,
          project_settings_update: (args) => {
            calls.push({ name: 'project_settings_update', args });
            return { config: { ...config, ...(args['settings'] as Partial<ProjectConfig>) } };
          },
          chronicle_get: (args) => {
            calls.push({ name: 'chronicle_get', args });
            return {
              state: {},
              log: '',
              handover: 'HANDOVER for a new chat',
              hidden: 'The chart pays off underground.',
            };
          },
          canvas_directions: (args) => {
            calls.push({ name: 'canvas_directions', args });
            return {
              options: [
                {
                  title: 'The gate',
                  text: 'He goes to the gate.',
                  obvious: true,
                  recommended: false,
                },
                {
                  title: 'The channel',
                  text: 'He takes them up.',
                  obvious: false,
                  recommended: true,
                },
              ],
            };
          },
        }),
      ),
    );
    useStore.setState({
      connection: { status: 'ready', model },
      project: {
        root: '/story',
        config,
        chapters: [{ number: 1, title: 'One', status: 'draft' }],
        spentUsd: 0,
      },
      ui: {
        ...useStore.getState().ui,
        language: 'en',
        panel: 'narrator',
        view: 'chronicle',
        wizard: 'none',
        toasts: [],
      },
    });
    useChat.setState({ root: undefined, turns: [], busy: false, acting: undefined, draft: '' });
  });
  afterEach(cleanup);

  it('sends a message, streams the reply and shows model and cost', async () => {
    render(<NarratorPanel />);
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' });
    fireEvent.change(box, { target: { value: 'what do you think?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('what do you think?')).toBeTruthy();
    await screen.findByText('Listening, Author.');
    expect(screen.getByText('test-model · $0.0020')).toBeTruthy();
    expect(calls[0]?.args).toMatchObject({
      message: 'what do you think?',
      history: [],
      ui_language: 'en',
    });
    expect((box as HTMLTextAreaElement).value).toBe('');
    // The next message carries the conversation so far.
    fireEvent.change(box, { target: { value: 'and now?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.filter((c) => c.name === 'narrator_chat')).toHaveLength(2));
    expect(calls[1]?.args['history']).toEqual([
      { role: 'user', content: 'what do you think?' },
      { role: 'assistant', content: 'Listening, Author.' },
    ]);
  });

  it('labels the scripted stand-in and shows a canned reply without a model', async () => {
    useStore.setState((s) => ({
      connection: { ...s.connection, model: { ...model, scripted: true, key_source: 'scripted' } },
    }));
    render(<NarratorPanel />);
    expect(screen.getByText(/scripted stand-in/)).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' });
    fireEvent.change(box, { target: { value: 'hi' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('Listening, Author.');
    expect(screen.getByText('scripted · $0.0020')).toBeTruthy();
  });

  it('a command reply carries an action card; Do it writes the next chapter through the store', async () => {
    chat = chatTool(() => ({
      pieces: ['Off to the next chapter, Author.', '\n>> action: next'],
      result: {
        reply: 'Off to the next chapter, Author.',
        action: { id: 'next', argument: '' },
        command: { id: 'next', argument: '' },
        model: 'test-model',
        costUsd: 0.001,
      },
    }));
    const write = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ write });
    render(<NarratorPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(calls[0]?.args['message']).toBe('next'));
    const card = await screen.findByRole('group', {
      name: /Gwen is about to write the next chapter from the plan/,
    });
    expect(card).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith('chapter'));
    expect(useStore.getState().ui.view).toBe('editor');
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.getByText(/Writing the next chapter/)).toBeTruthy();
  });

  it('Not now sets the card aside without running anything', async () => {
    chat = chatTool(() => ({
      pieces: [],
      result: {
        reply: 'Understood: plan.',
        action: { id: 'plan', argument: '' },
        command: { id: 'plan', argument: '' },
        model: null,
        costUsd: 0,
      },
    }));
    render(<NarratorPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'plan' }));
    await screen.findByRole('button', { name: 'Not now' });
    expect(screen.getByText('no model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByText('Set aside')).toBeTruthy();
    expect(useStore.getState().ui.view).toBe('chronicle');
  });

  it('harshness: the card shows the parsed level and Do it updates the project settings', async () => {
    chat = chatTool(() => ({
      pieces: [],
      result: {
        reply: 'Understood: harshness 5. No model here, so no commentary.',
        action: { id: 'harshness', argument: '5' },
        command: { id: 'harshness', argument: '5' },
        model: null,
        costUsd: 0,
      },
    }));
    render(<NarratorPanel />);
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' });
    fireEvent.change(box, { target: { value: '/harshness 5' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    const card = await screen.findByRole('group', {
      name: /change "fate harshness" to "5 \(Blood and dust\)"/,
    });
    expect(card).toBeTruthy();
    expect(calls.find((c) => c.name === 'project_settings_update')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === 'project_settings_update')?.args).toEqual({
        settings: { harshness: 5 },
      }),
    );
    expect(useStore.getState().project.config?.harshness).toBe(5);
    expect(await screen.findByText(/fate harshness is now "5 \(Blood and dust\)"/)).toBeTruthy();
  });

  it('a setting command without a value asks for one instead of a card', async () => {
    chat = chatTool(() => ({
      pieces: [],
      result: {
        reply: 'Which one?',
        action: { id: 'rating', argument: 'loud' },
        command: { id: 'rating', argument: 'loud' },
        model: 'test-model',
        costUsd: 0,
      },
    }));
    render(<NarratorPanel />);
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' });
    fireEvent.change(box, { target: { value: '/rating loud' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/For "rating" I know: soft, medium, high, heavy/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Do it' })).toBeNull();
  });

  it('chronicle: the handover arrives in the chat with the hidden block collapsed', async () => {
    chat = chatTool(() => ({
      pieces: [],
      result: {
        reply: 'Gathering the chronicle.',
        action: { id: 'chronicle', argument: '' },
        command: { id: 'chronicle', argument: '' },
        model: 'test-model',
        costUsd: 0,
      },
    }));
    render(<NarratorPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'chronicle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Do it' }));
    expect(await screen.findByText('HANDOVER for a new chat')).toBeTruthy();
    expect(calls.find((c) => c.name === 'chronicle_get')?.args).toEqual({ full: true });
    expect(screen.queryByText('The chart pays off underground.')).toBeNull();
    const toggle = screen.getByRole('button', { name: /Show the hidden block/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText('The chart pays off underground.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the handover' })).toBeTruthy();
  });

  it('directions: the options come as cards with their marks', async () => {
    chat = chatTool(() => ({
      pieces: [],
      result: {
        reply: 'Three roads.',
        action: { id: 'directions', argument: '' },
        command: { id: 'directions', argument: '' },
        model: 'test-model',
        costUsd: 0,
      },
    }));
    render(<NarratorPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'directions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Do it' }));
    expect(await screen.findByText('The channel')).toBeTruthy();
    expect(calls.find((c) => c.name === 'canvas_directions')?.args).toEqual({ count: 3 });
    expect(screen.getByText('obvious')).toBeTruthy();
    expect(screen.getByText('recommended')).toBeTruthy();
  });

  it("informational commands answer with a line in Gwen's voice and no card", async () => {
    chat = chatTool(() => ({
      pieces: [],
      result: {
        reply: 'Understood: aside.',
        action: { id: 'aside', argument: '' },
        command: { id: 'aside', argument: '' },
        model: null,
        costUsd: 0,
      },
    }));
    render(<NarratorPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'aside' }));
    expect(await screen.findByText(/The story is paused, Author/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Do it' })).toBeNull();
  });

  it('relays an error as a muted line and a toast', async () => {
    chat = () => {
      throw new Error('[NO_MODEL] no key');
    };
    render(<NarratorPanel />);
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' });
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/The core said: \[NO_MODEL\] no key/)).toBeTruthy();
    expect(useStore.getState().ui.toasts.map((t) => t.text)).toContain('[NO_MODEL] no key');
  });

  it('persists the history per project and restores it', async () => {
    render(<NarratorPanel />);
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' });
    fireEvent.change(box, { target: { value: 'remember this' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('Listening, Author.');
    const saved = JSON.parse(localStorage.getItem(storageKey('/story')) ?? '{}') as {
      turns: Array<{ role: string; text: string }>;
    };
    expect(saved.turns.map((t) => [t.role, t.text])).toEqual([
      ['user', 'remember this'],
      ['assistant', 'Listening, Author.'],
    ]);
    cleanup();
    useChat.setState({ root: undefined, turns: [] });
    render(<NarratorPanel />);
    expect(screen.getByText('remember this')).toBeTruthy();
    expect(screen.getByText('Listening, Author.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    expect(screen.queryByText('remember this')).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey('/story')) ?? '{}')).toEqual({ turns: [] });
  });

  it('Escape clears the composer and Shift+click on a chip fills it', async () => {
    render(<NarratorPanel />);
    const box = screen.getByRole('textbox', { name: 'Message to Gwen' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'draft' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'plan' }), { shiftKey: true });
    expect(box.value).toBe('plan ');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
  });

  it('without a project explains that Gwen needs a story and offers to start one', () => {
    useStore.setState({ project: { chapters: [], spentUsd: 0 } });
    render(<NarratorPanel />);
    expect(screen.getByText('Gwen needs a story')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Message to Gwen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New story' }));
    expect(useStore.getState().ui.wizard).toBe('new-story');
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });
});

describe('chat helpers', () => {
  it('parses setting arguments in both languages and as numbers', () => {
    expect(parseSettingArgument('rating', 'мягкий')?.value).toBe('soft');
    expect(parseSettingArgument('rating', 'Heavy')?.value).toBe('heavy');
    expect(parseSettingArgument('rating', 'loud')).toBeUndefined();
    expect(parseSettingArgument('length', 'малая')?.value).toBe('short');
    expect(parseSettingArgument('length', 'крайне длинная')?.value).toBe('very_long');
    expect(parseSettingArgument('length', 'very long')?.value).toBe('very_long');
    expect(parseSettingArgument('length', 'long')?.value).toBe('long');
    expect(parseSettingArgument('storyteller', 'Кассандра')?.value).toBe('cassandra');
    expect(parseSettingArgument('storyteller', 'randy')?.value).toBe('randy');
    expect(parseSettingArgument('harshness', '5')?.value).toBe(5);
    expect(parseSettingArgument('harshness', '7')).toBeUndefined();
    expect(parseSettingArgument('harshness', 'Кровь и пыль')?.value).toBe(5);
    expect(parseSettingArgument('harshness', 'losing is fun', narratorOptions)?.value).toBe(6);
    expect(parseSettingArgument('harshness', 'Adventure story', narratorOptions)?.value).toBe(3);
    expect(parseSettingArgument('cliff', 'нет')?.value).toBe('none');
    expect(parseSettingArgument('cliff', 'в главах')?.value).toBe('chapters');
    expect(parseSettingArgument('cliff', 'chapters and finale')?.value).toBe('chapters_and_finale');
    expect(parseSettingArgument('cliff', '')).toBeUndefined();
  });

  it('builds the server history from the last twelve clean turns', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      text: `t${i}`,
      at: i,
    }));
    const history = toHistory([
      ...turns,
      { id: 'm', role: 'assistant', text: 'The core said: x', at: 99, muted: true },
      { id: 's', role: 'assistant', text: 'half', at: 100, streaming: true },
    ]);
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: 'user', content: 't8' });
    expect(history[11]).toEqual({ role: 'assistant', content: 't19' });
  });
});
