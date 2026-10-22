/**
 * Slugs name files inside a story project (characters/<slug>.md, chapters/01-<slug>.md).
 * Cyrillic is transliterated so a Russian project stays portable across file systems and
 * git on every OS; the original name lives in the front matter.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

export function transliterate(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = CYRILLIC[lower];
    out += mapped === undefined ? ch : mapped;
  }
  return out;
}

export function slugify(input: string, fallback = 'untitled'): string {
  const slug = transliterate(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : fallback;
}

/** `01-old-friends` for chapter 1 titled «Старые друзья». */
export function chapterFileStem(number: number, title: string): string {
  const padded = String(number).padStart(2, '0');
  return `${padded}-${slugify(title, 'chapter')}`;
}
