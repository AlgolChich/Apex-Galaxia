import { useEffect, useMemo, useRef, useState } from 'react';
import { plural, useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { useEditorSettings } from '../editor/editor-store.js';
import { countWords } from '../editor/words.js';
import { describeModel } from './model.js';

const WORDS = { ru: ['слово', 'слова', 'слов'] as [string, string, string], en: ['word', 'words'] as [string, string] };
const ERRORS = { ru: ['ошибка', 'ошибки', 'ошибок'] as [string, string, string], en: ['error', 'errors'] as [string, string] };
const WARNINGS = { ru: ['предупреждение', 'предупреждения', 'предупреждений'] as [string, string, string], en: ['warning', 'warnings'] as [string, string] };
const NOTES = { ru: ['заметка', 'заметки', 'заметок'] as [string, string, string], en: ['note', 'notes'] as [string, string] };

/** "Saved" for two seconds after a save completes with nothing left unsaved. */
function useSavedFlash(saving: boolean, dirty: boolean): boolean {
  const [flash, setFlash] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    const finished = wasSaving.current && !saving && !dirty;
    wasSaving.current = saving;
    if (!finished) return undefined;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 2000);
    return () => window.clearTimeout(id);
  }, [saving, dirty]);
  return flash;
}

/**
 * The status bar: words of the chapter, the project and the selection, the in-story date,
 * save state, lint counts (click opens the lint panel), typewriter and focus indicators, the
 * money spent on the project and the model in small print.
 */
export function StatusBar() {
  const t = useT();
  const language = useLanguage();
  const stem = useStore((s) => s.editor.stem);
  const body = useStore((s) => s.editor.body);
  const front = useStore((s) => s.editor.front);
  const selection = useStore((s) => s.editor.selection);
  const dirty = useStore((s) => s.editor.dirty);
  const saving = useStore((s) => s.editor.saving);
  const chapters = useStore((s) => s.project.chapters);
  const root = useStore((s) => s.project.root);
  const spent = useStore((s) => s.project.spentUsd);
  const report = useStore((s) => s.lint.report);
  const lintStem = useStore((s) => s.lint.stem);
  const lintRunning = useStore((s) => s.lint.running);
  const panel = useStore((s) => s.ui.panel);
  const focusMode = useStore((s) => s.ui.focusMode);
  const togglePanel = useStore((s) => s.togglePanel);
  const connection = useStore((s) => s.connection);
  const typewriter = useEditorSettings((s) => s.typewriter);
  const setTypewriter = useEditorSettings((s) => s.setTypewriter);
  const saved = useSavedFlash(saving, dirty);

  const chapterWords = useMemo(() => countWords(body), [body]);
  const currentNumber = front?.number;
  const projectWords = useMemo(() => {
    let total = 0;
    let seen = false;
    for (const chapter of chapters) {
      if (stem && chapter.number === currentNumber) {
        total += chapterWords;
        seen = true;
      } else total += chapter.words ?? 0;
    }
    if (stem && !seen) total += chapterWords;
    return total;
  }, [chapters, chapterWords, currentNumber, stem]);
  const selectedWords = useMemo(() => (selection.to > selection.from ? countWords(body.slice(selection.from, selection.to)) : 0), [body, selection.from, selection.to]);

  const words = (n: number) => `${n.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')} ${plural(language, n, WORDS[language])}`;
  const counts = report && lintStem === stem ? report.counts : undefined;
  const lintSummary = counts
    ? counts.error + counts.warning + counts.info === 0
      ? t('layout.status.lintClean')
      : [
          counts.error > 0 ? `${counts.error} ${plural(language, counts.error, ERRORS[language])}` : '',
          counts.warning > 0 ? `${counts.warning} ${plural(language, counts.warning, WARNINGS[language])}` : '',
          counts.info > 0 ? `${counts.info} ${plural(language, counts.info, NOTES[language])}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
    : '';
  const badge = describeModel(connection, t);

  return (
    <footer className="statusbar" aria-label={t('layout.status.bar')}>
      {stem ? (
        <>
          <span className="statusbar__item" title={t('layout.status.chapter')}>
            <span className="statusbar__label">{t('layout.status.chapter')}</span>
            <span data-testid="status-chapter-words">{words(chapterWords)}</span>
          </span>
          <span className="statusbar__item" title={t('layout.status.project')}>
            <span className="statusbar__label">{t('layout.status.project')}</span>
            <span data-testid="status-project-words">{words(projectWords)}</span>
          </span>
          {selectedWords > 0 ? (
            <span className="statusbar__item" title={t('layout.status.selected')}>
              <span className="statusbar__label">{t('layout.status.selected')}</span>
              <span data-testid="status-selected-words">{words(selectedWords)}</span>
            </span>
          ) : null}
          {front?.in_story_date ? (
            <span className="statusbar__item" title={t('layout.status.date')}>
              <span className="statusbar__label">{t('layout.status.date')}</span>
              <span>{front.in_story_date}</span>
            </span>
          ) : null}
        </>
      ) : root ? (
        <span className="statusbar__item">
          <span className="statusbar__label">{t('layout.status.project')}</span>
          <span data-testid="status-project-words">{words(projectWords)}</span>
        </span>
      ) : null}
      <span className="statusbar__spacer" />
      {stem ? (
        <span className="statusbar__item" role="status" aria-live="polite">
          {saving ? <span className="statusbar__saving">{t('layout.status.saving')}</span> : dirty ? <span className="statusbar__dirty">{t('layout.status.unsaved')}</span> : saved ? <span className="statusbar__saved">{t('layout.status.saved')}</span> : null}
        </span>
      ) : null}
      {stem ? (
        <button type="button" className="statusbar__btn" aria-pressed={panel === 'lint'} aria-label={t('layout.status.lintOpen', { summary: lintRunning ? t('layout.status.lintRunning') : lintSummary })} onClick={() => panel !== 'lint' && togglePanel('lint')}>
          {counts && counts.error > 0 ? <span className="statusbar__dot statusbar__dot--error" aria-hidden="true" /> : null}
          {counts && counts.warning > 0 ? <span className="statusbar__dot statusbar__dot--warning" aria-hidden="true" /> : null}
          {counts && counts.info > 0 ? <span className="statusbar__dot statusbar__dot--info" aria-hidden="true" /> : null}
          <span data-testid="status-lint">{lintRunning ? t('layout.status.lintRunning') : lintSummary}</span>
        </button>
      ) : null}
      <button type="button" className="statusbar__btn" aria-pressed={typewriter} aria-label={t('layout.status.typewriterToggle')} title={t('layout.status.typewriterToggle')} onClick={() => setTypewriter()}>
        {t('layout.status.typewriter')}
      </button>
      {focusMode ? (
        <span className="statusbar__item statusbar__focus">
          {t('layout.status.focus')} · <kbd className="kbd">Esc</kbd>
        </span>
      ) : null}
      {root ? (
        <span className="statusbar__item" title={t('common.cost')}>
          <span className="statusbar__label">{t('layout.status.cost')}</span>
          <span data-testid="status-cost">${spent.toFixed(2)}</span>
        </span>
      ) : null}
      <span className={`statusbar__item statusbar__model statusbar__model--${badge.tone}`} title={badge.detail}>
        {badge.label}
      </span>
    </footer>
  );
}
