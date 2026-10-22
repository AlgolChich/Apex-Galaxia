import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Chronicle,
  activateEntries,
  aliasPattern,
  applyOps,
  createProject,
  entryTemplate,
  getEntry,
  loadBible,
  outcomeFor,
  renderEntry,
  rollD20,
  seededRng,
  upsertEntry,
  ChronicleStateSchema,
  type ProjectStore,
} from '@apex-galaxia/core';

let dir: string;
let store: ProjectStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-bible-'));
  store = await createProject(path.join(dir, 's'), { title: 'Черепа и Кости', language: 'ru' });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('alias patterns', () => {
  it('matches inflected Russian names and sheds a final vowel', () => {
    expect(aliasPattern('Скаут').test('Он отдал Скауту ключ.')).toBe(true);
    expect(aliasPattern('Скаут').test('со Скаутом')).toBe(true);
    expect(aliasPattern('Гвиневра').test('письмо Гвиневре')).toBe(true);
    expect(aliasPattern('Гвиневра').test('говорил с Гвиневрой')).toBe(true);
    expect(aliasPattern('Поджигатель').test('Поджигателем')).toBe(true);
  });

  it('does not fire on unrelated longer words or lowercase homographs', () => {
    expect(aliasPattern('Волк').test('волкодав')).toBe(false);
    expect(aliasPattern('Маша').test('машина стояла у ворот')).toBe(false);
    expect(aliasPattern('Маша').test('Маша стояла у ворот')).toBe(true);
    expect(aliasPattern('Кот').test('Котлован')).toBe(false);
  });

  it('matches English aliases with plurals and possessives, case-insensitively', () => {
    expect(aliasPattern('Engineer').test("the engineer's wrench")).toBe(true);
    expect(aliasPattern('Sentry').test('two sentries')).toBe(false);
    expect(aliasPattern('Sentry').test('the sentry fired')).toBe(true);
    expect(aliasPattern('Heavy').test('heavyweight')).toBe(false);
  });
});

describe('Bible entries and activation', () => {
  it('writes, reads and renders an entry with sections', async () => {
    const body = entryTemplate('character', 'ru', 'Солдат').replace('## Summary\n\n_Одна строка: попадает в контекст при каждом упоминании._', '## Summary\n\nВетеран с каской на глазах; верит в Сунь-цзы и в себя.');
    const entry = await upsertEntry(store, {
      kind: 'character',
      front: { name: 'Солдат', aliases: { ru: ['Солли'], en: ['Soldier'] }, kind: 'canon' },
      body,
    });
    expect(entry.slug).toBe('soldat');
    expect(entry.summary).toBe('Ветеран с каской на глазах; верит в Сунь-цзы и в себя.');
    const again = await getEntry(store, 'character', 'soldat');
    expect(again.front.aliases.en).toEqual(['Soldier']);
    const rendered = renderEntry(again, { full: true });
    expect(rendered).toContain('### Солдат (character, canon)');
    expect(rendered).toContain('Aliases: Солдат, Солли, Soldier');
    expect(rendered).not.toContain('Secrets');
    expect(renderEntry(again, { full: true, includeSecrets: true })).toContain('Secrets');
  });

  it('activates entries by alias, pin and always-on, in that priority', async () => {
    await upsertEntry(store, { kind: 'character', front: { name: 'Скаут', aliases: { ru: [], en: ['Scout'] } }, body: '## Summary\n\nБыстрый парень из Бостона.' });
    await upsertEntry(store, { kind: 'character', front: { name: 'Медик', aliases: { ru: ['Герр Доктор'], en: ['Medic'] } }, body: '## Summary\n\nВрач без лицензии.' });
    await upsertEntry(store, { kind: 'location', front: { name: 'Ангар', aliases: { ru: [], en: ['Hangar'] }, always_on: true }, body: '## Summary\n\nСтарый ангар на краю базы.' });
    await upsertEntry(store, { kind: 'item', front: { name: 'Чемодан', aliases: { ru: [], en: [] } }, body: '## Summary\n\nЧемодан с разведданными.' });
    const bible = await loadBible(store);
    expect(bible.entries).toHaveLength(4);
    const window = 'Скаут бежал первым. Герр Доктор смеялся ему вслед, и Скауту это не нравилось.';
    const activations = activateEntries(bible.entries, { language: 'ru', window, pins: ['chemodan'] });
    expect(activations.map((a) => `${a.entry.slug}:${a.reason}`)).toEqual([
      'angar:always_on',
      'chemodan:pinned',
      'skaut:alias',
      'medik:alias',
    ]);
    expect(activations[2]?.hits).toBe(2);
    expect(activations[3]?.matchedAliases).toEqual(['Герр Доктор']);
  });
});

