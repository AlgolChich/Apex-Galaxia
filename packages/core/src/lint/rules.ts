import { makeHit, phrasePattern, words } from './text.js';
import type { LintContext, LintHit, LintRule } from './types.js';

type Msg = { en: string; ru: string };

function scan(ctx: LintContext, re: RegExp, rule: LintRule, message: (m: RegExpExecArray) => Msg, text = ctx.text, offset = 0): LintHit[] {
  const hits: LintHit[] = [];
  const pattern = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    hits.push(makeHit(ctx, rule.id, rule.severity, rule.category, offset + m.index, offset + m.index + m[0].length, message(m)));
  }
  return hits;
}

// ---------------------------------------------------------------------------

export const bannedPhrase: LintRule = {
  id: 'banned-phrase',
  severity: 'warning',
  category: 'cliche',
  languages: 'all',
  run(ctx) {
    const list = ctx.options.banned?.[ctx.language] ?? [];
    const hits: LintHit[] = [];
    for (const entry of list) {
      const re = phrasePattern(entry.phrase, ctx.language);
      hits.push(
        ...scan(ctx, re, bannedPhrase, () => ({
          en: entry.note ? `Banned phrase (${entry.note}): «${entry.phrase}»` : `Banned phrase: «${entry.phrase}»`,
          ru: entry.note ? `Запрещённая фраза (${entry.note}): «${entry.phrase}»` : `Запрещённая фраза: «${entry.phrase}»`,
        })),
      );
    }
    return hits;
  },
};

export const negativeParallelism: LintRule = {
  id: 'negative-parallelism',
  severity: 'warning',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const msg: Msg = {
      en: 'Negative parallelism («not X but Y»): say what it is, not what it is not.',
      ru: 'Отрицательный параллелизм («не X, а Y»): скажи, что это, а не чего это не.',
    };
    if (ctx.language === 'ru') {
      return [
        ...scan(ctx, /(?<![\p{L}])не\s+(?!только(?![\p{L}]))[^.!?,;\n]{1,40},\s+а\s+(?!не(?![\p{L}]))[^.!?\n]{1,40}/giu, negativeParallelism, () => msg),
        ...scan(ctx, /(?<![\p{L}])не\s+потому,?\s+что(?![\p{L}])[^.!?\n]{0,80}(?<![\p{L}])а\s+потому,?\s+что(?![\p{L}])/giu, negativeParallelism, () => msg),
        ...scan(ctx, /(?<![\p{L}])не\s+только(?![\p{L}])[^.!?\n]{1,60}(?<![\p{L}])(?:но и|а и)(?![\p{L}])/giu, negativeParallelism, () => msg),
        ...scan(ctx, /(?:^|[.!?…]\s+)Не\s+\p{L}+\.\s+\p{L}+(?:\s+\p{L}+)?\./gu, negativeParallelism, () => ({
          en: 'Chopped negative fragment («Не нож. Ожидание.»): an aphorism instead of action.',
          ru: 'Рубленый фрагмент с отрицанием («Не нож. Ожидание.»): афоризм вместо действия.',
        })),
      ];
    }
    return [
      ...scan(ctx, /\bnot\s+(?:just|only|merely|simply)\s+[^.,;\n]{1,60},?\s+but\s+(?:also\s+)?/giu, negativeParallelism, () => msg),
      ...scan(ctx, /\bit(?:'s| is| was|’s)\s+not\s+(?:just\s+|only\s+)?[^.,;\n]{1,50}[,;]\s*(?:it(?:'s| is| was|’s)\s+)?/giu, negativeParallelism, () => msg),
      ...scan(ctx, /\bnot\s+because\b[^.!?\n]{0,80}\bbut\s+because\b/giu, negativeParallelism, () => msg),
      ...scan(ctx, /\bnot\s+(?:a|an|the)\s+\w+[,.]\s+(?:but\s+)?(?:a|an|the)\s+\w+/giu, negativeParallelism, () => msg),
    ];
  },
};

