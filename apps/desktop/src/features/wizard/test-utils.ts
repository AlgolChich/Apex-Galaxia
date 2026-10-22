import { ApexClient, MockTransport, setClient, type MockTool } from '../../api/index.js';
import type { NarratorOptions, ProjectConfig } from '../../api/types.js';
import { useStore } from '../../state/store.js';
import { resetNarratorOptions } from './narrator-options.js';

/** Install a mock client; returns the transport so tests can inspect `sent` and emit notifications. */
export function mockClient(tools: Record<string, MockTool>): MockTransport {
  const transport = new MockTransport({
    model_status: () => ({ provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: null }),
    narrator_options: () => sampleNarratorOptions(),
    user_config_get: () => ({ config: {}, file: '/home/me/.apex-galaxia/config.yaml' }),
    user_config_set: (args) => ({ config: args['settings'], file: '/home/me/.apex-galaxia/config.yaml' }),
    ...tools,
  });
  setClient(new ApexClient(transport));
  resetNarratorOptions();
  return transport;
}

/** Arguments of every `tools/call` with this tool name, in order. */
export function callsOf(transport: MockTransport, tool: string): Array<Record<string, unknown>> {
  return transport.sent.flatMap((m) => {
    if (!('method' in m) || m.method !== 'tools/call') return [];
    const params = m.params as { name: string; arguments?: Record<string, unknown> };
    return params.name === tool ? [params.arguments ?? {}] : [];
  });
}

export function resetStore(language: 'ru' | 'en' = 'en'): void {
  useStore.setState((s) => ({
    connection: { status: 'ready', model: { provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: null } },
    project: { chapters: [], spentUsd: 0 },
    ui: { ...s.ui, language, view: 'editor', wizard: 'none', toasts: [] },
  }));
}

export function openSampleProject(config: ProjectConfig = sampleConfig()): void {
  useStore.setState((s) => ({ project: { ...s.project, root: '/tmp/story', config, chapters: [{ number: 1, title: 'One', status: 'draft', words: 900 }], spentUsd: 0 } }));
}

export function sampleConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    format_version: 1,
    title: 'Маяк',
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
    original_characters: 'no',
    preset: 'balanced',
    models: { plan: 'model-a', prose: 'model-b', critic: 'model-a', extract: 'model-c', summary: 'model-c', lint: 'model-c' },
    budget: { context_tokens: 60000, project_usd: null, warn_at_usd: null },
    window: { previous_tail_words: 1500, current_chapter_words: 12000 },
    ...overrides,
  };
}

export function sampleNarratorOptions(): NarratorOptions {
  return {
    name: 'gwen',
    display_name: { en: 'Gwen', ru: 'Гвен' },
    defaults: { storyteller: 'cassandra', harshness: 3, rating: 'medium', length: 'medium', pov: 'third', tense: 'past', cliffhangers: 'chapters', original_characters: 'no', ending: 'narrator' },
    storytellers: [
      { id: 'cassandra', name: { en: 'Cassandra Classic', ru: 'Кассандра Классическая' }, rhythm: { en: 'Classic curve', ru: 'Классическая кривая' }, expect: { en: 'Waves', ru: 'Волны' }, default: true },
      { id: 'phoebe', name: { en: 'Phoebe Chillax', ru: 'Фиби Безмятежная' }, rhythm: { en: 'Long calm', ru: 'Долгое спокойствие' }, expect: { en: 'Daily life', ru: 'Быт' }, default: false },
      { id: 'randy', name: { en: 'Randy Random', ru: 'Рэнди Случайный' }, rhythm: { en: 'No rules', ru: 'Без правил' }, expect: { en: 'Anything', ru: 'Что угодно' }, default: false },
    ],
    harshness: [1, 2, 3, 4, 5, 6].map((level) => ({ level, name: { en: `Level ${level}`, ru: `Уровень ${level}` }, allowed: { en: `Allowed ${level}`, ru: `Можно ${level}` }, default: level === 3 })),
    ratings: [
      { id: 'soft', name: { en: 'Soft', ru: 'Мягкий' }, allowed: { en: 'No harm', ru: 'Без вреда' }, default: false },
      { id: 'medium', name: { en: 'Medium', ru: 'Средний' }, allowed: { en: 'Some', ru: 'Немного' }, default: true },
      { id: 'high', name: { en: 'High', ru: 'Высокий' }, allowed: { en: 'Blood', ru: 'Кровь' }, default: false },
      { id: 'heavy', name: { en: 'Heavy', ru: 'Тяжёлый' }, allowed: { en: 'All', ru: 'Всё' }, default: false },
    ],
    lengths: [
      { id: 'short', name: { en: 'Short', ru: 'Малая' }, pages: [1, 3], words: [300, 900], chapters: [1, 1], plan_approval: false, default: false },
      { id: 'medium', name: { en: 'Medium', ru: 'Средняя' }, pages: [4, 8], words: [1000, 2400], chapters: [1, 2], plan_approval: false, default: true },
      { id: 'long', name: { en: 'Long', ru: 'Длинная' }, pages: [9, 15], words: [2300, 4500], chapters: [2, 4], plan_approval: true, default: false },
      { id: 'very_long', name: { en: 'Very long', ru: 'Крайне длинная' }, pages: [16, 30], words: [4000, 9000], chapters: [4, 8], plan_approval: true, default: false },
    ],
    chapter_words: { min: 1000, max: 2500 },
    brief_template: 'Universe:\nLeads:\n',
  };
}
