import type {
  LengthClass,
  NarratorOptions,
  ProjectConfig,
  Rating,
  Storyteller,
} from '../../api/types.js';

/**
 * The five narrator commands that change a project setting: `/рейтинг высокий`, `/harshness 5`,
 * `/рассказчик Фиби`… The argument is matched deterministically in both languages (word stems,
 * numbers, level names) so the Author's phrasing need not be exact. Nothing is applied here;
 * the panel shows the parsed value on an action card and the Author confirms.
 */
export type SettingCommand = 'rating' | 'length' | 'storyteller' | 'harshness' | 'cliff';
export type SettingKey = 'rating' | 'length' | 'storyteller' | 'harshness' | 'cliffhangers';

export interface ParsedSetting {
  key: SettingKey;
  value: Rating | LengthClass | Storyteller | number | ProjectConfig['cliffhangers'];
  /** The string key (`chat.value.*`) of the value's label, or undefined for a number. */
  labelKey: string | undefined;
}

export const SETTING_COMMANDS: readonly SettingCommand[] = [
  'rating',
  'length',
  'storyteller',
  'harshness',
  'cliff',
];

export function isSettingCommand(id: string): id is SettingCommand {
  return (SETTING_COMMANDS as readonly string[]).includes(id);
}

export function settingKey(command: SettingCommand): SettingKey {
  return command === 'cliff' ? 'cliffhangers' : command;
}

/** Values the Author may type for each command, by language, for the "which value?" line. */
export const SETTING_VALUES: Record<SettingCommand, { ru: string[]; en: string[] }> = {
  rating: {
    ru: ['мягкий', 'средний', 'высокий', 'тяжёлый'],
    en: ['soft', 'medium', 'high', 'heavy'],
  },
  length: {
    ru: ['малая', 'средняя', 'длинная', 'крайне длинная'],
    en: ['short', 'medium', 'long', 'very long'],
  },
  storyteller: { ru: ['Кассандра', 'Фиби', 'Рэнди'], en: ['Cassandra', 'Phoebe', 'Randy'] },
  harshness: { ru: ['1–6 или название уровня'], en: ['1–6 or the level name'] },
  cliff: {
    ru: ['нет', 'в главах', 'в главах и финале'],
    en: ['none', 'chapters', 'chapters and finale'],
  },
};

const HARSHNESS_STEMS: Array<[RegExp, number]> = [
  [/мирн|peace/, 1],
  [/строител|общин|community/, 2],
  [/приключ|adventure/, 3],
  [/борьб|выжив|strive|surviv/, 4],
  [/кров|blood/, 5],
  [/проигр|весел|losing|fun/, 6],
];

function norm(argument: string): string {
  return argument
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'.,!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse the argument of a setting command; undefined when it names no known value. */
export function parseSettingArgument(
  command: SettingCommand,
  argument: string,
  options?: NarratorOptions,
): ParsedSetting | undefined {
  const a = norm(argument);
  if (!a) return undefined;
  switch (command) {
    case 'rating': {
      const value: Rating | undefined = /^(мягк|soft)/.test(a)
        ? 'soft'
        : /^(средн|medium|med$)/.test(a)
          ? 'medium'
          : /^(высок|high)/.test(a)
            ? 'high'
            : /^(тяж|heavy)/.test(a)
              ? 'heavy'
              : undefined;
      return value ? { key: 'rating', value, labelKey: `chat.value.${value}` } : undefined;
    }
    case 'length': {
      let value: LengthClass | undefined;
      if (/крайне|очень|very|extra/.test(a)) value = 'very_long';
      else if (/^(мал|коротк|short)/.test(a)) value = 'short';
      else if (/^(средн|medium|med$)/.test(a)) value = 'medium';
      else if (/^(длинн|долг|long)/.test(a)) value = 'long';
      else if (a === 'very_long') value = 'very_long';
      if (!value) return undefined;
      return {
        key: 'length',
        value,
        labelKey: value === 'medium' ? 'chat.value.length.medium' : `chat.value.${value}`,
      };
    }
    case 'storyteller': {
      const value: Storyteller | undefined = /кассандр|cassandr/.test(a)
        ? 'cassandra'
        : /фиби|феб|phoebe/.test(a)
          ? 'phoebe'
          : /рэнди|ренди|randy/.test(a)
            ? 'randy'
            : undefined;
      return value ? { key: 'storyteller', value, labelKey: `chat.value.${value}` } : undefined;
    }
    case 'harshness': {
      const number = /^(\d)\b/.exec(a)?.[1];
      if (number) {
        const level = Number(number);
        return level >= 1 && level <= 6
          ? { key: 'harshness', value: level, labelKey: undefined }
          : undefined;
      }
      // The profile's level names first (they are the source of truth), then the stems.
      const named = options?.harshness.find((h) => norm(h.name.ru) === a || norm(h.name.en) === a);
      if (named) return { key: 'harshness', value: named.level, labelKey: undefined };
      const stem = HARSHNESS_STEMS.find(([re]) => re.test(a));
      return stem ? { key: 'harshness', value: stem[1], labelKey: undefined } : undefined;
    }
    case 'cliff': {
      let value: ProjectConfig['cliffhangers'] | undefined;
      if (/финал|finale|final/.test(a)) value = 'chapters_and_finale';
      else if (/глав|chapter/.test(a)) value = 'chapters';
      else if (/^(нет|без|выкл|none|no|off)$/.test(a) || /^(нет|без|none)\b/.test(a))
        value = 'none';
      return value ? { key: 'cliffhangers', value, labelKey: `chat.value.${value}` } : undefined;
    }
    default:
      return undefined;
  }
}

/** The human label of a harshness level from the profile, when loaded: «5 (Кровь и пыль)». */
export function harshnessLabel(
  level: number,
  language: 'ru' | 'en',
  options?: NarratorOptions,
): string {
  const named = options?.harshness.find((h) => h.level === level);
  return named ? `${level} (${named.name[language]})` : String(level);
}
