import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state/store.js';
import { callsOf, mockClient, openSampleProject, resetStore, sampleConfig } from '../wizard/test-utils.js';
import { SettingsView } from './index.js';
import { draftOf, patchOf } from './patch.js';

describe('settings patch', () => {
  it('contains only the fields that changed, nested objects whole', () => {
    const config = sampleConfig();
    const draft = draftOf(config);
    expect(patchOf(draft, config)).toEqual({});
    draft.title = 'Новый  ';
    draft.budget.project_usd = '12.5';
    draft.models.prose = 'model-z';
    draft.window.previous_tail_words = 'not a number';
    expect(patchOf(draft, config)).toEqual({ title: 'Новый', budget: { context_tokens: 60000, project_usd: 12.5, warn_at_usd: null }, models: { plan: 'model-a', prose: 'model-z', critic: 'model-a', extract: 'model-c', summary: 'model-c', lint: 'model-c' } });
  });
});

describe('SettingsView', () => {
  beforeEach(() => {
    resetStore('en');
    openSampleProject();
  });
  afterEach(cleanup);

  it('sends only the changed fields and the user language and models separately', async () => {
    const transport = mockClient({
      project_settings_update: (args) => ({ config: { ...useStore.getState().project.config, ...(args['settings'] as Record<string, unknown>) } }),
      user_config_get: () => ({ config: { models: { prose: 'user-prose' } }, file: '/home/me/.apex-galaxia/config.yaml' }),
    });
    render(<SettingsView />);
    const save = (await screen.findByRole('form', { name: 'Project' })).querySelector('button[type=submit]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText('No changes')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Маяк-2' } });
    fireEvent.change(await screen.findByLabelText(/Fate harshness/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Quality preset/), { target: { value: 'best' } });
    expect(screen.getByText('Changed: title, harshness, preset')).toBeTruthy();
    expect(screen.getByText(/Allowed 5/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(save);
    });
    expect(callsOf(transport, 'project_settings_update')).toEqual([{ settings: { title: 'Маяк-2', harshness: 5, preset: 'best' } }]);
    expect(useStore.getState().project.config?.harshness).toBe(5);
    expect(screen.getByText('No changes')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Interface language/), { target: { value: 'ru' } });
    expect(useStore.getState().ui.language).toBe('ru');
    await act(async () => undefined);
    expect(callsOf(transport, 'user_config_set')).toEqual([{ settings: { ui_language: 'ru' } }]);

    const prose = screen.getByLabelText('prose', { selector: '#settings-user-model-prose' }) as HTMLInputElement;
    expect(prose.value).toBe('user-prose');
    fireEvent.change(prose, { target: { value: 'user-prose-2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('form', { name: /Модели по умолчанию/ }).querySelector('button[type=submit]') as HTMLButtonElement);
    });
    expect(callsOf(transport, 'user_config_set')[1]).toEqual({ settings: { models: { prose: 'user-prose-2' } } });
  });
});
