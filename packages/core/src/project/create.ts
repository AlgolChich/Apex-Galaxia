import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { ApexError } from '../util/errors.js';
import { exists, isoNow, writeTextAtomic } from '../util/fs.js';
import { projectLayout } from './layout.js';
import {
  ChronicleStateSchema,
  FORMAT_VERSION,
  ProjectConfigSchema,
  type Language,
  type ProjectConfig,
} from './schemas.js';
import { ProjectStore, compact } from './store.js';

/** Everything the brief template (Appendix B.12) asks for; every field has a default. */
export interface CreateProjectOptions {
  title: string;
  language: Language;
  universe?: string;
  canonPoint?: string;
  leads?: string;
  supporting?: string;
  originalCharacters?: ProjectConfig['original_characters'];
  idea?: string;
  genreTone?: string;
  narrator?: string;
  storyteller?: ProjectConfig['storyteller'];
  harshness?: number;
  rating?: ProjectConfig['rating'];
  length?: ProjectConfig['length'];
  pov?: ProjectConfig['pov'];
  tense?: ProjectConfig['tense'];
  cliffhangers?: ProjectConfig['cliffhangers'];
  mustHaveScenes?: string;
  taboos?: string;
  ending?: ProjectConfig['ending'];
  yoPolicy?: ProjectConfig['yo_policy'];
  spelling?: ProjectConfig['spelling'];
  preset?: ProjectConfig['preset'];
  /** Author's own prose sample for the voice card, optional. */
  voiceSample?: string;
}

const RU = {
  premise: `# Замысел\n\n## Premise\n\n{idea}\n\n## Synopsis\n\n_Одним абзацем: что происходит и чем всё кончается. Заполните сами или попросите Гвин._\n\n## Genre and tone\n\n{genre}\n\n## Theme\n\n_О чём это на самом деле. Герои об этом не говорят._\n`,
  style: `# Стиль проекта\n\nЭтот файл дополняет общие правила дома (style/house-rules.md). Здесь только то, что отличает этот проект: ритм, лексика, табу.\n\n- Язык повествования: русский. Политика ё: {yo}.\n- Повествование: {pov}, {tense}.\n`,
  worldRules: `# Законы мира\n\n_Каждый закон с ценой и пределом. Сюжет их не гнёт._\n\n## Laws\n\n## Costs and limits\n`,
  timeline: `# Хронология\n\n_Канон-точка: {canon}. Герои не знают ничего после неё._\n`,
  glossary: `# Глоссарий\n\n| Термин (ru) | Term (en) | Примечание |\n| --- | --- | --- |\n`,
  chronicleLog: `# Летопись\n\n_Запись после каждой главы: что изменилось, что созревает, что открыто. Только то, что уже случилось._\n`,
  hidden: `# Скрыто от читателя\n\n_Запланированные повороты и заложенные ружья. Никогда не попадает в текст для читателя._\n`,
  outline: `# План\n\n_Одна строка на главу, поворотные точки. Главный поворот здесь не пишется._\n`,
  voiceCard: `# Голосовая карточка\n\n_Извлекается из 2–10 тысяч слов прозы Автора. Правьте руками; обновляйте по новым образцам._\n\n## Sentence rhythm\n\n## Paragraph habits\n\n## Dialogue attribution\n\n## Favorite constructions\n\n## Register\n\n## Never uses\n`,
  lessons: `# Уроки\n\n_Правила из правок и заметок Автора. Ничего не попадает сюда без подтверждения._\n`,
  bannedHeader: `# Дополнительные запрещённые фразы этого проекта, одна на строку. Общий список в style/banned-phrases.ru.txt репозитория.\n`,
  whitelist: `# Фразы, которые линтер не должен подчёркивать в этом проекте, одна на строку.\n`,
};

