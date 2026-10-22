import type { Language } from '../project/schemas.js';
import type { BibleEntry } from './entries.js';

export type ActivationReason = 'always_on' | 'pinned' | 'alias';

export interface Activation {
  entry: BibleEntry;
  reason: ActivationReason;
  matchedAliases: string[];
  hits: number;
  /** Offset of the last hit in the window; closer to the end means closer to the cursor. */
  lastHitAt: number;
}

export interface ActivationOptions {
  language: Language;
  /** The text scanned for aliases, normally the current chapter window. */
  window: string;
  /** Slugs pinned for this request (in addition to `pinned: true` in front matter). */
  pins?: string[];
}

const CYRILLIC = /[Ѐ-ӿ]/;
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the regex for one alias. Russian names inflect, so a Cyrillic alias of four letters
 * or more matches as a stem with up to three trailing letters («Скаут» → «Скаутом»);
 * an alias ending in a vowel sheds it first («Гвиневра» → «Гвиневрой»). Proper names
 * (capitalized) match case-sensitively so «Маша» never fires on «машина».
 */
export function aliasPattern(alias: string): RegExp {
  const trimmed = alias.trim();
  const words = trimmed.split(/\s+/);
  const isCyrillic = CYRILLIC.test(trimmed);
  const capitalized = /^\p{Lu}/u.test(trimmed);
  const parts = words.map((word) => {
    const letters = [...word].length;
    if (isCyrillic && letters >= 4) {
      const stem = /[аяоеиыуюэьй]$/i.test(word) && letters >= 5 ? word.slice(0, -1) : word;
      return `${escapeRegex(stem)}[\\u0400-\\u04FF]{0,3}`;
    }
    if (!isCyrillic && letters >= 3) {
      return `${escapeRegex(word)}(?:'s|s|es)?`;
    }
    return escapeRegex(word);
  });
  const flags = capitalized && isCyrillic ? 'gu' : 'giu';
  return new RegExp(`${NOT_WORD_BEFORE}${parts.join('\\s+')}${NOT_WORD_AFTER}`, flags);
}

export function entryAliases(entry: BibleEntry, language: Language): string[] {
  const primary = language === 'ru' ? entry.front.aliases.ru : entry.front.aliases.en;
  const secondary = language === 'ru' ? entry.front.aliases.en : entry.front.aliases.ru;
  const all = [entry.front.name, ...primary, ...secondary].map((a) => a.trim()).filter((a) => a.length > 0);
  return all.filter((a, i) => all.indexOf(a) === i);
}

/**
 * Decide which entries enter the prompt and why. Order: always-on, pinned, then triggered
 * entries by hit count and recency. The inspector shows this list verbatim.
 */
export function activateEntries(entries: BibleEntry[], options: ActivationOptions): Activation[] {
  const pins = new Set(options.pins ?? []);
  const activations: Activation[] = [];
  for (const entry of entries) {
    const matchedAliases: string[] = [];
    let hits = 0;
    let lastHitAt = -1;
    for (const alias of entryAliases(entry, options.language)) {
      const pattern = aliasPattern(alias);
      let match: RegExpExecArray | null;
      let aliasHits = 0;
      while ((match = pattern.exec(options.window)) !== null) {
        aliasHits += 1;
        lastHitAt = Math.max(lastHitAt, match.index);
        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        }
      }
      if (aliasHits > 0) {
        matchedAliases.push(alias);
        hits += aliasHits;
      }
    }
    const pinned = entry.front.pinned || pins.has(entry.slug);
    if (entry.front.always_on) {
      activations.push({ entry, reason: 'always_on', matchedAliases, hits, lastHitAt });
    } else if (pinned) {
      activations.push({ entry, reason: 'pinned', matchedAliases, hits, lastHitAt });
    } else if (hits > 0) {
      activations.push({ entry, reason: 'alias', matchedAliases, hits, lastHitAt });
    }
  }
  const rank: Record<ActivationReason, number> = { always_on: 0, pinned: 1, alias: 2 };
  activations.sort((a, b) => {
    if (rank[a.reason] !== rank[b.reason]) return rank[a.reason] - rank[b.reason];
    if (b.hits !== a.hits) return b.hits - a.hits;
    return b.lastHitAt - a.lastHitAt;
  });
  return activations;
}
