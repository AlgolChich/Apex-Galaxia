import type { Language } from '../../api/types.js';

/**
 * Client-side mirrors of what the core does on import, so the dialog can show a preview
 * before anything is written: the entry names a Bible import would create, and the dossier
 * Markdown the research form builds.
 */

/** One `#` or `##` heading per entry, exactly as `splitEntries` in the core splits them. */
export function entryNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^#{1,2}\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

export interface DossierSource {
  url: string;
  title?: string;
  kind: 'other';
}

/** One source per line: the URL, then an optional title after the first space. */
export function parseSources(text: string): DossierSource[] {
  const sources: DossierSource[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const space = line.search(/\s/);
    const url = space === -1 ? line : line.slice(0, space);
    const title = space === -1 ? '' : line.slice(space).trim();
    sources.push({ url, ...(title ? { title } : {}), kind: 'other' });
  }
  return sources;
}

export interface DossierForm {
  topic: string;
  canonPoint: string;
  /** One source per line. */
  sources: string;
  /** The whole dossier is not confirmed in a second source. */
  unconfirmed: boolean;
  body: string;
}

/** The note written under `unconfirmed` when the Author marks the whole dossier; file content, in the story's language. */
const WHOLE_UNCONFIRMED: Record<Language, string> = {
  ru: 'всё досье: подтверждения во втором источнике нет',
  en: 'the whole dossier: not confirmed in a second source',
};

/** A JSON string literal is a valid YAML double-quoted scalar; no YAML library is needed for flat values. */
function scalar(value: string): string {
  return JSON.stringify(value);
}

export function hasFrontMatter(text: string): boolean {
  return /^\uFEFF?---\r?\n/.test(text);
}

/**
 * Build the dossier Markdown the core expects (`research_save`): front matter with topic,
 * canon_point, sources and unconfirmed, then a heading and the text as the Author gave it.
 */
export function buildDossier(form: DossierForm, language: Language): string {
  const topic = form.topic.trim();
  const canonPoint = form.canonPoint.trim();
  const sources = parseSources(form.sources);
  const lines = ['---', `topic: ${scalar(topic)}`];
  if (canonPoint) lines.push(`canon_point: ${scalar(canonPoint)}`);
  if (sources.length === 0) lines.push('sources: []');
  else {
    lines.push('sources:');
    for (const source of sources) {
      lines.push(`  - url: ${scalar(source.url)}`);
      if (source.title) lines.push(`    title: ${scalar(source.title)}`);
      lines.push('    kind: other');
    }
  }
  if (form.unconfirmed) lines.push('unconfirmed:', `  - ${scalar(`${topic}: ${WHOLE_UNCONFIRMED[language]}`)}`);
  else lines.push('unconfirmed: []');
  lines.push('---', '', `# ${topic}`, '', form.body.trim(), '');
  return lines.join('\n');
}
