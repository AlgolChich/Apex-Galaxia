import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonRpcMessage } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { callsOf, mockClient, openSampleProject, resetStore } from '../wizard/test-utils.js';
import { parseChronicleLog } from './chronicle-parse.js';
import { BibleView, ChronicleView, PlanView, RunView } from './index.js';
import { TEXT_CAP, useRunStore } from './run-store.js';

const flush = () => act(async () => undefined);

describe('BibleView', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
  });
  afterEach(cleanup);

  const entries = [
    { kind: 'character', slug: 'fyodor', name: 'Фёдор', aliases: { ru: ['Федя'], en: ['Fyodor'] }, summary: 'The keeper.', always_on: true, canon: false },
    { kind: 'character', slug: 'gost', name: 'Гость', aliases: { ru: [], en: ['the guest'] }, summary: 'A stranger.', always_on: false, canon: true },
    { kind: 'location', slug: 'mayak', name: 'Маяк', aliases: { ru: [], en: [] }, summary: 'The lighthouse.', always_on: false, canon: false },
  ];

  it('lists entries, filters by kind and search, and saves an edited entry', async () => {
    const transport = mockClient({
      bible_list: () => ({ entries }),
      bible_get: (args) => ({ kind: args['kind'], slug: args['slug'], front: { name: 'Фёдор', aliases: { ru: ['Федя'], en: ['Fyodor'] }, always_on: true, kind: 'original' }, body: '# Фёдор\n\n## Summary\n\nThe keeper.\n', summary: 'The keeper.' }),
      bible_upsert: (args) => ({ kind: args['kind'], slug: args['slug'], path: '/tmp/story/bible/characters/fyodor.md' }),
    });
    render(<BibleView />);
    const list = await screen.findByRole('list', { name: 'Entries' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByText('always on')).toHaveLength(1);
    expect(within(list).getAllByText('canon')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'location' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search names, aliases and summaries'), { target: { value: 'fyo' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search names, aliases and summaries'), { target: { value: '' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Фёдор/ }));
    });
    const body = (await screen.findByLabelText('Entry body (Markdown)')) as HTMLTextAreaElement;
    expect(body.value).toContain('## Summary');
    fireEvent.change(screen.getByLabelText('Aliases (EN)'), { target: { value: 'Fyodor, the keeper' } });
    fireEvent.change(body, { target: { value: body.value + '\n## True now\n\nAlone.\n' } });
    fireEvent.click(screen.getByLabelText(/Canon \(fandom\)/));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(callsOf(transport, 'bible_upsert')).toEqual([{ kind: 'character', slug: 'fyodor', name: 'Фёдор', aliases_ru: ['Федя'], aliases_en: ['Fyodor', 'the keeper'], always_on: true, canon: true, body: '# Фёдор\n\n## Summary\n\nThe keeper.\n\n## True now\n\nAlone.\n' }]);
  });

  it('adds an extracted proposal only on Add', async () => {
    const transport = mockClient({
      bible_list: () => ({ entries }),
      bible_extract: () => ({ proposals: [{ kind: 'character', slug: 'zubov', action: 'create', name: 'Зубов', summary: 'The eldest.', diff: '## Summary\n\nThe eldest of the three.' }, { kind: 'glossary', slug: 'shtrek', action: 'update', diff: 'Штрек: a drift.' }] }),
      bible_upsert: (args) => ({ kind: args['kind'], slug: args['slug'], path: '/x' }),
    });
    render(<BibleView />);
    await screen.findByRole('list', { name: 'Entries' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
    });
    await screen.findByText('Proposals from chapter 1');
    expect(callsOf(transport, 'bible_upsert')).toHaveLength(0);
    const buttons = screen.getAllByRole('button', { name: 'Add' });
    expect(buttons).toHaveLength(2);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(buttons[0] as HTMLButtonElement);
    });
    expect(callsOf(transport, 'bible_upsert')).toEqual([{ kind: 'character', slug: 'zubov', name: 'Зубов', body: '# Зубов\n\n## Summary\n\nThe eldest of the three.\n' }]);
  });
});

