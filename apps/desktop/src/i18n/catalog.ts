import { common } from './common.js';
import { strings as describeStrings } from '../features/describe/strings.js';
import { strings as diffStrings } from '../features/diff/strings.js';
import { strings as editorStrings } from '../features/editor/strings.js';
import { strings as layoutStrings } from '../features/layout/strings.js';
import { strings as paletteStrings } from '../features/palette/strings.js';
import { strings as panelsStrings } from '../features/panels/strings.js';
import { strings as settingsStrings } from '../features/settings/strings.js';
import { strings as suggestionStrings } from '../features/suggestion/strings.js';
import { strings as treeStrings } from '../features/tree/strings.js';
import { strings as viewsStrings } from '../features/views/strings.js';
import { strings as wizardStrings } from '../features/wizard/strings.js';
import { strings as chronicleUpdateStrings } from '../features/chronicle-update/strings.js';
import { strings as chatStrings } from '../features/chat/strings.js';
import { strings as canvasStrings } from '../features/canvas/strings.js';
import { strings as candidatesStrings } from '../features/candidates/strings.js';
import { strings as importStrings } from '../features/import/strings.js';

type Table = Record<string, string>;
interface Bundle {
  ru: Table;
  en: Table;
}

const BUNDLES: Bundle[] = [common, layoutStrings, editorStrings, treeStrings, paletteStrings, suggestionStrings, diffStrings, describeStrings, panelsStrings, wizardStrings, viewsStrings, settingsStrings, chronicleUpdateStrings, chatStrings, canvasStrings, candidatesStrings, importStrings];

function merge(language: 'ru' | 'en'): Table {
  const out: Table = {};
  for (const bundle of BUNDLES) Object.assign(out, bundle[language]);
  return out;
}

/** Every UI string, merged per language. Features own their `strings.ts`; this file only lists them. */
export const CATALOG: { ru: Table; en: Table } = { ru: merge('ru'), en: merge('en') };

export type StringKey = keyof typeof common.en;
