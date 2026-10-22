import { getClient } from '../../api/index.js';
import { payload, type CallOptions } from '../../api/mcp.js';
import type { Direction, EntryKind } from '../../api/types.js';

/**
 * Typed wrappers over the canvas tools of the MCP server (`packages/mcp-server/src/server.ts`,
 * «Canvas» section). They live with the feature so the shared client stays untouched; every
 * call goes through `connection.callTool` and the structured payload.
 */

export type CardKind = 'idea' | 'scene' | 'arc' | 'twist' | 'branch' | 'question';
export const CARD_KINDS: readonly CardKind[] = ['idea', 'scene', 'arc', 'twist', 'branch', 'question'];

export type BoardTemplate = 'none' | 'three_act' | 'heros_journey' | 'save_the_cat' | 'romancing_the_beat' | 'kishotenketsu';
export const TEMPLATES: readonly BoardTemplate[] = ['none', 'three_act', 'heros_journey', 'save_the_cat', 'romancing_the_beat', 'kishotenketsu'];

export interface CardLink {
  to: string;
  label?: string;
}

export interface BoardCard {
  id: string;
  kind: CardKind;
  title: string;
  text: string;
  x: number;
  y: number;
  lane?: string;
  links: CardLink[];
}

export interface BoardState {
  template: BoardTemplate;
  /** Template lanes first, then the lanes cards mention, as the server orders them. */
  lanes: string[];
  cards: BoardCard[];
  /** Card ids in reading order (lane, then top to bottom, then left to right). */
  order: string[];
}

export interface NewCardInput {
  kind: CardKind;
  title: string;
  text?: string;
  lane?: string;
  links_to?: string[];
  /** World position; when given the server stores it with the card, so no second call is needed. */
  x?: number;
  y?: number;
}

export interface CardPatch {
  title?: string;
  text?: string;
  kind?: CardKind;
  lane?: string;
  x?: number;
  y?: number;
}

/** A card the model proposes (Expand this arc, What if); `links_to` names titles, not ids. */
export interface ProposedCard {
  kind: CardKind;
  title: string;
  text: string;
  lane?: string;
  links_to: string[];
}

export interface CardsProposal {
  cards: ProposedCard[];
  note?: string;
}

export interface GunFound {
  detail: string;
  where: string;
  payoff: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface OutlineProposal {
  chapters: Array<{ number: number; title: string; line: string }>;
}

/** Model and cost of a call when the server includes them; absent from today's canvas tools. */
export interface ModelMeta {
  model?: string;
  costUsd?: number;
}

function metaOf(raw: unknown): ModelMeta {
  const r = raw as { model?: unknown; costUsd?: unknown } | undefined;
  return { ...(typeof r?.model === 'string' && r.model ? { model: r.model } : {}), ...(typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd) ? { costUsd: r.costUsd } : {}) };
}

/** The reading order the core uses: lane rank (template lanes first), then y, then x. */
export function readingOrder(cards: readonly BoardCard[], lanes: readonly string[]): string[] {
  const rank = (card: BoardCard) => {
    if (!card.lane) return lanes.length;
    const index = lanes.indexOf(card.lane);
    return index < 0 ? lanes.length : index;
  };
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x).map((c) => c.id);
}

function asCard(raw: unknown): BoardCard | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<BoardCard> & { links?: unknown };
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return undefined;
  const kind = CARD_KINDS.includes(r.kind as CardKind) ? (r.kind as CardKind) : 'idea';
  const links = Array.isArray(r.links) ? (r.links as Array<{ to?: unknown; label?: unknown }>).filter((l) => typeof l?.to === 'string').map((l) => (typeof l.label === 'string' && l.label ? { to: l.to as string, label: l.label } : { to: l.to as string })) : [];
  return {
    id: r.id,
    kind,
    title: r.title,
    text: typeof r.text === 'string' ? r.text : '',
    x: typeof r.x === 'number' && Number.isFinite(r.x) ? r.x : 0,
    y: typeof r.y === 'number' && Number.isFinite(r.y) ? r.y : 0,
    links,
    ...(typeof r.lane === 'string' && r.lane ? { lane: r.lane } : {}),
  };
}

/**
 * `canvas_get` answers `{ board: { template, cards }, lanes }`; a flat `{ template, lanes, cards,
 * order }` is accepted too. Missing pieces are derived so the view never sees a half board.
 */
export function normalizeBoard(raw: unknown): BoardState {
  const r = (raw ?? {}) as { board?: unknown; lanes?: unknown; template?: unknown; cards?: unknown; order?: unknown };
  const inner = (r.board && typeof r.board === 'object' ? r.board : r) as { template?: unknown; cards?: unknown; lanes?: unknown };
  const template = TEMPLATES.includes(inner.template as BoardTemplate) ? (inner.template as BoardTemplate) : 'none';
  const cards = (Array.isArray(inner.cards) ? inner.cards : []).map(asCard).filter((c): c is BoardCard => c !== undefined);
  const lanesRaw = Array.isArray(r.lanes) ? r.lanes : Array.isArray(inner.lanes) ? inner.lanes : [];
  const lanes = lanesRaw.filter((l): l is string => typeof l === 'string' && l.length > 0);
  const ids = new Set(cards.map((c) => c.id));
  const order = Array.isArray(r.order) && r.order.every((id) => typeof id === 'string' && ids.has(id)) && r.order.length === cards.length ? (r.order as string[]) : readingOrder(cards, lanes);
  return { template, lanes, cards, order };
}

async function call<T>(name: string, args: Record<string, unknown> = {}, options?: CallOptions): Promise<T> {
  return payload<T>(await getClient().connection.callTool(name, args, options));
}