const RU_ADJ_ENDINGS = ['ый', 'ий', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ым', 'им', 'ую', 'юю', 'ого', 'его', 'ому', 'ему'];
const EN_ADJ = /(?:ing|ed|ous|ful|less|ive|able|ible|al|ent|ant|ic|y)$/i;

export const triad: LintRule = {
  id: 'triad',
  severity: 'warning',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const conj = ctx.language === 'ru' ? 'и' : 'and';
    const re = new RegExp(`(?<![\\p{L}])(\\p{L}+),\\s+(\\p{L}+),?\\s+${conj}\\s+(\\p{L}+)(?![\\p{L}])`, 'giu');
    const hits = scan(ctx, re, triad, () => ({
      en: 'Triad: three matching adjectives in a row read as a template. Keep one, or two with contrast.',
      ru: 'Триада: три однородных прилагательных подряд читаются как шаблон. Оставь одно или два с контрастом.',
    })).filter((h) => {
      const m = /(\p{L}+),\s+(\p{L}+),?\s+(?:и|and)\s+(\p{L}+)/iu.exec(h.excerpt);
      if (!m) return false;
      const three = [m[1]!, m[2]!, m[3]!];
      if (ctx.language === 'ru') {
        const endings = three.map((w) => RU_ADJ_ENDINGS.find((e) => w.toLowerCase().endsWith(e)));
        return endings.every((e) => e !== undefined) && new Set(endings).size === 1 && three.every((w) => w.length >= 5);
      }
      return three.every((w) => EN_ADJ.test(w) && w.length >= 4);
    });
    const enumRe =
      ctx.language === 'ru'
        ? /во-первых[\s\S]{1,300}?во-вторых[\s\S]{1,300}?в-третьих/giu
        : /\bfirst(?:ly)?\b[\s\S]{1,300}?\bsecond(?:ly)?\b[\s\S]{1,300}?\bthird(?:ly)?\b/giu;
    hits.push(
      ...scan(ctx, enumRe, triad, () => ({
        en: 'Enumerated triad (first… second… third) inside prose: a list, not a scene.',
        ru: 'Перечисление «во-первых… во-вторых… в-третьих» внутри прозы: список вместо сцены.',
      })),
    );
    return hits;
  },
};

export const summarizingSentence: LintRule = {
  id: 'summarizing-sentence',
  severity: 'warning',
  category: 'exposition',
  languages: 'all',
  run(ctx) {
    const msg: Msg = {
      en: 'Summarizing sentence after the scene: the scene already showed it. Cut.',
      ru: 'Итоговая фраза после сцены: сцена это уже показала. Вырезать.',
    };
    if (ctx.language === 'ru') {
      return [
        ...scan(ctx, /(?<![\p{L}])это\s+был[аои]?\s+(?:сам(?:ое|ый|ая|ые)|самым|самой)\s+\p{L}+/giu, summarizingSentence, () => msg),
        ...scan(ctx, /(?<![\p{L}])(?:и\s+)?(?:тогда|в\s+э(?:тот|ту)\s+(?:момент|секунду|минуту))\s+(?:он|она|они)\s+понял[аи]?,?\s+что/giu, summarizingSentence, () => msg),
        ...scan(ctx, /(?<![\p{L}])это\s+было\s+(?:только\s+)?(?:началом|начало)(?![\p{L}])/giu, summarizingSentence, () => msg),
      ];
    }
    return [
      ...scan(ctx, /\bit\s+was\s+the\s+(?:most\s+\w+|worst|best|strangest|last)\s+(?:thing|moment|sound|sight)?\s*(?:he|she|they)\s+(?:had|would)\s+(?:ever\s+)?\w+/giu, summarizingSentence, () => msg),
      ...scan(ctx, /\b(?:and\s+)?(?:that|this)\s+was\s+(?:the\s+moment\s+|when\s+)(?:he|she|they)\s+(?:knew|realized|realised|understood)/giu, summarizingSentence, () => msg),
      ...scan(ctx, /\bin\s+that\s+moment,?\s+(?:he|she|they)\s+(?:knew|realized|realised|understood)/giu, summarizingSentence, () => msg),
      ...scan(ctx, /\bit\s+was\s+only\s+the\s+beginning\b/giu, summarizingSentence, () => msg),
    ];
  },
};

