import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CachedTokenCounter,
  DEFAULT_MODELS,
  HeuristicTokenCounter,
  ModelRegistry,
  createProject,
  estimateCost,
  estimateTokens,
  loadNarrator,
  loadStyleMemory,
  nextLessonId,
  parseLessons,
  parsePhraseList,
  renderPlannerRules,
  renderSettingsLine,
  resolveResources,
  selectLessons,
  serializeLesson,
  type Resources,
} from '@apex-galaxia/core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-narrator-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'user-home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('narrator profile (Gwen)', () => {
  it('loads every data file and exposes the Appendix B tables', async () => {
    const gwen = await loadNarrator(resources, 'gwen');
    expect(gwen.name).toBe('gwen');
    expect(gwen.defaults.storyteller).toBe('cassandra');
    expect(gwen.defaults.harshness).toBe(3);
    expect(gwen.storytellers.map((s) => s.id)).toEqual(['cassandra', 'phoebe', 'randy']);
    expect(gwen.harshness).toHaveLength(6);
    expect(gwen.harshness[5]?.name.en).toBe('Losing is fun');
    expect(gwen.ratings.map((r) => r.id)).toEqual(['soft', 'medium', 'high', 'heavy']);
    expect(gwen.lengths.find((l) => l.id === 'very_long')?.plan_approval).toBe(true);
    expect(gwen.commands.some((c) => c.ru === '/летопись' && c.en === 'chronicle')).toBe(true);
    expect(gwen.dice.outcomes).toHaveLength(4);
    expect(gwen.system).toContain('Inside the story you are silent');
    expect(gwen.hardLimits).toContain('never move');
    expect(gwen.selfCheck).toContain('breather scene');
    expect(gwen.briefTemplate).toContain('Вселенная / Universe');
  });

  it('renders planner rules with storyteller, harshness and Randy\'s roll', async () => {
    const gwen = await loadNarrator(resources);
    const store = await createProject(path.join(dir, 'p'), { title: 'T', language: 'en', storyteller: 'randy', harshness: 5 });
    const rules = renderPlannerRules(gwen, store.config, { chapter: 1, die: 'd20', result: 19, outcome: 'catastrophe' });
    expect(rules).toContain('Randy Random governs the rhythm');
    expect(rules).toContain('Harshness 5 (Blood and dust)');
    expect(rules).toContain('rolled 19');
    expect(rules).toContain('Catastrophe or miracle');
    const noRoll = renderPlannerRules(gwen, store.config);
    expect(noRoll).toContain('treat it as a lull');
    const line = renderSettingsLine(gwen, store.config, 'ru');
    expect(line).toContain('Рэнди Случайный');
    expect(line).toContain('Кровь и пыль');
  });

  it('lets a user override win file by file', async () => {
    const override = path.join(dir, 'user-home', 'narrators', 'gwen');
    await fs.mkdir(override, { recursive: true });
    await fs.writeFile(path.join(override, 'hard-limits.md'), 'Custom limits.\n');
    const gwen = await loadNarrator(resources);
    expect(gwen.hardLimits).toBe('Custom limits.');
    expect(gwen.system).toContain('Gwen');
  });

  it('fails clearly for an unknown narrator', async () => {
    await expect(loadNarrator(resources, 'nobody')).rejects.toMatchObject({ code: 'NARRATOR_NOT_FOUND' });
  });
});

describe('style memory', () => {
  it('parses phrase lists with notes and comments', () => {
    const list = parsePhraseList('# comment\n\nсердце пропустило удар\ndelve | AI vocabulary\n');
    expect(list).toEqual([{ phrase: 'сердце пропустило удар' }, { phrase: 'delve', note: 'AI vocabulary' }]);
  });

  it('parses and serializes lessons losslessly', () => {
    const lesson = {
      id: 'lesson-0007',
      date: '2026-10-22',
      category: 'dialogue' as const,
      rule: 'Answers miss.',
      provenance: 'Retry note on chapter 2',
      weight: 2,
      language: 'ru' as const,
      before: 'Line one\nLine two',
      after: 'Better line',
    };
    const text = serializeLesson(lesson);
    const parsed = parseLessons(text);
    expect(parsed).toEqual([lesson]);
    expect(nextLessonId(parsed)).toBe('lesson-0008');
  });

  it('loads the shipped seed plus project additions and selects by category', async () => {
    const store = await createProject(path.join(dir, 'p'), { title: 'T', language: 'ru' });
    await fs.appendFile(store.layout.style.bannedRu, 'холодный пот\n');
    await fs.appendFile(store.layout.style.whitelist, 'в глубине души\n');
    const memory = await loadStyleMemory(store, resources);
    expect(memory.houseRules).toContain('Nobody states the theme');
    expect(memory.rubric).toContain('Voice fidelity');
    expect(memory.lessons.length).toBeGreaterThanOrEqual(2);
    expect(memory.banned.ru.some((p) => p.phrase === 'сердце пропустило удар')).toBe(true);
    expect(memory.banned.ru.some((p) => p.phrase === 'холодный пот')).toBe(true);
    expect(memory.banned.en.some((p) => p.phrase === 'delve')).toBe(true);
    expect(memory.whitelist).toEqual(['в глубине души']);
    const picked = selectLessons(memory.lessons, ['labeling'], 'ru', 1);
    expect(picked[0]?.category).toBe('labeling');
  });
});

describe('tokens and cost', () => {
  it('estimates Russian as more expensive than English for similar text', () => {
    const en = estimateTokens('The hangar smelled of oil and rain, and nobody spoke for a while.');
    const ru = estimateTokens('В ангаре пахло маслом и дождём, и никто долго не говорил.');
    expect(ru).toBeGreaterThan(en * 1.3);
    expect(estimateTokens('')).toBe(0);
  });

  it('caches counts', async () => {
    let calls = 0;
    const inner = { exact: true, count: async (t: string) => { calls += 1; return t.length; } };
    const counter = new CachedTokenCounter(inner);
    expect(await counter.count('abc')).toBe(3);
    expect(await counter.count('abc')).toBe(3);
    expect(calls).toBe(1);
    expect(counter.exact).toBe(true);
    expect(new HeuristicTokenCounter().exact).toBe(false);
  });

  it('prices usage from the registry, including cache tokens and long context', () => {
    const registry = new ModelRegistry(DEFAULT_MODELS);
    const opus = registry.require('claude-opus-5-5');
    const cost = estimateCost(opus, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(cost).toBeCloseTo(4);
    const cached = estimateCost(opus, { inputTokens: 0, outputTokens: 1000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 });
    expect(cached).toBeCloseTo(0.2 + 0.02);
    const haiku = registry.require('claude-haiku-5-5');
    const longCost = estimateCost(haiku, { inputTokens: 200_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(longCost).toBeCloseTo(0.1);
    expect(estimateCost(undefined, { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
    expect(() => registry.require('gpt-nope')).toThrow(/Unknown model/);
  });
});
