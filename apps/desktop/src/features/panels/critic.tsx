import { useEffect } from 'react';
import { getClient } from '../../api/index.js';
import type { CriticResult } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { currentSelection, dispatchEditor } from '../diff/editor-bridge.js';
import { useDialogs } from '../diff/store.js';
import { usePanels, type CriticState } from './state.js';
import { errorText } from './use-async.js';

const SCORES: Array<keyof CriticResult['scores']> = ['voice', 'subtext', 'rhythm', 'cliche', 'ai_tell', 'continuity', 'language'];

function scoreClass(score: number): string {
  return score <= 2 ? 'score--low' : score === 3 ? 'score--mid' : 'score--high';
}

/** Run the critic or the Bible check and keep the result in the panel store. */
export async function runCritic(kind: CriticState['kind'], scope: CriticState['scope']): Promise<void> {
  const app = useStore.getState();
  const chapter = app.editor.front?.number;
  const { setCritic } = usePanels.getState();
  setCritic({ kind, scope, result: undefined, error: undefined, busy: true });
  try {
    let result: CriticResult;
    if (kind === 'bible') {
      if (chapter === undefined) throw new Error('no chapter');
      result = await getClient().checkBible(chapter);
    } else if (scope === 'selection') {
      result = await getClient().criticReview({ passage: currentSelection().text });
    } else {
      result = await getClient().criticReview(chapter !== undefined ? { chapter } : { passage: app.editor.body });
    }
    setCritic({ kind, scope, result, error: undefined, busy: false });
  } catch (error) {
    setCritic({ kind, scope, result: undefined, error: errorText(error), busy: false });
  }
}

export function CriticTab() {
  const t = useT();
  const critic = usePanels((s) => s.critic);
  const request = useDialogs((s) => s.criticRequest);
  const body = useStore((s) => s.editor.body);
  const chapter = useStore((s) => s.editor.front?.number);
  const selection = useStore((s) => s.editor.selection);
  const toast = useStore((s) => s.toast);
  const hasSelection = selection.from !== selection.to && body.slice(Math.min(selection.from, selection.to), Math.max(selection.from, selection.to)).trim().length > 0;

  useEffect(() => {
    if (!request) return;
    const { handledCritic, setHandledCritic } = usePanels.getState();
    if (request.nonce <= handledCritic) return;
    setHandledCritic(request.nonce);
    void runCritic(request.kind, request.scope);
  }, [request]);

  const goto = (quote: string) => {
    const needle = quote.trim();
    const at = needle ? body.indexOf(needle) : -1;
    if (at < 0) {
      toast('info', t('panels.critic.notFound'));
      return;
    }
    dispatchEditor({ type: 'goto', from: at, to: at + needle.length });
  };

  const result = critic?.result;
  return (
    <>
      <div className="panel__toolbar">
        <button type="button" className="btn small" onClick={() => void runCritic('critic', 'chapter')} disabled={critic?.busy || chapter === undefined}>
          {t('panels.critic.chapter')}
        </button>
        <button type="button" className="btn small" onClick={() => void runCritic('critic', 'selection')} disabled={critic?.busy || !hasSelection}>
          {t('panels.critic.selection')}
        </button>
        <button type="button" className="btn small" onClick={() => void runCritic('bible', 'chapter')} disabled={critic?.busy || chapter === undefined}>
          {t('panels.critic.bible')}
        </button>
      </div>
      {critic?.busy ? (
        <div className="muted small" aria-busy="true">
          <span className="diff-busy__dot" aria-hidden="true" />
          {t(`panels.critic.busy.${critic.kind}`)}
        </div>
      ) : null}
      {critic?.error ? <div className="dlg__error small">{t('panels.error', { error: critic.error })}</div> : null}
      {!critic ? <div className="muted small">{t('panels.critic.none')}</div> : null}
      {result && critic ? (
        <>
          <section className="panel__section">
            <h3 className="panel__h">
              {t(`panels.critic.result.${critic.kind}`)} · {t(`panels.critic.scope.${critic.scope}`)}
            </h3>
            <div className="row">
              <span>{t('panels.critic.verdict')}:</span>
              <span className={`chip ${result.verdict === 'pass' ? 'chip--success' : result.verdict === 'revise' ? 'chip--warning' : 'chip--error'}`}>{t(`panels.critic.verdict.${result.verdict}`)}</span>
            </div>
            <table className="panel__scores">
              <tbody>
                {SCORES.map((key) => (
                  <tr key={key}>
                    <td>{t(`panels.critic.score.${key}`)}</td>
                    <td className={scoreClass(result.scores[key])}>{result.scores[key]} / 5</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.critic.quotes')}</h3>
            {result.quotes.length === 0 ? <div className="small muted">{t('panels.critic.noQuotes')}</div> : null}
            {result.quotes.map((q, index) => (
              <div key={index} className="panel__quote">
                <div className="panel__quote-text">«{q.quote}»</div>
                <div>{q.issue}</div>
                {q.fix ? (
                  <div className="muted">
                    {t('panels.critic.fix')}: {q.fix}
                  </div>
                ) : null}
                <div className="row">
                  <span className="chip">{q.category}</span>
                  <span className={`chip ${q.severity === 'high' ? 'chip--error' : q.severity === 'medium' ? 'chip--warning' : 'chip--info'}`}>{q.severity}</span>
                  <span className="grow" />
                  <button type="button" className="btn btn--ghost small" onClick={() => goto(q.quote)}>
                    {t('panels.critic.goto')}
                  </button>
                </div>
              </div>
            ))}
          </section>
          {result.notes ? (
            <section className="panel__section">
              <h3 className="panel__h">{t('panels.critic.notes')}</h3>
              <div className="small">{result.notes}</div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
