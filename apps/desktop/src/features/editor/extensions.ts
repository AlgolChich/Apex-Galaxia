import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, scrollPastEnd, type DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { LintHit } from '../../api/types.js';
import { translate, type UiLanguage } from '../../i18n/index.js';

// ---- theme: everything from the design tokens, nothing hard-coded ---------------------------

/** The prose surface: serif, measured, centered, no gutters. Colors come from tokens.css. */
export const proseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-prose)',
    fontSize: 'var(--prose-size)',
    lineHeight: 'var(--prose-leading)',
    overflow: 'auto',
    cursor: 'text',
  },
  '.cm-content': {
    maxWidth: 'var(--prose-measure)',
    width: '100%',
    margin: '0 auto',
    padding: '3rem 1.5rem 40vh',
    caretColor: 'var(--fg)',
    fontVariantLigatures: 'common-ligatures',
    fontKerning: 'normal',
    hyphens: 'manual',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-gutters': { display: 'none' },
  '.cm-panels': {
    backgroundColor: 'var(--bg-elev)',
    color: 'var(--fg)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-base)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '0.4rem 0.75rem' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontFamily: 'var(--font-ui)',
    fontSize: '0.9em',
    color: 'var(--fg)',
    background: 'var(--bg)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius)',
    padding: '0.2em 0.5em',
    margin: '0.1em 0.15em',
  },
  '.cm-panel.cm-search button': { backgroundImage: 'none', textTransform: 'none' },
  '.cm-panel.cm-search label': { fontSize: '0.9em', color: 'var(--fg-muted)' },
  '.cm-panel.cm-search [name="close"]': { color: 'var(--fg-muted)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--selection)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-elev)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-base)',
    lineHeight: '1.4',
  },
  '.cm-tooltip-arrow:before': { borderTopColor: 'var(--border)' },
  '.cm-tooltip-arrow:after': { borderTopColor: 'var(--bg-elev)' },
});

/** Markdown structure rendered as typography: headings larger, marks faint, emphasis real. */
export const proseHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontSize: '1.45em', fontWeight: '600', lineHeight: '1.3' },
    { tag: tags.heading2, fontSize: '1.25em', fontWeight: '600', lineHeight: '1.35' },
    { tag: tags.heading3, fontSize: '1.12em', fontWeight: '600' },
    { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
    { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta, tags.labelName], color: 'var(--fg-faint)' },
    { tag: [tags.link, tags.url], color: 'var(--accent)' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  ]),
);

// ---- typewriter scrolling ------------------------------------------------------------------

/**
 * Keep the line the Author types on vertically centered. Only the Author's own edits and
 * keyboard moves scroll; mouse clicks and programmatic changes leave the viewport alone.
 */
export const typewriterScrolling: Extension = [
  EditorState.transactionExtender.of((tr) => {
    const userEvent = tr.annotation(Transaction.userEvent);
    if (!userEvent) return null;
    const keyboardMove = tr.selection !== undefined && userEvent.startsWith('select') && !userEvent.startsWith('select.pointer');
    if (!tr.docChanged && !keyboardMove) return null;
    return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) };
  }),
  scrollPastEnd(),
];

// ---- lint underlines -------------------------------------------------------------------------

/** Replace the lint underlines with the hits of a fresh report (offsets into the body). */
export const setLintHits = StateEffect.define<readonly LintHit[]>();

interface LintMarkSpec {
  class: string;
  attributes: Record<string, string>;
  hit: LintHit;
}

function buildLintDecorations(hits: readonly LintHit[], length: number): DecorationSet {
  const ranges = [];
  for (const hit of hits) {
    const from = Math.max(0, Math.min(hit.start, length));
    const to = Math.min(hit.end, length);
    if (to <= from) continue;
    const spec: LintMarkSpec = {
      class: `editor-lint editor-lint--${hit.severity}`,
      attributes: { 'data-rule': hit.rule, 'data-severity': hit.severity },
      hit,
    };
    ranges.push(Decoration.mark(spec).range(from, to));
  }
  return Decoration.set(ranges, true);
}

/** Underlines mapped through edits until the next report replaces them. */
export const lintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setLintHits)) next = buildLintDecorations(effect.value, tr.newDoc.length);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface LintHitAt {
  from: number;
  to: number;
  hit: LintHit;
}

/** The underlined hit under a document position, if any. */
export function lintHitAt(state: EditorState, pos: number): LintHitAt | null {
  const field = state.field(lintField, false);
  if (!field) return null;
  let found: LintHitAt | null = null;
  field.between(pos, pos, (from, to, value) => {
    const hit = (value.spec as Partial<LintMarkSpec>).hit;
    if (hit && from <= pos && pos <= to) {
      found = { from, to, hit };
      return false;
    }
    return undefined;
  });
  return found;
}

/** Hover tooltip over a lint underline; `render` builds the DOM (message, rule, whitelist). */
export function lintHover(render: (hit: LintHit) => HTMLElement): Extension {
  return hoverTooltip(
    (view, pos) => {
      const found = lintHitAt(view.state, pos);
      if (!found) return null;
      return { pos: found.from, end: found.to, above: true, create: () => ({ dom: render(found.hit) }) };
    },
    { hoverTime: 200 },
  );
}

// ---- search panel phrases ------------------------------------------------------------------

/** CodeMirror's own panels (search, go to line) in the UI language. */
export function searchPhrases(language: UiLanguage): Extension {
  if (language === 'en') return [];
  const t = (key: string) => translate(language, key);
  return EditorState.phrases.of({
    Find: t('editor.cm.find'),
    Replace: t('editor.cm.replace'),
    next: t('editor.cm.next'),
    previous: t('editor.cm.previous'),
    all: t('editor.cm.all'),
    'match case': t('editor.cm.matchCase'),
    'by word': t('editor.cm.byWord'),
    regexp: t('editor.cm.regexp'),
    replace: t('editor.cm.replaceOne'),
    'replace all': t('editor.cm.replaceAll'),
    close: t('editor.cm.close'),
    'current match': t('editor.cm.currentMatch'),
    'replaced $ matches': t('editor.cm.replacedMatches'),
    'replaced match on line $': t('editor.cm.replacedOnLine'),
    'on line': t('editor.cm.onLine'),
    'Go to line': t('editor.cm.gotoLine'),
    go: t('editor.cm.go'),
  });
}
