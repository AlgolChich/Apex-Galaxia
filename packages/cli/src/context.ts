import path from 'node:path';
import { Harness, ProjectStore, isApexError, resolveResources, type Language, type Resources } from '@apex-galaxia/core';
import { createAdapter, loadUserConfig, type AdapterChoice } from '@apex-galaxia/adapters';
import { makeT, type StringKey } from './i18n.js';

export interface GlobalOptions {
  project?: string;
  cassette?: string;
  json?: boolean;
  ui?: Language;
}

export interface CliContext {
  root: string;
  resources: Resources;
  ui: Language;
  t: (key: StringKey) => string;
  json: boolean;
}

export async function resolveProjectRoot(options: GlobalOptions, positional?: string): Promise<string> {
  const candidate = positional ?? options.project ?? process.env['APEX_PROJECT'] ?? process.cwd();
  const root = path.resolve(candidate);
  if (!(await ProjectStore.isProject(root))) {
    throw new Error(`No project.yaml in ${root}. Pass the project folder, set APEX_PROJECT, or run apex new.`);
  }
  return root;
}

export async function cliContext(options: GlobalOptions, positional?: string): Promise<CliContext> {
  const root = await resolveProjectRoot(options, positional);
  const resources = await resolveResources();
  const userConfig = await loadUserConfig();
  const store = await ProjectStore.open(root);
  const ui = options.ui ?? userConfig.ui_language ?? store.config.language;
  return { root, resources, ui, t: makeT(ui), json: Boolean(options.json) };
}

export async function openHarness(ctx: CliContext, options: GlobalOptions): Promise<{ harness: Harness; choice: AdapterChoice }> {
  const choice = await createAdapter({ ...(options.cassette ? { cassette: options.cassette } : {}) });
  const harness = await Harness.open(ctx.root, { adapter: choice.adapter, resources: ctx.resources });
  return { harness, choice };
}

export function printError(error: unknown): void {
  if (isApexError(error)) {
    console.error(`error [${error.code}]: ${error.message}`);
    return;
  }
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
}

export function out(ctx: { json: boolean }, data: unknown, text: () => string): void {
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(text());
  }
}
