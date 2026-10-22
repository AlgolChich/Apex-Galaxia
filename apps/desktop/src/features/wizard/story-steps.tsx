import { getClient } from '../../api/index.js';
import type { Language, LengthClass, NarratorOptions, Rating, Storyteller } from '../../api/types.js';
import { pick, useLanguage, useT } from '../../i18n/index.js';
import type { StoryForm } from './build.js';
import { Field, RadioCards, SelectField, hintId } from './field.js';

export interface StepProps {
  form: StoryForm;
  update: <K extends keyof StoryForm>(key: K, value: StoryForm[K]) => void;
  options: NarratorOptions | undefined;
}

function TextArea({ id, label, hint, value, onChange, rows = 3 }: { id: string; label: string; hint: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <textarea id={id} className="textarea" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hintId(id)} />
    </Field>
  );
}

export function BasicsStep({ form, update, errors, onTitle, onPath }: StepProps & { errors: { title?: string; path?: string }; onTitle: (title: string) => void; onPath: (path: string) => void }) {
  const t = useT();
  const shell = getClient().transport.shell;
  const pickFolder = async () => {
    const chosen = await shell?.pickFolder({ title: t('wizard.basics.folder') });
    if (chosen) onPath(chosen);
  };
  return (
    <div className="wizard__step">
      <Field id="wizard-story-title" label={t('wizard.basics.storyTitle')} hint={t('wizard.basics.storyTitleHint')} error={errors.title} required>
        <input id="wizard-story-title" className="input" value={form.title} onChange={(e) => onTitle(e.target.value)} aria-describedby={hintId('wizard-story-title')} aria-invalid={errors.title ? true : undefined} autoFocus />
      </Field>
      <SelectField<Language>
        id="wizard-language"
        label={t('wizard.basics.language')}
        hint={t('wizard.basics.languageHint')}
        value={form.language}
        onChange={(value) => update('language', (value || 'ru') as Language)}
        options={[
          { value: 'ru', label: t('wizard.language.ru') },
          { value: 'en', label: t('wizard.language.en') },
        ]}
      />
      <Field id="wizard-path" label={t('wizard.basics.folder')} hint={shell ? t('wizard.basics.folderHint') : t('wizard.basics.folderHintBrowser')} error={errors.path} required>
        <div className="field__path">
          {shell ? (
            <>
              <span className="mono" aria-live="polite">
                {form.path || t('wizard.basics.folderEmpty')}
              </span>
              <button id="wizard-path" type="button" className="btn" onClick={() => void pickFolder()} aria-describedby={hintId('wizard-path')}>
                {t('wizard.project.pick')}
              </button>
            </>
          ) : (
            <input id="wizard-path" className="input" value={form.path} onChange={(e) => onPath(e.target.value)} aria-describedby={hintId('wizard-path')} aria-invalid={errors.path ? true : undefined} spellCheck={false} />
          )}
        </div>
      </Field>
    </div>
  );
}

export function WorldStep({ form, update }: StepProps) {
  const t = useT();
  return (
    <div className="wizard__step">
      <TextArea id="wizard-universe" label={t('wizard.world.universe')} hint={t('wizard.world.universeHint')} value={form.universe} onChange={(v) => update('universe', v)} rows={2} />
      <TextArea id="wizard-canon" label={t('wizard.world.canonPoint')} hint={t('wizard.world.canonPointHint')} value={form.canon_point} onChange={(v) => update('canon_point', v)} rows={2} />
    </div>
  );
}

