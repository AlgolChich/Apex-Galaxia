import { create } from 'zustand';
import { useStore } from '../../state/store.js';

/**
 * The Author's edits to the pending suggestion, kept outside the component so the global
 * accept shortcut (Ctrl/Cmd+Shift+Enter, a palette action) sends the edited text too.
 */
export interface AcceptedMark {
  id: string;
  chapter: number | undefined;
  /** The chapter stem the suggestion landed in; the offer disappears when the Author leaves it. */
  stem: string | undefined;
}

interface DraftState {
  id: string | undefined;
  text: string;
  /** The last accepted suggestion, until the chronicle offer is dismissed or acted on. */
  accepted: AcceptedMark | undefined;
  setDraft(id: string, text: string): void;
  clear(): void;
  markAccepted(mark: AcceptedMark): void;
  clearAccepted(): void;
}

export const useSuggestionDraft = create<DraftState>((set) => ({
  id: undefined,
  text: '',
  accepted: undefined,
  setDraft(id, text) {
    set({ id, text });
  },
  clear() {
    set({ id: undefined, text: '' });
  },
  markAccepted(accepted) {
    set({ accepted });
  },
  clearAccepted() {
    set({ accepted: undefined });
  },
}));

/** The text to pass to `acceptSuggestion`: the draft when it differs from the original, else nothing. */
export function editedTextFor(id: string, original: string): string | undefined {
  const draft = useSuggestionDraft.getState();
  return draft.id === id && draft.text !== original ? draft.text : undefined;
}

/**
 * Accept the pending suggestion (with the Author's edits) through the store and, when it
 * landed, remember it so the suggestion block can offer the chronicle update. Shared by the
 * block's Accept button and the Ctrl/Cmd+Shift+Enter palette action.
 */
export async function acceptPending(): Promise<void> {
  const app = useStore.getState();
  const pending = app.suggestion.pending;
  if (!pending) return;
  await app.acceptSuggestion(editedTextFor(pending.front.id, pending.text));
  const after = useStore.getState();
  if (after.suggestion.pending?.front.id === pending.front.id) return; // the accept failed; the store showed why
  useSuggestionDraft.getState().markAccepted({ id: pending.front.id, chapter: pending.chapterNumber, stem: after.editor.stem });
}
