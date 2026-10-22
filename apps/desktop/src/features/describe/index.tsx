import { useState } from 'react';
import { getClient } from '../../api/index.js';
import { ToolError } from '../../api/mcp.js';
import type { DescribeOption } from '../../api/types.js';
import { useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { useDialogs, type DescribePayload } from '../diff/store.js';
import './describe.css';

export { openDescribe } from '../diff/store.js';

const SENSES: DescribeOption['sense'][] = ['sound', 'smell', 'touch', 'temperature', 'light', 'taste', 'object', 'body'];
type Intensity = 'low' | 'medium' | 'high';

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** The tool returns `{ options }`; older builds wrapped the array as `{ result }`. */
function optionsOf(raw: unknown): DescribeOption[] {
  if (Array.isArray(raw)) return raw as DescribeOption[];
  const r = raw as { options?: unknown; result?: unknown } | undefined;
  if (Array.isArray(r?.options)) return r.options as DescribeOption[];
  if (Array.isArray(r?.result)) return r.result as DescribeOption[];
  return [];
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function DescribeBody({ payload }: { payload: DescribePayload }) {
  const t = useT();
  const language = useLanguage();
  const close = useDialogs((s) => s.closeDescribe);
  const runWeave = useDialogs((s) => s.runWeave);
  const toast = useStore((s) => s.toast);
  const [count, setCount] = useState(5);
  const [intensity, setIntensity] = useState<Intensity>('medium');
  const [perceiver, setPerceiver] = useState('');
  const [avoid, setAvoid] = useState<Set<DescribeOption['sense']>>(new Set());
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<DescribeOption[] | undefined>(undefined);

  const toggleAvoid = (sense: DescribeOption['sense']) =>
    setAvoid((prev) => {
      const next = new Set(prev);
      if (next.has(sense)) next.delete(sense);
      else next.add(sense);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      const raw = await getClient().describe(payload.text, {
        surrounding: payload.paragraph.text,
        count: Math.min(8, Math.max(3, count)),
        intensity,
        ...(perceiver.trim() ? { perceiver: perceiver.trim() } : {}),
        ...(avoid.size ? { avoid: [...avoid] } : {}),
      });
      setOptions(optionsOf(raw));
    } catch (error) {
      toast('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const weave = (option: DescribeOption) => {
    close();
    void runWeave(payload.paragraph, option.text);
  };

  const copy = async (option: DescribeOption) => {
    if (await copyText(option.text)) toast('success', t('describe.copied'));
  };

  const grouped = options ? SENSES.map((sense) => ({ sense, items: options.filter((o) => o.sense === sense) })).filter((g) => g.items.length > 0) : [];
  const subtitle = t(payload.kind === 'selection' ? 'describe.subtitle.selection' : 'describe.subtitle.paragraph', { words: countWords(payload.text) });

  return (
    <Dialog title={t('describe.title')} onClose={close} subtitle={subtitle} dismissable={!busy}>
      <div className="dlg__field">
        <span className="label">{t('describe.passage')}</span>
        <div className="describe__passage prose" lang={language}>
          {payload.text}
        </div>
      </div>
      {options === undefined ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="dlg__grid">
            <div className="dlg__field">
              <label htmlFor="describe-count">{t('describe.count')}</label>
              <input id="describe-count" className="input" type="number" min={3} max={8} value={count} onChange={(e) => setCount(Number(e.target.value) || 5)} data-autofocus />
            </div>
            <div className="dlg__field">
              <label htmlFor="describe-intensity">{t('describe.intensity')}</label>
              <select id="describe-intensity" className="select" value={intensity} onChange={(e) => setIntensity(e.target.value as Intensity)}>
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <option key={level} value={level}>
                    {t(`describe.intensity.${level}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="dlg__field">
              <label htmlFor="describe-perceiver">{t('describe.perceiver')}</label>
              <input id="describe-perceiver" className="input" value={perceiver} onChange={(e) => setPerceiver(e.target.value)} placeholder={t('describe.perceiver.placeholder')} />
            </div>
          </div>
          <fieldset className="dlg__field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label small muted">{t('describe.avoid')}</legend>
            <div className="describe__avoid">
              {SENSES.map((sense) => (
                <label key={sense}>
                  <input type="checkbox" checked={avoid.has(sense)} onChange={() => toggleAvoid(sense)} />
                  {t(`describe.sense.${sense}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="dlg__footer">
            {busy ? (
              <span className="muted" aria-busy="true">
                <span className="diff-busy__dot" aria-hidden="true" />
                {t('describe.busy')}
              </span>
            ) : null}
            <span className="grow" />
            <button type="button" className="btn" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t('describe.run')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {grouped.length === 0 ? <div className="muted">{t('describe.empty')}</div> : null}
          {grouped.map((group) => (
            <div key={group.sense} className="describe__group">
              <div className="describe__sense">{t(`describe.sense.${group.sense}`)}</div>
              {group.items.map((option, index) => (
                <div key={`${group.sense}-${index}`} className="describe__option">
                  <div className="describe__option-text prose" lang={language}>
                    {option.text}
                  </div>
                  <div className="describe__option-actions">
                    <button type="button" className="btn small" onClick={() => weave(option)} data-autofocus={index === 0 && group === grouped[0] ? true : undefined}>
                      {t('describe.weave')}
                    </button>
                    <button type="button" className="btn btn--ghost small" onClick={() => void copy(option)}>
                      {t('describe.copy')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="dlg__footer">
            <button type="button" className="btn btn--ghost" onClick={() => setOptions(undefined)}>
              {t('describe.again')}
            </button>
            <span className="grow" />
            <button type="button" className="btn" onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Describe (Section 4.4): sensory options for a selection or the paragraph under the caret, each to weave in. */
export function DescribeDialog() {
  const payload = useDialogs((s) => s.describe);
  if (!payload) return null;
  return <DescribeBody key={`${payload.from}:${payload.to}`} payload={payload} />;
}
