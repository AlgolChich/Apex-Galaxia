import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { RunState } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Field, hintId } from '../wizard/field.js';
import { ViewFrame, messageOf } from './frame.js';
import { useRunStore, type PendingDecision } from './run-store.js';

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** `plan/beats/<nn>.json`, the file the Author edits to change the choices instead of approving them. */
function beatsFile(chapter: number): string {
  return `plan/beats/${String(chapter).padStart(2, '0')}.json`;
}

interface StartOptions {
  chapters?: number;
  resume?: string;
  approve_outline?: boolean;
  approve_decision?: boolean;
  reader_report?: boolean;
}

/**
 * The ASK gate (Section 5.9): the run stopped before writing a chapter whose beat sheet
 * lists choices the story cannot take back. The Author approves and the run continues,
 * goes to the plan to edit the beat sheet (and resumes without approval), or leaves the run
 * paused where it is.
 */
function DecisionCard({ decision, busy, onApprove, onEdit, onStop }: { decision: PendingDecision; busy: boolean; onApprove: () => void; onEdit: () => void; onStop: () => void }) {
  const t = useT();
  const titleId = `run-decision-${decision.chapter}`;
  return (
    <section className="card stack run-decision" role="region" aria-labelledby={titleId} data-testid="run-decision">
      <h2 id={titleId} className="run-decision__title">
        {t('views.run.decision.title', { n: decision.chapter })}
      </h2>
      <div className="view__hint">{t('views.run.decision.hint', { file: beatsFile(decision.chapter) })}</div>
      <ul className="plain-list run-decision__items" aria-label={t('views.run.decision.items')}>
        {decision.items.map((item, index) => (
          <li key={index}>
            <strong>{item.who}</strong>: {item.what}
          </li>
        ))}
      </ul>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--primary" onClick={onApprove} disabled={busy} data-autofocus>
          {t('views.run.decision.approve')}
        </button>
        <button type="button" className="btn" onClick={onEdit} disabled={busy}>
          {t('views.run.decision.edit')}
        </button>
        <span className="grow" />
        <button type="button" className="btn btn--ghost" onClick={onStop} disabled={busy}>
          {t('views.run.decision.stop')}
        </button>
      </div>
    </section>
  );
}

/**
 * The autonomous mode screen (Section 11.4): a start form, the saved runs with Resume and
 * Approve outline, and the live run with status, stage, chapter N of M, cost so far, the log,
 * the streaming text and Pause. Run events arrive as MCP logging notifications while the
 * view is mounted; the final event refreshes the run list and the project chapters. A run
 * waiting at the ASK gate shows the decision card on top.
 */
