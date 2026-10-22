import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beatFingerprint, formatPlannerReport, jaccardDistance, loadPlannerBriefs, resolveResources, runPlannerEvals, type Resources } from '@apex-galaxia/core';
import { ReplayAdapter, scriptedResponder } from '@apex-galaxia/adapters';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-planner-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('planner evals', () => {
  it('loads the shipped briefs and measures beat distance deterministically', async () => {
    const briefs = await loadPlannerBriefs(path.join(repoRoot, 'evals', 'planner'));
    expect(briefs.map((b) => path.basename(b.file))).toEqual(['ferry.en.md', 'shakhta.ru.md']);
    expect(briefs[1]?.storytellers).toEqual(['cassandra', 'phoebe', 'randy']);
    const sheet = { chapter: 1, title: 'Фары', goal: 'Привести чужих к порогу.', beats: ['Ольга хочет закрыть пункт.', 'Гриша считает фары.'], breather_scene: 'Чай.', ending_image: 'Срезанная петля замка.', world_tick: [], guns: [], irreversible: [] };
    const fp = beatFingerprint(sheet);
    expect(fp).toContain('фары');
    expect(fp).not.toContain('чай');
    expect(jaccardDistance(fp, fp)).toBe(0);
    expect(jaccardDistance(['a1234', 'b1234'], ['c1234'])).toBe(1);
    expect(jaccardDistance(['a1234', 'b1234'], ['b1234', 'c1234'])).toBeCloseTo(0.667, 2);
  });

  it('plans one brief under every storyteller, harshness and forced roll, judges each sheet and reports', async () => {
    const briefsDir = path.join(dir, 'briefs');
    await fs.mkdir(briefsDir);
    await fs.writeFile(
      path.join(briefsDir, 'mini.ru.md'),
      "---\nlanguage: ru\ntitle: Штрек\nidea: 'Грузовик ночью.'\nstorytellers: [cassandra, randy]\nharshness: [1, 6]\nrolls: [2, 20]\n---\nChapter one covers the night.\n",
    );
    const messages: string[] = [];
    const results = await runPlannerEvals({ adapter: new ReplayAdapter({ mode: 'replay', responder: scriptedResponder() }), resources, briefsDir, onProgress: (m) => messages.push(m) });
    // cassandra × 2 levels + randy × 2 levels × 2 rolls
    expect(results.cases).toHaveLength(6);
    expect(results.cases.filter((c) => c.storyteller === 'randy').map((c) => c.roll)).toEqual([2, 20, 2, 20]);
    expect(results.cases.every((c) => c.judgement !== undefined)).toBe(true);
    expect(results.cases.find((c) => c.storyteller === 'randy')?.judgement?.roll_obedience).toBe(4);
    expect(results.cases.find((c) => c.storyteller === 'cassandra')?.judgement?.roll_obedience).toBeNull();
    expect(results.summary.harshness_fit).toEqual({ 'harshness 1': 5, 'harshness 6': 4 });
    expect(results.summary.storyteller_fit).toEqual({ cassandra: 4, randy: 4 });
    expect(Object.keys(results.summary.harshness_distance)).toEqual(['mini.ru.md · cassandra · 1→6', 'mini.ru.md · randy · 1→6']);
    // The scripted planner ignores harshness, so the distance is 0: exactly what the metric must say.
    expect(results.summary.harshness_distance['mini.ru.md · cassandra · 1→6']).toBe(0);
    expect(messages).toHaveLength(6);
    const report = formatPlannerReport(results);
    expect(report).toContain('# Planner eval');
    expect(report).toContain('| mini.ru.md | randy | 6 | 20 |');
    expect(report).toContain('Harshness fit by level: harshness 1 5.00, harshness 6 4.00');
    const unjudged = await runPlannerEvals({ adapter: new ReplayAdapter({ mode: 'replay', responder: scriptedResponder() }), resources, briefsDir, judge: false });
    expect(unjudged.cases.every((c) => c.judgement === undefined)).toBe(true);
    expect(unjudged.summary.harshness_fit).toBeNull();
  });
});
