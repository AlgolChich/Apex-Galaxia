import { getClient } from '../../api/index.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { useAsync } from './use-async.js';

export function InspectorTab() {
  const t = useT();
  const chapter = useStore((s) => s.editor.front?.number);
  const stem = useStore((s) => s.editor.stem);
  const { data, error, loading, reload } = useAsync(() => getClient().inspect('write.continue', chapter), `${stem ?? ''}:${chapter ?? ''}`);
  const inspector = data?.inspector;
  const estimate = data?.estimate;
  const ratio = inspector && inspector.budgetTokens > 0 ? inspector.totalTokens / inspector.budgetTokens : 0;

  return (
    <>
      <div className="small muted">{t('panels.inspector.explain')}</div>
      <div className="panel__toolbar">
        <button type="button" className="btn small" onClick={reload} disabled={loading}>
          {t('panels.refresh')}
        </button>
        {inspector ? <span className="small mono muted">{inspector.model}</span> : null}
      </div>
      {!stem ? <div className="muted small">{t('panels.inspector.none')}</div> : null}
      {error ? <div className="dlg__error small">{t('panels.error', { error })}</div> : null}
      {loading && !data ? <div className="muted small">{t('panels.loading')}</div> : null}
      {inspector ? (
        <>
          <section className="panel__section">
            <div className="small">
              {t('panels.inspector.budget', { total: inspector.totalTokens, budget: inspector.budgetTokens })}
              {inspector.exactCounts ? '' : ` · ${t('panels.inspector.budget.approx')}`}
            </div>
            <div className={`panel__bar${ratio > 1 ? ' panel__bar--over' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={inspector.budgetTokens} aria-valuenow={inspector.totalTokens}>
              <div style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
            </div>
          </section>
          <section className="panel__section">
            <table className="panel__table">
              <thead>
                <tr>
                  <th>{t('panels.inspector.layer')}</th>
                  <th className="num">{t('panels.inspector.tokens')}</th>
                  <th>{t('panels.inspector.action')}</th>
                  <th>{t('panels.inspector.note')}</th>
                </tr>
              </thead>
              <tbody>
                {inspector.layers.map((layer, index) => (
                  <tr key={`${layer.name}-${index}`} className={layer.included ? '' : 'excluded'} title={layer.included ? undefined : t('panels.inspector.excluded')}>
                    <td>{layer.name}</td>
                    <td className="num">{layer.tokens}</td>
                    <td>{t(`panels.inspector.action.${layer.action}`)}</td>
                    <td className="muted">{layer.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.inspector.bible')}</h3>
            {inspector.bible.length === 0 ? <div className="small muted">{t('panels.inspector.bible.none')}</div> : null}
            {inspector.bible.map((b, index) => (
              <div key={`${b.kind}/${b.slug}/${index}`} className={`small${b.included ? '' : ' faint'}`}>
                <strong>{b.slug}</strong> <span className="chip">{b.kind}</span> {b.reason}
                {b.matchedAliases.length ? <span className="muted"> · {b.matchedAliases.join(', ')}</span> : null}
                <span className="muted"> · {t('panels.inspector.bible.hits', { n: b.hits })}</span>
              </div>
            ))}
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.inspector.lessons')}</h3>
            {inspector.lessons.length === 0 ? <div className="small muted">{t('panels.inspector.lessons.none')}</div> : null}
            {inspector.lessons.map((l) => (
              <div key={l.id} className="small">
                <span className="mono">{l.id}</span> <span className="chip">{l.category}</span> {l.rule}
              </div>
            ))}
          </section>
          {estimate ? (
            <section className="panel__section">
              <h3 className="panel__h">{t('panels.inspector.estimate')}</h3>
              <div className="small">{t('panels.inspector.estimate.line', { model: estimate.model, input: estimate.inputTokens, output: estimate.expectedOutputTokens, cost: estimate.costUsd.toFixed(4) })}</div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
