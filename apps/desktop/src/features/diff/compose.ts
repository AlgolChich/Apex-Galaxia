import type { DiffBlock } from '../../api/types.js';

/** Indexes of the blocks the Author can accept or reject (everything but `same`). */
export function decidableBlocks(blocks: DiffBlock[]): number[] {
  return blocks.flatMap((block, index) => (block.kind === 'same' ? [] : [index]));
}

/** Paragraphs of the final text: accepted blocks take `after`, rejected ones keep `before`. */
export function composeParagraphs(blocks: DiffBlock[], accepted: ReadonlyArray<boolean>): string[] {
  const out: string[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'same') out.push(...block.after);
    else out.push(...((accepted[index] ?? true) ? block.after : block.before));
  });
  return out;
}

/**
 * The text that replaces the original passage: the composed paragraphs, keeping whatever
 * whitespace the passage had before its first and after its last character, so the
 * replacement sits in the chapter exactly where the selection did.
 */
export function composeReplacement(before: string, blocks: DiffBlock[], accepted: ReadonlyArray<boolean>): string {
  const leading = /^\s*/.exec(before)?.[0] ?? '';
  const trailing = /\s*$/.exec(before)?.[0] ?? '';
  const body = composeParagraphs(blocks, accepted).join('\n\n');
  if (body.length === 0) return leading.length + trailing.length >= before.length ? before : leading + trailing;
  return leading + body + trailing;
}

/** True when every decidable block is rejected: nothing would change. */
export function nothingAccepted(blocks: DiffBlock[], accepted: ReadonlyArray<boolean>): boolean {
  return decidableBlocks(blocks).every((index) => accepted[index] === false);
}
