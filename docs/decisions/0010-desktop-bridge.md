# ADR 0010: The desktop app drives the core through a bundled Node sidecar speaking MCP

Status: accepted (2026-10-22)

## Context

ADR 0001 keeps Tauri 2 as the desktop shell. The core is TypeScript on Node (file system, the
Anthropic SDK, the MCP server). A Tauri webview has no Node; the choices are a Rust port of the
core (rejected: two implementations), running the core inside the webview (rejected: no file
system or network of its own without a bridge for every call), Electron (Node in-process, 100 MB
installers, the six peers that chose it report unsigned-build pain just the same), or a sidecar.

Open-Write Studio documents the cost of a Python sidecar under Tauri (port leaks, orphans, startup
hangs). Those problems came from a network port and an interpreter; a Node sidecar over stdio
avoids both: no port, no interpreter to find, one process whose stdin closes when the app closes.

## Decision

- The desktop app is Tauri 2 + React + TypeScript (CodeMirror 6 for the manuscript; TipTap only if
  Phase 3 shows rich text is needed).
- The app spawns one sidecar: the MCP server (`packages/mcp-server`). Transport is stdio; the
  protocol is MCP (JSON-RPC, one message per line), the same the Claude Code integration already
  uses and tests. Streaming text arrives as MCP notifications.
- The frontend talks to the sidecar through a thin transport in Rust (`apps/desktop/src-tauri`),
  and uses a typed client over the server's tool list.
- The sidecar's lifetime is bound to the window: spawned before the webview loads, killed when
  the window closes and when the app exits, restarted on a crash with an `apex://reset` event.
  No network port is opened by the app, the sidecar or the dev tooling that ships.
- Keys live in the OS keychain and reach the sidecar through its environment at spawn, never
  through a file written by the app.

### Packaging: a Node runtime as the external binary plus one CommonJS bundle

The server ships as two pieces, not as a Node single-executable application (SEA):

- `apex-node`: the official Node 22 runtime for the target, downloaded from nodejs.org at build
  time and verified against the release's `SHASUMS256.txt`, bundled as the Tauri external binary
  (`bundle.externalBin`), so it sits next to the app's own executable.
- `apex-mcp.cjs`: `packages/mcp-server` and every dependency (the workspace packages, the MCP
  and Anthropic SDKs, docx, jszip, yaml, zod) bundled by esbuild into one CommonJS file, bundled
  as a Tauri resource together with the data folders `narrators/`, `prompts/`, `style/`,
  `evals/`, which the sidecar finds through `APEX_GALAXIA_RESOURCES`.

Why not the SEA: it needs a platform-specific injection and signing step per build (`postject`,
then codesign or signtool), cannot be produced for another platform, and bakes the server into a
binary that every change to the core rebuilds; experimental warnings in Node 22 on top. A bundle
is a 4 MB text file produced in a second, the runtime is a verified download, and the two can be
updated independently. The installer still carries about 50 MB compressed for the runtime,
acceptable against Electron. Under `tauri dev` the shell spawns the system `node` with
`packages/mcp-server/dist/bin.js` and the repository root as resources, so the core is one
`pnpm build` away; the same path is the fallback when the bundled runtime is missing.

### Keys: the keyring crate

The shell stores the model key with the `keyring` crate (macOS Keychain, Windows Credential
Manager, the Secret Service on Linux) under service `apex-galaxia`, account `anthropic`. At
spawn the shell reads it and sets `ANTHROPIC_API_KEY` in the sidecar's environment; the status
reports `keySource: "keychain"`. Without a stored key the environment is inherited as it is,
reported as `env` when it carries a key, `env-file` when the CLI's `~/.apex-galaxia/.env` does
(the core reads that file itself), `none` otherwise. When the platform keychain is unavailable
(no Secret Service on a Linux desktop) the commands return a message and nothing is written: the
fallback is the CLI's `.env`, written by the Author, never by the app. The key is never logged
and never part of a status payload.

Tauri's store plugin, considered in the proposal, writes a file in the app data folder; it was
dropped for the key because the point is to keep the key out of files the app owns.

### The command and event contract

Implemented in `apps/desktop/src-tauri/src`, consumed by `apps/desktop/src/api/transport.tauri.ts`:

| Name | Direction | Payload |
| --- | --- | --- |
| `apex_send` | command | `{ message: string }`: one JSON-RPC message, written as one line to the sidecar's stdin |
| `apex://message` | event | string: one line from the sidecar's stdout |
| `apex://reset` | event | `SidecarStatus`: the sidecar died, or was restarted (automatically or on request) |
| `sidecar_status`, `sidecar_restart` | command | → `SidecarStatus { running, pid?, restarts, keySource }` |
| `key_set { key }`, `key_exists`, `key_delete` | command | the OS keychain; errors come back as messages |
| `app_paths` | command | → `{ resources, userDir, appData }` |

Crash policy: an unexpected exit emits `apex://reset` with `running: false` and schedules a
restart after 0.5 s, 1 s, 2 s; at most three automatic restarts in sixty seconds, after which
the sidecar stays down with `running: false` until `sidecar_restart`, which always spawns and
clears the window. Stopping closes stdin first (the stdio transport ends on EOF and Node exits
on its own), waits briefly, and kills only a process still busy with a model call.

## Consequences

- One core, one protocol, one test suite; the headless integration test and the sidecar check
  (`apps/desktop/sidecar/check.mjs`) exercise what the app calls.
- The installer carries a Node runtime (about 50 MB compressed); acceptable against Electron's size.
- The sidecar inputs are generated (`pnpm sidecar:prepare` in `apps/desktop`); `cargo build`
  refuses to run without them and names them.
- Linux users without a Secret Service keep working through `~/.apex-galaxia/.env`.
- If packaging fails on a platform, the fallback is Electron for that platform, recorded in a new
  ADR; the frontend does not change because it speaks MCP either way.
