import { ALL_RULES } from './rules.js';
import { normalizeForWhitelist, paragraphsOf, sentencesOf, words } from './text.js';
import type { LintContext, LintHit, LintOptions, LintReport, LintRule, LintSeverity } from './types.js';

export * from './types.js';
export { ALL_RULES } from './rules.js';
export { phrasePattern, paragraphsOf, sentencesOf } from './text.js';
export * from './punctuation.js';

/**
 * Tier-one AI-tell linter: deterministic, instant, free. Hits carry offsets for underlining,
 * a severity and a one-line explanation in both languages. A project whitelist suppresses
 * phrases the Author has approved.
 */
export function lintText(text: string, options: LintOptions, rules: LintRule[] = ALL_RULES): LintReport {
  const ctx: LintContext = {
    text,
    language: options.language,
    options,
    paragraphs: paragraphsOf(text),
    sentences: sentencesOf(text),
  };
  const whitelist = new Set((options.whitelist ?? []).map(normalizeForWhitelist).filter((w) => w.length > 0));
  const selected = options.rules ? rules.filter((r) => options.rules!.includes(r.id)) : rules;
  const hits: LintHit[] = [];
  for (const rule of selected) {
    if (rule.languages !== 'all' && !rule.languages.includes(options.language)) continue;
    for (const hit of rule.run(ctx)) {
      const norm = normalizeForWhitelist(hit.excerpt);
      const whitelisted = [...whitelist].some((w) => norm === w || norm.includes(w));
      if (!whitelisted) hits.push(hit);
    }
  }
  hits.sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
  const counts: Record<LintSeverity, number> = { info: 0, warning: 0, error: 0 };
  for (const h of hits) counts[h.severity] += 1;
  return { hits, counts, words: words(text).length, paragraphs: ctx.paragraphs.length };
}

/** Compact text rendering of a report, for the CLI and for prompts (the critic sees this). */
export function formatLintReport(report: LintReport, language: 'en' | 'ru' = 'en'): string {
  if (report.hits.length === 0) {
    return language === 'ru' ? 'Линтер: замечаний нет.' : 'Lint: no hits.';
  }
  const lines = report.hits.map((h) => `${h.line}:${h.column} [${h.severity}] ${h.rule}: ${h.message[language]} — «${h.excerpt.slice(0, 80)}»`);
  return lines.join('\n');
}

export function ruleIds(): string[] {
  return ALL_RULES.map((r) => r.id);
}
