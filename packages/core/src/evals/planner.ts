import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { isoNow } from '../util/fs.js';
import { parseFrontMatter } from '../project/frontmatter.js';
import { createProject } from '../project/create.js';
import { PlannerJudgementSchema, type BeatSheet, type PlannerJudgement, type Roll } from '../project/schemas.js';
import { OUTCOME_TEXT } from '../narrator/dice.js';
import { renderPlannerRules } from '../narrator/profile.js';
import { resolveResources, type Resources } from '../resources.js';
import type { ModelAdapter } from '../adapters/types.js';
import { Harness, renderBeatSheet } from '../write/harness.js';

/**
 * Planner evals (Phase 4 acceptance): the same brief planned under every harshness level and
 * storyteller, with forced d20 results for Randy. Two kinds of evidence: a judge model scores
 * harshness fit, storyteller fit and roll obedience; a deterministic distance between the beat
 * sheets of harshness 1 and 6 says whether the level changed the plan at all, model or not.
 */
const BriefFrontSchema = z.object({
  language: z.enum(['ru', 'en']),
  title: z.string(),
  universe: z.string().optional(),
  leads: z.string().optional(),
  idea: z.string().optional(),
  genre_tone: z.string().optional(),
  storytellers: z.array(z.enum(['cassandra', 'phoebe', 'randy'])).default(['cassandra', 'randy']),
  harshness: z.array(z.number().int().min(1).max(6)).default([1, 3, 6]),
  /** d20 results to force for Randy; one case per result. */
  rolls: z.array(z.number().int().min(1).max(20)).default([2, 10, 16, 20]),
});

export interface PlannerBrief extends z.infer<typeof BriefFrontSchema> {
  file: string;
  body: string;
}

export const PlannerEvalResultsSchema = z.object({
  ran_at: z.string(),
  models: z.record(z.string(), z.string()),
  judged: z.boolean(),
  cases: z.array(
    z.object({
      brief: z.string(),
      language: z.enum(['ru', 'en']),
      storyteller: z.enum(['cassandra', 'phoebe', 'randy']),
      harshness: z.number().int(),
      roll: z.number().int().optional(),
      title: z.string(),
      beats: z.number().int(),
      irreversible: z.number().int(),
      fingerprint: z.array(z.string()),
      judgement: PlannerJudgementSchema.optional(),
      costUsd: z.number(),
    }),
  ),
  summary: z.object({
    harshness_fit: z.record(z.string(), z.number()).nullable(),
    storyteller_fit: z.record(z.string(), z.number()).nullable(),
    roll_obedience: z.record(z.string(), z.number()).nullable(),
    /** 0 = the beats are the same words at harshness 1 and 6; 1 = nothing in common. Per brief and storyteller. */
    harshness_distance: z.record(z.string(), z.number()),
    costUsd: z.number(),
  }),
});
export type PlannerEvalResults = z.infer<typeof PlannerEvalResultsSchema>;
export type PlannerCase = PlannerEvalResults['cases'][number];

export async function loadPlannerBriefs(dir: string): Promise<PlannerBrief[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: PlannerBrief[] = [];
  for (const name of names.filter((n) => n.endsWith('.md') && n !== 'README.md').sort()) {
    const file = path.join(dir, name);
    const doc = parseFrontMatter(await fs.readFile(file, 'utf8'), file);
    const front = BriefFrontSchema.safeParse(doc.data);
    if (!front.success) continue;
    out.push({ ...front.data, file, body: doc.body.trim() });
  }
  return out;
}

/** The words that carry the plan: beats, goal and ending image, lowercased, without the short ones. */
export function beatFingerprint(sheet: BeatSheet): string[] {
  const text = [sheet.goal, ...sheet.beats, sheet.ending_image, sheet.cliffhanger ?? ''].join(' ').toLowerCase();
  const set = new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
  return [...set].sort();
}