export const comparativeWrapup: LintRule = {
  id: 'comparative-wrapup',
  severity: 'warning',
  category: 'exposition',
  languages: 'all',
  run(ctx) {
    const msg: Msg = {
      en: 'Comparative wrap-up («and that was worse than…»): the reader should weigh it, not be told.',
      ru: 'Сравнительная концовка («и это было хуже, чем…»): читатель взвесит сам.',
    };
    const re =
      ctx.language === 'ru'
        ? /(?<![\p{L}])(?:и|а|но)\s+это\s+было\s+(?:хуже|страшнее|больнее|лучше|сильнее|тяжелее|важнее),?\s+чем/giu
        : /\b(?:and|but)\s+(?:that|this|it)\s+was\s+(?:worse|better|scarier|harder|heavier|more\s+\w+)\s+than\b/giu;
    return scan(ctx, re, comparativeWrapup, () => msg);
  },
};

function firstWord(paragraph: string): string | undefined {
  const cleaned = paragraph.replace(/^[\s—–\-«"“'(]+/u, '');
  const w = words(cleaned)[0];
  return w ? w.toLowerCase() : undefined;
}

export const paragraphOpenerRepeat: LintRule = {
  id: 'paragraph-opener-repeat',
  severity: 'warning',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const hits: LintHit[] = [];
    for (let i = 1; i < ctx.paragraphs.length; i += 1) {
      const prev = ctx.paragraphs[i - 1]!;
      const cur = ctx.paragraphs[i]!;
      const a = firstWord(prev.text);
      const b = firstWord(cur.text);
      if (a && b && a === b && a.length >= 2) {
        const len = Math.min(cur.text.length, 40);
        hits.push(
          makeHit(ctx, paragraphOpenerRepeat.id, paragraphOpenerRepeat.severity, paragraphOpenerRepeat.category, cur.start, cur.start + len, {
            en: `Consecutive paragraphs open with the same word («${b}»).`,
            ru: `Соседние абзацы начинаются с одного слова («${b}»).`,
          }),
        );
      }
    }
    return hits;
  },
};

export const uniformParagraphs: LintRule = {
  id: 'uniform-paragraphs',
  severity: 'info',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const hits: LintHit[] = [];
    const counts = ctx.paragraphs.map((p) => words(p.text).length);
    let runStart = 0;
    const flush = (end: number) => {
      const len = end - runStart;
      if (len >= 5) {
        const first = ctx.paragraphs[runStart]!;
        const last = ctx.paragraphs[end - 1]!;
        hits.push(
          makeHit(ctx, uniformParagraphs.id, uniformParagraphs.severity, uniformParagraphs.category, first.start, Math.min(last.end, first.start + 60), {
            en: `${len} consecutive paragraphs of nearly equal length: vary the rhythm.`,
            ru: `${len} абзацев подряд почти одной длины: нужен разный ритм.`,
          }),
        );
      }
    };
    for (let i = 1; i <= counts.length; i += 1) {
      const window = counts.slice(runStart, i);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const within = window.every((c) => c >= 25 && Math.abs(c - mean) <= mean * 0.15);
      if (!within) {
        flush(i - 1);
        runStart = i - 1;
      }
    }
    flush(counts.length);
    return hits;
  },
};

export const labelTag: LintRule = {
  id: 'label-tag',
  severity: 'error',
  category: 'labeling',
  languages: 'all',
  run(ctx) {
    return scan(ctx, /(?<![\p{L}])\p{Lu}\p{L}+[.,]\s+\d{1,3}[.,]\s+\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?[.,]?/gu, labelTag, () => ({
      en: 'Label tag with name, age and place («Рубио. 36. Австралия») reads as machine text. Show the card once, then only as a detail.',
      ru: 'Ярлык «имя. возраст. место» читается как машинный текст. Показать карточку один раз, дальше только деталью.',
    }));
  },
};

export const mixedLanguage: LintRule = {
  id: 'mixed-language',
  severity: 'info',
  category: 'other',
  languages: 'all',
  run(ctx) {
    const re = ctx.language === 'ru' ? /(?<![\p{L}])[A-Za-z]{3,}(?![\p{L}])/gu : /(?<![\p{L}])[Ѐ-ӿ]{2,}(?![\p{L}])/gu;
    return scan(ctx, re, mixedLanguage, (m) => ({
      en: `Word in the other script: «${m[0]}». Use the glossary form or the project language.`,
      ru: `Слово на другом алфавите: «${m[0]}». Нужна форма из глоссария или язык проекта.`,
    }));
  },
};

