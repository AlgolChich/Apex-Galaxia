import path from 'node:path';
import { ApexError } from '../util/errors.js';
import { slugify } from '../util/slug.js';
import { parseFrontMatter } from '../project/frontmatter.js';
import { ResearchFrontMatterSchema, type ResearchFrontMatter } from '../project/schemas.js';
import type { ProjectStore } from '../project/store.js';

/**
 * Lines that read as instructions to a model have no place in a dossier (Section 10.9).
 * The filter is deliberately narrow: it removes directive sentences aimed at an assistant,
 * never ordinary prose about the story.
 */
const DIRECTIVE = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/iu,
  /\byou\s+are\s+now\s+(?:a|an|the)\b/iu,
  /\b(?:system|developer)\s+prompt\b/iu,
  /\bas\s+an\s+ai\s+(?:language\s+)?model\b/iu,
  /\b(?:do\s+not|don't|never)\s+(?:follow|obey|listen\s+to)\s+(?:the\s+)?(?:author|user|human)/iu,
  /игнорируй(?:те)?\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние)\s+(?:инструкции|указания)/iu,
  /ты\s+теперь\s+(?:не\s+)?(?:помощник|ассистент|модель)/iu,
];

export function sanitizeResearch(markdown: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (DIRECTIVE.some((re) => re.test(line))) {
      removed.push(line.trim());
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join('\n'), removed };
}

export interface SavedResearch {
  path: string;
  topic: string;
  front: ResearchFrontMatter;
  removed: string[];
}

/** Validate a dossier's front matter, strip directives, and store it under bible/research/. */
export async function saveResearch(store: ProjectStore, markdown: string, topicHint?: string): Promise<SavedResearch> {
  const { text, removed } = sanitizeResearch(markdown);
  const doc = parseFrontMatter(text, 'research');
  const data = { ...doc.data } as Record<string, unknown>;
  if (!data['topic'] && topicHint) data['topic'] = topicHint;
  const parsed = ResearchFrontMatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new ApexError('INVALID_FILE', `Research front matter is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const file = path.join(store.layout.bible.research, `${slugify(parsed.data.topic)}.md`);
  await store.writeMarkdown(file, ResearchFrontMatterSchema, parsed.data, doc.body);
  return { path: file, topic: parsed.data.topic, front: parsed.data, removed };
}
