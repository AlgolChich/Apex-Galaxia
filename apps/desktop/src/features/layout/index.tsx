import { useStore } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

/** Placeholder until the layout feature lands: a thin top bar and a status bar. */
export function TopBar() {
  const t = useT();
  const title = useStore((s) => s.project.config?.title);
  const setPalette = useStore((s) => s.setPalette);
  return (
    <header className="row" style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
      <strong>{title ?? t('app.name')}</strong>
      <span className="grow" />
      <button className="btn btn--ghost small" onClick={() => setPalette(true)}>
        <span className="kbd">Ctrl K</span>
      </button>
    </header>
  );
}

export function StatusBar() {
  const t = useT();
  const words = useStore((s) => s.editor.front?.words ?? 0);
  const dirty = useStore((s) => s.editor.dirty);
  const model = useStore((s) => s.connection.model);
  return (
    <footer className="row small muted" style={{ padding: '0.25rem 0.75rem', borderTop: '1px solid var(--border)' }}>
      <span>
        {words} {t('common.words')}
      </span>
      {dirty ? <span>· {t('common.unsaved')}</span> : null}
      <span className="grow" />
      <span>{model?.scripted ? t('app.model.scripted') : model?.has_model ? t('app.model.anthropic') : t('app.model.none')}</span>
    </footer>
  );
}
