import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { pick, plural, useLanguage, useT } from '../../i18n/index.js';
import { useStore, type PendingSuggestion, type StreamState } from '../../state/store.js';
import { useDialogs } from '../diff/store.js';
import { acceptPending, useSuggestionDraft } from './draft.js';
import './suggestion.css';

export { useSuggestionDraft, editedTextFor, acceptPending } from './draft.js';

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Streaming({ stream }: { stream: StreamState }) {
  const t = useT();
  const cancel = useStore((s) => s.cancelWrite);
  const [now, setNow] = useState(Date.now());
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [stream.text]);
  return (
    <>
      <div className="sug__head">
        <strong>{t('suggestion.streaming')}</strong>
        <span>{t(`suggestion.mode.${stream.mode}`)}</span>
        <span className="mono">{formatElapsed(now - stream.startedAt)}</span>
        <span className="grow" />
        <span className="faint">{countWords(stream.text)} {t('common.words')}</span>
        <button type="button" className="btn small" onClick={cancel}>
          {t('suggestion.cancel')}
        </button>
      </div>
      <div ref={bodyRef} className="sug__body">
        <div className="prose sug__stream">
          {stream.text}
          <span className="sug__caret" aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

function Pending({ pending, collapsed, onCollapse }: { pending: PendingSuggestion; collapsed: boolean; onCollapse: (v: boolean) => void }) {
  const t = useT();
  const language = useLanguage();
  const discard = useStore((s) => s.discardSuggestion);
  const retry = useStore((s) => s.retrySuggestion);
  const setDraft = useSuggestionDraft((s) => s.setDraft);
  const [text, setText] = useState(pending.text);
  const [showLint, setShowLint] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setText(pending.text);
    setDraft(pending.front.id, pending.text);
  }, [pending.front.id, pending.text, setDraft]);

  const edited = text !== pending.text;
  const words = useMemo(() => countWords(text), [text]);
  const counts = pending.lint.counts;
  const chapter = pending.chapterNumber;

  const doAccept = async () => {
    setBusy(true);
    await acceptPending();
    setBusy(false);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (noteOpen) setNoteOpen(false);
      else setConfirmDiscard(true);
    }
  };

  return (
    <section ref={rootRef} className="sug__inner" onKeyDown={onKey}>
      <div className="sug__head">
        <strong>{t('suggestion.title')}</strong>
        <span>{t(`suggestion.mode.${pending.mode}`)}</span>
        {chapter !== undefined ? (
          <span>
            {t('common.chapter')} {chapter}
          </span>
        ) : null}
        {edited ? <span className="chip">{t('suggestion.edited')}</span> : null}
        <span className="grow" />
        <button type="button" className="btn btn--ghost small" onClick={() => onCollapse(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? t('suggestion.expand') : t('suggestion.collapse')}
        </button>
      </div>
      {collapsed ? (
        <div className="sug__bar small muted">
          <span>{t('suggestion.collapsed', { words, wordsLabel: plural(language, words, [t('suggestion.words.one'), t('suggestion.words.few'), t('suggestion.words.many')]) })}</span>
          <span className="grow" />
          <button type="button" className="btn btn--primary small" onClick={() => void doAccept()} disabled={busy}>
            {t('suggestion.accept')}
          </button>
        </div>
      ) : (
        <>
          <div className="sug__body">
            <textarea
              className="prose sug__text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDraft(pending.front.id, e.target.value);
              }}
              aria-label={t('suggestion.editor')}
              lang={language}
              spellCheck={false}
            />
            <div className="sug__lint small">
              {pending.lint.hits.length === 0 ? (
                <span className="muted">{t('suggestion.lint.clean')}</span>
              ) : (
                <>
                  <button type="button" className="btn btn--ghost small" onClick={() => setShowLint((v) => !v)} aria-expanded={showLint}>
                    {t('suggestion.lint.counts', { errors: counts.error, warnings: counts.warning, info: counts.info })} · {showLint ? t('suggestion.lint.hide') : t('suggestion.lint.show')}
                  </button>
                  {showLint ? (
                    <ul>
                      {pending.lint.hits.map((hit, index) => (
                        <li key={index}>
                          <span className={`chip chip--${hit.severity}`}>{hit.rule}</span> {pick(language, hit.message)} <span className="muted">«{hit.excerpt}»</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
            {pending.warnings.length > 0 ? (
              <div className="small sug__warning">
                {t('suggestion.warnings')}: {pending.warnings.join(' · ')}
              </div>
            ) : null}
            <div className="small faint">{t('suggestion.meta', { model: pending.model, cost: pending.costUsd.toFixed(4), words, wordsLabel: plural(language, words, [t('suggestion.words.one'), t('suggestion.words.few'), t('suggestion.words.many')]) })}</div>
          </div>
          <div className="sug__foot">
            {confirmDiscard ? (
              <>
                <span>{t('suggestion.discard.confirm')}</span>
                <button type="button" className="btn btn--danger" onClick={() => void discard()} data-autofocus>
                  {t('suggestion.discard.yes')}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
                  {t('suggestion.discard.no')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--primary" onClick={() => void doAccept()} disabled={busy} title="Ctrl+Shift+Enter">
                  {t('suggestion.accept')}
                </button>
                <button type="button" className="btn" onClick={() => void retry()} disabled={busy}>
                  {t('suggestion.retry')}
                </button>
                <button type="button" className="btn" onClick={() => setNoteOpen((v) => !v)} disabled={busy} aria-expanded={noteOpen}>
                  {t('suggestion.retryNote')}
                </button>
                <span className="grow" />
                <button type="button" className="btn btn--ghost btn--danger" onClick={() => setConfirmDiscard(true)} disabled={busy}>
                  {t('suggestion.discard')}
                </button>
              </>
            )}
            {noteOpen && !confirmDiscard ? (
              <form
                className="sug__note"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  setNoteOpen(false);
                  void retry(note.trim());
                }}
              >
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('suggestion.note.placeholder')} aria-label={t('suggestion.retryNote')} autoFocus />
                <button type="submit" className="btn" disabled={!note.trim()}>
                  {t('suggestion.note.send')}
                </button>
              </form>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The inline suggestion block under the editor: the arriving text while a Write streams,
 * then the pending suggestion with Accept, Retry, Retry with note and Discard. After an
 * Accept it offers the chronicle update for the chapter. Prose reaches the chapter only
 * through `acceptSuggestion`.
 */
export function SuggestionBlock() {
  const t = useT();
  const stream = useStore((s) => s.suggestion.stream);
  const pending = useStore((s) => s.suggestion.pending);
  const openChronicleUpdate = useDialogs((s) => s.openChronicleUpdate);
  const chronicleDialog = useDialogs((s) => s.chronicleUpdate);
  const stem = useStore((s) => s.editor.stem);
  const accepted = useSuggestionDraft((s) => s.accepted);
  const clearAccepted = useSuggestionDraft((s) => s.clearAccepted);
  const [collapsed, setCollapsed] = useState(false);

  // The offer goes away when a new Write starts, when the chronicle update opens from anywhere
  // (palette, panel) or when the Author moves to another chapter.
  useEffect(() => {
    if (pending || stream.active || chronicleDialog) clearAccepted();
  }, [pending, stream.active, chronicleDialog, clearAccepted]);
  useEffect(() => {
    const mark = useSuggestionDraft.getState().accepted;
    if (mark && mark.stem !== stem) clearAccepted();
  }, [stem, clearAccepted]);

  if (stream.active) {
    return (
      <section className="sug" aria-live="polite" aria-label={t('suggestion.streaming')}>
        <Streaming stream={stream} />
      </section>
    );
  }
  if (pending) {
    return (
      <section className={`sug${collapsed ? ' sug--collapsed' : ''}`} aria-label={t('suggestion.title')}>
        <Pending key={pending.front.id} pending={pending} collapsed={collapsed} onCollapse={setCollapsed} />
      </section>
    );
  }
  if (accepted && accepted.chapter !== undefined) {
    const chapter = accepted.chapter;
    return (
      <section className="sug sug--collapsed" role="status" aria-label={t('suggestion.chronicle.ask', { n: chapter })}>
        <div className="sug__bar">
          <span>{t('suggestion.chronicle.ask', { n: chapter })}</span>
          <span className="grow" />
          <button
            type="button"
            className="btn btn--primary small"
            onClick={() => {
              clearAccepted();
              openChronicleUpdate(chapter);
            }}
          >
            {t('suggestion.chronicle.go')}
          </button>
          <button type="button" className="btn btn--ghost small" onClick={clearAccepted}>
            {t('suggestion.chronicle.later')}
          </button>
        </div>
      </section>
    );
  }
  return null;
}
