# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog;
versions follow semantic versioning once v1.0.0 is tagged.

## [Unreleased]

### Added

- pnpm monorepo with `@apex-galaxia/core`, `@apex-galaxia/adapters`, `@apex-galaxia/cli`, `@apex-galaxia/mcp-server`.
- Story project format (format version 1) with Zod schemas exported as JSON Schema, atomic writes, trash moves, migrations.
- Story Bible with bilingual aliases, inflection-aware activation, pins, always-on and secrets; series Bible.
- Chronicle: YAML state with validated diff operations, reader-safe log, hidden block, handover, Randy's d20.
- Gwen narrator profile as data: persona, storytellers, harshness, ratings, lengths, commands, brief, hard limits.
- Prompt templates for every task, Russian and English language modules, output contracts.
- Context assembler with the fixed layer order, token budget, trimming priority and inspector record.
- Tier-one AI-tell linter (19 rules, RU/EN) with a tested fault set and project whitelist.
- Style memory: house rules, banned phrases, critic rubric, dated lessons with provenance.
- Harness pipeline: estimate and budget check, logged generation, output contract with one retry, lint, suggestions applied only on accept; planning, chronicle proposals, summaries, critic, Bible check and extraction, describe, rewrite diffs, lessons, directions, voice card; prepare/submit for clients that are the model.
- Anthropic adapter on the official SDK (streaming, caching, effort, structured outputs, exact token counts, optional refusal fallback); record-and-replay adapter; NoModel adapter.
- `apex` CLI: new, open, write, accept, discard, suggestions, lint, lint-rules, plan, chronicle, summarize, check-bible, critic, describe, rewrite, directions, bible add/list/extract, inspect, export (md).
- MCP server over stdio with tools, resources and prompts; `.mcp.json`, `CLAUDE.md`, six skills, four subagents, a lint-on-save hook; an integration test over stdio.
- Russian dialogue punctuation normalizer applied before a suggestion is shown.
- Muse Layer: presets fast / balanced / best, critic pass, bounded revision loop on quoted spans, stages recorded.
- Autonomous runs (`apex run`): chapter-by-chapter plan, write, accept, chronicle, summary, export and reader's report; resumable state; outline gate for long stories; budget pause.
- Lesson capture from edits (`apex lesson`, `apex accept --edited --lesson`, MCP `lessons_propose` / `lessons_add`).
- Eval suite (`apex eval`, MCP `eval_run`) and `/improve` (`apex improve`): variants, baselines, deltas, proposals that are never auto-applied.
- Canvas in the core: cards, links, lanes from structure templates, collapse to outline, promotion into the Bible and the plan; AI actions expand, what if, find the gun, collapse (`apex canvas`, MCP `canvas_*`).
- Exports to Markdown, DOCX and EPUB 3 (`apex export --format`, MCP `export_book`); Weave for Describe options (`apex weave`, MCP `weave`).
- Two sample projects (Russian and English); CI for Ubuntu, Windows and macOS.
- MCP app tools for the desktop: `model_status`, `chapter_save`, `chapter_create`, `project_settings_update`, `user_config_get/set`, `bible_list`, `bible_remove`, `plan_get/save`, `lint_whitelist_add`, `voice_card`, `narrator_options`, background runs (`run_start/pause/get/list`) with live events; streamed Write output over `notifications/progress`; `suggestion_accept` with `edited_text`; a scripted stand-in model for dev mode and UI tests (`APEX_GALAXIA_SCRIPTED=1`), always reported as such.
- Desktop app (`apps/desktop`, Phase 3): Tauri 2 shell with the MCP server as a Node sidecar over stdio (ADR 0010), React frontend with a CodeMirror 6 prose editor, project tree, right panel (Bible, Chronicle, Lint, Critic, Inspector), command palette, inline suggestion block with streaming, per-paragraph diffs for Rewrite and Weave, Describe, chronicle update dialog, story setup and first-run wizards, Bible, chronicle, plan and run views, settings, light and dark themes, Russian and English interface; a dev bridge for browser development and a Playwright smoke test against the scripted model; installers built in CI.
- Documentation: competitive analysis, ADRs, attribution, architecture, project format, prompts, harness mode.
