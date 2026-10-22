import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_RULES,
  formatLintReport,
  lintText,
  parseFrontMatter,
  parsePhraseList,
  phrasePattern,
  type Language,
} from '@apex-galaxia/core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const faultDir = path.join(repoRoot, 'evals', 'fault-set');

async function banned() {
  return {
    ru: parsePhraseList(await fs.readFile(path.join(repoRoot, 'style', 'banned-phrases.ru.txt'), 'utf8')),
    en: parsePhraseList(await fs.readFile(path.join(repoRoot, 'style', 'banned-phrases.en.txt'), 'utf8')),
  };
}

interface FaultFront {
  language: Language;
  expect?: string[];
  forbid?: string[];
  yo_policy?: 'yo' | 'ye';
  spelling?: 'us' | 'uk';
}

describe('fault set', () => {
  it('every seeded tell is caught and the clean passages stay clean', async () => {
    const files = (await fs.readdir(faultDir)).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    const lists = await banned();
    const failures: string[] = [];
    for (const file of files) {
      const doc = parseFrontMatter<FaultFront>(await fs.readFile(path.join(faultDir, file), 'utf8'), file);
      const options = {
        language: doc.data.language,
        banned: lists,
        ...(doc.data.yo_policy ? { yoPolicy: doc.data.yo_policy } : {}),
        ...(doc.data.spelling ? { spelling: doc.data.spelling } : {}),
      };
      const report = lintText(doc.body, options);
      const fired = new Set(report.hits.map((h) => h.rule));
      for (const rule of doc.data.expect ?? []) {
        if (!fired.has(rule)) failures.push(`${file}: expected ${rule} to fire`);
      }
      for (const rule of doc.data.forbid ?? []) {
        if (fired.has(rule)) {
          const hit = report.hits.find((h) => h.rule === rule)!;
          failures.push(`${file}: ${rule} must not fire («${hit.excerpt}»)`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every rule id is covered by at least one expectation', async () => {
    const files = (await fs.readdir(faultDir)).filter((f) => f.endsWith('.md'));
    const expected = new Set<string>();
    for (const file of files) {
      const doc = parseFrontMatter<FaultFront>(await fs.readFile(path.join(faultDir, file), 'utf8'), file);
      for (const r of doc.data.expect ?? []) expected.add(r);
    }
    const uncovered = ALL_RULES.map((r) => r.id).filter((id) => !expected.has(id));
    expect(uncovered).toEqual([]);
  });
});

describe('linter details', () => {
  it('tolerates Russian inflection in banned phrases and respects the whitelist', async () => {
    const lists = await banned();
    const text = 'Мурашками по коже прошёл холод. В глубине души он знал.';
    const all = lintText(text, { language: 'ru', banned: lists });
    expect(all.hits.filter((h) => h.rule === 'banned-phrase').map((h) => h.excerpt)).toEqual(['Мурашками по коже', 'В глубине души']);
    const filtered = lintText(text, { language: 'ru', banned: lists, whitelist: ['в глубине души'] });
    expect(filtered.hits.filter((h) => h.rule === 'banned-phrase')).toHaveLength(1);
    expect(phrasePattern('сердце пропустило удар', 'ru').test('Сердце пропустило удар')).toBe(true);
  });

  it('reports offsets, line and column that point at the excerpt', () => {
    const text = 'Первая строка.\n\nРубио. 36. Австралия. Дальше.';
    const report = lintText(text, { language: 'ru', rules: ['label-tag'] });
    expect(report.hits).toHaveLength(1);
    const hit = report.hits[0]!;
    expect(hit.line).toBe(3);
    expect(hit.column).toBe(1);
    expect(text.slice(hit.start, hit.end)).toBe('Рубио. 36. Австралия.');
    expect(hit.severity).toBe('error');
    expect(hit.message.ru).toContain('Ярлык');
  });

  it('only runs selected rules and counts severities', () => {
    const report = lintText('As you know, it was the worst thing he had ever seen.', { language: 'en', rules: ['as-you-know'] });
    expect(report.hits.map((h) => h.rule)).toEqual(['as-you-know']);
    expect(report.counts.error).toBe(1);
    expect(formatLintReport(report)).toContain('as-you-know');
    expect(formatLintReport({ hits: [], counts: { info: 0, warning: 0, error: 0 }, words: 0, paragraphs: 0 }, 'ru')).toContain('нет');
  });

  it('flags ё under the ye policy and skips language-specific rules elsewhere', () => {
    const ye = lintText('Ещё раз.', { language: 'ru', yoPolicy: 'ye', rules: ['yo-policy'] });
    expect(ye.hits).toHaveLength(1);
    const en = lintText('Ещё раз.', { language: 'en', rules: ['yo-policy', 'ru-dialogue-punctuation'] });
    expect(en.hits).toHaveLength(0);
  });
});
