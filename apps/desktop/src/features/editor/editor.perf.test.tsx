import { EditorView } from '@codemirror/view';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setClient } from '../../api/index.js';
import { useStore } from '../../state/store.js';
import { Editor } from './index.js';
import { findView, installMockClient, openChapter } from './test-helpers.js';
import { countWords } from './words.js';

const VOCAB = ['маяк', 'ветер', 'Фёдор', 'катер', 'причал', 'сваи', 'гудели', 'тетрадь', 'керосин', 'дизель', 'хлеб', 'сахар', 'окно', 'чайник', 'пальто', 'камни', 'север', 'утро', 'сказал', 'смотрел', 'ночь', 'дорога', 'пуговица', 'одеяло', 'койка', 'вода', 'песок', 'горизонт', 'ступенька', 'перчатка', 'кто-нибудь', 'ещё'];

/** Deterministic Russian prose: paragraphs of 40–90 words with «ёлочки» and em dashes. */
function russianText(words: number): string {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const paragraphs: string[] = [];
  let n = 0;
  while (n < words) {
    const length = 40 + Math.floor(rnd() * 50);
    const sentence: string[] = [];
    for (let i = 0; i < length && n < words; i += 1, n += 1) {
      let word = VOCAB[Math.floor(rnd() * VOCAB.length)] as string;
      if (i === 0) word = word.charAt(0).toUpperCase() + word.slice(1);
      if (rnd() < 0.05) word = `«${word}»`;
      sentence.push(word);
      if (rnd() < 0.08) sentence.push('—');
    }
    paragraphs.push(`${rnd() < 0.3 ? '— ' : ''}${sentence.join(' ')}.`);
  }
  return paragraphs.join('\n\n');
}

describe('Editor performance', () => {
  afterEach(() => {
    cleanup();
    setClient(undefined);
  });

  // jsdom is several times slower than a browser; the budget is generous for that reason.
  it('mounts a 100,000-word chapter under 1.5 s and renders only the viewport', () => {
    installMockClient();
    const body = russianText(100_000);
    expect(countWords(body)).toBeGreaterThanOrEqual(100_000);
    expect(body.length).toBeGreaterThan(600_000);
    openChapter(body);
    // loadChapter opens a chapter with the caret at its end; mirror that here.
    useStore.setState((s) => ({ editor: { ...s.editor, cursor: body.length, selection: { from: body.length, to: body.length } } }));

    const started = performance.now();
    const { container } = render(<Editor />);
    const mountMs = performance.now() - started;

    const content = container.querySelector('.cm-content');
    expect(content).toBeTruthy();
    const rendered = content?.textContent?.length ?? 0;
    expect(rendered).toBeGreaterThan(0);
    // Virtualization: the DOM holds a window around the viewport, never the whole manuscript.
    expect(rendered).toBeLessThan(body.length / 4);
    expect(mountMs).toBeLessThan(1500);

    // Scrolling to the other end and typing there stay cheap too.
    const view = findView(container);
    const again = performance.now();
    act(() => view.dispatch({ effects: EditorView.scrollIntoView(0, { y: 'center' }), selection: { anchor: 0 } }));
    act(() => view.dispatch({ changes: { from: 0, insert: 'Начало. ' }, selection: { anchor: 8 }, userEvent: 'input.type' }));
    expect(performance.now() - again).toBeLessThan(500);
    expect(view.state.doc.length).toBe(body.length + 8);
  });
});
