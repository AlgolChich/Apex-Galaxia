import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ApexError } from '../util/errors.js';
import { readDataFile, resolveDataFile, type Resources } from '../resources.js';
import type { Language, ProjectConfig, Roll } from '../project/schemas.js';
import { OUTCOME_TEXT } from './dice.js';

const Bilingual = z.object({ en: z.string(), ru: z.string() });

const ProfileFileSchema = z.object({
  name: z.string(),
  display_name: Bilingual,
  address: Bilingual,
  author: z.string().optional(),
  system_file: z.string().default('system.md'),
  persona_file: z.string().default('persona.md'),
  hard_limits_file: z.string().default('hard-limits.md'),
  self_check_file: z.string().default('self-check.md'),
  response_format_file: z.string().default('response-format.md'),
  brief_file: z.string().default('brief.md'),
  defaults: z.object({
    storyteller: z.enum(['cassandra', 'phoebe', 'randy']).default('cassandra'),
    harshness: z.number().int().min(1).max(6).default(3),
    rating: z.enum(['soft', 'medium', 'high', 'heavy']).default('medium'),
    length: z.enum(['short', 'medium', 'long', 'very_long']).default('medium'),
    pov: z.enum(['first', 'third']).default('third'),
    tense: z.enum(['past', 'present']).default('past'),
    cliffhangers: z.enum(['none', 'chapters', 'chapters_and_finale']).default('chapters'),
    original_characters: z.enum(['no', 'yes', 'narrator']).default('no'),
    ending: z.enum(['happy', 'bittersweet', 'tragic', 'open', 'narrator']).default('narrator'),
  }),
});

const StorytellersSchema = z.object({
  storytellers: z.array(
    z.object({
      id: z.enum(['cassandra', 'phoebe', 'randy']),
      default: z.boolean().optional(),
      name: Bilingual,
      rhythm: Bilingual,
      expect: Bilingual,
      planner_rules: z.string(),
    }),
  ),
});

const HarshnessFileSchema = z.object({
  levels: z.array(
    z.object({
      level: z.number().int().min(1).max(6),
      name: Bilingual,
      default: z.boolean().optional(),
      allowed: Bilingual,
      planner_rules: z.string(),
    }),
  ),
});

const RatingsFileSchema = z.object({
  ratings: z.array(
    z.object({
      id: z.enum(['soft', 'medium', 'high', 'heavy']),
      default: z.boolean().optional(),
      name: Bilingual,
      allowed: Bilingual,
      prompt_rules: z.string(),
    }),
  ),
});

const LengthsFileSchema = z.object({
  chapter_words: z.object({ min: z.number().int(), max: z.number().int() }),
  lengths: z.array(
    z.object({
      id: z.enum(['short', 'medium', 'long', 'very_long']),
      default: z.boolean().optional(),
      name: Bilingual,
      pages: z.tuple([z.number(), z.number()]),
      words: z.tuple([z.number(), z.number()]),
      chapters: z.tuple([z.number(), z.number()]),
      plan_approval: z.boolean().default(false),
    }),
  ),
});

const CommandsFileSchema = z.object({
  commands: z.array(z.object({ ru: z.string(), en: z.string(), meaning: Bilingual })),
});

const DiceFileSchema = z.object({
  die: z.string(),
  outcomes: z.array(z.object({ range: z.tuple([z.number(), z.number()]), id: z.string(), en: z.string(), ru: z.string() })),
});

export type StorytellerDef = z.infer<typeof StorytellersSchema>['storytellers'][number];
export type HarshnessDef = z.infer<typeof HarshnessFileSchema>['levels'][number];
export type RatingDef = z.infer<typeof RatingsFileSchema>['ratings'][number];
export type LengthDef = z.infer<typeof LengthsFileSchema>['lengths'][number];

export interface NarratorProfile {
  name: string;
  displayName: { en: string; ru: string };
  address: { en: string; ru: string };
  defaults: z.infer<typeof ProfileFileSchema>['defaults'];
  system: string;
  persona: string;
  hardLimits: string;
  selfCheck: string;
  responseFormat: string;
  briefTemplate: string;
  storytellers: StorytellerDef[];
  harshness: HarshnessDef[];
  ratings: RatingDef[];
  lengths: LengthDef[];
  chapterWords: { min: number; max: number };
  commands: z.infer<typeof CommandsFileSchema>['commands'];
  dice: z.infer<typeof DiceFileSchema>;
}

