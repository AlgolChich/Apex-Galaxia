import type { Language, LengthClass, ProjectCreateOptions, Rating, Storyteller } from '../../api/types.js';

/**
 * The story form of the wizard: one field per line of the brief template. An empty string or
 * 0 means «not chosen»: the field is left out of `project_create` and the project takes the
 * narrator's default, so an empty wizard still produces a working project.
 */
export interface StoryForm {
  title: string;
  language: Language;
  path: string;
  universe: string;
  canon_point: string;
  leads: string;
  supporting: string;
  original_characters: '' | 'no' | 'yes' | 'narrator';
  idea: string;
  genre_tone: string;
  storyteller: '' | Storyteller;
  harshness: number;
  rating: '' | Rating;
  length: '' | LengthClass;
  pov: '' | 'first' | 'third';
  tense: '' | 'past' | 'present';
  cliffhangers: '' | 'none' | 'chapters' | 'chapters_and_finale';
  ending: '' | 'happy' | 'bittersweet' | 'tragic' | 'open' | 'narrator';
  must_have_scenes: string;
  taboos: string;
  yo_policy: '' | 'yo' | 'ye';
  spelling: '' | 'us' | 'uk';
}

export function emptyStoryForm(language: Language): StoryForm {
  return {
    title: '',
    language,
    path: '',
    universe: '',
    canon_point: '',
    leads: '',
    supporting: '',
    original_characters: '',
    idea: '',
    genre_tone: '',
    storyteller: '',
    harshness: 0,
    rating: '',
    length: '',
    pov: '',
    tense: '',
    cliffhangers: '',
    ending: '',
    must_have_scenes: '',
    taboos: '',
    yo_policy: '',
    spelling: '',
  };
}

const TEXT_FIELDS = ['universe', 'canon_point', 'leads', 'supporting', 'idea', 'genre_tone', 'must_have_scenes', 'taboos'] as const;
const CHOICE_FIELDS = ['original_characters', 'storyteller', 'rating', 'length', 'pov', 'tense', 'cliffhangers', 'ending'] as const;

/** Map the form to the `project_create` payload: only what the Author filled in. */
export function buildCreateOptions(form: StoryForm): ProjectCreateOptions {
  const options: ProjectCreateOptions = { path: form.path.trim(), title: form.title.trim(), language: form.language };
  const out = options as unknown as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    const value = form[key].trim();
    if (value) out[key] = value;
  }
  for (const key of CHOICE_FIELDS) {
    const value = form[key];
    if (value) out[key] = value;
  }
  if (form.harshness >= 1 && form.harshness <= 6) out['harshness'] = form.harshness;
  if (form.language === 'ru' && form.yo_policy) out['yo_policy'] = form.yo_policy;
  if (form.language === 'en' && form.spelling) out['spelling'] = form.spelling;
  return options;
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** A folder-safe slug of the title, transliterating Cyrillic the way the core does for chapter stems. */
export function slugOfTitle(title: string, fallback = 'story'): string {
  const slug = title
    .toLowerCase()
    .split('')
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** `~/.apex-galaxia/config.yaml` → `~`: the user's home, derived from the path `user_config_get` reports. */
export function homeOfConfigFile(file: string): string | undefined {
  const normalized = file.replace(/\\/g, '/');
  const marker = normalized.lastIndexOf('/.apex-galaxia/');
  if (marker <= 0) return undefined;
  return normalized.slice(0, marker);
}

export function joinPath(home: string, ...parts: string[]): string {
  const sep = home.includes('\\') ? '\\' : '/';
  return [home.replace(/[\\/]+$/, ''), ...parts].join(sep);
}
