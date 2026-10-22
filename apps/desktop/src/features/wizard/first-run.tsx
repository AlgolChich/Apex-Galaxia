import { useRef, useState, type ChangeEvent } from 'react';
import { getClient } from '../../api/index.js';
import type { ModelStatus } from '../../api/types.js';
import { useT, type UiLanguage } from '../../i18n/index.js';
import { Field, RadioCards, hintId } from './field.js';
import { messageOf } from './narrator-options.js';
import { KeyManager } from './status.js';

export function LanguageStep({ value, onChange }: { value: UiLanguage; onChange: (language: UiLanguage) => void }) {
  const t = useT();
  return (
    <RadioCards<UiLanguage>
      name="wizard-ui-language"
      legend={t('app.language')}
      hint={t('wizard.language.hint')}
      value={value}
      onChange={onChange}
      defaultLabel=""
      columns={2}
      options={[
        { value: 'ru', name: t('wizard.language.ru'), lines: [] },
        { value: 'en', name: t('wizard.language.en'), lines: [] },
      ]}
    />
  );
}

export function KeyStep() {
  const t = useT();
  return (
    <div className="stack">
      <KeyManager />
      <div className="wizard__note">{t('wizard.key.without')}</div>
    </div>
  );
}

/** How the first run gets a project: a brief, an existing folder, or a manuscript imported into a new folder. */
export type ProjectChoice = 'create' | 'import' | 'manuscript';

export function ProjectStep({ choice, onChoice, path, onPath, error, imported }: { choice: ProjectChoice; onChoice: (choice: ProjectChoice) => void; path: string; onPath: (path: string) => void; error: string | undefined; imported?: boolean }) {
  const t = useT();
  const shell = getClient().transport.shell;
  const pick = async () => {
    const chosen = await shell?.pickFolder({ title: t('wizard.project.import') });
    if (chosen) onPath(chosen);
  };
  return (
    <div className="wizard__step">
      <RadioCards<ProjectChoice>
        name="wizard-project-choice"
        legend={t('wizard.project.choice')}
        value={choice}
        onChange={onChoice}
        defaultLabel=""
        columns={3}
        options={[
          { value: 'create', name: t('wizard.project.create'), lines: [t('wizard.project.createHint')] },
          { value: 'import', name: t('wizard.project.import'), lines: [t('wizard.project.importHint')] },
          { value: 'manuscript', name: t('wizard.project.manuscript'), lines: [t('wizard.project.manuscriptHint')] },
        ]}
      />
      {choice === 'manuscript' ? <div className="wizard__note">{imported ? t('wizard.project.manuscriptDone') : t('wizard.project.manuscriptNote')}</div> : null}
      {choice === 'import' ? (
        <Field id="wizard-import-path" label={t('wizard.project.path')} hint={t('wizard.project.pathHint')} error={error} required>
          <div className="field__path">
            {shell ? (
              <>
                <span className="mono" aria-live="polite">
                  {path || t('wizard.basics.folderEmpty')}
                </span>
                <button id="wizard-import-path" type="button" className="btn" onClick={() => void pick()}>
                  {t('wizard.project.pick')}
                </button>
              </>
            ) : (
              <input id="wizard-import-path" className="input" value={path} onChange={(e) => onPath(e.target.value)} aria-describedby={hintId('wizard-import-path')} spellCheck={false} />
            )}
          </div>
        </Field>
      ) : null}
    </div>
  );
}

interface VoiceResult {
  card: string;
  file: string | null;
  costUsd: number;
  model: string;
}

export function VoiceStep({ hasProject, model }: { hasProject: boolean; model: ModelStatus | undefined }) {
  const t = useT();
  const [sample, setSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<VoiceResult | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const canRun = hasProject && Boolean(model?.has_model);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setSample(await file.text());
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      event.target.value = '';
    }
  };

  const make = async () => {
    if (!sample.trim() || busy || !canRun) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await getClient().voiceCard(sample));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wizard__step">
      {!hasProject ? <div className="wizard__note">{t('wizard.voice.noProject')}</div> : null}
      {hasProject && !model?.has_model ? <div className="wizard__note">{t('wizard.voice.needsModel')}</div> : null}
      <Field id="wizard-voice-sample" label={t('wizard.voice.sample')} hint={t('wizard.voice.sampleHint')}>
        <textarea id="wizard-voice-sample" className="textarea prose" rows={10} value={sample} onChange={(e) => setSample(e.target.value)} aria-describedby={hintId('wizard-voice-sample')} disabled={busy} />
      </Field>
      <div className="row">
        <input ref={fileInput} type="file" accept=".md,.txt,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} />
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy} aria-describedby="wizard-voice-file-hint">
          {t('wizard.voice.pick')}
        </button>
        <span className="field__hint" id="wizard-voice-file-hint">
          {t('wizard.voice.fileHint')}
        </span>
        <span className="grow" />
        <button type="button" className="btn btn--primary" onClick={() => void make()} disabled={busy || !canRun || !sample.trim()}>
          {busy ? t('wizard.voice.making') : t('wizard.voice.make')}
        </button>
      </div>
      {error ? (
        <div className="wizard__error" role="alert">
          {error}
        </div>
      ) : null}
      {result ? (
        <section className="card stack" aria-label={t('wizard.voice.card')}>
          <div className="row small muted">
            <strong>{t('wizard.voice.card')}</strong>
            <span className="grow" />
            <span>
              {t('common.model')}: {result.model}
              {model?.scripted ? ` (${t('app.model.scripted')})` : ''} · {t('common.cost')}: ${result.costUsd.toFixed(4)}
            </span>
          </div>
          <div className="wizard__card">{result.card}</div>
          {result.file ? <div className="small muted">{t('wizard.voice.saved', { file: result.file })}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