describe('chronicle state ops', () => {
  it('applies set, merge, append, remove and unset and validates the result', () => {
    const state = ChronicleStateSchema.parse({});
    const next = applyOps(state, [
      { op: 'set', path: 'locations.skaut', value: 'ангар' },
      { op: 'merge', path: 'condition.skaut', value: { fatigue: 'измотан', wounds: ['порез на ладони'] } },
      { op: 'append', path: 'open_threads', value: { id: 'suitcase', text: 'Кто забрал чемодан?', since_chapter: 1 } },
      { op: 'append', path: 'open_threads', value: { id: 'suitcase', text: 'Кто забрал чемодан? Медик знает.', since_chapter: 1 } },
      { op: 'append', path: 'inventory.skaut', value: 'бита' },
      { op: 'set', path: 'in_story_time', value: 'ночь на 3 июля' },
    ]);
    expect(next.locations['skaut']).toBe('ангар');
    expect(next.condition['skaut']?.fatigue).toBe('измотан');
    expect(next.open_threads).toHaveLength(1);
    expect(next.open_threads[0]?.text).toContain('Медик знает');
    expect(next.inventory['skaut']).toEqual(['бита']);
    expect(state.locations['skaut']).toBeUndefined();

    const later = applyOps(next, [
      { op: 'remove', path: 'open_threads', where: { id: 'suitcase' } },
      { op: 'unset', path: 'locations.skaut' },
    ]);
    expect(later.open_threads).toHaveLength(0);
    expect(later.locations['skaut']).toBeUndefined();
  });

  it('rejects ops that would corrupt the state', () => {
    const state = ChronicleStateSchema.parse({});
    expect(() => applyOps(state, [{ op: 'set', path: 'last_chapter', value: 'three' }])).toThrow(/invalid/);
    expect(() => applyOps(state, [{ op: 'append', path: 'in_story_time', value: 'x' }])).toThrow(/not a list/);
    expect(() => applyOps(state, [{ op: 'remove', path: 'rolls' }])).toThrow(/where or index/);
  });
});

describe('Chronicle', () => {
  it('applies a proposal: state, reader log, hidden block and diff log', async () => {
    const chronicle = new Chronicle(store);
    const result = await chronicle.applyProposal({
      chapter: 1,
      summary: 'Скаут добрался до ангара и потерял чемодан. Медик что-то знает.',
      hidden: 'Чемодан у Шпиона; выстрелит в главе 3.',
      in_story_time: 'ночь на 3 июля',
      ops: [
        { op: 'set', path: 'locations.skaut', value: 'ангар' },
        { op: 'append', path: 'planted_guns', value: { id: 'suitcase', what: 'чемодан', planted_in: 1, payoff: 'глава 3' } },
      ],
    });
    expect(result.state.last_chapter).toBe(1);
    expect(result.state.in_story_time).toBe('ночь на 3 июля');
    const log = await chronicle.readLog();
    expect(log).toContain('## Глава 1');
    expect(log).toContain('потерял чемодан');
    expect(log).not.toContain('Шпиона');
    const hidden = await chronicle.readHidden();
    expect(hidden).toContain('## После главы 1');
    const diffs = await fs.readFile(store.layout.history.chronicleLog, 'utf8');
    expect(diffs).toContain('"chapter":1');

    const handover = await chronicle.handover();
    expect(handover.readerSafe).toContain('Летопись для передачи');
    expect(handover.readerSafe).toContain('skaut: ангар');
    expect(handover.readerSafe).not.toContain('planted_guns');
    expect(handover.hidden).toContain('Скрыто от читателя');
    expect(handover.hidden).toContain('suitcase');
  });

  it('rejects an invalid proposal before writing anything', async () => {
    const chronicle = new Chronicle(store);
    await expect(chronicle.applyProposal({ chapter: 1, summary: '', ops: [] })).rejects.toThrow();
    expect((await chronicle.readState()).last_chapter).toBe(0);
  });

  it('records d20 rolls with the right outcomes', async () => {
    expect(outcomeFor(1)).toBe('luck');
    expect(outcomeFor(4)).toBe('luck');
    expect(outcomeFor(5)).toBe('lull');
    expect(outcomeFor(12)).toBe('lull');
    expect(outcomeFor(13)).toBe('trouble');
    expect(outcomeFor(18)).toBe('trouble');
    expect(outcomeFor(19)).toBe('catastrophe');
    expect(outcomeFor(20)).toBe('catastrophe');
    const rng = seededRng(42);
    const a = rollD20(2, rng);
    const b = rollD20(2, seededRng(42));
    expect(a.result).toBe(b.result);
    expect(a.result).toBeGreaterThanOrEqual(1);
    expect(a.result).toBeLessThanOrEqual(20);
    const chronicle = new Chronicle(store);
    const state = await chronicle.recordRoll(a);
    expect(state.rolls).toHaveLength(1);
    expect(state.rolls[0]?.at).toBeDefined();
    const results = new Set<number>();
    for (let i = 0; i < 2000; i += 1) results.add(rollD20(1).result);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(20);
  });
});
