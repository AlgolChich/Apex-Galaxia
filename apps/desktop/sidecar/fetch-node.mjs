#!/usr/bin/env node
/**
 * Fetch the Node runtime the app ships as its Tauri external binary:
 *
 *   https://nodejs.org/dist/v<version>/node-v<version>-<platform>.<tar.gz|zip>
 *   → apps/desktop/src-tauri/binaries/apex-node-<target triple>[.exe]
 *
 * The archive is checked against the release's SHASUMS256.txt before anything is extracted.
 * Only the `node` executable is kept. When nodejs.org cannot be reached and the target is the
 * host, the running Node (`process.execPath`) is copied instead with a notice; CI always
 * downloads for real.
 *
 *   node fetch-node.mjs [--target <triple>] [--version <x.y.z>] [--force]
 *
 * Environment: APEX_NODE_VERSION (default below), APEX_NODE_TARGET (the host when unset).
 * A configured HTTPS_PROXY is honored by re-running under NODE_USE_ENV_PROXY=1.
 */
/* global fetch, Buffer */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_VERSION = '22.22.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const binariesDir = path.resolve(here, '..', 'src-tauri', 'binaries');

/** Rust target triple → nodejs.org platform name. */
const PLATFORMS = {
  'x86_64-unknown-linux-gnu': 'linux-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-pc-windows-msvc': 'win-x64',
  'aarch64-pc-windows-msvc': 'win-arm64',
};

function hostTriple() {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const vendor = { linux: 'unknown-linux-gnu', darwin: 'apple-darwin', win32: 'pc-windows-msvc' }[process.platform];
  if (!arch || !vendor) throw new Error(`no Node download for ${process.platform}/${process.arch}`);
  return `${arch}-${vendor}`;
}

function parseArgs(argv) {
  const options = { target: process.env.APEX_NODE_TARGET || hostTriple(), version: process.env.APEX_NODE_VERSION || DEFAULT_VERSION, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target' && argv[i + 1]) options.target = argv[++i];
    else if (argv[i] === '--version' && argv[i + 1]) options.version = argv[++i];
    else if (argv[i] === '--force') options.force = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  options.version = options.version.replace(/^v/, '');
  return options;
}

// Node's fetch ignores HTTPS_PROXY unless asked to at start-up; re-run once with the switch on.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-warnings`.trim() },
  });
  process.exit(child.status ?? 1);
}

const options = parseArgs(process.argv.slice(2));
const platform = PLATFORMS[options.target];
if (!platform) throw new Error(`unsupported target ${options.target}; known: ${Object.keys(PLATFORMS).join(', ')}`);
const isWindows = platform.startsWith('win');
const destination = path.join(binariesDir, `apex-node-${options.target}${isWindows ? '.exe' : ''}`);
const archiveName = `node-v${options.version}-${platform}.${isWindows ? 'zip' : 'tar.gz'}`;
const baseUrl = `https://nodejs.org/dist/v${options.version}/`;

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function alreadyThere() {
  if (options.force) return false;
  try {
    const stamp = await fs.readFile(`${destination}.version`, 'utf8');
    await fs.access(destination);
    return stamp.trim() === options.version;
  } catch {
    return false;
  }
}

async function fetchAndVerify() {
  console.error(`[sidecar:node] downloading ${archiveName}`);
  const [archive, sums] = await Promise.all([download(baseUrl + archiveName), download(baseUrl + 'SHASUMS256.txt')]);
  const line = sums
    .toString('utf8')
    .split('\n')
    .find((entry) => entry.trim().endsWith(`  ${archiveName}`) || entry.trim().endsWith(` ${archiveName}`));
  if (!line) throw new Error(`${archiveName} is not listed in SHASUMS256.txt`);
  const expected = line.trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${archiveName}: ${actual} != ${expected}`);
  console.error(`[sidecar:node] SHA-256 verified (${expected.slice(0, 12)}…)`);
  return archive;
}

async function extract(archive) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-node-'));
  try {
    const archivePath = path.join(work, archiveName);
    await fs.writeFile(archivePath, archive);
    const folder = `node-v${options.version}-${platform}`;
    const member = isWindows ? `${folder}/node.exe` : `${folder}/bin/node`;
    // GNU tar and bsdtar read gzip; bsdtar (macOS, Windows 10+) also reads zip.
    execFileSync('tar', ['-xf', archivePath, '-C', work, member], { stdio: 'inherit' });
    await fs.mkdir(binariesDir, { recursive: true });
    await fs.copyFile(path.join(work, member), destination);
    if (!isWindows) await fs.chmod(destination, 0o755);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function fallbackToHostNode(reason) {
  if (options.target !== hostTriple()) throw new Error(`${reason}; cannot substitute the host Node for ${options.target}`);
  console.error(`[sidecar:node] NOTICE: ${reason}`);
  console.error(`[sidecar:node] NOTICE: copying the running Node ${process.version} (${process.execPath}) instead; not verified against nodejs.org. CI downloads for real.`);
  await fs.mkdir(binariesDir, { recursive: true });
  await fs.copyFile(process.execPath, destination);
  if (!isWindows) await fs.chmod(destination, 0o755);
  return process.version.replace(/^v/, '');
}

try {
  if (await alreadyThere()) {
    console.error(`[sidecar:node] ${path.relative(process.cwd(), destination)} is already Node ${options.version}; use --force to refetch`);
    process.exit(0);
  }
  let installed = options.version;
  try {
    await extract(await fetchAndVerify());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP \d+|SHA-256|not listed|unsupported/.test(message)) throw error;
    installed = await fallbackToHostNode(`nodejs.org is unreachable (${message})`);
  }
  await fs.writeFile(`${destination}.version`, `${installed}\n`);
  const size = (await fs.stat(destination)).size;
  console.error(`[sidecar:node] ${path.relative(process.cwd(), destination)} (Node ${installed}, ${(size / 1024 / 1024).toFixed(1)} MB)`);
} catch (error) {
  console.error(`[sidecar:node] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
