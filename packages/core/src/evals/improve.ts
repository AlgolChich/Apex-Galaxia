import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApexError } from '../util/errors.js';
import { isoNow } from '../util/fs.js';
import { createProject } from '../project/create.js';
import { ImproveProposalsSchema, type ImproveProposals } from '../project/schemas.js';
import { resolveResources, type Resources } from '../resources.js';
import type { ModelAdapter } from '../adapters/types.js';
import { Harness } from '../write/harness.js';
import { formatEvalReport, runEvalSuite, type EvalResults } from './runner.js';

/** Files /improve may propose to change: prompt templates and the house rules. */
export const IMPROVABLE = ['prompts/contract.prose.md', 'prompts/write.chapter.md', 'prompts/write.continue.md', 'prompts/critic.md', 'prompts/revise.md', 'prompts/lang/ru.md', 'prompts/lang/en.md', 'style/house-rules.md'];

export interface ImproveOptions {
  adapter: ModelAdapter;
  resources?: Resources;
  /** Where the proposal variant and its eval report are written. */
  outDir?: string;
  critic?: boolean;
  onProgress?: (message: string) => void;
}

export interface ImproveOutcome {
  baseline: EvalResults;
  proposals: ImproveProposals;
  /** A user-level directory holding the proposed files; pass it as a variant to apex eval. */
  variantDir: string;
  variant: EvalResults;
  report: string;
  reportFile: string;
}

/**
 * /improve (Section 6.7): run the suite, ask the planning model for at most three whole-file
 * edits to templates or rules, write them as a variant beside the shipped files, re-run the
 * suite with the variant, and present the delta. Nothing is applied; the Author merges.
 */
export async function improveHarness(options: ImproveOptions): Promise<ImproveOutcome> {
  const resources = options.resources ?? (await resolveResources());
  const progress = options.onProgress ?? (() => undefined);
  const critic = options.critic !== false;
  progress('eval: baseline');
  const baseline = await runEvalSuite({ adapter: options.adapter, resources, critic, onProgress: progress });

  const files: string[] = [];
  for (const rel of IMPROVABLE) {
    const text = await fs.readFile(path.join(resources.root, rel), 'utf8').catch(() => undefined);
    if (text) files.push(`=== ${rel} ===\n${text}`);
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-improve-'));
  let proposals: ImproveProposals;
  try {
    await createProject(path.join(scratch, 'p'), { title: 'improve', language: 'en', preset: 'fast' });
    const harness = await Harness.open(path.join(scratch, 'p'), { adapter: options.adapter, resources });
    progress('asking the planning model for proposals');
    const run = await harness.runTask<ImproveProposals>({ task: 'improve', vars: { eval_results: formatEvalReport(baseline), files: files.join('\n\n') } }, { maxTokens: 12_000 });
    if (!run.json) throw new ApexError('CONTRACT_VIOLATION', `No valid proposals: ${run.violations.join('; ')}`);
    proposals = ImproveProposalsSchema.parse(run.json);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  for (const p of proposals.proposals) {
    if (!IMPROVABLE.includes(p.file)) {
      throw new ApexError('CONTRACT_VIOLATION', `Proposal targets a file outside the allowed set: ${p.file}`, { file: p.file });
    }
  }

  const stamp = isoNow().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = options.outDir ?? path.join(resources.root, 'evals', 'proposals', stamp);
  const variantDir = path.join(outDir, 'variant');
  for (const p of proposals.proposals) {
    const target = path.join(variantDir, p.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, p.content.endsWith('\n') ? p.content : p.content + '\n', 'utf8');
  }
  progress(`variant written to ${variantDir}; eval: variant`);
  const variant = proposals.proposals.length > 0 ? await runEvalSuite({ adapter: options.adapter, resources, variantDir, variantName: `proposal-${stamp}`, critic, onProgress: progress }) : baseline;

  const report = [
    formatEvalReport(variant, baseline),
    '## Proposed edits (not applied)',
    '',
    ...proposals.proposals.map((p) => `- \`${p.file}\`: ${p.rationale} (see \`${path.relative(resources.root, path.join(variantDir, p.file))}\`)`),
    '',
    proposals.proposals.length === 0 ? 'The model proposed no edits.' : `Review the files under \`${path.relative(resources.root, variantDir)}\` and copy the ones you accept over the shipped files.`,
    '',
  ].join('\n');
  const reportFile = path.join(outDir, 'report.md');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(reportFile, report, 'utf8');
  await fs.writeFile(path.join(outDir, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(outDir, 'variant.json'), JSON.stringify(variant, null, 2) + '\n', 'utf8');
  return { baseline, proposals, variantDir, variant, report, reportFile };
}
