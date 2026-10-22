# ADR 0003: Project format — Markdown + YAML folder with JSON Schemas

Status: accepted as the proposed default (gate question 4)

## Context

Section 9 asks for a folder the Author can open in any editor, diff in git and move between machines. novelWriter's 2026 move to one Markdown file per document with a header block, and Manuskript's folder mode, confirm the pattern; Scrivener's RTF-in-XML package is the anti-pattern.

## Decision

- `project.yaml` for settings with `format_version`; Markdown with YAML front matter for prose and Bible entries; YAML for state and plans; JSON only for the canvas and logs.
- Zod schemas in `packages/core/src/project/schemas.ts` are the source of truth; `pnpm schemas` exports them as JSON Schema into `packages/core/schemas/` and a test fails when the two drift.
- The core validates on load and refuses to write an invalid file.
- Migrations live in code, keyed by `format_version`, with a backup of the old `project.yaml` under `history/migrations/`.
- Deleting is a move to `_trash/`. Chapters are never rewritten by the harness; suggestions go to `history/suggestions/` and apply only on accept.
- Caches are rebuildable: summaries under `chronicle/summaries/` carry the source hash; a search index, if added, lives beside them.

## Consequences

- Any text editor, any sync tool, any git host works.
- Schema changes are deliberate: a new field means a schema change, a regenerated JSON Schema, and a migration when it breaks existing projects.
