import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Harness,
  applyDiff,
  createProject,
  diffParagraphs,
  enforceJsonContract,
  enforceProseContract,
  resolveResources,
  seededRng,
  upsertEntry,
  type GenerateOptions,
  type Resources,
} from '@apex-galaxia/core';
import { ReplayAdapter } from '@apex-galaxia/adapters';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-harness-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const BEAT_SHEET = {
  chapter: 1,
  title: 'Старые друзья',
  goal: 'Скаут возвращается на базу и находит ангар пустым.',
  beats: ['Скаут идёт по дороге и хочет пить.', 'Ангар пуст; Медик оставил записку.', 'Записка сгорает от спички Скаута.', 'Шпион наблюдает из тени.', 'Скаут садится на ящик и считает патроны.'],
  breather_scene: 'Скаут ест холодную фасоль из банки.',
  ending_image: 'Дым от записки поднимается к лампе.',
  world_tick: ['На севере цены на патроны выросли.'],
  guns: ['planted:suitcase'],
  cliffhanger: 'Из темноты кто-то называет его по имени.',
};

/** A scripted model: deterministic answers per task, so the pipeline is tested end to end offline. */
function scripted(options: GenerateOptions): string {
  const user = options.messages[options.messages.length - 1]?.content ?? '';
  if (user.includes('violated the output contract')) {
    return options.task === 'write.chapter'
      ? 'Глава 1. Старые друзья\n\nСкаут шёл по дороге и хотел пить.\n\nДым поднимался к лампе.\n[[END]]'
      : 'Скаут шёл по дороге и хотел пить.\n\nДым поднимался к лампе.\n[[END]]';
  }
  switch (options.task) {
    case 'write.continue':
      return 'Here is the continuation:\n\nСкаут толкнул дверь. В ангаре пахло маслом.\n[[END]]\nNote: hope this helps';
    case 'write.guided':
      return 'Медик молчал и считал ампулы.\n\nСкаут ждал.\n[[END]]';
    case 'write.chapter':
      return 'Глава 1. Старые друзья\n\nСкаут шёл по дороге и хотел пить.\n\n— Ты один? — сказал Медик.\n\nДым от записки поднимался к лампе.\n[[END]]';
    case 'plan.chapter':
      return JSON.stringify(BEAT_SHEET);
    case 'summary.chapter':
      return 'Скаут вернулся на базу, нашёл ангар пустым и сжёг записку Медика. Шпион следил за ним. Открыт вопрос о чемодане.\n[[END]]';
    case 'chronicle.propose':
      return JSON.stringify({
        chapter: 1,
        summary: 'Скаут добрался до ангара и сжёг записку. Шпион видел это.',
        hidden: 'Чемодан у Шпиона; выстрелит в главе 3.',
        in_story_time: 'ночь на 3 июля',
        ops: [
          { op: 'set', path: 'locations.skaut', value: 'ангар' },
          { op: 'append', path: 'open_threads', value: { id: 'note', text: 'Что было в записке?', since_chapter: 1 } },
        ],
      });
    case 'critic':
      return JSON.stringify({ scores: { voice: 4, subtext: 3, rhythm: 4, cliche: 5, ai_tell: 5, continuity: 4, language: 4 }, quotes: [{ quote: 'Скаут ждал.', issue: 'Flat beat; show the wait through an object.', category: 'rhythm', severity: 'low' }], verdict: 'revise' });
    case 'rewrite.tighten':
      return 'Скаут толкнул дверь. Пахло маслом.\n[[END]]';
    case 'describe':
      return JSON.stringify({ options: [{ sense: 'smell', text: 'Пахло маслом и мокрым бетоном.' }, { sense: 'sound', text: 'Лампа гудела.' }] });
    case 'lesson.extract':
      return JSON.stringify({ category: 'dialogue', rule: 'Медик не объясняет своих мотивов вслух.', before: 'Я боюсь.', after: 'Он считал ампулы.', language: 'ru' });
    default:
      return '{}';
  }
}

