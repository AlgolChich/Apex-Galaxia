import { useCallback, useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { BeatSheet, ChapterStatus, PlannedChapter, Roll } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Field, hintId } from '../wizard/field.js';
import { ViewFrame, messageOf } from './frame.js';

const STATUSES: ChapterStatus[] = ['planned', 'draft', 'revised', 'final'];

/** A chapter row as the form holds it: text fields stay strings until save. */
interface Row {
  key: number;
  number: number;
  title: string;
  slug: string | undefined;
  status: ChapterStatus;
  targetWords: string;
  beats: string;
  turningPoint: string;
  cliffhanger: string;
}

let rowKey = 0;

function rowOf(c: PlannedChapter): Row {
  return { key: ++rowKey, number: c.number, title: c.title, slug: c.slug, status: c.status, targetWords: c.target_words !== undefined ? String(c.target_words) : '', beats: c.beats.join('\n'), turningPoint: c.turning_point ?? '', cliffhanger: c.cliffhanger ?? '' };
}

/** Rows back to `plan/chapters.yaml` shape, renumbered in list order. */
export function chaptersOfRows(rows: Row[]): PlannedChapter[] {
  return rows.map((r, i) => {
    const words = Number.parseInt(r.targetWords, 10);
    const out: PlannedChapter = { number: i + 1, title: r.title.trim(), status: r.status, beats: r.beats.split('\n').map((b) => b.trim()).filter((b) => b.length > 0) };
    if (r.slug) out.slug = r.slug;
    if (Number.isFinite(words) && words > 0) out.target_words = words;
    if (r.turningPoint.trim()) out.turning_point = r.turningPoint.trim();
    if (r.cliffhanger.trim()) out.cliffhanger = r.cliffhanger.trim();
    return out;
  });
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * The plan view (Section 11.4): outline.md as text, the chapter plan as a reorderable list
 * (saved renumbered in order), and «Plan with the model» per chapter showing the beat sheet
 * and the d20 roll when the storyteller rolled one.
 */
export function PlanView() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const model = useStore((s) => s.connection.model);
  const client = getClient();
  const [outline, setOutline] = useState('');
  const [savedOutline, setSavedOutline] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [savedRows, setSavedRows] = useState('[]');
  const [loaded, setLoaded] = useState(false);
  const [beats, setBeats] = useState<number[]>([]);
  const [sheets, setSheets] = useState<Record<number, { sheet: BeatSheet; roll: Roll | null }>>({});
  const [planning, setPlanning] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState<'outline' | 'chapters' | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const plan = await client.planGet();
      setOutline(plan.outline);
      setSavedOutline(plan.outline);
      const next = plan.chapters.chapters.map(rowOf);
      setRows(next);
      setSavedRows(JSON.stringify(chaptersOfRows(next)));
      setBeats(plan.beats);
      setError(undefined);
      setLoaded(true);
    } catch (failure) {
      setError(messageOf(failure));
      setLoaded(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const chaptersDirty = JSON.stringify(chaptersOfRows(rows)) !== savedRows;
  const outlineDirty = outline !== savedOutline;

  const saveOutline = async () => {
    setSaving('outline');
    try {
      await client.planSave({ outline });
      setSavedOutline(outline);
      toast('success', t('views.plan.outlineSaved'));
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setSaving(undefined);
    }
  };

  const saveChapters = async () => {
    setSaving('chapters');
    try {
      const result = await client.planSave({ chapters: { chapters: chaptersOfRows(rows) } });
      const next = (result.chapters?.chapters ?? chaptersOfRows(rows)).map(rowOf);
      setRows(next);
      setSavedRows(JSON.stringify(chaptersOfRows(next)));
      toast('success', t('views.plan.chaptersSaved'));
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setSaving(undefined);
    }
  };

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((list) => [...list, rowOf({ number: list.length + 1, title: '', status: 'planned', beats: [] })]);
  const remove = (key: number) => setRows((list) => list.filter((r) => r.key !== key));

  const plan = async (number: number) => {
    if (planning !== undefined) return;
    setPlanning(number);
    try {
      const result = await client.planChapter(number);
      setSheets((s) => ({ ...s, [number]: result }));
      const fresh = await client.planGet();
      setBeats(fresh.beats);
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setPlanning(undefined);
    }
  };

  const actions = (
    <button type="button" className="btn btn--ghost" onClick={() => void load()}>
      {t('views.reload')}
    </button>
  );

  return (
    <ViewFrame id="plan" title={t('views.plan.title')} actions={actions}>
      {error ? (
        <div className="view__error" role="alert">
          {error}
        </div>
      ) : null}
      <section className="view__section" aria-labelledby="plan-outline-title">
        <div className="row">
          <h2 id="plan-outline-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t('views.plan.outline')}
          </h2>
          {outlineDirty ? <span className="small muted">{t('common.unsaved')}</span> : null}
          <span className="grow" />
          <button type="button" className="btn btn--primary" onClick={() => void saveOutline()} disabled={!loaded || !outlineDirty || saving !== undefined}>
            {saving === 'outline' ? t('common.working') : t('views.plan.saveOutline')}
          </button>
        </div>
        <div className="view__hint" id="plan-outline-hint">
          {t('views.plan.outlineHint')}
        </div>
        <label className="sr-only" htmlFor="plan-outline">
          {t('views.plan.outline')}
        </label>
        <textarea id="plan-outline" className="textarea outline" value={outline} onChange={(e) => setOutline(e.target.value)} aria-describedby="plan-outline-hint" spellCheck={false} />
      </section>

      <section className="view__section" aria-labelledby="plan-chapters-title">
        <div className="row">
          <h2 id="plan-chapters-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t('views.plan.chapters')}
          </h2>
          {chaptersDirty ? <span className="small muted">{t('common.unsaved')}</span> : null}
          <span className="grow" />
          <button type="button" className="btn" onClick={add}>
            {t('views.plan.add')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void saveChapters()} disabled={!loaded || !chaptersDirty || saving !== undefined}>
            {saving === 'chapters' ? t('common.working') : t('views.plan.saveChapters')}
          </button>
        </div>
        <div className="view__hint">{t('views.plan.chaptersHint')}</div>
        {rows.length === 0 ? <div className="muted">{t('views.plan.empty')}</div> : null}
        <ol className="plan-list" role="list" aria-label={t('views.plan.chapters')}>
          {rows.map((r, i) => {
            const label = t('views.plan.number', { n: i + 1 });
            const hasSheet = beats.includes(r.number) && !chaptersDirty;
            const sheet = sheets[r.number];
            return (
              <li key={r.key} className="plan-item" role="listitem" aria-label={`${label}${r.title ? `: ${r.title}` : ''}`}>
                <div className="plan-item__head">
                  <strong>{label}</strong>
                  {r.number !== i + 1 ? <span className="small muted">({t('views.plan.wasNumber', { n: r.number })})</span> : null}
                  {hasSheet ? <span className="badge badge--accent">{t('views.plan.hasSheet')}</span> : null}
                  <span className="grow" />
                  <button type="button" className="btn btn--ghost small" onClick={() => setRows((list) => move(list, i, i - 1))} disabled={i === 0} aria-label={`${t('views.plan.up')}: ${label}`}>
                    {t('views.plan.up')}
                  </button>
                  <button type="button" className="btn btn--ghost small" onClick={() => setRows((list) => move(list, i, i + 1))} disabled={i === rows.length - 1} aria-label={`${t('views.plan.down')}: ${label}`}>
                    {t('views.plan.down')}
                  </button>
                  <button type="button" className="btn btn--ghost small btn--danger" onClick={() => remove(r.key)} aria-label={`${t('views.plan.remove')}: ${label}`}>
                    {t('views.plan.remove')}
                  </button>
                </div>
                <div className="plan-item__grid">
                  <Field id={`plan-title-${r.key}`} label={t('views.plan.chapterTitle')}>
                    <input id={`plan-title-${r.key}`} className="input" value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} />
                  </Field>
                  <Field id={`plan-status-${r.key}`} label={t('views.plan.status')}>
                    <select id={`plan-status-${r.key}`} className="select" value={r.status} onChange={(e) => update(r.key, { status: e.target.value as ChapterStatus })}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`views.plan.status.${s}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`plan-words-${r.key}`} label={t('views.plan.targetWords')}>
                    <input id={`plan-words-${r.key}`} className="input" type="number" min={1} value={r.targetWords} onChange={(e) => update(r.key, { targetWords: e.target.value })} />
                  </Field>
                  <div className="field field--wide">
                    <label className="field__label" htmlFor={`plan-beats-${r.key}`}>
                      {t('views.plan.beats')}
                    </label>
                    <textarea id={`plan-beats-${r.key}`} className="textarea" rows={3} value={r.beats} onChange={(e) => update(r.key, { beats: e.target.value })} />
                  </div>
                  <Field id={`plan-turn-${r.key}`} label={t('views.plan.turningPoint')}>
                    <input id={`plan-turn-${r.key}`} className="input" value={r.turningPoint} onChange={(e) => update(r.key, { turningPoint: e.target.value })} />
                  </Field>
                  <Field id={`plan-cliff-${r.key}`} label={t('views.plan.cliffhanger')}>
                    <input id={`plan-cliff-${r.key}`} className="input" value={r.cliffhanger} onChange={(e) => update(r.key, { cliffhanger: e.target.value })} />
                  </Field>
                </div>
                <div className="row">
                  <button type="button" className="btn" onClick={() => void plan(r.number)} disabled={planning !== undefined || chaptersDirty || !model?.has_model} aria-describedby={hintId(`plan-model-${r.key}`)}>
                    {planning === r.number ? t('views.plan.planning') : t('views.plan.planModel')}
                  </button>
                  <span className="field__hint" id={hintId(`plan-model-${r.key}`)}>
                    {t('views.plan.planHint')}
                  </span>
                </div>
                {sheet ? (
                  <section className="sheet" aria-label={t('views.plan.sheet', { n: sheet.sheet.chapter })}>
                    <div className="row">
                      <strong>
                        {t('views.plan.sheet', { n: sheet.sheet.chapter })}: {sheet.sheet.title}
                      </strong>
                      {sheet.roll ? <span className="badge badge--warn">{t('views.plan.roll', { result: sheet.roll.result, outcome: t(`views.plan.outcome.${sheet.roll.outcome}`) })}</span> : null}
                    </div>
                    <dl className="kv">
                      <dt>{t('views.plan.sheet.goal')}</dt>
                      <dd>{sheet.sheet.goal}</dd>
                      <dt>{t('views.plan.sheet.beats')}</dt>
                      <dd>
                        <ol className="plain-list">
                          {sheet.sheet.beats.map((b, j) => (
                            <li key={j}>{b}</li>
                          ))}
                        </ol>
                      </dd>
                      <dt>{t('views.plan.sheet.breather')}</dt>
                      <dd>{sheet.sheet.breather_scene}</dd>
                      <dt>{t('views.plan.sheet.ending')}</dt>
                      <dd>{sheet.sheet.ending_image}</dd>
                      <dt>{t('views.plan.sheet.worldTick')}</dt>
                      <dd>{sheet.sheet.world_tick.join('; ') || '—'}</dd>
                      <dt>{t('views.plan.sheet.guns')}</dt>
                      <dd>{sheet.sheet.guns.join('; ') || '—'}</dd>
                      <dt>{t('views.plan.sheet.cliffhanger')}</dt>
                      <dd>{sheet.sheet.cliffhanger ?? '—'}</dd>
                    </dl>
                  </section>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </ViewFrame>
  );
}