export function CharactersStep({ form, update, options }: StepProps) {
  const t = useT();
  const fallback = options?.defaults.original_characters;
  return (
    <div className="wizard__step">
      <TextArea id="wizard-leads" label={t('wizard.characters.leads')} hint={t('wizard.characters.leadsHint')} value={form.leads} onChange={(v) => update('leads', v)} />
      <TextArea id="wizard-supporting" label={t('wizard.characters.supporting')} hint={t('wizard.characters.supportingHint')} value={form.supporting} onChange={(v) => update('supporting', v)} />
      <RadioCards<'no' | 'yes' | 'narrator'>
        name="wizard-oc"
        legend={t('wizard.characters.oc')}
        hint={t('wizard.characters.ocHint')}
        value={form.original_characters}
        onChange={(v) => update('original_characters', v)}
        defaultLabel={t('wizard.default')}
        columns={3}
        options={[
          { value: 'no', name: t('wizard.oc.no'), lines: [t('wizard.oc.noHint')], isDefault: fallback === 'no' },
          { value: 'yes', name: t('wizard.oc.yes'), lines: [t('wizard.oc.yesHint')], isDefault: fallback === 'yes' },
          { value: 'narrator', name: t('wizard.oc.narrator'), lines: [t('wizard.oc.narratorHint')], isDefault: fallback === 'narrator' },
        ]}
      />
    </div>
  );
}

export function IdeaStep({ form, update }: StepProps) {
  const t = useT();
  return (
    <div className="wizard__step">
      <TextArea id="wizard-idea" label={t('wizard.idea.idea')} hint={t('wizard.idea.ideaHint')} value={form.idea} onChange={(v) => update('idea', v)} rows={4} />
      <TextArea id="wizard-genre" label={t('wizard.idea.genre')} hint={t('wizard.idea.genreHint')} value={form.genre_tone} onChange={(v) => update('genre_tone', v)} rows={2} />
    </div>
  );
}

export function StorytellerStep({ form, update, options }: StepProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <RadioCards<Storyteller>
      name="wizard-storyteller"
      legend={t('wizard.storyteller.title')}
      hint={t('wizard.storyteller.hint')}
      value={form.storyteller}
      onChange={(v) => update('storyteller', v)}
      defaultLabel={t('wizard.default')}
      options={(options?.storytellers ?? []).map((s) => ({ value: s.id, name: pick(language, s.name), lines: [t('wizard.storyteller.rhythm', { text: pick(language, s.rhythm) }), t('wizard.storyteller.expect', { text: pick(language, s.expect) })], isDefault: s.default }))}
    />
  );
}

export function HarshnessStep({ form, update, options }: StepProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <RadioCards<number>
      name="wizard-harshness"
      legend={t('wizard.harshness.title')}
      hint={t('wizard.harshness.hint')}
      value={form.harshness}
      onChange={(v) => update('harshness', v)}
      defaultLabel={t('wizard.default')}
      columns={2}
      options={(options?.harshness ?? []).map((h) => ({ value: h.level, name: t('wizard.harshness.level', { n: h.level, name: pick(language, h.name) }), lines: [pick(language, h.allowed)], isDefault: h.default }))}
    />
  );
}

export function RatingStep({ form, update, options }: StepProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <RadioCards<Rating>
      name="wizard-rating"
      legend={t('wizard.rating.title')}
      hint={t('wizard.rating.hint')}
      value={form.rating}
      onChange={(v) => update('rating', v)}
      defaultLabel={t('wizard.default')}
      columns={2}
      options={(options?.ratings ?? []).map((r) => ({ value: r.id, name: pick(language, r.name), lines: [pick(language, r.allowed)], isDefault: r.default }))}
    />
  );
}

export function LengthStep({ form, update, options }: StepProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <RadioCards<LengthClass>
      name="wizard-length"
      legend={t('wizard.length.title')}
      hint={t('wizard.length.hint')}
      value={form.length}
      onChange={(v) => update('length', v)}
      defaultLabel={t('wizard.default')}
      columns={2}
      options={(options?.lengths ?? []).map((l) => ({
        value: l.id,
        name: pick(language, l.name),
        lines: [[t('wizard.length.pages', { a: l.pages[0], b: l.pages[1] }), t('wizard.length.words', { a: l.words[0], b: l.words[1] }), t('wizard.length.chapters', { a: l.chapters[0], b: l.chapters[1] })].join(' · '), l.plan_approval ? t('wizard.length.approval') : t('wizard.length.noApproval')],
        isDefault: l.default,
      }))}
    />
  );
}

