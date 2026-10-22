# The sidecar

The desktop app does not embed the core; it runs the MCP server (`packages/mcp-server`) as one
Node process and talks JSON-RPC to it over stdin/stdout, one message per line (ADR 0010). No
port is opened. This folder turns the server into something an installer can carry.

## What ships

| Piece | Built by | Lands in | Bundled as |
| --- | --- | --- | --- |
| `apex-mcp.cjs`: the server and every dependency in one CommonJS file | `bundle.mjs` (esbuild) | `sidecar/dist/` | a Tauri resource, next to the data |
| `narrators/`, `prompts/`, `style/`, `evals/`: the shipped data | `bundle.mjs` (copy) | `src-tauri/resources/` | Tauri resources (`APEX_GALAXIA_RESOURCES`) |
| `apex-node-<triple>[.exe]`: the official Node 22 runtime | `fetch-node.mjs` | `src-tauri/binaries/` | the Tauri external binary `apex-node` |

All three folders are git-ignored; they are generated, never committed. At run time the shell
spawns `apex-node <resources>/apex-mcp.cjs` with `APEX_GALAXIA_RESOURCES=<resources>` and
`ANTHROPIC_API_KEY` from the OS keychain when one is stored (see `src-tauri/src/sidecar.rs`).
Under `tauri dev` it spawns the system `node` with `packages/mcp-server/dist/bin.js` and the
repository root as resources instead, so a change to the core is one `pnpm build` away.

Why a runtime plus a bundle rather than Node's single-executable application: the SEA needs a
per-platform signing and injection step, cannot be cross-built, and bakes the server into a
binary that every change to the core must rebuild; a bundle is a 4 MB text file that esbuild
produces in a second, and the runtime is the official download verified by its checksum.

## Commands (from `apps/desktop`)

```bash
pnpm sidecar:bundle     # esbuild → dist/apex-mcp.cjs, copy the data, then check.mjs
pnpm sidecar:check      # the stdio smoke test alone
pnpm sidecar:node       # download Node for the host into src-tauri/binaries (verified)
pnpm sidecar:node -- --target x86_64-pc-windows-msvc --version 22.22.0   # another target
pnpm sidecar:prepare    # bundle + node: what cargo build and tauri dev need first
pnpm tauri:dev          # prepare, then tauri dev
pnpm tauri:build        # prepare, then tauri build (installers in src-tauri/target/release/bundle)
```

`bundle.mjs` resolves the workspace packages to their TypeScript sources (no stale `dist`),
shims `import.meta.url` from `__filename` and rewrites the one dynamic
`import('@apex-galaxia/core')` in the server to a static import: a dynamic import of a bundled
package makes esbuild wrap it in a lazy initializer, which breaks zod's load order under CJS.
`private/` and `proposals/` folders never ship.

`fetch-node.mjs` downloads `node-v<version>-<platform>.tar.gz|zip` and `SHASUMS256.txt` from
nodejs.org, compares the SHA-256, extracts only the `node` executable (system `tar`; bsdtar
reads zip on Windows and macOS) and records the version in a `.version` stamp so a second run
is a no-op. The release signature (GPG) is not checked. When nodejs.org is unreachable and the
target is the host, the running Node is copied with a notice instead; CI always downloads.
`HTTPS_PROXY` is honored (the script re-runs itself under `NODE_USE_ENV_PROXY=1`).

## How to verify

`check.mjs` does what the Rust shell does, without the MCP SDK: it spawns
`node dist/apex-mcp.cjs` with `APEX_GALAXIA_SCRIPTED=1`, an empty key and a throwaway
`APEX_GALAXIA_HOME`, sends `initialize`, `notifications/initialized`, `tools/list` and
`tools/call model_status` as raw lines, and expects `project_open` among the tools and
`scripted: true` in the status. It then closes stdin and expects the process to exit within five
seconds, which is how the shell stops the sidecar (close the pipe, wait briefly, kill only if a
call is still running). It exits non-zero on any failure, so `pnpm sidecar:bundle` fails as a
whole when the bundle does not start.

By hand, the same conversation:

```bash
cd apps/desktop
APEX_GALAXIA_RESOURCES=src-tauri/resources APEX_GALAXIA_SCRIPTED=1 node sidecar/dist/apex-mcp.cjs
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"me","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"model_status","arguments":{}}}
```

Ctrl-D ends it. The runtime can be checked with `src-tauri/binaries/apex-node-<triple> --version`.