export function RunView() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const setView = useStore((s) => s.setView);
  const config = useStore((s) => s.project.config);
  const model = useStore((s) => s.connection.model);
  const reloadChapters = useStore((s) => s.reloadChapters);
  const runs = useRunStore((s) => s.runs);
  const live = useRunStore((s) => s.live);
  const setRuns = useRunStore((s) => s.setRuns);
  const watch = useRunStore((s) => s.watch);
  const applyEvent = useRunStore((s) => s.applyEvent);
  const setPausing = useRunStore((s) => s.setPausing);
  const dismissDecision = useRunStore((s) => s.dismissDecision);
  const reopenDecision = useRunStore((s) => s.reopenDecision);
  const client = getClient();
  const [chapters, setChapters] = useState('1');
  const [readerReport, setReaderReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const result = await client.runList();
      setRuns(result.runs);
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [client, setRuns]);

  useEffect(() => {
    void refresh();
    return client.onRunEvent((event) => {
      applyEvent(event);
      if (event.final) {
        // Sequential on purpose: project_open swaps the server's harness, and run_list must not race it.
        void reloadChapters()
          .catch(() => undefined)
          .then(() => refresh());
      }
    });
  }, [client, applyEvent, refresh, reloadChapters]);

  const start = async (options: StartOptions) => {
    if (busy) return;
    setBusy(true);
    try {
      const started = await client.runStart(options);
      watch(started.state);
      await refresh();
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const onStart = () => {
    const n = Number.parseInt(chapters, 10);
    void start({ ...(Number.isFinite(n) && n > 0 ? { chapters: n } : {}), reader_report: readerReport });
  };

  const pause = async (id: string) => {
    try {
      await client.runPause(id);
      setPausing(id);
    } catch (failure) {
      toast('error', messageOf(failure));
    }
  };

  const show = async (run: RunState) => {
    try {
      const result = await client.runGet(run.id);
      watch(result.state);
    } catch (failure) {
      toast('error', messageOf(failure));
    }
  };

  const approveDecision = (id: string) => void start({ resume: id, approve_decision: true, reader_report: readerReport });

  const editPlan = (decision: PendingDecision) => {
    toast('info', t('views.run.decision.editToast', { file: beatsFile(decision.chapter) }));
    setView('plan');
  };

  const statusLabel = (status: RunState['status'] | undefined) => (status ? t(`views.run.status.${status}`) : '—');
  const stageLabel = (stage: RunState['stage'] | undefined) => (stage ? t(`views.run.stage.${stage}`) : '—');
  const cost = (usd: number | undefined) => t('views.run.cost', { usd: (usd ?? 0).toFixed(3) });
  const running = live?.status === 'running' && !live.final;
  const awaiting = live?.status === 'awaiting_decision' && live.pendingDecision ? live.pendingDecision : undefined;
  // The server's final event also closes a run that stopped at a gate; a gate is a pause, not a finish.
  const atGate = live?.status === 'awaiting_decision' || live?.status === 'awaiting_outline_approval';

  const actions = (
    <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>
      {t('views.reload')}
    </button>
  );

  return (
    <ViewFrame id="run" title={t('views.run.title')} actions={actions}>
      <div className="view__hint">{t('views.run.hint')}</div>
      {error ? (
        <div className="view__error" role="alert">
          {error}
        </div>
      ) : null}
      {!model?.has_model ? <div className="view__warning small">{t('views.run.noModel')}</div> : null}

      {live && awaiting && live.decisionOpen ? <DecisionCard decision={awaiting} busy={busy} onApprove={() => approveDecision(live.id)} onEdit={() => editPlan(awaiting)} onStop={() => dismissDecision(live.id)} /> : null}

      <form
        className="card run-form"
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
        aria-label={t('views.run.start')}
      >
        <Field id="run-chapters" label={t('views.run.chapters')} hint={t('views.run.chaptersHint')}>
          <input id="run-chapters" className="input" type="number" min={1} max={40} value={chapters} onChange={(e) => setChapters(e.target.value)} aria-describedby={hintId('run-chapters')} />
        </Field>
        <label className="check" htmlFor="run-report">
          <input id="run-report" type="checkbox" checked={readerReport} onChange={(e) => setReaderReport(e.target.checked)} />
          <span className="check__text">
            <span>{t('views.run.readerReport')}</span>
            <span className="field__hint">{t('views.run.readerReportHint')}</span>
          </span>
        </label>
        <div className="stack" style={{ gap: '0.3rem' }}>
          <span className="small">{t('views.run.preset', { preset: config?.preset ?? '—' })}</span>
          <span className="field__hint">{t('views.run.costNote')}</span>
          <div>
            <button type="submit" className="btn btn--primary" disabled={busy || running || !model?.has_model}>
              {busy ? t('views.run.starting') : t('views.run.start')}
            </button>
          </div>
        </div>
      </form>

      {live ? (
        <section className="view__section run-live" aria-labelledby="run-live-title" aria-live="polite">
          <div className="row">
            <h2 id="run-live-title" style={{ margin: 0, fontSize: '1rem' }}>
              {t('views.run.live')} <span className="mono muted">{live.id}</span>
            </h2>
            <span className="grow" />
            {running ? (
              <button type="button" className="btn" onClick={() => void pause(live.id)} disabled={live.pausing}>
                {live.pausing ? t('views.run.pausing') : t('views.run.pause')}
              </button>
            ) : null}
            {live.status === 'paused' || live.status === 'failed' ? (
              <button type="button" className="btn btn--primary" onClick={() => void start({ resume: live.id })} disabled={busy}>
                {t('views.run.resume')}
              </button>
            ) : null}
            {live.status === 'awaiting_outline_approval' ? (
              <button type="button" className="btn btn--primary" onClick={() => void start({ resume: live.id, approve_outline: true })} disabled={busy}>
                {t('views.run.approve')}
              </button>
            ) : null}
            {awaiting && !live.decisionOpen ? (
              <button type="button" className="btn btn--primary" onClick={() => reopenDecision(live.id)} disabled={busy}>
                {t('views.run.decide')}
              </button>
            ) : null}
          </div>
          <div className="run-stats" role="status">
            <div className="run-stats__item">
              <span className="run-stats__label">{t('views.run.status')}</span>
              <span>{statusLabel(live.status)}</span>
            </div>
            <div className="run-stats__item">
              <span className="run-stats__label">{t('views.run.stage')}</span>
              <span>{stageLabel(live.stage)}</span>
            </div>
            <div className="run-stats__item">
              <span className="run-stats__label">{t('common.chapter')}</span>
              <span>{(!live.final || atGate) && live.nextChapter !== undefined ? t('views.run.chapterN', { n: live.nextChapter }) : '—'}</span>
            </div>
            <div className="run-stats__item">
              <span className="run-stats__label">{t('views.run.done')}</span>
              <span>{live.completed !== undefined && live.target !== undefined ? t('views.run.completed', { done: live.completed, total: live.target }) : '—'}</span>
            </div>
            <div className="run-stats__item">
              <span className="run-stats__label">{t('common.cost')}</span>
              <span>{cost(live.costUsd)}</span>
            </div>
          </div>
          {live.status === 'awaiting_outline_approval' ? <div className="view__hint">{t('views.run.approveHint')}</div> : null}
          {awaiting ? <div className="view__hint">{t('views.run.decision.waiting', { n: awaiting.chapter })}</div> : null}
          {live.final && !atGate ? <div className={live.status === 'failed' ? 'view__error' : 'view__ok'}>{t('views.run.finished', { status: statusLabel(live.status) })}</div> : null}
          {live.error ? (
            <div className="view__error" role="alert">
              {t('views.run.error', { error: live.error })}
            </div>
          ) : null}
          <div className="stack" style={{ gap: '0.3rem' }}>
            <span className="small muted">{t('views.run.log')}</span>
            <ul className="run-log" role="log" aria-label={t('views.run.log')}>
              {live.log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          {live.text ? (
            <div className="stack" style={{ gap: '0.3rem' }}>
              <span className="small muted">
                {t('views.run.text')} · {t('views.run.textHint')}
              </span>
              <div className="run-text" aria-label={t('views.run.text')} data-testid="run-text">
                {live.text}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="view__section" aria-labelledby="run-list-title">
        <h2 id="run-list-title">{t('views.run.runs')}</h2>
        {runs.length === 0 ? <div className="muted small">{t('views.run.noRuns')}</div> : null}
        <ul className="runs" role="list" aria-label={t('views.run.runs')}>
          {[...runs].reverse().map((run) => (
            <li key={run.id} className={`run-row${live?.id === run.id ? ' run-row--live' : ''}`} role="listitem">
              <span className="mono">{run.id}</span>
              <span className={`badge${run.status === 'awaiting_decision' ? ' badge--warn' : ''}`}>{statusLabel(run.status)}</span>
              <span className="small muted">{t('views.run.completed', { done: run.completed.length, total: run.target_chapters })}</span>
              <span className="small muted">{cost(run.cost_usd)}</span>
              <span className="small muted">{t('views.run.started', { when: when(run.started_at) })}</span>
              <span className="grow" />
              {run.status === 'paused' || run.status === 'failed' ? (
                <button type="button" className="btn small" onClick={() => void start({ resume: run.id })} disabled={busy || running}>
                  {t('views.run.resume')}
                </button>
              ) : null}
              {run.status === 'awaiting_outline_approval' ? (
                <button type="button" className="btn small btn--primary" onClick={() => void start({ resume: run.id, approve_outline: true })} disabled={busy || running}>
                  {t('views.run.approve')}
                </button>
              ) : null}
              {run.status === 'awaiting_decision' ? (
                <button type="button" className="btn small btn--primary" onClick={() => void show(run)} disabled={busy || running} aria-label={`${t('views.run.decide')}: ${run.id}`}>
                  {t('views.run.decide')}
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost small" onClick={() => void show(run)} aria-label={`${t('views.run.show')}: ${run.id}`}>
                {t('views.run.show')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </ViewFrame>
  );
}
