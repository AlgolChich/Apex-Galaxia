import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { z } from 'zod';
import { ApexError } from '../util/errors.js';
import {
  appendLine,
  countWords,
  exists,
  isoNow,
  listFiles,
  readTextIfExists,
  shortId,
  writeTextAtomic,
} from '../util/fs.js';
import { chapterFileStem } from '../util/slug.js';
import { parseFrontMatter, serializeFrontMatter } from './frontmatter.js';
import { PROJECT_FILE, projectLayout, type ProjectLayout } from './layout.js';
import { migrateProject, parseProjectYaml } from './migrations.js';
import {
  CallRecordSchema,
  ChapterFrontMatterSchema,
  ProjectConfigSchema,
  SuggestionFrontMatterSchema,
  type CallRecord,
  type ChapterFrontMatter,
  type ProjectConfig,
  type SuggestionFrontMatter,
} from './schemas.js';

export interface ChapterFile {
  path: string;
  /** File stem such as `01-old-friends`. */
  stem: string;
  front: ChapterFrontMatter;
  body: string;
}

export interface SuggestionFile {
  path: string;
  front: SuggestionFrontMatter;
  body: string;
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Drop keys whose value is undefined so YAML output never shows `key: null` by accident. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * File access for one story project. Every read validates against the schema of the file
 * type; every write validates first and refuses to persist an invalid file. Chapters are only
 * written through `saveChapter`, which clients call on an explicit accept.
 */
export class ProjectStore {
  readonly layout: ProjectLayout;
  config: ProjectConfig;

  private constructor(layout: ProjectLayout, config: ProjectConfig) {
    this.layout = layout;
    this.config = config;
  }

  static async isProject(root: string): Promise<boolean> {
    return exists(path.join(root, PROJECT_FILE));
  }

  /** Open an existing project, migrating it forward if its format is older. */
  static async open(root: string): Promise<ProjectStore> {
    const layout = projectLayout(root);
    const text = await readTextIfExists(layout.projectFile);
    if (text === undefined) {
      throw new ApexError('PROJECT_NOT_FOUND', `No ${PROJECT_FILE} in ${layout.root}`, {
        root: layout.root,
      });
    }
    const raw = parseProjectYaml(text);
    const { config } = await migrateProject(layout.root, raw);
    return new ProjectStore(layout, ProjectStore.validateConfig(config));
  }

