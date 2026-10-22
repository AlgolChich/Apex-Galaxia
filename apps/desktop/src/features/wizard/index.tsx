import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { getClient } from '../../api/index.js';
import { useLanguage, useT, type UiLanguage } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { buildCreateOptions, emptyStoryForm, homeOfConfigFile, joinPath, slugOfTitle, type StoryForm } from './build.js';
import { KeyStep, LanguageStep, ProjectStep, VoiceStep } from './first-run.js';
import { messageOf, useNarratorOptions } from './narrator-options.js';
import { BasicsStep, CharactersStep, HarshnessStep, IdeaStep, LengthStep, NarrationStep, RatingStep, ScenesStep, StorytellerStep, SummaryStep, WorldStep } from './story-steps.js';
import './wizard.css';

export { KeyManager, ModelStatusLine } from './status.js';
export { buildCreateOptions, emptyStoryForm, type StoryForm } from './build.js';
export { useNarratorOptions, loadNarratorOptions, resetNarratorOptions } from './narrator-options.js';
export { Field, RadioCards, SelectField, hintId } from './field.js';

type StepId = 'language' | 'key' | 'project' | 'basics' | 'world' | 'characters' | 'idea' | 'storyteller' | 'harshness' | 'rating' | 'length' | 'narration' | 'scenes' | 'summary' | 'voice';

const STORY_STEPS: StepId[] = ['basics', 'world', 'characters', 'idea', 'storyteller', 'harshness', 'rating', 'length', 'narration', 'scenes', 'summary'];

interface Problems {
  title?: string;
  path?: string;
  importPath?: string;
}

/**
 * The wizards (Sections 11.3 and 11.7). `first-run`: interface language, the model key,
 * create or import a project, an optional voice sample. `new-story`: the brief template as
 * steps with one-line explanations; only the title, the language and the folder are
 * required, everything else falls back to the narrator's defaults.
 *
 * Steps are a form: Enter in a text field is Next, Back never validates. Opening or creating a
 * project closes the wizard in the store; in first-run mode the wizard keeps itself open
 * until the voice step is done, so the Author lands in the editor only once.
 */