const EN = {
  premise: `# Premise\n\n## Premise\n\n{idea}\n\n## Synopsis\n\n_One paragraph: what happens and how it ends. Fill it in yourself or ask Gwen._\n\n## Genre and tone\n\n{genre}\n\n## Theme\n\n_What this is really about. The characters never say it._\n`,
  style: `# Project style\n\nThis file adds to the global house rules (style/house-rules.md). Only what makes this project different: rhythm, vocabulary, taboos.\n\n- Story language: English ({spelling} spelling).\n- Narration: {pov}, {tense}.\n`,
  worldRules: `# World rules\n\n_Every law with its cost and its limit. The plot may not bend them._\n\n## Laws\n\n## Costs and limits\n`,
  timeline: `# Timeline\n\n_Canon point: {canon}. Characters know nothing past it._\n`,
  glossary: `# Glossary\n\n| Term (en) | Термин (ru) | Note |\n| --- | --- | --- |\n`,
  chronicleLog: `# Chronicle\n\n_One entry after each chapter: what changed, what is ripening, what is open. Only what has already happened._\n`,
  hidden: `# Hidden from the reader\n\n_Planned twists and planted guns. Never in reader output._\n`,
  outline: `# Outline\n\n_One line per chapter, turning points. The main twist is not written here._\n`,
  voiceCard: `# Voice card\n\n_Extracted from 2,000–10,000 words of the Author's own prose. Edit by hand; refresh from new samples._\n\n## Sentence rhythm\n\n## Paragraph habits\n\n## Dialogue attribution\n\n## Favorite constructions\n\n## Register\n\n## Never uses\n`,
  lessons: `# Lessons\n\n_Rules distilled from the Author's edits and notes. Nothing lands here without confirmation._\n`,
  bannedHeader: `# Extra banned phrases for this project, one per line. The shared list lives in style/banned-phrases.en.txt of the repository.\n`,
  whitelist: `# Phrases the linter must not underline in this project, one per line.\n`,
};

const STORYTELLER_RU: Record<string, string> = { cassandra: 'Кассандра', phoebe: 'Фиби', randy: 'Рэнди' };
const RATING_RU: Record<string, string> = { soft: 'мягкий', medium: 'средний', high: 'высокий', heavy: 'тяжёлый' };
const LENGTH_RU: Record<string, string> = { short: 'малая', medium: 'средняя', long: 'длинная', very_long: 'крайне длинная' };
const CLIFF_RU: Record<string, string> = { none: 'нет', chapters: 'в главах', chapters_and_finale: 'в главах и финале' };
const ENDING_RU: Record<string, string> = { happy: 'счастливая', bittersweet: 'горько-сладкая', tragic: 'трагичная', open: 'открытая', narrator: 'на усмотрение' };
const OC_RU: Record<string, string> = { no: 'нет', yes: 'да', narrator: 'на усмотрение' };

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

