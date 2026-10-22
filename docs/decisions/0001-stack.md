# ADR 0001: Stack — TypeScript core, pnpm monorepo, Tauri 2 desktop

Status: accepted (proposed default at the Phase 0 gate; the Author may overturn it)

## Context

One core must serve three clients: a desktop app, the `apex` CLI and an MCP server for Claude Code (Section 8). The competitive analysis found one peer on Tauri 2 (Open-Write Studio, whose problems came from a Python sidecar) and six on Electron. The core has no UI dependencies and must run under Node for the CLI and the MCP server.

## Decision

- One TypeScript core (`packages/core`), strict, ESM, no UI dependencies.
- pnpm workspaces: `packages/core`, `packages/adapters`, `packages/cli`, `packages/mcp-server`, later `apps/desktop`.
- Desktop: Tauri 2 with React and TypeScript; the core runs in-process in the webview's Node-free context through a thin bridge, or as a local sidecar of the same TypeScript code if the bridge proves limiting. Electron only if Tauri blocks something essential, recorded in a new ADR.
- Tests with Vitest, lint with ESLint and Prettier, CI on GitHub Actions for Ubuntu, Windows and macOS.
- TypeScript 5.9 rather than 7.0: the lint toolchain's peer range does not yet admit 7.

## Consequences

- The CLI, the MCP server and the app share one implementation and one test suite.
- No sidecar process class of bugs (ports, orphans, CORS) that Open-Write documents.
- The desktop bridge is the open technical question of Phase 3; it is isolated behind the adapter and store interfaces.
