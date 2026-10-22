# Apex Galaxia desktop

Tauri 2 shell + React frontend; the core runs in a bundled Node sidecar that speaks MCP over
stdio (ADR 0010). The frontend never touches files or the network itself: every action is an
MCP tool call through `src/api/client.ts`.

## Run it

```bash
pnpm install && pnpm build                       # builds packages/mcp-server, which the sidecar is
cd apps/desktop
APEX_GALAXIA_SCRIPTED=1 pnpm dev:bridge           # terminal 1: the dev bridge spawns the sidecar (scripted model)
pnpm dev                                          # terminal 2: Vite on http://127.0.0.1:1420 (browser, no Tauri)
pnpm tauri:dev                                    # the real shell: bundles the sidecar, fetches the Node runtime, then tauri dev (needs Rust and the Tauri prerequisites)
pnpm typecheck && pnpm test && pnpm build         # what CI runs for the frontend
pnpm e2e                                          # Playwright smoke test against the bridge and the scripted model
```

`APEX_GALAXIA_SCRIPTED=1` selects a deterministic stand-in model so the UI can be developed and
tested offline; the status bar says so, and `model_status` reports `scripted: true`. With
`ANTHROPIC_API_KEY` in the environment (or in `~/.apex-galaxia/.env`) the bridge uses the real
models. The shipped app passes the key from the OS keychain to the sidecar's environment at
spawn and opens no network port.

## Layout

```
src/
  api/        transport (tauri | http bridge | mock), MCP connection, typed client, result types
  state/      the zustand store: connection, project, editor, lint, suggestion, ui + actions
  i18n/       useT(), the merged catalog; strings live in each feature's strings.ts
  theme/      design tokens (light/dark)
  features/
    layout/           top bar, status bar, resizable frame, focus mode
    editor/           CodeMirror 6: Markdown prose, typewriter scrolling, lint underlines, word count
    tree/             project tree (chapters, Bible, plan, chronicle, runs) and the welcome screen
    palette/          command palette (Ctrl/Cmd+K) with every action and its shortcut
    suggestion/       inline suggestion block: streaming, Accept, Retry, Retry with note, Discard
    diff/             per-paragraph diffs for Rewrite, Weave and de-AI
    describe/         Describe (sensory layers) and Weave into a paragraph
    panels/           right panel: Bible, Chronicle, Lint, Critic, Inspector
    chronicle-update/ propose → show the diff → apply (after the Author confirms)
    wizard/           first run (language, key, project, voice sample) and the story setup wizard
    views/            Bible cards, chronicle timeline, plan outline, run progress screen
    settings/         project settings (narrator, models, budget, window) and user settings
src-tauri/    the Rust shell: sidecar process, keychain, folder picker, app paths
sidecar/      bundling of packages/mcp-server into one file + the Node runtime per platform
dev/          bridge.mjs for browser development and the smoke test
e2e/          Playwright smoke test (open, write, accept) against the scripted model
```

## Rules of the road

- Prose reaches a chapter only through `suggestion_accept`; the Author's own edits go through
  `chapter_save`. The chronicle changes only through `chronicle_apply` after a confirmation
  dialog. Never bypass these in the UI.
- No telemetry, no analytics, no fonts or scripts from the network. Fonts are bundled or system.
- Every user-visible string goes through `useT()` and lives in a `strings.ts` with both
  languages; the catalog test fails when a key is missing in one language.
- Keyboard first: every action in the palette has a shortcut; dialogs trap focus and close on
  Escape; controls carry labels for screen readers.
- Features talk through the store (`src/state/store.ts`) and the client; a feature that needs
  more state creates its own small store in its folder rather than editing the global one.
- Model and cost are shown in small print wherever a model ran; the scripted stand-in is always
  labelled as such.

## Tauri commands and events (implemented in `src-tauri/src`)

| Name | Direction | Payload |
| --- | --- | --- |
| `apex_send` | command | `{ message: string }`: one JSON-RPC line to the sidecar's stdin |
| `apex://message` | event | string: one JSON line from the sidecar's stdout |
| `apex://reset` | event | `SidecarStatus`: the sidecar died or was restarted |
| `sidecar_status`, `sidecar_restart` | command | → `SidecarStatus { running, pid?, restarts, keySource }` |
| `key_set { key }`, `key_exists`, `key_delete` | command | OS keychain (service `apex-galaxia`, account `anthropic`) |
| `app_paths` | command | → `{ resources, userDir, appData }` |

The sidecar is spawned with `APEX_GALAXIA_RESOURCES` pointing at the bundled `narrators/`,
`prompts/`, `style/`, `evals/` and `ANTHROPIC_API_KEY` from the keychain when present; its
lifetime is bound to the window (killed on close, restarted on crash with an `apex://reset`).
