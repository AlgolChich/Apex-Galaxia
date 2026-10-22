import { useCallback } from 'react';
import { useStore } from '../state/store.js';
import { CATALOG, type StringKey } from './catalog.js';

export type UiLanguage = 'ru' | 'en';

/**
 * Interface strings live in resource files per feature (`strings.ts` next to the feature,
 * merged in `catalog.ts`). Keys are namespaced (`editor.wordCount`), values may carry
 * `{name}` placeholders. A missing key shows the key itself so it is noticed, never a blank.
 */
export function translate(language: UiLanguage, key: StringKey | string, vars?: Record<string, string | number>): string {
  const table = CATALOG[language] as Record<string, string>;
  const fallback = CATALOG.en as Record<string, string>;
  let text = table[key] ?? fallback[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** `const t = useT(); t('editor.save')` — re-renders when the UI language changes. */
export function useT(): (key: StringKey | string, vars?: Record<string, string | number>) => string {
  const language = useStore((s) => s.ui.language);
  return useCallback((key: StringKey | string, vars?: Record<string, string | number>) => translate(language, key, vars), [language]);
}

export function useLanguage(): UiLanguage {
  return useStore((s) => s.ui.language);
}

/** Plural forms: `plural(n, ['слово', 'слова', 'слов'])` for Russian, two forms for English. */
export function plural(language: UiLanguage, n: number, forms: [string, string, string] | [string, string]): string {
  if (language === 'en' || forms.length === 2) return n === 1 ? forms[0] : forms[1];
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** Pick the user-facing half of a bilingual record such as a lint message or a narrator name. */
export function pick(language: UiLanguage, value: { ru: string; en: string } | string | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : value[language];
}
