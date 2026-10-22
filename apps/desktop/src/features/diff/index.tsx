import { useEffect, useMemo, useState } from 'react';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type { DiffBlock, LessonProposal, LintReport } from '../../api/types.js';
import { pick, plural, useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { useGlobalShortcuts } from '../palette/actions.js';
import { composeReplacement, decidableBlocks, nothingAccepted } from './compose.js';
import { Dialog } from './dialog.js';
import { dispatchEditor, installSelectionMirror } from './editor-bridge.js';
import { wordDiff, type Segment } from './lcs.js';
import { useDialogs, type DiffPayload } from './store.js';
import './diff.css';

export { openDiff, useDialogs } from './store.js';
export { composeReplacement, composeParagraphs } from './compose.js';
export { wordDiff } from './lcs.js';
export { dispatchEditor, paragraphAt, currentSelection, selectionOrParagraph } from './editor-bridge.js';

const LAYOUT_KEY = 'apex.diff.layout';

function readLayout(): 'stacked' | 'side' {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'side' ? 'side' : 'stacked';
  } catch {
    return 'stacked';
  }
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * The diff dialog for Rewrite, Weave and de-AI. It is mounted by App at all times, so it
 * also hosts the global keyboard shortcuts of the palette actions and the mirror of the
 * editor's selection events: both need one always-mounted component, and App renders the
 * palette and the right panel only on demand.
 */
export function DiffDialog() {
  useGlobalShortcuts();
  useEffect(() => installSelectionMirror(), []);
  const diff = useDialogs((s) => s.diff);
  const busy = useDialogs((s) => s.busy);
  if (busy) return <BusyCard op={busy.op} />;
  if (!diff) return null;
  return <DiffBody key={`${diff.op}:${diff.from}:${diff.to}`} payload={diff} />;
}

function BusyCard({ op }: { op: string }) {
  const t = useT();
  const cancel = useDialogs((s) => s.cancelBusy);
  return (
    <Dialog title={t(op === 'weave' ? 'diff.busy.weave' : 'diff.busy')} onClose={cancel} className="dlg--narrow" role="alertdialog">
      <div className="diff-busy" aria-busy="true">
        <div>
          <span className="diff-busy__dot" aria-hidden="true" />
          <span className="muted">{t(`diff.op.${op}`)}</span>
        </div>
        <div className="small muted">{t('diff.busy.note')}</div>
        <button type="button" className="btn" onClick={cancel} data-autofocus>
          {t('diff.busy.cancel')}
        </button>
      </div>
    </Dialog>
  );
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'same' ? <span key={index}>{segment.text}</span> : <mark key={index} className={`diff-seg--${segment.kind}`}>{segment.text}</mark>,
      )}
    </>
  );
}

