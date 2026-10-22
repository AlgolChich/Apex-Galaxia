import { stringify as stringifyYaml } from 'yaml';
import { appendLine, isoNow } from '../util/fs.js';
import type { ProjectStore } from '../project/store.js';
import {
  ChronicleProposalSchema,
  ChronicleStateSchema,
  type ChronicleProposal,
  type ChronicleState,
  type Language,
  type Roll,
} from '../project/schemas.js';
import { applyOps, describeOps } from './state.js';

export interface ApplyResult {
  state: ChronicleState;
  described: string[];
}

export interface Handover {
  /** Everything needed to continue the story elsewhere, safe for a reader. */
  readerSafe: string;
  /** Planned twists and planted guns: «Скрыто от читателя». */
  hidden: string;
}

/**
 * The chronicle: machine-readable state in YAML plus the human log in Markdown. Proposals
 * come from the model; nothing is applied without `applyProposal`, which the client calls
 * after the Author confirms (or in autonomous mode with a diff log).
 */
export class Chronicle {
  constructor(private readonly store: ProjectStore) {}

  get language(): Language {
    return this.store.config.language;
  }

  async readState(): Promise<ChronicleState> {
    return (await this.store.readYaml(this.store.layout.chronicle.state, ChronicleStateSchema)) ?? ChronicleStateSchema.parse({});
  }

  async writeState(state: ChronicleState): Promise<void> {
    await this.store.writeYaml(this.store.layout.chronicle.state, ChronicleStateSchema, state);
  }

  async readLog(): Promise<string> {
    return (await this.store.readText(this.store.layout.chronicle.log)) ?? '';
  }

  async readHidden(): Promise<string> {
    return (await this.store.readText(this.store.layout.chronicle.hidden)) ?? '';
  }

  /** Validate a proposal and preview the resulting state without writing anything. */
  async preview(proposal: unknown): Promise<{ proposal: ChronicleProposal; state: ChronicleState; described: string[] }> {
    const valid = ChronicleProposalSchema.parse(proposal);
    const current = await this.readState();
    const next = applyOps(current, valid.ops);
    return { proposal: valid, state: next, described: describeOps(valid.ops) };
  }

  /** Apply a confirmed proposal: state, reader-safe log, hidden block, and the diff log. */
  async applyProposal(proposal: unknown, by: 'author' | 'auto' = 'author'): Promise<ApplyResult> {
    const { proposal: valid, state, described } = await this.preview(proposal);
    const next: ChronicleState = {
      ...state,
      last_chapter: Math.max(state.last_chapter, valid.chapter),
      in_story_time: valid.in_story_time ?? state.in_story_time,
    };
    await this.writeState(next);
    await this.appendLog(valid.chapter, valid.summary);
    if (valid.hidden && valid.hidden.trim()) {
      await this.appendHidden(valid.chapter, valid.hidden);
    }
    await appendLine(
      this.store.layout.history.chronicleLog,
      JSON.stringify({ ts: isoNow(), chapter: valid.chapter, by, ops: valid.ops, described }),
    );
    return { state: next, described };
  }

  async appendLog(chapter: number, summary: string): Promise<void> {
    const heading = this.language === 'ru' ? `## Глава ${chapter}` : `## Chapter ${chapter}`;
    const current = await this.readLog();
    const block = `\n${heading}\n\n${summary.trim()}\n`;
    await this.store.writeText(this.store.layout.chronicle.log, current.trimEnd() + '\n' + block);
  }

  async appendHidden(chapter: number, text: string): Promise<void> {
    const heading = this.language === 'ru' ? `## После главы ${chapter}` : `## After chapter ${chapter}`;
    const current = await this.readHidden();
    await this.store.writeText(this.store.layout.chronicle.hidden, current.trimEnd() + `\n\n${heading}\n\n${text.trim()}\n`);
  }

  /** Record a storyteller roll (Randy's d20) in state.yaml. */
  async recordRoll(roll: Roll): Promise<ChronicleState> {
    const state = await this.readState();
    const next = { ...state, rolls: [...state.rolls, { ...roll, at: roll.at ?? isoNow() }] };
    await this.writeState(next);
    return next;
  }

  /** The full handover summary (`/летопись`): reader-safe part and hidden part separated. */
  async handover(): Promise<Handover> {
    const state = await this.readState();
    const log = await this.readLog();
    const hidden = await this.readHidden();
    const brief = (await this.store.readText(this.store.layout.plan.brief)) ?? '';
    const outline = (await this.store.readText(this.store.layout.plan.outline)) ?? '';
    const ru = this.language === 'ru';
    const title = (en: string, r: string) => (ru ? r : en);
    const readerSafe = [
      `# ${title('Handover', 'Летопись для передачи')}: ${this.store.config.title}`,
      '',
      `## ${title('Settings', 'Настройки')}`,
      '',
      renderSettings(this.store, ru),
      '',
      `## ${title('Brief', 'Бриф')}`,
      '',
      brief.trim(),
      '',
      `## ${title('State', 'Состояние мира')}`,
      '',
      '```yaml',
      renderStateYaml(state, { hidden: false }).trimEnd(),
      '```',
      '',
      `## ${title('Chronicle', 'Летопись')}`,
      '',
      log.trim(),
      '',
    ].join('\n');
    const hiddenBlock = [
      `# ${title('Hidden from the reader', 'Скрыто от читателя')}`,
      '',
      outline.trim(),
      '',
      '```yaml',
      renderStateYaml(state, { hidden: true }).trimEnd(),
      '```',
      '',
      hidden.trim(),
      '',
    ].join('\n');
    return { readerSafe, hidden: hiddenBlock };
  }
}

function renderSettings(store: ProjectStore, ru: boolean): string {
  const c = store.config;
  const rows: Array<[string, string]> = [
    [ru ? 'Язык' : 'Language', c.language],
    [ru ? 'Рассказчик' : 'Storyteller', c.storyteller],
    [ru ? 'Жёсткость судьбы' : 'Harshness', String(c.harshness)],
    [ru ? 'Рейтинг' : 'Rating', c.rating],
    [ru ? 'Длина' : 'Length', c.length],
    [ru ? 'Повествование' : 'Narration', `${c.pov} person, ${c.tense} tense`],
    [ru ? 'Клиффхэнгеры' : 'Cliffhangers', c.cliffhangers],
  ];
  return rows.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

/**
 * Render state for prompts. The reader-safe view omits planted guns and pending
 * consequences; the planner view (hidden: true) carries only those.
 */
export function renderStateYaml(state: ChronicleState, options: { hidden: boolean }): string {
  if (options.hidden) {
    return stringifyYaml(
      { planted_guns: state.planted_guns, pending_consequences: state.pending_consequences, rolls: state.rolls.slice(-5) },
      { lineWidth: 0 },
    );
  }
  const { planted_guns: _g, pending_consequences: _p, rolls: _r, format_version: _f, ...visible } = state;
  return stringifyYaml(visible, { lineWidth: 0 });
}
