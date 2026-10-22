import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getClient } from '../../api/index.js';
import type { ChronicleState } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { parseChronicleLog } from './chronicle-parse.js';
import { ViewFrame, messageOf } from './frame.js';

type StateKey = 'locations' | 'condition' | 'inventory' | 'knowledge' | 'relations' | 'open_threads' | 'planted_guns' | 'pending_consequences' | 'rolls';
const STATE_KEYS: StateKey[] = ['locations', 'condition', 'inventory', 'knowledge', 'relations', 'open_threads', 'planted_guns', 'pending_consequences', 'rolls'];
/** Keys the reader-safe handover omits (`renderStateYaml` in the core): planner material. */
const PLANNER_ONLY = new Set<StateKey>(['planted_guns', 'pending_consequences']);

function countOf(state: ChronicleState, key: StateKey): number {
  const value = state[key];
  if (Array.isArray(value)) return value.length;
  return value && typeof value === 'object' ? Object.keys(value).length : 0;
}

function Fold({ id, title, count, badge, open, children }: { id: string; title: string; count: number; badge?: string | undefined; open?: boolean; children: ReactNode }) {
  return (
    <details className="fold" open={open} id={id}>
      <summary>
        <span>{title}</span>
        <span className="fold__count">{count}</span>
        {badge ? <span className="badge badge--warn">{badge}</span> : null}
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="plain-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * The chronicle view (Section 11.4): the reader-safe log as a timeline, newest first, with the
 * in-story time on top; the state with every key folded; the handover in two separate boxes.
 */
export function ChronicleView() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const client = getClient();
  const [state, setState] = useState<ChronicleState | undefined>(undefined);
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [handover, setHandover] = useState<{ readerSafe: string; hidden: string } | undefined>(undefined);
  const [loadingHandover, setLoadingHandover] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await client.chronicleGet();
      setState(result.state);
      setLog(result.log);
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsed = useMemo(() => parseChronicleLog(log), [log]);
  const sections = useMemo(() => [...parsed.sections].sort((a, b) => b.chapter - a.chapter), [parsed]);

  const showHandover = async () => {
    if (handover) {
      setHandover(undefined);
      return;
    }
    setLoadingHandover(true);
    try {
      const result = await client.chronicleGet(true);
      setState(result.state);
      setLog(result.log);
      setHandover({ readerSafe: result.handover ?? '', hidden: result.hidden ?? '' });
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setLoadingHandover(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', t('views.chronicle.copied'));
    } catch {
      toast('error', t('views.chronicle.copyFailed'));
    }
  };

  const none = <span className="muted">{t('views.chronicle.none')}</span>;
  const renderKey = (key: StateKey): ReactNode => {
    if (!state) return none;
    switch (key) {
      case 'locations': {
        const rows = Object.entries(state.locations);
        return rows.length === 0 ? (
          none
        ) : (
          <dl className="kv">
            {rows.map(([slug, place]) => (
              <div key={slug} style={{ display: 'contents' }}>
                <dt>{slug}</dt>
                <dd>{place}</dd>
              </div>
            ))}
          </dl>
        );
      }
      case 'condition': {
        const rows = Object.entries(state.condition);
        return rows.length === 0 ? (
          none
        ) : (
          <dl className="kv">
            {rows.map(([slug, c]) => (
              <div key={slug} style={{ display: 'contents' }}>
                <dt>{slug}</dt>
                <dd>
                  {[c.wounds.length > 0 ? `${t('views.chronicle.wounds')}: ${c.wounds.join(', ')}` : '', c.fatigue ? `${t('views.chronicle.fatigue')}: ${c.fatigue}` : '', c.mood ? `${t('views.chronicle.mood')}: ${c.mood}` : '', c.notes ? `${t('views.chronicle.notes')}: ${c.notes}` : ''].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
            ))}
          </dl>
        );
      }
      case 'inventory': {
        const rows = Object.entries(state.inventory);
        return rows.length === 0 ? (
          none
        ) : (
          <dl className="kv">
            {rows.map(([slug, items]) => (
              <div key={slug} style={{ display: 'contents' }}>
                <dt>{slug}</dt>
                <dd>{items.join(', ') || '—'}</dd>
              </div>
            ))}
          </dl>
        );
      }
      case 'knowledge':
        return state.knowledge.length === 0 ? none : <List items={state.knowledge.map((k) => <span key={k.id}>{k.fact} <span className="muted">({[t('views.chronicle.knownBy', { who: k.known_by.join(', ') }), k.since_chapter !== undefined ? t('views.chronicle.since', { n: k.since_chapter }) : ''].filter(Boolean).join('; ')})</span></span>)} />;
      case 'relations':
        return state.relations.length === 0 ? (
          none
        ) : (
          <List
            items={state.relations.map((r) => (
              <span key={r.between.join('-')}>
                <strong>
                  {r.between[0]} — {r.between[1]}
                </strong>
                {r.trust ? ` · ${t('views.chronicle.trust', { text: r.trust })}` : ''}
                {r.promises.length > 0 ? ` · ${t('views.chronicle.promises')}: ${r.promises.join(', ')}` : ''}
                {r.debts.length > 0 ? ` · ${t('views.chronicle.debts')}: ${r.debts.join(', ')}` : ''}
                {r.grudges.length > 0 ? ` · ${t('views.chronicle.grudges')}: ${r.grudges.join(', ')}` : ''}
                {r.notes ? ` · ${r.notes}` : ''}
              </span>
            ))}
          />
        );
      case 'open_threads':
        return state.open_threads.length === 0 ? (
          none
        ) : (
          <List
            items={state.open_threads.map((th) => (
              <span key={th.id}>
                {th.text} <span className="muted">({[t(`views.chronicle.status.${th.status}`), th.since_chapter !== undefined ? t('views.chronicle.since', { n: th.since_chapter }) : ''].filter(Boolean).join('; ')})</span>
              </span>
            ))}
          />
        );
      case 'planted_guns':
        return state.planted_guns.length === 0 ? (
          none
        ) : (
          <List
            items={state.planted_guns.map((g) => (
              <span key={g.id}>
                {g.what} <span className="muted">({[g.planted_in !== undefined ? t('views.chronicle.plantedIn', { n: g.planted_in }) : '', g.payoff ? t('views.chronicle.payoff', { text: g.payoff }) : '', g.fired_in !== undefined ? t('views.chronicle.firedIn', { n: g.fired_in }) : ''].filter(Boolean).join('; ')})</span>
              </span>
            ))}
          />
        );
      case 'pending_consequences':
        return state.pending_consequences.length === 0 ? (
          none
        ) : (
          <List
            items={state.pending_consequences.map((c) => (
              <span key={c.id}>
                {c.text} <span className="muted">({[c.due ? t('views.chronicle.due', { text: c.due }) : '', c.done ? t('views.chronicle.done') : t('views.chronicle.pending')].filter(Boolean).join('; ')})</span>
              </span>
            ))}
          />
        );
      case 'rolls':
        return state.rolls.length === 0 ? (
          none
        ) : (
          <List
            items={state.rolls.map((r, i) => (
              <span key={i}>
                {t('views.chronicle.roll', { chapter: r.chapter, result: r.result, outcome: r.outcome })}
                {r.note ? <span className="muted"> · {r.note}</span> : null}
              </span>
            ))}
          />
        );
      default:
        return none;
    }
  };

  const actions = (
    <>
      <button type="button" className="btn" onClick={() => void showHandover()} disabled={loadingHandover} aria-expanded={Boolean(handover)}>
        {handover ? t('views.chronicle.hide') : loadingHandover ? t('common.working') : t('views.chronicle.handover')}
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => void load()}>
        {t('views.reload')}
      </button>
    </>
  );

  return (
    <ViewFrame id="chronicle" title={t('views.chronicle.title')} actions={actions}>
      {error ? (
        <div className="view__error" role="alert">
          {error}
        </div>
      ) : null}
      {handover ? (
        <section className="view__section" aria-labelledby="chronicle-handover-title">
          <h2 id="chronicle-handover-title">{t('views.chronicle.handover')}</h2>
          <div className="view__hint">{t('views.chronicle.handoverHint')}</div>
          <div className="box">
            <div className="box__head">
              <strong>{t('views.chronicle.readerSafe')}</strong>
              <span className="grow" />
              <button type="button" className="btn small" onClick={() => void copy(handover.readerSafe)} aria-label={`${t('common.copy')}: ${t('views.chronicle.readerSafe')}`}>
                {t('common.copy')}
              </button>
            </div>
            <pre className="box__pre">{handover.readerSafe}</pre>
          </div>
          <div className="box box--hidden">
            <div className="box__head">
              <strong>{t('views.chronicle.hidden')}</strong>
              <span className="small view__warning">{t('views.chronicle.hiddenHint')}</span>
              <span className="grow" />
              <button type="button" className="btn small" onClick={() => void copy(handover.hidden)} aria-label={`${t('common.copy')}: ${t('views.chronicle.hidden')}`}>
                {t('common.copy')}
              </button>
            </div>
            <pre className="box__pre">{handover.hidden}</pre>
          </div>
        </section>
      ) : null}

      <div className="view__columns" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(16rem, 24rem)' }}>
        <section className="view__section" aria-labelledby="chronicle-log-title">
          <div className="now" role="status">
            <span className="small muted">{t('views.chronicle.now')}</span>
            <span className="now__time">{state?.in_story_time || t('views.chronicle.noTime')}</span>
            {state ? <span className="small muted">{t('views.chronicle.lastChapter', { n: state.last_chapter })}</span> : null}
          </div>
          <h2 id="chronicle-log-title">{t('views.chronicle.log')}</h2>
          <div className="view__hint">{t('views.chronicle.logHint')}</div>
          {sections.length === 0 ? <div className="muted">{t('views.chronicle.empty')}</div> : null}
          <ol className="timeline" role="list" aria-label={t('views.chronicle.log')}>
            {sections.map((s, i) => (
              <li key={s.chapter} className={`timeline__item${i === 0 ? ' timeline__item--latest' : ''}`} role="listitem">
                <div className="timeline__chapter">{s.heading}</div>
                <div className="timeline__text">{s.text}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="view__section" aria-labelledby="chronicle-state-title">
          <h2 id="chronicle-state-title">{t('views.chronicle.state')}</h2>
          <div className="view__hint">{t('views.chronicle.stateHint')}</div>
          {STATE_KEYS.map((key) => (
            <Fold key={key} id={`chronicle-${key}`} title={t(`views.chronicle.key.${key}`)} count={state ? countOf(state, key) : 0} badge={PLANNER_ONLY.has(key) ? t('views.chronicle.plannerOnly') : undefined}>
              {renderKey(key)}
            </Fold>
          ))}
        </section>
      </div>
    </ViewFrame>
  );
}
