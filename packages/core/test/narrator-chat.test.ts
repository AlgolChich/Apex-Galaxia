import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Harness, createProject, loadNarrator, matchNarratorCommand, parseChatAction, resolveResources, type Resources } from '@apex-galaxia/core';
import { ReplayAdapter, scriptedResponder } from '@apex-galaxia/adapters';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let dir: string;
let resources: Resources;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-chat-'));
  resources = await resolveResources({ root: repoRoot, userDir: path.join(dir, 'home') });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('narrator commands', () => {
  it('recognizes slash commands and bare command words in both languages, with arguments', async () => {
    const { commands } = await loadNarrator(resources);
    expect(matchNarratorCommand('/дальше', commands)).toEqual({ id: 'next', argument: '' });
    expect(matchNarratorCommand('next', commands)).toEqual({ id: 'next', argument: '' });
    expect(matchNarratorCommand('Дальше.', commands)).toEqual({ id: 'next', argument: '' });
    expect(matchNarratorCommand('/судьба 5', commands)).toEqual({ id: 'harshness', argument: '5' });
    expect(matchNarratorCommand('рассказчик Рэнди', commands)).toEqual({ id: 'storyteller', argument: 'Рэнди' });
    expect(matchNarratorCommand('/переписать последнюю сцену короче', commands)).toEqual({ id: 'rewrite', argument: 'последнюю сцену короче' });
    expect(matchNarratorCommand('/летопись', commands)).toEqual({ id: 'chronicle', argument: '' });
    expect(matchNarratorCommand('дальше по улице шёл дождь', commands)).toBeUndefined();
    expect(matchNarratorCommand('что думаешь о Грише?', commands)).toBeUndefined();
    expect(matchNarratorCommand('', commands)).toBeUndefined();
  });

  it('parses and strips a trailing action line, ignoring unknown ids', async () => {
    const { commands } = await loadNarrator(resources);
    expect(parseChatAction('Иду за главой.\n>> action: next', commands)).toEqual({ reply: 'Иду за главой.', action: { id: 'next', argument: '' } });
    expect(parseChatAction('Ставлю пятёрку.\n>> action: harshness 5', commands)).toEqual({ reply: 'Ставлю пятёрку.', action: { id: 'harshness', argument: '5' } });
    expect(parseChatAction('Просто ответ.\n>> action: explode', commands)).toEqual({ reply: 'Просто ответ.\n>> action: explode' });
    expect(parseChatAction('Без действия.', commands)).toEqual({ reply: 'Без действия.' });
  });
});

describe('chat, candidates and A/B through the harness (scripted model)', () => {
  async function harness() {
    const root = path.join(dir, 'story');
    const store = await createProject(root, { title: 'Штрек', language: 'ru', idea: 'Грузовик ночью.', preset: 'fast' });
    await store.createChapter(1, 'Фары', 'Бабка Нюра не уходила.\n');
    return Harness.open(root, { adapter: new ReplayAdapter({ mode: 'replay', responder: scriptedResponder() }), resources });
  }

  it('answers outside the story and returns the action the Author asked for', async () => {
    const h = await harness();
    const deltas: string[] = [];
    const turn = await h.chat({ message: 'дальше', uiLanguage: 'ru', onDelta: (d) => deltas.push(d) });
    expect(turn.action).toEqual({ id: 'next', argument: '' });
    expect(turn.reply).toContain('Автор');
    expect(turn.reply).not.toContain('>> action');
    expect(deltas.join('')).toContain('>> action: next');
    const idle = await h.chat({ message: 'что думаешь про Гришу?', uiLanguage: 'en', history: [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'Здравствуйте, Автор.' }] });
    expect(idle.action).toBeUndefined();
    expect(idle.reply.length).toBeGreaterThan(10);
    expect(idle.run.assembled.messages[0]?.content).toContain('Author: привет');
    expect(idle.run.assembled.messages[0]?.content).toContain('Title: Штрек');
  });

  it('drafts candidates separately, ranks them by the critic and records the Author\'s choice', async () => {
    const h = await harness();
    const steps: string[] = [];
    const outcome = await h.writeCandidates('continue', { chapter: await h.store.getChapter(1), count: 2, onCandidate: (d, t) => steps.push(`${d}/${t}`) });
    expect(steps).toEqual(['1/2', '2/2']);
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.candidates[0]?.text).not.toBe(outcome.candidates[1]?.text);
    expect(outcome.candidates.every((c) => c.suggestion.front.status === 'pending')).toBe(true);
    expect(outcome.candidates.every((c) => c.critic?.verdict === 'pass' && c.score !== null)).toBe(true);
    expect(outcome.ranking).toHaveLength(2);
    expect(outcome.costUsd).toBeGreaterThan(0);
    expect((await h.store.listSuggestions()).filter((s) => s.front.status === 'pending')).toHaveLength(2);
    expect((await h.store.getChapter(1)).body).toBe('Бабка Нюра не уходила.\n');

    const [a, b] = outcome.candidates;
    const record = await h.recordAb({ left: a!.suggestion.front.id, right: b!.suggestion.front.id, choice: 'right', criticPreferred: 'left', note: 'the second one breathes' });
    expect(record.agreed).toBe(false);
    const tie = await h.recordAb({ left: a!.suggestion.front.id, right: b!.suggestion.front.id, choice: 'tie' });
    expect(tie.agreed).toBeNull();
    const all = await h.listAb();
    expect(all).toHaveLength(2);
    expect(all[0]?.note).toBe('the second one breathes');
    await h.accept(b!.suggestion.front.id);
    await h.discard(a!.suggestion.front.id);
    expect((await h.store.getChapter(1)).body).toContain(b!.text.slice(0, 20));
  });
});