export const ruDialoguePunctuation: LintRule = {
  id: 'ru-dialogue-punctuation',
  severity: 'warning',
  category: 'other',
  languages: ['ru'],
  run(ctx) {
    const hits: LintHit[] = [];
    for (const p of ctx.paragraphs) {
      if (/^["“”][^"“”\n]{2,}["“”]/u.test(p.text) || /^["“]/u.test(p.text)) {
        hits.push(
          makeHit(ctx, ruDialoguePunctuation.id, ruDialoguePunctuation.severity, ruDialoguePunctuation.category, p.start, p.start + Math.min(p.text.length, 40), {
            en: 'Russian dialogue is set with an em dash («— Реплика, — сказал он.»), not quotation marks.',
            ru: 'Прямая речь оформляется тире («— Реплика, — сказал он.»), а не кавычками.',
          }),
        );
      }
      if (/^[-–]\s/u.test(p.text)) {
        hits.push(
          makeHit(ctx, ruDialoguePunctuation.id, ruDialoguePunctuation.severity, ruDialoguePunctuation.category, p.start, p.start + 2, {
            en: 'Dialogue starts with a hyphen or en dash; use the em dash «—».',
            ru: 'Реплика начинается с дефиса или короткого тире; нужно длинное тире «—».',
          }),
        );
      }
      if (/^—\S/u.test(p.text)) {
        hits.push(
          makeHit(ctx, ruDialoguePunctuation.id, ruDialoguePunctuation.severity, ruDialoguePunctuation.category, p.start, p.start + 2, {
            en: 'No space after the dialogue dash.',
            ru: 'После тире в реплике нужен пробел.',
          }),
        );
      }
    }
    hits.push(
      ...scan(ctx, /\.\s—\s(?:сказал|сказала|спросил|спросила|ответил|ответила|произнёс|произнесла|прошептал|прошептала)/gu, ruDialoguePunctuation, () => ({
        en: 'A full stop before attribution: use a comma («— Реплика, — сказал он.»).',
        ru: 'Точка перед словами автора: нужна запятая («— Реплика, — сказал он.»).',
      })),
    );
    return hits;
  },
};

export const emDashChain: LintRule = {
  id: 'em-dash-chain',
  severity: 'warning',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const hits: LintHit[] = [];
    const limit = ctx.language === 'ru' ? 3 : 2;
    for (const s of ctx.sentences) {
      const inner = s.text.replace(/^—\s?/u, '');
      const dashes = (inner.match(/\s—\s|\s–\s|—/gu) ?? []).length;
      if (dashes >= limit) {
        hits.push(
          makeHit(ctx, emDashChain.id, emDashChain.severity, emDashChain.category, s.start, s.end, {
            en: `${dashes} dashes in one sentence: an em-dash chain. Break the sentence.`,
            ru: `${dashes} тире в одном предложении: цепочка тире. Разбей предложение.`,
          }),
        );
      }
    }
    return hits;
  },
};

const EN_BOOKISMS = 'hissed|exclaimed|growled|opined|chuckled|smirked|breathed|retorted|snarled|chortled|quipped|intoned|barked|purred|giggled|sneered|gasped|ejaculated|expostulated|bellowed|grinned|laughed|snapped|spat';
const RU_BOOKISMS = 'прошипел|прошипела|воскликнул|воскликнула|прорычал|прорычала|усмехнулся|усмехнулась|хмыкнул|хмыкнула|выдохнул|выдохнула|процедил|процедила|фыркнул|фыркнула|рявкнул|рявкнула|простонал|простонала|хохотнул|хохотнула|буркнул|буркнула|пролепетал|пролепетала|отчеканил|отчеканила';

export const saidBookism: LintRule = {
  id: 'said-bookism',
  severity: 'info',
  category: 'dialogue',
  languages: 'all',
  run(ctx) {
    const msg: Msg = {
      en: 'Said-bookism: attribution is «said» or nothing.',
      ru: 'Глагол-украшение в словах автора: «сказал» или ничего.',
    };
    const re =
      ctx.language === 'ru'
        ? new RegExp(`,\\s—\\s(?:${RU_BOOKISMS})(?![\\p{L}])`, 'giu')
        : new RegExp(`(?:["”]\\s*(?:he|she|they|\\p{Lu}\\p{L}+)\\s+(?:${EN_BOOKISMS})|(?:${EN_BOOKISMS})\\s+(?:he|she|they|\\p{Lu}\\p{L}+)\\s*[,.]?\\s*["“])`, 'giu');
    return scan(ctx, re, saidBookism, () => msg);
  },
};