async function makeHarness(opts: { budget?: number | null } = {}) {
  const root = path.join(dir, 'story');
  // Preset fast: these tests cover the pipeline without the Muse Layer (see muse-run.test.ts).
  const store = await createProject(root, { title: 'Черепа и Кости', language: 'ru', idea: 'Девять наёмников и один чемодан.', preset: 'fast' });
  if (opts.budget !== undefined) {
    store.config.budget.project_usd = opts.budget;
    await store.saveConfig();
  }
  await upsertEntry(store, { kind: 'character', front: { name: 'Скаут', aliases: { ru: [], en: ['Scout'] }, kind: 'canon' }, body: '## Summary\n\nБыстрый парень из Бостона.' });
  await upsertEntry(store, { kind: 'character', front: { name: 'Медик', aliases: { ru: [], en: ['Medic'] }, kind: 'canon' }, body: '## Summary\n\nВрач без лицензии.' });
  const adapter = new ReplayAdapter({ mode: 'replay', responder: scripted });
  const harness = await Harness.open(root, { adapter, resources, rng: seededRng(7) });
  return { harness, adapter, root };
}

describe('output contracts', () => {
  it('strips the stop marker and service lines, flags preambles and headings', () => {
    const check = enforceProseContract('Here is the text:\n\nПроза.\n[[END]]\nNote: x');
    expect(check.value).toBe('Here is the text:\n\nПроза.');
    expect(check.violations.some((v) => v.includes('preamble'))).toBe(true);
    const clean = enforceProseContract('Проза.\n\nЕщё проза.\n[[END]]');
    expect(clean.violations).toEqual([]);
    const heading = enforceProseContract('# Глава 1. Старые друзья\n\nТекст.', { heading: { language: 'ru', number: 1, title: 'Старые друзья' } });
    expect(heading.violations).toEqual([]);
    expect(heading.value.startsWith('Глава 1. Старые друзья')).toBe(true);
    const wrongHeading = enforceProseContract('Текст без заголовка.', { heading: { language: 'ru', number: 1, title: 'Старые друзья' } });
    expect(wrongHeading.violations[0]).toContain('chapter heading');
  });

  it('validates JSON contracts and tolerates fences', () => {
    const ok = enforceJsonContract('```json\n{"options":[{"sense":"smell","text":"x"}]}\n```', 'describe-options');
    expect(ok.violations).toEqual([]);
    const bad = enforceJsonContract('{"options":[]}', 'describe-options');
    expect(bad.violations.length).toBeGreaterThan(0);
    const notJson = enforceJsonContract('nope', 'describe-options');
    expect(notJson.violations[0]).toContain('not JSON');
  });
});

