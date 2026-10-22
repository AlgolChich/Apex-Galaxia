import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Before the smoke test: a fresh story project in a temp folder, created with the CLI
 * (no model call), so the browser only has to open it, write and accept.
 */
export const E2E_ROOT = process.env['APEX_E2E_ROOT'] ?? '/tmp/apex-e2e';
export const E2E_PROJECT = path.join(E2E_ROOT, 'story');
export const E2E_HOME = process.env['APEX_E2E_HOME'] ?? path.join(E2E_ROOT, 'home');

export default function globalSetup(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  fs.rmSync(E2E_ROOT, { recursive: true, force: true });
  fs.mkdirSync(E2E_HOME, { recursive: true });
  // A saved interface language means this is not a first run, so the welcome screen shows.
  fs.writeFileSync(path.join(E2E_HOME, 'config.yaml'), 'ui_language: en\n');
  execFileSync(
    process.execPath,
    [path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js'), 'new', E2E_PROJECT, '--title', 'Штрек', '--lang', 'ru', '--idea', 'Ночью в посёлок приезжает грузовик.', '--length', 'short', '--storyteller', 'cassandra'],
    { stdio: 'inherit', env: { ...process.env, APEX_GALAXIA_HOME: E2E_HOME, ANTHROPIC_API_KEY: '' } },
  );
}
