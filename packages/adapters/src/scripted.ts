import type { GenerateOptions } from '@apex-galaxia/core';
import type { Responder } from './replay.js';

/**
 * A scripted stand-in for a model: deterministic, offline, schema-valid answers for every
 * task the harness runs. It exists for the desktop dev mode, the UI smoke test and tests of
 * the pipeline, and it is only ever selected explicitly (`APEX_GALAXIA_SCRIPTED=1` or the
 * `scripted` option of createAdapter). The status tools report it as `scripted`, so the
 * Author can never mistake it for a model.
 */

type Lang = 'ru' | 'en';

function languageOf(options: GenerateOptions): Lang {
  const system = options.system.map((s) => s.text).join('\n');
  return /Language module: Russian/.test(system) ? 'ru' : 'en';
}

function user(options: GenerateOptions): string {
  return options.messages[options.messages.length - 1]?.content ?? '';
}

function headingOf(options: GenerateOptions): string | undefined {
  const m = /exactly in this form: (.+)$/m.exec(user(options));
  return m?.[1]?.trim();
}

function chapterNumberOf(options: GenerateOptions): number {
  const m = /(?:Plan chapter|Read chapter|Write chapter) (\d+)/.exec(user(options));
  return m ? Number(m[1]) : 1;
}

const PROSE: Record<Lang, string[]> = {
  ru: [
    'Утром над посёлком стоял туман, и копёр торчал из него, как мачта. Ольга шла к пункту, считая шаги, потому что так короче.',
    '— Опять не спала, — сказал Гриша с крыльца.\n\n— Ладно.\n\n— Чай есть.',
    'Она села на ступеньку. Снег на перилах подтаял и снова замёрз, и под пальцами он был как стекло. Где-то за домами завёлся мотор и заглох.',
    '— Они ещё здесь, — сказала она.\n\n— Здесь.\n\n— Ты решил?\n\nОн не ответил и пошёл за кружками.',
    'Чай был крепкий и горький, с привкусом печного дыма. Гриша пил стоя, глядя на дорогу, по которой вчера пришёл грузовик.',
    'Над терриконом поднимался пар, тонкий и ровный, как нитка.',
  ],
  en: [
    'By morning the fog had come up the inlet and swallowed the ferry slip. June walked the length of the pier counting the bollards, because counting was shorter than thinking.',
    '"You slept?" the deckhand said from the wheelhouse door.\n\n"Some."\n\n"There\'s coffee."',
    'She took the cup and held it with both hands. The rail under her elbow was wet and cold, and somewhere out past the markers an engine turned over twice and died.',
    '"They came back," she said.\n\n"They did."\n\n"You decided?"\n\nHe did not answer. He went in for the log.',
    'The coffee tasted of the pot and of diesel. He drank it standing, looking down the channel where the launch had gone the night before.',
    'Out over the flats a heron lifted, slow, and did not come down.',
  ],
};

function prose(lang: Lang, count: number, offset = 0): string {
  const pool = PROSE[lang];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(pool[(i + offset) % pool.length]!);
  return out.join('\n\n');
}

