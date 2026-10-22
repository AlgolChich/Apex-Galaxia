import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { getClient } from '../../api/index.js';
import { ToolError, payload } from '../../api/mcp.js';
import type { EntryKind, ImportPreview, ImportResult, Language } from '../../api/types.js';
import { plural, useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { homeOfConfigFile, joinPath, slugOfTitle } from '../wizard/build.js';
import { Field, RadioCards, hintId } from '../wizard/field.js';
import { buildDossier, entryNames, hasFrontMatter } from './format.js';
import { IMPORT_EVENT, isImportKind, useImportStore, type ImportRequest, type ImportTarget } from './store.js';
import './import.css';

export { IMPORT_EVENT, openImport, useImportStore, type ImportKind, type ImportOutcome, type ImportRequest } from './store.js';
export { buildDossier, entryNames, parseSources } from './format.js';

const KINDS: EntryKind[] = ['character', 'location', 'faction', 'item'];
const STATUSES = ['draft', 'revised', 'final'] as const;
type ImportStatus = (typeof STATUSES)[number];

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** The manuscript or the Bible file: pasted text, or a path the core reads (the shell's file picker). */
interface Source {
  text: string;
  /** A path only in the desktop shell: the server reads it itself. */
  file: string | undefined;
  /** The browser's file name, for display: its text went into `text`. */
  name: string | undefined;
}

const EMPTY_SOURCE: Source = { text: '', file: undefined, name: undefined };

function hasSource(source: Source): boolean {
  return Boolean(source.file) || source.text.trim().length > 0;
}

function sourceArgs(source: Source): { file: string } | { text: string } {
  return source.file ? { file: source.file } : { text: source.text };
}

function SourcePicker({ id, value, onChange, hint, disabled, error, prose }: { id: string; value: Source; onChange: (source: Source) => void; hint: string; disabled: boolean; error?: string | undefined; prose?: boolean }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const shell = getClient().transport.shell;
  const input = useRef<HTMLInputElement>(null);

  const pick = async () => {
    if (!shell) {
      input.current?.click();
      return;
    }
    const chosen = await shell.pickFile({ title: t('import.source.file'), filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] });
    if (chosen) onChange({ text: '', file: chosen, name: chosen });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      onChange({ text: await file.text(), file: undefined, name: file.name });
    } catch (failure) {
      toast('error', errorText(failure));
    } finally {
      event.target.value = '';
    }
  };

  const fileHint = value.name && !value.file ? t('import.source.chosen', { name: value.name }) : shell ? t('import.source.fileHintShell') : t('import.source.fileHintBrowser');

  return (
    <div className="stack">
      {value.file ? (
        <Field id={`${id}-path`} label={t('import.source')} hint={hint} error={error}>
          <div className="import__file">
            <span id={`${id}-path`} className="mono grow" aria-live="polite">
              {value.file}
            </span>
            <button type="button" className="btn btn--ghost" onClick={() => onChange(EMPTY_SOURCE)} disabled={disabled}>
              {t('import.source.clear')}
            </button>
          </div>
        </Field>
      ) : (
        <Field id={id} label={t('import.source.paste')} hint={hint} error={error}>
          <textarea id={id} className={`textarea ${prose ? 'import__prose' : 'import__text'}`} rows={8} value={value.text} onChange={(e) => onChange({ text: e.target.value, file: undefined, name: undefined })} aria-describedby={hintId(id)} disabled={disabled} spellCheck={false} data-autofocus />
        </Field>
      )}
      <div className="row">
        {shell ? null : <input ref={input} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} />}
        <button type="button" className="btn" onClick={() => void pick()} disabled={disabled} aria-describedby={`${id}-file-hint`}>
          {t('import.source.file')}
        </button>
        <span className="field__hint" id={`${id}-file-hint`}>
          {fileHint}
        </span>
      </div>
    </div>
  );
}

// ---- Manuscript -----------------------------------------------------------------------------

