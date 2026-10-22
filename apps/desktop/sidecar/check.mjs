#!/usr/bin/env node
/**
 * Smoke test of the bundled sidecar, the way the Tauri shell drives it: spawn
 * `node dist/apex-mcp.cjs`, speak raw JSON-RPC lines over stdin/stdout, then close stdin and
 * expect the process to leave on its own (the shell relies on that to stop it cleanly).
 *
 * Checks: `initialize` answers, `tools/list` includes `project_open`, and `model_status`
 * reports the scripted stand-in (`scripted: true`) with no key in sight. Exits non-zero on any
 * failure. No MCP SDK here on purpose: the shell has none either, and the line protocol is
 * exactly what it implements.
 *
 * Environment: APEX_GALAXIA_RESOURCES overrides the data root (default: the staged
 * src-tauri/resources when present, else the repository root).
 */
/* global setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const bundle = path.join(here, 'dist', 'apex-mcp.cjs');
const stagedResources = path.resolve(here, '..', 'src-tauri', 'resources');
const TIMEOUT_MS = 30_000;

function fail(message) {
  console.error(`[sidecar:check] FAIL: ${message}`);
  process.exit(1);
}

async function exists(file) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

if (!(await exists(bundle))) fail(`${bundle} is missing; run \`pnpm sidecar:bundle\` first`);

const resources = process.env.APEX_GALAXIA_RESOURCES || ((await exists(path.join(stagedResources, 'prompts'))) ? stagedResources : repoRoot);
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sidecar-check-'));

const child = spawn(process.execPath, [bundle], {
  cwd: repoRoot,
  env: {
    ...process.env,
    APEX_GALAXIA_RESOURCES: resources,
    APEX_GALAXIA_HOME: home, // no user config, no .env
    ANTHROPIC_API_KEY: '', // the key in the environment is ignored on purpose
    APEX_GALAXIA_SCRIPTED: '1',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const pending = new Map();
let nextId = 1;
const lines = readline.createInterface({ input: child.stdout });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(`non-JSON line on stdout: ${line.slice(0, 120)}`);
  }
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
    else resolve(message.result);
  }
});

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

const timer = setTimeout(() => fail(`no answer within ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);
let closingStdin = false;
const exited = new Promise((resolve) =>
  child.on('exit', (code, signal) => {
    if (!closingStdin) fail(`the sidecar exited early (${code ?? signal})`);
    resolve(code ?? signal);
  }),
);
child.on('error', (error) => fail(`cannot spawn ${process.execPath}: ${error.message}`));

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'apex-sidecar-check', version: '0.0.0' },
  });
  if (!init?.serverInfo?.name) fail('initialize returned no serverInfo');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await request('tools/list', {});
  const names = (list?.tools ?? []).map((tool) => tool.name);
  for (const required of ['project_open', 'model_status', 'task_prepare', 'task_submit', 'suggestion_accept', 'lint']) {
    if (!names.includes(required)) fail(`tools/list lacks ${required} (got ${names.length} tools)`);
  }

  const status = await request('tools/call', { name: 'model_status', arguments: {} });
  const structured = status?.structuredContent;
  if (structured?.scripted !== true) fail(`model_status.scripted is ${JSON.stringify(structured?.scripted)}, expected true`);
  if (JSON.stringify(structured).includes('sk-')) fail('model_status leaks something that looks like a key');

  // The shell stops the sidecar by closing stdin: the process must end by itself.
  closingStdin = true;
  child.stdin.end();
  const exit = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000))]);
  if (exit === 'timeout') {
    child.kill();
    fail('the sidecar kept running 5s after stdin closed');
  }
  clearTimeout(timer);
  console.error(
    `[sidecar:check] OK: ${init.serverInfo.name} ${init.serverInfo.version ?? ''}, ${names.length} tools, model_status.scripted=true, exit on stdin close (${exit}); resources ${resources}`,
  );
} catch (error) {
  child.kill();
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await fs.rm(home, { recursive: true, force: true });
}