export const asYouKnow: LintRule = {
  id: 'as-you-know',
  severity: 'error',
  category: 'exposition',
  languages: 'all',
  run(ctx) {
    const re =
      ctx.language === 'ru'
        ? /(?<![\p{L}])(?:как\s+(?:ты|вы)\s+(?:знаешь|знаете|помнишь|помните)|как\s+(?:тебе|вам)\s+известно)(?![\p{L}])/giu
        : /\bas\s+you\s+(?:know|remember|recall|are\s+aware|'re\s+aware|well\s+know)\b/giu;
    return scan(ctx, re, asYouKnow, () => ({
      en: '«As you know» exposition: facts surface in an argument, a deal or an evasion.',
      ru: 'Экспозиция «как ты знаешь»: факты всплывают в споре, сделке или увёртке.',
    }));
  },
};

export const aphoristicFragments: LintRule = {
  id: 'aphoristic-fragments',
  severity: 'warning',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const hits: LintHit[] = [];
    let run: typeof ctx.sentences = [];
    const flush = () => {
      if (run.length >= 3) {
        const first = run[0]!;
        const last = run[run.length - 1]!;
        hits.push(
          makeHit(ctx, aphoristicFragments.id, aphoristicFragments.severity, aphoristicFragments.category, first.start, last.end, {
            en: `${run.length} chopped fragments in a row: aphorism instead of action.`,
            ru: `${run.length} рубленых фрагментов подряд: афоризм вместо действия.`,
          }),
        );
      }
      run = [];
    };
    for (const s of ctx.sentences) {
      const isDialogue = /^[—«"“]/u.test(s.text);
      const count = words(s.text).length;
      if (!isDialogue && count >= 1 && count <= 3 && /[.!?…]$/u.test(s.text)) {
        run.push(s);
      } else {
        flush();
      }
    }
    flush();
    return hits;
  },
};

export const repeatedDevice: LintRule = {
  id: 'repeated-device',
  severity: 'warning',
  category: 'rhythm',
  languages: 'all',
  run(ctx) {
    const seen = new Map<string, number>();
    const hits: LintHit[] = [];
    for (const s of ctx.sentences) {
      const key = s.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (words(key).length < 5) continue;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, s.start);
      } else {
        hits.push(
          makeHit(ctx, repeatedDevice.id, repeatedDevice.severity, repeatedDevice.category, s.start, s.end, {
            en: 'The same sentence appears twice: a device repeated is a device spent. Keep one.',
            ru: 'Одно предложение повторяется дважды: приём, повторённый, уже не работает. Оставь один.',
          }),
        );
      }
    }
    return hits;
  },
};

export const selfAnalysis: LintRule = {
  id: 'self-analysis',
  severity: 'info',
  category: 'dialogue',
  languages: 'all',
  run(ctx) {
    const re =
      ctx.language === 'ru'
        ? /(?<![\p{L}])(?:часть\s+меня\s+(?:хочет|хотела|знает|знала|боится|боялась)|я\s+(?:чувствую|чувствовал|чувствовала),\s+что\s+(?:я|мне|меня)|мне\s+нужно\s+(?:было\s+)?(?:принять|осознать|понять)\s+(?:себя|это|свои))/giu
        : /\b(?:part\s+of\s+me\s+(?:wants|wanted|knows|knew|fears|feared)|i\s+(?:feel|felt)\s+like\s+i\b|i\s+(?:need|needed)\s+to\s+(?:process|accept|confront)\s+(?:my|this|what))/giu;
    return scan(ctx, re, selfAnalysis, () => ({
      en: 'A character narrating their own psychology. Show it through hands, pauses, objects.',
      ru: 'Персонаж объясняет собственную психологию. Показать через руки, паузы, предметы.',
    }));
  },
};

