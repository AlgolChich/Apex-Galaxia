import { create } from 'zustand';

export type ImportKind = 'manuscript' | 'bible' | 'dossier';
export type ImportTarget = 'new' | 'open';

/** What a finished import reports to whoever opened the dialog (the wizard continues on it). */
export interface ImportOutcome {
  kind: ImportKind;
  /** Manuscript: the project the chapters went to. */
  root?: string;
  /** Dossier: the saved file. */
  path?: string;
  /** Chapters, entries or files written. */
  count: number;
}

export interface ImportRequest {
  kind: ImportKind;
  /** Manuscript: the preselected target; the first-run wizard asks for a new project. */
  target?: ImportTarget;
  /** Called once after a successful import, before the dialog closes. */
  onDone?: (outcome: ImportOutcome) => void;
}

export interface ImportState {
  request: (ImportRequest & { nonce: number }) | undefined;
  /** A call is running: Escape and the backdrop do not close the dialog meanwhile. */
  busy: boolean;
  /** Bumped after a Bible import or a saved dossier so the Bible view reloads. */
  bibleVersion: number;
  /** Dossiers saved in this session (paths, newest first): there is no list tool for bible/research/. */
  dossiers: string[];
  open(request: ImportRequest): void;
  close(): void;
  setBusy(busy: boolean): void;
  recordBible(): void;
  recordDossier(path: string): void;
}

/** The window event the palette, the welcome screen and the Bible view dispatch: `detail: { kind }`. */
export const IMPORT_EVENT = 'apex:import';

let nonce = 0;

/**
 * The import feature's own small store (the global store stays untouched): which import
 * dialog is open and with what request, plus what this session imported.
 */
export const useImportStore = create<ImportState>((set) => ({
  request: undefined,
  busy: false,
  bibleVersion: 0,
  dossiers: [],

  open(request) {
    nonce += 1;
    set({ request: { ...request, nonce }, busy: false });
  },

  close() {
    set({ request: undefined, busy: false });
  },

  setBusy(busy) {
    set({ busy });
  },

  recordBible() {
    set((s) => ({ bibleVersion: s.bibleVersion + 1 }));
  },

  recordDossier(path) {
    set((s) => ({ bibleVersion: s.bibleVersion + 1, dossiers: [path, ...s.dossiers.filter((p) => p !== path)] }));
  },
}));

/** Open the import dialog directly (features that need a callback; the event carries only a kind). */
export function openImport(request: ImportRequest): void {
  useImportStore.getState().open(request);
}

export function isImportKind(value: unknown): value is ImportKind {
  return value === 'manuscript' || value === 'bible' || value === 'dossier';
}
