import type { ReactNode } from 'react';

export function hintId(id: string): string {
  return `${id}-hint`;
}

/**
 * A labelled control with a one-line explanation under it (Section 11.3: every control of the
 * wizard explains itself). The control passes `aria-describedby={hintId(id)}`.
 */
export function Field({ id, label, hint, error, children, required }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode; required?: boolean }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? (
        <div className="field__hint" id={hintId(id)}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export interface CardOption<V extends string | number> {
  value: V;
  name: string;
  /** Short lines under the name: rhythm, what to expect, what is allowed… */
  lines: string[];
  isDefault?: boolean;
}

/**
 * A radio group rendered as cards: name, explanation lines, the narrator's default marked.
 * Native radios keep it keyboard-friendly (arrows move, Space selects) and screen-reader
 * labelled through the fieldset legend.
 */
export function RadioCards<V extends string | number>({ name, legend, hint, options, value, onChange, defaultLabel, columns }: { name: string; legend: string; hint?: string | undefined; options: Array<CardOption<V>>; value: V | '' | 0; onChange: (value: V) => void; defaultLabel: string; columns?: number }) {
  return (
    <fieldset className="choice" aria-describedby={hint ? hintId(name) : undefined}>
      <legend className="field__label">{legend}</legend>
      {hint ? (
        <div className="field__hint" id={hintId(name)}>
          {hint}
        </div>
      ) : null}
      <div className="choice__grid" style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
        {options.map((option) => {
          const id = `${name}-${String(option.value)}`;
          const checked = option.value === value;
          return (
            <label key={String(option.value)} className={`choice__card${checked ? ' choice__card--on' : ''}`} htmlFor={id}>
              <input id={id} className="choice__input" type="radio" name={name} value={String(option.value)} checked={checked} onChange={() => onChange(option.value)} />
              <span className="choice__name">
                {option.name}
                {option.isDefault ? <span className="choice__default"> {defaultLabel}</span> : null}
              </span>
              {option.lines.map((line, i) => (
                <span key={i} className="choice__line">
                  {line}
                </span>
              ))}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A `<select>` with an explanation; `empty` adds a first option that means «the default». */
export function SelectField<V extends string>({ id, label, hint, value, onChange, options, empty }: { id: string; label: string; hint?: string | undefined; value: V | ''; onChange: (value: V | '') => void; options: Array<{ value: V; label: string }>; empty?: string | undefined }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as V | '')} aria-describedby={hint ? hintId(id) : undefined}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
