import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import {
  ALL_RULES,
  appendLesson,
  applyDiff,
  chapterHeading,
  countWords,
  createProject,
  entryTemplate,
  formatDiff,
  formatInspector,
  formatLintReport,
  lintText,
  loadBible,
  loadStyleMemory,
  nextLessonId,
  parsePhraseList,
  parseFrontMatter,
  renderBeatSheet,
  resolveResources,
  slugify,
  upsertEntry,
  ProjectStore,
  type CreateProjectOptions,
  type EntryKind,
  type Language,
  type LessonCategory,
  type WriteMode,
} from '@apex-galaxia/core';
import { cliContext, openHarness, out, printError, type GlobalOptions } from './context.js';
import { makeT } from './i18n.js';

const VERSION = '0.1.0';

function globals(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals() as GlobalOptions;
}

async function readTextArg(text: string | undefined, file: string | undefined): Promise<string> {
  if (file) return fs.readFile(path.resolve(file), 'utf8');
  if (text) return text;
  throw new Error('Pass --text "<passage>" or --file <path>');
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('apex')
    .description('Apex Galaxia: a local-first creative-writing harness for Claude')
    .version(VERSION)
    .option('-p, --project <dir>', 'story project folder (default: APEX_PROJECT or the current folder)')
    .option('--cassette <file>', 'record-and-replay cassette for offline runs (APEX_GALAXIA_CASSETTE)')
    .option('--json', 'machine-readable output')
    .option('--ui <lang>', 'interface language: en or ru');

  // ---------------------------------------------------------------------------
  program
    .command('new <dir>')
    .description('create a story project (an empty brief still produces a working project)')
    .requiredOption('--title <title>', 'story title')
    .requiredOption('--lang <lang>', 'story language: ru or en')
    .option('--universe <text>')
    .option('--canon-point <text>')
    .option('--leads <text>')
    .option('--supporting <text>')
    .option('--idea <text>')
    .option('--genre <text>')
    .option('--storyteller <id>', 'cassandra | phoebe | randy')
    .option('--harshness <n>', '1–6')
    .option('--rating <id>', 'soft | medium | high | heavy')
    .option('--length <id>', 'short | medium | long | very_long')
    .option('--pov <id>', 'first | third')
    .option('--tense <id>', 'past | present')
    .option('--cliff <id>', 'none | chapters | chapters_and_finale')
    .option('--ending <id>', 'happy | bittersweet | tragic | open | narrator')
    .option('--oc <id>', 'original characters: no | yes | narrator')
    .option('--must-have <text>')
    .option('--taboos <text>')
    .option('--yo <policy>', 'ё policy for Russian: yo | ye')
    .option('--spelling <id>', 'us | uk')
    .option('--voice-sample <file>', 'a file with the Author\'s own prose for the voice card')
    .action(async (dir: string, opts: Record<string, string | undefined>, cmd: Command) => {
      try {
        const language = opts['lang'] as Language;
        const options: CreateProjectOptions = { title: opts['title']!, language };
        const set = <K extends keyof CreateProjectOptions>(key: K, value: CreateProjectOptions[K] | undefined) => {
          if (value !== undefined) options[key] = value;
        };
        set('universe', opts['universe']);
        set('canonPoint', opts['canonPoint']);
        set('leads', opts['leads']);
        set('supporting', opts['supporting']);
        set('idea', opts['idea']);
        set('genreTone', opts['genre']);
        set('storyteller', opts['storyteller'] as CreateProjectOptions['storyteller']);
        set('harshness', opts['harshness'] ? Number(opts['harshness']) : undefined);
        set('rating', opts['rating'] as CreateProjectOptions['rating']);
        set('length', opts['length'] as CreateProjectOptions['length']);
        set('pov', opts['pov'] as CreateProjectOptions['pov']);
        set('tense', opts['tense'] as CreateProjectOptions['tense']);
        set('cliffhangers', opts['cliff'] as CreateProjectOptions['cliffhangers']);
        set('ending', opts['ending'] as CreateProjectOptions['ending']);
        set('originalCharacters', opts['oc'] as CreateProjectOptions['originalCharacters']);
        set('mustHaveScenes', opts['mustHave']);
        set('taboos', opts['taboos']);
        set('yoPolicy', opts['yo'] as CreateProjectOptions['yoPolicy']);
        set('spelling', opts['spelling'] as CreateProjectOptions['spelling']);
        if (opts['voiceSample']) set('voiceSample', await fs.readFile(path.resolve(opts['voiceSample']), 'utf8'));
        const store = await createProject(path.resolve(dir), options);
        const g = globals(cmd);
        const t = makeT(g.ui ?? language);
        out({ json: Boolean(g.json) }, { root: store.layout.root, config: store.config }, () => `${t('created')}: ${store.layout.root}\n${t('nextSteps')}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  // ---------------------------------------------------------------------------
  program
    .command('open [dir]')
    .description('show a project: settings, chapters, spend, pending suggestions')
    .action(async (dir: string | undefined, _opts: unknown, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const store = await ProjectStore.open(ctx.root);
        const chapters = await store.listChapters();
        const spent = await store.spentUsd();
        const pending = (await store.listSuggestions()).filter((s) => s.front.status === 'pending');
        const t = ctx.t;
        const c = store.config;
        out(ctx, { root: ctx.root, config: c, chapters: chapters.map((ch) => ({ number: ch.front.number, title: ch.front.title, words: ch.front.words, status: ch.front.status })), spentUsd: spent, pending: pending.map((p) => p.front) }, () =>
          [
            `${t('project')}: ${c.title} (${ctx.root})`,
            `${t('language')}: ${c.language} · ${t('storyteller')}: ${c.storyteller} · ${t('harshness')}: ${c.harshness} · ${t('rating')}: ${c.rating} · ${t('length')}: ${c.length}`,
            `${t('chapters')}: ${chapters.length === 0 ? t('noChapters') : ''}`,
            ...chapters.map((ch) => `  ${String(ch.front.number).padStart(2, '0')} ${ch.front.title} (${ch.front.words ?? countWords(ch.body)} ${t('words')}, ${ch.front.status})`),
            `${t('spent')}: $${spent.toFixed(4)}${c.budget.project_usd !== null ? ` / $${c.budget.project_usd.toFixed(2)}` : ''}`,
            pending.length > 0 ? `${t('pendingSuggestions')}: ${pending.map((p) => p.front.id).join(', ')}` : '',
          ]
            .filter((l) => l.length > 0)
            .join('\n'),
        );
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  // ---------------------------------------------------------------------------
  program
    .command('write [dir]')
    .description('generate prose as a suggestion: --continue, --guided "<beat>", --scene "<card>" or --chapter [N]')
    .option('--continue', 'continue the last chapter from its end')
    .option('--guided <instruction>', 'continue following an instruction')
    .option('--scene <card>', 'write a scene from a card or beats')
    .option('--chapter [n]', 'write a whole chapter from the plan (next chapter by default)')
    .option('--title <title>', 'chapter title (chapter mode)')
    .option('--words <n>', 'target words')
    .option('--at <chapter>', 'chapter number to continue (default: the last)')
    .option('--pin <slugs>', 'comma-separated Bible slugs to pin')
    .option('--accept', 'accept the suggestion immediately (headless use)')
    .option('--inspect', 'print the context inspector')
    .option('--quiet', 'do not stream the text')
    .action(async (dir: string | undefined, opts: Record<string, string | boolean | undefined>, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const t = ctx.t;
        let mode: WriteMode = 'continue';
        if (opts['guided']) mode = 'guided';
        else if (opts['scene']) mode = 'scene';
        else if (opts['chapter'] !== undefined) mode = 'chapter';
        const chapters = await harness.store.listChapters();
        const chapter = opts['at'] ? await harness.store.getChapter(Number(opts['at'])) : mode === 'chapter' ? undefined : chapters[chapters.length - 1];
        const stream = !opts['quiet'] && !ctx.json;
        const outcome = await harness.write(mode, {
          ...(chapter ? { chapter } : {}),
          ...(opts['words'] ? { targetWords: Number(opts['words']) } : {}),
          ...(typeof opts['guided'] === 'string' ? { instruction: opts['guided'] } : {}),
          ...(typeof opts['scene'] === 'string' ? { sceneCard: opts['scene'] } : {}),
          ...(mode === 'chapter' && typeof opts['chapter'] === 'string' ? { chapterNumber: Number(opts['chapter']) } : {}),
          ...(typeof opts['title'] === 'string' ? { title: opts['title'] } : {}),
          ...(typeof opts['pin'] === 'string' ? { pins: opts['pin'].split(',').map((s) => s.trim()) } : {}),
          ...(stream ? { onDelta: (d: string) => process.stdout.write(d) } : {}),
        });
        if (stream) process.stdout.write('\n\n');
        let acceptedInto: string | undefined;
        if (opts['accept']) {
          const ch = await harness.accept(outcome.suggestion.front.id);
          acceptedInto = ch.path;
        }
        const payload = {
          suggestion: outcome.suggestion.front,
          text: outcome.text,
          lint: outcome.lint,
          inspector: outcome.run.assembled.inspector,
          costUsd: outcome.costUsd,
          model: outcome.model,
          warnings: outcome.run.warnings,
          acceptedInto,
        };
        out(ctx, payload, () =>
          [
            ctx.json || stream ? '' : outcome.text + '\n',
            `${t('suggestion')}: ${outcome.suggestion.front.id} · ${t('model')}: ${outcome.model} · ${t('cost')}: $${outcome.costUsd.toFixed(4)}`,
            outcome.lint.hits.length > 0 ? `${t('lintHits')} (${outcome.lint.counts.error} error, ${outcome.lint.counts.warning} warning, ${outcome.lint.counts.info} info):\n${formatLintReport(outcome.lint, ctx.ui)}` : `${t('lintHits')}: 0`,
            outcome.run.warnings.length > 0 ? `${t('warnings')}: ${outcome.run.warnings.join(' | ')}` : '',
            opts['inspect'] ? formatInspector(outcome.run.assembled.inspector, ctx.ui) : '',
            acceptedInto ? `${t('accepted')} ${acceptedInto}` : `${t('acceptHint')} ${outcome.suggestion.front.id} · ${t('discardHint')} ${outcome.suggestion.front.id}`,
          ]
            .filter((l) => l.length > 0)
            .join('\n'),
        );
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('accept <id> [dir]')
    .description('accept a suggestion into its chapter; --edited <file> accepts your edited version and --lesson proposes a lesson from the diff')
    .option('--edited <file>', 'the suggestion as you edited it')
    .option('--lesson', 'propose a lesson from the difference between the suggestion and your edit (model)')
    .action(async (id: string, dir: string | undefined, opts: { edited?: string; lesson?: boolean }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const suggestion = await harness.store.readSuggestion(id);
        const edited = opts.edited ? await fs.readFile(path.resolve(opts.edited), 'utf8') : undefined;
        const chapter = await harness.accept(id, edited !== undefined ? { editedText: edited } : {});
        let lesson: unknown;
        if (opts.lesson && edited !== undefined && edited.trim() !== suggestion.body.trim()) {
          lesson = (await harness.lessonFromEdit(suggestion.body, edited, '')).proposal;
        }
        out(ctx, { chapter: chapter.front, path: chapter.path, lesson }, () => [`${ctx.t('accepted')} ${chapter.path}`, lesson ? `lesson proposal: ${JSON.stringify(lesson)}\n(add it with: apex lesson add …)` : ''].filter((l) => l.length > 0).join('\n'));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  const lesson = program.command('lesson').description('lessons from the Author\'s edits (Section 6.2)');
  lesson
    .command('propose [dir]')
    .description('turn an edit (before/after text or files) and a note into a one-line rule proposal (model)')
    .requiredOption('--before <text|file>')
    .requiredOption('--after <text|file>')
    .option('--note <text>')
    .action(async (dir: string | undefined, opts: { before: string; after: string; note?: string }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const read = async (v: string) => (await fs.stat(path.resolve(v)).then(() => true).catch(() => false)) ? fs.readFile(path.resolve(v), 'utf8') : v;
        const { proposal } = await harness.lessonFromEdit(await read(opts.before), await read(opts.after), opts.note ?? '');
        out(ctx, proposal, () => `[${proposal.category}] ${proposal.rule}${proposal.before ? `\n  before: ${proposal.before}` : ''}${proposal.after ? `\n  after: ${proposal.after}` : ''}\nadd it with: apex lesson add --category ${proposal.category} --rule "…" --provenance "…"`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });
  lesson
    .command('add [dir]')
    .description('append a confirmed lesson to the project\'s style/lessons.md')
    .requiredOption('--category <id>')
    .requiredOption('--rule <text>')
    .requiredOption('--provenance <text>')
    .option('--before <text>')
    .option('--after <text>')
    .option('--language <id>', 'ru | en | both', 'both')
    .option('--weight <n>', '1')
    .action(async (dir: string | undefined, opts: Record<string, string | undefined>, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const store = await ProjectStore.open(ctx.root);
        const style = await loadStyleMemory(store, ctx.resources);
        const entry = {
          id: nextLessonId(style.lessons),
          date: new Date().toISOString().slice(0, 10),
          category: opts['category'] as LessonCategory,
          rule: opts['rule']!,
          provenance: opts['provenance']!,
          weight: Number(opts['weight'] ?? '1'),
          language: (opts['language'] ?? 'both') as 'ru' | 'en' | 'both',
          ...(opts['before'] ? { before: opts['before'] } : {}),
          ...(opts['after'] ? { after: opts['after'] } : {}),
        };
        await appendLesson(store.layout.style.lessons, entry);
        out(ctx, entry, () => `${entry.id} → ${store.layout.style.lessons}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('run [dir]')
    .description('autonomous mode: plan and write chapter by chapter with the Muse Layer, apply the chronicle, cache summaries, export the book and a reader\'s report; resumable')
    .option('--chapters <n>', 'how many chapters to write (default: the length class)')
    .option('--resume <id>', 'resume a saved run')
    .option('--approve-outline', 'approve the outline of a long story and continue')
    .option('--no-report', 'skip the reader\'s report at the end')
    .option('--quiet', 'do not stream the text')
    .action(async (dir: string | undefined, opts: { chapters?: string; resume?: string; approveOutline?: boolean; report?: boolean; quiet?: boolean }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const stream = !opts.quiet && !ctx.json;
        const state = await harness.runBook({
          ...(opts.chapters ? { chapters: Number(opts.chapters) } : {}),
          ...(opts.resume ? { resume: opts.resume } : {}),
          ...(opts.approveOutline ? { approveOutline: true } : {}),
          readerReport: opts.report !== false,
          onProgress: (_s, message) => {
            if (!ctx.json) console.log(`\n[run] ${message}`);
          },
          ...(stream ? { onDelta: (d: string) => process.stdout.write(d) } : {}),
        });
        out(ctx, state, () => `run ${state.id}: ${state.status} · chapters ${state.completed.length}/${state.target_chapters} · $${state.cost_usd.toFixed(3)}${state.error ? `\n${state.error}` : ''}${state.status === 'awaiting_outline_approval' ? `\nReview plan/outline.md, then: apex run --resume ${state.id} --approve-outline` : ''}`);
        if (state.status === 'failed' || state.status === 'paused') process.exitCode = 1;
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('runs [dir]')
    .description('list autonomous runs and their state')
    .action(async (dir: string | undefined, _o: unknown, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const runs = await harness.listRuns();
        out(ctx, runs, () => (runs.length === 0 ? '—' : runs.map((r) => `${r.id}  ${r.status.padEnd(26)} ${r.completed.length}/${r.target_chapters}  $${r.cost_usd.toFixed(3)}  ${r.updated_at}`).join('\n')));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('discard <id> [dir]')
    .description('discard a suggestion')
    .action(async (id: string, dir: string | undefined, _o: unknown, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const store = await ProjectStore.open(ctx.root);
        await store.setSuggestionStatus(id, 'discarded');
        out(ctx, { id, status: 'discarded' }, () => `${ctx.t('discarded')}: ${id}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('suggestions [dir]')
    .description('list suggestions in history')
    .option('--all', 'include accepted and discarded')
    .action(async (dir: string | undefined, opts: { all?: boolean }, cmd: Command) => {
      try {
        const ctx = await cliContext(globals(cmd), dir);
        const store = await ProjectStore.open(ctx.root);
        const list = (await store.listSuggestions()).filter((s) => opts.all || s.front.status === 'pending');
        out(ctx, list.map((s) => ({ ...s.front, preview: s.body.slice(0, 120) })), () => (list.length === 0 ? '—' : list.map((s) => `${s.front.id}  ${s.front.status.padEnd(9)} ${s.front.task.padEnd(16)} ch ${s.front.chapter ?? '-'}  ${s.body.slice(0, 60).replace(/\s+/g, ' ')}…`).join('\n')));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  // ---------------------------------------------------------------------------
  program
    .command('lint <file>')
    .description('run the tier-one AI-tell linter on a Markdown or text file')
    .option('--lang <lang>', 'ru or en (default: the project language, else detected)')
    .option('--rules <ids>', 'comma-separated rule ids')
    .action(async (file: string, opts: { lang?: Language; rules?: string }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const text = await fs.readFile(path.resolve(file), 'utf8');
        const doc = parseFrontMatter(text, file);
        const resources = await resolveResources();
        let language: Language | undefined = opts.lang;
        let banned = {
          ru: parsePhraseList(await fs.readFile(path.join(resources.root, 'style', 'banned-phrases.ru.txt'), 'utf8')),
          en: parsePhraseList(await fs.readFile(path.join(resources.root, 'style', 'banned-phrases.en.txt'), 'utf8')),
        };
        let whitelist: string[] = [];
        let yoPolicy: 'yo' | 'ye' | undefined;
        let spelling: 'us' | 'uk' | undefined;
        const projectRoot = g.project ?? process.env['APEX_PROJECT'];
        if (projectRoot && (await ProjectStore.isProject(projectRoot))) {
          const store = await ProjectStore.open(projectRoot);
          const style = await loadStyleMemory(store, resources);
          banned = style.banned;
          whitelist = style.whitelist;
          language = language ?? store.config.language;
          yoPolicy = store.config.yo_policy;
          spelling = store.config.spelling;
        }
        if (!language) {
          const cyr = (doc.body.match(/[Ѐ-ӿ]/g) ?? []).length;
          const lat = (doc.body.match(/[A-Za-z]/g) ?? []).length;
          language = cyr > lat ? 'ru' : 'en';
        }
        const report = lintText(doc.body, {
          language,
          banned,
          whitelist,
          ...(yoPolicy ? { yoPolicy } : {}),
          ...(spelling ? { spelling } : {}),
          ...(opts.rules ? { rules: opts.rules.split(',').map((s) => s.trim()) } : {}),
        });
        const ui = g.ui ?? 'en';
        out({ json: Boolean(g.json) }, report, () => `${formatLintReport(report, ui)}\n(${report.words} words, ${report.paragraphs} paragraphs; ${report.counts.error} error, ${report.counts.warning} warning, ${report.counts.info} info)`);
        if (report.counts.error > 0) process.exitCode = 2;
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('lint-rules')
    .description('list linter rule ids')
    .action(() => {
      for (const r of ALL_RULES) console.log(`${r.id.padEnd(26)} ${r.severity.padEnd(8)} ${r.category.padEnd(11)} ${r.languages === 'all' ? 'ru,en' : r.languages.join(',')}`);
    });

  // ---------------------------------------------------------------------------
  program
    .command('plan <n> [dir]')
    .description('plan a chapter: a beat sheet from the brief, outline, chronicle and narrator rules (rolls the d20 for Randy)')
    .option('--title <title>')
    .option('--hint <text>', 'extra guidance for the planner')
    .action(async (n: string, dir: string | undefined, opts: { title?: string; hint?: string }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const { sheet, roll } = await harness.planChapter(Number(n), { ...(opts.title ? { title: opts.title } : {}), ...(opts.hint ? { hint: opts.hint } : {}) });
        out(ctx, { sheet, roll }, () => `${ctx.t('planned')} ${n}${roll ? ` · ${ctx.t('roll')}: ${roll.result} (${roll.outcome})` : ''}\n${renderBeatSheet(sheet)}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('chronicle [dir]')
    .description('show the chronicle; --full adds the hidden block; --propose <n> asks the model for a state update, --apply writes it')
    .option('--full', 'full handover including «Скрыто от читателя»')
    .option('--propose <n>', 'propose the update for chapter n')
    .option('--apply', 'apply the proposal (otherwise it is only shown)')
    .action(async (dir: string | undefined, opts: { full?: boolean; propose?: string; apply?: boolean }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        if (opts.propose) {
          const { harness } = await openHarness(ctx, g);
          const chapter = await harness.store.getChapter(Number(opts.propose));
          const { proposal } = await harness.proposeChronicle(chapter);
          const preview = await harness.chronicle.preview(proposal);
          let applied = false;
          if (opts.apply) {
            await harness.chronicle.applyProposal(proposal, 'author');
            applied = true;
          }
          out(ctx, { proposal, described: preview.described, applied }, () => [`${ctx.t('chronicleProposal')} (${ctx.t('chapters')} ${proposal.chapter}):`, proposal.summary, '', ...preview.described.map((d) => `  - ${d}`), proposal.hidden ? `\n[hidden] ${proposal.hidden}` : '', applied ? ctx.t('applied') : ctx.t('applyHint')].join('\n'));
          return;
        }
        const store = await ProjectStore.open(ctx.root);
        const { Chronicle } = await import('@apex-galaxia/core');
        const chronicle = new Chronicle(store);
        const handover = await chronicle.handover();
        out(ctx, { readerSafe: handover.readerSafe, hidden: opts.full ? handover.hidden : undefined }, () => (opts.full ? `${handover.readerSafe}\n\n${handover.hidden}` : handover.readerSafe));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('summarize <n> [dir]')
    .description('generate and cache the reader-safe summary of a chapter')
    .action(async (n: string, dir: string | undefined, _o: unknown, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const chapter = await harness.store.getChapter(Number(n));
        const { summary, file } = await harness.summarizeChapter(chapter);
        out(ctx, { summary, file }, () => `${summary}\n\n${ctx.t('summaryWritten')} ${file}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('check-bible <n> [dir]')
    .description('check a chapter against the Bible and the chronicle')
    .action(async (n: string, dir: string | undefined, _o: unknown, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const chapter = await harness.store.getChapter(Number(n));
        const { result } = await harness.checkBible(chapter);
        out(ctx, result, () => [`${ctx.t('verdict')}: ${result.verdict} (continuity ${result.scores.continuity}/5)`, ...result.quotes.map((q) => `  [${q.severity}] «${q.quote}» — ${q.issue}`)].join('\n'));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('critic [dir]')
    .description('critic pass over a chapter or a passage: scores and quoted weak spots')
    .option('--chapter <n>')
    .option('--text <passage>')
    .option('--file <path>')
    .action(async (dir: string | undefined, opts: { chapter?: string; text?: string; file?: string }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const chapter = opts.chapter ? await harness.store.getChapter(Number(opts.chapter)) : undefined;
        const passage = chapter ? chapter.body : await readTextArg(opts.text, opts.file);
        const { result } = await harness.critique(passage, chapter);
        out(ctx, result, () => [`${ctx.t('verdict')}: ${result.verdict}`, `${ctx.t('scores')}: ${Object.entries(result.scores).map(([k, v]) => `${k} ${v}`).join(', ')}`, ...result.quotes.map((q) => `  [${q.severity}/${q.category}] «${q.quote}» — ${q.issue}`), result.notes ? `\n${result.notes}` : ''].join('\n'));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  // ---------------------------------------------------------------------------
  program
    .command('describe [dir]')
    .description('sensory alternatives for a selection, to weave in')
    .requiredOption('--text <selection>')
    .option('--count <n>', 'number of options', '5')
    .option('--intensity <level>', 'low | medium | high', 'medium')
    .option('--perceiver <who>', 'whose perception filters it')
    .option('--avoid <list>', 'comma-separated phrases to avoid')
    .option('--context <text>', 'surrounding text')
    .action(async (dir: string | undefined, opts: Record<string, string | undefined>, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const { options } = await harness.describe(opts['text']!, {
          count: Number(opts['count']),
          intensity: opts['intensity'] as 'low' | 'medium' | 'high',
          ...(opts['perceiver'] ? { perceiver: opts['perceiver'] } : {}),
          ...(opts['avoid'] ? { avoid: opts['avoid'].split(',').map((s) => s.trim()) } : {}),
          ...(opts['context'] ? { surrounding: opts['context'] } : {}),
        });
        out(ctx, options, () => options.options.map((o) => `[${o.sense}] ${o.text}`).join('\n'));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('rewrite [dir]')
    .description('rewrite a passage: --op tone|dialogue|show|tighten|expand|pov|punctuation|deai|quick; shown as a paragraph diff')
    .requiredOption('--op <name>')
    .option('--text <passage>')
    .option('--file <path>')
    .option('--percent <n>', 'for tighten and expand', '20')
    .option('--tone <name>', 'for tone')
    .option('--instruction <text>', 'for quick')
    .option('--viewpoint <who>', 'for pov')
    .option('--pov <id>', 'first | third (for pov)')
    .option('--tense <id>', 'past | present (for pov)')
    .option('--apply <which>', 'all | none: write the result to --file')
    .action(async (dir: string | undefined, opts: Record<string, string | undefined>, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const passage = await readTextArg(opts['text'], opts['file']);
        const vars: Record<string, string> = {};
        for (const key of ['percent', 'tone', 'instruction', 'viewpoint', 'pov', 'tense'] as const) {
          if (opts[key]) vars[key] = opts[key]!;
        }
        const result = await harness.rewrite(opts['op']!, passage, vars);
        if (opts['apply'] && opts['file']) {
          await fs.writeFile(path.resolve(opts['file']), applyDiff(result.diff, opts['apply'] === 'all' ? 'all' : 'none'), 'utf8');
        }
        out(ctx, { text: result.text, diff: result.diff, lint: result.lint }, () => `${formatDiff(result.diff)}\n\n${formatLintReport(result.lint, ctx.ui)}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('directions [dir]')
    .description('2–5 directions for the next chapter, the obvious one marked and one recommended (--twist for twists)')
    .option('--count <n>', '3')
    .option('--focus <text>')
    .option('--twist')
    .action(async (dir: string | undefined, opts: { count?: string; focus?: string; twist?: boolean }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const { directions } = await harness.directions({ count: Number(opts.count ?? 3), ...(opts.focus ? { focus: opts.focus } : {}), ...(opts.twist ? { twist: true } : {}) });
        out(ctx, directions, () => directions.options.map((o, i) => `${i + 1}. ${o.title}${o.recommended ? ` (${ctx.t('recommended')})` : ''}${o.obvious ? ` (${ctx.t('obvious')})` : ''}\n   ${o.text}`).join('\n'));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  // ---------------------------------------------------------------------------
  const bible = program.command('bible').description('Story Bible entries');
  bible
    .command('add <kind> <name> [dir]')
    .description('create an entry from the template: kind is character, location, faction or item')
    .option('--alias <list>', 'comma-separated aliases (both languages)')
    .option('--always-on')
    .option('--canon', 'a canon character of the universe')
    .option('--file <path>', 'use this Markdown body instead of the template')
    .action(async (kind: string, name: string, dir: string | undefined, opts: { alias?: string; alwaysOn?: boolean; canon?: boolean; file?: string }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const store = await ProjectStore.open(ctx.root);
        const aliases = (opts.alias ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        const ru = aliases.filter((a) => /[Ѐ-ӿ]/.test(a));
        const en = aliases.filter((a) => !/[Ѐ-ӿ]/.test(a));
        const body = opts.file ? await fs.readFile(path.resolve(opts.file), 'utf8') : entryTemplate(kind as EntryKind, store.config.language, name);
        const entry = await upsertEntry(store, {
          kind: kind as EntryKind,
          front: { name, aliases: { ru, en }, always_on: Boolean(opts.alwaysOn), kind: opts.canon ? 'canon' : 'original' },
          body,
        });
        out(ctx, { slug: entry.slug, path: entry.path }, () => `${ctx.t('entryWritten')}: ${entry.path}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });
  bible
    .command('list [dir]')
    .description('list entries with aliases and summaries')
    .action(async (dir: string | undefined, _o: unknown, cmd: Command) => {
      try {
        const ctx = await cliContext(globals(cmd), dir);
        const store = await ProjectStore.open(ctx.root);
        const snapshot = await loadBible(store);
        out(ctx, snapshot.entries.map((e) => ({ kind: e.kind, slug: e.slug, name: e.front.name, aliases: e.front.aliases, summary: e.summary, always_on: e.front.always_on })), () => snapshot.entries.map((e) => `${e.kind.padEnd(9)} ${e.slug.padEnd(18)} ${e.front.name}${e.front.always_on ? ' (always on)' : ''} — ${e.summary}`).join('\n') || '—');
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });
  bible
    .command('extract <n> [dir]')
    .description('propose new or changed entries from a chapter (nothing is written without --apply)')
    .option('--apply', 'write the proposals as entries')
    .action(async (n: string, dir: string | undefined, opts: { apply?: boolean }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const chapter = await harness.store.getChapter(Number(n));
        const { proposals } = await harness.extractBible(chapter);
        const written: string[] = [];
        if (opts.apply) {
          for (const p of proposals.proposals) {
            if (!['character', 'location', 'faction', 'item'].includes(p.kind)) continue;
            const existing = harness.bible.entries.find((e) => e.kind === p.kind && e.slug === p.slug);
            const body = existing ? `${existing.body.trimEnd()}\n\n## Proposed update (${new Date().toISOString().slice(0, 10)})\n\n${p.diff}\n` : `# ${p.name ?? p.slug}\n\n## Summary\n\n${p.summary ?? ''}\n\n${p.diff}\n`;
            const entry = await upsertEntry(harness.store, { kind: p.kind as EntryKind, slug: p.slug, front: { name: p.name ?? existing?.front.name ?? p.slug }, body });
            written.push(entry.path);
          }
        }
        out(ctx, { proposals, written }, () => [`${ctx.t('proposals')}: ${proposals.proposals.length}`, ...proposals.proposals.map((p) => `  ${p.action} ${p.kind}/${p.slug}: ${p.summary ?? ''}\n    ${p.diff.replace(/\n/g, '\n    ')}${p.reason ? `\n    (${p.reason})` : ''}`), ...written.map((w) => `${ctx.t('entryWritten')}: ${w}`)].join('\n'));
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  // ---------------------------------------------------------------------------
  program
    .command('inspect [dir]')
    .description('show the context inspector for a task without calling the model')
    .option('--task <name>', 'template name', 'write.continue')
    .option('--at <chapter>')
    .action(async (dir: string | undefined, opts: { task?: string; at?: string }, cmd: Command) => {
      try {
        const g = globals(cmd);
        const ctx = await cliContext(g, dir);
        const { harness } = await openHarness(ctx, g);
        const chapters = await harness.store.listChapters();
        const chapter = opts.at ? await harness.store.getChapter(Number(opts.at)) : chapters[chapters.length - 1];
        const assembled = await harness.assemble({ task: opts.task ?? 'write.continue', ...(chapter ? { chapter } : {}), vars: { target_words: '300', instruction: '', scene_card: '', chapter_plan_hint: '', chapter_text: chapter?.body ?? '', passage: '', lint_hits: '', count: '3', focus: '', selection: '', surrounding: '', intensity: 'medium', perceiver: '', avoid: '', before: '', after: '', note: '', existing_lessons: '', sample: '', bible_index: '', bible_full: '', findings: '', percent: '20', tone: '', viewpoint: '', text: '', what: '', request: '', topic: '', universe: '', canon_point: '' } });
        const estimate = harness.estimateFor(assembled);
        out(ctx, { inspector: assembled.inspector, estimate }, () => `${formatInspector(assembled.inspector, ctx.ui)}\n\n${ctx.t('estimate')}: ~${estimate.inputTokens} in + ${estimate.expectedOutputTokens} out → $${estimate.costUsd.toFixed(4)} (${estimate.model})`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  program
    .command('export [dir]')
    .description('export the manuscript: --format md (docx and epub come in Phase 6)')
    .option('--format <fmt>', 'md', 'md')
    .option('--out <file>')
    .action(async (dir: string | undefined, opts: { format?: string; out?: string }, cmd: Command) => {
      try {
        const ctx = await cliContext(globals(cmd), dir);
        if (opts.format !== 'md') throw new Error(`Format ${opts.format} is not available yet; use md`);
        const store = await ProjectStore.open(ctx.root);
        const chapters = await store.listChapters();
        const parts = [`# ${store.config.title}`, ''];
        for (const ch of chapters) {
          parts.push(`## ${chapterHeading(store.config.language, ch.front.number, ch.front.title)}`, '', ch.body.trim(), '');
        }
        const file = opts.out ? path.resolve(opts.out) : path.join(store.layout.exports, `${slugify(store.config.title)}.md`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, parts.join('\n') + '\n', 'utf8');
        out(ctx, { file, chapters: chapters.length }, () => `${ctx.t('exported')} ${file}`);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });

  return program;
}
