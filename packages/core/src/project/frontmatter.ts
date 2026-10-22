import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ApexError } from '../util/errors.js';

export interface FrontMatterDocument<T = Record<string, unknown>> {
  data: T;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Split a Markdown file into YAML front matter and body. A file without front matter
 * yields an empty object; a file whose front matter is not valid YAML is an INVALID_FILE.
 */
export function parseFrontMatter<T = Record<string, unknown>>(
  text: string,
  file = '<memory>',
): FrontMatterDocument<T> {
  const normalized = text.startsWith('﻿') ? text.slice(1) : text;
  const match = FENCE.exec(normalized);
  if (!match) {
    return { data: {} as T, body: normalized };
  }
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? '') ?? {};
  } catch (error) {
    throw new ApexError('INVALID_FILE', `Front matter in ${file} is not valid YAML`, {
      file,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ApexError('INVALID_FILE', `Front matter in ${file} must be a YAML mapping`, { file });
  }
  // serializeFrontMatter writes one blank line after the fence; drop it so a round trip is stable.
  return { data: data as T, body: normalized.slice(match[0].length).replace(/^\r?\n/, '') };
}

/** Serialize front matter + body. Keys keep insertion order so diffs stay readable. */
export function serializeFrontMatter(data: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(data, { lineWidth: 0 }).trimEnd();
  const trimmedBody = body.replace(/^\r?\n+/, '');
  return `---\n${yaml}\n---\n\n${trimmedBody.endsWith('\n') ? trimmedBody : trimmedBody + '\n'}`;
}

/**
 * Split a Markdown body into sections by `## Heading`. The text before the first heading
 * is returned under the empty key. Heading matching is case-insensitive on lookup.
 */
export function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let current = '';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (current !== '' || text !== '') {
      sections.set(current, text);
    }
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1] ?? '';
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

export function getSection(sections: Map<string, string>, ...names: string[]): string | undefined {
  const wanted = names.map((n) => n.toLowerCase());
  for (const [key, value] of sections) {
    if (wanted.includes(key.toLowerCase())) {
      return value;
    }
  }
  return undefined;
}
