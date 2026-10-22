# Session report: 2026-10-22 (second session), Phase 2 acceptance and Phase 3

## Done

- Phase 2 acceptance in this repository with Claude Code as the model: `/new-story` on a scratch
  project (`stories/`, git-ignored): project from the CLI, three Bible entries, beat sheet through
  `task_prepare` / `task_submit`, a 1,376-word Russian chapter through the same pair (contract
  passed, one lint warning shown, not fixed), `suggestion_accept`, chronicle proposal with 31
  operations previewed and applied, summary cached; every file landed where `docs/project-format.md`
  says. One defect found and fixed: four templates that embed the chapter (`summary.chapter`,
  `chronicle.propose`, `check.bible`, `extract.bible`) also received the manuscript window, about
  3,500 tokens per call; templates now declare `window: none`.
- MCP server for the app: `model_status`, `chapter_save` (the Author's edits), `chapter_create`,
  `project_settings_update`, `user_config_get/set`, `bible_list`, `bible_remove`, `plan_get/save`,
  `lint_whitelist_add`, `voice_card`, `narrator_options`, background runs (`run_start/pause/get/list`)
  with live events as logging notifications; Write streams text over `notifications/progress`;
  `suggestion_accept` takes `edited_text`; `runBook` pauses at stage boundaries on an abort signal;
  a scripted stand-in model (`APEX_GALAXIA_SCRIPTED=1`) for dev mode and UI tests, reported as such.
- Phase 3, the desktop app (`apps/desktop`, `docs/desktop.md`):
  - Tauri 2 shell: the MCP server runs as a Node sidecar over stdio (ADR 0010 accepted), relayed by
    `apex_send` and the `apex://message` event; restart with backoff; key in the OS keychain;
    folder and file pickers; app paths. Sidecar packaging: one CJS bundle plus the Node runtime as
    the external binary, verified by a stdio self-check. CI builds installers for Linux, Windows
    and macOS (`desktop.yml`).
  - Frontend: transports (shell, dev bridge, mock), an MCP client with progress tokens and reset
    handling, a typed client for every tool, a zustand store, strings per feature in Russian and
    English with a test that keeps them in step, design tokens for light and dark, bundled Inter
    and Literata.
  - CodeMirror 6 prose editor with typewriter scrolling, lint underlines with hover explanations and
    a one-click whitelist, idle lint and autosave; project tree; top bar and status bar; resizable
    frame; focus mode; welcome screen with recent projects.
  - Command palette with 46 actions and shortcuts; suggestion block with streaming, editable text,
    Accept, Retry, Retry with note, Discard and the chronicle offer; per-paragraph diffs for
    Rewrite, Weave and de-AI with optional lesson capture; Describe; the right panel (Bible,
    Chronicle with the handover, Lint, Critic, Inspector); the chronicle update dialog.
  - First-run and story setup wizards with explanations from the narrator profile; Bible,
    chronicle, plan and run views; project and user settings with key management.
  - A dev bridge for browser development and a Playwright smoke test of the whole stack minus the
    shell: open a project, create a chapter, type, autosave, write, accept; the chapter file changes
    only on accept and the call log records the generation and the acceptance.
- Documentation: `docs/desktop.md`, ADR 0010 accepted, architecture and harness-mode updated,
  CHANGELOG, README status (also converted from UTF-16 to UTF-8).

## Verified how

- `pnpm install && pnpm build && pnpm lint && pnpm test`: 29 test files, 162 tests (packages and
  the desktop as two Vitest projects); `pnpm --filter @apex-galaxia/desktop typecheck` and `build`
  clean; the smoke test passes here with the preinstalled Chromium (`APEX_CHROMIUM`).
- Server integration test over stdio with the scripted model: settings, chapters, Bible, plan,
  user config (a key in it is refused), streamed deltas, edited accept, background run with pause
  and resume, whitelist, narrator options, voice card.
- The Rust shell: `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings`, a Linux deb
  built with `tauri build --debug`, and a headless lifecycle test under Xvfb (bundled runtime
  spawned with the resources, three crash restarts then staying down, no orphan on exit).
- Each frontend feature was driven in a real browser against the bridge and the scripted model
  by the agent that built it, with screenshots checked and the defects they showed fixed (focus
  ring on the editor, top bar clipping, panel geometry, plural forms, a shortcut collision).

## Not done

- A real Tauri session with a window: kill on window close, the keychain happy path and the
  production CSP are verified only by reading the code or through error paths.
- Windows and macOS builds and installers ran only as workflow definitions, not here.
- No screen-reader audit; drag reordering in the plan; the chronicle diff log in the chronicle
  view; `window.prompt` for chapter titles; the voice sample cannot use the native file picker.
- Real-API verification, a recorded cassette, the golden set and the first real eval: still no key
  and no TF2 folder in this environment.
- The narrator's chat panel (Phase 4), the pannable board and pairwise A/B (Phase 5).

## Decisions taken

- ADR 0010 accepted: Node sidecar over MCP; the Node runtime shipped as the Tauri external binary
  with one CJS bundle (not Node's single-executable packaging); keyring for the keychain with the
  CLI's `.env` as the Author-written fallback; no port opened by the app.
- A scripted stand-in model exists for development and tests only, selected explicitly and always
  labelled.
- Four agents built the shell, the editor and frame, the actions and the wizards and views in
  parallel with disjoint file ownership; the orchestrator owned the shared files and integrated
  their patches.

## Next step

Phase 3 acceptance by the Author on a desktop: install the deb or build with `pnpm tauri:dev`,
run the first-run wizard with a real key, write a chapter; report what the window does that the
browser could not show. Then Phase 4 per the build prompt: the narrator's chat panel, research
mode in the app, and the first real eval run once a key and the golden set exist.
