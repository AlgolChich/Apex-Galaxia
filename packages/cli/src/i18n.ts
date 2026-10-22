import type { Language } from '@apex-galaxia/core';

const STRINGS = {
  created: { en: 'Created project', ru: 'Проект создан' },
  nextSteps: { en: 'Next: add Bible entries (apex bible add), then apex write --continue', ru: 'Дальше: добавьте записи Библии (apex bible add), затем apex write --continue' },
  project: { en: 'Project', ru: 'Проект' },
  language: { en: 'Language', ru: 'Язык' },
  storyteller: { en: 'Storyteller', ru: 'Рассказчик' },
  harshness: { en: 'Harshness', ru: 'Жёсткость судьбы' },
  rating: { en: 'Rating', ru: 'Рейтинг' },
  length: { en: 'Length', ru: 'Длина' },
  chapters: { en: 'Chapters', ru: 'Главы' },
  words: { en: 'words', ru: 'слов' },
  spent: { en: 'Spent so far', ru: 'Потрачено' },
  pendingSuggestions: { en: 'Pending suggestions', ru: 'Ожидающие предложения' },
  noChapters: { en: 'No chapters yet.', ru: 'Глав пока нет.' },
  suggestion: { en: 'Suggestion', ru: 'Предложение' },
  accepted: { en: 'Accepted into', ru: 'Принято в' },
  discarded: { en: 'Discarded', ru: 'Отклонено' },
  lintHits: { en: 'Lint', ru: 'Линтер' },
  cost: { en: 'Cost', ru: 'Стоимость' },
  model: { en: 'Model', ru: 'Модель' },
  estimate: { en: 'Estimate', ru: 'Оценка' },
  acceptHint: { en: 'Accept with: apex accept', ru: 'Принять: apex accept' },
  discardHint: { en: 'Discard with: apex discard', ru: 'Отклонить: apex discard' },
  warnings: { en: 'Warnings', ru: 'Предупреждения' },
  chronicleProposal: { en: 'Proposed chronicle update', ru: 'Предлагаемое обновление летописи' },
  applied: { en: 'Applied to the chronicle', ru: 'Записано в летопись' },
  applyHint: { en: 'Apply with --apply', ru: 'Записать: добавьте --apply' },
  planned: { en: 'Planned chapter', ru: 'Запланирована глава' },
  roll: { en: 'd20 roll', ru: 'Бросок d20' },
  summaryWritten: { en: 'Summary written to', ru: 'Краткое содержание записано в' },
  exported: { en: 'Exported to', ru: 'Экспорт в' },
  entryWritten: { en: 'Entry written', ru: 'Запись сохранена' },
  noKey: { en: 'No API key found; running against a replay cassette is possible with --cassette', ru: 'Ключ API не найден; можно работать с кассетой через --cassette' },
  budgetLeft: { en: 'Budget', ru: 'Бюджет' },
  verdict: { en: 'Verdict', ru: 'Вердикт' },
  scores: { en: 'Scores', ru: 'Оценки' },
  proposals: { en: 'Proposals', ru: 'Предложения' },
  options: { en: 'Options', ru: 'Варианты' },
  recommended: { en: 'recommended', ru: 'рекомендуется' },
  obvious: { en: 'obvious', ru: 'очевидный' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function makeT(language: Language): (key: StringKey) => string {
  return (key) => STRINGS[key][language];
}
