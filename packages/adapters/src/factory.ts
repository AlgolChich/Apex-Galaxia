import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ApexError, ModelRegistry, NoModelAdapter, UserConfigSchema, defaultUserDir, type ModelAdapter, type UserConfig } from '@apex-galaxia/core';
import { AnthropicAdapter } from './anthropic.js';
import { ReplayAdapter } from './replay.js';
import { scriptedResponder } from './scripted.js';

export interface AdapterChoice {
  adapter: ModelAdapter;
  userConfig: UserConfig;
  /** Where the API key came from, for the first-run message; never the key itself. */
  keySource: 'env' | 'env-file' | 'none' | 'replay' | 'scripted';
}

/** Read ~/.apex-galaxia/config.yaml (or APEX_GALAXIA_HOME); missing file means defaults. */
export async function loadUserConfig(userDir = defaultUserDir()): Promise<UserConfig> {
  try {
    const text = await fs.readFile(path.join(userDir, 'config.yaml'), 'utf8');
    return UserConfigSchema.parse(parseYaml(text) ?? {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return UserConfigSchema.parse({});
    throw error;
  }
}

/**
 * Keys never live in a repository or a project. Resolution order: ANTHROPIC_API_KEY in the
 * environment, then a `.env` file in the user directory (outside any repo), then nothing.
 */
export async function resolveApiKey(userDir = defaultUserDir()): Promise<{ key: string | undefined; source: AdapterChoice['keySource'] }> {
  const fromEnv = process.env['ANTHROPIC_API_KEY'];
  if (fromEnv) return { key: fromEnv, source: 'env' };
  try {
    const text = await fs.readFile(path.join(userDir, '.env'), 'utf8');
    const match = /^\s*ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m.exec(text);
    if (match?.[1]) return { key: match[1].trim(), source: 'env-file' };
  } catch {
    // no .env file
  }
  return { key: undefined, source: 'none' };
}

export interface CreateAdapterOptions {
  userDir?: string;
  /** Replay cassette for offline runs and tests (APEX_GALAXIA_CASSETTE also works). */
  cassette?: string;
  replayMode?: 'replay' | 'record' | 'auto';
  registry?: ModelRegistry;
  /** A scripted stand-in model for dev mode and UI tests (APEX_GALAXIA_SCRIPTED=1 also selects it). Never a default. */
  scripted?: boolean;
}

/** Build the adapter the CLI and MCP server use, honoring replay for offline work. */
export async function createAdapter(options: CreateAdapterOptions = {}): Promise<AdapterChoice> {
  const userDir = options.userDir ?? defaultUserDir();
  const userConfig = await loadUserConfig(userDir);
  const registry = options.registry ?? new ModelRegistry();
  const cassette = options.cassette ?? process.env['APEX_GALAXIA_CASSETTE'];
  const { key, source } = await resolveApiKey(userDir);

  if (options.scripted ?? process.env['APEX_GALAXIA_SCRIPTED'] === '1') {
    const delay = Number(process.env['APEX_GALAXIA_SCRIPTED_DELAY_MS'] ?? '0');
    return {
      adapter: new ReplayAdapter({ mode: 'replay', responder: scriptedResponder(), registry, streamDelayMs: Number.isFinite(delay) ? delay : 0 }),
      userConfig,
      keySource: 'scripted',
    };
  }

  if (cassette) {
    const mode = options.replayMode ?? (key ? 'auto' : 'replay');
    const inner = key ? new AnthropicAdapter({ apiKey: key, registry, ...(userConfig.base_url ? { baseURL: userConfig.base_url } : {}) }) : undefined;
    return {
      adapter: new ReplayAdapter({ cassetteFile: cassette, mode, registry, ...(inner ? { inner } : {}) }),
      userConfig,
      keySource: key ? source : 'replay',
    };
  }
  if (userConfig.provider !== 'anthropic') {
    throw new ApexError('ADAPTER_ERROR', `Provider ${userConfig.provider} is not implemented yet; the adapter seam exists in packages/adapters`, { provider: userConfig.provider });
  }
  if (!key) {
    // Everything that needs no model keeps working; a model call explains what is missing.
    return { adapter: new NoModelAdapter(), userConfig, keySource: 'none' };
  }
  return {
    adapter: new AnthropicAdapter({ apiKey: key, registry, ...(userConfig.base_url ? { baseURL: userConfig.base_url } : {}) }),
    userConfig,
    keySource: source,
  };
}
