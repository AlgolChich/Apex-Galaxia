/**
 * Fuzzy matching for the palette: every character of the query must appear in order in
 * the text (case-insensitive); the score rewards matches at word starts and consecutive
 * runs, and penalizes gaps. No dependency; works equally for Russian and English.
 */
export interface FuzzyMatch {
  score: number;
  /** Indexes of the matched characters in `text`, for highlighting. */
  indexes: number[];
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1]!;
  return /[\s\-_./:(]/.test(prev);
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { score: 0, indexes: [] };
  const t = text.toLowerCase();
  // exact substring first: the strongest signal
  const at = t.indexOf(q);
  if (at >= 0) {
    const indexes = Array.from({ length: q.length }, (_, i) => at + i);
    return { score: 100 + (isWordStart(t, at) ? 30 : 0) + Math.max(0, 20 - at) + q.length * 2, indexes };
  }
  const indexes: number[] = [];
  let score = 0;
  let last = -2;
  let ti = 0;
  for (const ch of q) {
    if (/\s/.test(ch)) continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return undefined;
    indexes.push(found);
    score += found === last + 1 ? 8 : isWordStart(t, found) ? 6 : 1;
    score -= Math.min(found - (last + 1), 10) * 0.5;
    last = found;
    ti = found + 1;
  }
  return { score, indexes };
}

/** Split `text` into plain and highlighted runs from the matched indexes. */
export function highlightRuns(text: string, indexes: number[]): Array<{ text: string; hit: boolean }> {
  if (indexes.length === 0) return [{ text, hit: false }];
  const set = new Set(indexes);
  const runs: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i]!, hit });
  }
  return runs;
}
