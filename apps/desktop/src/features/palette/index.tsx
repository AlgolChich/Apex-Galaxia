import { useStore } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

/** Placeholder until the command palette lands. */
export function CommandPalette() {
  const t = useT();
  const setPalette = useStore((s) => s.setPalette);
  return (
    <div role="dialog" aria-modal="true" className="card" style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', width: '32rem', boxShadow: 'var(--shadow)' }}>
      <div className="row">
        <input className="input" autoFocus placeholder={t('common.search')} onKeyDown={(e) => e.key === 'Escape' && setPalette(false)} />
        <button className="btn btn--ghost" onClick={() => setPalette(false)}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
