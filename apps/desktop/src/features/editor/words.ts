// A word is a run of letters or digits, optionally joined by hyphens or apostrophes
// («кто-нибудь», "don't"). Dashes, quotes and punctuation on their own never count.
const WORD = /[\p{L}\p{N}]+(?:[’'‐-][\p{L}\p{N}]+)*/gu;

/** Word count of a passage, Cyrillic and Latin alike. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.match(WORD)?.length ?? 0;
}
