import path from 'node:path';
import { z } from 'zod';
import { ApexError } from '../util/errors.js';
import { parseFrontMatter } from '../project/frontmatter.js';
import { resolveDataFile, readDataFile, type Resources } from '../resources.js';
import type { Language } from '../project/schemas.js';
import { LessonCategorySchema, ModelRoleSchema } from '../project/schemas.js';

const TemplateFrontSchema = z.object({
  task: z.string().min(1),
  kind: z.enum(['prose', 'planning', 'critique', 'extraction', 'summary', 'lint']),
  role: ModelRoleSchema,
  output: z.string().regex(/^(prose|markdown|yaml|json:[a-z0-9-]+)$/),
  lessons: z.array(LessonCategorySchema).default([]),
  /** Name of the output-contract template placed in the system prompt (Section 10.2, layer 4). */
  contract: z.string().optional(),
  contract_only: z.boolean().default(false),
});

export interface PromptTemplate {
  task: string;
  kind: z.infer<typeof TemplateFrontSchema>['kind'];
  role: z.infer<typeof TemplateFrontSchema>['role'];
  output: string;
  /** Schema name when output is `json:<schema>`. */
  jsonSchemaName: string | undefined;
  lessons: z.infer<typeof TemplateFrontSchema>['lessons'];
  contract: string | undefined;
  /** Body with partials expanded but placeholders intact. */
  body: string;
  /** Placeholders found in the body, without braces. */
  placeholders: string[];
  source: string;
}

const PARTIAL = /\{\{>\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export class PromptLibrary {
  private readonly cache = new Map<string, PromptTemplate>();

  constructor(private readonly resources: Resources) {}

  /** Load prompts/<task>.md (user override in ~/.apex-galaxia/prompts/ wins). */
  async get(task: string): Promise<PromptTemplate> {
    const cached = this.cache.get(task);
    if (cached) return cached;
    const rel = path.join('prompts', `${task}.md`);
    const file = await resolveDataFile(this.resources, rel);
    if (!file) {
      throw new ApexError('TEMPLATE_NOT_FOUND', `Prompt template ${task} not found (${rel})`, { task });
    }
    const text = await readDataFile(this.resources, rel);
    const doc = parseFrontMatter(text, rel);
    const front = TemplateFrontSchema.safeParse(doc.data);
    if (!front.success) {
      throw new ApexError('INVALID_FILE', `${rel} has invalid front matter: ${front.error.issues.map((i) => i.message).join('; ')}`);
    }
    let body = doc.body.trim();
    const seen = new Set<string>([task]);
    body = await this.expandPartials(body, seen);
    const placeholders = [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
    const template: PromptTemplate = {
      task: front.data.task,
      kind: front.data.kind,
      role: front.data.role,
      output: front.data.output,
      jsonSchemaName: front.data.output.startsWith('json:') ? front.data.output.slice(5) : undefined,
      lessons: front.data.lessons,
      contract: front.data.contract,
      body,
      placeholders,
      source: file,
    };
    this.cache.set(task, template);
    return template;
  }

  private async expandPartials(body: string, seen: Set<string>): Promise<string> {
    const matches = [...body.matchAll(PARTIAL)];
    let out = body;
    for (const match of matches) {
      const name = match[1]!;
      if (seen.has(name)) {
        throw new ApexError('INVALID_FILE', `Prompt partial cycle at ${name}`);
      }
      const partial = await this.get(name);
      out = out.replace(match[0], partial.body);
    }
    return out;
  }

  /** The language module for a story language, with its own placeholders filled. */
  async languageModule(language: Language, vars: Record<string, string>): Promise<string> {
    const text = await readDataFile(this.resources, path.join('prompts', 'lang', `${language}.md`));
    return fill(text.trim(), vars, `lang/${language}`);
  }
}

/** Fill placeholders; a missing value is an error so a broken prompt never reaches the model. */
export function fill(body: string, vars: Record<string, string>, where = 'template'): string {
  return body.replace(PLACEHOLDER, (_whole, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new ApexError('INVALID_ARGUMENT', `Missing placeholder {{${key}}} for ${where}`, { key, where });
    }
    return value;
  });
}

export function renderTemplate(template: PromptTemplate, vars: Record<string, string>): string {
  return fill(template.body, vars, template.task);
}

export const LANGUAGE_NAMES: Record<Language, string> = { ru: 'Russian', en: 'English' };
