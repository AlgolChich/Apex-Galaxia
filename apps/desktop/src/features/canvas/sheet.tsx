import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EntryKind } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { CARD_KINDS, type BoardCard, type CardKind, type NewCardInput } from './api.js';
import { useCanvas } from './store.js';

const BIBLE_KINDS: readonly EntryKind[] = ['character', 'location', 'faction', 'item'];
const LANES_LIST_ID = 'canvas-lanes-list';

function LaneInput({ id, value, lanes, onChange, label, hint }: { id: string; value: string; lanes: readonly string[]; onChange: (lane: string) => void; label: string; hint: string }) {
  const listId = `${LANES_LIST_ID}-${id}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" list={listId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={hint} autoComplete="off" />
      <datalist id={listId}>
        {lanes.map((lane) => (
          <option key={lane} value={lane} />
        ))}
      </datalist>
    </div>
  );
}

/**
 * The side sheet of the selected card: title, kind, lane and text to edit, then the actions
 * that leave the board (link, promote to the Bible or to the plan, remove).
 */
export function CardSheet({ card, lanes }: { card: BoardCard; lanes: string[] }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const chapters = useStore((s) => s.project.chapters);
  const closeEditor = useCanvas((s) => s.closeEditor);
  const patchCard = useCanvas((s) => s.patchCard);
  const startLinking = useCanvas((s) => s.startLinking);
  const askRemove = useCanvas((s) => s.askRemove);
  const promoteToBible = useCanvas((s) => s.promoteToBible);
  const promoteToPlan = useCanvas((s) => s.promoteToPlan);
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  const [kind, setKind] = useState<CardKind>(card.kind);
  const [lane, setLane] = useState(card.lane ?? '');
  const [saving, setSaving] = useState(false);
  const [bibleKind, setBibleKind] = useState<EntryKind>('character');
  const [chapter, setChapter] = useState(String((chapters[chapters.length - 1]?.number ?? 0) + 1));
  const [busy, setBusy] = useState<'bible' | 'plan' | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // Another card was selected, or the server changed this one (a promotion appends a pointer).
  useEffect(() => {
    setTitle(card.title);
    setText(card.text);
    setKind(card.kind);
    setLane(card.lane ?? '');
  }, [card.id, card.title, card.text, card.kind, card.lane]);

  const dirty = title !== card.title || text !== card.text || kind !== card.kind || lane !== (card.lane ?? '');

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!dirty || !title.trim() || saving) return;
    setSaving(true);
    const ok = await patchCard(card.id, { title: title.trim(), text, kind, lane: lane.trim() });
    setSaving(false);
    if (ok) toast('success', t('canvas.edit.saved'));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    }
  };

  const chapterNumber = Number.parseInt(chapter, 10);

  return (
    <aside className="canvas__sheet" aria-label={t('canvas.edit.title')} onKeyDown={onKeyDown}>
      <div className="canvas__sheet-head">
        <strong className="grow">{t('canvas.edit.title')}</strong>
        <button type="button" className="btn btn--ghost" onClick={closeEditor} aria-label={t('common.close')}>
          {t('common.close')}
        </button>
      </div>
      <div className="canvas__sheet-body">
        <form className="stack" onSubmit={(event) => void save(event)}>
          <div className="field">
            <label className="field__label" htmlFor="canvas-edit-title">
              {t('canvas.field.title')}
            </label>
            <input id="canvas-edit-title" ref={titleRef} className="input" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="canvas-edit-kind">
              {t('canvas.kind')}
            </label>
            <select id="canvas-edit-kind" className="select" value={kind} onChange={(event) => setKind(event.target.value as CardKind)}>
              {CARD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`canvas.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <LaneInput id="canvas-edit-lane" value={lane} lanes={lanes} onChange={setLane} label={t('canvas.field.lane')} hint={t('canvas.lane.none')} />
          <div className="field">
            <label className="field__label" htmlFor="canvas-edit-text">
              {t('canvas.field.text')}
            </label>
            <textarea id="canvas-edit-text" className="textarea" value={text} onChange={(event) => setText(event.target.value)} rows={6} />
          </div>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={!dirty || !title.trim() || saving}>
              {t('canvas.edit.save')}
            </button>
          </div>
        </form>
        <div className="canvas__sheet-actions">
          <button type="button" className="btn" onClick={() => startLinking(card.id)}>
            {t('canvas.link')}
          </button>
          <div className="canvas__inline">
            <div className="field">
              <label className="field__label" htmlFor="canvas-promote-kind">
                {t('canvas.promote.bible.kind')}
              </label>
              <select id="canvas-promote-kind" className="select" value={bibleKind} onChange={(event) => setBibleKind(event.target.value as EntryKind)}>
                {BIBLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`canvas.bible.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy !== undefined}
              onClick={async () => {
                setBusy('bible');
                await promoteToBible(card.id, bibleKind);
                setBusy(undefined);
              }}
            >
              {t('canvas.promote.bible')}
            </button>
          </div>
          <div className="canvas__inline">
            <div className="field">
              <label className="field__label" htmlFor="canvas-promote-chapter">
                {t('canvas.promote.plan.chapter')}
              </label>
              <input id="canvas-promote-chapter" className="input" type="number" min={1} step={1} value={chapter} onChange={(event) => setChapter(event.target.value)} />
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy !== undefined || !Number.isFinite(chapterNumber) || chapterNumber < 1}
              onClick={async () => {
                setBusy('plan');
                await promoteToPlan(card.id, chapterNumber);
                setBusy(undefined);
              }}
            >
              {t('canvas.promote.plan')}
            </button>
          </div>
          <button type="button" className="btn btn--danger" onClick={() => askRemove(card.id)}>
            {t('canvas.remove')}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** «+ Card»: kind, title, text and lane; the board places it at the centre of the view. */
export function AddCardDialog({ lanes, onAdd, onClose }: { lanes: readonly string[]; onAdd: (input: NewCardInput) => Promise<boolean>; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<CardKind>('idea');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [lane, setLane] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const ok = await onAdd({ kind, title: title.trim(), ...(text.trim() ? { text: text.trim() } : {}), ...(lane.trim() ? { lane: lane.trim() } : {}) });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog title={t('canvas.add.title')} subtitle={t('canvas.add.hint')} onClose={onClose} className="dlg--narrow" dismissable={!busy}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label className="field__label" htmlFor="canvas-add-title">
            {t('canvas.field.title')}
          </label>
          <input id="canvas-add-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} data-autofocus required />
        </div>
        <div className="dlg__grid">
          <div className="field">
            <label className="field__label" htmlFor="canvas-add-kind">
              {t('canvas.kind')}
            </label>
            <select id="canvas-add-kind" className="select" value={kind} onChange={(event) => setKind(event.target.value as CardKind)}>
              {CARD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`canvas.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <LaneInput id="canvas-add-lane" value={lane} lanes={lanes} onChange={setLane} label={t('canvas.field.lane')} hint={t('canvas.lane.none')} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="canvas-add-text">
            {t('canvas.field.text')}
          </label>
          <textarea id="canvas-add-text" className="textarea" value={text} onChange={(event) => setText(event.target.value)} rows={4} />
        </div>
        <div className="dlg__footer">
          <button type="submit" className="btn btn--primary" disabled={!title.trim() || busy}>
            {t('canvas.add.submit')}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Delete asks first; the card and the links pointing at it go together. */
export function ConfirmRemoveDialog({ card, onConfirm, onClose }: { card: BoardCard; onConfirm: () => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={t('canvas.remove.title')} onClose={onClose} className="dlg--narrow" role="alertdialog" dismissable={!busy}>
      <p className="muted" style={{ margin: 0 }}>
        {t('canvas.remove.text', { title: card.title })}
      </p>
      <div className="dlg__footer">
        <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
          }}
        >
          {t('canvas.remove')}
        </button>
      </div>
    </Dialog>
  );
}
