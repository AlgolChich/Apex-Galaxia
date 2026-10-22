import { useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type { ChronicleProposal } from '../../api/types.js';
import { useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { useDialogs } from '../diff/store.js';
import './chronicle-update.css';

export { openChronicleUpdate } from '../diff/store.js';

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

type Phase = { kind: 'proposing' } | { kind: 'review'; proposal: ChronicleProposal; described: string[] } | { kind: 'applying'; proposal: ChronicleProposal; described: string[] } | { kind: 'applied'; summarizing: boolean } | { kind: 'error'; error: string };

function ChronicleUpdateBody({ chapter }: { chapter: number }) {
  const t = useT();
  const language = useLanguage();
  const close = useDialogs((s) => s.closeChronicleUpdate);
  const bump = useDialogs((s) => s.bumpChronicle);
  const toast = useStore((s) => s.toast);
  const reloadChapters = useStore((s) => s.reloadChapters);
  const [phase, setPhase] = useState<Phase>({ kind: 'proposing' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase({ kind: 'proposing' });
    getClient()
      .chroniclePropose(chapter)
      .then(
        (r) => alive && setPhase({ kind: 'review', proposal: r.proposal, described: r.described }),
        (error: unknown) => alive && setPhase({ kind: 'error', error: errorText(error) }),
      );
    return () => {
      alive = false;
    };
  }, [chapter, attempt]);

  const apply = async () => {
    if (phase.kind !== 'review') return;
    setPhase({ kind: 'applying', proposal: phase.proposal, described: phase.described });
    try {
      const applied = await getClient().chronicleApply(phase.proposal, 'author');
      toast('success', t('chronicleUpdate.applied', { n: applied.applied.length, chapter: applied.last_chapter }));
      bump();
      setPhase({ kind: 'applied', summarizing: false });
    } catch (error) {
      setPhase({ kind: 'error', error: errorText(error) });
    }
  };

  const summarize = async () => {
    setPhase({ kind: 'applied', summarizing: true });
    try {
      await getClient().summarizeChapter(chapter);
      toast('success', t('chronicleUpdate.summarize.done', { n: chapter }));
      await reloadChapters();
    } catch (error) {
      toast('error', errorText(error));
    }
    close();
  };

  const busy = phase.kind === 'proposing' || phase.kind === 'applying' || (phase.kind === 'applied' && phase.summarizing);
  const title = t('chronicleUpdate.title', { n: chapter });

  if (phase.kind === 'proposing') {
    return (
      <Dialog title={title} onClose={close} className="dlg--narrow" dismissable>
        <div className="chrup__busy" aria-busy="true">
          <div>
            <span className="diff-busy__dot" aria-hidden="true" />
            {t('chronicleUpdate.proposing')}
          </div>
          <div className="small muted">{t('chronicleUpdate.proposing.note')}</div>
        </div>
        <div className="dlg__footer">
          <span className="grow" />
          <button type="button" className="btn" onClick={close} data-autofocus>
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    );
  }

  if (phase.kind === 'error') {
    return (
      <Dialog title={title} onClose={close} className="dlg--narrow">
        <div className="dlg__error">{t('chronicleUpdate.error', { error: phase.error })}</div>
        <div className="dlg__footer">
          <span className="grow" />
          <button type="button" className="btn" onClick={close}>
            {t('common.close')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setAttempt((a) => a + 1)} data-autofocus>
            {t('chronicleUpdate.retry')}
          </button>
        </div>
      </Dialog>
    );
  }

  if (phase.kind === 'applied') {
    return (
      <Dialog title={title} onClose={close} className="dlg--narrow" dismissable={!phase.summarizing}>
        <div>{t('chronicleUpdate.summarize.ask', { n: chapter })}</div>
        <div className="small muted">{t('chronicleUpdate.summarize.note')}</div>
        <div className="dlg__footer">
          <span className="grow" />
          <button type="button" className="btn" onClick={close} disabled={phase.summarizing}>
            {t('chronicleUpdate.summarize.skip')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void summarize()} disabled={phase.summarizing} data-autofocus>
            {phase.summarizing ? t('chronicleUpdate.summarize.busy') : t('chronicleUpdate.summarize.go')}
          </button>
        </div>
      </Dialog>
    );
  }

  const { proposal, described } = phase;
  return (
    <Dialog title={title} onClose={close} dismissable={!busy}>
      <section className="dlg__field">
        <span className="label">{t('chronicleUpdate.summary')}</span>
        <div className="chrup__summary prose" lang={language}>
          {proposal.summary}
        </div>
      </section>
      {proposal.hidden ? (
        <section className="dlg__field">
          <span className="label dlg__warning">
            {t('chronicleUpdate.hidden')} · {t('chronicleUpdate.hidden.note')}
          </span>
          <div className="chrup__hidden" lang={language}>
            {proposal.hidden}
          </div>
        </section>
      ) : null}
      {proposal.in_story_time ? (
        <section className="dlg__field">
          <span className="label">{t('chronicleUpdate.time')}</span>
          <div>{proposal.in_story_time}</div>
        </section>
      ) : null}
      <section className="dlg__field">
        <span className="label">{t('chronicleUpdate.ops')}</span>
        {described.length === 0 ? (
          <div className="small muted">{t('chronicleUpdate.ops.none')}</div>
        ) : (
          <ul className="chrup__ops">
            {described.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </section>
      <div className="dlg__footer">
        <span className="grow" />
        <button type="button" className="btn" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void apply()} disabled={busy} data-autofocus>
          {phase.kind === 'applying' ? t('chronicleUpdate.applying') : t('chronicleUpdate.apply')}
        </button>
      </div>
    </Dialog>
  );
}

/** Propose → show → apply after the Author confirms (`chronicle_apply` with by=author). */
export function ChronicleUpdateDialog() {
  const open = useDialogs((s) => s.chronicleUpdate);
  if (!open) return null;
  return <ChronicleUpdateBody key={open.chapter} chapter={open.chapter} />;
}
