import { useStore } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

/** Placeholder until the inline suggestion block lands: streaming text and accept/discard. */
export function SuggestionBlock() {
  const t = useT();
  const stream = useStore((s) => s.suggestion.stream);
  const pending = useStore((s) => s.suggestion.pending);
  const accept = useStore((s) => s.acceptSuggestion);
  const discard = useStore((s) => s.discardSuggestion);
  const cancel = useStore((s) => s.cancelWrite);
  if (!stream.active && !pending) return null;
  return (
    <section className="card" style={{ position: 'absolute', left: '2rem', right: '2rem', bottom: '1rem', maxHeight: '45%', overflow: 'auto' }} aria-live="polite">
      <div className="prose" style={{ whiteSpace: 'pre-wrap' }}>
        {stream.active ? stream.text : pending?.text}
      </div>
      <div className="row">
        {stream.active ? (
          <button className="btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
        ) : (
          <>
            <button className="btn btn--primary" onClick={() => void accept()}>
              {t('common.accept')}
            </button>
            <button className="btn" onClick={() => void discard()}>
              {t('common.discard')}
            </button>
            <span className="grow" />
            <span className="small muted">
              {pending?.model} · ${pending?.costUsd.toFixed(4)}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
