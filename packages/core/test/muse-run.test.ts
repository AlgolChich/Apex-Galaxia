import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Harness, PRESETS, createProject, museSettings, resolveResources, seededRng, type GenerateOptions, type ProjectConfig, type Resources } from '@apex-galaxia/core';
import { ReplayAdapter } from '@apex-galaxia/adapters';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-muse-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const TITLES: Record<number, string> = { 1: 'Старые друзья', 2: 'Ночь в ангаре', 3: 'Чемодан', 4: 'Утро' };

/**
 * A scripted model with memory: the critic asks for one revision of a fresh draft and passes
 * the revised text; everything else echoes what the prompt asks for. `failOnce` makes one
 * chapter write throw the first time, to test resume.
 */
function makeResponder(state: { failOnce?: number; writes: number; critiques: number }) {
  const passed = new Set<string>();
  return (options: GenerateOptions): string => {
    const user = options.messages[options.messages.length - 1]?.content ?? '';
    const chapterNo = Number(/(?:Plan|Write) chapter (\d+)/.exec(user)?.[1] ?? /chapter_number[^\d]*(\d+)/.exec(user)?.[1] ?? '1');
    switch (options.task) {
      case 'plan.outline': {
        const count = Number(/as (\d+) chapters/.exec(user)?.[1] ?? '2');
        return JSON.stringify({ chapters: Array.from({ length: count }, (_, i) => ({ number: i + 1, title: TITLES[i + 1] ?? `Глава ${i + 1}`, line: `Что-то меняется в главе ${i + 1}.` })) });
      }
      case 'plan.chapter':
        return JSON.stringify({ chapter: chapterNo, title: TITLES[chapterNo] ?? `Глава ${chapterNo}`, goal: 'Цель.', beats: ['Скаут хочет пить.', 'Медик молчит.', 'Шпион смотрит.'], breather_scene: 'Фасоль из банки.', ending_image: 'Дым у лампы.', world_tick: ['Цены растут.'], guns: [] });
      case 'write.chapter': {
        state.writes += 1;
        if (state.failOnce === chapterNo) {
          state.failOnce = undefined;
          throw new Error('simulated crash mid-run');
        }
        const heading = /exactly in this form: (.+)/.exec(user)?.[1]?.trim() ?? `Глава ${chapterNo}. ${TITLES[chapterNo]}`;
        return `${heading}\n\nСкаут толкнул дверь ангара. Пахло маслом.\n\n— Ты один? — сказал Медик.\n\nДым поднимался к лампе.\n[[END]]`;
      }
      case 'write.continue':
        return 'Скаут ждал. Он ждал долго.\n[[END]]';
      case 'critic': {
        state.critiques += 1;
        const passage = /<passage>\n([\s\S]*?)\n<\/passage>/.exec(user)?.[1] ?? '';
        if (passed.has(passage)) {
          return JSON.stringify({ scores: { voice: 4, subtext: 4, rhythm: 4, cliche: 5, ai_tell: 5, continuity: 4, language: 4 }, quotes: [], verdict: 'pass' });
        }
        return JSON.stringify({ scores: { voice: 4, subtext: 3, rhythm: 3, cliche: 5, ai_tell: 5, continuity: 4, language: 4 }, quotes: [{ quote: 'Он ждал долго.', issue: 'Flat; show the wait.', category: 'rhythm', severity: 'medium' }], verdict: 'revise' });
      }
      case 'revise': {
        const revised = (/<passage>\n([\s\S]*?)\n<\/passage>/.exec(user)?.[1] ?? '').replace('Он ждал долго.', 'Он пересчитал патроны.').replace('Пахло маслом.', 'Пахло маслом и ржавчиной.');
        passed.add(revised);
        return `${revised}\n[[END]]`;
      }
      case 'chronicle.propose':
        return JSON.stringify({ chapter: chapterNo, summary: `Глава ${chapterNo}: Скаут в ангаре.`, ops: [{ op: 'set', path: 'locations.skaut', value: `ангар ${chapterNo}` }] });
      case 'summary.chapter':
        return 'Скаут вошёл в ангар и встретил Медика.\n[[END]]';
      case 'report.reader':
        return '## Overall\n\nFine.\n\n## Three changes\n\n1. More soup.\n[[END]]';
      default:
        return '{}';
    }
  };
}

async function setup(config: Partial<ProjectConfig> & { budget?: number | null } = {}, failOnce?: number) {
  const root = path.join(dir, 'story');
  const store = await createProject(root, { title: 'Черепа и Кости', language: 'ru', idea: 'Чемодан.', ...(config.length ? { length: config.length } : {}), ...(config.preset ? { preset: config.preset } : {}) });
  if (config.budget !== undefined) {
    store.config.budget.project_usd = config.budget;
    await store.saveConfig();
  }
  const state = { failOnce, writes: 0, critiques: 0 };
  const adapter = new ReplayAdapter({ mode: 'replay', responder: makeResponder(state) });
  const harness = await Harness.open(root, { adapter, resources, rng: seededRng(5) });
  return { harness, adapter, state, root };
}