describe('Harness write pipeline (offline, scripted model)', () => {
  it('continues a chapter: contract retry, lint, suggestion, accept, call log', async () => {
    const { harness, adapter } = await makeHarness();
    await harness.store.createChapter(1, 'Старые друзья', 'Скаут шёл к ангару.\n');
    const chapter = await harness.store.getChapter(1);
    const deltas: string[] = [];
    const outcome = await harness.write('continue', { chapter, targetWords: 120, onDelta: (d) => deltas.push(d) });
    expect(outcome.run.retried).toBe(true);
    expect(outcome.text).toBe('Скаут шёл по дороге и хотел пить.\n\nДым поднимался к лампе.');
    expect(outcome.suggestion.front.status).toBe('pending');
    expect(outcome.suggestion.front.chapter).toBe(1);
    expect(deltas.join('')).toContain('Скаут');
    expect(adapter.calls.map((c) => c.task)).toEqual(['write.continue', 'write.continue']);
    expect(adapter.calls[0]!.system[0]!.text).toContain('Gwen');
    expect(adapter.calls[0]!.stopSequences).toEqual(['[[END]]']);

    const before = await harness.store.getChapter(1);
    expect(before.body).toBe('Скаут шёл к ангару.\n');
    const accepted = await harness.accept(outcome.suggestion.front.id);
    expect(accepted.body).toBe('Скаут шёл к ангару.\n\nСкаут шёл по дороге и хотел пить.\n\nДым поднимался к лампе.\n');
    const calls = await harness.store.readCalls();
    expect(calls.filter((c) => c.accepted === true)).toHaveLength(1);
    await expect(harness.accept(outcome.suggestion.front.id)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('writes a chapter from a planned beat sheet with the heading contract and creates the file on accept', async () => {
    const { harness } = await makeHarness();
    const outcome = await harness.write('chapter', { chapterNumber: 1 });
    expect(outcome.text.startsWith('Глава 1. Старые друзья')).toBe(true);
    expect(outcome.run.retried).toBe(false);
    expect(outcome.lint.hits.filter((h) => h.severity === 'error')).toHaveLength(0);
    const plan = await harness.store.readText(harness.store.layout.plan.chapters);
    expect(plan).toContain('Старые друзья');
    expect(await harness.store.listChapters()).toHaveLength(0);
    const chapter = await harness.accept(outcome.suggestion.front.id);
    expect(chapter.front.number).toBe(1);
    expect(chapter.front.title).toBe('Старые друзья');
    expect(chapter.body.startsWith('Скаут шёл по дороге')).toBe(true);
    expect(chapter.body).not.toContain('Глава 1.');
  });

  it('rolls Randy\'s die in code before planning and logs it in the chronicle', async () => {
    const { harness, adapter } = await makeHarness();
    harness.store.config.storyteller = 'randy';
    await harness.store.saveConfig();
    const { sheet, roll } = await harness.planChapter(1);
    expect(sheet.beats.length).toBeGreaterThanOrEqual(3);
    expect(roll?.die).toBe('d20');
    const state = await harness.chronicle.readState();
    expect(state.rolls).toHaveLength(1);
    expect(state.rolls[0]?.result).toBe(roll?.result);
    const planCall = adapter.calls.find((c) => c.task === 'plan.chapter')!;
    expect(planCall.messages[0]!.content).toContain(`rolled ${roll?.result}`);
    expect(planCall.jsonSchemaName).toBe('beat-sheet');
  });

  it('proposes a chronicle update that applies only on confirmation, and caches summaries', async () => {
    const { harness } = await makeHarness();
    await harness.store.createChapter(1, 'Старые друзья', 'Скаут сжёг записку.\n');
    const chapter = await harness.store.getChapter(1);
    const { proposal } = await harness.proposeChronicle(chapter);
    expect(proposal.ops).toHaveLength(2);
    expect((await harness.chronicle.readState()).last_chapter).toBe(0);
    const applied = await harness.chronicle.applyProposal(proposal);
    expect(applied.state.locations['skaut']).toBe('ангар');
    expect(await harness.chronicle.readLog()).toContain('сжёг записку');
    const { summary, file } = await harness.summarizeChapter(chapter);
    expect(summary).toContain('Скаут вернулся');
    expect(await fs.readFile(file, 'utf8')).toContain('source_hash');
  });

  it('critiques, rewrites with a paragraph diff, describes and extracts lessons', async () => {
    const { harness } = await makeHarness();
    const passage = 'Скаут толкнул дверь. В ангаре пахло маслом.\n\nСкаут ждал.';
    const { result } = await harness.critique(passage);
    expect(result.verdict).toBe('revise');
    expect(result.quotes[0]?.quote).toBe('Скаут ждал.');
    const rewritten = await harness.rewrite('tighten', passage, { percent: '30' });
    expect(rewritten.text).toBe('Скаут толкнул дверь. Пахло маслом.');
    expect(rewritten.diff.map((b) => b.kind)).toEqual(['changed']);
    expect(rewritten.diff[0]?.before).toHaveLength(2);
    expect(rewritten.diff[0]?.after).toHaveLength(1);
    expect(applyDiff(rewritten.diff, 'none').trim()).toBe(passage);
    expect(applyDiff(rewritten.diff, 'all').trim()).toBe(rewritten.text);
    const { options } = await harness.describe('В ангаре пахло маслом.', { count: 2 });
    expect(options.options.map((o) => o.sense)).toEqual(['smell', 'sound']);
    const { proposal } = await harness.lessonFromEdit('Я боюсь.', 'Он считал ампулы.', 'he would never say that');
    expect(proposal.category).toBe('dialogue');
  });

  it('estimates cost before a call and stops at the project budget', async () => {
    const { harness } = await makeHarness({ budget: 0.0001 });
    await harness.store.createChapter(1, 'Старые друзья', 'Скаут шёл к ангару.\n');
    const chapter = await harness.store.getChapter(1);
    const estimate = await harness.estimate({ task: 'write.continue', chapter, vars: { target_words: '300' } });
    expect(estimate.inputTokens).toBeGreaterThan(500);
    expect(estimate.costUsd).toBeGreaterThan(0);
    await expect(harness.write('continue', { chapter })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('diffs paragraphs with insertions and deletions', () => {
    const blocks = diffParagraphs('a\n\nb\n\nc', 'a\n\nB\n\nc\n\nd');
    expect(blocks.map((b) => b.kind)).toEqual(['same', 'changed', 'same', 'added']);
    expect(applyDiff(blocks, [false, true, false, false]).trim()).toBe('a\n\nB\n\nc');
  });
});
