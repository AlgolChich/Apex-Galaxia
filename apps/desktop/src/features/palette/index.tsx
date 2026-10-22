import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../../i18n/index.js';
import { useStore } from '../../state/store.js';
import { Dialog } from '../diff/dialog.js';
import { ACTIONS, findAction, rankActions, runAction, shortcutParts, unmetNeed, type FormField, type PaletteAction, type RankedAction } from './actions.js';
import { highlightRuns } from './fuzzy.js';
import { readRecent, usePaletteState } from './state.js';
import './palette.css';

export { ACTIONS, runAction, useGlobalShortcuts, formatShortcut, matchesShortcut, rankActions, unmetNeed } from './actions.js';
export type { PaletteAction, Shortcut, FormField } from './actions.js';

function defaultValues(action: PaletteAction): Record<string, string> {
  const app = useStore.getState();
  const values: Record<string, string> = {};
  for (const field of action.form ?? []) {
    const d = field.defaultValue;
    values[field.id] = typeof d === 'function' ? d(app) : (d ?? (field.kind === 'select' ? (field.options?.[0]?.value ?? '') : ''));
  }
  return values;
}

function Keys({ parts }: { parts: string[] }) {
  return (
    <span className="palette__keys" aria-hidden="true">
      {parts.map((part, index) => (
        <kbd key={index} className="kbd">
          {part}
        </kbd>
      ))}
    </span>
  );
}

/**
 * The command palette: every action, fuzzy search, keyboard navigation, recently used
 * first, inline forms for actions that need input. App renders it while `ui.paletteOpen`.
 */
