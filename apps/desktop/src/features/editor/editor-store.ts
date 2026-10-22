import { create } from 'zustand';

const KEY = 'apex.editor';

interface Persisted {
  typewriter?: boolean;
}

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function write(value: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // private mode or a test environment without storage
  }
}

/** Editor preferences that other features read (the status bar indicator, the palette). */
export interface EditorSettings {
  /** Keep the cursor line vertically centered while typing. Persisted per machine. */
  typewriter: boolean;
  setTypewriter(on?: boolean): void;
}

export const useEditorSettings = create<EditorSettings>((set, get) => ({
  typewriter: read().typewriter ?? false,
  setTypewriter(on) {
    const typewriter = on ?? !get().typewriter;
    write({ typewriter });
    set({ typewriter });
  },
}));
