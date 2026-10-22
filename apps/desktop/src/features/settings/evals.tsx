import { useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { messageOf } from '../wizard/narrator-options.js';

type EvalKind = 'lint' | 'planner';

interface Report {
  kind: EvalKind;
  text: string;
  models?: Record<string, string>;
  costUsd?: number;
}

interface AbSummary {
  count: number;
  judged: number;
  critic_agreement: number | null;
}

/** Both eval results carry the models and the cost in the same place; the rest is in the report. */
function metaOf(results: unknown): Pick<Report, 'models' | 'costUsd'> {
  const r = results as { models?: unknown; summary?: { costUsd?: unknown } } | undefined;
  const models = r?.models && typeof r.models === 'object' ? (r.models as Record<string, string>) : undefined;
  const cost = r?.summary?.costUsd;
  return { ...(models ? { models } : {}), ...(typeof cost === 'number' ? { costUsd: cost } : {}) };
}

/**
 * Settings → Evals: the linter eval (`eval_run {critic}`) and the planner eval
 * (`eval_run {planner: true, critic}`) with the Markdown report in a monospace block, the
 * critic's judgement only when a model is configured, and the open project's A/B record.
 */
export function EvalsSection() {
  const t = useT();
  const model = useStore((s) => s.connection.model);
  const root = useStore((s) => s.project.root);
  const toast = useStore((s) => s.toast);
  const client = getClient();

  const [judge, setJudge] = useState(false);
  const [busy, setBusy] = useState<EvalKind | undefined>(undefined);
  const [report, setReport] = useState<Report | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ab, setAb] = useState<AbSummary | undefined>(undefined);
  const [abError, setAbError] = useState<string | undefined>(undefined);

  const canJudge = Boolean(model?.has_model);
  const judged = judge && canJudge;

  useEffect(() => {
    if (!root) {
      setAb(undefined);
      setAbError(undefined);
      return;
    }
    let live = true;
    client.abList().then(
      (result) => {
        if (!live) return;
        setAb({ count: result.count, judged: result.judged, critic_agreement: result.critic_agreement });
        setAbError(undefined);
      },
      (failure: unknown) => {
        if (live) setAbError(messageOf(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [client, root]);

  const run = async (kind: EvalKind) => {
    if (busy) return;
    setBusy(kind);
    setError(undefined);
    try {
      const result = kind === 'lint' ? await client.evalRun({ critic: judged }) : await client.plannerEvals(judged);
      setReport({ kind, text: result.report, ...metaOf(result.results) });
    } catch (failure) {
      const text = messageOf(failure);
      setError(text);
      toast('error', text);
    } finally {
      setBusy(undefined);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      toast('success', t('settings.evals.copied'));
    } catch {
      toast('error', t('settings.evals.copyFailed'));
    }
  };

  const agreement = ab?.critic_agreement === null || ab?.critic_agreement === undefined ? '—' : `${Math.round(ab.critic_agreement * 100)}%`;

  return (
    <section className="view__section" aria-labelledby="settings-evals-title">
      <h2 id="settings-evals-title">{t('settings.evals')}</h2>
      <div className="view__hint">{t('settings.evalsHint')}</div>
      <div className="settings__group">
        <label className="check" htmlFor="settings-evals-judge">
          <input id="settings-evals-judge" type="checkbox" checked={judged} disabled={!canJudge || Boolean(busy)} onChange={(e) => setJudge(e.target.checked)} />
          <span className="check__text">
            <span>{t('settings.evals.judge')}</span>
            <span className="field__hint">{canJudge ? t('settings.evals.judgeHint') : t('settings.evals.judgeNoModel')}</span>
          </span>
        </label>
        <div className="evals__actions">
          <button type="button" className="btn" onClick={() => void run('lint')} disabled={Boolean(busy)} aria-describedby="settings-evals-lint-hint">
            {busy === 'lint' ? t('settings.evals.running') : t('settings.evals.lint')}
          </button>
          <span className="field__hint" id="settings-evals-lint-hint">
            {t('settings.evals.lintHint')}
          </span>
          <button type="button" className="btn" onClick={() => void run('planner')} disabled={Boolean(busy)} aria-describedby="settings-evals-planner-hint">
            {busy === 'planner' ? t('settings.evals.running') : judged ? t('settings.evals.plannerJudged') : t('settings.evals.planner')}
          </button>
          <span className="field__hint" id="settings-evals-planner-hint">
            {t('settings.evals.plannerHint')}
          </span>
        </div>
        {error ? (
          <div className="view__error" role="alert">
            {error}
          </div>
        ) : null}
        {report ? (
          <div className="evals__report">
            <div className="row">
              <strong>{t('settings.evals.report')}</strong>
              {report.models ? (
                <span className="small muted">
                  {t('settings.evals.reportMeta', { models: [...new Set(Object.values(report.models))].join(', ') || '—', usd: (report.costUsd ?? 0).toFixed(4) })}
                  {model?.scripted ? ` (${t('app.model.scripted')})` : ''}
                </span>
              ) : null}
              <span className="grow" />
              <button type="button" className="btn" onClick={() => void copy()}>
                {t('common.copy')}
              </button>
            </div>
            <pre className="evals__pre" tabIndex={0} aria-label={t('settings.evals.report')}>
              {report.text}
            </pre>
          </div>
        ) : null}
      </div>
      <div className="settings__group">
        <h3>{t('settings.evals.ab')}</h3>
        <div className="view__hint">{t('settings.evals.abHint')}</div>
        {!root ? (
          <div className="muted small">{t('settings.evals.abNoProject')}</div>
        ) : abError ? (
          <div className="view__error small">{abError}</div>
        ) : !ab ? (
          <div className="muted small">{t('common.working')}</div>
        ) : ab.count === 0 ? (
          <div className="muted small">{t('settings.evals.abNone')}</div>
        ) : (
          <div>{t('settings.evals.abLine', { count: ab.count, judged: ab.judged, agreement })}</div>
        )}
      </div>
      <div className="small muted">{t('settings.evals.cli')}</div>
    </section>
  );
}