export function NarrationStep({ form, update, options }: StepProps) {
  const t = useT();
  const d = options?.defaults;
  const fallback = (name: string | undefined) => (name ? t('wizard.defaultOption', { name }) : t('wizard.defaultPlain'));
  return (
    <div className="wizard__step">
      <div className="wizard__row">
        <SelectField<'first' | 'third'>
          id="wizard-pov"
          label={t('wizard.narration.pov')}
          hint={t('wizard.narration.povHint')}
          value={form.pov}
          onChange={(v) => update('pov', v)}
          empty={fallback(d ? t(`wizard.pov.${d.pov}`) : undefined)}
          options={[
            { value: 'first', label: t('wizard.pov.first') },
            { value: 'third', label: t('wizard.pov.third') },
          ]}
        />
        <SelectField<'past' | 'present'>
          id="wizard-tense"
          label={t('wizard.narration.tense')}
          hint={t('wizard.narration.tenseHint')}
          value={form.tense}
          onChange={(v) => update('tense', v)}
          empty={fallback(d ? t(`wizard.tense.${d.tense}`) : undefined)}
          options={[
            { value: 'past', label: t('wizard.tense.past') },
            { value: 'present', label: t('wizard.tense.present') },
          ]}
        />
      </div>
      <div className="wizard__row">
        <SelectField<'none' | 'chapters' | 'chapters_and_finale'>
          id="wizard-cliff"
          label={t('wizard.narration.cliff')}
          hint={t('wizard.narration.cliffHint')}
          value={form.cliffhangers}
          onChange={(v) => update('cliffhangers', v)}
          empty={fallback(d ? t(`wizard.cliff.${d.cliffhangers}`) : undefined)}
          options={[
            { value: 'none', label: t('wizard.cliff.none') },
            { value: 'chapters', label: t('wizard.cliff.chapters') },
            { value: 'chapters_and_finale', label: t('wizard.cliff.chapters_and_finale') },
          ]}
        />
        <SelectField<'happy' | 'bittersweet' | 'tragic' | 'open' | 'narrator'>
          id="wizard-ending"
          label={t('wizard.narration.ending')}
          hint={t('wizard.narration.endingHint')}
          value={form.ending}
          onChange={(v) => update('ending', v)}
          empty={fallback(d ? t(`wizard.ending.${d.ending}`) : undefined)}
          options={[
            { value: 'happy', label: t('wizard.ending.happy') },
            { value: 'bittersweet', label: t('wizard.ending.bittersweet') },
            { value: 'tragic', label: t('wizard.ending.tragic') },
            { value: 'open', label: t('wizard.ending.open') },
            { value: 'narrator', label: t('wizard.ending.narrator') },
          ]}
        />
      </div>
    </div>
  );
}

export function ScenesStep({ form, update }: StepProps) {
  const t = useT();
  return (
    <div className="wizard__step">
      <TextArea id="wizard-must" label={t('wizard.scenes.must')} hint={t('wizard.scenes.mustHint')} value={form.must_have_scenes} onChange={(v) => update('must_have_scenes', v)} />
      <TextArea id="wizard-taboos" label={t('wizard.scenes.taboos')} hint={t('wizard.scenes.taboosHint')} value={form.taboos} onChange={(v) => update('taboos', v)} />
      {form.language === 'ru' ? (
        <SelectField<'yo' | 'ye'>
          id="wizard-yo"
          label={t('wizard.scenes.yo')}
          hint={t('wizard.scenes.yoHint')}
          value={form.yo_policy}
          onChange={(v) => update('yo_policy', v)}
          empty={t('wizard.defaultOption', { name: t('wizard.yo.yo') })}
          options={[
            { value: 'yo', label: t('wizard.yo.yo') },
            { value: 'ye', label: t('wizard.yo.ye') },
          ]}
        />
      ) : (
        <SelectField<'us' | 'uk'>
          id="wizard-spelling"
          label={t('wizard.scenes.spelling')}
          hint={t('wizard.scenes.spellingHint')}
          value={form.spelling}
          onChange={(v) => update('spelling', v)}
          empty={t('wizard.defaultOption', { name: t('wizard.spelling.us') })}
          options={[
            { value: 'us', label: t('wizard.spelling.us') },
            { value: 'uk', label: t('wizard.spelling.uk') },
          ]}
        />
      )}
    </div>
  );
}

