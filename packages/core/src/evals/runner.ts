import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { isoNow } from '../util/fs.js';
import { parseFrontMatter } from '../project/frontmatter.js';
import { createProject } from '../project/create.js';
import { CriticResultSchema, type CriticResult, type Language } from '../project/schemas.js';
import { resolveResources, type Resources } from '../resources.js';
import type { ModelAdapter } from '../adapters/types.js';
import { lintText, type LintReport } from '../lint/index.js';
import { loadStyleMemory } from '../style/memory.js';
import { Harness } from '../write/harness.js';

/**
 * The eval suite (Section 6.5): a golden set the Author rated highly, a fault set with named
 * faults, and prompt-variant runs scored by the critic on both. Scores are a smoke alarm,
 * not a verdict.
 */
const PassageFrontSchema = z.object({
  language: z.enum(['ru', 'en']),
  title: z.string().optional(),
  expect: z.array(z.string()).default([]),
  forbid: z.array(z.string()).default([]),
  rating: z.number().int().min(1).max(5).optional(),
  note: z.string().optional(),
});

export interface EvalPassage {
  set: 'golden' | 'fault';
  file: string;
  language: Language;
  text: string;
  expect: string[];
  forbid: string[];
}

export const EvalResultsSchema = z.object({
  ran_at: z.string(),
  variant: z.string(),
  models: z.record(z.string(), z.string()),
  passages: z.array(
    z.object({
      set: z.enum(['golden', 'fault']),
      file: z.string(),
      language: z.enum(['ru', 'en']),
      lint: z.object({ error: z.number(), warning: z.number(), info: z.number(), missed: z.array(z.string()), unexpected: z.array(z.string()) }),
      critic: CriticResultSchema.optional(),
      costUsd: z.number(),
    }),
  ),
  summary: z.object({
    golden: z.object({ count: z.number(), mean: z.record(z.string(), z.number()).nullable() }),
    fault: z.object({ count: z.number(), mean: z.record(z.string(), z.number()).nullable(), lintCoverage: z.number() }),
    /** Pairwise A/B choices from a project's history/ab.jsonl: how often the Author agreed with the critic's ranking. */
    ab: z.object({ count: z.number(), judged: z.number(), critic_agreement: z.number().nullable() }).optional(),
    costUsd: z.number(),
  }),
});
export type EvalResults = z.infer<typeof EvalResultsSchema>;
export type EvalPassageResult = EvalResults['passages'][number];

export async function loadPassages(dir: string, set: 'golden' | 'fault'): Promise<EvalPassage[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: EvalPassage[] = [];
  for (const name of names.filter((n) => n.endsWith('.md') && n !== 'README.md').sort()) {
    const file = path.join(dir, name);
    const doc = parseFrontMatter(await fs.readFile(file, 'utf8'), file);
    const front = PassageFrontSchema.safeParse(doc.data);
    if (!front.success) continue;
    out.push({ set, file, language: front.data.language, text: doc.body.trim(), expect: front.data.expect, forbid: front.data.forbid });
  }
  return out;
}

function meanScores(results: EvalPassageResult[]): Record<string, number> | null {
  const withCritic = results.filter((r) => r.critic);
  if (withCritic.length === 0) return null;
  const keys = Object.keys(withCritic[0]!.critic!.scores) as Array<keyof CriticResult['scores']>;
  const mean: Record<string, number> = {};
  for (const key of keys) {
    mean[key] = Math.round((withCritic.reduce((sum, r) => sum + r.critic!.scores[key], 0) / withCritic.length) * 100) / 100;
  }
  mean['overall'] = Math.round((Object.values(mean).reduce((a, b) => a + b, 0) / keys.length) * 100) / 100;
  return mean;
}

export interface RunEvalOptions {
  adapter: ModelAdapter;
  resources?: Resources;
  goldenDir?: string;
  faultDir?: string;
  /** A user-level directory whose prompts/ and style/ override the shipped ones (a prompt variant). */
  variantDir?: string;
  variantName?: string;
  /** Skip the critic (lint only), e.g. without a key. */
  critic?: boolean;
  /** A project's history/ab.jsonl: the Author's pairwise choices join the record. */
  abFile?: string;
  onProgress?: (message: string) => void;
}

/** Summarize an A/B file: how many choices, how many had a critic opinion, how often they agreed. */
export async function summarizeAb(file: string): Promise<{ count: number; judged: number; critic_agreement: number | null }> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const records = text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { agreed?: boolean | null });
  const judged = records.filter((r) => r.agreed === true || r.agreed === false);
  const agreed = judged.filter((r) => r.agreed === true).length;
  return { count: records.length, judged: judged.length, critic_agreement: judged.length > 0 ? Math.round((agreed / judged.length) * 1000) / 1000 : null };
}

/**
 * Run the suite. Each passage is scored in a scratch project of its language (so the critic
 * sees the right language module and rubric); the lint pass is deterministic and free.
 */
