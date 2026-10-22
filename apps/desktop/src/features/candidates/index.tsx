import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type { CandidateResult, CandidatesResult } from '../../api/types.js';
import { plural, useLanguage, useT } from '../../i18n/index.js';
import { useStore, type WriteMode } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { openChronicleUpdate } from '../diff/store.js';
import { CANDIDATE_MODES, requestOfDetail, useCandidates, type CandidatesRequest } from './store.js';
import './candidates.css';

export { openCandidates, useCandidates } from './store.js';

type Phase = { kind: 'form' } | { kind: 'busy'; done: number; total: number } | { kind: 'compare'; result: CandidatesResult } | { kind: 'finishing'; result: CandidatesResult } | { kind: 'done'; index: number; chapter: number };

interface AbStats {
  count: number;
  judged: number;
  agreement: number | null;
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function idOf(candidate: CandidateResult): string {
  return candidate.suggestion.id;
}

/**
 * The pairwise record of a choice (Section 6.5). With two candidates the pair is both of them;
 * with three it is the chosen one against the critic's favourite among the others, or the
 * first two on a tie. Sides keep the candidates' original order so left/right stay meaningful.
 * `critic_preferred` is the side the ranking favours, null when the critic read neither.
 */
export function pairFor(result: CandidatesResult, chosen: string | null): { left: string; right: string; choice: 'left' | 'right' | 'tie'; critic_preferred: 'left' | 'right' | null } {
  const ids = result.candidates.map(idOf);
  const rank = (id: string) => {
    const at = result.ranking.indexOf(id);
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  const scored = (id: string) => result.candidates.find((c) => idOf(c) === id)?.score !== null;
  let pair: [string, string];
  if (chosen === null || ids.length <= 2 || !ids.includes(chosen)) pair = [ids[0] ?? '', ids[1] ?? ''];
  else {
    const other = ids.filter((id) => id !== chosen).sort((a, b) => rank(a) - rank(b))[0] ?? '';
    pair = ids.indexOf(chosen) < ids.indexOf(other) ? [chosen, other] : [other, chosen];
  }
  const [left, right] = pair;
  const choice = chosen === null ? 'tie' : chosen === left ? 'left' : 'right';
  const critic_preferred = scored(left) || scored(right) ? (rank(left) <= rank(right) ? 'left' : 'right') : null;
  return { left, right, choice, critic_preferred };
}

/** The critic's favourite: the top of the ranking when the critic read at least one candidate. */
export function criticPick(result: CandidatesResult): string | undefined {
  const top = result.ranking[0];
  if (!top) return undefined;
  return result.candidates.some((c) => c.score !== null) ? top : undefined;
}

function CandidateCard({ candidate, index, selected, pick, lang, onSelect, autofocus }: { candidate: CandidateResult; index: number; selected: boolean; pick: boolean; lang: string; onSelect: () => void; autofocus: boolean }) {
  const t = useT();
  const n = index + 1;
  const counts = candidate.lint.counts;
  const verdict = candidate.critic?.verdict;
  const verdictClass = verdict === 'pass' ? 'chip--success' : verdict === 'revise' ? 'chip--warning' : 'chip--error';
  return (
    <article className={`cands__card${selected ? ' cands__card--on' : ''}`} aria-label={t('candidates.candidate', { n })} data-testid={`candidate-${n}`}>
      <header className="cands__head">
        <label className="cands__choose">
          <input type="radio" name="cands-choice" value={idOf(candidate)} checked={selected} onChange={onSelect} aria-label={t('candidates.choose', { n })} {...(autofocus ? { 'data-autofocus': true } : {})} />
          <span>{t('candidates.candidate', { n })}</span>
          <kbd className="kbd" aria-hidden="true">
            {n}
          </kbd>
        </label>
        {pick ? <span className="badge badge--accent">{t('candidates.criticPick')}</span> : null}
      </header>
      <div className="cands__text prose" lang={lang}>
        {candidate.text}
      </div>
      <footer className="cands__foot small">
        <div className="row">
          {candidate.critic && candidate.score !== null ? (
            <>
              <span className={`chip ${verdictClass}`}>{t(`candidates.verdict.${candidate.critic.verdict}`)}</span>
              <span>{t('candidates.score', { score: candidate.score.toFixed(1) })}</span>
            </>
          ) : (
            <span className="muted">{t('candidates.noCritic')}</span>
          )}
        </div>
        <div className="muted">{candidate.lint.hits.length === 0 ? t('candidates.lint.clean') : t('candidates.lint', { errors: counts.error, warnings: counts.warning, info: counts.info })}</div>
        <div className="faint">{t('candidates.meta', { model: candidate.model, cost: candidate.costUsd.toFixed(4) })}</div>
      </footer>
    </article>
  );
}

function CandidatesBody({ request }: { request: CandidatesRequest }) {
  const t = useT();
  const uiLanguage = useLanguage();
  const close = useCandidates((s) => s.close);
  const toast = useStore((s) => s.toast);
  const config = useStore((s) => s.project.config);
  const chapterNumber = useStore((s) => s.editor.front?.number);
  const chapters = useStore((s) => s.project.chapters);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [mode, setMode] = useState<WriteMode>(request.mode);
  const [count, setCount] = useState<2 | 3>(2);
  const [words, setWords] = useState(request.mode === 'chapter' ? '' : '300');
  const [instruction, setInstruction] = useState(request.instruction ?? '');
  const [sceneCard, setSceneCard] = useState('');
  const [title, setTitle] = useState(request.title ?? '');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [ab, setAb] = useState<AbStats | undefined>(undefined);
  // The in-flight write outlives a cancel or an unmount; whatever it returns is then discarded.
  const cancelled = useRef(false);
  const alive = useRef(true);
  const compare = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    let on = true;
    getClient()
      .abList()
      .then((r) => on && setAb({ count: r.count, judged: r.judged, agreement: r.critic_agreement }))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);

  const lang = config?.language ?? uiLanguage;
  const nextChapter = (chapters[chapters.length - 1]?.number ?? 0) + 1;
  const needsChapter = mode !== 'chapter' && chapterNumber === undefined;
  const canSubmit = !needsChapter && (mode !== 'guided' || instruction.trim().length > 0) && (mode !== 'scene' || sceneCard.trim().length > 0);

  const abLine = useMemo(() => {
    if (!ab) return undefined;
    if (ab.count === 0) return t('candidates.ab.none');
    const agreement = ab.agreement === null ? t('candidates.ab.unjudged') : `${Math.round(ab.agreement * 100)}%`;
    return t('candidates.ab.line', { count: ab.count, choices: plural(uiLanguage, ab.count, [t('candidates.ab.choice.one'), t('candidates.ab.choice.few'), t('candidates.ab.choice.many')]), agreement });
  }, [ab, t, uiLanguage]);

  const discardAll = async (ids: string[]) => {
    const client = getClient();
    for (const id of ids) await client.suggestionDiscard(id).catch(() => undefined);
  };

  const draft = async () => {
    if (!canSubmit) return;
    const app = useStore.getState();
    if (app.editor.dirty) await app.saveChapter();
    const targetWords = Number.parseInt(words, 10);
    const params = {
      mode,
      count,
      ...(mode !== 'chapter' && chapterNumber !== undefined ? { chapter: chapterNumber, cursor: app.editor.cursor } : {}),
      ...(mode === 'chapter' ? { chapter_number: nextChapter, ...(title.trim() ? { title: title.trim() } : {}) } : {}),
      ...(Number.isFinite(targetWords) && targetWords > 0 ? { target_words: targetWords } : {}),
      ...(mode === 'guided' ? { instruction: instruction.trim() } : {}),
      ...(mode === 'scene' ? { scene_card: sceneCard.trim() } : {}),
    };
    cancelled.current = false;
    setPhase({ kind: 'busy', done: 0, total: count });
    try {
      const result = await getClient().writeCandidates(params, (done, total) => {
        if (alive.current) setPhase((p) => (p.kind === 'busy' ? { kind: 'busy', done, total: total || p.total } : p));
      });
      if (cancelled.current || !alive.current) {
        await discardAll(result.candidates.map(idOf));
        useStore.getState().toast('info', t('candidates.cancelled'));
        void useStore.getState().reloadChapters();
        return;
      }
      void useStore.getState().reloadChapters();
      setPhase({ kind: 'compare', result });
    } catch (error) {
      if (!alive.current) return;
      toast('error', errorText(error));
      setPhase({ kind: 'form' });
    }
  };

  const cancelDraft = () => {
    cancelled.current = true;
    close();
  };

  /** Accept the chosen candidate (the critic's pick on a tie), discard the rest, record the pair. */
  const finish = async (chosen: string | null) => {
    if (phase.kind !== 'compare') return;
    const { result } = phase;
    const ids = result.candidates.map(idOf);
    const accepting = chosen ?? criticPick(result) ?? ids[0];
    if (!accepting) return;
    const record = pairFor(result, chosen);
    setPhase({ kind: 'finishing', result });
    const client = getClient();
    try {
      const accepted = await client.suggestionAccept(accepting);
      await discardAll(ids.filter((id) => id !== accepting));
      await client
        .abRecord({ left: record.left, right: record.right, choice: record.choice, ...(note.trim() ? { note: note.trim() } : {}), task: `write.${result.mode}`, critic_preferred: record.critic_preferred })
        .catch((error: unknown) => toast('error', errorText(error)));
      const app = useStore.getState();
      await app.reloadChapters();
      await app.loadChapter(accepted.stem);
      if (!alive.current) return;
      setPhase({ kind: 'done', index: ids.indexOf(accepting) + 1, chapter: accepted.chapter.number });
    } catch (error) {
      if (!alive.current) return;
      toast('error', errorText(error));
      setPhase({ kind: 'compare', result });
    }
  };

  const discardAndClose = async () => {
    if (phase.kind === 'compare') {
      const ids = phase.result.candidates.map(idOf);
      close();
      await discardAll(ids);
      return;
    }
    if (phase.kind === 'busy') cancelDraft();
    else close();
  };

  const requestClose = () => {
    if (phase.kind === 'busy' || phase.kind === 'compare') setConfirmClose(true);
    else if (phase.kind !== 'finishing') close();
  };

  /** 1/2/3 select a candidate, Enter confirms the selected one; typing in the note is left alone. */
  const compareKey = (event: { key: string; target: EventTarget | null; preventDefault(): void }) => {
    if (phase.kind !== 'compare' || confirmClose) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type === 'text');
    if (/^[1-3]$/.test(event.key) && !typing) {
      const candidate = phase.result.candidates[Number(event.key) - 1];
      if (candidate) {
        event.preventDefault();
        setSelected(idOf(candidate));
      }
    } else if (event.key === 'Enter' && selected && tag !== 'BUTTON') {
      event.preventDefault();
      void finish(selected);
    }
  };

