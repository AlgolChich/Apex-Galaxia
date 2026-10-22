import { useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { ModelStatus } from '../../api/types.js';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { messageOf } from './narrator-options.js';

/** Provider, key source and the scripted warning: the same line in the wizard and in Settings. */
export function ModelStatusLine({ status }: { status: ModelStatus | undefined }) {
  const t = useT();
  if (!status) return <div className="wizard__status muted">{t('wizard.status.unknown')}</div>;
  return (
    <div className="wizard__status" role="status">
      <span>{t('wizard.status.provider', { provider: status.provider })}</span>
      <span>{t('wizard.status.keySource', { source: status.key_source })}</span>
      {status.scripted ? <span className="wizard__warning">{t('wizard.status.scripted')}</span> : status.has_model ? <span className="wizard__ok">{t('wizard.status.ready')}</span> : <span className="muted">{t('wizard.status.noModel')}</span>}
    </div>
  );
}

/**
 * The model key in the OS keychain (Section 11.7): stored once through the shell, never shown
 * again, only «a key is stored» with Replace and Remove. In the browser there is no keychain:
 * the bridge's environment holds the key, and the form says so.
 *
 * `onStored` fires after a successful save, so the wizard can move on.
 */
export function KeyManager({ onStored }: { onStored?: () => void } = {}) {
  const t = useT();
  const model = useStore((s) => s.connection.model);
  const refreshModelStatus = useStore((s) => s.refreshModelStatus);
  const toast = useStore((s) => s.toast);
  const client = getClient();
  const shell = client.transport.shell;
  const [exists, setExists] = useState<boolean | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!shell) return;
    let live = true;
    shell.keyExists().then(
      (value) => {
        if (live) setExists(value);
      },
      () => {
        if (live) setExists(false);
      },
    );
    return () => {
      live = false;
    };
  }, [shell]);

  if (!shell) {
    return (
      <div className="stack">
        <div className="wizard__note">{t('wizard.key.browser')}</div>
        <ModelStatusLine status={model} />
      </div>
    );
  }

  const afterChange = async () => {
    await client.transport.restart();
    await refreshModelStatus();
  };

  const save = async () => {
    const value = key.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await shell.keySet(value);
      setKey('');
      await afterChange();
      setExists(true);
      setReplacing(false);
      toast('success', t('wizard.key.saved'));
      onStored?.();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await shell.keyDelete();
      await afterChange();
      setExists(false);
      toast('info', t('wizard.key.removed'));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const showInput = exists === false || replacing;
  return (
    <div className="stack">
      {exists && !replacing ? (
        <div className="row">
          <span className="wizard__ok">{t('wizard.key.stored')}</span>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => setReplacing(true)} disabled={busy}>
            {t('wizard.key.replace')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => void remove()} disabled={busy}>
            {t('wizard.key.remove')}
          </button>
        </div>
      ) : null}
      {showInput ? (
        <div className="field">
          <label className="field__label" htmlFor="wizard-key">
            {t('wizard.key.label')}
          </label>
          <div className="row">
            <input
              id="wizard-key"
              className="input grow"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
              }}
              aria-describedby="wizard-key-hint"
              disabled={busy}
            />
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !key.trim()}>
              {busy ? t('wizard.key.saving') : t('wizard.key.save')}
            </button>
            {replacing ? (
              <button type="button" className="btn btn--ghost" onClick={() => (setReplacing(false), setKey(''))} disabled={busy}>
                {t('common.cancel')}
              </button>
            ) : null}
          </div>
          <div className="field__hint" id="wizard-key-hint">
            {t('wizard.key.inputHint')}
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="wizard__error" role="alert">
          {error}
        </div>
      ) : null}
      <ModelStatusLine status={model} />
    </div>
  );
}
