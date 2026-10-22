import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Phase 4 acceptance: an autonomous run survives its process being killed mid-chapter and
 * resumes where it stopped from a fresh server, without rewriting the finished chapter.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const serverEntry = path.resolve(here, '..', 'src', 'bin.ts');

let dir: string;

function structured<T = Record<string, unknown>>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent;
}

async function startServer(events: Array<Record<string, unknown>>): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', serverEntry],
    env: { ...process.env, APEX_GALAXIA_RESOURCES: repoRoot, APEX_GALAXIA_HOME: path.join(dir, 'home'), ANTHROPIC_API_KEY: '', APEX_GALAXIA_SCRIPTED: '1', APEX_GALAXIA_SCRIPTED_DELAY_MS: '150' },
    cwd: repoRoot,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'apex-resume-test', version: '0.0.0' });
  client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
    if (n.params.logger === 'apex.run') events.push(n.params.data as Record<string, unknown>);
  });
  await client.connect(transport);
  return { client, transport };
}

async function waitFor(predicate: () => boolean, ms = 30_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-resume-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('autonomous run killed mid-chapter', () => {
  it('resumes from a fresh server where it stopped and finishes the story', async () => {
    const root = path.join(dir, 'story');
    const events: Array<Record<string, unknown>> = [];
    const first = await startServer(events);
    await first.client.callTool({ name: 'project_create', arguments: { path: root, title: 'Штрек', language: 'ru', idea: 'Грузовик ночью.', length: 'medium' } });
    await first.client.callTool({ name: 'project_settings_update', arguments: { settings: { preset: 'fast' } } });
    const started = structured(await first.client.callTool({ name: 'run_start', arguments: { chapters: 2, reader_report: false } }));
    const id = started['id'] as string;
    // Wait until chapter one is done and chapter two is planned (its text is now streaming), then kill the server process.
    await waitFor(() => events.some((e) => e['run_id'] === id && typeof e['message'] === 'string' && (e['message'] as string).includes('chapter 2: planned')));
    const pid = first.transport.pid;
    expect(pid).toBeTypeOf('number');
    process.kill(pid!, 'SIGKILL');
    await first.client.close().catch(() => undefined);

    const saved = JSON.parse(await fs.readFile(path.join(root, 'history', 'runs', `${id}.json`), 'utf8')) as { status: string; completed: number[]; next_chapter: number };
    expect(saved.completed).toEqual([1]);
    expect(saved.next_chapter).toBe(2);
    const chaptersBefore = await fs.readdir(path.join(root, 'chapters'));
    expect(chaptersBefore).toHaveLength(1);
    const chapterOne = await fs.readFile(path.join(root, 'chapters', chaptersBefore[0]!), 'utf8');

    const events2: Array<Record<string, unknown>> = [];
    const second = await startServer(events2);
    try {
      await second.client.callTool({ name: 'project_open', arguments: { path: root } });
      const listed = structured(await second.client.callTool({ name: 'run_list', arguments: {} }))['runs'] as Array<{ id: string; status: string }>;
      expect(listed.map((r) => r.id)).toContain(id);
      const resumed = structured(await second.client.callTool({ name: 'run_start', arguments: { resume: id, reader_report: false } }));
      expect(resumed['id']).toBe(id);
      await waitFor(() => events2.some((e) => e['run_id'] === id && e['final'] === true), 60_000);
      const final = structured(await second.client.callTool({ name: 'run_get', arguments: { id } }))['state'] as { status: string; completed: number[]; log: string[] };
      expect(final.status).toBe('completed');
      expect(final.completed).toEqual([1, 2]);
      expect(final.log.some((l) => l.includes('resumed at chapter 2'))).toBe(true);
      const chaptersAfter = await fs.readdir(path.join(root, 'chapters'));
      expect(chaptersAfter).toHaveLength(2);
      expect(await fs.readFile(path.join(root, 'chapters', chaptersBefore[0]!), 'utf8')).toBe(chapterOne);
    } finally {
      await second.client.close().catch(() => undefined);
    }
  }, 120_000);
});
