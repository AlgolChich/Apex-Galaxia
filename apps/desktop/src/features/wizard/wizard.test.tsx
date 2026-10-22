import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state/store.js';
import { ImportDialog } from '../import/index.js';
import { useImportStore } from '../import/store.js';
import { buildCreateOptions, emptyStoryForm, homeOfConfigFile, slugOfTitle } from './build.js';
import { Wizard } from './index.js';
import { callsOf, mockClient, resetStore, sampleConfig } from './test-utils.js';

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

async function next(times = 1) {
  for (let i = 0; i < times; i += 1) await click('Next');
}

describe('buildCreateOptions', () => {
  it('maps every filled brief field to the project_create keys and skips empty ones', () => {
    const form = { ...emptyStoryForm('ru'), title: ' Маяк ', path: '/tmp/mayak', universe: 'Original', canon_point: '', leads: 'Фёдор', supporting: '', original_characters: 'narrator' as const, idea: 'Катер не пришёл', genre_tone: 'тихий хоррор', storyteller: 'randy' as const, harshness: 5, rating: 'high' as const, length: 'long' as const, pov: 'first' as const, tense: 'present' as const, cliffhangers: 'none' as const, ending: 'tragic' as const, must_have_scenes: 'шторм', taboos: 'нет', yo_policy: 'ye' as const, spelling: 'uk' as const };
    expect(buildCreateOptions(form)).toEqual({ path: '/tmp/mayak', title: 'Маяк', language: 'ru', universe: 'Original', leads: 'Фёдор', original_characters: 'narrator', idea: 'Катер не пришёл', genre_tone: 'тихий хоррор', storyteller: 'randy', harshness: 5, rating: 'high', length: 'long', pov: 'first', tense: 'present', cliffhangers: 'none', ending: 'tragic', must_have_scenes: 'шторм', taboos: 'нет', yo_policy: 'ye' });
    expect(buildCreateOptions({ ...form, language: 'en' })).toMatchObject({ spelling: 'uk' });
    expect(buildCreateOptions({ ...form, language: 'en' })).not.toHaveProperty('yo_policy');
  });

  it('an empty form gives only title, language and path', () => {
    expect(buildCreateOptions({ ...emptyStoryForm('en'), title: 'Eleven', path: '/tmp/eleven' })).toEqual({ path: '/tmp/eleven', title: 'Eleven', language: 'en' });
  });

  it('suggests folder names from titles and finds the home folder', () => {
    expect(slugOfTitle('Старые друзья')).toBe('starye-druzya');
    expect(slugOfTitle('  !!! ')).toBe('story');
    expect(homeOfConfigFile('/home/me/.apex-galaxia/config.yaml')).toBe('/home/me');
    expect(homeOfConfigFile('C:\\Users\\me\\.apex-galaxia\\config.yaml')).toBe('C:/Users/me');
  });
});

describe('Wizard (new story)', () => {
  beforeEach(() => resetStore('en'));
  afterEach(cleanup);

  it('creates a project from only title, language and folder, then closes', async () => {
    const transport = mockClient({
      project_create: (args) => ({ root: args['path'], config: sampleConfig({ title: String(args['title']) }) }),
      project_open: (args) => ({ root: args['path'], config: sampleConfig(), chapters: [], spentUsd: 0 }),
    });
    useStore.setState((s) => ({ ui: { ...s.ui, wizard: 'new-story' } }));
    render(<Wizard mode="new-story" />);
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeTruthy();

    await next();
    expect(screen.getByText('Enter a title')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Eleven' } });
    fireEvent.change(screen.getByLabelText(/^Folder/), { target: { value: '/tmp/eleven' } });
    fireEvent.change(screen.getByLabelText('Story language'), { target: { value: 'en' } });
    await next(10);
    expect(screen.getByRole('heading', { name: 'Check the brief' })).toBeTruthy();
    expect(screen.getByText('/tmp/eleven')).toBeTruthy();

    await click('Create project');
    expect(callsOf(transport, 'project_create')).toEqual([{ path: '/tmp/eleven', title: 'Eleven', language: 'en' }]);
    expect(useStore.getState().ui.wizard).toBe('none');
    expect(useStore.getState().project.root).toBe('/tmp/eleven');
  });

  it('passes the chosen storyteller, harshness, rating, length and narration through', async () => {
    const transport = mockClient({
      project_create: (args) => ({ root: args['path'], config: sampleConfig() }),
      project_open: (args) => ({ root: args['path'], config: sampleConfig(), chapters: [], spentUsd: 0 }),
    });
    render(<Wizard mode="new-story" />);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Маяк' } });
    fireEvent.change(screen.getByLabelText(/^Folder/), { target: { value: '/tmp/mayak' } });
    fireEvent.change(screen.getByLabelText('Story language'), { target: { value: 'ru' } });
    await next();
    fireEvent.change(screen.getByLabelText('Universe'), { target: { value: 'Original' } });
    await next();
    fireEvent.click(screen.getByLabelText(/Up to the narrator/));
    await next(2);
    fireEvent.click(await screen.findByLabelText(/Randy Random/));
    await next();
    fireEvent.click(screen.getByLabelText(/Level 5/));
    await next();
    fireEvent.click(screen.getByLabelText(/^High/));
    await next();
    fireEvent.click(screen.getByLabelText(/^Long/));
    await next();
    fireEvent.change(screen.getByLabelText('Point of view'), { target: { value: 'first' } });
    fireEvent.change(screen.getByLabelText('Ending'), { target: { value: 'tragic' } });
    await next();
    fireEvent.change(screen.getByLabelText('The letter ё'), { target: { value: 'ye' } });
    await next();
    await click('Create project');
    expect(callsOf(transport, 'project_create')).toEqual([{ path: '/tmp/mayak', title: 'Маяк', language: 'ru', universe: 'Original', original_characters: 'narrator', storyteller: 'randy', harshness: 5, rating: 'high', length: 'long', pov: 'first', ending: 'tragic', yo_policy: 'ye' }]);
  });

  it('Back never validates and Cancel closes the wizard', async () => {
    mockClient({});
    useStore.setState((s) => ({ ui: { ...s.ui, wizard: 'new-story' } }));
    render(<Wizard mode="new-story" />);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^Folder/), { target: { value: '/tmp/x' } });
    await next();
    expect(screen.getByRole('heading', { name: 'World' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Universe'), { target: { value: 'u' } });
    await click('Back');
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: '' } });
    await next();
    expect(screen.getByText('Enter a title')).toBeTruthy();
    await click('Cancel');
    expect(useStore.getState().ui.wizard).toBe('none');
  });
});

