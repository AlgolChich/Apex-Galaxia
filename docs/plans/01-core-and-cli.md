# Phase 1 plan: core and CLI

Goal (Section 12): project format, Bible, chronicle, context assembler, Anthropic adapter, Write,
tier-one linter, tests; `pnpm test` green; `apex new` then `apex write --continue` produce prose
in both languages from the sample project; the linter catches every seeded tell.

- [x] Monorepo skeleton: pnpm workspaces, strict TypeScript, Vitest, ESLint, Prettier, CI on three OSes.
- [x] Project format: schemas (Zod → JSON Schema), store with validation and atomic writes, trash, history, migrations, scaffolder.
- [x] Bible: entries with sections in both languages, alias activation with Russian morphology, pins, always-on, secrets, series Bible, templates.
- [x] Chronicle: state ops (set, merge, append, remove, unset), proposals applied on confirmation, reader log, hidden block, handover, rolls.
- [x] Narrator profile (Gwen) as data files with a loader; planner rules by storyteller and harshness; the d20 in code.
- [x] Style memory: house rules seed, banned phrases RU/EN, rubric, lessons with provenance, project additions and whitelist.
- [x] Prompt library: templates with front matter, partials, placeholders, language modules, user overrides.
- [x] Context assembler: layer order, token budget, trimming priority, inspector record and renderer.
- [x] Linter: 19 deterministic rules, bilingual messages, offsets, whitelist; fault set with every rule covered; clean controls.
- [x] Adapter contract, model registry with prices, call log; Anthropic adapter; replay adapter; NoModel adapter.
- [x] Harness: write modes, output contract with retry, suggestions and accept, planning, chronicle proposals, summaries, critic, Bible check and extraction, describe, rewrite diffs, lessons, directions, voice card, budget stop, estimates.
- [x] CLI with every Phase 1 command; samples in Russian and English; CI smoke test.
- [ ] Verify `apex write --continue` against the real API in both languages and commit a replay cassette (needs the Author's key; the pipeline is verified offline with a scripted model).
- [ ] Russian punctuation auto-fix before showing (the linter flags it; the `rewrite.punctuation` operation fixes on request; automatic repair is wired into the preset in Phase 5).