describe('Muse Layer', () => {
  it('resolves presets and overrides', () => {
    expect(PRESETS.fast.critic).toBe(false);
    expect(PRESETS.best.maxRevisions).toBe(2);
    const cfg = { preset: 'balanced', muse: { max_revisions: 0 } } as unknown as ProjectConfig;
    expect(museSettings(cfg)).toEqual({ critic: true, maxRevisions: 0, minScore: 4 });
  });

  it('runs critic → revise → critic and keeps only the quoted change', async () => {
    const { harness, state } = await setup({ preset: 'balanced' });
    await harness.store.createChapter(1, 'Старые друзья', 'Скаут вошёл.\n');
    const outcome = await harness.write('continue', { chapter: await harness.store.getChapter(1) });
    expect(outcome.stages.map((s) => s.stage)).toEqual(['draft', 'critic', 'revise', 'critic']);
    expect(outcome.stages[1]?.verdict).toBe('revise');
    expect(outcome.stages[3]?.verdict).toBe('pass');
    expect(outcome.text).toBe('Скаут ждал. Он пересчитал патроны.');
    expect(outcome.critic?.verdict).toBe('pass');
    expect(outcome.suggestion.front.note).toContain('muse:');
    expect(outcome.costUsd).toBeGreaterThan(outcome.run.result.costUsd);
    expect(state.critiques).toBe(2);
  });

  it('skips the critic on the fast preset', async () => {
    const { harness, state } = await setup({ preset: 'fast' });
    await harness.store.createChapter(1, 'Старые друзья', 'Скаут вошёл.\n');
    const outcome = await harness.write('continue', { chapter: await harness.store.getChapter(1) });
    expect(outcome.stages.map((s) => s.stage)).toEqual(['draft']);
    expect(state.critiques).toBe(0);
  });
});

describe('autonomous run', () => {
  it('writes a two-chapter story unattended: plan, write, accept, chronicle, summary, export, report', async () => {
    const { harness, state } = await setup({ preset: 'balanced' });
    const messages: string[] = [];
    const run = await harness.runBook({ chapters: 2, onProgress: (_s, m) => messages.push(m) });
    expect(run.status).toBe('completed');
    expect(run.completed).toEqual([1, 2]);
    const chapters = await harness.store.listChapters();
    expect(chapters.map((c) => c.front.title)).toEqual(['Старые друзья', 'Ночь в ангаре']);
    expect(chapters[1]?.body).toContain('ржавчиной');
    expect((await harness.chronicle.readState()).last_chapter).toBe(2);
    expect(await harness.chronicle.readLog()).toContain('## Глава 2');
    expect(await fs.readdir(harness.store.layout.chronicle.summaries)).toHaveLength(2);
    const exported = await fs.readFile(path.join(harness.store.layout.exports, 'cherepa-i-kosti.md'), 'utf8');
    expect(exported).toContain('## Глава 1. Старые друзья');
    expect(exported).toContain('## Глава 2. Ночь в ангаре');
    expect(await fs.readFile(path.join(harness.store.layout.exports, 'cherepa-i-kosti-report.md'), 'utf8')).toContain('Three changes');
    expect(state.writes).toBe(2);
    expect(run.cost_usd).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes('chapter 2: done'))).toBe(true);
    const diffs = await fs.readFile(harness.store.layout.history.chronicleLog, 'utf8');
    expect(diffs.split('\n').filter((l) => l.includes('"by":"auto"'))).toHaveLength(2);
  });

  it('survives a crash mid-run and resumes where it stopped without rewriting chapter one', async () => {
    const { harness, state } = await setup({ preset: 'fast' }, 2);
    const first = await harness.runBook({ chapters: 2, readerReport: false });
    expect(first.status).toBe('failed');
    expect(first.error).toContain('simulated crash');
    expect(first.completed).toEqual([1]);
    expect(first.next_chapter).toBe(2);
    expect(first.stage).toBe('write');
    expect(await harness.readBeatSheet(2)).toBeDefined();
    const second = await harness.runBook({ resume: first.id, readerReport: false });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('completed');
    expect(second.completed).toEqual([1, 2]);
    expect(state.writes).toBe(3);
    expect((await harness.store.listChapters()).map((c) => c.front.number)).toEqual([1, 2]);
    expect((await harness.listRuns()).map((r) => r.id)).toEqual([first.id]);
    expect(second.log.some((l) => l.includes('resumed at chapter 2'))).toBe(true);
  });

  it('stops at the outline gate for long stories and continues after approval', async () => {
    const { harness } = await setup({ preset: 'fast', length: 'long' });
    const gate = await harness.runBook({ chapters: 1, readerReport: false });
    expect(gate.status).toBe('awaiting_outline_approval');
    expect(await harness.store.readText(harness.store.layout.plan.outline)).toContain('Глава 1. Старые друзья');
    expect(await harness.store.listChapters()).toHaveLength(0);
    const done = await harness.runBook({ resume: gate.id, approveOutline: true, readerReport: false });
    expect(done.status).toBe('completed');
    expect(done.outline_approved).toBe(true);
    expect(await harness.store.listChapters()).toHaveLength(1);
  });

  it('pauses, not fails, when the project budget is reached', async () => {
    const { harness } = await setup({ preset: 'fast', budget: 0.00001 });
    const run = await harness.runBook({ chapters: 1, readerReport: false });
    expect(run.status).toBe('paused');
    expect(run.error).toContain('budget');
  });
});