export function jaccardDistance(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common += 1;
  const union = sa.size + sb.size - common;
  return union === 0 ? 0 : Math.round((1 - common / union) * 1000) / 1000;
}

export interface RunPlannerEvalOptions {
  adapter: ModelAdapter;
  resources?: Resources;
  briefsDir?: string;
  /** Ask the critic model to judge each beat sheet (needs a model); the distance metric runs regardless. */
  judge?: boolean;
  onProgress?: (message: string) => void;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function groupMeans(cases: PlannerCase[], key: (c: PlannerCase) => string, pick: (j: PlannerJudgement) => number | null | undefined): Record<string, number> | null {
  const groups = new Map<string, number[]>();
  for (const c of cases) {
    const value = c.judgement ? pick(c.judgement) : undefined;
    if (value === undefined || value === null) continue;
    const k = key(c);
    groups.set(k, [...(groups.get(k) ?? []), value]);
  }
  if (groups.size === 0) return null;
  const out: Record<string, number> = {};
  for (const [k, values] of [...groups.entries()].sort()) out[k] = mean(values)!;
  return out;
}

export async function runPlannerEvals(options: RunPlannerEvalOptions): Promise<PlannerEvalResults> {
  const resources = options.resources ?? (await resolveResources());
  const briefs = await loadPlannerBriefs(options.briefsDir ?? path.join(resources.root, 'evals', 'planner'));
  const progress = options.onProgress ?? (() => undefined);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-planner-eval-'));
  const cases: PlannerCase[] = [];
  const models: Record<string, string> = {};
  let n = 0;
  try {
    for (const brief of briefs) {
      for (const storyteller of brief.storytellers) {
        for (const harshness of brief.harshness) {
          const rolls: Array<number | undefined> = storyteller === 'randy' ? brief.rolls : [undefined];
          for (const roll of rolls) {
            n += 1;
            const root = path.join(scratch, `case-${n}`);
            await createProject(root, {
              title: brief.title,
              language: brief.language,
              storyteller,
              harshness,
              preset: 'fast',
              ...(brief.universe ? { universe: brief.universe } : {}),
              ...(brief.leads ? { leads: brief.leads } : {}),
              ...(brief.idea ? { idea: brief.idea } : {}),
              ...(brief.genre_tone ? { genreTone: brief.genre_tone } : {}),
            });
            // A forced d20: rollD20 maps rng() in [0, 1) onto 1–20, so (r - 1) / 20 lands on r.
            const harness = await Harness.open(root, { adapter: options.adapter, resources, ...(roll !== undefined ? { rng: () => (roll - 1) / 20 } : {}) });
            Object.assign(models, harness.store.config.models);
            const planned = await harness.planChapter(1, { hint: brief.body });
            let costUsd = planned.run.result.costUsd;
            let judgement: PlannerJudgement | undefined;
            if (options.judge !== false) {
              const forced: Roll | undefined = planned.roll;
              const run = await harness.runTask<PlannerJudgement>({
                task: 'eval.planner',
                plannerView: true,
                ...(forced ? { latestRoll: forced } : {}),
                vars: {
                  beat_sheet: renderBeatSheet(planned.sheet),
                  planner_rules: renderPlannerRules(harness.narrator, harness.store.config, forced),
                  harshness_level: String(harshness),
                  roll_text: forced ? `The d20 rolled ${forced.result}: ${OUTCOME_TEXT[forced.outcome].en}.` : 'No d20 was rolled for this chapter.',
                },
              });
              costUsd += run.result.costUsd;
              if (run.json) judgement = PlannerJudgementSchema.parse(run.json);
            }
            cases.push({
              brief: path.basename(brief.file),
              language: brief.language,
              storyteller,
              harshness,
              ...(roll !== undefined ? { roll } : {}),
              title: planned.sheet.title,
              beats: planned.sheet.beats.length,
              irreversible: planned.sheet.irreversible.length,
              fingerprint: beatFingerprint(planned.sheet),
              ...(judgement ? { judgement } : {}),
              costUsd,
            });
            progress(`${path.basename(brief.file)} · ${storyteller} · harshness ${harshness}${roll !== undefined ? ` · d20 ${roll}` : ''}: ${planned.sheet.beats.length} beats${judgement ? ` · fit ${judgement.harshness_fit}/${judgement.storyteller_fit}${judgement.roll_obedience !== null ? `/${judgement.roll_obedience}` : ''}` : ''}`);
          }
        }
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  const distance: Record<string, number> = {};
  for (const brief of briefs) {
    for (const storyteller of brief.storytellers) {
      const levels = [...brief.harshness].sort((a, b) => a - b);
      const low = cases.find((c) => c.brief === path.basename(brief.file) && c.storyteller === storyteller && c.harshness === levels[0] && (c.roll === undefined || c.roll === brief.rolls[0]));
      const high = cases.find((c) => c.brief === path.basename(brief.file) && c.storyteller === storyteller && c.harshness === levels[levels.length - 1] && (c.roll === undefined || c.roll === brief.rolls[0]));
      if (low && high && levels.length > 1) distance[`${path.basename(brief.file)} · ${storyteller} · ${levels[0]}→${levels[levels.length - 1]}`] = jaccardDistance(low.fingerprint, high.fingerprint);
    }
  }
  return {
    ran_at: isoNow(),
    models,
    judged: options.judge !== false,
    cases,
    summary: {
      harshness_fit: groupMeans(cases, (c) => `harshness ${c.harshness}`, (j) => j.harshness_fit),
      storyteller_fit: groupMeans(cases, (c) => c.storyteller, (j) => j.storyteller_fit),
      roll_obedience: groupMeans(cases, (c) => (c.roll !== undefined ? `d20 ${c.roll}` : 'no roll'), (j) => j.roll_obedience),
      harshness_distance: distance,
      costUsd: Math.round(cases.reduce((s, c) => s + c.costUsd, 0) * 1e6) / 1e6,
    },
  };
}

function fmtRecord(record: Record<string, number> | null): string {
  if (!record) return '(not judged)';
  return Object.entries(record)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(', ');
}

export function formatPlannerReport(results: PlannerEvalResults): string {
  const lines = [
    `# Planner eval ${results.ran_at.slice(0, 10)}`,
    '',
    `Ran at ${results.ran_at}. Models: ${Object.entries(results.models).map(([k, v]) => `${k} ${v}`).join(', ')}. Judged by the critic model: ${results.judged ? 'yes' : 'no'}. Cost $${results.summary.costUsd.toFixed(4)}.`,
    '',
    `- Harshness fit by level: ${fmtRecord(results.summary.harshness_fit)}`,
    `- Storyteller fit: ${fmtRecord(results.summary.storyteller_fit)}`,
    `- Roll obedience: ${fmtRecord(results.summary.roll_obedience)}`,
    `- Distance between the beats of the lowest and the highest harshness (0 = same words, 1 = nothing shared): ${Object.entries(results.summary.harshness_distance).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('; ') || '—'}`,
    '',
    '| Brief | Storyteller | Harshness | d20 | Beats | Irreversible | Fit (harshness / storyteller / roll) | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const c of results.cases) {
    const j = c.judgement;
    lines.push(`| ${c.brief} | ${c.storyteller} | ${c.harshness} | ${c.roll ?? '—'} | ${c.beats} | ${c.irreversible} | ${j ? `${j.harshness_fit} / ${j.storyteller_fit} / ${j.roll_obedience ?? '—'}${j.irreversible_ok ? '' : ' (irreversible unlisted)'}` : '—'} | ${j?.notes?.replace(/\|/g, '/') ?? ''} |`);
  }
  lines.push('', 'Scores are a smoke alarm, not a verdict: the distance line is deterministic; the fit scores are one model judging another.');
  return lines.join('\n') + '\n';
}
