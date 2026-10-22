import { useEffect } from 'react';
import { useT } from '../../i18n/index.js';
import { useStore, type Panel, type Theme, type View } from '../../state/store.js';
import { FrameSizing } from './Frame.js';
import { describeModel } from './model.js';

export const VIEWS: readonly View[] = ['editor', 'bible', 'chronicle', 'plan', 'run', 'settings'];
export const PANELS: readonly Panel[] = ['bible', 'chronicle', 'lint', 'critic', 'inspector'];
const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

/** The modifier key as the platform names it, for shortcut hints. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';

/**
 * The application bar: project title, view switcher (Ctrl/Cmd+1..6), panel toggles, the
 * palette, language and theme toggles and the model badge. Global shortcuts that no focused
 * control claimed are handled here.
 */
export function TopBar() {
  const t = useT();
  const title = useStore((s) => s.project.config?.title);
  const root = useStore((s) => s.project.root);
  const view = useStore((s) => s.ui.view);
  const panel = useStore((s) => s.ui.panel);
  const treeOpen = useStore((s) => s.ui.treeOpen);
  const language = useStore((s) => s.ui.language);
  const theme = useStore((s) => s.ui.theme);
  const connection = useStore((s) => s.connection);
  const setView = useStore((s) => s.setView);
  const togglePanel = useStore((s) => s.togglePanel);
  const toggleTree = useStore((s) => s.toggleTree);
  const setPalette = useStore((s) => s.setPalette);
  const setLanguage = useStore((s) => s.setLanguage);
  const setTheme = useStore((s) => s.setTheme);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const state = useStore.getState();
      if (!event.shiftKey && /^[1-6]$/.test(event.key)) {
        const target = VIEWS[Number(event.key) - 1];
        if (target && state.project.root) {
          event.preventDefault();
          state.setView(target);
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's' && !event.shiftKey) {
        event.preventDefault();
        void state.saveChapter();
      } else if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        state.toggleFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const otherLanguage = language === 'ru' ? 'en' : 'ru';
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'system';
  const badge = describeModel(connection, t);

  return (
    <header className="topbar" aria-label={t('layout.topbar')}>
      <FrameSizing />
      <button type="button" className="topbar__btn topbar__btn--tree" aria-pressed={treeOpen} aria-label={t('layout.tree.toggle')} title={t('layout.tree.toggle')} onClick={() => toggleTree()} disabled={!root}>
        <span className="topbar__bars" aria-hidden="true" />
      </button>
      <span className="topbar__title" title={root ?? ''}>
        {title ?? t('app.name')}
      </span>
      <nav className="topbar__group" aria-label={t('layout.views')}>
        <span className="topbar__group-label" aria-hidden="true">
          {t('layout.views')}
        </span>
        {VIEWS.map((item, index) => (
          <button
            key={item}
            type="button"
            className="topbar__btn"
            aria-pressed={view === item}
            title={t('layout.shortcut', { keys: `${MOD}+${index + 1}` })}
            onClick={() => setView(item)}
            disabled={!root}
          >
            {t(`layout.view.${item}`)}
          </button>
        ))}
      </nav>
      <div className="topbar__group" role="group" aria-label={t('layout.panels')}>
        <span className="topbar__group-label" aria-hidden="true">
          {t('layout.panels')}
        </span>
        {PANELS.map((item) => (
          <button key={item} type="button" className="topbar__btn" aria-pressed={panel === item} onClick={() => togglePanel(item)} disabled={!root}>
            {t(`layout.panel.${item}`)}
          </button>
        ))}
      </div>
      <span className="topbar__spacer" />
      <button type="button" className="topbar__btn" onClick={() => setPalette(true)} title={t('layout.shortcut', { keys: `${MOD}+K` })} aria-label={t('layout.palette')}>
        <span className="topbar__palette-text">{t('layout.palette')}</span>
        <kbd className="kbd">{MOD} K</kbd>
      </button>
      <button
        type="button"
        className="topbar__btn"
        aria-label={t('layout.language.switch', { current: t(`layout.language.${language}`), other: t(`layout.language.${otherLanguage}`) })}
        title={t('layout.language.switch', { current: t(`layout.language.${language}`), other: t(`layout.language.${otherLanguage}`) })}
        onClick={() => setLanguage(otherLanguage)}
      >
        {language.toUpperCase()}
      </button>
      <button
        type="button"
        className="topbar__btn"
        aria-label={t('layout.theme.switch', { current: t(`app.theme.${theme}`), next: t(`app.theme.${nextTheme}`) })}
        title={t('layout.theme.switch', { current: t(`app.theme.${theme}`), next: t(`app.theme.${nextTheme}`) })}
        onClick={() => setTheme(nextTheme)}
      >
        {t(`app.theme.${theme}`)}
      </button>
      <span className={`topbar__model topbar__model--${badge.tone}`} title={badge.detail} aria-label={`${t('layout.model.badge')}: ${badge.detail}`}>
        {badge.label}
      </span>
    </header>
  );
}