describe('ChronicleView', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
  });
  afterEach(cleanup);

  it('parses Russian and English chapter headings', () => {
    const ru = parseChronicleLog('# Летопись\n\n_Записи._\n\n## Глава 1\n\nКатер не пришёл.\n\n## Глава 2\n\nРадио молчит.\nВторая строка.\n');
    expect(ru.intro).toBe('# Летопись\n\n_Записи._');
    expect(ru.sections.map((s) => [s.chapter, s.heading, s.text])).toEqual([
      [1, 'Глава 1', 'Катер не пришёл.'],
      [2, 'Глава 2', 'Радио молчит.\nВторая строка.'],
    ]);
    const en = parseChronicleLog('## Chapter 3\n\nThe gate was open.\n');
    expect(en.sections).toEqual([{ chapter: 3, heading: 'Chapter 3', text: 'The gate was open.' }]);
    expect(parseChronicleLog('').sections).toEqual([]);
  });

  it('shows the timeline newest first, the in-story time on top, the state folded and the handover apart', async () => {
    mockClient({
      chronicle_get: (args) => ({
        state: { in_story_time: '4 октября, утро', last_chapter: 2, locations: { fyodor: 'маяк' }, condition: {}, inventory: {}, knowledge: [], relations: [], open_threads: [{ id: 'boat', text: 'Why no boat?', status: 'open', since_chapter: 1 }], planted_guns: [{ id: 'glove', what: 'one glove', planted_in: 1 }], pending_consequences: [], rolls: [] },
        log: '# Летопись\n\n## Глава 1\n\nПервая.\n\n## Глава 2\n\nВторая.\n',
        ...(args['full'] ? { handover: '# Handover\n\nreader part', hidden: '# Hidden\n\nhidden part' } : {}),
      }),
    });
    render(<ChronicleView />);
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    // The list renders before chronicle_get resolves, so wait for its items rather than the list.
    const items = await within(timeline).findAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Глава 2Вторая.', 'Глава 1Первая.']);
    expect(screen.getByText('4 октября, утро')).toBeTruthy();
    expect(screen.getAllByText('planner only, hidden from readers')).toHaveLength(2);
    const guns = document.getElementById('chronicle-planted_guns') as HTMLDetailsElement;
    expect(guns.open).toBe(false);
    expect(within(guns).getByText(/one glove/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Handover' }));
    });
    expect(await screen.findByText(/reader part/)).toBeTruthy();
    expect(screen.getByText(/hidden part/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Copy/ })).toHaveLength(2);
  });
});

describe('PlanView', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
  });
  afterEach(cleanup);

  it('reorders chapters and saves them renumbered in order', async () => {
    const transport = mockClient({
      plan_get: () => ({ outline: '- Chapter 1\n', chapters: { chapters: [{ number: 1, title: 'Shift', status: 'draft', beats: [], target_words: 1200 }, { number: 2, title: 'Radio', status: 'planned', beats: ['a', 'b'], turning_point: 'tp' }, { number: 3, title: 'Bay', status: 'planned', beats: [] }] }, beats: [2] }),
      plan_save: (args) => ({ outline: args['outline'] !== undefined, chapters: args['chapters'] ?? null }),
    });
    render(<PlanView />);
    const list = await screen.findByRole('list', { name: 'Chapters' });
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Chapter 1: Shift', 'Chapter 2: Radio', 'Chapter 3: Bay']);
    expect(screen.getByText('beat sheet exists')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Move down: Chapter 1' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Chapter 1: Radio', 'Chapter 2: Shift', 'Chapter 3: Bay']);
    expect(screen.getByText('(was 2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove: Chapter 3' }));
    fireEvent.change(screen.getByLabelText('Beats, one per line', { selector: '#plan-beats-' + (within(list).getAllByRole('listitem')[1] as HTMLElement).querySelector('textarea')!.id.split('-').pop() }), { target: { value: 'first\n\nsecond' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save chapters' }));
    });
    expect(callsOf(transport, 'plan_save')).toEqual([{ chapters: { chapters: [{ number: 1, title: 'Radio', status: 'planned', beats: ['a', 'b'], turning_point: 'tp' }, { number: 2, title: 'Shift', status: 'draft', beats: ['first', 'second'], target_words: 1200 }] } }]);
    expect(screen.queryByText('(was 2)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Outline', { selector: 'textarea' }), { target: { value: '- One\n- Two' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save outline' }));
    });
    expect(callsOf(transport, 'plan_save')[1]).toEqual({ outline: '- One\n- Two' });
  });
});