  static validateConfig(raw: unknown): ProjectConfig {
    const parsed = ProjectConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApexError('INVALID_FILE', `project.yaml is invalid: ${formatIssues(parsed.error.issues)}`, {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /** Used by the scaffolder after it has written project.yaml. */
  static async attach(root: string, config: ProjectConfig): Promise<ProjectStore> {
    return new ProjectStore(projectLayout(root), config);
  }

  async saveConfig(): Promise<void> {
    const valid = ProjectStore.validateConfig(this.config);
    await writeTextAtomic(this.layout.projectFile, stringifyYaml(compact(valid), { lineWidth: 0 }));
  }

  // -------------------------------------------------------------------------
  // Validated YAML and Markdown
  // -------------------------------------------------------------------------

  async readYaml<S extends z.ZodType>(file: string, schema: S): Promise<z.infer<S> | undefined> {
    const text = await readTextIfExists(file);
    if (text === undefined) {
      return undefined;
    }
    let data: unknown;
    try {
      data = parseYaml(text) ?? {};
    } catch (error) {
      throw new ApexError('INVALID_FILE', `${this.rel(file)} is not valid YAML`, {
        file: this.rel(file),
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return this.validate(schema, data, file);
  }

  async writeYaml<S extends z.ZodType>(file: string, schema: S, value: unknown): Promise<void> {
    const valid = this.validate(schema, value, file);
    const plain = typeof valid === 'object' && valid !== null ? compact(valid as Record<string, unknown>) : valid;
    await writeTextAtomic(file, stringifyYaml(plain, { lineWidth: 0 }));
  }

  async readMarkdown<S extends z.ZodType>(
    file: string,
    schema: S,
  ): Promise<{ front: z.infer<S>; body: string } | undefined> {
    const text = await readTextIfExists(file);
    if (text === undefined) {
      return undefined;
    }
    const doc = parseFrontMatter(text, this.rel(file));
    return { front: this.validate(schema, doc.data, file), body: doc.body };
  }

  async writeMarkdown<S extends z.ZodType>(file: string, schema: S, front: unknown, body: string): Promise<void> {
    const valid = this.validate(schema, front, file);
    await writeTextAtomic(file, serializeFrontMatter(compact(valid as Record<string, unknown>), body));
  }

  validate<S extends z.ZodType>(schema: S, data: unknown, file: string): z.infer<S> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ApexError('INVALID_FILE', `${this.rel(file)} is invalid: ${formatIssues(parsed.error.issues)}`, {
        file: this.rel(file),
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  rel(file: string): string {
    return path.relative(this.layout.root, file) || '.';
  }

  async readText(file: string): Promise<string | undefined> {
    return readTextIfExists(file);
  }

  async writeText(file: string, text: string): Promise<void> {
    await writeTextAtomic(file, text);
  }

  // -------------------------------------------------------------------------
  // Chapters
  // -------------------------------------------------------------------------

  async listChapters(): Promise<ChapterFile[]> {
    const files = await listFiles(this.layout.chapters, '.md');
    const chapters: ChapterFile[] = [];
    for (const file of files) {
      const doc = await this.readMarkdown(file, ChapterFrontMatterSchema);
      if (doc) {
        chapters.push({ path: file, stem: path.basename(file, '.md'), front: doc.front, body: doc.body });
      }
    }
    chapters.sort((a, b) => a.front.number - b.front.number);
    return chapters;
  }

  /** Find a chapter by number, by file stem, or by file path. */
  async getChapter(ref: number | string): Promise<ChapterFile> {
    const chapters = await this.listChapters();
    const found =
      typeof ref === 'number'
        ? chapters.find((c) => c.front.number === ref)
        : chapters.find((c) => c.stem === ref || c.path === path.resolve(ref) || path.basename(c.path) === ref);
    if (!found) {
      throw new ApexError('CHAPTER_NOT_FOUND', `Chapter ${ref} not found`, { ref });
    }
    return found;
  }

  async createChapter(
    number: number,
    title: string,
    body = '',
    extra: Partial<ChapterFrontMatter> = {},
  ): Promise<ChapterFile> {
    const existing = (await this.listChapters()).find((c) => c.front.number === number);
    if (existing) {
      throw new ApexError('INVALID_ARGUMENT', `Chapter ${number} already exists (${existing.stem})`, {
        number,
      });
    }
    const stem = chapterFileStem(number, title);
    const file = path.join(this.layout.chapters, `${stem}.md`);
    const front: ChapterFrontMatter = ChapterFrontMatterSchema.parse(
      compact({ ...extra, number, title, words: countWords(body) }),
    );
    await this.writeMarkdown(file, ChapterFrontMatterSchema, front, body);
    return { path: file, stem, front, body };
  }

  /**
   * Persist a chapter body. This is the only place the harness changes a chapter, and clients
   * call it only after the Author accepted a suggestion or edited the text themselves.
   */
  async saveChapter(chapter: ChapterFile, body: string, front: Partial<ChapterFrontMatter> = {}): Promise<ChapterFile> {
    const merged = ChapterFrontMatterSchema.parse(compact({ ...chapter.front, ...front, words: countWords(body) }));
    await this.writeMarkdown(chapter.path, ChapterFrontMatterSchema, merged, body);
    return { ...chapter, front: merged, body };
  }

  // -------------------------------------------------------------------------
  // Suggestions and history
  // -------------------------------------------------------------------------

  async writeSuggestion(front: Omit<SuggestionFrontMatter, 'id' | 'created' | 'status'> & Partial<SuggestionFrontMatter>, body: string): Promise<SuggestionFile> {
    const full = SuggestionFrontMatterSchema.parse(
      compact({ id: shortId('sug'), created: isoNow(), status: 'pending', ...front }),
    );
    const file = path.join(this.layout.history.suggestions, `${full.id}.md`);
    await this.writeMarkdown(file, SuggestionFrontMatterSchema, full, body);
    return { path: file, front: full, body };
  }

  async readSuggestion(id: string): Promise<SuggestionFile> {
    const file = path.join(this.layout.history.suggestions, `${id}.md`);
    const doc = await this.readMarkdown(file, SuggestionFrontMatterSchema);
    if (!doc) {
      throw new ApexError('INVALID_ARGUMENT', `Suggestion ${id} not found`, { id });
    }
    return { path: file, front: doc.front, body: doc.body };
  }

  async listSuggestions(): Promise<SuggestionFile[]> {
    const files = await listFiles(this.layout.history.suggestions, '.md');
    const out: SuggestionFile[] = [];
    for (const file of files) {
      const doc = await this.readMarkdown(file, SuggestionFrontMatterSchema);
      if (doc) {
        out.push({ path: file, front: doc.front, body: doc.body });
      }
    }
    return out;
  }

  async setSuggestionStatus(id: string, status: SuggestionFrontMatter['status']): Promise<SuggestionFile> {
    const current = await this.readSuggestion(id);
    const front = { ...current.front, status };
    await this.writeMarkdown(current.path, SuggestionFrontMatterSchema, front, current.body);
    if (current.front.call_id) {
      await this.markCallAccepted(current.front.call_id, status === 'accepted');
    }
    return { ...current, front };
  }

  async appendCall(record: CallRecord): Promise<void> {
    const valid = CallRecordSchema.parse(record);
    await appendLine(this.layout.history.calls, JSON.stringify(valid));
  }

  async readCalls(): Promise<CallRecord[]> {
    const text = await readTextIfExists(this.layout.history.calls);
    if (!text) {
      return [];
    }
    const records: CallRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const parsed = CallRecordSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        records.push(parsed.data);
      }
    }
    return records;
  }

  /** The log is append-only: acceptance is recorded as a new line that supersedes the old one. */
  async markCallAccepted(callId: string, accepted: boolean): Promise<void> {
    const calls = await this.readCalls();
    const original = calls.find((c) => c.id === callId);
    if (!original) return;
    await this.appendCall({ ...original, accepted, note: `acceptance update ${isoNow()}` });
  }

  /** Total spend recorded in history, counting each call once (latest line wins). */
  async spentUsd(): Promise<number> {
    const latest = new Map<string, CallRecord>();
    for (const call of await this.readCalls()) {
      latest.set(call.id, call);
    }
    let total = 0;
    for (const call of latest.values()) {
      total += call.cost_usd;
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Trash: deleting is always a move
  // -------------------------------------------------------------------------

  async trash(file: string): Promise<string> {
    const relative = this.rel(file).replace(/[\\/]/g, '__');
    const target = path.join(this.layout.trash, `${isoNow().replace(/[:.]/g, '-')}-${relative}`);
    await fs.mkdir(this.layout.trash, { recursive: true });
    await fs.rename(file, target);
    return target;
  }
}
