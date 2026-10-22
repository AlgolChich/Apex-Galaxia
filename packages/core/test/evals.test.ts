import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvalResultsSchema, formatEvalReport, improveHarness, loadPassages, resolveResources, runEvalSuite, type GenerateOptions, type Resources } from '@apex-galaxia/core';
import { ReplayAdapter } from '@apex-galaxia/adapters';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-evals-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function scripted(options: GenerateOptions): string {
  const user = options.messages[options.messages.length - 1]?.content ?? '';
  if (options.task === 'critic') {
    const clean = /Насос завёлся|ticket book said ten/.test(user);
    const s = clean ? 4 : 2;
    return JSON.stringify({ scores: { voice: s, subtext: s, rhythm: s, cliche: clean ? 5 : 1, ai_tell: clean ? 5 : 1, continuity: 4, language: 4 }, quotes: clean ? [] : [{ quote: 'x', issue: 'y', category: 'cliche', severity: 'high' }], verdict: clean ? 'pass' : 'reject' });
  }
  if (options.task === 'improve') {
    return JSON.stringify({ proposals: [{ file: 'prompts/contract.prose.md', rationale: 'cliche scores on the fault set', content: '---\ntask: contract.prose\ncontract_only: true\nkind: prose\nrole: prose\noutput: prose\n---\nOutput contract (variant): prose only; end with {{stop_marker}}.\n' }] });
  }
  return '{}';
}

describe('eval suite', () => {
  it('scores the fault set and a golden set with lint coverage and critic means', async () => {
    const golden = path.join(dir, 'golden');
    await fs.mkdir(golden);
    await fs.copyFile(path.join(repoRoot, 'samples', 'ru-mayak', 'chapters', '01-smena.md'), path.join(golden, 'smena.md'));
    await fs.writeFile(path.join(golden, 'smena.md'), (await fs.readFile(path.join(golden, 'smena.md'), 'utf8')).replace(/^---[\s\S]*?---\n/, '---\nlanguage: ru\nrating: 5\n---\n'));
    const adapter = new ReplayAdapter({ mode: 'replay', responder: scripted });
    const results = await runEvalSuite({ adapter, resources, goldenDir: golden });
    expect(results.summary.golden.count).toBe(1);
    expect(results.summary.fault.count).toBeGreaterThanOrEqual(4);
    expect(results.summary.fault.lintCoverage).toBe(1);
    expect(results.summary.golden.mean?.['cliche']).toBe(5);
    expect(results.summary.fault.mean?.['overall']).toBeLessThan(results.summary.golden.mean?.['overall'] ?? 0);
    expect(EvalResultsSchema.safeParse(results).success).toBe(true);
    const report = formatEvalReport(results);
    expect(report).toContain('| golden | 1 |');
    expect(report).toContain('100.0%');
    const lintOnly = await runEvalSuite({ adapter, resources, goldenDir: golden, critic: false });
    expect(lintOnly.summary.golden.mean).toBeNull();
    expect(lintOnly.summary.costUsd).toBe(0);
    expect((await loadPassages(path.join(repoRoot, 'evals', 'fault-set'), 'fault')).every((p) => p.text.length > 0)).toBe(true);
  });

  it('/improve proposes a variant, re-runs the suite and never touches the shipped files', async () => {
    const adapter = new ReplayAdapter({ mode: 'replay', responder: scripted });
    const before = await fs.readFile(path.join(repoRoot, 'prompts', 'contract.prose.md'), 'utf8');
    const outDir = path.join(dir, 'proposal');
    const outcome = await improveHarness({ adapter, resources, outDir });
    expect(outcome.proposals.proposals).toHaveLength(1);
    expect(await fs.readFile(path.join(outcome.variantDir, 'prompts', 'contract.prose.md'), 'utf8')).toContain('(variant)');
    expect(await fs.readFile(path.join(repoRoot, 'prompts', 'contract.prose.md'), 'utf8')).toBe(before);
    expect(outcome.report).toContain('Delta against shipped');
    expect(outcome.report).toContain('Proposed edits (not applied)');
    expect(await fs.readFile(outcome.reportFile, 'utf8')).toContain('contract.prose.md');
    expect(outcome.variant.variant.startsWith('proposal-')).toBe(true);
  });
});