function BlockView({ block, index, accepted, layout, onDecide }: { block: DiffBlock; index: number; accepted: boolean; layout: 'stacked' | 'side'; onDecide: (index: number, value: boolean) => void }) {
  const t = useT();
  const before = block.before.join('\n\n');
  const after = block.after.join('\n\n');
  const words = useMemo(() => (block.kind === 'changed' ? wordDiff(before, after) : undefined), [block.kind, before, after]);
  if (block.kind === 'same') {
    return (
      <section className="diff-block diff-block--same" aria-label={t('diff.block.same')}>
        <div className="diff-block__bar">
          <span className="diff-block__kind">{t('diff.block.same')}</span>
        </div>
        <div className="diff-para">{after}</div>
      </section>
    );
  }
  return (
    <section className={`diff-block diff-block--${block.kind}${accepted ? '' : ' diff-block--rejected'}`} aria-label={`${t(`diff.block.${block.kind}`)} ${index + 1}`}>
      <div className="diff-block__bar">
        <span className={`diff-block__kind diff-block__kind--${block.kind}`}>{t(`diff.block.${block.kind}`)}</span>
        <span className="grow" />
        <div className="diff-toggle" role="group" aria-label={`${t(`diff.block.${block.kind}`)} ${index + 1}`}>
          <button type="button" aria-pressed={accepted} onClick={() => onDecide(index, true)}>
            {t('diff.acceptBlock')}
          </button>
          <button type="button" aria-pressed={!accepted} onClick={() => onDecide(index, false)}>
            {t('diff.rejectBlock')}
          </button>
        </div>
      </div>
      <div className={`diff-cols${layout === 'side' && block.kind === 'changed' ? ' diff-cols--side' : ''}`}>
        {block.kind !== 'added' ? (
          <div className="diff-para diff-para--before">
            <span className="diff-para__label">{t('diff.before')}</span>
            {words ? <Segments segments={words.before} /> : before}
          </div>
        ) : null}
        {block.kind !== 'removed' ? (
          <div className={`diff-para diff-para--after${block.kind === 'added' ? ' diff-para--added' : ''}`}>
            <span className="diff-para__label">{t('diff.after')}</span>
            {words ? <Segments segments={words.after} /> : after}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LintSummary({ report }: { report: LintReport }) {
  const t = useT();
  const language = useLanguage();
  if (report.hits.length === 0) return <div className="small muted">{t('diff.lint.clean')}</div>;
  return (
    <details className="diff-lint">
      <summary className="small">
        {t('diff.lint')}: {t('diff.lint.counts', { errors: report.counts.error, warnings: report.counts.warning, info: report.counts.info })}
      </summary>
      <ul className="small">
        {report.hits.map((hit, index) => (
          <li key={index}>
            <span className={`chip chip--${hit.severity}`}>{hit.rule}</span> {pick(language, hit.message)} <span className="muted">«{hit.excerpt}»</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function DiffBody({ payload }: { payload: DiffPayload }) {
  const t = useT();
  const language = useLanguage();
  const close = useDialogs((s) => s.closeDiff);
  const toast = useStore((s) => s.toast);
  const blocks = payload.result.diff;
  const decidable = useMemo(() => decidableBlocks(blocks), [blocks]);
  const [accepted, setAccepted] = useState<boolean[]>(() => blocks.map(() => true));
  const [layout, setLayout] = useState<'stacked' | 'side'>(readLayout);
  const [proposeLesson, setProposeLesson] = useState(false);
  const [phase, setPhase] = useState<'review' | 'lesson'>('review');
  const [lesson, setLesson] = useState<{ busy: boolean; proposal?: LessonProposal; error?: string; after: string }>({ busy: false, after: '' });

  const decide = (index: number, value: boolean) => setAccepted((prev) => prev.map((v, i) => (i === index ? value : v)));
  const decideAll = (value: boolean) => setAccepted(blocks.map(() => value));
  const chooseLayout = (next: 'stacked' | 'side') => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // storage may be unavailable; the choice just does not persist
    }
  };

  const apply = async () => {
    if (nothingAccepted(blocks, accepted)) {
      toast('info', t('diff.apply.nothing'));
      return;
    }
    const text = composeReplacement(payload.before, blocks, accepted);
    dispatchEditor({ type: 'replace', from: payload.from, to: payload.to, text });
    toast('success', t('diff.applied'));
    if (!proposeLesson) {
      close();
      return;
    }
    setPhase('lesson');
    setLesson({ busy: true, after: text });
    try {
      const proposal = await getClient().lessonsPropose(payload.before, text);
      setLesson({ busy: false, proposal, after: text });
    } catch (error) {
      setLesson({ busy: false, error: errorText(error), after: text });
    }
  };

  const addLesson = async () => {
    const proposal = lesson.proposal;
    if (!proposal) return;
    try {
      const added = await getClient().lessonsAdd({
        category: proposal.category,
        rule: proposal.rule,
        provenance: `desktop rewrite ${payload.op}`,
        language: proposal.language,
        ...(proposal.before ? { before: proposal.before } : {}),
        ...(proposal.after ? { after: proposal.after } : {}),
      });
      if (added.duplicate) toast('info', t('diff.lesson.duplicate', { id: added.duplicate }));
      else toast('success', t('diff.lesson.added', { rule: proposal.rule }));
    } catch (error) {
      toast('error', errorText(error));
    }
    close();
  };

  const opLabel = t(`diff.op.${payload.op}`) === `diff.op.${payload.op}` ? payload.op : t(`diff.op.${payload.op}`);
  const words = countWords(payload.before);
  const subtitle = t('diff.subtitle', {
    words,
    wordsLabel: plural(language, words, [t('diff.words.one'), t('diff.words.few'), t('diff.words.many')]),
    changed: decidable.length,
    blocksLabel: plural(language, decidable.length, [t('diff.blocks.one'), t('diff.blocks.few'), t('diff.blocks.many')]),
  });

  if (phase === 'lesson') {
    return (
      <Dialog title={t('diff.lesson.title')} onClose={close} className="dlg--narrow" dismissable={!lesson.busy}>
        {lesson.busy ? (
          <div aria-busy="true">
            <span className="diff-busy__dot" aria-hidden="true" />
            {t('diff.lesson.busy')}
          </div>
        ) : lesson.error ? (
          <div className="dlg__error">{lesson.error}</div>
        ) : lesson.proposal ? (
          <div className="diff-lesson stack">
            <div>
              <span className="small muted">{t('diff.lesson.category')}: </span>
              <span className="chip">{lesson.proposal.category}</span>
            </div>
            <div>
              <div className="small muted">{t('diff.lesson.rule')}</div>
              <div>{lesson.proposal.rule}</div>
            </div>
            {lesson.proposal.before || lesson.proposal.after ? (
              <div className="small muted">
                {lesson.proposal.before ? (
                  <div>
                    {t('diff.before')}: {lesson.proposal.before}
                  </div>
                ) : null}
                {lesson.proposal.after ? (
                  <div>
                    {t('diff.after')}: {lesson.proposal.after}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="dlg__footer">
          <span className="grow" />
          <button type="button" className="btn" onClick={close} disabled={lesson.busy}>
            {t('diff.lesson.skip')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void addLesson()} disabled={lesson.busy || !lesson.proposal} data-autofocus>
            {t('diff.lesson.add')}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('diff.title', { op: opLabel })} onClose={close} className="dlg--wide" subtitle={subtitle}>
      <div className="row small">
        <div className="diff-toggle" role="group" aria-label={t('diff.layout.stacked')}>
          <button type="button" aria-pressed={layout === 'stacked'} onClick={() => chooseLayout('stacked')}>
            {t('diff.layout.stacked')}
          </button>
          <button type="button" aria-pressed={layout === 'side'} onClick={() => chooseLayout('side')}>
            {t('diff.layout.side')}
          </button>
        </div>
        <span className="grow" />
        <button type="button" className="btn btn--ghost small" onClick={() => decideAll(true)} disabled={decidable.length === 0}>
          {t('diff.acceptAll')}
        </button>
        <button type="button" className="btn btn--ghost small" onClick={() => decideAll(false)} disabled={decidable.length === 0}>
          {t('diff.rejectAll')}
        </button>
      </div>
      <div className="diff-blocks" lang={language}>
        {blocks.map((block, index) => (
          <BlockView key={index} block={block} index={index} accepted={accepted[index] ?? true} layout={layout} onDecide={decide} />
        ))}
      </div>
      <LintSummary report={payload.result.lint} />
      {payload.model ? (
        <div className="small muted">
          {t('diff.model')}: {payload.model}
          {payload.costUsd !== undefined ? ` · $${payload.costUsd.toFixed(4)}` : ''}
        </div>
      ) : null}
      <div className="dlg__footer">
        <label className="row small">
          <input type="checkbox" checked={proposeLesson} onChange={(e) => setProposeLesson(e.target.checked)} />
          {t('diff.lesson.propose')}
        </label>
        <span className="grow" />
        <button type="button" className="btn" onClick={close}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void apply()} data-autofocus>
          {t('diff.apply')}
        </button>
      </div>
    </Dialog>
  );
}
