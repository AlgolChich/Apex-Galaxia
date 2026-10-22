import path from 'node:path';
import { ApexError } from '../util/errors.js';
import { shortId } from '../util/fs.js';
import { slugify } from '../util/slug.js';
import { upsertEntry, type BibleEntry } from '../bible/entries.js';
import type { EntryKind } from '../project/layout.js';
import { BoardSchema, ChaptersPlanSchema, type Board } from '../project/schemas.js';
import type { ProjectStore } from '../project/store.js';

export type Card = Board['cards'][number];
export type BoardTemplate = Board['template'];

/** Lanes of the structure templates (Section 4.5). Names are shown as written; the Author can rename cards' lanes freely. */
export const TEMPLATE_LANES: Record<BoardTemplate, string[]> = {
  none: [],
  three_act: ['Act I', 'Act II', 'Act III'],
  heros_journey: ['Ordinary World', 'Call to Adventure', 'Refusal of the Call', 'Meeting the Mentor', 'Crossing the Threshold', 'Tests, Allies, Enemies', 'Approach to the Inmost Cave', 'Ordeal', 'Reward', 'The Road Back', 'Resurrection', 'Return with the Elixir'],
  save_the_cat: ['Opening Image', 'Theme Stated', 'Set-Up', 'Catalyst', 'Debate', 'Break into Two', 'B Story', 'Fun and Games', 'Midpoint', 'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul', 'Break into Three', 'Finale', 'Final Image'],
  romancing_the_beat: ['Set-Up', 'Falling in Love', 'Retreating from Love', 'Fighting for Love'],
  kishotenketsu: ['Ki: introduction', 'Shō: development', 'Ten: twist', 'Ketsu: conclusion'],
};

export interface NewCard {
  kind: Card['kind'];
  title: string;
  text?: string;
  lane?: string;
  x?: number;
  y?: number;
}

/**
 * The canvas: an infinite board of cards stored as JSON. Deterministic operations live here;
 * AI actions (directions, expand, what if, find the gun, collapse) go through the harness.
 */
export class Canvas {
  constructor(private readonly store: ProjectStore) {}

  async read(): Promise<Board> {
    const text = await this.store.readText(this.store.layout.canvas.board);
    if (!text) return BoardSchema.parse({});
    return this.store.validate(BoardSchema, JSON.parse(text), this.store.layout.canvas.board);
  }

  async write(board: Board): Promise<void> {
    const valid = this.store.validate(BoardSchema, board, this.store.layout.canvas.board);
    await this.store.writeText(this.store.layout.canvas.board, JSON.stringify(valid, null, 2) + '\n');
  }

  lanes(board: Board): string[] {
    const fromTemplate = TEMPLATE_LANES[board.template];
    const extra = [...new Set(board.cards.map((c) => c.lane).filter((l): l is string => Boolean(l) && !fromTemplate.includes(l!)))].sort();
    return [...fromTemplate, ...extra];
  }

  async addCard(input: NewCard): Promise<Card> {
    const board = await this.read();
    const card: Card = {
      id: shortId('card'),
      kind: input.kind,
      title: input.title,
      text: input.text ?? '',
      x: input.x ?? 0,
      y: input.y ?? board.cards.length * 120,
      links: [],
      ...(input.lane ? { lane: input.lane } : {}),
    };
    await this.write({ ...board, cards: [...board.cards, card] });
    return card;
  }

  async updateCard(id: string, patch: Partial<Omit<Card, 'id' | 'links'>>): Promise<Card> {
    const board = await this.read();
    const index = board.cards.findIndex((c) => c.id === id);
    if (index < 0) throw new ApexError('INVALID_ARGUMENT', `Card ${id} not found`, { id });
    const next = { ...board.cards[index]!, ...patch };
    const cards = [...board.cards];
    cards[index] = next;
    await this.write({ ...board, cards });
    return next;
  }

  /** Removing a card also drops links pointing at it; the board file keeps no trash, the project's git history does. */
  async removeCard(id: string): Promise<void> {
    const board = await this.read();
    if (!board.cards.some((c) => c.id === id)) throw new ApexError('INVALID_ARGUMENT', `Card ${id} not found`, { id });
    await this.write({ ...board, cards: board.cards.filter((c) => c.id !== id).map((c) => ({ ...c, links: c.links.filter((l) => l.to !== id) })) });
  }