function ManuscriptBody({ request }: { request: ImportRequest }) {
  const t = useT();
  const uiLanguage = useLanguage();
  const root = useStore((s) => s.project.root);
  const config = useStore((s) => s.project.config);
  const chapters = useStore((s) => s.project.chapters);
  const openProject = useStore((s) => s.openProject);
  const reloadChapters = useStore((s) => s.reloadChapters);
  const loadChapter = useStore((s) => s.loadChapter);
  const toast = useStore((s) => s.toast);
  const close = useImportStore((s) => s.close);
  const setBusy = useImportStore((s) => s.setBusy);
  const client = getClient();
  const shell = client.transport.shell;

  const [source, setSource] = useState<Source>(EMPTY_SOURCE);
  const [target, setTarget] = useState<ImportTarget>(request.target ?? (root ? 'open' : 'new'));
  const [path, setPath] = useState('');
  const [pathEdited, setPathEdited] = useState(false);
  const [home, setHome] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<'' | Language>('');
  const [detected, setDetected] = useState<Language | undefined>(undefined);
  const [status, setStatus] = useState<ImportStatus>('draft');
  const [preview, setPreview] = useState<{ key: string; data: ImportPreview } | undefined>(undefined);
  const [busy, setBusyLocal] = useState<'preview' | 'import' | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);

  // The home folder (from where the user config lives) for the suggested path, browser only.
  useEffect(() => {
    if (shell) return;
    let live = true;
    client.userConfigGet().then(
      (result) => {
        if (live) setHome(homeOfConfigFile(result.file));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, shell]);

  const run = async (kind: 'preview' | 'import', work: () => Promise<void>) => {
    setBusyLocal(kind);
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
      toast('error', errorText(failure));
    } finally {
      setBusyLocal(undefined);
      setBusy(false);
    }
  };

  const toOpen = target === 'open' && root !== undefined;
  const targetPath = toOpen ? root : path.trim();
  const effectiveLanguage: Language | undefined = toOpen ? config?.language : language || undefined;
  const lastNumber = chapters[chapters.length - 1]?.number ?? 0;
  const key = JSON.stringify([source.file ?? null, source.file ? null : source.text, effectiveLanguage ?? null, toOpen]);
  const fresh = preview !== undefined && preview.key === key;
  const problems = {
    source: hasSource(source) ? undefined : t('import.source.required'),
    path: targetPath ? undefined : t('import.folderRequired'),
  };
  const invalid = Boolean(problems.source || problems.path);
  const found = fresh ? preview.data.chapters.length : 0;
  const chaptersWord = (n: number) => plural(uiLanguage, n, [t('import.chapters.one'), t('import.chapters.few'), t('import.chapters.many')]);

  const onTitle = (value: string) => {
    setTitle(value);
    if (!pathEdited && !shell && home) setPath(value.trim() ? joinPath(home, 'stories', slugOfTitle(value)) : '');
  };

  const pickFolder = async () => {
    const chosen = await shell?.pickFolder({ title: t('import.folderPick') });
    if (chosen) {
      setPathEdited(true);
      setPath(chosen);
    }
  };

  const runPreview = () =>
    run('preview', async () => {
      const data = (await client.projectImport({ path: targetPath, ...sourceArgs(source), ...(effectiveLanguage ? { language: effectiveLanguage } : {}), preview: true })) as ImportPreview;
      if (!effectiveLanguage) setDetected(data.language);
      setPreview({ key, data });
    });

  const runImport = () =>
    run('import', async () => {
      const result = (await client.projectImport({
        path: targetPath,
        ...sourceArgs(source),
        ...(toOpen ? {} : { ...(title.trim() ? { title: title.trim() } : {}), ...(effectiveLanguage ? { language: effectiveLanguage } : {}) }),
        status,
      })) as ImportResult;
      const n = result.chapters.length;
      try {
        if (toOpen) {
          await reloadChapters();
          const first = result.chapters[0];
          if (first) await loadChapter(first.number);
        } else {
          await openProject(result.root);
        }
      } catch {
        // the store already showed the error as a toast; the import itself succeeded
      }
      toast('success', t('import.manuscript.done', { n, chapters: chaptersWord(n), where: toOpen ? (config?.title ?? result.root) : result.root }));
      request.onDone?.({ kind: 'manuscript', root: result.root, count: n });
      close();
    });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (invalid) {
      setTouched(true);
      return;
    }
    if (fresh) void runImport();
    else void runPreview();
  };

  const languageName = (code: Language) => t(`import.language.${code}`);
  const label = busy === 'preview' ? t('import.previewing') : busy === 'import' ? t('import.importing') : fresh ? t('import.run', { n: found, chapters: chaptersWord(found) }) : t('import.preview');

  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-label={t('import.manuscript.title')}>
      <SourcePicker id="import-text" value={source} onChange={setSource} hint={t('import.source.pasteHint')} disabled={Boolean(busy)} error={touched ? problems.source : undefined} />

      {root ? (
        <RadioCards<ImportTarget>
          name="import-target"
          legend={t('import.target')}
          value={target}
          onChange={setTarget}
          defaultLabel=""
          columns={2}
          options={[
            { value: 'open', name: t('import.target.open'), lines: [t('import.target.openHint', { title: config?.title ?? root })] },
            { value: 'new', name: t('import.target.new'), lines: [t('import.target.newHint')] },
          ]}
        />
      ) : (
        <div className="import__note">{t('import.target.noProject')}</div>
      )}

      {toOpen ? null : (
        <>
          <Field id="import-path" label={t('import.folder')} hint={shell ? t('import.folderHint') : t('import.folderHintBrowser')} error={touched ? problems.path : undefined} required>
            {shell ? (
              <div className="field__path">
                <span className="mono" aria-live="polite">
                  {path || t('import.folderEmpty')}
                </span>
                <button id="import-path" type="button" className="btn" onClick={() => void pickFolder()} disabled={Boolean(busy)} aria-describedby={hintId('import-path')}>
                  {t('import.folderPick')}
                </button>
              </div>
            ) : (
              <input
                id="import-path"
                className="input"
                value={path}
                onChange={(e) => {
                  setPathEdited(true);
                  setPath(e.target.value);
                }}
                aria-describedby={hintId('import-path')}
                disabled={Boolean(busy)}
                spellCheck={false}
                autoComplete="off"
              />
            )}
          </Field>
          <div className="dlg__grid">
            <Field id="import-title" label={t('import.titleLabel')} hint={t('import.titleHint')}>
              <input id="import-title" className="input" value={title} onChange={(e) => onTitle(e.target.value)} aria-describedby={hintId('import-title')} disabled={Boolean(busy)} />
            </Field>
            <Field id="import-language" label={t('import.language')} hint={t('import.language.hint')}>
              <select id="import-language" className="select" value={language} onChange={(e) => setLanguage(e.target.value as '' | Language)} aria-describedby={hintId('import-language')} disabled={Boolean(busy)}>
                <option value="">{detected ? t('import.language.detected', { language: languageName(detected) }) : t('import.language.auto')}</option>
                <option value="ru">{languageName('ru')}</option>
                <option value="en">{languageName('en')}</option>
              </select>
            </Field>
          </div>
        </>
      )}

      <Field id="import-status" label={t('import.status')} hint={t('import.status.hint')}>
        <select id="import-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ImportStatus)} aria-describedby={hintId('import-status')} disabled={Boolean(busy)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`import.status.${s}`)}
            </option>
          ))}
        </select>
      </Field>

      {preview ? (
        <section className="import__preview" aria-labelledby="import-preview-title">
          <h3 id="import-preview-title">{t('import.previewTitle', { n: preview.data.chapters.length })}</h3>
          {preview.data.chapters.length === 0 ? (
            <div className="dlg__warning small">{t('import.previewNone')}</div>
          ) : (
            <ol className="import__chapters" aria-label={t('common.chapters')}>
              {preview.data.chapters.map((c) => (
                <li key={c.number}>
                  <span className="import__num">{c.number + (toOpen ? lastNumber : 0)}.</span>
                  <span className="grow">{c.title}</span>
                  <span className="small muted">{t('import.words', { n: c.words })}</span>
                </li>
              ))}
            </ol>
          )}
          {toOpen && preview.data.chapters.length > 0 ? <div className="small muted">{t('import.appendAfter', { n: lastNumber + 1 })}</div> : null}
          {!fresh ? <div className="dlg__warning small">{t('import.previewStale')}</div> : null}
        </section>
      ) : null}
      <div className="field__hint">{t('import.previewHint')}</div>

      {error ? (
        <div className="dlg__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="dlg__footer">
        <span className="grow" />
        <button type="button" className="btn btn--ghost" onClick={close} disabled={Boolean(busy)}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={Boolean(busy) || (fresh && found === 0)}>
          {label}
        </button>
      </div>
    </form>
  );
}

