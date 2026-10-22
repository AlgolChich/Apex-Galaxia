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
- Two sample projects (Russian and English); CI for Ubuntu, Windows and macOS.
- Documentation: competitive analysis, ADRs, attribution, architecture, project format, prompts, harness mode.
