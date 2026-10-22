import type { CriticResult, Preset, ProjectConfig } from '../project/schemas.js';

/** Resolved Muse Layer settings for a project (Section 4.6). */
export interface MuseSettings {
  critic: boolean;
  maxRevisions: number;
  minScore: number;
}

export const PRESETS: Record<Preset, MuseSettings> = {
  fast: { critic: false, maxRevisions: 0, minScore: 1 },
  balanced: { critic: true, maxRevisions: 1, minScore: 4 },
  best: { critic: true, maxRevisions: 2, minScore: 4 },
};

export function museSettings(config: ProjectConfig): MuseSettings {
  const base = PRESETS[config.preset];
  return {
    critic: config.muse?.critic ?? base.critic,
    maxRevisions: config.muse?.max_revisions ?? base.maxRevisions,
    minScore: config.muse?.min_score ?? base.minScore,
  };
}

export interface MuseStage {
  stage: 'draft' | 'critic' | 'revise';
  model: string;
  costUsd: number;
  verdict?: CriticResult['verdict'];
  scores?: CriticResult['scores'];
  quotes?: number;
  note?: string;
}

export function worstScore(result: CriticResult): number {
  return Math.min(...Object.values(result.scores));
}

/** The findings block the revision prompt receives: only quoted spans, nothing else may change. */
export function formatFindings(result: CriticResult): string {
  return result.quotes.map((q, i) => `${i + 1}. [${q.severity}/${q.category}] «${q.quote}» — ${q.issue}`).join('\n') || '(no quotes)';
}

export function describeStages(stages: MuseStage[]): string {
  return stages
    .map((s) => {
      if (s.stage === 'critic') return `critic: ${s.verdict} (${s.scores ? Object.entries(s.scores).map(([k, v]) => `${k} ${v}`).join(', ') : ''})`;
      return `${s.stage}: ${s.model}`;
    })
    .join(' → ');
}
