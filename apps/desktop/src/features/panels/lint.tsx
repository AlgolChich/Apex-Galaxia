import { useState } from 'react';
import { getClient } from '../../api/index.js';
import type { LintHit } from '../../api/types.js';
import { pick, useLanguage, useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { dispatchEditor } from '../diff/editor-bridge.js';
import { errorText } from './use-async.js';

const SEVERITIES: LintHit['severity'][] = ['error', 'warning', 'info'];

export function LintTab() {
  const t = useT();
  const language = useLanguage();
  const report = useStore((s) => s.lint.report);
  const running = useStore((s) => s.lint.running);
  const stem = useStore((s) => s.editor.stem);
  const runLint = useStore((s) => s.runLint);
  const toast = useStore((s) => s.toast);
  const [whitelisting, setWhitelisting] = useState<string | undefined>(undefined);

  const goto = (hit: LintHit) => dispatchEditor({ type: 'goto', from: hit.start, to: hit.end });

  const whitelist = async (hit: LintHit) => {
    setWhitelisting(hit.excerpt);
    try {
      await getClient().lintWhitelistAdd(hit.excerpt);
      toast('success', t('panels.lint.whitelisted', { phrase: hit.excerpt }));
      await runLint();
    } catch (error) {
      toast('error', errorText(error));
    } finally {
      setWhitelisting(undefined);
    }
  };

  return (
    <>
      <div className="panel__toolbar">
        <button type="button" className="btn small" onClick={() => void runLint()} disabled={running || !stem}>
          {running ? t('panels.lint.running') : t('panels.lint.rerun')}
        </button>
        {report ? <span className="small muted">{t('panels.lint.summary', { words: report.words, paragraphs: report.paragraphs })}</span> : null}
      </div>
      {!stem ? <div className="muted small">{t('panels.lint.none')}</div> : null}
      {stem && report && report.hits.length === 0 ? <div className="muted small">{t('panels.lint.clean')}</div> : null}
      {report
        ? SEVERITIES.map((severity) => {
            const hits = report.hits.filter((h) => h.severity === severity);
            if (hits.length === 0) return null;
            return (
              <section key={severity} className="panel__section" aria-label={t(`panels.lint.severity.${severity}`)}>
                <h3 className="panel__h">
                  <span className={`chip chip--${severity}`}>{hits.length}</span> {t(`panels.lint.severity.${severity}`)}
                </h3>
                <ul className="panel__list">
                  {hits.map((hit, index) => (
                    <li key={`${hit.rule}-${hit.start}-${index}`} className="panel__item">
                      <button type="button" className="panel__hit" onClick={() => goto(hit)} title={t('panels.lint.goto', { line: hit.line })}>
                        <span className="small">
                          <span className="mono">{hit.rule}</span> · {pick(language, hit.message)}
                        </span>
                        <span className="panel__hit-excerpt small">«{hit.excerpt}»</span>
                      </button>
                      {hit.rule === 'banned-phrase' ? (
                        <div className="row">
                          <span className="grow" />
                          <button type="button" className="btn btn--ghost small" onClick={() => void whitelist(hit)} disabled={whitelisting !== undefined}>
                            {t('panels.lint.whitelist')}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        : null}
    </>
  );
}