const BEATS: Record<Lang, (n: number) => Record<string, unknown>> = {
  ru: (n) => ({
    chapter: n,
    title: n === 1 ? 'Фары' : `Глава ${n}`,
    goal: 'Привести чужих к порогу и заставить героя выбирать между долгом и страхом.',
    beats: [
      'Ольга хочет закрыть пункт и уйти, но пациентка не уходит, а с дороги идёт звук мотора.',
      'Гриша чинит печь и слышит мотор раньше, чем видит свет; выходит на крыльцо и считает фары.',
      'Трое чужих спрашивают у Ольги дорогу; ей нужно понять, кто они, им нужен только адрес.',
      'Старший просит Гришу показать штрек; Гриша спрашивает про погоду и про то, кто дал его фамилию.',
      'Ночью Гриша достаёт из-под половицы схему и находит на ней дату своей последней смены.',
    ],
    breather_scene: 'Ольга меряет Грише давление при чужих; говорят о козе и о манжете, которая свистит.',
    ending_image: 'Срезанная петля замка блестит в свете фонаря, а из штрека тянет тёплым воздухом.',
    world_tick: ['Дорогу до посёлка не чистили: дорожникам третью неделю не платят.'],
    guns: ['planted: самоспасатель на гвозде в сенях', 'planted: схема штрека под половицей'],
    cliffhanger: 'Ворота штрека вскрыты до приезда гостей.',
  }),
  en: (n) => ({
    chapter: n,
    title: n === 1 ? 'Eleven' : `Chapter ${n}`,
    goal: 'Bring the strangers to the door and make the lead choose between duty and fear.',
    beats: [
      'June wants to close the slip and go home, but the last passenger will not leave and an engine sounds out on the water.',
      'The deckhand mends the pump and hears the engine before he sees the light; he counts the lamps.',
      'Three strangers ask June the way; she wants to know who they are, they want only the address.',
      'The eldest asks the deckhand to take them up the old channel; he asks about the weather and who gave them his name.',
      'At night he takes the chart from under the floorboard and finds the date of his last crossing.',
    ],
    breather_scene: 'June takes his blood pressure with the strangers watching; they talk about the goat and the cuff that whistles.',
    ending_image: 'The cut hasp shines in the torchlight, and warm air comes up from the dark.',
    world_tick: ['The road to the village has not been cleared: the crews have not been paid in three weeks.'],
    guns: ['planted: the rescue set on the nail in the porch', 'planted: the chart under the floorboard'],
    cliffhanger: 'The gate was opened before the visitors arrived.',
  }),
};

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Build the responder for a language that is detected per call from the system prompt. */
export function scriptedResponder(): Responder {
  return (options: GenerateOptions): string => {
    const lang = languageOf(options);
    const task = options.task;
    const schema = options.jsonSchemaName;
    const chapter = chapterNumberOf(options);

    if (task === 'write.chapter') {
      const heading = headingOf(options) ?? (lang === 'ru' ? `Глава ${chapter}. Фары` : `Chapter ${chapter}. Eleven`);
      return `${heading}\n\n${prose(lang, 6)}\n[[END]]`;
    }
    if (task === 'write.continue' || task === 'write.guided' || task === 'write.scene') {
      return `${prose(lang, 3, task === 'write.guided' ? 1 : task === 'write.scene' ? 2 : 0)}\n[[END]]`;
    }
    if (task === 'revise' || task.startsWith('rewrite.') || task === 'weave') {
      const passage = /<passage[^>]*>\n?([\s\S]*?)\n?<\/passage>/.exec(user(options))?.[1] ?? /<paragraph[^>]*>\n?([\s\S]*?)\n?<\/paragraph>/.exec(user(options))?.[1];
      const base = passage?.trim() || prose(lang, 2);
      const touched = base
        .split(/\n\s*\n/)
        .map((p, i) => (i === 0 ? `${p} ${lang === 'ru' ? 'Пахло снегом.' : 'It smelled of snow.'}` : p))
        .join('\n\n');
      return `${touched}\n[[END]]`;
    }
    if (task === 'summary.chapter') {
      return lang === 'ru'
        ? 'Ночью в посёлок пришёл грузовик с тремя чужими. Старший попросил Гришу показать старый штрек; Гриша не ответил. Ольга измерила ему давление при чужих и обещала зайти утром. Ночью Гриша достал схему штрека, а перед рассветом нашёл ворота вскрытыми. К концу главы Гриша стоит у ворот, Ольга не спит, чужие спят в грузовике. Открыто: поведёт ли он их в штрек и кто вскрыл ворота.\n[[END]]'
        : 'A launch with three strangers came in during the night. The eldest asked the deckhand to take them up the old channel; he gave no answer. June took his blood pressure with the strangers watching and promised to come by in the morning. At night he took out the chart and before dawn found the gate open. At the end of the chapter he stands at the gate, June is awake, the strangers sleep in the launch. Open: whether he takes them up, and who opened the gate.\n[[END]]';
    }
    if (schema === 'beat-sheet') return json(BEATS[lang](chapter));
    if (schema === 'outline') {
      const count = Number(/(\d+) chapters?/.exec(user(options))?.[1] ?? 3);
      return json({ chapters: Array.from({ length: Math.max(1, Math.min(count, 40)) }, (_, i) => ({ number: i + 1, title: lang === 'ru' ? `Глава ${i + 1}` : `Chapter ${i + 1}`, line: lang === 'ru' ? `Поворот главы ${i + 1}.` : `The turn of chapter ${i + 1}.` })) });
    }
    if (schema === 'chronicle-proposal') {
      return json({
        chapter,
        summary: lang === 'ru' ? 'Чужие приехали ночью и попросили показать штрек; Гриша не ответил и нашёл ворота вскрытыми.' : 'The strangers came at night and asked for the channel; the deckhand gave no answer and found the gate open.',
        hidden: lang === 'ru' ? 'Схема под половицей выстрелит, когда спустятся.' : 'The chart under the floorboard pays off underground.',
        in_story_time: lang === 'ru' ? 'четверг, перед рассветом' : 'Thursday, before dawn',
        ops: [
          { op: 'set', path: 'locations.lead', value: lang === 'ru' ? 'у ворот штрека' : 'at the gate' },
          { op: 'append', path: 'open_threads', value: { id: `gate-${chapter}`, text: lang === 'ru' ? 'Кто вскрыл ворота?' : 'Who opened the gate?', since_chapter: chapter } },
        ],
      });
    }
    if (schema === 'critic-result') {
      return json({
        scores: { voice: 4, subtext: 4, rhythm: 4, cliche: 5, ai_tell: 5, continuity: 4, language: 4 },
        quotes: [{ quote: lang === 'ru' ? 'Она села на ступеньку.' : 'She took the cup', issue: lang === 'ru' ? 'Плоский бит; покажи ожидание через предмет.' : 'Flat beat; show the wait through an object.', category: 'rhythm', severity: 'low' }],
        verdict: 'pass',
      });
    }
    if (schema === 'describe-options') {
      return json({
        options: lang === 'ru'
          ? [{ sense: 'smell', text: 'Пахло печным дымом и мокрой шерстью.' }, { sense: 'sound', text: 'Тросы на копре гудели на одной ноте.' }, { sense: 'temperature', text: 'Мороз брал за лицо, как ладонью.' }]
          : [{ sense: 'smell', text: 'It smelled of diesel and wet rope.' }, { sense: 'sound', text: 'The cables sang on one note.' }, { sense: 'temperature', text: 'The cold took her face like a hand.' }],
      });
    }
    if (schema === 'lesson-proposal') {
      return json({ category: 'dialogue', rule: lang === 'ru' ? 'Герой не объясняет своих мотивов вслух.' : 'A character does not explain their motives aloud.', before: 'A', after: 'B', language: lang });
    }
    if (schema === 'directions') {
      return json({
        options: [
          { title: lang === 'ru' ? 'Гриша ведёт их сам' : 'He takes them himself', text: lang === 'ru' ? 'Он соглашается, чтобы видеть их руки.' : 'He agrees so he can watch their hands.', obvious: true, recommended: false },
          { title: lang === 'ru' ? 'Ольга идёт первой' : 'June goes first', text: lang === 'ru' ? 'Она спускается до них, с фонариком и ящиком.' : 'She goes down before them, with the torch and the kit.', obvious: false, recommended: true },
        ],
      });
    }
    if (schema === 'bible-proposals') {
      return json({ proposals: [{ kind: 'character', slug: 'zubov', action: 'create', name: lang === 'ru' ? 'Зубов' : 'Zubov', summary: lang === 'ru' ? 'Старший из троих.' : 'The eldest of the three.', diff: lang === 'ru' ? '## Кратко\n\nСтарший из троих, с планшетом.' : '## Summary\n\nThe eldest of the three, with a tablet.', reason: lang === 'ru' ? 'Появился в главе.' : 'Appears in the chapter.' }] });
    }
    if (schema === 'canvas-cards') {
      return json({ cards: [{ kind: 'scene', title: lang === 'ru' ? 'Спуск' : 'The descent', text: lang === 'ru' ? 'Они спускаются вчетвером.' : 'The four of them go down.', links_to: [] }] });
    }
    if (schema === 'guns-found') {
      return json({ guns: [{ detail: lang === 'ru' ? 'самоспасатель на гвозде' : 'the rescue set on the nail', where: lang === 'ru' ? 'глава 1, сени' : 'chapter 1, the porch', payoff: lang === 'ru' ? 'понадобится под землёй' : 'needed underground', confidence: 'high' }] });
    }
    if (schema === 'improve-proposals') return json({ proposals: [] });
    if (task === 'voice.card') {
      return lang === 'ru' ? '# Карточка голоса\n\n- Короткие фразы, глаголы впереди.\n- Диалог без атрибуции там, где ясно, кто говорит.\n' : '# Voice card\n\n- Short sentences, verbs first.\n- Dialogue without attribution where the speaker is clear.\n';
    }
    if (task === 'report.reader') {
      return lang === 'ru' ? '# Отчёт читателя\n\nИстория держит ритм; вторая глава провисает в середине.\n' : "# Reader's report\n\nThe story keeps its rhythm; chapter two sags in the middle.\n";
    }
    if (task === 'brainstorm' || task === 'research.dossier') {
      return lang === 'ru' ? '- Идея первая.\n- Идея вторая.\n' : '- First idea.\n- Second idea.\n';
    }
    return options.jsonSchema ? '{}' : `${prose(lang, 2)}\n[[END]]`;
  };
}
