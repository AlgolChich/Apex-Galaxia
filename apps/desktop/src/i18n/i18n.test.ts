import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog.js';
import { plural, translate } from './index.js';

describe('UI strings', () => {
  it('keeps both languages in step: every key exists in Russian and English', () => {
    const ru = Object.keys(CATALOG.ru).sort();
    const en = Object.keys(CATALOG.en).sort();
    expect(ru).toEqual(en);
    for (const key of en) {
      expect(CATALOG.en[key], `empty English string for ${key}`).toBeTruthy();
      expect(CATALOG.ru[key], `empty Russian string for ${key}`).toBeTruthy();
    }
  });

  it('fills placeholders and shows a missing key instead of a blank', () => {
    expect(translate('en', 'common.words')).toBe('words');
    expect(translate('ru', 'app.name')).toBe('Apex Galaxia');
    expect(translate('ru', 'nope.missing')).toBe('nope.missing');
    expect(translate('en', 'x {n} y', { n: 3 })).toBe('x 3 y');
  });

  it('declines Russian plurals', () => {
    const forms: [string, string, string] = ['слово', 'слова', 'слов'];
    expect([1, 2, 5, 11, 21, 22, 25, 101].map((n) => plural('ru', n, forms))).toEqual(['слово', 'слова', 'слов', 'слов', 'слово', 'слова', 'слов', 'слово']);
    expect(plural('en', 1, ['word', 'words'])).toBe('word');
    expect(plural('en', 2, ['word', 'words'])).toBe('words');
  });
});
