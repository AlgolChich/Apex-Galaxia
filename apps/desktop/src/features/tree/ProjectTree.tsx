import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getClient } from '../../api/index.js';
import type { ChapterStatus, ChapterSummary } from '../../api/types.js';
import { plural, useLanguage, useT } from '../../i18n/index.js';
import { useStore, type View } from '../../state/store.js';
import { ResizeHandle, TREE_MAX, TREE_MIN, useFrame } from '../layout/index.js';

const STATUSES: readonly ChapterStatus[] = ['planned', 'draft', 'revised', 'final'];
const ENTRIES: ReadonlyArray<{ view: View; key: string }> = [
  { view: 'bible', key: 'tree.bible' },
  { view: 'chronicle', key: 'tree.chronicle' },
  { view: 'plan', key: 'tree.plan' },
  { view: 'run', key: 'tree.runs' },
  { view: 'settings', key: 'tree.settings' },
];
const WORDS = { ru: ['слово', 'слова', 'слов'] as [string, string, string], en: ['word', 'words'] as [string, string] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Save a front-matter change (title, status) through chapter_save, then refresh the tree and the editor. */
async function saveFront(chapter: ChapterSummary, front: { title?: string; status?: ChapterStatus }): Promise<void> {
  const state = useStore.getState();
  const ref = chapter.stem ?? chapter.number;
  try {
    const isCurrent = state.editor.stem !== undefined && state.editor.front?.number === chapter.number;
    const body = isCurrent ? state.editor.body : (await getClient().chapterGet(ref)).body;
    await getClient().chapterSave(ref, body, front);
    await state.reloadChapters();
    await state.loadChapter(ref);
  } catch (error) {
    state.toast('error', errorText(error));
  }
}

/**
 * The left navigator: chapters (number, title, status, words) with their actions, then the
 * Bible, Chronicle, Plan, Runs and Settings entries. Rows are buttons; arrow keys move
 * between them, Enter opens.
 */
export function ProjectTreeBase() {
  const t = useT();
  const language = useLanguage();
  const chapters = useStore((s) => s.project.chapters);
  const currentNumber = useStore((s) => s.editor.front?.number);
  const currentStem = useStore((s) => s.editor.stem);
  const view = useStore((s) => s.ui.view);
  const pending = useStore((s) => s.suggestion.pending);
  const loadChapter = useStore((s) => s.loadChapter);
  const setView = useStore((s) => s.setView);
  const createChapter = useStore((s) => s.createChapter);
  const treeWidth = useFrame((s) => s.treeWidth);
  const setTreeWidth = useFrame((s) => s.setTreeWidth);
  const navRef = useRef<HTMLElement>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const openChapter = (chapter: ChapterSummary) => {
    setView('editor');
    void loadChapter(chapter.stem ?? chapter.number);
  };

  const newChapter = () => {
    const title = window.prompt(t('tree.newChapterTitle'));
    if (title && title.trim()) void createChapter(title.trim());
  };

  const rename = (chapter: ChapterSummary) => {
    setMenuFor(null);
    const title = window.prompt(t('tree.renamePrompt'), chapter.title);
    if (!title || !title.trim() || title.trim() === chapter.title) return;
    void saveFront(chapter, { title: title.trim() });
  };

  const setStatus = (chapter: ChapterSummary, status: ChapterStatus) => {
    setMenuFor(null);
    if (status === chapter.status) return;
    void saveFront(chapter, { status });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (menuFor !== null && event.key === 'Escape') {
      event.preventDefault();
      setMenuFor(null);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(navRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []);
    if (rows.length === 0) return;
    const index = rows.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(rows.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = index < 0 ? rows.length - 1 : Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else next = rows.length - 1;
    event.preventDefault();
    rows[next]?.focus();
  };

  return (
    <nav ref={navRef} className="tree" aria-label={t('tree.label')} style={{ width: `${treeWidth}px` }} onKeyDown={onKeyDown}>
      <section className="tree__section" aria-labelledby="tree-chapters">
        <div className="tree__heading-row">
          <h2 id="tree-chapters" className="tree__heading">
            {t('tree.chapters')}
          </h2>
          <button type="button" className="tree__add" aria-label={t('tree.newChapter')} title={t('tree.newChapter')} onClick={newChapter}>
            +
          </button>
        </div>
        {chapters.length === 0 ? <div className="tree__empty">{t('tree.noChapters')}</div> : null}
        <ul className="tree__list" role="list">
          {chapters.map((chapter) => {
            const isCurrent = currentStem !== undefined && chapter.number === currentNumber;
            return (
              <li key={chapter.stem ?? chapter.number} className={`tree__item${isCurrent ? ' tree__item--current' : ''}`}>
                <button
                  type="button"
                  data-tree-row
                  className="tree__row"
                  aria-current={isCurrent && view === 'editor' ? 'true' : undefined}
                  aria-label={`${chapter.number}. ${chapter.title}, ${t(`tree.status.${chapter.status}`)}, ${chapter.words ?? 0} ${plural(language, chapter.words ?? 0, WORDS[language])}${isCurrent ? `, ${t('tree.current')}` : ''}`}
                  onClick={() => openChapter(chapter)}
                >
                  <span className="tree__number">{chapter.number}</span>
                  <span className="tree__title">{chapter.title}</span>
                  <span className={`tree__dot tree__dot--${chapter.status}`} title={t(`tree.status.${chapter.status}`)} aria-hidden="true" />
                  <span className="tree__words">{(chapter.words ?? 0).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}</span>
                </button>
                <button
                  type="button"
                  className="tree__more"
                  aria-haspopup="menu"
                  aria-expanded={menuFor === chapter.number}
                  aria-label={t('tree.chapterActions', { n: chapter.number })}
                  onClick={() => setMenuFor(menuFor === chapter.number ? null : chapter.number)}
                >
                  …
                </button>
                {menuFor === chapter.number ? <ChapterMenu chapter={chapter} onRename={() => rename(chapter)} onStatus={(status) => setStatus(chapter, status)} onClose={() => setMenuFor(null)} /> : null}
              </li>
            );
          })}
          {pending ? (
            <li className="tree__item">
              <button type="button" data-tree-row className="tree__row tree__row--suggestions" onClick={() => setView('editor')}>
                <span className="tree__title">{t('tree.suggestions')}</span>
                <span className="tree__count">1</span>
              </button>
            </li>
          ) : null}
        </ul>
      </section>
      <section className="tree__section" aria-labelledby="tree-story">
        <h2 id="tree-story" className="tree__heading">
          {t('tree.story')}
        </h2>
        <ul className="tree__list" role="list">
          {ENTRIES.map((entry) => (
            <li key={entry.view} className={`tree__item${view === entry.view ? ' tree__item--current' : ''}`}>
              <button type="button" data-tree-row className="tree__row" aria-current={view === entry.view ? 'page' : undefined} onClick={() => setView(entry.view)}>
                <span className="tree__title">{t(entry.key)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <ResizeHandle side="right" value={treeWidth} min={TREE_MIN} max={TREE_MAX} label={t('layout.resize.tree')} onChange={setTreeWidth} />
    </nav>
  );
}

/** The actions of one chapter: rename, and the status as a radio group. */
function ChapterMenu({ chapter, onRename, onStatus, onClose }: { chapter: ChapterSummary; onRename(): void; onStatus(status: ChapterStatus): void; onClose(): void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div ref={ref} role="menu" className="tree__menu" aria-label={t('tree.chapterActions', { n: chapter.number })} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" className="tree__menu-item" onClick={onRename}>
        {t('tree.rename')}
      </button>
      <div className="tree__menu-label" aria-hidden="true">
        {t('tree.status')}
      </div>
      {STATUSES.map((status) => (
        <button key={status} type="button" role="menuitemradio" aria-checked={chapter.status === status} className="tree__menu-item" onClick={() => onStatus(status)}>
          <span className={`tree__dot tree__dot--${status}`} aria-hidden="true" />
          {t(`tree.status.${status}`)}
        </button>
      ))}
    </div>
  );
}
