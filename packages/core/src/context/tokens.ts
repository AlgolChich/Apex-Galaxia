/**
 * Token counting. The context assembler needs counts for every layer; a network round-trip
 * per layer would blow the 200 ms target, so the core ships a heuristic estimator and the
 * adapter can supply an exact counter (Anthropic `countTokens`) that is cached by text hash.
 * The inspector reports which one produced the numbers.
 */
export interface TokenCounter {
  readonly exact: boolean;
  count(text: string): Promise<number>;
}

/**
 * Calibrated roughly for Claude tokenizers: English prose about 4 characters per token,
 * Russian prose about 2.2 (Cyrillic is two to three times more expensive, Section 10.3).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let latin = 0;
  let cyrillic = 0;
  let digits = 0;
  let space = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin += 1;
    else if (code >= 0x0400 && code <= 0x04ff) cyrillic += 1;
    else if (code >= 48 && code <= 57) digits += 1;
    else if (ch === ' ' || ch === '\n' || ch === '\t') space += 1;
    else other += 1;
  }
  const estimate = latin / 4.0 + cyrillic / 2.2 + digits / 2.5 + other / 1.6 + space / 6;
  return Math.max(1, Math.ceil(estimate));
}

export class HeuristicTokenCounter implements TokenCounter {
  readonly exact = false;
  async count(text: string): Promise<number> {
    return estimateTokens(text);
  }
}

/** Wrap any counter with a cache keyed by text so stable layers are counted once. */
export class CachedTokenCounter implements TokenCounter {
  private readonly cache = new Map<string, number>();
  readonly exact: boolean;

  constructor(private readonly inner: TokenCounter, private readonly maxEntries = 2000) {
    this.exact = inner.exact;
  }

  async count(text: string): Promise<number> {
    const hit = this.cache.get(text);
    if (hit !== undefined) return hit;
    const value = await this.inner.count(text);
    if (this.cache.size >= this.maxEntries) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(text, value);
    return value;
  }
}
