/**
 * Word-level diff inside a changed paragraph: a longest-common-subsequence over word tokens
 * (whitespace runs compare equal to each other) rendered as segments for each side. No
 * dependency; paragraphs are small, and very long inputs fall back to one whole change.
 */
export type SegmentKind = 'same' | 'added' | 'removed';

export interface Segment {
  text: string;
  kind: SegmentKind;
}

export interface WordDiff {
  before: Segment[];
  after: Segment[];
}

const MAX_CELLS = 400_000;

export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function key(token: string): string {
  return /^\s+$/.test(token) ? ' ' : token;
}

function push(list: Segment[], text: string, kind: SegmentKind): void {
  const last = list[list.length - 1];
  if (last && last.kind === kind) last.text += text;
  else list.push({ text, kind });
}

export function wordDiff(before: string, after: string): WordDiff {
  if (before === after) return { before: [{ text: before, kind: 'same' }], after: [{ text: after, kind: 'same' }] };
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > MAX_CELLS) {
    return { before: before ? [{ text: before, kind: 'removed' }] : [], after: after ? [{ text: after, kind: 'added' }] : [] };
  }
  const ka = a.map(key);
  const kb = b.map(key);
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const width = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i * width + j] = ka[i] === kb[j] ? dp[(i + 1) * width + j + 1]! + 1 : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }
  const out: WordDiff = { before: [], after: [] };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      push(out.before, a[i]!, 'same');
      push(out.after, b[j]!, 'same');
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      push(out.before, a[i]!, 'removed');
      i += 1;
    } else {
      push(out.after, b[j]!, 'added');
      j += 1;
    }
  }
  while (i < a.length) push(out.before, a[i++]!, 'removed');
  while (j < b.length) push(out.after, b[j++]!, 'added');
  return out;
}
