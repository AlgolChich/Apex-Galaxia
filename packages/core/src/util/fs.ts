import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** Write via a temp file and rename so a crash never leaves a half-written story file. */
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

export async function appendLine(file: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, line.endsWith('\n') ? line : line + '\n', 'utf8');
}

export async function listFiles(dir: string, ext = '.md'): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((n) => n.endsWith(ext) && !n.startsWith('.') && !n.startsWith('_'))
      .sort()
      .map((n) => path.join(dir, n));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function shortId(prefix = ''): string {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(3).toString('hex');
  return prefix ? `${prefix}-${stamp}-${rand}` : `${stamp}-${rand}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** Word count that works for Russian and English: runs of letters, digits, apostrophes, hyphens. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}
