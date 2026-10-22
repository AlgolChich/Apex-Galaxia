# Phase 2 plan: headless harness mode

Goal (Section 12): MCP server, `CLAUDE.md`, skills, agents; a fresh Claude Code session in the
repository, with no app installed, runs `/new-story` and leaves a chapter and a chronicle entry
in a project folder; the MCP server passes an integration test; the Author's TF2 project
round-trips through import, Write and chronicle update.

- [x] `packages/mcp-server`: stdio server with project, Bible, chronicle, lint, suggestion, prepare/submit, model-backed and research tools; resources; prompts.
- [x] `.mcp.json` registration; `.claude/settings.json` pre-approval and permissions.
- [x] Root `CLAUDE.md`: what the project is, how to run it, where things live, house conventions, the two generation paths.
- [x] Skills: `new-story`, `write-chapter`, `update-chronicle`, `lint-prose`, `check-bible`, `research-lore`.
- [x] Subagents: `writer`, `critic`, `researcher`, `chronicler`, each with the tools its job needs.
- [x] Hook: lint a chapter on Write/Edit, reported as additional context, never blocking.
- [x] Integration test over stdio without a key: project, Bible, plan with the d20, chapter with a contract retry, accept, chronicle, summary, lint, research sanitizer, model-tool error.
- [x] `docs/harness-mode.md`.
- [ ] `/improve` skill (needs the Phase 5 eval suite; not shipped as a stub).
- [ ] Acceptance by the Author: run `/new-story` in a fresh Claude Code session and confirm a chapter and a chronicle entry appear (the automated test covers the same path through the MCP server).
- [ ] Dogfood on the Author's TF2 project («Черепа и Кости: часть 1», four chapters): import as a private fixture, run `/write-chapter` and `/update-chronicle`. Needs the Author to provide the folder.