describe('Wizard (first run)', () => {
  beforeEach(() => resetStore('en'));
  afterEach(cleanup);

  it('walks language, key, project and stays open for the voice step after an import', async () => {
    const transport = mockClient({
      project_open: (args) => ({ root: args['path'], config: sampleConfig({ title: 'Imported' }), chapters: [], spentUsd: 0 }),
    });
    useStore.setState((s) => ({ ui: { ...s.ui, wizard: 'first-run' } }));
    render(<Wizard mode="first-run" />);
    expect(screen.getByRole('heading', { name: 'Interface language' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Русский'));
    expect(useStore.getState().ui.language).toBe('ru');
    fireEvent.click(screen.getByLabelText('English'));
    await next();
    expect(callsOf(transport, 'user_config_set')).toEqual([{ settings: { ui_language: 'en' } }]);
    expect(screen.getByRole('heading', { name: 'Model key' })).toBeTruthy();
    expect(screen.getByText(/environment of the bridge/)).toBeTruthy();
    await click('Skip for now');
    expect(screen.getByRole('heading', { name: 'Project' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Open an existing folder/));
    await next();
    expect(screen.getByText('Choose the project folder')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Folder path/), { target: { value: '/tmp/imported' } });
    await next();
    expect(useStore.getState().project.root).toBe('/tmp/imported');
    expect(useStore.getState().ui.wizard).toBe('first-run');
    expect(screen.getByRole('heading', { name: 'Voice sample' })).toBeTruthy();
    expect(screen.getByText('Opened “Imported”')).toBeTruthy();
    await click('Done');
    expect(useStore.getState().ui.wizard).toBe('none');
  });

  it('imports a manuscript into a new project through the import dialog and continues to the voice step', async () => {
    const text = 'Chapter 1: The ferry\n\nThe ferry was late.\n';
    const transport = mockClient({
      project_import: (args) => (args['preview'] ? { root: args['path'], language: 'en', chapters: [{ number: 1, title: 'The ferry', words: 4 }] } : { root: args['path'], created: true, chapters: [{ number: 1, title: 'The ferry', stem: '01-the-ferry', words: 4 }] }),
      project_open: (args) => ({ root: args['path'], config: sampleConfig({ title: 'Ferry', language: 'en' }), chapters: [{ number: 1, title: 'The ferry', status: 'draft' }], spentUsd: 0 }),
      chapter_get: () => ({ front: { number: 1, title: 'The ferry', status: 'draft' }, stem: '01-the-ferry', path: '/tmp/ferry/chapters/01-the-ferry.md', body: 'The ferry was late.' }),
      lint: () => ({ hits: [], counts: { info: 0, warning: 0, error: 0 }, words: 4, paragraphs: 1 }),
    });
    useImportStore.setState({ request: undefined, busy: false });
    useStore.setState((s) => ({ ui: { ...s.ui, wizard: 'first-run' } }));
    render(
      <>
        <Wizard mode="first-run" />
        <ImportDialog />
      </>,
    );
    await next();
    await click('Skip for now');
    expect(screen.getByRole('heading', { name: 'Project' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Import an existing Markdown story/));
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    await click('Choose the manuscript…');

    // The dialog opens in manuscript mode with the new-project target; the wizard waits.
    const dialog = screen.getByRole('dialog', { name: 'Import a manuscript' });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Project' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Text/), { target: { value: text } });
    fireEvent.change(screen.getByLabelText(/^Folder/), { target: { value: '/tmp/ferry' } });
    await click('Preview');
    await screen.findByText('Chapters found: 1');
    await click('Import 1 chapter');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(callsOf(transport, 'project_import')[1]).toEqual({ path: '/tmp/ferry', text, status: 'draft' });
    expect(useStore.getState().project.root).toBe('/tmp/ferry');
    expect(useStore.getState().ui.wizard).toBe('first-run');
    expect(await screen.findByRole('heading', { name: 'Voice sample' })).toBeTruthy();
    expect(screen.getByText('Opened “Ferry”')).toBeTruthy();
    await click('Done');
    expect(useStore.getState().ui.wizard).toBe('none');
  });
});
