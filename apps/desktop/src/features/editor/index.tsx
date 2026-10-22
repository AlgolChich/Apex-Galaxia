import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { mountEditor } from './controller.js';
import { useEditorSettings } from './editor-store.js';
import './editor.css';

export { useEditorSettings } from './editor-store.js';
export { EDITOR_EVENT, SELECTION_EVENT, sendEditorCommand, type EditorCommand, type EditorSelectionDetail } from './events.js';
export { countWords } from './words.js';

/**
 * The distraction-free prose editor (Section 11.1): CodeMirror 6 in Markdown mode, serif,
 * one measure, typewriter scrolling, lint underlines. All document state lives in the store;
 * the controller keeps the view and the store in step.
 */
export function Editor() {
  const stem = useStore((s) => s.editor.stem);
  const focusMode = useStore((s) => s.ui.focusMode);
  const typewriter = useEditorSettings((s) => s.typewriter);
  if (!stem) return <EditorEmpty />;
  return (
    <div className={`editor${typewriter ? ' editor--typewriter' : ''}${focusMode ? ' editor--focus' : ''}`}>
      <EditorSurface key={stem} stem={stem} />
      {focusMode ? <FocusHint /> : null}
    </div>
  );
}

function EditorSurface({ stem }: { stem: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = mountEditor(host, stem);
    return () => controller.destroy();
  }, [stem]);
  return <div className="editor__host" ref={hostRef} />;
}

/** No chapter open: say how to get one. */
function EditorEmpty() {
  const t = useT();
  const createChapter = useStore((s) => s.createChapter);
  const chapters = useStore((s) => s.project.chapters.length);
  const create = () => {
    const title = window.prompt(t('editor.newChapterTitle'));
    if (title && title.trim()) void createChapter(title.trim());
  };
  return (
    <div className="editor-empty">
      <div className="editor-empty__card">
        <h2 className="editor-empty__title">{t('editor.empty.title')}</h2>
        <p className="editor-empty__text">{t('editor.empty.text')}</p>
        <button type="button" className={`btn${chapters === 0 ? ' btn--primary' : ''}`} onClick={create}>
          {t('editor.empty.create')}
        </button>
      </div>
    </div>
  );
}

/** A faint reminder that fades after a few seconds each time focus mode is entered. */
function FocusHint() {
  const t = useT();
  return (
    <div className="editor__focus-hint" role="status">
      {t('editor.focusHint')}
    </div>
  );
}
