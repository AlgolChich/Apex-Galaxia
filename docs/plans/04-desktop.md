# Phase 3 plan: desktop MVP

Goal (Section 12): installers for Windows, macOS and Linux built in CI; first run to first Write
under three minutes; Write, Describe and Rewrite from the UI; a 100,000-word manuscript opens
without lag. Architecture: ADR 0001 and ADR 0010.

Prerequisites from the Author: confirm ADR 0010 (Node sidecar over MCP) or choose Electron; the
build environment of this session has no webkit2gtk, so Tauri builds must run in CI or on the
Author's machine.

- [ ] `apps/desktop`: Tauri 2 shell, React + TypeScript + Vite, CodeMirror 6 with a Markdown mode and Cyrillic-capable fonts (Inter for UI, Literata or PT Serif for prose).
- [ ] Sidecar packaging: the MCP server as a single executable per platform; Tauri external binary; spawn, relay, kill, restart.
- [ ] Typed MCP client in the frontend generated from the server's tool list; streaming notifications for Write.
- [ ] Layout (11.1): project tree left; distraction-free serif editor center with typewriter scrolling, word count and in-story date in the status bar; right panel with Bible, Chronicle, Lint, Critic, Inspector; collapsible; focus mode.
- [ ] Actions (11.2): command palette (Ctrl/Cmd+K) listing every action with its shortcut; inline suggestion block with Accept, Retry, Retry with note, Discard, model and cost in small print; Rewrite, Weave and de-AI as diffs with per-paragraph accept or reject; lint underlines with severity and hover explanations; whitelist in one click; inspector view of the last prompt.
- [ ] Story setup wizard (11.3) from the brief template with one-line explanations per control; an empty wizard still produces a working project.
- [ ] Views (11.4): Bible cards; chronicle timeline with folded state diffs; plan as a reorderable outline; autonomous mode progress screen with the streaming chapter, cost so far and a pause button (`runBook` already saves state after every stage).
- [ ] Look and feel (11.5): typography-led, light and dark themes, a faint Park Planet accent only in the narrator's chat panel and empty states; no emoji, no mascots on the page.
- [ ] Languages and accessibility (11.6): UI strings in resource files for Russian and English, switchable at runtime; keyboard navigation everywhere; scalable text; screen-reader labels.
- [ ] First run (11.7): UI language, API key into the keychain (never shown again), create or import a project, optional voice sample.
- [ ] CI: installers for the three platforms; a desktop smoke test (open, write, accept) against the replay adapter.
- [ ] Performance: a 100,000-word manuscript opens and scrolls without lag (CodeMirror virtualizes; the window and summaries keep prompts bounded).
