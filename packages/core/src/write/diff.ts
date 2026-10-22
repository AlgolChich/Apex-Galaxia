/**
 * Paragraph-level diff for Rewrite, Weave and de-AI: the Author accepts or rejects
 * paragraph by paragraph (Section 4.4). Alignment is a longest-common-subsequence over
 * normalized paragraphs; unmatched runs become change blocks.
 */
export type DiffBlockKind = 'same' | 'changed' | 'added' | 'removed';

export interface DiffBlock {
  kind: DiffBlockKind;
  before: string[];
  after: string[];
}

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function normalize(p: string): string {
  return p.replace(/\s+/g, ' ').trim();
}

export function diffParagraphs(before: string, after: string): DiffBlock[] {
  const a = splitParagraphs(before);
  const b = splitParagraphs(after);
  const na = a.map(normalize);
  const nb = b.map(normalize);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = na[i] === nb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const blocks: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  let pendingA: string[] = [];
  let pendingB: string[] = [];
  const flush = () => {
    if (pendingA.length === 0 && pendingB.length === 0) return;
    const kind: DiffBlockKind = pendingA.length === 0 ? 'added' : pendingB.length === 0 ? 'removed' : 'changed';
    blocks.push({ kind, before: pendingA, after: pendingB });
    pendingA = [];
    pendingB = [];
  };
  while (i < a.length && j < b.length) {
    if (na[i] === nb[j]) {
      flush();
      blocks.push({ kind: 'same', before: [a[i]!], after: [b[j]!] });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      pendingA.push(a[i]!);
      i += 1;
    } else {
      pendingB.push(b[j]!);
      j += 1;
    }
  }
  while (i < a.length) pendingA.push(a[i++]!);
  while (j < b.length) pendingB.push(b[j++]!);
  flush();
  return blocks;
}

/** Apply per-block decisions: accepted blocks take `after`, rejected ones keep `before`. */
export function applyDiff(blocks: DiffBlock[], accepted: boolean[] | 'all' | 'none'): string {
  const out: string[] = [];
  blocks.forEach((block, index) => {
    const take = accepted === 'all' ? true : accepted === 'none' ? false : (accepted[index] ?? false);
    if (block.kind === 'same') out.push(...block.after);
    else out.push(...(take ? block.after : block.before));
  });
  return out.join('\n\n') + '\n';
}

/** Unified-looking text rendering for the CLI. */
export function formatDiff(blocks: DiffBlock[]): string {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'same') {
      lines.push(`  [${index}] ${block.after[0]?.slice(0, 70)}${(block.after[0]?.length ?? 0) > 70 ? '…' : ''}`);
      return;
    }
    lines.push(`~ [${index}] ${block.kind}`);
    for (const p of block.before) lines.push(`- ${p}`);
    for (const p of block.after) lines.push(`+ ${p}`);
  });
  return lines.join('\n');
}