export function Wizard({ mode }: { mode: 'first-run' | 'new-story' }) {
  const t = useT();
  const uiLanguage = useLanguage();
  const setLanguage = useStore((s) => s.setLanguage);
  const setWizard = useStore((s) => s.setWizard);
  const createProject = useStore((s) => s.createProject);
  const openProject = useStore((s) => s.openProject);
  const toast = useStore((s) => s.toast);
  const projectRoot = useStore((s) => s.project.root);
  const projectTitle = useStore((s) => s.project.config?.title);
  const model = useStore((s) => s.connection.model);
  const shell = getClient().transport.shell;
  const { options, error: optionsError } = useNarratorOptions();

  const [form, setForm] = useState<StoryForm>(() => emptyStoryForm(uiLanguage));
  const [choice, setChoice] = useState<'create' | 'import'>('create');
  const [importPath, setImportPath] = useState('');
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  const [home, setHome] = useState<string | undefined>(undefined);
  const [pathEdited, setPathEdited] = useState(false);
  const [projectDone, setProjectDone] = useState(false);
  const keepAlive = useRef(mode === 'first-run');
  const heading = useRef<HTMLHeadingElement>(null);

  const steps = useMemo<StepId[]>(() => (mode === 'new-story' ? STORY_STEPS : ['language', 'key', 'project', ...(choice === 'create' ? STORY_STEPS : []), 'voice']), [mode, choice]);
  const step: StepId = steps[Math.min(index, steps.length - 1)] ?? 'basics';
  const last = index >= steps.length - 1;

  // The store closes the wizard when a project opens; in first-run mode the voice step still follows.
  useEffect(() => {
    if (mode !== 'first-run') return;
    return useStore.subscribe((state, prev) => {
      if (keepAlive.current && prev.ui.wizard === 'first-run' && state.ui.wizard === 'none') state.setWizard('first-run');
    });
  }, [mode]);

  // The user's home folder, derived from where the user config lives, for the suggested project path.
  useEffect(() => {
    let live = true;
    getClient()
      .userConfigGet()
      .then(
        (result) => {
          if (live) setHome(homeOfConfigFile(result.file));
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const update = useCallback(<K extends keyof StoryForm>(key: K, value: StoryForm[K]) => setForm((f) => ({ ...f, [key]: value })), []);

  const suggestPath = useCallback((title: string) => (!shell && home ? joinPath(home, 'stories', slugOfTitle(title)) : undefined), [shell, home]);

  const onTitle = (title: string) => {
    const suggested = pathEdited ? undefined : suggestPath(title);
    setForm((f) => ({ ...f, title, ...(suggested !== undefined ? { path: suggested } : {}) }));
  };

  const onPath = (path: string) => {
    setPathEdited(true);
    update('path', path);
  };

  useEffect(() => {
    if (pathEdited || !home || !form.title.trim() || form.path) return;
    const suggested = suggestPath(form.title);
    if (suggested) update('path', suggested);
  }, [home, pathEdited, form.title, form.path, suggestPath, update]);

  const problems = (current: StepId): Problems => {
    const out: Problems = {};
    if (current === 'basics') {
      if (!form.title.trim()) out.title = t('wizard.basics.titleRequired');
      if (!form.path.trim()) out.path = t('wizard.basics.folderRequired');
    }
    if (current === 'project' && choice === 'import' && !projectDone && !importPath.trim()) out.importPath = t('wizard.project.pathRequired');
    return out;
  };
  const errors = touched ? problems(step) : {};

  const finish = () => {
    keepAlive.current = false;
    setWizard('none');
  };

  const advance = () => {
    setTouched(false);
    setError(undefined);
    setIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const next = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (Object.keys(problems(step)).length > 0) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (step === 'language') {
        await getClient()
          .userConfigSet({ ui_language: uiLanguage })
          .catch((failure: unknown) => toast('error', messageOf(failure)));
      }
      if (step === 'project' && choice === 'import' && !projectDone) {
        await openProject(importPath.trim());
        setProjectDone(true);
      }
      if (step === 'summary') {
        await createProject(buildCreateOptions(form));
        setProjectDone(true);
        if (mode === 'new-story') {
          finish();
          return;
        }
      }
      if (last) {
        finish();
        return;
      }
      advance();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setError(undefined);
    setTouched(false);
    setIndex((i) => Math.max(0, i - 1));
  };

  const cancel = () => {
    finish();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && mode === 'new-story' && !busy) {
      event.preventDefault();
      cancel();
    }
  };

  const title = t(`wizard.${step}.title`);
  const lead = (() => {
    switch (step) {
      case 'language':
        return undefined;
      case 'key':
        return t('wizard.key.hint');
      case 'project':
        return t('wizard.project.hint');
      case 'voice':
        return t('wizard.voice.hint');
      case 'summary':
        return t('wizard.summary.hint');
      default:
        return undefined;
    }
  })();

  const stepProps = { form, update, options };
  const body = (() => {
    switch (step) {
      case 'language':
        return (
          <LanguageStep
            value={uiLanguage}
            onChange={(language: UiLanguage) => {
              setLanguage(language);
              update('language', language);
            }}
          />
        );
      case 'key':
        return <KeyStep />;
      case 'project':
        return <ProjectStep choice={choice} onChoice={setChoice} path={importPath} onPath={setImportPath} error={errors.importPath} />;
      case 'basics':
        return <BasicsStep {...stepProps} errors={errors} onTitle={onTitle} onPath={onPath} />;
      case 'world':
        return <WorldStep {...stepProps} />;
      case 'characters':
        return <CharactersStep {...stepProps} />;
      case 'idea':
        return <IdeaStep {...stepProps} />;
      case 'storyteller':
        return <StorytellerStep {...stepProps} />;
      case 'harshness':
        return <HarshnessStep {...stepProps} />;
      case 'rating':
        return <RatingStep {...stepProps} />;
      case 'length':
        return <LengthStep {...stepProps} />;
      case 'narration':
        return <NarrationStep {...stepProps} />;
      case 'scenes':
        return <ScenesStep {...stepProps} />;
      case 'summary':
        return <SummaryStep {...stepProps} />;
      case 'voice':
        return <VoiceStep hasProject={Boolean(projectRoot)} model={model} />;
      default:
        return null;
    }
  })();

  const nextLabel = step === 'summary' ? (busy ? t('wizard.creating') : t('wizard.create')) : last ? t('common.finish') : t('common.next');
  const showBack = index > 0 && !(step === 'voice' && projectDone);

  return (
    <div className="wizard" data-step={step}>
      <form className="wizard__form" onSubmit={(e) => void next(e)} onKeyDown={onKeyDown} aria-labelledby="wizard-title" noValidate>
        <div className="wizard__kicker">
          <strong>{mode === 'first-run' ? t('wizard.firstRun.title') : t('wizard.newStory.title')}</strong>
          <span>{t('wizard.step', { n: index + 1, total: steps.length })}</span>
          {projectDone && projectTitle ? <span className="wizard__ok">{t('wizard.project.opened', { title: projectTitle })}</span> : null}
        </div>
        <h2 id="wizard-title" className="wizard__title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        {lead ? <p className="wizard__lead">{lead}</p> : null}
        {optionsError && ['storyteller', 'harshness', 'rating', 'length', 'summary'].includes(step) ? (
          <div className="wizard__error" role="alert">
            {t('wizard.optionsError', { error: optionsError })}
          </div>
        ) : null}
        {body}
        {error ? (
          <div className="wizard__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="wizard__nav">
          {showBack ? (
            <button type="button" className="btn" onClick={back} disabled={busy}>
              {t('common.back')}
            </button>
          ) : null}
          {step === 'key' ? (
            <button type="button" className="btn btn--ghost" onClick={advance} disabled={busy}>
              {t('wizard.skip')}
            </button>
          ) : null}
          <span className="grow" />
          <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {nextLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