/** Drop undefined values so optional arguments stay absent (an empty lane string clears a lane). */
function clean<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

export async function canvasGet(): Promise<BoardState> {
  return normalizeBoard(await call<unknown>('canvas_get'));
}

export async function canvasAdd(input: NewCardInput): Promise<BoardCard> {
  const raw = await call<unknown>('canvas_add', clean({ kind: input.kind, title: input.title, text: input.text || undefined, lane: input.lane || undefined, links_to: input.links_to && input.links_to.length > 0 ? input.links_to : undefined, x: input.x, y: input.y }));
  const card = asCard(raw) ?? asCard((raw as { card?: unknown })?.card);
  if (!card) throw new Error('canvas_add returned no card');
  return card;
}

export async function canvasUpdate(id: string, patch: CardPatch): Promise<BoardCard | undefined> {
  const raw = await call<{ card?: unknown }>('canvas_update', { id, ...clean({ ...patch }) });
  return asCard(raw?.card) ?? asCard(raw);
}

export async function canvasLink(from: string, to: string, label?: string): Promise<void> {
  await call('canvas_link', { from, to, ...(label ? { label } : {}) });
}

export async function canvasRemove(id: string): Promise<void> {
  await call('canvas_remove', { id });
}

export async function canvasTemplate(template: BoardTemplate): Promise<string[]> {
  const result = await call<{ template?: string; lanes?: unknown }>('canvas_template', { template });
  return Array.isArray(result?.lanes) ? result.lanes.filter((l): l is string => typeof l === 'string') : [];
}

export async function canvasPromoteToBible(id: string, kind: EntryKind): Promise<{ entry: string; path: string }> {
  return call('canvas_promote', { id, kind });
}

export async function canvasPromoteToPlan(id: string, chapter: number): Promise<{ chapter: number }> {
  return call('canvas_promote', { id, chapter });
}

export async function canvasOutline(write = false): Promise<string> {
  const result = await call<{ outline?: string; text?: string }>('canvas_outline', write ? { write: true } : {});
  return result?.outline ?? result?.text ?? '';
}

/** Directions (model): 2–5 ways the story could go; `{ options }`, or `{ result }` from older builds. */
export async function canvasDirections(input: { count?: number; focus?: string }, options?: CallOptions): Promise<{ options: Direction[] } & ModelMeta> {
  const raw = await call<{ options?: unknown; result?: unknown }>('canvas_directions', clean({ ...input }), options);
  const list = Array.isArray(raw?.options) ? raw.options : Array.isArray(raw?.result) ? raw.result : [];
  const directions = (list as Array<Partial<Direction>>).filter((d) => typeof d?.title === 'string').map((d) => ({ title: d.title as string, text: typeof d.text === 'string' ? d.text : '', obvious: Boolean(d.obvious), recommended: Boolean(d.recommended) }));
  return { options: directions, ...metaOf(raw) };
}

/** Expand this arc / What if: cards the model proposes, nothing added yet. */
export async function canvasAiCards(action: 'expand' | 'whatif', input: { card?: string; question?: string }, options?: CallOptions): Promise<CardsProposal & ModelMeta> {
  const raw = await call<Partial<CardsProposal>>('canvas_ai', { action, ...clean({ ...input }) }, options);
  const cards = (Array.isArray(raw?.cards) ? raw.cards : [])
    .filter((c): c is ProposedCard => Boolean(c) && typeof c.title === 'string')
    .map((c) => ({ kind: CARD_KINDS.includes(c.kind) ? c.kind : 'idea', title: c.title, text: typeof c.text === 'string' ? c.text : '', links_to: Array.isArray(c.links_to) ? c.links_to.filter((l): l is string => typeof l === 'string') : [], ...(c.lane ? { lane: c.lane } : {}) }));
  return { cards, ...(typeof raw?.note === 'string' && raw.note ? { note: raw.note } : {}), ...metaOf(raw) };
}

export async function canvasAiGuns(options?: CallOptions): Promise<{ guns: GunFound[] } & ModelMeta> {
  const raw = await call<{ guns?: unknown }>('canvas_ai', { action: 'guns' }, options);
  const guns: GunFound[] = (Array.isArray(raw?.guns) ? (raw.guns as Array<Partial<GunFound>>) : [])
    .filter((g) => typeof g?.detail === 'string')
    .map((g) => ({ detail: g.detail as string, where: g.where ?? '', payoff: g.payoff ?? '', confidence: g.confidence === 'low' || g.confidence === 'high' ? g.confidence : 'medium' }));
  return { guns, ...metaOf(raw) };
}

export async function canvasAiCollapse(chapterCount: number | undefined, options?: CallOptions): Promise<OutlineProposal & ModelMeta> {
  const raw = await call<{ chapters?: unknown }>('canvas_ai', { action: 'collapse', ...(chapterCount !== undefined ? { chapter_count: chapterCount } : {}) }, options);
  const chapters = (Array.isArray(raw?.chapters) ? (raw.chapters as Array<Partial<OutlineProposal['chapters'][number]>>) : [])
    .filter((c) => typeof c?.title === 'string')
    .map((c, i) => ({ number: typeof c.number === 'number' ? c.number : i + 1, title: c.title as string, line: c.line ?? '' }));
  return { chapters, ...metaOf(raw) };
}

/** The outline proposal as the plan file text, the same shape the core writes. */
export function outlineMarkdown(outline: OutlineProposal, language: 'ru' | 'en'): string {
  const heading = language === 'ru' ? 'План' : 'Outline';
  const chapter = language === 'ru' ? 'Глава' : 'Chapter';
  return [`# ${heading}`, '', ...outline.chapters.map((c) => `- ${chapter} ${c.number}. ${c.title}: ${c.line}`), ''].join('\n');
}
