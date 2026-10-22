import { useState } from 'react';
import { getClient } from '../../api/index.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { useDialogs } from '../diff/store.js';
import { useAsync } from './use-async.js';

/** Markdown as plain paragraphs: headings and list markers stripped, blank lines split. */
export function markdownParagraphs(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '').replace(/\*\*|__/g, ''))
        .join(' ')
        .replace(/(^|[\s(«"])[_*]([^_*\n]+?)[_*](?=[\s.,;:!?)»"]|$)/g, '$1$2')
        .trim(),
    )
    .filter((p) => p.length > 0);
}

export function ChronicleTab() {
  const t = useT();
  const version = useDialogs((s) => s.chronicleVersion);
  const openUpdate = useDialogs((s) => s.openChronicleUpdate);
  const chapter = useStore((s) => s.editor.front?.number);
  const [full, setFull] = useState<{ handover?: string; hidden?: string } | undefined>(undefined);
  const [fullBusy, setFullBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(() => getClient().chronicleGet(), version);

  const loadFull = async () => {
    if (full) {
      setFull(undefined);
      return;
    }
    setFullBusy(true);
    try {
      const r = await getClient().chronicleGet(true);
      setFull({ ...(r.handover ? { handover: r.handover } : {}), ...(r.hidden ? { hidden: r.hidden } : {}) });
    } finally {
      setFullBusy(false);
    }
  };

  const state = data?.state;
  const threads = state?.open_threads.filter((th) => th.status === 'open') ?? [];
  const consequences = state?.pending_consequences.filter((c) => !c.done) ?? [];
  const locations = Object.entries(state?.locations ?? {});

  return (
    <>
      <div className="panel__toolbar">
        <button type="button" className="btn small" onClick={reload} disabled={loading}>
          {t('panels.refresh')}
        </button>
        {chapter !== undefined ? (
          <button type="button" className="btn small" onClick={() => openUpdate(chapter)}>
            {t('panels.chronicle.update', { n: chapter })}
          </button>
        ) : null}
      </div>
      {error ? <div className="dlg__error small">{t('panels.error', { error })}</div> : null}
      {loading && !data ? <div className="muted small">{t('panels.loading')}</div> : null}
      {state ? (
        <>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.chronicle.time')}</h3>
            <div>{state.in_story_time || t('panels.chronicle.none')}</div>
            <div className="small muted">
              {t('panels.chronicle.lastChapter')}: {state.last_chapter}
            </div>
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.chronicle.locations')}</h3>
            {locations.length === 0 ? <div className="small muted">{t('panels.chronicle.none')}</div> : null}
            {locations.map(([who, where]) => (
              <div key={who} className="small">
                <strong>{who}</strong>: {where}
              </div>
            ))}
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.chronicle.threads')}</h3>
            {threads.length === 0 ? <div className="small muted">{t('panels.chronicle.none')}</div> : null}
            {threads.map((th, index) => (
              <div key={`${th.id}-${index}`} className="small">
                {th.text} {th.since_chapter !== undefined ? <span className="faint">({t('panels.chronicle.since', { n: th.since_chapter })})</span> : null}
              </div>
            ))}
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.chronicle.consequences')}</h3>
            {consequences.length === 0 ? <div className="small muted">{t('panels.chronicle.none')}</div> : null}
            {consequences.map((c, index) => (
              <div key={`${c.id}-${index}`} className="small">
                {c.text} {c.due ? <span className="faint">({c.due})</span> : null}
              </div>
            ))}
          </section>
          <section className="panel__section">
            <h3 className="panel__h">{t('panels.chronicle.log')}</h3>
            <div className="panel__log">
              {data && data.log.trim() ? markdownParagraphs(data.log).map((p, i) => <p key={i}>{p}</p>) : <div className="small muted">{t('panels.chronicle.empty')}</div>}
            </div>
          </section>
          <section className="panel__section">
            <button type="button" className="btn small" onClick={() => void loadFull()} disabled={fullBusy} aria-expanded={Boolean(full)}>
              {full ? t('panels.chronicle.handover.hide') : t('panels.chronicle.handover')}
            </button>
            {full ? (
              <>
                {full.handover ? <pre className="panel__pre">{full.handover}</pre> : null}
                <div className="panel__hidden">
                  <div className="small dlg__warning">
                    <strong>{t('panels.chronicle.hiddenTitle')}</strong> · {t('panels.chronicle.hidden')}
                  </div>
                  <pre>{full.hidden?.trim() || t('panels.chronicle.none')}</pre>
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
