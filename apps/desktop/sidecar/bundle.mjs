#!/usr/bin/env node
/**
 * Bundle the MCP server into one CommonJS file for the desktop app and stage the shipped data
 * next to it (ADR 0010):
 *
 *   packages/mcp-server/src/bin.ts  → apps/desktop/sidecar/dist/apex-mcp.cjs
 *   narrators/ prompts/ style/ evals/ → apps/desktop/src-tauri/resources/<name>/
 *
 * The bundle carries every dependency (the workspace packages, the MCP SDK, the Anthropic SDK,
 * docx, jszip, yaml, zod); only Node's built-in modules stay external. The workspace packages
 * are resolved to their TypeScript sources, so a stale `dist` cannot leak in. `import.meta.url`
 * (the core's resource lookup walks up from it) becomes a top-level variable derived from
 * `__filename`; a plain banner rather than esbuild's `inject`, which would wrap every module in
 * a lazy initializer and break zod's load order.
 *
 * The data folders are copied fresh on every run; `private/` and `proposals/` never ship.
 */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const desktopRoot = path.resolve(here, '..');
const entry = path.join(repoRoot, 'packages', 'mcp-server', 'src', 'bin.ts');
const outFile = path.join(here, 'dist', 'apex-mcp.cjs');
const resourcesDir = path.join(desktopRoot, 'src-tauri', 'resources');

/** The shipped data: what `APEX_GALAXIA_RESOURCES` must contain (packages/core/src/resources.ts). */
const DATA_FOLDERS = ['narrators', 'prompts', 'style', 'evals'];
/** Never shipped: the Author's private fixtures, /improve proposals, editor noise. */
const EXCLUDED_NAMES = new Set(['private', 'proposals', 'node_modules', '.DS_Store', 'Thumbs.db']);

/**
 * A workspace source that `import('@apex-galaxia/<pkg>')` dynamically (server.ts does, once)
 * makes esbuild wrap the whole package in a lazy initializer, and under CJS that breaks zod's
 * load order ("Class is not a constructor" at start-up). The packages are in the bundle
 * anyway, so the dynamic import becomes a static namespace import.
 */
const staticWorkspaceImports = {
  name: 'static-workspace-imports',
  setup(build) {
    const dynamicImport = /(?:await\s+)?import\(\s*['"](@apex-galaxia\/[a-z-]+)['"]\s*\)/g;
    build.onLoad({ filter: /[\\/]packages[\\/][^\\/]+[\\/]src[\\/].*\.ts$/ }, async (args) => {
      const source = await fs.readFile(args.path, 'utf8');
      if (!dynamicImport.test(source)) return undefined;
      const namespaces = new Map();
      const contents = source.replace(dynamicImport, (_, pkg) => {
        const name = `__apex_${pkg.slice('@apex-galaxia/'.length).replace(/-/g, '_')}`;
        namespaces.set(pkg, name);
        return name;
      });
      const header = [...namespaces].map(([pkg, name]) => `import * as ${name} from '${pkg}';`).join('\n');
      return { contents: `${header}\n${contents}`, loader: 'ts' };
    });
  },
};

async function bundleServer() {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const result = await build({
    plugins: [staticWorkspaceImports],
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
    alias: {
      '@apex-galaxia/core': path.join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
      '@apex-galaxia/adapters': path.join(repoRoot, 'packages', 'adapters', 'src', 'index.ts'),
    },
    define: { 'import.meta.url': '__apexImportMetaUrl' },
    banner: {
      js: [
        '// Apex Galaxia MCP server, bundled by apps/desktop/sidecar/bundle.mjs. Do not edit.',
        'var __apexImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
      ].join('\n'),
    },
  });
  const size = result.metafile.outputs[path.relative(process.cwd(), outFile)]?.bytes ?? (await fs.stat(outFile)).size;
  console.error(`[sidecar] ${path.relative(repoRoot, outFile)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

async function stageResources() {
  await fs.mkdir(resourcesDir, { recursive: true });
  for (const folder of DATA_FOLDERS) {
    const from = path.join(repoRoot, folder);
    const to = path.join(resourcesDir, folder);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(from, to, {
      recursive: true,
      filter: (source) => !EXCLUDED_NAMES.has(path.basename(source)),
    });
  }
  console.error(`[sidecar] staged ${DATA_FOLDERS.join(', ')} into ${path.relative(repoRoot, resourcesDir)}`);
}

try {
  await bundleServer();
  await stageResources();
} catch (error) {
  console.error(`[sidecar] bundle failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