// ---- Bible entries -----------------------------------------------------------------------

function BibleBody({ request }: { request: ImportRequest }) {
  const t = useT();
  const root = useStore((s) => s.project.root);
  const toast = useStore((s) => s.toast);
  const close = useImportStore((s) => s.close);
  const setBusy = useImportStore((s) => s.setBusy);
  const recordBible = useImportStore((s) => s.recordBible);
  const client = getClient();

  const [kind, setKind] = useState<EntryKind>('character');
  const [source, setSource] = useState<Source>(EMPTY_SOURCE);
  const [busy, setBusyLocal] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);

  const names = useMemo(() => (source.file ? [] : entryNames(source.text)), [source]);
  const sourceProblem = hasSource(source) ? undefined : t('import.source.required');
  const canImport = Boolean(root) && (Boolean(source.file) || names.length > 0);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!canImport) {
      setTouched(true);
      return;
    }
    setBusyLocal(true);
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.bibleImport(kind, sourceArgs(source));
      recordBible();
      toast('success', t('import.bible.done', { slugs: [...new Set(result.entries.map((e) => e.slug))].join(', ') }));
      request.onDone?.({ kind: 'bible', count: result.entries.length });
      close();
    } catch (failure) {
      setError(errorText(failure));
      toast('error', errorText(failure));
    } finally {
      setBusyLocal(false);
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void onSubmit(e)} noValidate aria-label={t('import.bible.title')}>
      {!root ? <div className="import__note">{t('import.noProject')}</div> : null}
      <Field id="import-bible-kind" label={t('import.bible.kind')} hint={t('import.bible.existing')}>
        <select id="import-bible-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as EntryKind)} aria-describedby={hintId('import-bible-kind')} disabled={busy}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`views.kind.${k}`)}
            </option>
          ))}
        </select>
      </Field>
      <SourcePicker id="import-bible-text" value={source} onChange={setSource} hint={t('import.bible.pasteHint')} disabled={busy} error={touched ? sourceProblem : undefined} />

      {source.file ? (
        <div className="small muted">{t('import.bible.fileNote')}</div>
      ) : source.text.trim() ? (
        names.length > 0 ? (
          <section className="import__preview" aria-labelledby="import-bible-found">
            <h3 id="import-bible-found">{t('import.bible.found', { n: names.length })}</h3>
            <ul className="import__names">
              {names.map((name, i) => (
                <li key={`${name}-${i}`}>
                  <span className="import__num">{i + 1}.</span>
                  <span className="grow">{name}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="dlg__warning small" role="status">
            {t('import.bible.noneFound')}
          </div>
        )
      ) : null}

      {error ? (
        <div className="dlg__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="dlg__footer">
        <span className="grow" />
        <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || !root}>
          {busy ? t('import.importing') : t('import.bible.run')}
        </button>
      </div>
    </form>
  );
}

// ---- Research dossier ----------------------------------------------------------------------

interface SavedDossier {
  path: string;
  topic: string;
  sources: number;
  unconfirmed: string[];
  removed: string[];
}

function DossierBody({ request }: { request: ImportRequest }) {
  const t = useT();
  const root = useStore((s) => s.project.root);
  const config = useStore((s) => s.project.config);
  const toast = useStore((s) => s.toast);
  const close = useImportStore((s) => s.close);
  const setBusy = useImportStore((s) => s.setBusy);
  const recordDossier = useImportStore((s) => s.recordDossier);
  const client = getClient();

  const [mode, setMode] = useState<'form' | 'markdown'>('form');
  const [topic, setTopic] = useState('');
  const [canonPoint, setCanonPoint] = useState('');
  const [sources, setSources] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusyLocal] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<SavedDossier | undefined>(undefined);

  const problems = {
    topic: mode === 'form' ? (topic.trim() ? undefined : t('import.dossier.topicRequired')) : !hasFrontMatter(text) && !topic.trim() ? t('import.dossier.topicRequired') : undefined,
    text: text.trim() ? undefined : t('import.dossier.textRequired'),
  };
  const invalid = Boolean(problems.topic || problems.text) || !root;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (invalid) {
      setTouched(true);
      return;
    }
    setBusyLocal(true);
    setBusy(true);
    setError(undefined);
    try {
      const markdown = mode === 'form' ? buildDossier({ topic, canonPoint, sources, unconfirmed, body: text }, config?.language ?? 'en') : text;
      const raw = await client.connection.callTool('research_save', { markdown, ...(topic.trim() ? { topic: topic.trim() } : {}) });
      const result = payload<SavedDossier>(raw);
      setSaved(result);
      recordDossier(result.path);
      toast('success', t('import.dossier.savedToast', { topic: result.topic }));
      request.onDone?.({ kind: 'dossier', path: result.path, count: 1 });
    } catch (failure) {
      setError(errorText(failure));
      toast('error', errorText(failure));
    } finally {
      setBusyLocal(false);
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="stack">
        <section className="card import__result" aria-live="polite">
          <div>{t('import.dossier.saved')}</div>
          <div className="mono">{saved.path}</div>
          <div className="small muted">
            {t('import.dossier.sourcesCount', { n: saved.sources })} · {t('import.dossier.unconfirmedCount', { n: saved.unconfirmed.length })}
          </div>
          <div className={saved.removed.length > 0 ? 'dlg__warning' : 'small muted'}>{t('import.dossier.removed', { n: saved.removed.length })}</div>
          {saved.removed.length > 0 ? (
            <details>
              <summary>{t('import.dossier.removedList')}</summary>
              <ul className="import__removed">
                {saved.removed.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
        <div className="import__note">{t('import.dossier.dataNote')}</div>
        <div className="dlg__footer">
          <span className="grow" />
          <button type="button" className="btn btn--primary" onClick={close} data-autofocus>
            {t('common.finish')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={(e) => void onSubmit(e)} noValidate aria-label={t('import.dossier.title')}>
      {!root ? <div className="import__note">{t('import.noProject')}</div> : null}
      <div className="import__note">{t('import.dossier.dataNote')}</div>
      <RadioCards<'form' | 'markdown'>
        name="import-dossier-mode"
        legend={t('import.dossier.mode')}
        value={mode}
        onChange={setMode}
        defaultLabel=""
        columns={2}
        options={[
          { value: 'form', name: t('import.dossier.mode.form'), lines: [t('import.dossier.mode.formHint')] },
          { value: 'markdown', name: t('import.dossier.mode.markdown'), lines: [t('import.dossier.mode.markdownHint')] },
        ]}
      />
      <div className="dlg__grid">
        <Field id="import-dossier-topic" label={t('import.dossier.topic')} hint={mode === 'form' ? t('import.dossier.topicHint') : t('import.dossier.topicHintMarkdown')} error={touched ? problems.topic : undefined} required={mode === 'form'}>
          <input id="import-dossier-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} aria-describedby={hintId('import-dossier-topic')} disabled={busy} data-autofocus />
        </Field>
        {mode === 'form' ? (
          <Field id="import-dossier-canon" label={t('import.dossier.canonPoint')} hint={t('import.dossier.canonPointHint')}>
            <input id="import-dossier-canon" className="input" value={canonPoint} onChange={(e) => setCanonPoint(e.target.value)} aria-describedby={hintId('import-dossier-canon')} disabled={busy} />
          </Field>
        ) : null}
      </div>
      {mode === 'form' ? (
        <>
          <Field id="import-dossier-sources" label={t('import.dossier.sources')} hint={t('import.dossier.sourcesHint')}>
            <textarea id="import-dossier-sources" className="textarea import__text" rows={3} value={sources} onChange={(e) => setSources(e.target.value)} aria-describedby={hintId('import-dossier-sources')} disabled={busy} spellCheck={false} />
          </Field>
          <label className="check" htmlFor="import-dossier-unconfirmed">
            <input id="import-dossier-unconfirmed" type="checkbox" checked={unconfirmed} onChange={(e) => setUnconfirmed(e.target.checked)} disabled={busy} />
            <span className="check__text">
              <span>{t('import.dossier.unconfirmed')}</span>
              <span className="field__hint">{t('import.dossier.unconfirmedHint')}</span>
            </span>
          </label>
        </>
      ) : null}
      <Field id="import-dossier-text" label={mode === 'form' ? t('import.dossier.text') : t('import.dossier.markdown')} hint={mode === 'form' ? t('import.dossier.textHint') : t('import.dossier.mode.markdownHint')} error={touched ? problems.text : undefined} required>
        <textarea id="import-dossier-text" className={`textarea ${mode === 'form' ? 'import__prose' : 'import__text'}`} rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={hintId('import-dossier-text')} disabled={busy} spellCheck={mode === 'form'} />
      </Field>

      {error ? (
        <div className="dlg__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="dlg__footer">
        <span className="grow" />
        <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || !root}>
          {busy ? t('import.dossier.saving') : t('import.dossier.run')}
        </button>
      </div>
    </form>
  );
}

// ---- The dialog ------------------------------------------------------------------------------

/**
 * The import dialog (Section 4.2): a manuscript into a new or the open project, Bible entries
 * from one Markdown file, a research dossier into bible/research/. Always rendered; it opens on
 * the `apex:import` window event (`detail: { kind }`) or through `openImport()`. Nothing is
 * written before the Author sees the preview and presses Import.
 */
export function ImportDialog() {
  const t = useT();
  const request = useImportStore((s) => s.request);
  const busy = useImportStore((s) => s.busy);
  const open = useImportStore((s) => s.open);
  const close = useImportStore((s) => s.close);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ImportRequest> | undefined>).detail;
      if (!detail || !isImportKind(detail.kind)) return;
      open({ kind: detail.kind, ...(detail.target ? { target: detail.target } : {}), ...(detail.onDone ? { onDone: detail.onDone } : {}) });
    };
    window.addEventListener(IMPORT_EVENT, onEvent);
    return () => window.removeEventListener(IMPORT_EVENT, onEvent);
  }, [open]);

  if (!request) return null;
  const body = request.kind === 'manuscript' ? <ManuscriptBody request={request} /> : request.kind === 'bible' ? <BibleBody request={request} /> : <DossierBody request={request} />;
  return (
    <Dialog key={request.nonce} title={t(`import.${request.kind}.title`)} subtitle={t(`import.${request.kind}.subtitle`)} onClose={close} dismissable={!busy}>
      {body}
    </Dialog>
  );
}