export function CommandPalette() {
  const t = useT();
  const ui = useStore((s) => s.ui);
  const setPalette = useStore((s) => s.setPalette);
  const toast = useStore((s) => s.toast);
  const formAction = usePaletteState((s) => s.formAction);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [form, setForm] = useState<PaletteAction | undefined>(() => (formAction ? findAction(formAction) : undefined));
  const [values, setValues] = useState<Record<string, string>>(() => (form ? defaultValues(form) : {}));
  const [recent] = useState(readRecent);
  const listId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => usePaletteState.getState().setFormAction(undefined), []);
  useEffect(() => {
    if (form) formRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
    else inputRef.current?.focus();
  }, [form]);

  const close = () => {
    usePaletteState.getState().setFormAction(undefined);
    setPalette(false);
  };

  const label = (action: PaletteAction) => t(action.label);
  const searchText = (action: PaletteAction) => `${t(action.label)} ${action.hint ? t(action.hint) : ''} ${t(`palette.group.${action.group}`)} ${action.id}`;
  // `ui` is read so the list re-ranks when the language, the panel or the view change.
  const items = useMemo(() => rankActions(ACTIONS, query, recent, searchText), [query, recent, ui.language]); // searchText depends on t, which changes with the language

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    const el = document.getElementById(`${listId}-${active}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const choose = (item: RankedAction | undefined) => {
    if (!item) return;
    const need = unmetNeed(item.action, useStore.getState());
    if (need) {
      toast('info', t(`palette.need.${need}`));
      return;
    }
    if (item.action.form) {
      setForm(item.action);
      setValues(defaultValues(item.action));
      return;
    }
    close();
    void runAction(item.action, {});
  };

  const onListKey = (event: KeyboardEvent) => {
    const count = items.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (count) setActive((a) => (a + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) setActive((a) => (a - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, count - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[active]);
    }
  };

  const submitForm = () => {
    if (!form) return;
    for (const field of form.form ?? []) {
      if (field.required && !(values[field.id] ?? '').trim()) {
        toast('info', t('palette.required'));
        formRef.current?.querySelector<HTMLElement>(`[name="${field.id}"]`)?.focus();
        return;
      }
    }
    const action = form;
    close();
    void runAction(action, values);
  };

  const onFormKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setForm(undefined);
      return;
    }
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    const textarea = target.tagName === 'TEXTAREA';
    if (!textarea || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      submitForm();
    }
  };

  const renderField = (field: FormField) => {
    const value = values[field.id] ?? '';
    const set = (next: string) => setValues((v) => ({ ...v, [field.id]: next }));
    const id = `${listId}-f-${field.id}`;
    const placeholder = field.placeholder ? t(field.placeholder) : undefined;
    return (
      <div key={field.id} className="dlg__field">
        <label htmlFor={id}>
          {t(field.label)}
          {field.required ? ' *' : ''}
        </label>
        {field.kind === 'textarea' ? (
          <textarea id={id} name={field.id} className="textarea" value={value} onChange={(e) => set(e.target.value)} {...(placeholder ? { placeholder } : {})} required={field.required ?? false} />
        ) : field.kind === 'select' ? (
          <select id={id} name={field.id} className="select" value={value} onChange={(e) => set(e.target.value)}>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            name={field.id}
            className="input"
            type={field.kind === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => set(e.target.value)}
            {...(placeholder ? { placeholder } : {})}
            {...(field.min !== undefined ? { min: field.min } : {})}
            {...(field.max !== undefined ? { max: field.max } : {})}
            required={field.required ?? false}
          />
        )}
      </div>
    );
  };

  if (form) {
    const hasTextarea = (form.form ?? []).some((f) => f.kind === 'textarea');
    return (
      <Dialog title={t('palette.title')} onClose={close} className="palette" bare>
        <form
          ref={formRef}
          className="palette__form"
          onKeyDown={onFormKey}
          onSubmit={(e) => {
            e.preventDefault();
            submitForm();
          }}
        >
          <div className="palette__form-title">{label(form)}</div>
          {form.hint ? <div className="small muted">{t(form.hint)}</div> : null}
          {(form.form ?? []).map(renderField)}
          <div className="row">
            <button type="button" className="btn btn--ghost" onClick={() => setForm(undefined)}>
              {t('palette.back')}
            </button>
            <span className="grow" />
            <button type="submit" className="btn btn--primary">
              {t('palette.run')}
            </button>
          </div>
        </form>
        <div className="palette__foot">
          <span>{t(hasTextarea ? 'palette.foot.formTextarea' : 'palette.foot.form')}</span>
        </div>
      </Dialog>
    );
  }

  let lastGroup = '';
  const app = useStore.getState();
  return (
    <Dialog title={t('palette.title')} onClose={close} className="palette" bare>
      <div className="palette__search">
        <input
          ref={inputRef}
          className="palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
          aria-label={t('palette.title')}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onListKey}
          data-autofocus
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <ul id={listId} className="palette__list" role="listbox" aria-label={t('palette.title')}>
        {items.length === 0 ? <li className="palette__empty">{t('palette.empty')}</li> : null}
        {items.map((item, index) => {
          const group = query.trim() ? '' : item.recent ? 'recent' : item.action.group;
          const header = group && group !== lastGroup ? group : '';
          lastGroup = group || lastGroup;
          const text = label(item.action);
          const runs = highlightRuns(text, item.match.indexes.filter((i) => i < text.length));
          const need = unmetNeed(item.action, app);
          return (
            <li key={item.action.id} role="presentation">
              {header ? <div className="palette__group">{header === 'recent' ? t('palette.recent') : t(`palette.group.${header}`)}</div> : null}
              <div
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`palette__item${need ? ' palette__item--unavailable' : ''}`}
                title={need ? t(`palette.need.${need}`) : undefined}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                <span className="palette__label">
                  <span>
                    {runs.map((run, i) =>
                      run.hit ? (
                        <span key={i} className="palette__hit">
                          {run.text}
                        </span>
                      ) : (
                        <span key={i}>{run.text}</span>
                      ),
                    )}
                  </span>
                  {item.action.hint ? <span className="palette__hint">{t(item.action.hint)}</span> : null}
                </span>
                <span className="chip">{t(`palette.group.${item.action.group}`)}</span>
                {item.action.shortcut ? <Keys parts={shortcutParts(item.action.shortcut)} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="palette__foot">
        <span>{t('palette.foot.navigate')}</span>
        <span>{t('palette.foot.run')}</span>
        <span>{t('palette.foot.close')}</span>
      </div>
    </Dialog>
  );
}