export async function runEvalSuite(options: RunEvalOptions): Promise<EvalResults> {
  const baseResources = options.resources ?? (await resolveResources());
  const resources: Resources = options.variantDir ? { root: baseResources.root, userDir: path.resolve(options.variantDir) } : baseResources;
  const goldenDir = options.goldenDir ?? path.join(resources.root, 'evals', 'golden');
  const faultDir = options.faultDir ?? path.join(resources.root, 'evals', 'fault-set');
  const passages = [...(await loadPassages(goldenDir, 'golden')), ...(await loadPassages(faultDir, 'fault'))];
  const progress = options.onProgress ?? (() => undefined);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-eval-'));
  const harnesses = new Map<Language, Harness>();
  const models: Record<string, string> = {};
  const results: EvalPassageResult[] = [];
  try {
    for (const passage of passages) {
      let harness = harnesses.get(passage.language);
      if (!harness) {
        const root = path.join(scratch, passage.language);
        await createProject(root, { title: `eval-${passage.language}`, language: passage.language, preset: 'fast' });
        harness = await Harness.open(root, { adapter: options.adapter, resources });
        harnesses.set(passage.language, harness);
        Object.assign(models, harness.store.config.models);
      }
      const style = await loadStyleMemory(harness.store, resources);
      const report: LintReport = lintText(passage.text, { language: passage.language, banned: style.banned, whitelist: style.whitelist });
      const fired = new Set(report.hits.map((h) => h.rule));
      const lint = {
        error: report.counts.error,
        warning: report.counts.warning,
        info: report.counts.info,
        missed: passage.expect.filter((r) => !fired.has(r)),
        unexpected: passage.forbid.filter((r) => fired.has(r)),
      };
      let critic: CriticResult | undefined;
      let costUsd = 0;
      if (options.critic !== false) {
        const { result, run } = await harness.critique(passage.text);
        critic = result;
        costUsd = run.result.costUsd;
      }
      results.push({ set: passage.set, file: path.relative(resources.root, passage.file), language: passage.language, lint, ...(critic ? { critic } : {}), costUsd });
      progress(`${passage.set}/${path.basename(passage.file)}: lint ${lint.error}e/${lint.warning}w${lint.missed.length ? ` missed ${lint.missed.join(',')}` : ''}${critic ? ` · critic ${critic.verdict}` : ''}`);
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  const golden = results.filter((r) => r.set === 'golden');
  const fault = results.filter((r) => r.set === 'fault');
  const expectedTotal = passages.filter((p) => p.set === 'fault').reduce((n, p) => n + p.expect.length, 0);
  const missedTotal = fault.reduce((n, r) => n + r.lint.missed.length, 0);
  const ab = options.abFile ? await summarizeAb(options.abFile) : undefined;
  return {
    ran_at: isoNow(),
    variant: options.variantName ?? (options.variantDir ? path.basename(options.variantDir) : 'shipped'),
    models,
    passages: results,
    summary: {
      golden: { count: golden.length, mean: meanScores(golden) },
      fault: { count: fault.length, mean: meanScores(fault), lintCoverage: expectedTotal === 0 ? 1 : Math.round(((expectedTotal - missedTotal) / expectedTotal) * 1000) / 1000 },
      ...(ab ? { ab } : {}),
      costUsd: Math.round(results.reduce((s, r) => s + r.costUsd, 0) * 1e6) / 1e6,
    },
  };
}

function fmtMean(mean: Record<string, number> | null): string {
  if (!mean) return '(no critic)';
  return Object.entries(mean)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(', ');
}

function delta(a: Record<string, number> | null, b: Record<string, number> | null): string {
  if (!a || !b) return '';
  return Object.keys(a)
    .map((k) => {
      const d = (a[k] ?? 0) - (b[k] ?? 0);
      return `${k} ${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
    })
    .join(', ');
}

/** The Markdown written to docs/evals/ with dates and model versions; a baseline adds deltas. */
export function formatEvalReport(results: EvalResults, baseline?: EvalResults): string {
  const lines = [
    `# Eval run ${results.ran_at.slice(0, 10)} · variant ${results.variant}`,
    '',
    `Ran at ${results.ran_at}. Models: ${Object.entries(results.models).map(([k, v]) => `${k} ${v}`).join(', ')}. Cost $${results.summary.costUsd.toFixed(4)}.`,
    '',
    '| Set | Passages | Critic mean | Lint coverage |',
    '| --- | --- | --- | --- |',
    `| golden | ${results.summary.golden.count} | ${fmtMean(results.summary.golden.mean)} | — |`,
    `| fault | ${results.summary.fault.count} | ${fmtMean(results.summary.fault.mean)} | ${(results.summary.fault.lintCoverage * 100).toFixed(1)}% |`,
    '',
  ];
  if (results.summary.ab) {
    const ab = results.summary.ab;
    lines.push(`Pairwise A/B: ${ab.count} choice(s) by the Author, ${ab.judged} with a critic opinion, critic agreement ${ab.critic_agreement === null ? '—' : `${(ab.critic_agreement * 100).toFixed(0)}%`}.`, '');
  }
  if (baseline) {
    lines.push(`Delta against ${baseline.variant} (${baseline.ran_at.slice(0, 10)}): golden ${delta(results.summary.golden.mean, baseline.summary.golden.mean) || '—'}; fault ${delta(results.summary.fault.mean, baseline.summary.fault.mean) || '—'}; lint coverage ${((results.summary.fault.lintCoverage - baseline.summary.fault.lintCoverage) * 100).toFixed(1)} pp.`, '');
  }
  lines.push('| Passage | Lint | Missed | Critic |', '| --- | --- | --- | --- |');
  for (const p of results.passages) {
    lines.push(`| ${p.set}/${path.basename(p.file)} | ${p.lint.error}e ${p.lint.warning}w ${p.lint.info}i | ${p.lint.missed.join(', ') || '—'}${p.lint.unexpected.length ? ` (unexpected: ${p.lint.unexpected.join(', ')})` : ''} | ${p.critic ? `${p.critic.verdict} (${Object.values(p.critic.scores).join('/')})` : '—'} |`);
  }
  lines.push('', 'Scores are a smoke alarm, not a verdict: the Author\'s judgment wins.', '');
  return lines.join('\n');
}
