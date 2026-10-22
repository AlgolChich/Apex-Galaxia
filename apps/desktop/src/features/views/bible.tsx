import { useCallback, useEffect, useMemo, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { BibleEntryFull, BibleEntrySummary, EntryKind } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { openImport, useImportStore } from '../import/store.js';
import { Field, hintId } from '../wizard/field.js';
import { ViewFrame, messageOf, splitList } from './frame.js';

const KINDS: EntryKind[] = ['character', 'location', 'faction', 'item'];

interface Proposal {
  kind: string;
  slug: string;
  action: 'create' | 'update';
  name?: string;
  summary?: string;
  diff: string;
  reason?: string;
}

interface Draft {
  name: string;
  aliasesRu: string;
  aliasesEn: string;
  alwaysOn: boolean;
  canon: boolean;
  body: string;
}

function draftOf(entry: BibleEntryFull): Draft {
  return {
    name: entry.front.name,
    aliasesRu: entry.front.aliases.ru.join(', '),
    aliasesEn: entry.front.aliases.en.join(', '),
    alwaysOn: Boolean(entry.front.always_on),
    canon: entry.front.kind === 'canon',
    body: entry.body,
  };
}

function matches(entry: BibleEntrySummary, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [entry.name, entry.slug, entry.summary, ...entry.aliases.ru, ...entry.aliases.en].some((s) => s.toLowerCase().includes(q));
}

function isEntryKind(kind: string): kind is EntryKind {
  return (KINDS as string[]).includes(kind);
}

/**
 * Bible cards (Section 11.4): a kind filter, client-side search, cards with badges, an entry
 * editor whose body stays Markdown with its section headings, and «Extract from chapter»
 * whose proposals are written only on Add.
 */
export function BibleView() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const chapters = useStore((s) => s.project.chapters);
  const config = useStore((s) => s.project.config);
  const model = useStore((s) => s.connection.model);
  // Bumped by the import dialog after a Bible import or a saved dossier; the list reloads.
  const importVersion = useImportStore((s) => s.bibleVersion);
  const dossiers = useImportStore((s) => s.dossiers);
  const client = getClient();

  const [entries, setEntries] = useState<BibleEntrySummary[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<'' | EntryKind>('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ kind: EntryKind; slug: string } | undefined>(undefined);
  const [entry, setEntry] = useState<BibleEntryFull | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<EntryKind>('character');
  const [newName, setNewName] = useState('');
  const [extractChapter, setExtractChapter] = useState<number | undefined>(undefined);
  const [extracting, setExtracting] = useState(false);
  const [proposals, setProposals] = useState<{ chapter: number; items: Proposal[] } | undefined>(undefined);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const result = await client.bibleList();
      setEntries(result.entries);
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load, importVersion]);

  useEffect(() => {
    if (extractChapter === undefined && chapters.length > 0) setExtractChapter(chapters[chapters.length - 1]?.number);
  }, [chapters, extractChapter]);

  const open = useCallback(
    async (target: { kind: EntryKind; slug: string }) => {
      setSelected(target);
      setConfirmRemove(false);
      try {
        const full = await client.bibleGet(target.kind, target.slug);
        setEntry(full);
        setDraft(draftOf(full));
      } catch (failure) {
        toast('error', messageOf(failure));
      }
    },
    [client, toast],
  );

  const visible = useMemo(() => entries.filter((e) => (!kind || e.kind === kind) && matches(e, query.trim())), [entries, kind, query]);

  const save = async () => {
    if (!selected || !draft || saving) return;
    setSaving(true);
    try {
      await client.bibleUpsert({ kind: selected.kind, slug: selected.slug, name: draft.name.trim() || selected.slug, aliases_ru: splitList(draft.aliasesRu), aliases_en: splitList(draft.aliasesEn), always_on: draft.alwaysOn, canon: draft.canon, body: draft.body });
      toast('success', t('views.bible.saved'));
      await load();
      await open(selected);
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await client.bibleRemove(selected.kind, selected.slug);
      toast('info', t('views.bible.removed'));
      setSelected(undefined);
      setEntry(undefined);
      setDraft(undefined);
      setConfirmRemove(false);
      await load();
    } catch (failure) {
      toast('error', messageOf(failure));
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const made = await client.bibleUpsert({ kind: newKind, name });
      setCreating(false);
      setNewName('');
      await load();
      await open({ kind: made.kind, slug: made.slug });
    } catch (failure) {
      toast('error', messageOf(failure));
    }
  };

  const extract = async () => {
    if (extractChapter === undefined || extracting) return;
    setExtracting(true);
    try {
      const result = await client.bibleExtract(extractChapter);
      setProposals({ chapter: extractChapter, items: (result.proposals ?? []) as Proposal[] });
      setAdded(new Set());
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setExtracting(false);
    }
  };

  const addProposal = async (proposal: Proposal) => {
    if (!isEntryKind(proposal.kind)) return;
    const key = `${proposal.kind}/${proposal.slug}`;
    try {
      if (proposal.action === 'create') {
        const name = proposal.name?.trim() || proposal.slug;
        const body = proposal.diff.trimStart().startsWith('# ') ? proposal.diff : `# ${name}\n\n${proposal.diff.trim()}\n`;
        await client.bibleUpsert({ kind: proposal.kind, slug: proposal.slug, name, body });
      } else {
        const existing = await client.bibleGet(proposal.kind, proposal.slug);
        await client.bibleUpsert({ kind: proposal.kind, slug: proposal.slug, name: existing.front.name, body: `${existing.body.trimEnd()}\n\n${proposal.diff.trim()}\n` });
      }
      setAdded((s) => new Set(s).add(key));
      toast('success', t('views.bible.added'));
      await load();
      if (selected?.kind === proposal.kind && selected.slug === proposal.slug) await open(selected);
    } catch (failure) {
      toast('error', messageOf(failure));
    }
  };

  const kindLabel = (k: string) => t(`views.kind.${k}`);
  const extractModel = config?.models.extract;

  const actions = (
    <>
      <button type="button" className="btn" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
        {t('views.bible.new')}
      </button>
      <button type="button" className="btn" onClick={() => openImport({ kind: 'bible' })}>
        {t('views.bible.import')}
      </button>
      <button type="button" className="btn" onClick={() => openImport({ kind: 'dossier' })}>
        {t('views.bible.dossier')}
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => void load()}>
        {t('views.reload')}
      </button>
    </>
  );

  return (
    <ViewFrame id="bible" title={t('views.bible.title')} actions={actions}>
      {error ? (
        <div className="view__error" role="alert">
          {error}
        </div>
      ) : null}
      {creating ? (
        <form
          className="card view__inline"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          aria-label={t('views.bible.new')}
        >
          <Field id="bible-new-kind" label={t('views.bible.kind')}>
            <select id="bible-new-kind" className="select" value={newKind} onChange={(e) => setNewKind(e.target.value as EntryKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="bible-new-name" label={t('views.bible.newName')} hint={t('views.bible.newHint')}>
            <input id="bible-new-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} aria-describedby={hintId('bible-new-name')} autoFocus />
          </Field>
          <button type="submit" className="btn btn--primary" disabled={!newName.trim()}>
            {t('views.bible.create')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setCreating(false)}>
            {t('common.cancel')}
          </button>
        </form>
      ) : null}

      <div className="view__columns">
        <div className="view__section">
          <div className="row">
            <label className="sr-only" htmlFor="bible-search">
              {t('views.bible.search')}
            </label>
            <input id="bible-search" className="input grow" type="search" placeholder={t('views.bible.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="row">
            <label className="small muted" htmlFor="bible-kind">
              {t('views.bible.kind')}
            </label>
            <select id="bible-kind" className="select grow" value={kind} onChange={(e) => setKind(e.target.value as '' | EntryKind)}>
              <option value="">{t('views.bible.kind.all')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          {visible.length === 0 ? <div className="muted small">{entries.length === 0 ? t('views.bible.empty') : t('views.bible.noMatch')}</div> : null}
          <ul className="cards" role="list" aria-label={t('views.bible.entries')}>
            {visible.map((e) => {
              const on = selected?.kind === e.kind && selected.slug === e.slug;
              return (
                <li key={`${e.kind}/${e.slug}`} role="listitem">
                  <button type="button" className={`entry-card${on ? ' entry-card--on' : ''}`} onClick={() => void open({ kind: e.kind, slug: e.slug })} aria-pressed={on}>
                    <span className="entry-card__name">{e.name}</span>
                    {e.summary ? <span className="entry-card__summary">{e.summary}</span> : null}
                    <span className="entry-card__meta">
                      <span className="badge">{kindLabel(e.kind)}</span>
                      {e.always_on ? <span className="badge badge--accent">{t('views.bible.alwaysOn')}</span> : null}
                      {e.canon ? <span className="badge badge--ok">{t('views.bible.canon')}</span> : null}
                      {e.shared ? <span className="badge">{t('views.bible.shared')}</span> : null}
                      {[...e.aliases.ru, ...e.aliases.en].length > 0 ? <span>{[...e.aliases.ru, ...e.aliases.en].join(', ')}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="view__section">
          {selected && draft && entry ? (
            <form
              className="entry-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              aria-label={t('views.bible.editor')}
            >
              <div className="row">
                <h2 style={{ margin: 0, fontSize: '1rem' }}>
                  {t('views.bible.editor')} · <span className="muted">{kindLabel(selected.kind)}</span> · <span className="mono muted">{selected.slug}</span>
                </h2>
                <span className="grow" />
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? t('common.working') : t('common.save')}
                </button>
              </div>
              <Field id="bible-name" label={t('views.bible.name')}>
                <input id="bible-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <div className="plan-item__grid">
                <Field id="bible-aliases-ru" label={t('views.bible.aliasesRu')} hint={t('views.bible.aliasesHint')}>
                  <input id="bible-aliases-ru" className="input" value={draft.aliasesRu} onChange={(e) => setDraft({ ...draft, aliasesRu: e.target.value })} aria-describedby={hintId('bible-aliases-ru')} />
                </Field>
                <Field id="bible-aliases-en" label={t('views.bible.aliasesEn')} hint={t('views.bible.aliasesHint')}>
                  <input id="bible-aliases-en" className="input" value={draft.aliasesEn} onChange={(e) => setDraft({ ...draft, aliasesEn: e.target.value })} aria-describedby={hintId('bible-aliases-en')} />
                </Field>
              </div>
              <div className="plan-item__grid">
                <label className="check" htmlFor="bible-always-on">
                  <input id="bible-always-on" type="checkbox" checked={draft.alwaysOn} onChange={(e) => setDraft({ ...draft, alwaysOn: e.target.checked })} />
                  <span className="check__text">
                    <span>{t('views.bible.alwaysOnLabel')}</span>
                    <span className="field__hint">{t('views.bible.alwaysOnHint')}</span>
                  </span>
                </label>
                <label className="check" htmlFor="bible-canon">
                  <input id="bible-canon" type="checkbox" checked={draft.canon} onChange={(e) => setDraft({ ...draft, canon: e.target.checked })} />
                  <span className="check__text">
                    <span>{t('views.bible.canonLabel')}</span>
                    <span className="field__hint">{t('views.bible.canonHint')}</span>
                  </span>
                </label>
              </div>
              <Field id="bible-body" label={t('views.bible.body')} hint={t('views.bible.bodyHint')}>
                <textarea id="bible-body" className="textarea entry-editor__body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-describedby={hintId('bible-body')} spellCheck={false} />
              </Field>
              <div className="row">
                {confirmRemove ? (
                  <>
                    <span className="small">{t('views.bible.removeConfirm', { name: entry.front.name })}</span>
                    <button type="button" className="btn btn--danger" onClick={() => void remove()}>
                      {t('common.confirm')}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setConfirmRemove(false)}>
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--ghost btn--danger" onClick={() => setConfirmRemove(true)}>
                    {t('views.bible.remove')}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="muted">{t('views.bible.pickEntry')}</div>
          )}

          <section className="view__section" aria-labelledby="bible-extract-title">
            <h2 id="bible-extract-title">{t('views.bible.extract')}</h2>
            <div className="view__hint">{t('views.bible.extractHint')}</div>
            {chapters.length === 0 ? (
              <div className="muted small">{t('views.bible.noChapters')}</div>
            ) : (
              <div className="row">
                <label className="sr-only" htmlFor="bible-extract-chapter">
                  {t('common.chapter')}
                </label>
                <select id="bible-extract-chapter" className="select" style={{ width: 'auto' }} value={extractChapter ?? ''} onChange={(e) => setExtractChapter(Number(e.target.value))}>
                  {chapters.map((c) => (
                    <option key={c.number} value={c.number}>
                      {c.number}. {c.title}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => void extract()} disabled={extracting || !model?.has_model}>
                  {extracting ? t('views.bible.extracting') : t('views.bible.extractRun')}
                </button>
                <span className="small muted">
                  {t('common.model')}: {extractModel ?? '—'}
                  {model?.scripted ? ` (${t('app.model.scripted')})` : ''}
                </span>
              </div>
            )}
            {proposals ? (
              <div className="stack">
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('views.bible.proposals', { n: proposals.chapter })}</h3>
                {proposals.items.length === 0 ? <div className="muted small">{t('views.bible.noProposals')}</div> : null}
                <ul className="cards" role="list">
                  {proposals.items.map((p, i) => {
                    const key = `${p.kind}/${p.slug}`;
                    const done = added.has(key);
                    const addable = isEntryKind(p.kind);
                    return (
                      <li key={`${key}-${i}`} className="card proposal" role="listitem">
                        <div className="row">
                          <strong>{p.name ?? p.slug}</strong>
                          <span className="badge">{kindLabel(p.kind)}</span>
                          <span className="badge badge--accent">{t(`views.bible.action.${p.action}`)}</span>
                          <span className="mono muted small">{p.slug}</span>
                          <span className="grow" />
                          {done ? (
                            <span className="view__ok small">{t('views.bible.added')}</span>
                          ) : (
                            <button type="button" className="btn btn--primary" onClick={() => void addProposal(p)} disabled={!addable}>
                              {t('views.bible.add')}
                            </button>
                          )}
                        </div>
                        {p.summary ? <div>{p.summary}</div> : null}
                        {p.reason ? <div className="small muted">{p.reason}</div> : null}
                        {!addable ? <div className="small view__warning">{t('views.bible.notEntryKind')}</div> : null}
                        <details className="fold">
                          <summary>{t('views.bible.diff')}</summary>
                          <pre className="proposal__diff">{p.diff}</pre>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="view__section" aria-labelledby="bible-research-title">
            <h2 id="bible-research-title">{t('views.bible.research')}</h2>
            <div className="view__hint">{t('views.bible.researchHint')}</div>
            {dossiers.length > 0 ? (
              <div className="small">
                <div className="muted">{t('views.bible.researchSession')}:</div>
                <ul className="mono" style={{ margin: '0.2rem 0 0', paddingLeft: '1.2rem' }}>
                  {dossiers.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </ViewFrame>
  );
}
