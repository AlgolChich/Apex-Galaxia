import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of the whole stack minus the Tauri shell: the dev bridge spawns the MCP server
 * with the scripted stand-in model, Vite serves the built frontend, Chromium drives it
 * (open a project, write, accept). CI runs it on Linux; locally `pnpm build && pnpm e2e`.
 */
const bridgePort = 4877;
const executablePath = process.env['APEX_CHROMIUM'];

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env['CI'] ? 1 : 0,
  // One sidecar, one open project at a time: the specs must not overlap.
  workers: 1,
  fullyParallel: false,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: [
    {
      command: 'node dev/bridge.mjs',
      url: `http://127.0.0.1:${bridgePort}/status`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { APEX_GALAXIA_SCRIPTED: '1', APEX_GALAXIA_SCRIPTED_DELAY_MS: '5', APEX_BRIDGE_PORT: String(bridgePort), ANTHROPIC_API_KEY: '', APEX_GALAXIA_HOME: process.env['APEX_E2E_HOME'] ?? '/tmp/apex-e2e/home' },
    },
    {
      command: 'pnpm preview',
      url: 'http://127.0.0.1:1420',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