  const onCompareKey = (event: KeyboardEvent<HTMLDivElement>) => compareKey(event);

  // Focus may sit outside the panel (the Author clicked the backdrop); the keys still work.
  useEffect(() => {
    if (phase.kind !== 'compare') return;
    const onWindowKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as Node | null;
      if (compare.current && target && compare.current.contains(target)) return;
      compareKey(event);
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  });

  const titleText = t('candidates.title');

  if (phase.kind === 'form') {
    return (
      <Dialog key="form" title={titleText} subtitle={abLine} onClose={requestClose} className="dlg--wide">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void draft();
          }}
        >
          <div className="dlg__grid">
            <div className="dlg__field">
              <label htmlFor="cands-mode">{t('candidates.mode')}</label>
              <select id="cands-mode" className="select" value={mode} onChange={(e) => setMode(e.target.value as WriteMode)} data-autofocus>
                {CANDIDATE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`candidates.mode.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="dlg__field">
              <label htmlFor="cands-count">{t('candidates.count')}</label>
              <select id="cands-count" className="select" value={String(count)} onChange={(e) => setCount(e.target.value === '3' ? 3 : 2)} aria-describedby="cands-count-hint">
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
              <span className="small muted" id="cands-count-hint">
                {t('candidates.count.hint')}
              </span>
            </div>
            <div className="dlg__field">
              <label htmlFor="cands-words">{t('candidates.words')}</label>
              <input id="cands-words" className="input" type="number" min={50} max={6000} value={words} onChange={(e) => setWords(e.target.value)} aria-describedby="cands-words-hint" />
              <span className="small muted" id="cands-words-hint">
                {t('candidates.words.hint')}
              </span>
            </div>
          </div>
          {mode === 'guided' ? (
            <div className="dlg__field">
              <label htmlFor="cands-beat">{t('candidates.beat')}</label>
              <textarea id="cands-beat" className="textarea" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} aria-describedby="cands-beat-hint" lang={lang} />
              <span className="small muted" id="cands-beat-hint">
                {t('candidates.beat.hint')}
              </span>
            </div>
          ) : null}
          {mode === 'scene' ? (
            <div className="dlg__field">
              <label htmlFor="cands-scene">{t('candidates.scene')}</label>
              <textarea id="cands-scene" className="textarea" rows={4} value={sceneCard} onChange={(e) => setSceneCard(e.target.value)} aria-describedby="cands-scene-hint" lang={lang} />
              <span className="small muted" id="cands-scene-hint">
                {t('candidates.scene.hint')}
              </span>
            </div>
          ) : null}
          {mode === 'chapter' ? (
            <div className="dlg__field">
              <label htmlFor="cands-title">{t('candidates.chapterTitle')}</label>
              <input id="cands-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby="cands-title-hint" lang={lang} />
              <span className="small muted" id="cands-title-hint">
                {t('candidates.chapterTitle.hint', { n: nextChapter })}
              </span>
            </div>
          ) : null}
          {needsChapter ? <div className="dlg__warning small">{t('candidates.needChapter')}</div> : <div className="small muted">{t('candidates.form.hint')}</div>}
          <div className="dlg__footer">
            <span className="grow" />
            <button type="button" className="btn" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
              {t('candidates.draft', { n: count })}
            </button>
          </div>
        </form>
      </Dialog>
    );
  }

  if (phase.kind === 'busy') {
    const percent = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
    return (
      <Dialog key="busy" title={titleText} subtitle={abLine} onClose={requestClose} className="dlg--narrow">
        <div className="cands__busy" aria-busy="true" role="status">
          <div>
            <span className="diff-busy__dot" aria-hidden="true" />
            {t('candidates.busy')} <span className="muted">{t('candidates.busy.progress', { done: phase.done, total: phase.total })}</span>
          </div>
          <div className="cands__progress" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="small muted">{t('candidates.busy.hint')}</div>
        </div>
        {confirmClose ? (
          <div className="dlg__footer">
            <span>{t('candidates.close.confirm')}</span>
            <span className="grow" />
            <button type="button" className="btn btn--danger" onClick={cancelDraft} data-autofocus>
              {t('candidates.close.yes')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmClose(false)}>
              {t('candidates.close.no')}
            </button>
          </div>
        ) : (
          <div className="dlg__footer">
            <span className="grow" />
            <button type="button" className="btn" onClick={cancelDraft} data-autofocus>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </Dialog>
    );
  }

  if (phase.kind === 'done') {
    return (
      <Dialog key="done" title={titleText} onClose={close} className="dlg--narrow">
        <div>{t('candidates.done', { n: phase.index, chapter: phase.chapter })}</div>
        <div className="small muted">{t('candidates.done.hint')}</div>
        <div>{t('candidates.chronicle.ask', { n: phase.chapter })}</div>
        <div className="dlg__footer">
          <span className="grow" />
          <button type="button" className="btn" onClick={close}>
            {t('candidates.chronicle.later')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const chapter = phase.chapter;
              close();
              openChronicleUpdate(chapter);
            }}
            data-autofocus
          >
            {t('candidates.chronicle.go')}
          </button>
        </div>
      </Dialog>
    );
  }

  const { result } = phase;
  const finishing = phase.kind === 'finishing';
  const pick = criticPick(result);
  const selectedIndex = selected ? result.candidates.findIndex((c) => idOf(c) === selected) : -1;
  return (
    <Dialog key="compare" title={titleText} subtitle={abLine} onClose={requestClose} className="dlg--wide cands" dismissable={!finishing}>
      <div ref={compare} onKeyDown={onCompareKey} className="stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <strong>{t('candidates.compare')}</strong>
          <span className="small muted">{t(`candidates.mode.${result.mode}`)}</span>
          <span className="grow" />
          <span className="small faint">{t('candidates.total', { cost: result.costUsd.toFixed(4), n: result.candidates.length })}</span>
        </div>
        <div className="small muted">{t('candidates.compare.hint')}</div>
        <div className="cands__grid" role="radiogroup" aria-label={t('candidates.compare')} style={{ '--cands-count': result.candidates.length } as CSSProperties}>
          {result.candidates.map((candidate, index) => (
            <CandidateCard key={idOf(candidate)} candidate={candidate} index={index} selected={selected === idOf(candidate)} pick={pick === idOf(candidate)} lang={lang} onSelect={() => setSelected(idOf(candidate))} autofocus={index === 0} />
          ))}
        </div>
        <div className="dlg__field">
          <label htmlFor="cands-note">{t('candidates.note')}</label>
          <input id="cands-note" className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('candidates.note.placeholder')} disabled={finishing} />
        </div>
        {confirmClose ? (
          <div className="dlg__footer">
            <span>{t('candidates.close.confirm')}</span>
            <span className="grow" />
            <button type="button" className="btn btn--danger" onClick={() => void discardAndClose()} data-autofocus>
              {t('candidates.close.yes')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmClose(false)}>
              {t('candidates.close.no')}
            </button>
          </div>
        ) : (
          <div className="dlg__footer">
            <button type="button" className="btn btn--primary" onClick={() => selected && void finish(selected)} disabled={!selected || finishing}>
              {finishing ? t('candidates.finishing') : selectedIndex >= 0 ? t('candidates.accept', { n: selectedIndex + 1 }) : t('candidates.accept.none')}
            </button>
            <button type="button" className="btn" onClick={() => void finish(null)} disabled={finishing} title={t('candidates.tie.hint')} aria-describedby="cands-tie-hint">
              {t('candidates.tie')}
            </button>
            <span className="cands__keys" aria-hidden="true">
              {t('candidates.keys')}
            </span>
            <span className="grow" />
            <button type="button" className="btn btn--ghost btn--danger" onClick={() => setConfirmClose(true)} disabled={finishing}>
              {t('candidates.discardAll')}
            </button>
            <span className="sr-only" id="cands-tie-hint">
              {t('candidates.tie.hint')}
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * The candidates dialog (Section 6.5): always mounted, opens on the `apex:candidates` window
 * event (the palette's Ctrl/Cmd+Shift+C), drafts two or three candidates for one Write, shows
 * them side by side with the critic's scores, and records the Author's pairwise choice. The
 * chosen text reaches the chapter only through `suggestion_accept`.
 */
export function CandidatesDialog() {
  const request = useCandidates((s) => s.request);
  const open = useCandidates((s) => s.open);

  useEffect(() => {
    const onEvent = (event: Event) => open(requestOfDetail((event as CustomEvent<unknown>).detail));
    window.addEventListener('apex:candidates', onEvent);
    return () => window.removeEventListener('apex:candidates', onEvent);
  }, [open]);

  if (!request) return null;
  return <CandidatesBody key={request.nonce} request={request} />;
}