/** The brief as the project will get it: every line of the template, «default» where nothing was chosen. */
export function SummaryStep({ form, options }: StepProps) {
  const t = useT();
  const language = useLanguage();
  const d = options?.defaults;
  const byId = <T extends { id: string; name: { ru: string; en: string } }>(list: T[] | undefined, id: string | undefined) => (id ? pick(language, list?.find((x) => x.id === id)?.name) || id : '');
  const rows: Array<[string, string, boolean]> = [
    [t('wizard.basics.storyTitle'), form.title.trim(), false],
    [t('wizard.basics.language'), t(`wizard.language.${form.language}`), false],
    [t('wizard.summary.folder'), form.path.trim(), false],
    [t('wizard.world.universe'), form.universe.trim(), false],
    [t('wizard.world.canonPoint'), form.canon_point.trim(), false],
    [t('wizard.characters.leads'), form.leads.trim(), false],
    [t('wizard.characters.supporting'), form.supporting.trim(), false],
    [t('wizard.characters.oc'), form.original_characters ? t(`wizard.oc.${form.original_characters}`) : d ? t(`wizard.oc.${d.original_characters}`) : '', !form.original_characters],
    [t('wizard.idea.idea'), form.idea.trim(), false],
    [t('wizard.idea.genre'), form.genre_tone.trim(), false],
    [t('wizard.storyteller.title'), byId(options?.storytellers, form.storyteller || d?.storyteller), !form.storyteller],
    [t('wizard.harshness.title'), (() => { const level = form.harshness || d?.harshness; const h = options?.harshness.find((x) => x.level === level); return h ? t('wizard.harshness.level', { n: h.level, name: pick(language, h.name) }) : level ? String(level) : ''; })(), !form.harshness],
    [t('wizard.rating.title'), byId(options?.ratings, form.rating || d?.rating), !form.rating],
    [t('wizard.length.title'), byId(options?.lengths, form.length || d?.length), !form.length],
    [t('wizard.narration.pov'), form.pov ? t(`wizard.pov.${form.pov}`) : d ? t(`wizard.pov.${d.pov}`) : '', !form.pov],
    [t('wizard.narration.tense'), form.tense ? t(`wizard.tense.${form.tense}`) : d ? t(`wizard.tense.${d.tense}`) : '', !form.tense],
    [t('wizard.narration.cliff'), form.cliffhangers ? t(`wizard.cliff.${form.cliffhangers}`) : d ? t(`wizard.cliff.${d.cliffhangers}`) : '', !form.cliffhangers],
    [t('wizard.narration.ending'), form.ending ? t(`wizard.ending.${form.ending}`) : d ? t(`wizard.ending.${d.ending}`) : '', !form.ending],
    [t('wizard.scenes.must'), form.must_have_scenes.trim(), false],
    [t('wizard.scenes.taboos'), form.taboos.trim(), false],
    form.language === 'ru' ? [t('wizard.scenes.yo'), t(`wizard.yo.${form.yo_policy || 'yo'}`), !form.yo_policy] : [t('wizard.scenes.spelling'), t(`wizard.spelling.${form.spelling || 'us'}`), !form.spelling],
  ];
  return (
    <dl className="summary">
      {rows.map(([label, value, isDefault]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd className={isDefault || !value ? 'summary__default' : undefined}>{value ? (isDefault ? `${value} ${t('wizard.default')}` : value) : t('wizard.defaultPlain')}</dd>
        </div>
      ))}
    </dl>
  );
}
