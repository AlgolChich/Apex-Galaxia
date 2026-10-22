import { useEffect, useState } from 'react';
import { getClient } from '../../api/index.js';
import type { ModelRoles, Preset, ProjectConfig } from '../../api/types.js';
import { pick, useLanguage, useT, type UiLanguage } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Field, SelectField, hintId } from '../wizard/field.js';
import { messageOf, useNarratorOptions } from '../wizard/narrator-options.js';
import { KeyManager, ModelStatusLine } from '../wizard/status.js';
import { ViewFrame } from '../views/frame.js';
import { ROLES, draftOf, patchOf, type SettingsDraft } from './patch.js';
import './settings.css';

export { draftOf, patchOf, type SettingsDraft } from './patch.js';

const PRESETS: Preset[] = ['fast', 'balanced', 'best'];

/**
 * Settings (Section 11.4): the project form from project.yaml with the narrator's
 * explanations next to each choice, saved as a patch of the changed fields only, and the
 * user settings: interface language, the model key, default models, the model status.
 */
export function SettingsView() {
  const t = useT();
  const language = useLanguage();
  const config = useStore((s) => s.project.config);
  const root = useStore((s) => s.project.root);
  const updateSettings = useStore((s) => s.updateSettings);
  const setLanguage = useStore((s) => s.setLanguage);
  const model = useStore((s) => s.connection.model);
  const toast = useStore((s) => s.toast);
  const { options } = useNarratorOptions();
  const client = getClient();

  const [draft, setDraft] = useState<SettingsDraft | undefined>(undefined);
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [userModels, setUserModels] = useState<Partial<ModelRoles>>({});
  const [savingModels, setSavingModels] = useState(false);

  // Re-seed the form only when project.yaml really changed, never on an identical reload.
  useEffect(() => {
    if (!config) {
      setDraft(undefined);
      setBaseline('');
      return;
    }
    const key = JSON.stringify(config);
    if (key !== baseline) {
      setDraft(draftOf(config));
      setBaseline(key);
    }
  }, [config, baseline]);

  useEffect(() => {
    let live = true;
    client
      .userConfigGet()
      .then((result) => {
        if (live) setUserModels(result.config.models ?? {});
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client]);

  const patch = draft && config ? patchOf(draft, config) : {};
  const changedKeys = Object.keys(patch);

  const save = async () => {
    if (!config || changedKeys.length === 0 || saving) return;
    setSaving(true);
    try {
      await updateSettings(patch);
    } catch {
      // the store already showed the error toast
    } finally {
      setSaving(false);
    }
  };

  const changeLanguage = (next: UiLanguage) => {
    setLanguage(next);
    client.userConfigSet({ ui_language: next }).catch((failure: unknown) => toast('error', messageOf(failure)));
  };

  const saveUserModels = async () => {
    if (savingModels) return;
    setSavingModels(true);
    try {
      const models = Object.fromEntries(ROLES.flatMap((role) => (userModels[role]?.trim() ? [[role, userModels[role]!.trim()]] : []))) as Partial<ModelRoles>;
      const result = await client.userConfigSet({ models });
      setUserModels(result.config.models ?? {});
      toast('success', t('settings.defaultModelsSaved'));
    } catch (failure) {
      toast('error', messageOf(failure));
    } finally {
      setSavingModels(false);
    }
  };

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const storytellerHint = options?.storytellers.find((s) => s.id === draft?.storyteller);
  const harshnessHint = options?.harshness.find((h) => h.level === draft?.harshness);
  const ratingHint = options?.ratings.find((r) => r.id === draft?.rating);
  const lengthHint = options?.lengths.find((l) => l.id === draft?.length);

  return (
    <ViewFrame id="settings" title={t('settings.title')}>
      <div className="settings">
        <section className="view__section" aria-labelledby="settings-project-title">
          <h2 id="settings-project-title">{t('settings.project')}</h2>
          {!config || !draft ? (
            <div className="muted">{t('settings.noProject')}</div>
          ) : (
            <form
              className="settings"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              aria-label={t('settings.project')}
              noValidate
            >
              <div className="view__hint">{t('settings.projectHint', { root: root ?? '' })}</div>
              <div className="settings__group">
                <Field id="settings-story-title" label={t('settings.storyTitle')} hint={t('settings.storyTitleHint')}>
                  <input id="settings-story-title" className="input" value={draft.title} onChange={(e) => set('title', e.target.value)} aria-describedby={hintId('settings-story-title')} />
                </Field>
              </div>

              <div className="settings__group">
                <h3>{t('settings.narrator')}</h3>
                <div className="settings__grid">
                  <SelectField<ProjectConfig['storyteller']>
                    id="settings-storyteller"
                    label={t('wizard.storyteller.title')}
                    hint={storytellerHint ? `${pick(language, storytellerHint.rhythm)}. ${pick(language, storytellerHint.expect)}` : t('wizard.storyteller.hint')}
                    value={draft.storyteller}
                    onChange={(v) => v && set('storyteller', v)}
                    options={(options?.storytellers ?? [{ id: draft.storyteller, name: { ru: draft.storyteller, en: draft.storyteller } }]).map((s) => ({ value: s.id, label: pick(language, s.name) }))}
                  />
                  <Field id="settings-harshness" label={t('wizard.harshness.title')} hint={harshnessHint ? pick(language, harshnessHint.allowed) : t('wizard.harshness.hint')}>
                    <select id="settings-harshness" className="select" value={draft.harshness} onChange={(e) => set('harshness', Number(e.target.value))} aria-describedby={hintId('settings-harshness')}>
                      {(options?.harshness ?? [{ level: draft.harshness, name: { ru: String(draft.harshness), en: String(draft.harshness) } }]).map((h) => (
                        <option key={h.level} value={h.level}>
                          {t('wizard.harshness.level', { n: h.level, name: pick(language, h.name) })}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <SelectField<ProjectConfig['rating']>
                    id="settings-rating"
                    label={t('wizard.rating.title')}
                    hint={ratingHint ? pick(language, ratingHint.allowed) : t('wizard.rating.hint')}
                    value={draft.rating}
                    onChange={(v) => v && set('rating', v)}
                    options={(options?.ratings ?? [{ id: draft.rating, name: { ru: draft.rating, en: draft.rating } }]).map((r) => ({ value: r.id, label: pick(language, r.name) }))}
                  />
                  <SelectField<ProjectConfig['length']>
                    id="settings-length"
                    label={t('wizard.length.title')}
                    hint={lengthHint ? `${t('wizard.length.pages', { a: lengthHint.pages[0], b: lengthHint.pages[1] })} · ${t('wizard.length.chapters', { a: lengthHint.chapters[0], b: lengthHint.chapters[1] })} · ${lengthHint.plan_approval ? t('wizard.length.approval') : t('wizard.length.noApproval')}` : t('wizard.length.hint')}
                    value={draft.length}
                    onChange={(v) => v && set('length', v)}
                    options={(options?.lengths ?? [{ id: draft.length, name: { ru: draft.length, en: draft.length } }]).map((l) => ({ value: l.id, label: pick(language, l.name) }))}
                  />
                </div>
              </div>

              <div className="settings__group">
                <h3>{t('settings.narration')}</h3>
                <div className="settings__grid">
                  <SelectField<ProjectConfig['pov']>
                    id="settings-pov"
                    label={t('wizard.narration.pov')}
                    hint={t('wizard.narration.povHint')}
                    value={draft.pov}
                    onChange={(v) => v && set('pov', v)}
                    options={[
                      { value: 'first', label: t('wizard.pov.first') },
                      { value: 'third', label: t('wizard.pov.third') },
                    ]}
                  />
                  <SelectField<ProjectConfig['tense']>
                    id="settings-tense"
                    label={t('wizard.narration.tense')}
                    hint={t('wizard.narration.tenseHint')}
                    value={draft.tense}
                    onChange={(v) => v && set('tense', v)}
                    options={[
                      { value: 'past', label: t('wizard.tense.past') },
                      { value: 'present', label: t('wizard.tense.present') },
                    ]}
                  />
                  <SelectField<ProjectConfig['cliffhangers']>
                    id="settings-cliff"
                    label={t('wizard.narration.cliff')}
                    hint={t('wizard.narration.cliffHint')}
                    value={draft.cliffhangers}
                    onChange={(v) => v && set('cliffhangers', v)}
                    options={[
                      { value: 'none', label: t('wizard.cliff.none') },
                      { value: 'chapters', label: t('wizard.cliff.chapters') },
                      { value: 'chapters_and_finale', label: t('wizard.cliff.chapters_and_finale') },
                    ]}
                  />
                  <SelectField<ProjectConfig['ending']>
                    id="settings-ending"
                    label={t('wizard.narration.ending')}
                    hint={t('wizard.narration.endingHint')}
                    value={draft.ending}
                    onChange={(v) => v && set('ending', v)}
                    options={[
                      { value: 'happy', label: t('wizard.ending.happy') },
                      { value: 'bittersweet', label: t('wizard.ending.bittersweet') },
                      { value: 'tragic', label: t('wizard.ending.tragic') },
                      { value: 'open', label: t('wizard.ending.open') },
                      { value: 'narrator', label: t('wizard.ending.narrator') },
                    ]}
                  />
                  <SelectField<ProjectConfig['original_characters']>
                    id="settings-oc"
                    label={t('wizard.characters.oc')}
                    hint={t('wizard.characters.ocHint')}
                    value={draft.original_characters}
                    onChange={(v) => v && set('original_characters', v)}
                    options={[
                      { value: 'no', label: t('wizard.oc.no') },
                      { value: 'yes', label: t('wizard.oc.yes') },
                      { value: 'narrator', label: t('wizard.oc.narrator') },
                    ]}
                  />
                  {config.language === 'ru' ? (
                    <SelectField<ProjectConfig['yo_policy']>
                      id="settings-yo"
                      label={t('wizard.scenes.yo')}
                      hint={t('wizard.scenes.yoHint')}
                      value={draft.yo_policy}
                      onChange={(v) => v && set('yo_policy', v)}
                      options={[
                        { value: 'yo', label: t('wizard.yo.yo') },
                        { value: 'ye', label: t('wizard.yo.ye') },
                      ]}
                    />
                  ) : (
                    <SelectField<ProjectConfig['spelling']>
                      id="settings-spelling"
                      label={t('wizard.scenes.spelling')}
                      hint={t('wizard.scenes.spellingHint')}
                      value={draft.spelling}
                      onChange={(v) => v && set('spelling', v)}
                      options={[
                        { value: 'us', label: t('wizard.spelling.us') },
                        { value: 'uk', label: t('wizard.spelling.uk') },
                      ]}
                    />
                  )}
                  <SelectField<Preset> id="settings-preset" label={t('settings.preset')} hint={`${t(`settings.preset.${draft.preset}`)}. ${t('settings.presetHint')}`} value={draft.preset} onChange={(v) => v && set('preset', v)} options={PRESETS.map((p) => ({ value: p, label: t(`settings.preset.${p}`) }))} />
                </div>
              </div>

              <div className="settings__group">
                <h3>{t('settings.models')}</h3>
                <div className="view__hint">{t('settings.modelsHint')}</div>
                <div className="settings__grid">
                  {ROLES.map((role) => (
                    <Field key={role} id={`settings-model-${role}`} label={role} hint={t(`settings.role.${role}`)}>
                      <input id={`settings-model-${role}`} className="input mono" value={draft.models[role]} onChange={(e) => set('models', { ...draft.models, [role]: e.target.value })} aria-describedby={hintId(`settings-model-${role}`)} spellCheck={false} />
                    </Field>
                  ))}
                </div>
              </div>

              <div className="settings__group">
                <h3>{t('settings.budget')}</h3>
                <div className="settings__grid">
                  <Field id="settings-budget-context" label={t('settings.budget.context')} hint={t('settings.budget.contextHint')}>
                    <input id="settings-budget-context" className="input" type="number" min={1000} value={draft.budget.context_tokens} onChange={(e) => set('budget', { ...draft.budget, context_tokens: e.target.value })} aria-describedby={hintId('settings-budget-context')} />
                  </Field>
                  <Field id="settings-budget-project" label={t('settings.budget.project')} hint={t('settings.budget.projectHint')}>
                    <input id="settings-budget-project" className="input" type="number" min={0} value={draft.budget.project_usd} onChange={(e) => set('budget', { ...draft.budget, project_usd: e.target.value })} aria-describedby={hintId('settings-budget-project')} />
                  </Field>
                  <Field id="settings-budget-warn" label={t('settings.budget.warn')} hint={t('settings.budget.warnHint')}>
                    <input id="settings-budget-warn" className="input" type="number" min={0} value={draft.budget.warn_at_usd} onChange={(e) => set('budget', { ...draft.budget, warn_at_usd: e.target.value })} aria-describedby={hintId('settings-budget-warn')} />
                  </Field>
                </div>
              </div>

              <div className="settings__group">
                <h3>{t('settings.window')}</h3>
                <div className="settings__grid">
                  <Field id="settings-window-tail" label={t('settings.window.tail')} hint={t('settings.window.tailHint')}>
                    <input id="settings-window-tail" className="input" type="number" min={0} value={draft.window.previous_tail_words} onChange={(e) => set('window', { ...draft.window, previous_tail_words: e.target.value })} aria-describedby={hintId('settings-window-tail')} />
                  </Field>
                  <Field id="settings-window-current" label={t('settings.window.current')} hint={t('settings.window.currentHint')}>
                    <input id="settings-window-current" className="input" type="number" min={100} value={draft.window.current_chapter_words} onChange={(e) => set('window', { ...draft.window, current_chapter_words: e.target.value })} aria-describedby={hintId('settings-window-current')} />
                  </Field>
                </div>
              </div>

              <div className="settings__bar">
                <span className="small muted">{changedKeys.length === 0 ? t('settings.nothingChanged') : t('settings.changed', { keys: changedKeys.join(', ') })}</span>
                <span className="grow" />
                <button type="submit" className="btn btn--primary" disabled={changedKeys.length === 0 || saving}>
                  {saving ? t('common.working') : t('common.save')}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="view__section" aria-labelledby="settings-user-title">
          <h2 id="settings-user-title">{t('settings.user')}</h2>
          <div className="view__hint">{t('settings.userHint')}</div>
          <div className="settings__group">
            <SelectField<UiLanguage>
              id="settings-ui-language"
              label={t('app.language')}
              hint={t('settings.uiLanguageHint')}
              value={language}
              onChange={(v) => v && changeLanguage(v)}
              options={[
                { value: 'ru', label: t('wizard.language.ru') },
                { value: 'en', label: t('wizard.language.en') },
              ]}
            />
          </div>
          <div className="settings__group">
            <h3>{t('settings.key')}</h3>
            <KeyManager />
          </div>
          <div className="settings__group">
            <h3>{t('settings.defaultModels')}</h3>
            <div className="view__hint">{t('settings.defaultModelsHint')}</div>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void saveUserModels();
              }}
              aria-label={t('settings.defaultModels')}
            >
              <div className="settings__grid">
                {ROLES.map((role) => (
                  <Field key={role} id={`settings-user-model-${role}`} label={role} hint={t(`settings.role.${role}`)}>
                    <input id={`settings-user-model-${role}`} className="input mono" value={userModels[role] ?? ''} onChange={(e) => setUserModels({ ...userModels, [role]: e.target.value })} aria-describedby={hintId(`settings-user-model-${role}`)} spellCheck={false} />
                  </Field>
                ))}
              </div>
              <div>
                <button type="submit" className="btn" disabled={savingModels}>
                  {savingModels ? t('common.working') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
          <div className="settings__group">
            <h3>{t('settings.status')}</h3>
            <ModelStatusLine status={model} />
          </div>
        </section>
      </div>
    </ViewFrame>
  );
}
