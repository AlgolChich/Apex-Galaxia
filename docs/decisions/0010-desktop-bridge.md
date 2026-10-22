# ADR 0010: The desktop app drives the core through a bundled Node sidecar speaking MCP

Status: proposed (to confirm at the start of Phase 3)

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
- The app spawns one sidecar: the MCP server (`packages/mcp-server`) compiled into a single
  executable per platform (Node single-executable application, or an equivalent bundler), shipped
  as a Tauri external binary. Transport is stdio; the protocol is MCP (JSON-RPC), the same the
  Claude Code integration already uses and tests.
- A thin Tauri command (`apex_call`) relays JSON-RPC between the webview and the sidecar; the
  frontend uses a typed client generated from the server's tool list. Streaming text arrives as
  MCP notifications.
- The sidecar's lifetime is bound to the window: spawned on launch, killed on close, restarted on
  crash with a visible notice. No network ports are opened.
- Keys live in the OS keychain through Tauri's store plugin and are passed to the sidecar through
  its environment at spawn, never written to disk by the app.

## Consequences

- One core, one protocol, one test suite; the headless integration test already exercises what the
  app will call.
- The installer carries a Node runtime (about 50 MB compressed); acceptable against Electron's size.
- If single-executable packaging fails on a platform, the fallback is Electron for that platform,
  recorded in a new ADR; the frontend does not change because it speaks MCP either way.