describe('RunView', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
    useRunStore.getState().clear();
  });
  afterEach(cleanup);

  it('starts a run, appends deltas from events and refreshes on the final event', async () => {
    let emit: ((n: JsonRpcMessage) => void) | undefined;
    const runState = { id: 'run-1', started_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z', status: 'running', target_chapters: 2, next_chapter: 2, stage: 'plan', completed: [], cost_usd: 0, outline_approved: true, log: ['run started'] };
    const transport = mockClient({
      run_list: () => ({ runs: [runState] }),
      run_start: (_args, e) => {
        emit = e;
        return { id: 'run-1', state: runState };
      },
      run_pause: (args) => ({ id: args['id'], status: 'pausing' }),
      project_chapters: () => ({ chapters: [{ number: 1, title: 'One', status: 'draft' }, { number: 2, title: 'Two', status: 'draft' }] }),
      project_open: () => ({ root: '/tmp/story', config: useStore.getState().project.config, chapters: [], spentUsd: 0.5 }),
    });
    render(<RunView />);
    await screen.findByRole('list', { name: 'Saved runs' });
    expect(callsOf(transport, 'run_list')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Chapters'), { target: { value: '2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
    expect(callsOf(transport, 'run_start')).toEqual([{ chapters: 2, reader_report: false }]);
    const liveSection = screen.getByRole('region', { name: /Current run/ });
    expect(within(liveSection).getByText('Chapter 2')).toBeTruthy();
    expect(within(liveSection).getByText('0 of 2 done')).toBeTruthy();

    const event = (data: Record<string, unknown>) => emit!({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'apex.run', data: { run_id: 'run-1', ...data } } });
    event({ status: 'running', stage: 'write', message: 'chapter 2: planned', cost_usd: 0.12 });
    event({ delta: 'Скаут ' });
    event({ delta: 'бежал.' });
    await flush();
    expect(screen.getByTestId('run-text').textContent).toBe('Скаут бежал.');
    expect(screen.getByText('chapter 2: planned')).toBeTruthy();
    expect(screen.getByText('Cost: $0.120')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    expect(callsOf(transport, 'run_pause')).toEqual([{ id: 'run-1' }]);

    event({ status: 'completed', stage: 'done', completed: 2, target: 2, cost_usd: 0.4, final: true });
    await flush();
    expect(screen.getByText('Run finished: completed')).toBeTruthy();
    expect(within(liveSection).getByText('2 of 2 done')).toBeTruthy();
    await waitFor(() => expect(callsOf(transport, 'run_list')).toHaveLength(3));
    expect(callsOf(transport, 'project_chapters')).toHaveLength(1);
    expect(useStore.getState().project.chapters).toHaveLength(2);
  });

  it('keeps only the tail of the streamed text', () => {
    const store = useRunStore.getState();
    store.applyEvent({ run_id: 'r', delta: 'a'.repeat(TEXT_CAP) });
    store.applyEvent({ run_id: 'r', delta: 'bc' });
    const text = useRunStore.getState().live?.text ?? '';
    expect(text).toHaveLength(TEXT_CAP);
    expect(text.endsWith('bc')).toBe(true);
  });
});