  async link(from: string, to: string, label?: string): Promise<void> {
    const board = await this.read();
    const source = board.cards.find((c) => c.id === from);
    if (!source || !board.cards.some((c) => c.id === to)) throw new ApexError('INVALID_ARGUMENT', `Both cards must exist: ${from} → ${to}`);
    if (source.links.some((l) => l.to === to)) return;
    source.links.push(label ? { to, label } : { to });
    await this.write(board);
  }

  async setTemplate(template: BoardTemplate): Promise<string[]> {
    const board = await this.read();
    await this.write({ ...board, template });
    return TEMPLATE_LANES[template];
  }

  /** Cards in reading order: lane order (template first), then top to bottom, then left to right. */
  ordered(board: Board): Card[] {
    const lanes = this.lanes(board);
    const rank = (c: Card) => (c.lane ? lanes.indexOf(c.lane) : lanes.length);
    return [...board.cards].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x);
  }

  /** Deterministic «Collapse to outline»: one line per card in reading order. */
  collapseToOutline(board: Board): string {
    const lines = this.ordered(board).map((c) => `- ${c.lane ? `[${c.lane}] ` : ''}${c.kind}: ${c.title}${c.text ? ` — ${c.text.replace(/\s+/g, ' ').trim()}` : ''}`);
    return lines.join('\n') + (lines.length ? '\n' : '');
  }

  /** Text rendering of the board for prompts. */
  render(board: Board): string {
    const byId = new Map(board.cards.map((c) => [c.id, c]));
    const lines = this.ordered(board).map((c) => {
      const links = c.links.map((l) => `→ ${byId.get(l.to)?.title ?? l.to}${l.label ? ` (${l.label})` : ''}`).join(', ');
      return `[${c.id}] ${c.kind} «${c.title}»${c.lane ? ` in ${c.lane}` : ''}: ${c.text || '(no text)'}${links ? ` ${links}` : ''}`;
    });
    return `template: ${board.template}\n${lines.join('\n') || '(empty board)'}`;
  }

  /** Promote a card into a Bible entry (its title as the name, its text as the summary). */
  async promoteToBible(id: string, kind: EntryKind): Promise<BibleEntry> {
    const board = await this.read();
    const card = board.cards.find((c) => c.id === id);
    if (!card) throw new ApexError('INVALID_ARGUMENT', `Card ${id} not found`, { id });
    const entry = await upsertEntry(this.store, {
      kind,
      front: { name: card.title },
      body: `# ${card.title}\n\n## Summary\n\n${card.text.split(/\n/)[0] ?? card.title}\n\n## True now\n\n${card.text}\n`,
    });
    await this.updateCard(id, { text: `${card.text}\n→ bible/${kind}/${entry.slug}`.trim() });
    return entry;
  }

  /** Promote a scene or arc card into the chapter plan as a beat of chapter `number`. */
  async promoteToPlan(id: string, number: number): Promise<void> {
    const board = await this.read();
    const card = board.cards.find((c) => c.id === id);
    if (!card) throw new ApexError('INVALID_ARGUMENT', `Card ${id} not found`, { id });
    const plan = (await this.store.readYaml(this.store.layout.plan.chapters, ChaptersPlanSchema)) ?? { chapters: [] };
    const existing = plan.chapters.find((c) => c.number === number);
    const beat = card.text ? `${card.title}: ${card.text.replace(/\s+/g, ' ').trim()}` : card.title;
    const chapter = existing ? { ...existing, beats: [...existing.beats, beat] } : { number, title: card.kind === 'scene' ? card.title : `${this.store.config.language === 'ru' ? 'Глава' : 'Chapter'} ${number}`, status: 'planned' as const, beats: [beat] };
    await this.store.writeYaml(this.store.layout.plan.chapters, ChaptersPlanSchema, { chapters: [...plan.chapters.filter((c) => c.number !== number), chapter].sort((a, b) => a.number - b.number) });
    await this.updateCard(id, { text: `${card.text}\n→ plan chapter ${number}`.trim() });
  }

  boardPath(): string {
    return path.relative(this.store.layout.root, this.store.layout.canvas.board);
  }

  static slugForCard(card: Card): string {
    return slugify(card.title);
  }
}
