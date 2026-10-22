import type { Panel } from '../../state/store.js';
import { useT } from '../../i18n/index.js';

/** Placeholder until the right panel (Bible, Chronicle, Lint, Critic, Inspector) lands. */
export function RightPanel({ panel }: { panel: Panel }) {
  const t = useT();
  return (
    <aside style={{ width: '20rem', borderLeft: '1px solid var(--border)', padding: '0.75rem', height: '100%', overflow: 'auto' }}>
      <div className="small muted">{panel}</div>
      <div className="muted">{t('common.nothing')}</div>
    </aside>
  );
}
