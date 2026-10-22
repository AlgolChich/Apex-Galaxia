import type { Language, LessonCategory } from '../project/schemas.js';
import type { BannedPhrase } from '../style/memory.js';

export type LintSeverity = 'info' | 'warning' | 'error';

export interface LintHit {
  rule: string;
  severity: LintSeverity;
  category: LessonCategory;
  /** Character offsets into the linted text. */
  start: number;
  end: number;
  line: number;
  column: number;
  excerpt: string;
  /** One-line explanation in English and Russian. */
  message: { en: string; ru: string };
}

export interface LintOptions {
  language: Language;
  banned?: { ru: BannedPhrase[]; en: BannedPhrase[] };
  whitelist?: string[];
  yoPolicy?: 'yo' | 'ye';
  spelling?: 'us' | 'uk';
  /** Run only these rule ids (default: all). */
  rules?: string[];
}

export interface LintReport {
  hits: LintHit[];
  counts: Record<LintSeverity, number>;
  words: number;
  paragraphs: number;
}

export interface LintContext {
  text: string;
  language: Language;
  options: LintOptions;
  paragraphs: Array<{ start: number; end: number; text: string }>;
  sentences: Array<{ start: number; end: number; text: string }>;
}

export interface LintRule {
  id: string;
  severity: LintSeverity;
  category: LessonCategory;
  languages: Language[] | 'all';
  run(ctx: LintContext): LintHit[];
}
