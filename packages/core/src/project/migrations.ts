import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ApexError } from '../util/errors.js';
import { isoNow, readTextIfExists, writeTextAtomic } from '../util/fs.js';
import { projectLayout } from './layout.js';
import { FORMAT_VERSION } from './schemas.js';

/**
 * A migration moves a project folder from `from` to `to`. Migrations run in order until the
 * project reaches FORMAT_VERSION. Each one receives file helpers scoped to the project root so
 * it can rewrite any file, not only project.yaml. The previous project.yaml is copied into
 * history/migrations/ before the first migration runs; nothing is ever deleted.
 */
export interface MigrationContext {
  root: string;
  readText(relPath: string): Promise<string | undefined>;
  writeText(relPath: string, text: string): Promise<void>;
  config: Record<string, unknown>;
}

export interface Migration {
  from: number;
  to: number;
  describe: string;
  apply(ctx: MigrationContext): Promise<void>;
}

/** No migrations exist yet: format 1 is the first. The machinery is tested with a fake one. */
export const MIGRATIONS: Migration[] = [];

export interface MigrationResult {
  config: Record<string, unknown>;
  applied: string[];
}

export function readFormatVersion(config: Record<string, unknown>): number {
  const raw = config['format_version'];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new ApexError('INVALID_FILE', 'project.yaml has no valid format_version', {
      format_version: raw,
    });
  }
  return raw;
}

export async function migrateProject(
  root: string,
  config: Record<string, unknown>,
  migrations: Migration[] = MIGRATIONS,
  targetVersion: number = FORMAT_VERSION,
): Promise<MigrationResult> {
  const layout = projectLayout(root);
  let version = readFormatVersion(config);
  if (version > targetVersion) {
    throw new ApexError(
      'UNSUPPORTED_FORMAT_VERSION',
      `This project uses format ${version}; this build of Apex Galaxia understands up to ${targetVersion}. Update the harness.`,
      { found: version, supported: targetVersion },
    );
  }
  const applied: string[] = [];
  if (version === targetVersion) {
    return { config, applied };
  }

  const backupName = `project.v${version}.${isoNow().replace(/[:.]/g, '-')}.yaml`;
  await writeTextAtomic(path.join(layout.history.dir, 'migrations', backupName), stringifyYaml(config));

  const ctx: MigrationContext = {
    root: layout.root,
    readText: (rel) => readTextIfExists(path.join(layout.root, rel)),
    writeText: (rel, text) => writeTextAtomic(path.join(layout.root, rel), text),
    config,
  };

  while (version < targetVersion) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new ApexError(
        'MIGRATION_REQUIRED',
        `No migration from format ${version} to ${version + 1} is available`,
        { from: version },
      );
    }
    await step.apply(ctx);
    ctx.config['format_version'] = step.to;
    applied.push(`${step.from}→${step.to}: ${step.describe}`);
    version = step.to;
  }

  await writeTextAtomic(layout.projectFile, stringifyYaml(ctx.config, { lineWidth: 0 }));
  return { config: ctx.config, applied };
}

export function parseProjectYaml(text: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    throw new ApexError('INVALID_FILE', 'project.yaml is not valid YAML', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ApexError('INVALID_FILE', 'project.yaml must be a YAML mapping');
  }
  return data as Record<string, unknown>;
}
