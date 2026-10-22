import { randomInt } from 'node:crypto';
import type { Roll, RollOutcome } from '../project/schemas.js';

/** Randy's die (Appendix B.5): 1–4 luck, 5–12 lull, 13–18 trouble, 19–20 catastrophe or miracle. */
export function outcomeFor(result: number): RollOutcome {
  if (result <= 4) return 'luck';
  if (result <= 12) return 'lull';
  if (result <= 18) return 'trouble';
  return 'catastrophe';
}

export const OUTCOME_TEXT: Record<RollOutcome, { en: string; ru: string }> = {
  luck: { en: 'Unexpected luck', ru: 'Нежданная удача' },
  lull: { en: 'Lull or a minor thing', ru: 'Затишье или мелочь' },
  trouble: { en: 'Serious trouble', ru: 'Серьёзная беда' },
  catastrophe: { en: 'Catastrophe or miracle', ru: 'Катастрофа или чудо' },
};

export type Rng = () => number;

/** Roll a d20 in code. The default source is the OS CSPRNG; tests inject a deterministic rng. */
export function rollD20(chapter: number, rng?: Rng, note?: string): Roll {
  const result = rng ? Math.min(20, Math.max(1, Math.floor(rng() * 20) + 1)) : randomInt(1, 21);
  const roll: Roll = { chapter, die: 'd20', result, outcome: outcomeFor(result) };
  if (note) roll.note = note;
  return roll;
}

/** A small seeded generator for reproducible runs (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
