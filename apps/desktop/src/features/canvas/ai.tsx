import { useRef, useState, type FormEvent } from 'react';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type { Direction } from '../../api/types.js';
import { useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { canvasAiCards, canvasAiCollapse, canvasAiGuns, canvasDirections, outlineMarkdown, type CardKind, type CardsProposal, type GunFound, type ModelMeta, type OutlineProposal, type ProposedCard } from './api.js';
import { selectedCard, useCanvas, type AiAction } from './store.js';

type Result = { kind: 'directions'; options: Direction[] } | { kind: 'cards'; proposal: CardsProposal } | { kind: 'guns'; guns: GunFound[] } | { kind: 'outline'; outline: OutlineProposal };

interface Meta {
  model: string;
  /** What the server reported, else how much the project's total moved; undefined when neither is known. */
  cost: number | undefined;
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const TITLE_KEY: Record<AiAction, string> = { directions: 'canvas.ai.directions', expand: 'canvas.ai.expand', whatif: 'canvas.ai.whatif', guns: 'canvas.ai.guns', collapse: 'canvas.ai.collapse' };
const HINT_KEY: Record<AiAction, string> = { directions: 'canvas.ai.directions.hint', expand: 'canvas.ai.expand.hint', whatif: 'canvas.ai.whatif.hint', guns: 'canvas.ai.guns.hint', collapse: 'canvas.ai.collapse.hint' };

/**
 * One dialog for the five model actions of the canvas. Each returns a proposal; nothing
 * reaches the board until the Author presses Add. Model and cost show after every call.
 */
export function AiDialog({ action, onClose, place }: { action: AiAction; onClose: () => void; place: (near?: { x: number; y: number }) => { x: number; y: number } }) {
  const t = useT();
  const uiLanguage = useLanguage();
  const toast = useStore((s) => s.toast);
  const modelStatus = useStore((s) => s.connection.model);
  const config = useStore((s) => s.project.config);
  /** The plan file belongs to the story, so the outline text follows the project's language. */
  const language = config?.language === 'ru' || config?.language === 'en' ? config.language : uiLanguage;
  const board = useCanvas((s) => s.board);
  const selected = useCanvas(selectedCard);
  const addCard = useCanvas((s) => s.addCard);
  const link = useCanvas((s) => s.link);
  const [count, setCount] = useState('3');
  const [focus, setFocus] = useState('');
  const [question, setQuestion] = useState('');
  const [chapterCount, setChapterCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [meta, setMeta] = useState<Meta | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);

  /** The served model when the server names it, else the plan role of the project; the stand-in is always labelled. */
  const modelName = (served?: string) => {
    const name = served ?? modelStatus?.models?.plan ?? config?.models.plan ?? '?';
    return modelStatus?.scripted ? `${name} (${t('app.model.scripted')})` : name;
  };

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (action === 'expand' && !selected) return;
    if (action === 'whatif' && !question.trim()) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setMeta(undefined);
    setAdded(new Set());
    const before = useStore.getState().project.spentUsd;
    try {
      let next: Result;
      let served: ModelMeta = {};
      const options = { signal: abort.signal };
      switch (action) {
        case 'directions': {
          const n = Number.parseInt(count, 10);
          const r = await canvasDirections({ ...(Number.isFinite(n) && n > 0 ? { count: n } : {}), ...(focus.trim() ? { focus: focus.trim() } : {}) }, options);
          next = { kind: 'directions', options: r.options };
          served = r;
          break;
        }
        case 'expand':
        case 'whatif': {
          const r = await canvasAiCards(action, action === 'expand' ? { card: selected!.id } : { question: question.trim() }, options);
          next = { kind: 'cards', proposal: { cards: r.cards, ...(r.note ? { note: r.note } : {}) } };
          served = r;
          break;
        }
        case 'guns': {
          const r = await canvasAiGuns(options);
          next = { kind: 'guns', guns: r.guns };
          served = r;
          break;
        }
        case 'collapse': {
          const n = Number.parseInt(chapterCount, 10);
          const r = await canvasAiCollapse(Number.isFinite(n) && n > 0 ? n : undefined, options);
          next = { kind: 'outline', outline: { chapters: r.chapters } };
          served = r;
          break;
        }
      }
      setResult(next);
      // The status bar's total moves either way; the delta stands in for the cost until the server reports it.
      let delta: number | undefined;
      try {
        await useStore.getState().reloadChapters();
        delta = Math.max(0, useStore.getState().project.spentUsd - before);
      } catch {
        delta = undefined;
      }
      setMeta({ model: modelName(served.model), cost: served.costUsd ?? delta });
    } catch (err) {
      if (abort.signal.aborted) setError(t('canvas.ai.cancelled'));
      else setError(errorText(err));
    } finally {
      setBusy(false);
      abortRef.current = undefined;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const markAdded = (index: number) => setAdded((prev) => new Set([...prev, index]));

  /** Titles the model names resolve to ids of cards on the board (and of cards just added). */
  const resolveLinks = (titles: string[], extra: ReadonlyMap<string, string>): string[] => {
    const ids: string[] = [];
    for (const title of titles) {
      const key = title.trim().toLowerCase();
      const fromBoard = board?.cards.find((c) => c.title.trim().toLowerCase() === key)?.id;
      const id = extra.get(key) ?? fromBoard;
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };

  const addDirection = async (index: number, option: Direction) => {
    setAdding(true);
    const card = await addCard({ kind: 'branch', title: option.title, text: option.text }, place());
    setAdding(false);
    if (card) {
      markAdded(index);
      toast('success', t('canvas.added', { title: card.title }));
    }
  };

  const addProposed = async (indexes: number[], cards: ProposedCard[]) => {
    setAdding(true);
    const created = new Map<string, string>();
    const pendingLinks: Array<{ from: string; titles: string[] }> = [];
    let n = 0;
    const near = action === 'expand' && selected ? { x: selected.x, y: selected.y } : undefined;
    for (const index of indexes) {
      const proposed = cards[index];
      if (!proposed || added.has(index)) continue;
      const links = resolveLinks(proposed.links_to, created);
      const card = await addCard({ kind: proposed.kind, title: proposed.title, ...(proposed.text ? { text: proposed.text } : {}), ...(proposed.lane ? { lane: proposed.lane } : {}), ...(links.length ? { links_to: links } : {}) }, place(near));
      if (!card) break;
      n += 1;
      created.set(card.title.trim().toLowerCase(), card.id);
      markAdded(index);
      if (action === 'expand' && selected) await link(selected.id, card.id);
      const unresolved = proposed.links_to.filter((title) => !links.length || !resolveLinks([title], created).length);
      if (unresolved.length) pendingLinks.push({ from: card.id, titles: unresolved });
    }
    // Links to cards that were created later in the same batch.
    for (const pending of pendingLinks) {
      for (const to of resolveLinks(pending.titles, created)) if (to !== pending.from) await link(pending.from, to);
    }
    setAdding(false);
    if (n > 0) toast('success', t('canvas.ai.added'));
  };

  const addGun = async (index: number, gun: GunFound, kind: CardKind) => {
    setAdding(true);
    const card = await addCard({ kind, title: gun.detail, text: [gun.where, gun.payoff].filter(Boolean).join(' → ') }, place());
    setAdding(false);
    if (card) {
      markAdded(index);
      toast('success', t('canvas.added', { title: card.title }));
    }
  };

  const saveOutline = async (outline: OutlineProposal) => {
    setAdding(true);
    try {
      await getClient().planSave({ outline: outlineMarkdown(outline, language) });
      toast('success', t('canvas.ai.collapse.saved'));
    } catch (err) {
      toast('error', errorText(err));
    }
    setAdding(false);
  };

  const canRun = !busy && (action !== 'expand' || Boolean(selected)) && (action !== 'whatif' || question.trim().length > 0);

  const form = (() => {
    switch (action) {
      case 'directions':
        return (
          <div className="dlg__grid">
            <div className="field">
              <label className="field__label" htmlFor="canvas-ai-count">
                {t('canvas.ai.directions.count')}
              </label>
              <input id="canvas-ai-count" className="input" type="number" min={2} max={5} value={count} onChange={(event) => setCount(event.target.value)} data-autofocus />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="canvas-ai-focus">
                {t('canvas.ai.directions.focus')}
              </label>
              <input id="canvas-ai-focus" className="input" value={focus} onChange={(event) => setFocus(event.target.value)} />
            </div>
          </div>
        );
      case 'expand':
        return selected ? (
          <div className="canvas__focus-card">
            <span className="badge">{t(`canvas.kind.${selected.kind}`)}</span> <strong>{selected.title}</strong>
          </div>
        ) : (
          <div className="dlg__warning">{t('canvas.ai.expand.needCard')}</div>
        );
      case 'whatif':
        return (
          <div className="field">
            <label className="field__label" htmlFor="canvas-ai-question">
              {t('canvas.ai.whatif.question')}
            </label>
            <textarea id="canvas-ai-question" className="textarea" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} data-autofocus />
          </div>
        );
      case 'guns':
        return null;
      case 'collapse':
        return (
          <div className="field">
            <label className="field__label" htmlFor="canvas-ai-chapters">
              {t('canvas.ai.collapse.count')}
            </label>
            <input id="canvas-ai-chapters" className="input" type="number" min={1} max={60} value={chapterCount} onChange={(event) => setChapterCount(event.target.value)} data-autofocus />
          </div>
        );
    }
  })();

  const results = (() => {
    if (!result) return null;
    switch (result.kind) {
      case 'directions':
        return result.options.length === 0 ? (
          <div className="muted">{t('canvas.ai.empty')}</div>
        ) : (
          <ul className="canvas__proposals" aria-label={t('canvas.ai.directions')}>
            {result.options.map((option, i) => (
              <li key={i} className={`canvas__proposal${option.recommended ? ' canvas__proposal--rec' : ''}`}>
                <div className="canvas__proposal-head">
                  <span className="canvas__proposal-title">{option.title}</span>
                  {option.recommended ? <span className="badge badge--accent">{t('canvas.ai.directions.recommended')}</span> : null}
                  {option.obvious ? <span className="badge">{t('canvas.ai.directions.obvious')}</span> : null}
                </div>
                <div className="small">{option.text}</div>
                <div className="canvas__proposal-actions">
                  <button type="button" className="btn" disabled={adding || added.has(i)} onClick={() => void addDirection(i, option)}>
                    {added.has(i) ? t('canvas.ai.added') : t('canvas.ai.addCard')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        );
      case 'cards': {
        const cards = result.proposal.cards;
        const remaining = cards.map((_, i) => i).filter((i) => !added.has(i));
        return cards.length === 0 ? (
          <div className="muted">{t('canvas.ai.empty')}</div>
        ) : (
          <>
            {result.proposal.note ? (
              <div className="small muted">
                {t('canvas.ai.note')}: {result.proposal.note}
              </div>
            ) : null}
            <ul className="canvas__proposals" aria-label={t(TITLE_KEY[action])}>
              {cards.map((card, i) => (
                <li key={i} className={`canvas__proposal canvas__proposal--${card.kind}`}>
                  <div className="canvas__proposal-head">
                    <span className="canvas__proposal-title">{card.title}</span>
                    <span className="badge">{t(`canvas.kind.${card.kind}`)}</span>
                    {card.lane ? <span className="badge">{card.lane}</span> : null}
                  </div>
                  {card.text ? <div className="small">{card.text}</div> : null}
                  {card.links_to.length ? <div className="small muted">{t('canvas.ai.links', { titles: card.links_to.join(', ') })}</div> : null}
                  <div className="canvas__proposal-actions">
                    <button type="button" className="btn" disabled={adding || added.has(i)} onClick={() => void addProposed([i], cards)}>
                      {added.has(i) ? t('canvas.ai.added') : t('canvas.ai.addCard')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {remaining.length > 1 ? (
              <div>
                <button type="button" className="btn btn--primary" disabled={adding} onClick={() => void addProposed(remaining, cards)}>
                  {t('canvas.ai.addAll')}
                </button>
              </div>
            ) : null}
          </>
        );
      }
      case 'guns':
        return result.guns.length === 0 ? (
          <div className="muted">{t('canvas.ai.empty')}</div>
        ) : (
          <ul className="canvas__proposals" aria-label={t('canvas.ai.guns')}>
            {result.guns.map((gun, i) => (
              <li key={i} className="canvas__proposal">
                <div className="canvas__proposal-head">
                  <span className="canvas__proposal-title">{gun.detail}</span>
                  <span className={`badge${gun.confidence === 'high' ? ' badge--ok' : gun.confidence === 'low' ? ' badge--warn' : ''}`}>{t('canvas.ai.guns.confidence', { level: t(`canvas.ai.confidence.${gun.confidence}`) })}</span>
                </div>
                <dl className="kv small">
                  <dt>{t('canvas.ai.guns.where')}</dt>
                  <dd>{gun.where}</dd>
                  <dt>{t('canvas.ai.guns.payoff')}</dt>
                  <dd>{gun.payoff}</dd>
                </dl>
                <div className="canvas__proposal-actions">
                  <button type="button" className="btn" disabled={adding || added.has(i)} onClick={() => void addGun(i, gun, 'question')}>
                    {added.has(i) ? t('canvas.ai.added') : t('canvas.ai.guns.asQuestion')}
                  </button>
                  <button type="button" className="btn" disabled={adding || added.has(i)} onClick={() => void addGun(i, gun, 'idea')}>
                    {t('canvas.ai.guns.asIdea')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        );
      case 'outline': {
        const text = outlineMarkdown(result.outline, language);
        return result.outline.chapters.length === 0 ? (
          <div className="muted">{t('canvas.ai.empty')}</div>
        ) : (
          <>
            <pre className="canvas__outline">{text}</pre>
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  if (await copyText(text)) toast('success', t('canvas.ai.collapse.copied'));
                }}
              >
                {t('common.copy')}
              </button>
              <button type="button" className="btn btn--primary" disabled={adding} onClick={() => void saveOutline(result.outline)}>
                {t('canvas.ai.collapse.save')}
              </button>
            </div>
          </>
        );
      }
    }
  })();

  return (
    <Dialog title={t(TITLE_KEY[action])} subtitle={t(HINT_KEY[action])} onClose={onClose} dismissable={!busy}>
      <form className="stack" onSubmit={(event) => void run(event)}>
        {form}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={!canRun}>
            {t('canvas.ai.run')}
          </button>
          {busy ? (
            <div className="canvas__busy" role="status">
              <span>{t('canvas.ai.busy')}</span>
              <button type="button" className="btn" onClick={cancel}>
                {t('canvas.ai.cancel')}
              </button>
            </div>
          ) : null}
        </div>
      </form>
      {error ? (
        <div className="dlg__error" role="alert">
          {error}
        </div>
      ) : null}
      {results}
      {result ? <div className="small muted">{t('canvas.ai.proposal')}</div> : null}
      {meta ? <div className="small faint">{t('canvas.ai.meta', { model: meta.model, cost: meta.cost === undefined ? '—' : `$${meta.cost.toFixed(4)}` })}</div> : null}
    </Dialog>
  );
}
