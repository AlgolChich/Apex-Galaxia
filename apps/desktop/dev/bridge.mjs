#!/usr/bin/env node
/**
 * Development bridge: spawns the MCP server exactly as the Tauri shell would and relays
 * JSON-RPC lines over 127.0.0.1 so the frontend can run in a plain browser (`pnpm dev`)
 * and in the Playwright smoke test. Never part of the shipped app; the desktop talks to
 * the sidecar over stdio inside the Tauri process (ADR 0010).
 *
 *   POST /send     one JSON-RPC message → sidecar stdin
 *   GET  /events   server-sent events: every stdout line as `message`, lifecycle as `reset`
 *   GET  /status   { running, pid, restarts, keySource }
 *   POST /restart  kill and respawn
 *
 * Environment: APEX_BRIDGE_PORT (4877), APEX_SIDECAR (path to the server entry; defaults to
 * packages/mcp-server/dist/bin.js, or src/bin.ts via tsx with APEX_SIDECAR_TSX=1),
 * APEX_GALAXIA_SCRIPTED=1 to run the scripted stand-in model, plus everything the server
 * reads (ANTHROPIC_API_KEY, APEX_GALAXIA_HOME, APEX_GALAXIA_RESOURCES).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const port = Number(process.env.APEX_BRIDGE_PORT ?? 4877);
const useTsx = process.env.APEX_SIDECAR_TSX === '1';
const entry = process.env.APEX_SIDECAR ?? (useTsx ? path.join(repoRoot, 'packages', 'mcp-server', 'src', 'bin.ts') : path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'bin.js'));

const clients = new Set();
let child;
let restarts = 0;

function keySource() {
  return process.env.ANTHROPIC_API_KEY ? 'env' : 'unknown';
}

function status() {
  return { running: Boolean(child && child.exitCode === null), pid: child?.pid, restarts, keySource: keySource() };
}

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

function start() {
  const args = useTsx ? ['--import', 'tsx', entry] : [entry];
  child = spawn(process.execPath, args, { cwd: repoRoot, env: { ...process.env, APEX_GALAXIA_RESOURCES: process.env.APEX_GALAXIA_RESOURCES ?? repoRoot }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    for (const res of clients) res.write(`data: ${line}\n\n`);
  });
  child.on('exit', (code, signal) => {
    console.error(`[bridge] sidecar exited (${code ?? signal})`);
    broadcast('reset', { ...status(), running: false });
  });
  console.error(`[bridge] sidecar pid ${child.pid}: ${entry}${process.env.APEX_GALAXIA_SCRIPTED === '1' ? ' (scripted model)' : ''}`);
}

function restart() {
  restarts += 1;
  if (child && child.exitCode === null) {
    child.removeAllListeners('exit');
    child.kill();
  }
  start();
  broadcast('reset', status());
  return status();
}

const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify(status()));
    return;
  }
  if (req.method === 'POST' && req.url === '/restart') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify(restart()));
    return;
  }
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (!child || child.exitCode !== null) {
        res.writeHead(503, cors);
        res.end('sidecar not running');
        return;
      }
      try {
        JSON.parse(body);
      } catch {
        res.writeHead(400, cors);
        res.end('not JSON');
        return;
      }
      child.stdin.write(body.replace(/\n/g, ' ') + '\n');
      res.writeHead(202, cors);
      res.end();
    });
    return;
  }
  res.writeHead(404, cors);
  res.end();
});

start();
server.listen(port, '127.0.0.1', () => console.error(`[bridge] listening on http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill();
    process.exit(0);
  });
}
