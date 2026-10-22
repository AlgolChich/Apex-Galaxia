import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { AiDialog } from './ai.js';
import { TEMPLATES, type BoardTemplate, type NewCardInput } from './api.js';
import { Board, type BoardHandle } from './Board.js';
import { AddCardDialog, CardSheet, ConfirmRemoveDialog } from './sheet.js';
import { selectedCard, useCanvas } from './store.js';
import { zoomPercent } from './viewport.js';
import './canvas.css';

export { useCanvas } from './store.js';

/**
 * The canvas board (Section 4.5, 11.4): an infinite surface of cards and links with lanes
 * from a structure template, a side sheet for the selected card, and the model actions whose
 * proposals reach the board only when the Author adds them.
 */
export function CanvasView() {
  const t = useT();
  const root = useStore((s) => s.project.root);
  const toast = useStore((s) => s.toast);
  const board = useCanvas((s) => s.board);
  const loading = useCanvas((s) => s.loading);
  const error = useCanvas((s) => s.error);
  const selected = useCanvas(selectedCard);
  const linking = useCanvas((s) => s.linking);
  const editorOpen = useCanvas((s) => s.editorOpen);
  const addOpen = useCanvas((s) => s.addOpen);
  const removingId = useCanvas((s) => s.removing);
  const ai = useCanvas((s) => s.ai);
  const load = useCanvas((s) => s.load);
  const setTemplate = useCanvas((s) => s.setTemplate);
  const addCard = useCanvas((s) => s.addCard);
  const removeCard = useCanvas((s) => s.removeCard);
  const openAdd = useCanvas((s) => s.openAdd);
  const closeAdd = useCanvas((s) => s.closeAdd);
  const cancelRemove = useCanvas((s) => s.cancelRemove);
  const openAi = useCanvas((s) => s.openAi);
  const closeAi = useCanvas((s) => s.closeAi);
  const setLinkLabel = useCanvas((s) => s.setLinkLabel);
  const cancelLinking = useCanvas((s) => s.cancelLinking);
  const boardRef = useRef<BoardHandle>(null);
  const templateRef = useRef<HTMLSelectElement>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    void load(root);
  }, [root, load]);

  const removing = removingId ? board?.cards.find((c) => c.id === removingId) : undefined;
  const linkSource = linking ? board?.cards.find((c) => c.id === linking.from) : undefined;
  const empty = Boolean(board) && board!.cards.length === 0 && !loading;

  const onAdd = async (input: NewCardInput): Promise<boolean> => {
    const card = await addCard(input, boardRef.current?.placeAtCenter());
    if (card) toast('success', t('canvas.added', { title: card.title }));
    return Boolean(card);
  };

  return (
    <section className="canvas" aria-labelledby="canvas-title">
      <header className="canvas__bar">
        <h1 id="canvas-title" className="canvas__bar-title">
          {t('canvas.title')}
        </h1>
        <select ref={templateRef} className="select canvas__template" aria-label={t('canvas.template')} value={board?.template ?? 'none'} disabled={!board} onChange={(event) => void setTemplate(event.target.value as BoardTemplate)}>
          {TEMPLATES.map((template) => (
            <option key={template} value={template}>
              {t(`canvas.template.${template}`)}
            </option>
          ))}
        </select>
        <span className="canvas__sep" aria-hidden="true" />
        <button type="button" className="btn" onClick={openAdd} disabled={!board}>
          + {t('canvas.add')}
        </button>
        <div className="canvas__zoom" role="group" aria-label={t('canvas.zoom.level', { percent: zoom })}>
          <button type="button" className="btn btn--ghost" onClick={() => boardRef.current?.zoomOut()} aria-label={t('canvas.zoom.out')}>
            −
          </button>
          <span className="canvas__zoom-level small muted">{zoom}%</span>
          <button type="button" className="btn btn--ghost" onClick={() => boardRef.current?.zoomIn()} aria-label={t('canvas.zoom.in')}>
            +
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => boardRef.current?.fit()}>
            {t('canvas.zoom.fit')}
          </button>
        </div>
        <span className="canvas__sep" aria-hidden="true" />
        <div className="canvas__ai" role="group" aria-label={t('canvas.ai.group')}>
          <button type="button" className="btn" disabled={!board} onClick={() => openAi('directions')}>
            {t('canvas.ai.directions')}
          </button>
          <button type="button" className="btn" disabled={!selected} title={selected ? undefined : t('canvas.ai.expand.needCard')} onClick={() => openAi('expand')}>
            {t('canvas.ai.expand')}
          </button>
          <button type="button" className="btn" disabled={!board} onClick={() => openAi('whatif')}>
            {t('canvas.ai.whatif')}
          </button>
          <button type="button" className="btn" disabled={!board} onClick={() => openAi('guns')}>
            {t('canvas.ai.guns')}
          </button>
          <button type="button" className="btn" disabled={!board} onClick={() => openAi('collapse')}>
            {t('canvas.ai.collapse')}
          </button>
        </div>
      </header>
      {linking && linkSource ? (
        <div className="canvas__hintbar" role="status">
          <span>{t('canvas.link.hint', { title: linkSource.title })}</span>
          <input className="input canvas__hintbar-input" value={linking.label} onChange={(event) => setLinkLabel(event.target.value)} placeholder={t('canvas.link.label')} aria-label={t('canvas.link.label')} />
          <button type="button" className="btn btn--ghost" onClick={cancelLinking}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
      <div className="canvas__main">
        <Board ref={boardRef} onViewportChange={(viewport) => setZoom(zoomPercent(viewport))} />
        {loading && !board ? <div className="canvas__overlay muted">{t('canvas.loading')}</div> : null}
        {error && !board ? (
          <div className="canvas__overlay">
            <div className="canvas__empty-box">
              <div className="view__error">{error}</div>
              <button type="button" className="btn" onClick={() => void load(root)}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : null}
        {empty ? (
          <div className="canvas__overlay">
            <div className="canvas__empty-box">
              <div className="canvas__empty-title">{t('canvas.empty.title')}</div>
              <p className="canvas__empty-text">{t('canvas.empty.text')}</p>
              <div className="canvas__empty-actions">
                <button type="button" className="btn btn--primary" onClick={openAdd}>
                  {t('canvas.empty.add')}
                </button>
                <button type="button" className="btn" onClick={() => templateRef.current?.focus()}>
                  {t('canvas.empty.template')}
                </button>
                <button type="button" className="btn" onClick={() => openAi('directions')}>
                  {t('canvas.empty.directions')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {editorOpen && selected && board ? <CardSheet card={selected} lanes={board.lanes} /> : null}
      </div>
      {addOpen ? <AddCardDialog lanes={board?.lanes ?? []} onAdd={onAdd} onClose={closeAdd} /> : null}
      {removing ? <ConfirmRemoveDialog card={removing} onConfirm={() => removeCard(removing.id)} onClose={cancelRemove} /> : null}
      {ai ? <AiDialog action={ai} onClose={closeAi} place={(near) => boardRef.current?.placeNear(near) ?? { x: 0, y: 0 }} /> : null}
    </section>
  );
}
