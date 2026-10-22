import { useEffect, useMemo, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { BibleEntrySummary } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { errorText } from './use-async.js';

/** Names and aliases of an entry that occur in the chapter body (case-insensitive). */
export function aliasesInBody(entry: BibleEntrySummary, body: string): string[] {
  const haystack = body.toLowerCase();
  if (!haystack) return [];
  const names = [entry.name, ...entry.aliases.ru, ...entry.aliases.en].map((a) => a.trim()).filter((a) => a.length >= 2);
  return [...new Set(names)].filter((name) => haystack.includes(name.toLowerCase()));
}

export function BibleTab() {
  const t = useT();
  const body = useStore((s) => s.editor.body);
  const setView = useStore((s) => s.setView);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<BibleEntrySummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    const timer = setTimeout(() => {
      const call = q ? getClient().bibleSearch(q) : getClient().bibleList();
      call.then(
        (r) => {
          if (alive) {
            setEntries(r.entries);
            setError(undefined);
          }
        },
        (e: unknown) => alive && setError(errorText(e)),
      );
    }, q ? 180 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const present = useMemo(() => new Map((entries ?? []).map((e) => [`${e.kind}/${e.slug}`, aliasesInBody(e, body)])), [entries, body]);

  return (
    <>
      <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('panels.bible.search')} aria-label={t('panels.bible.search')} />
      {error ? <div className="dlg__error small">{t('panels.error', { error })}</div> : null}
      {entries === undefined ? <div className="muted small">{t('panels.loading')}</div> : null}
      {entries && entries.length === 0 ? <div className="muted small">{t('panels.bible.empty')}</div> : null}
      <ul className="panel__list">
        {(entries ?? []).map((entry) => {
          const key = `${entry.kind}/${entry.slug}`;
          const found = present.get(key) ?? [];
          const expanded = open === key;
          return (
            <li key={key} className={`panel__item${found.length ? ' panel__item--present' : ''}`}>
              <button type="button" className="panel__item-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : key)}>
                <strong className="grow">{entry.name}</strong>
                <span className="chip">{t(`panels.bible.kind.${entry.kind}`)}</span>
                {found.length ? <span className="chip chip--success">{t('panels.bible.inChapter')}</span> : null}
              </button>
              {expanded ? (
                <div className="panel__item-body">
                  {entry.summary ? <div>{entry.summary}</div> : null}
                  {entry.aliases.ru.length + entry.aliases.en.length > 0 ? (
                    <div className="small muted">
                      {t('panels.bible.aliases')}: {[...entry.aliases.ru, ...entry.aliases.en].join(', ')}
                    </div>
                  ) : null}
                  <div className="row small">
                    {entry.always_on ? <span className="chip">{t('panels.bible.alwaysOn')}</span> : null}
                    {entry.canon ? <span className="chip">{t('panels.bible.canon')}</span> : null}
                    <span className="grow" />
                    <button type="button" className="btn btn--ghost small" onClick={() => setView('bible')}>
                      {t('panels.bible.open')}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
