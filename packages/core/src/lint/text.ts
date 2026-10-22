import type { LintContext, LintHit, LintSeverity } from './types.js';
import type { LessonCategory, Language } from '../project/schemas.js';

export function paragraphsOf(text: string): LintContext['paragraphs'] {
  const out: LintContext['paragraphs'] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out.push({ start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed });
  }
  return out;
}

/** Sentences split on . ! ? … followed by whitespace; keeps offsets. Ellipses and «…» count as ends. */
export function sentencesOf(text: string): LintContext['sentences'] {
  const out: LintContext['sentences'] = [];
  const re = /[^.!?…\n]+(?:[.!?…]+["»”')]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out.push({ start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed });
  }
  return out;
}

export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      last = i + 1;
    }
  }
  return { line, column: offset - last + 1 };
}

export function makeHit(
  ctx: LintContext,
  rule: string,
  severity: LintSeverity,
  category: LessonCategory,
  start: number,
  end: number,
  message: { en: string; ru: string },
): LintHit {
  const { line, column } = lineColumn(ctx.text, start);
  const excerpt = ctx.text.slice(start, end).replace(/\s+/g, ' ').trim();
  return { rule, severity, category, start, end, line, column, excerpt, message };
}

export function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * A banned phrase matches case-insensitively with flexible whitespace. In Russian, each word of
 * four letters or more may carry up to three extra letters so «мурашки по коже» also catches
 * «мурашками по коже»; a final vowel or soft sign is shed first.
 */
export function phrasePattern(phrase: string, language: Language): RegExp {
  const parts = phrase
    .trim()
    .split(/\s+/)
    .map((word) => {
      const letters = [...word].length;
      if (language === 'ru' && CYRILLIC.test(word) && letters >= 4) {
        const stem = /[аяоеиыуюэьй]$/i.test(word) && letters >= 5 ? word.slice(0, -1) : word;
        return `${escapeRegex(stem)}[\\u0400-\\u04FF]{0,3}`;
      }
      if (language === 'en' && letters >= 4) {
        return `${escapeRegex(word)}(?:s|es|ed|ing)?`;
      }
      return escapeRegex(word);
    });
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s,]+')}(?![\\p{L}\\p{N}])`, 'giu');
}

export function normalizeForWhitelist(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
