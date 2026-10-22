import type { KeyboardEvent } from 'react';
import { useT } from '../../i18n/index.js';
import { useStore, type Panel } from '../../state/store.js';
import { BibleTab } from './bible.js';
import { ChronicleTab } from './chronicle.js';
import { CriticTab } from './critic.js';
import { InspectorTab } from './inspector.js';
import { LintTab } from './lint.js';
import './panels.css';

export { runCritic } from './critic.js';
export { usePanels } from './state.js';
export { aliasesInBody } from './bible.js';
export { markdownParagraphs } from './chronicle.js';

const TABS: Panel[] = ['bible', 'chronicle', 'lint', 'critic', 'inspector'];

/** The right panel: Bible, Chronicle, Lint, Critic, Inspector. Which tab is open lives in `ui.panel`. */
export function RightPanel({ panel }: { panel: Panel }) {
  const t = useT();
  const togglePanel = useStore((s) => s.togglePanel);
  const select = (tab: Panel) => {
    if (tab !== panel) togglePanel(tab);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length]!;
    select(next);
    (event.currentTarget.parentElement?.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <aside className="panel" aria-label={t('panels.label')}>
      <div className="panel__tabs" role="tablist" aria-label={t('panels.label')}>
        {TABS.map((tab, index) => (
          <button key={tab} type="button" role="tab" data-tab={tab} className="panel__tab" aria-selected={tab === panel} aria-controls={`panel-${tab}`} tabIndex={tab === panel ? 0 : -1} onClick={() => select(tab)} onKeyDown={(e) => onTabKey(e, index)}>
            {t(`panels.tab.${tab}`)}
          </button>
        ))}
        <button type="button" className="panel__close" onClick={() => togglePanel(panel)} aria-label={t('panels.close')} title={t('panels.close')}>
          ×
        </button>
      </div>
      <div className="panel__body" role="tabpanel" id={`panel-${panel}`} aria-label={t(`panels.tab.${panel}`)}>
        {panel === 'bible' ? <BibleTab /> : null}
        {panel === 'chronicle' ? <ChronicleTab /> : null}
        {panel === 'lint' ? <LintTab /> : null}
        {panel === 'critic' ? <CriticTab /> : null}
        {panel === 'inspector' ? <InspectorTab /> : null}
      </div>
    </aside>
  );
}
