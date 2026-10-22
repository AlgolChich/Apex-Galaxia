import { EditorView } from '@codemirror/view';
import { ApexClient, MockTransport, setClient, type MockTool } from '../../api/index.js';
import type { ChapterSummary, LintReport } from '../../api/types.js';
import { useStore, type AppState } from '../../state/store.js';

/** The store as it was at module load: actions and the initial slices. */
export const initialState: AppState = useStore.getState();

export const CHAPTER: ChapterSummary = { number: 1, title: 'Смена', status: 'draft', stem: '01-smena', words: 8 };

export const CLEAN_REPORT: LintReport = { hits: [], counts: { error: 0, warning: 0, info: 0 }, words: 0, paragraphs: 0 };

/** Reset the store to a project with one open chapter whose body is `body`. */
export function openChapter(body: string, overrides: Partial<AppState> = {}): void {
  useStore.setState(
    {
      ...initialState,
      connection: { status: 'ready', model: { provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: null } },
      project: { root: '/p', chapters: [CHAPTER], spentUsd: 0 },
      editor: { stem: CHAPTER.stem as string, front: { number: 1, title: CHAPTER.title, status: 'draft' }, body, savedBody: body, dirty: false, cursor: 0, selection: { from: 0, to: 0 }, saving: false },
      lint: { running: false },
      suggestion: { pending: undefined, stream: { active: false, text: '', mode: 'continue', startedAt: 0, abort: undefined } },
      ui: { ...initialState.ui, language: 'en', view: 'editor', panel: null, treeOpen: true, focusMode: false, paletteOpen: false, toasts: [], recent: [] },
      ...overrides,
    },
    true,
  );
}

/** Reset the store to the state before any project is open. */
export function resetStore(overrides: Partial<AppState> = {}): void {
  useStore.setState({ ...initialState, ui: { ...initialState.ui, language: 'en', toasts: [], recent: [] }, ...overrides }, true);
}

/** Install a mock client whose tools answer with sensible defaults; `tools` override or add. */
export function installMockClient(tools: Record<string, MockTool> = {}): MockTransport {
  const transport = new MockTransport({
    model_status: () => ({ provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: '/p' }),
    project_open: (args) => ({ root: args['path'], config: { title: 'Маяк', language: 'ru' }, chapters: [CHAPTER], spentUsd: 0 }),
    project_chapters: () => ({ chapters: [CHAPTER] }),
    chapter_get: () => ({ front: { number: 1, title: CHAPTER.title, status: 'draft' }, stem: CHAPTER.stem, path: '/p/chapters/01-smena.md', body: 'Текст главы.' }),
    chapter_save: (args) => ({ front: { number: 1, title: (args['title'] as string | undefined) ?? CHAPTER.title, status: (args['status'] as string | undefined) ?? 'draft', words: 2 }, stem: CHAPTER.stem, path: '/p/chapters/01-smena.md' }),
    lint: () => CLEAN_REPORT,
    ...tools,
  });
  setClient(new ApexClient(transport));
  return transport;
}

/** The CodeMirror view mounted inside `container`. */
export function findView(container: HTMLElement): EditorView {
  const dom = container.querySelector<HTMLElement>('.cm-editor');
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) throw new Error('no CodeMirror view in the container');
  return view;
}
