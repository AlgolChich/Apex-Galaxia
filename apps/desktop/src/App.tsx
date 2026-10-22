import { useEffect } from 'react';
import { useStore } from './state/store.js';
import { useT } from './i18n/index.js';
import { CandidatesDialog } from './features/candidates/index.js';
import { CanvasView } from './features/canvas/index.js';
import { NarratorPanel } from './features/chat/index.js';
import { ChronicleUpdateDialog } from './features/chronicle-update/index.js';
import { ImportDialog } from './features/import/index.js';
import { DescribeDialog } from './features/describe/index.js';
import { DiffDialog } from './features/diff/index.js';
import { Editor } from './features/editor/index.js';
import { StatusBar, TopBar } from './features/layout/index.js';
import { CommandPalette } from './features/palette/index.js';
import { RightPanel } from './features/panels/index.js';
import { SettingsView } from './features/settings/index.js';
import { SuggestionBlock } from './features/suggestion/index.js';
import { ProjectTree } from './features/tree/index.js';
import { BibleView, ChronicleView, PlanView, RunView } from './features/views/index.js';
import { Wizard } from './features/wizard/index.js';
import './app.css';

/**
 * The frame (Section 11.1): project tree left, the editor (or a view) center, the right
 * panel (Bible, Chronicle, Lint, Critic, Inspector), the status bar below. Features render
 * into fixed slots and talk to each other only through the store.
 */
export function App() {
  const t = useT();
  const status = useStore((s) => s.connection.status);
  const error = useStore((s) => s.connection.error);
  const root = useStore((s) => s.project.root);
  const ui = useStore((s) => s.ui);
  const connect = useStore((s) => s.connect);
  const setPalette = useStore((s) => s.setPalette);
  const toggleFocus = useStore((s) => s.toggleFocus);
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    document.documentElement.lang = ui.language;
    if (ui.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', ui.theme);
  }, [ui.language, ui.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(!useStore.getState().ui.paletteOpen);
      } else if (event.key === 'Escape' && useStore.getState().ui.focusMode && !useStore.getState().ui.paletteOpen) {
        toggleFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette, toggleFocus]);

  const main = (() => {
    if (ui.wizard !== 'none') return <Wizard mode={ui.wizard} />;
    if (status === 'connecting' || status === 'idle') return <div className="empty">{t('app.connecting')}</div>;
    if (status === 'error') {
      return (
        <div className="empty">
          <div className="stack">
            <div>{t('app.disconnected')}</div>
            <div className="small muted">{error}</div>
            <button className="btn" onClick={() => void connect()}>
              {t('app.reconnect')}
            </button>
          </div>
        </div>
      );
    }
    if (!root) return <ProjectTree.Welcome />;
    switch (ui.view) {
      case 'bible':
        return <BibleView />;
      case 'chronicle':
        return <ChronicleView />;
      case 'plan':
        return <PlanView />;
      case 'run':
        return <RunView />;
      case 'settings':
        return <SettingsView />;
      case 'canvas':
        return <CanvasView />;
      default:
        return (
          <>
            <Editor />
            <SuggestionBlock />
          </>
        );
    }
  })();

  return (
    <div className={`app${ui.focusMode ? ' app--focus' : ''}`} data-view={ui.view}>
      <div className="app__top">
        <TopBar />
      </div>
      <aside className="app__tree" aria-label={t('common.chapters')}>
        {ui.treeOpen && root ? <ProjectTree /> : null}
      </aside>
      <main className="app__main">{main}</main>
      <aside className="app__panel">{ui.panel === 'narrator' && root ? <NarratorPanel /> : ui.panel && root ? <RightPanel panel={ui.panel} /> : null}</aside>
      <div className="app__status">
        <StatusBar />
      </div>
      {ui.paletteOpen ? <CommandPalette /> : null}
      <DescribeDialog />
      <DiffDialog />
      <ChronicleUpdateDialog />
      <CandidatesDialog />
      <ImportDialog />
      <div className="toasts" role="status" aria-live="polite">
        {ui.toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`} onClick={() => dismissToast(toast.id)}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
