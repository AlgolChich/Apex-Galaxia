# Phase 3 plan: desktop MVP

Goal (Section 12): installers for Windows, macOS and Linux built in CI; first run to first Write
under three minutes; Write, Describe and Rewrite from the UI; a 100,000-word manuscript opens
without lag. Architecture: ADR 0001 and ADR 0010.

ADR 0010 (Node sidecar over MCP) was confirmed by default and accepted on 2026-10-22. The build
environment of the second session had webkit2gtk, so the Linux shell was compiled and bundled
here; Windows and macOS builds run in CI.

- [x] `apps/desktop`: Tauri 2 shell, React + TypeScript + Vite, CodeMirror 6 with a Markdown mode; Inter and Literata bundled as variable fonts under the OFL (Cyrillic verified).
- [x] Sidecar packaging: the MCP server as one CJS bundle plus the Node runtime as the Tauri external binary (ADR 0010); spawn, relay, kill, restart with backoff; verified with a Linux deb under Xvfb.
- [x] Typed MCP client in the frontend (one method per tool, written against the server rather than generated; the server test lists the tools the app relies on); streaming over `notifications/progress`, run events over logging notifications.
- [x] Layout (11.1): project tree left; distraction-free serif editor center with typewriter scrolling, word count and in-story date in the status bar; right panel with Bible, Chronicle, Lint, Critic, Inspector; collapsible and resizable; focus mode.
- [x] Actions (11.2): command palette (Ctrl/Cmd+K) listing every action with its shortcut; inline suggestion block with Accept, Retry, Retry with note, Discard, model and cost in small print; Rewrite, Weave and de-AI as diffs with per-paragraph accept or reject; lint underlines with severity and hover explanations; whitelist in one click; inspector view of what the next Write would see.
- [x] Story setup wizard (11.3) from the brief template with one-line explanations per control (from the narrator profile); an empty wizard still produces a working project (tested).
- [x] Views (11.4): Bible cards with an entry editor and extraction proposals; chronicle timeline with the state folded and the handover apart (the per-chapter diff log is not shown yet: no tool reads `history/chronicle-diffs.jsonl`); plan as a reorderable outline (buttons, no drag); autonomous mode progress screen with the streaming chapter, cost so far and a pause button.
- [x] Look and feel (11.5): typography-led, light and dark themes from one token file, the faint narrator accent only on the welcome screen and empty states; no emoji, no mascots. The narrator's chat panel itself is not built (Phase 4 scope).
- [x] Languages and accessibility (11.6): UI strings per feature in Russian and English, switchable at runtime, a test keeps both languages in step; keyboard navigation (palette, tree, dialogs with focus traps, resize handles); rem-based text; ARIA roles and labels. Not audited with a screen reader.
- [x] First run (11.7): UI language, API key into the keychain (never shown again; keychain error path verified here, happy path needs a desktop session), create or import a project, optional voice sample.
- [x] CI: installers for the three platforms (`desktop.yml`; only the Linux deb was built in this environment); a Playwright smoke test (open, write, accept) against the scripted stand-in model through the dev bridge: the whole stack minus the Tauri shell.
- [x] Performance: a 100,000-word manuscript mounts virtualized (a test asserts mount under 1.5 s in jsdom and a DOM far smaller than the text; measured about 0.3 s); the window and summaries keep prompts bounded.

## Left for the next sessions

- A real Tauri session on the Author's machine: window close kills the sidecar, the keychain
  happy path, the production CSP against the frontend, `tauri dev` with hot reload.
- Signed installers; releases attached to tags.
- The narrator's chat panel (Phase 4), the pannable board (Phase 5), pairwise A/B (Phase 5).
- Drag reordering in the plan; the chronicle diff log in the chronicle view; a dialog instead of
  `window.prompt` for chapter titles; a `readTextFile` shell service so the voice sample can use
  the native file picker.
