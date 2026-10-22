import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Canvas, ChaptersPlanSchema, Harness, NoModelAdapter, TEMPLATE_LANES, createProject, getEntry, resolveResources, type GenerateOptions, type ProjectStore, type Resources } from '@apex-galaxia/core';
import { ReplayAdapter } from '@apex-galaxia/adapters';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let store: ProjectStore;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-canvas-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
  store = await createProject(path.join(dir, 's'), { title: 'Маяк', language: 'ru', preset: 'fast' });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('canvas board', () => {
  it('adds, links, orders by lane and position, collapses to an outline, removes with links', async () => {
    const canvas = new Canvas(store);
    expect(await canvas.setTemplate('three_act')).toEqual(TEMPLATE_LANES.three_act);
    const a = await canvas.addCard({ kind: 'scene', title: 'Катер не пришёл', text: 'Третий день.', lane: 'Act I', y: 10 });
    const b = await canvas.addCard({ kind: 'twist', title: 'Лодка за мысом', text: 'Гость приплыл не один.', lane: 'Act III', y: 0 });
    const c = await canvas.addCard({ kind: 'question', title: 'Кто отменил катер?', lane: 'Act I', y: 0 });
    const d = await canvas.addCard({ kind: 'idea', title: 'Без полосы' });
    await canvas.link(a.id, b.id, 'ведёт к');
    await canvas.link(a.id, b.id);
    const board = await canvas.read();
    expect(board.template).toBe('three_act');
    expect(board.cards.find((x) => x.id === a.id)?.links).toEqual([{ to: b.id, label: 'ведёт к' }]);
    expect(canvas.ordered(board).map((x) => x.title)).toEqual(['Кто отменил катер?', 'Катер не пришёл', 'Лодка за мысом', 'Без полосы']);
    const outline = canvas.collapseToOutline(board);
    expect(outline.split('\n').filter(Boolean)).toHaveLength(4);
    expect(outline).toContain('- [Act I] scene: Катер не пришёл — Третий день.');
    expect(canvas.render(board)).toContain('→ Лодка за мысом (ведёт к)');
    expect(canvas.lanes(board)).toEqual(['Act I', 'Act II', 'Act III']);
    await canvas.removeCard(b.id);
    const after = await canvas.read();
    expect(after.cards).toHaveLength(3);
    expect(after.cards.find((x) => x.id === a.id)?.links).toEqual([]);
    await expect(canvas.removeCard('nope')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await canvas.updateCard(d.id, { lane: 'Эпилог' });
    expect(canvas.lanes(await canvas.read())).toEqual(['Act I', 'Act II', 'Act III', 'Эпилог']);
    expect(await canvas.read()).toMatchObject({ format_version: 1 });
    await expect(canvas.updateCard(c.id, { kind: 'scene' })).resolves.toMatchObject({ kind: 'scene' });
  });

  it('promotes cards into Bible entries and chapter plans', async () => {
    const canvas = new Canvas(store);
    const card = await canvas.addCard({ kind: 'idea', title: 'Арсений', text: 'Человек с одной перчаткой.\nЗнает отчество Фёдора.' });
    const entry = await canvas.promoteToBible(card.id, 'character');
    expect(entry.slug).toBe('arseniy');
    expect((await getEntry(store, 'character', 'arseniy')).summary).toBe('Человек с одной перчаткой.');
    expect((await canvas.read()).cards[0]?.text).toContain('→ bible/character/arseniy');
    const scene = await canvas.addCard({ kind: 'scene', title: 'Радио', text: 'Посёлок отвечает странно.' });
    await canvas.promoteToPlan(scene.id, 2);
    const plan = await store.readYaml(store.layout.plan.chapters, ChaptersPlanSchema);
    expect(plan?.chapters[0]).toMatchObject({ number: 2, title: 'Радио', beats: ['Радио: Посёлок отвечает странно.'] });
    await canvas.promoteToPlan(scene.id, 2);
    expect((await store.readYaml(store.layout.plan.chapters, ChaptersPlanSchema))?.chapters[0]?.beats).toHaveLength(2);
  });

  it('runs AI actions through the harness with validated outputs', async () => {
    const responder = (options: GenerateOptions): string => {
      switch (options.task) {
        case 'canvas.expand':
          return JSON.stringify({ cards: [{ kind: 'scene', title: 'Бухта', text: 'Фёдор находит лодку.', lane: 'Act II', links_to: ['Лодка за мысом'] }], note: 'Дорого.' });
        case 'canvas.guns':
          return JSON.stringify({ guns: [{ detail: 'одна перчатка', where: 'глава 1', payoff: 'вторая в бухте', confidence: 'high' }] });
        case 'canvas.collapse':
          return JSON.stringify({ chapters: [{ number: 1, title: 'Смена', line: 'Катер не пришёл.' }, { number: 2, title: 'Радио', line: 'Посёлок отвечает странно.' }] });
        case 'canvas.whatif':
          return JSON.stringify({ cards: [{ kind: 'branch', title: 'Если катер пришёл', text: 'Гость уезжает на нём.', links_to: [] }] });
        default:
          return '{}';
      }
    };
    const harness = await Harness.open(store.layout.root, { adapter: new ReplayAdapter({ mode: 'replay', responder }), resources });
    const canvas = new Canvas(store);
    const card = await canvas.addCard({ kind: 'twist', title: 'Лодка за мысом', text: 'Гость приплыл не один.' });
    const expand = await harness.canvasAction('expand', { cardId: card.id });
    expect((expand.result as { cards: unknown[] }).cards).toHaveLength(1);
    expect(expand.run.assembled.messages[0]!.content).toContain('«Лодка за мысом»');
    const guns = await harness.canvasAction('guns');
    expect((guns.result as { guns: Array<{ confidence: string }> }).guns[0]?.confidence).toBe('high');
    const collapse = await harness.canvasAction('collapse', { chapterCount: 2 });
    expect((collapse.result as { chapters: unknown[] }).chapters).toHaveLength(2);
    const whatif = await harness.canvasAction('whatif', { question: 'катер пришёл' });
    expect(whatif.run.assembled.messages[0]!.content).toContain('What if: катер пришёл');
    await expect(harness.canvasAction('expand', { cardId: 'missing' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const noModel = await Harness.open(store.layout.root, { adapter: new NoModelAdapter(), resources });
    await expect(noModel.canvasAction('guns')).rejects.toMatchObject({ code: 'ADAPTER_ERROR' });
  });
});