async function readYamlData<S extends z.ZodType>(resources: Resources, rel: string, schema: S): Promise<z.infer<S>> {
  const text = await readDataFile(resources, rel);
  const parsed = schema.safeParse(parseYaml(text));
  if (!parsed.success) {
    throw new ApexError('INVALID_FILE', `${rel} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

/** Load a narrator profile from narrators/<name>/ (user overrides win file by file). */
export async function loadNarrator(resources: Resources, name = 'gwen'): Promise<NarratorProfile> {
  const base = path.join('narrators', name);
  const profileFile = await resolveDataFile(resources, path.join(base, 'profile.yaml'));
  if (!profileFile) {
    throw new ApexError('NARRATOR_NOT_FOUND', `Narrator profile ${name} not found`, { name });
  }
  const profile = await readYamlData(resources, path.join(base, 'profile.yaml'), ProfileFileSchema);
  const text = (file: string) => readDataFile(resources, path.join(base, file));
  const storytellers = await readYamlData(resources, path.join(base, 'storytellers.yaml'), StorytellersSchema);
  const harshness = await readYamlData(resources, path.join(base, 'harshness.yaml'), HarshnessFileSchema);
  const ratings = await readYamlData(resources, path.join(base, 'ratings.yaml'), RatingsFileSchema);
  const lengths = await readYamlData(resources, path.join(base, 'lengths.yaml'), LengthsFileSchema);
  const commands = await readYamlData(resources, path.join(base, 'commands.yaml'), CommandsFileSchema);
  const dice = await readYamlData(resources, path.join(base, 'dice.yaml'), DiceFileSchema);
  return {
    name: profile.name,
    displayName: profile.display_name,
    address: profile.address,
    defaults: profile.defaults,
    system: (await text(profile.system_file)).trim(),
    persona: (await text(profile.persona_file)).trim(),
    hardLimits: (await text(profile.hard_limits_file)).trim(),
    selfCheck: (await text(profile.self_check_file)).trim(),
    responseFormat: (await text(profile.response_format_file)).trim(),
    briefTemplate: (await text(profile.brief_file)).trim(),
    storytellers: storytellers.storytellers,
    harshness: harshness.levels,
    ratings: ratings.ratings,
    lengths: lengths.lengths,
    chapterWords: lengths.chapter_words,
    commands: commands.commands,
    dice,
  };
}

export function storytellerDef(profile: NarratorProfile, id: ProjectConfig['storyteller']): StorytellerDef {
  const def = profile.storytellers.find((s) => s.id === id);
  if (!def) throw new ApexError('INVALID_ARGUMENT', `Unknown storyteller ${id}`);
  return def;
}

export function harshnessDef(profile: NarratorProfile, level: number): HarshnessDef {
  const def = profile.harshness.find((h) => h.level === level);
  if (!def) throw new ApexError('INVALID_ARGUMENT', `Unknown harshness level ${level}`);
  return def;
}

export function ratingDef(profile: NarratorProfile, id: ProjectConfig['rating']): RatingDef {
  const def = profile.ratings.find((r) => r.id === id);
  if (!def) throw new ApexError('INVALID_ARGUMENT', `Unknown rating ${id}`);
  return def;
}

export function lengthDef(profile: NarratorProfile, id: ProjectConfig['length']): LengthDef {
  const def = profile.lengths.find((l) => l.id === id);
  if (!def) throw new ApexError('INVALID_ARGUMENT', `Unknown length ${id}`);
  return def;
}

/**
 * The planner's narrator block (Section 10.7): storyteller rhythm, harshness definition,
 * the latest d20 result for Randy, and the settings line. Prose prompts get `renderSettingsLine`.
 */
export function renderPlannerRules(profile: NarratorProfile, config: ProjectConfig, latestRoll?: Roll): string {
  const st = storytellerDef(profile, config.storyteller);
  const hs = harshnessDef(profile, config.harshness);
  const parts = [st.planner_rules.trim(), '', hs.planner_rules.trim()];
  if (config.storyteller === 'randy') {
    if (latestRoll) {
      parts.push('', `The d20 rolled ${latestRoll.result} for this chapter: ${OUTCOME_TEXT[latestRoll.outcome].en}. Plan accordingly.`);
    } else {
      parts.push('', 'No d20 result is available for this chapter; treat it as a lull.');
    }
  }
  return parts.join('\n');
}

export function renderSettingsLine(profile: NarratorProfile, config: ProjectConfig, language: Language = 'en'): string {
  const st = storytellerDef(profile, config.storyteller);
  const hs = harshnessDef(profile, config.harshness);
  const rt = ratingDef(profile, config.rating);
  const ln = lengthDef(profile, config.length);
  const l = language;
  return [
    `Storyteller: ${st.name[l]}`,
    `Harshness: ${config.harshness} (${hs.name[l]})`,
    `Rating: ${rt.name[l]} (a ceiling)`,
    `Length class: ${ln.name[l]}`,
    `Narration: ${config.pov} person, ${config.tense} tense`,
    `Cliffhangers: ${config.cliffhangers.replace(/_/g, ' ')}`,
    `Original characters: ${config.original_characters}`,
    `Ending: ${config.ending}`,
  ].join('; ');
}