export const moralEnding: LintRule = {
  id: 'moral-ending',
  severity: 'info',
  category: 'exposition',
  languages: 'all',
  run(ctx) {
    const last = ctx.paragraphs[ctx.paragraphs.length - 1];
    if (!last) return [];
    const re =
      ctx.language === 'ru'
        ? /^(?:иногда|может быть|наверное|в конце концов|жизнь|так|вот так|главное|потому что|теперь он знал|теперь она знала)(?![\p{L}])/iu
        : /^(?:sometimes|maybe|perhaps|in the end|life|that's how|that was how|the lesson|now he knew|now she knew|and so)\b/iu;
    if (re.test(last.text)) {
      return [
        makeHit(ctx, moralEnding.id, moralEnding.severity, moralEnding.category, last.start, last.start + Math.min(last.text.length, 60), {
          en: 'The last paragraph opens like a moral. A chapter ends on an image, not a conclusion.',
          ru: 'Последний абзац начинается как мораль. Глава кончается образом, а не выводом.',
        }),
      ];
    }
    return [];
  },
};

const YO_WORDS = ['ещё', 'её', 'идёт', 'идём', 'идёшь', 'тёплый', 'тёплая', 'тёплое', 'чёрный', 'чёрная', 'чёрное', 'жёлтый', 'зелёный', 'зелёная', 'слёзы', 'ёлка', 'мёртвый', 'мёртвая', 'твёрдый', 'лёгкий', 'лёгкая', 'шёл', 'пришёл', 'ушёл', 'нашёл', 'вошёл', 'вышел', 'счёт', 'отчёт', 'щёлкнул', 'ёж'];

export const yoPolicy: LintRule = {
  id: 'yo-policy',
  severity: 'info',
  category: 'other',
  languages: ['ru'],
  run(ctx) {
    const policy = ctx.options.yoPolicy ?? 'yo';
    if (policy === 'ye') {
      return scan(ctx, /[\p{L}]*[ёЁ][\p{L}]*/gu, yoPolicy, (m) => ({
        en: `ё policy is «е everywhere», found «${m[0]}».`,
        ru: `Политика «е вместо ё», но встречается «${m[0]}».`,
      }));
    }
    const hits: LintHit[] = [];
    for (const word of YO_WORDS) {
      const plain = word.replace(/ё/g, 'е');
      if (plain === word) continue;
      const re = new RegExp(`(?<![\\p{L}])${plain}(?![\\p{L}])`, 'giu');
      hits.push(
        ...scan(ctx, re, yoPolicy, (m) => ({
          en: `ё policy is «ё everywhere», found «${m[0]}» (expected «${word}»).`,
          ru: `Политика «ё везде», но встречается «${m[0]}» (нужно «${word}»).`,
        })),
      );
    }
    return hits;
  },
};

const SPELLING_PAIRS: Array<[us: string, uk: string]> = [
  ['color', 'colour'],
  ['colors', 'colours'],
  ['honor', 'honour'],
  ['gray', 'grey'],
  ['center', 'centre'],
  ['theater', 'theatre'],
  ['realize', 'realise'],
  ['realized', 'realised'],
  ['apologize', 'apologise'],
  ['favorite', 'favourite'],
  ['neighbor', 'neighbour'],
  ['armor', 'armour'],
  ['traveled', 'travelled'],
  ['defense', 'defence'],
];

export const spellingMix: LintRule = {
  id: 'spelling-mix',
  severity: 'info',
  category: 'other',
  languages: ['en'],
  run(ctx) {
    const policy = ctx.options.spelling ?? 'us';
    const hits: LintHit[] = [];
    for (const [us, uk] of SPELLING_PAIRS) {
      const wrong = policy === 'us' ? uk : us;
      const right = policy === 'us' ? us : uk;
      hits.push(
        ...scan(ctx, new RegExp(`\\b${wrong}\\b`, 'giu'), spellingMix, (m) => ({
          en: `Spelling policy is ${policy.toUpperCase()}: «${m[0]}» should be «${right}».`,
          ru: `Правописание проекта ${policy.toUpperCase()}: «${m[0]}» должно быть «${right}».`,
        })),
      );
    }
    return hits;
  },
};

export const ALL_RULES: LintRule[] = [
  bannedPhrase,
  negativeParallelism,
  triad,
  summarizingSentence,
  comparativeWrapup,
  paragraphOpenerRepeat,
  uniformParagraphs,
  labelTag,
  mixedLanguage,
  ruDialoguePunctuation,
  emDashChain,
  saidBookism,
  asYouKnow,
  aphoristicFragments,
  repeatedDevice,
  selfAnalysis,
  moralEnding,
  yoPolicy,
  spellingMix,
];
