import { describe, expect, it } from 'vitest';
import { normalizeRussianDialogue } from '@apex-galaxia/core';

describe('Russian dialogue punctuation normalizer', () => {
  it('turns quoted speech and hyphen dialogue into em-dash lines', () => {
    const { text, changes } = normalizeRussianDialogue('"Ты один?" — спросила она.\n\n- Второй грузовик не пришёл.\n\n—Кофе сгорел, — сказала она.\n\n«Я пойду.» — сказал он.\n\n"Подожди" — сказала она.');
    expect(text).toBe('— Ты один? — спросила она.\n\n— Второй грузовик не пришёл.\n\n— Кофе сгорел, — сказала она.\n\n— Я пойду, — сказал он.\n\n— Подожди, — сказала она.');
    expect(changes).toHaveLength(5);
  });

  it('replaces a full stop before attribution with a comma, and only for attribution verbs', () => {
    const { text, changes } = normalizeRussianDialogue('— Я пойду. — сказал он.\n\n— Я пойду. — Он встал.');
    expect(text).toBe('— Я пойду, — сказал он.\n\n— Я пойду. — Он встал.');
    expect(changes).toEqual(['line 1: comma before «сказал»']);
  });

  it('leaves correct text and narration untouched', () => {
    const correct = 'Насос завёлся с третьего раза.\n\n— Вы Фёдор Ильич, — сказал он.\n\nФёдор не ответил — и правильно сделал.';
    const { text, changes } = normalizeRussianDialogue(correct);
    expect(text).toBe(correct);
    expect(changes).toEqual([]);
  });

  it('does not treat a quoted title inside narration as speech', () => {
    const line = 'На обложке стояло «Враги», и он отложил книгу.';
    expect(normalizeRussianDialogue(line).text).toBe(line);
  });
});
