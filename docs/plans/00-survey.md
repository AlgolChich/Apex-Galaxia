# Phase 0 survey: the repository as found

Date: 2026-10-22. Branch surveyed: `main` at commit `25f65ee` ("first commit").

## What exists

The repository is a bare scaffold: a single `README.md` of 34 bytes, UTF‑16 encoded, containing the title `# Apex-Galaxia` and nothing else. There is no code, no configuration, no issues, no other branches, no CI, no license file.

| Item | Found | Decision |
| --- | --- | --- |
| `README.md` | UTF‑16 file with a title only | Replace with a UTF‑8 README in English and Russian (keeps the title) |
| Source code | none | Build the layout from Section 9 of the build prompt |
| Configuration, CI | none | Add pnpm workspace, TypeScript, Vitest, GitHub Actions |
| License | none | Proposed default: MIT (gate question) |
| Issues, PRs, other branches | none | Nothing to migrate |

Nothing is deleted or rewritten: the only existing file is re-encoded and extended.

## What is missing against the specification

Everything in Sections 4–11 of the build prompt. In the order the phases need it:

1. Monorepo skeleton: `packages/core`, `packages/adapters`, `packages/cli`, `packages/mcp-server`, `apps/desktop`, plus `narrators/`, `prompts/`, `evals/`, `docs/`.
2. Project format and schemas (Section 9), with `format_version` and migrations.
3. Story Bible store with alias activation; chronicle with YAML state and Markdown log.
4. Context assembler with a visible token budget and an inspector record.
5. Model adapter layer (Anthropic first) with record‑and‑replay for tests.
6. Write pipeline (continue, guided, scene, chapter) with output contracts.
7. Tier‑one AI‑tell linter in Russian and English; the fault set in `evals/`.
8. Narrator profile `narrators/gwen/` as data files (storytellers, harshness, ratings, brief, commands).
9. Headless harness mode: `CLAUDE.md`, `.claude/skills`, `.claude/agents`, hooks, `.mcp.json`.
10. Desktop app (Tauri 2 + React), later phases.

## Proposed layout

```
ApexGalaxia/
  CLAUDE.md                 headless harness entry point
  .claude/skills/           new-story, write-chapter, update-chronicle, lint-prose, check-bible, research-lore, improve
  .claude/agents/           writer, critic, researcher, chronicler
  .mcp.json                 registers packages/mcp-server over stdio
  packages/core             all logic, no UI dependencies (project store, bible, chronicle, context, write, lint, narrator)
  packages/adapters         model adapters: anthropic, replay (tests); seams for openai-compatible and ollama
  packages/cli              `apex` command
  packages/mcp-server       MCP server over stdio exposing the core
  apps/desktop              Tauri 2 + React (Phase 3)
  narrators/gwen            persona, storytellers, harshness, ratings, brief template, commands (YAML + Markdown)
  prompts/                  one template per task, language modules in prompts/lang/
  style/                    seed house rules, banned phrases, rubric
  evals/                    golden set, fault set, runner
  samples/                  a public-domain sample project (shipped)
  docs/                     architecture, harness-mode, prompts, project-format, decisions/, plans/, reports/, evals/
```

## Toolchain found in the build environment

Node 22.22, pnpm 10.28, npm 10.9, Rust toolchain (cargo, rustc) present, Python 3.13. Enough for Phases 1–2; the Tauri build in Phase 3 needs platform packages on each OS and is done in CI.