export function renderBrief(config: ProjectConfig, o: CreateProjectOptions): string {
  const ru = config.language === 'ru';
  const v = (en: string, ruText: string) => (ru ? ruText : en);
  const narration = `${config.pov === 'first' ? v('first person', '1-е лицо') : v('third person', '3-е лицо')}, ${
    config.tense === 'past' ? v('past tense', 'прошедшее время') : v('present tense', 'настоящее время')
  }`;
  const lines = [
    `# ${v('Brief', 'Бриф')}: ${config.title}`,
    '',
    `Вселенная / Universe: ${o.universe ?? v('original world', 'оригинальный мир')}`,
    `Канон-точка / Canon point: ${o.canonPoint ?? v('not set', 'не задана')}`,
    `Главные герои / Leads: ${o.leads ?? ''}`,
    `Второстепенные / Supporting: ${o.supporting ?? ''}`,
    `Новые персонажи (OC) / Original characters: ${ru ? OC_RU[config.original_characters] : config.original_characters}`,
    `Идея и завязка / Idea and inciting situation: ${o.idea ?? ''}`,
    `Жанр и тон / Genre and tone: ${o.genreTone ?? ''}`,
    `Рассказчик / Storyteller: ${ru ? STORYTELLER_RU[config.storyteller] : config.storyteller}`,
    `Жёсткость судьбы / Harshness: ${config.harshness}`,
    `Рейтинг / Rating: ${ru ? RATING_RU[config.rating] : config.rating}`,
    `Длина / Length: ${ru ? LENGTH_RU[config.length] : config.length.replace('_', ' ')}`,
    `Повествование / Narration: ${narration}`,
    `Клиффхэнгеры / Cliffhangers: ${ru ? CLIFF_RU[config.cliffhangers] : config.cliffhangers.replace(/_/g, ' ')}`,
    `Обязательные сцены / Must-have scenes: ${o.mustHaveScenes ?? ''}`,
    `Чего не должно быть / Taboos: ${o.taboos ?? ''}`,
    `Концовка / Ending: ${ru ? ENDING_RU[config.ending] : config.ending}`,
    `Язык / Language: ${config.language === 'ru' ? 'русский' : 'English'}`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Scaffold a complete, valid project folder. An empty brief still produces a working project:
 * every setting falls back to Gwen's defaults (Appendix B.3).
 */
export async function createProject(root: string, options: CreateProjectOptions): Promise<ProjectStore> {
  const layout = projectLayout(root);
  if (await exists(layout.projectFile)) {
    throw new ApexError('PROJECT_EXISTS', `A project already exists in ${layout.root}`, { root: layout.root });
  }

  const config = ProjectConfigSchema.parse(
    compact({
      format_version: FORMAT_VERSION,
      title: options.title,
      language: options.language,
      narrator: options.narrator,
      storyteller: options.storyteller,
      harshness: options.harshness,
      rating: options.rating,
      length: options.length,
      pov: options.pov,
      tense: options.tense,
      cliffhangers: options.cliffhangers,
      ending: options.ending,
      yo_policy: options.yoPolicy,
      spelling: options.spelling,
      original_characters: options.originalCharacters,
      preset: options.preset,
      created: isoNow(),
    }),
  );

  const t = config.language === 'ru' ? RU : EN;
  const vars = {
    idea: options.idea ?? '',
    genre: options.genreTone ?? '',
    canon: options.canonPoint ?? (config.language === 'ru' ? 'не задана' : 'not set'),
    yo: config.yo_policy === 'yo' ? 'ё везде' : 'е вместо ё',
    spelling: config.spelling.toUpperCase(),
    pov: config.pov === 'first' ? (config.language === 'ru' ? '1-е лицо' : 'first person') : config.language === 'ru' ? '3-е лицо' : 'third person',
    tense: config.tense === 'past' ? (config.language === 'ru' ? 'прошедшее время' : 'past tense') : config.language === 'ru' ? 'настоящее время' : 'present tense',
  };

  for (const dir of [
    layout.bible.characters,
    layout.bible.locations,
    layout.bible.factions,
    layout.bible.items,
    layout.bible.research,
    layout.chronicle.summaries,
    layout.chapters,
    layout.canvas.dir,
    layout.history.suggestions,
    layout.exports,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }

  await writeTextAtomic(layout.projectFile, stringifyYaml(compact(config), { lineWidth: 0 }));
  await writeTextAtomic(layout.bible.premise, fill(t.premise, vars));
  await writeTextAtomic(layout.bible.style, fill(t.style, vars));
  await writeTextAtomic(layout.bible.worldRules, t.worldRules);
  await writeTextAtomic(layout.bible.timeline, fill(t.timeline, vars));
  await writeTextAtomic(layout.bible.glossary, t.glossary);
  await writeTextAtomic(layout.bible.relationships, stringifyYaml({ pairs: [] }));
  await writeTextAtomic(layout.chronicle.state, stringifyYaml(compact(ChronicleStateSchema.parse({})), { lineWidth: 0 }));
  await writeTextAtomic(layout.chronicle.log, t.chronicleLog);
  await writeTextAtomic(layout.chronicle.hidden, t.hidden);
  await writeTextAtomic(layout.plan.brief, renderBrief(config, options));
  await writeTextAtomic(layout.plan.outline, t.outline);
  await writeTextAtomic(layout.plan.chapters, stringifyYaml({ chapters: [] }));
  await writeTextAtomic(layout.canvas.board, JSON.stringify({ format_version: FORMAT_VERSION, template: 'none', cards: [] }, null, 2) + '\n');
  await writeTextAtomic(layout.style.voiceCard, t.voiceCard);
  await writeTextAtomic(layout.style.lessons, t.lessons);
  await writeTextAtomic(config.language === 'ru' ? layout.style.bannedRu : layout.style.bannedEn, t.bannedHeader);
  await writeTextAtomic(layout.style.whitelist, t.whitelist);
  await writeTextAtomic(path.join(layout.history.dir, 'README.md'), config.language === 'ru'
    ? '# История генераций\n\nЖурнал вызовов модели (calls.jsonl) и предложения (suggestions/). Можно удалять; текст глав здесь не хранится.\n'
    : '# Generation history\n\nModel call log (calls.jsonl) and suggestions (suggestions/). Safe to delete; chapter text does not live here.\n');
  if (options.voiceSample) {
    await writeTextAtomic(path.join(layout.style.dir, 'voice-sample.md'), options.voiceSample);
  }

  return ProjectStore.attach(layout.root, config);
}
