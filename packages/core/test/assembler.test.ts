import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Chronicle,
  HeuristicTokenCounter,
  PromptLibrary,
  STOP_MARKER,
  assemblePrompt,
  createProject,
  formatInspector,
  loadBible,
  loadNarrator,
  loadStyleMemory,
  resolveResources,
  upsertEntry,
  type AssembleDeps,
  type ProjectStore,
  type Resources,
} from '@apex-galaxia/core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;
let store: ProjectStore;

async function deps(): Promise<AssembleDeps> {
  return {
    store,
    narrator: await loadNarrator(resources),
    style: await loadStyleMemory(store, resources),
    bible: await loadBible(store),
    state: await new Chronicle(store).readState(),
    library: new PromptLibrary(resources),
    counter: new HeuristicTokenCounter(),
  };
}

const LONG_RU = Array.from({ length: 400 }, (_, i) => `Скаут бежал по коридору номер ${i}, и Медик смотрел ему вслед.`).join('\n\n');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-asm-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
  store = await createProject(path.join(dir, 'p'), { title: 'Черепа и Кости', language: 'ru', idea: 'Девять наёмников и один чемодан.' });
  await upsertEntry(store, { kind: 'character', front: { name: 'Скаут', aliases: { ru: [], en: ['Scout'] }, kind: 'canon' }, body: '## Summary\n\nБыстрый парень из Бостона.\n\n## Voice\n\nКороткие фразы, хвастовство.\n\n## Secrets\n\nБоится темноты.' });
  await upsertEntry(store, { kind: 'character', front: { name: 'Медик', aliases: { ru: [], en: ['Medic'] }, kind: 'canon' }, body: '## Summary\n\nВрач без лицензии.' });
  await upsertEntry(store, { kind: 'location', front: { name: 'Ангар', aliases: { ru: [], en: [] }, always_on: true }, body: '## Summary\n\nСтарый ангар на краю базы.' });
  await upsertEntry(store, { kind: 'character', front: { name: 'Шпион', aliases: { ru: [], en: ['Spy'] }, kind: 'canon' }, body: '## Summary\n\nЧеловек в маске.' });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('context assembler', () => {
  it('builds the system layers in the fixed order and the user turn in the fixed order', async () => {
    const ch = await store.createChapter(1, 'Старые друзья', 'Скаут вошёл в ангар. Медик ждал его.\n');
    const prompt = await assemblePrompt(await deps(), { task: 'write.continue', chapter: ch, vars: { target_words: '300' } });
    const names = prompt.inspector.layers.map((l) => l.name);
    expect(names.slice(0, 5)).toEqual(['system:narrator', 'system:language', 'system:house-rules', 'system:contract', 'system:rating-and-limits']);
    expect(prompt.system[prompt.system.length - 1]?.cache).toBe(true);
    expect(prompt.system[prompt.system.length - 1]?.text).toContain('Hard limits');
    expect(prompt.system[1]?.text).toContain('Language module: Russian');
    const userOrder = names.slice(5);
    expect(userOrder.indexOf('instruction')).toBeLessThan(userOrder.indexOf('window'));
    expect(userOrder.indexOf('window')).toBeLessThan(userOrder.indexOf('bible-pinned'));
    expect(userOrder.indexOf('bible-triggered')).toBeLessThan(userOrder.indexOf('chronicle'));
    expect(userOrder.indexOf('chronicle')).toBeLessThan(userOrder.indexOf('lessons'));
    expect(userOrder[userOrder.length - 1]).toBe('settings');
    const user = prompt.messages[0]!.content;
    expect(user).toContain('Write about 300 words');
    expect(user).toContain('<current_chapter');
    expect(user).toContain('Глава 1. Старые друзья');
    expect(prompt.system[3]?.text).toContain(STOP_MARKER);
    expect(prompt.stopSequences).toEqual([STOP_MARKER]);
    expect(prompt.model).toBe('claude-opus-5-5');
  });

  it('activates Bible entries by alias and always-on, keeps secrets hidden unless unlocked', async () => {
    const ch = await store.createChapter(1, 'Старые друзья', 'Скаут вошёл в ангар. Медик ждал его.\n');
    const prompt = await assemblePrompt(await deps(), { task: 'write.continue', chapter: ch, vars: { target_words: '300' } });
    const bible = prompt.inspector.bible;
    expect(bible.find((b) => b.slug === 'angar')?.reason).toBe('always_on');
    expect(bible.find((b) => b.slug === 'skaut')?.reason).toBe('alias');
    expect(bible.find((b) => b.slug === 'skaut')?.matchedAliases).toEqual(['Скаут']);
    expect(bible.find((b) => b.slug === 'shpion')).toBeUndefined();
    expect(prompt.messages[0]!.content).not.toContain('Боится темноты');
    const unlocked = await assemblePrompt(await deps(), { task: 'write.continue', chapter: ch, vars: { target_words: '300' }, unlockSecretsFor: ['skaut'] });
    expect(unlocked.messages[0]!.content).toContain('Боится темноты');
  });

  it('trims by priority when over budget: lessons, voice card, summaries, chronicle, then Bible details, then the window', async () => {
    await store.createChapter(1, 'Первая', LONG_RU);
    const ch2 = await store.createChapter(2, 'Вторая', LONG_RU);
    const full = await assemblePrompt(await deps(), { task: 'write.continue', chapter: ch2, vars: { target_words: '300' } });
    expect(full.inspector.layers.find((l) => l.name === 'window')?.action).toBe('kept');
    expect(full.inspector.totalTokens).toBeGreaterThan(12_000);

    const tight = await assemblePrompt(await deps(), { task: 'write.continue', chapter: ch2, vars: { target_words: '300' }, budgetTokens: 9_000 });
    expect(tight.inspector.totalTokens).toBeLessThanOrEqual(9_000);
    const layer = (name: string) => tight.inspector.layers.find((l) => l.name === name);
    expect(layer('lessons')?.included ?? false).toBe(false);
    expect(layer('summaries')?.action).not.toBe('kept');
    expect(layer('window')?.action).toBe('truncated');
    expect(layer('instruction')?.action).toBe('kept');
    expect(layer('instruction')?.included).toBe(true);
    const text = formatInspector(tight.inspector, 'ru');
    expect(text).toContain('Бюджет 9000');
    expect(text).toContain('window');
  });

  it('omits the window layer when the template embeds the chapter itself (window: none)', async () => {
    const ch = await store.createChapter(1, 'Старые друзья', 'Скаут вошёл в ангар. Медик ждал его.\n');
    const summary = await assemblePrompt(await deps(), { task: 'summary.chapter', chapter: ch, vars: { chapter_text: ch.body } });
    expect(summary.inspector.layers.find((l) => l.name === 'window')).toBeUndefined();
    const user = summary.messages[0]!.content;
    expect(user.split('Скаут вошёл в ангар').length - 1).toBe(1);
    expect(summary.inspector.bible.find((b) => b.slug === 'skaut')?.reason).toBe('alias');
    const proposal = await assemblePrompt(await deps(), { task: 'chronicle.propose', chapter: ch, vars: { chapter_text: ch.body } });
    expect(proposal.inspector.layers.find((l) => l.name === 'window')).toBeUndefined();
  });

  it('gives the planner the hidden state and Randy\'s roll, and never the writer', async () => {
    store.config.storyteller = 'randy';
    await store.saveConfig();
    const chronicle = new Chronicle(store);
    await chronicle.applyProposal({ chapter: 1, summary: 'Чемодан пропал.', ops: [{ op: 'append', path: 'planted_guns', value: { id: 'suitcase', what: 'чемодан', planted_in: 1 } }] });
    const d = await deps();
    const plan = await assemblePrompt(d, { task: 'plan.chapter', plannerView: true, latestRoll: { chapter: 2, die: 'd20', result: 20, outcome: 'catastrophe' }, vars: { chapter_plan_hint: '' } });
    expect(plan.messages[0]!.content).toContain('rolled 20');
    expect(plan.messages[0]!.content).toContain('planted_guns');
    expect(plan.jsonSchemaName).toBe('beat-sheet');
    expect(plan.model).toBe('claude-fable-5-1');
    expect(plan.stopSequences).toEqual([]);
    const ch = await store.createChapter(2, 'Вторая', 'Скаут молчал.');
    const write = await assemblePrompt(d, { task: 'write.continue', chapter: ch, vars: { target_words: '200' } });
    expect(write.messages[0]!.content).not.toContain('planted_guns');
    expect(write.messages[0]!.content).not.toContain('Randy Random governs');
  });
});
