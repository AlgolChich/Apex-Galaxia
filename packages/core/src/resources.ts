import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApexError } from './util/errors.js';

/**
 * Where shipped data lives: `narrators/`, `prompts/`, `style/`, `evals/` at the repository
 * root, and the user's overrides in `~/.apex-galaxia/`. The desktop app passes an explicit
 * root (its bundled resources); the CLI and MCP server find the repository root by walking up
 * from this package. Keys never live in either tree.
 */
export interface Resources {
  /** Repository (or bundle) root that contains narrators/, prompts/, style/. */
  root: string;
  /** User-level folder: config.yaml, style/, prompts/, narrators/ overrides. */
  userDir: string;
}

export const USER_DIR_ENV = 'APEX_GALAXIA_HOME';
export const RESOURCES_ENV = 'APEX_GALAXIA_RESOURCES';

export function defaultUserDir(): string {
  return process.env[USER_DIR_ENV] ?? path.join(os.homedir(), '.apex-galaxia');
}

async function isResourcesRoot(dir: string): Promise<boolean> {
  try {
    const [narrators, prompts] = await Promise.all([
      fs.stat(path.join(dir, 'narrators')),
      fs.stat(path.join(dir, 'prompts')),
    ]);
    return narrators.isDirectory() && prompts.isDirectory();
  } catch {
    return false;
  }
}

/** Walk up from `from` until a folder with narrators/ and prompts/ appears. */
export async function findResourcesRoot(from?: string): Promise<string> {
  const explicit = process.env[RESOURCES_ENV];
  if (explicit && (await isResourcesRoot(explicit))) {
    return path.resolve(explicit);
  }
  const start = from ?? path.dirname(fileURLToPath(import.meta.url));
  let current = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (await isResourcesRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const cwd = process.cwd();
  if (await isResourcesRoot(cwd)) {
    return cwd;
  }
  throw new ApexError(
    'TEMPLATE_NOT_FOUND',
    `Cannot find the Apex Galaxia resources (narrators/, prompts/). Set ${RESOURCES_ENV} to the repository root.`,
  );
}

export async function resolveResources(options: { root?: string; userDir?: string } = {}): Promise<Resources> {
  const root = options.root ? path.resolve(options.root) : await findResourcesRoot();
  if (options.root && !(await isResourcesRoot(root))) {
    throw new ApexError('TEMPLATE_NOT_FOUND', `${root} does not contain narrators/ and prompts/`, { root });
  }
  return { root, userDir: options.userDir ?? defaultUserDir() };
}

/**
 * Resolve a data file: the user override wins over the shipped file. Returns the first that
 * exists, or undefined.
 */
export async function resolveDataFile(resources: Resources, relPath: string): Promise<string | undefined> {
  for (const base of [resources.userDir, resources.root]) {
    const candidate = path.join(base, relPath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try the next base
    }
  }
  return undefined;
}

export async function readDataFile(resources: Resources, relPath: string): Promise<string> {
  const file = await resolveDataFile(resources, relPath);
  if (!file) {
    throw new ApexError('TEMPLATE_NOT_FOUND', `Missing data file ${relPath}`, { relPath });
  }
  return fs.readFile(file, 'utf8');
}
