# Architecture

One TypeScript core serves three clients; every model call goes through one adapter layer;
every story is a folder of plain files.

```
Desktop app (Tauri 2 + React, Phase 3) ──in-process──┐
Claude Code (CLAUDE.md · skills · agents) ──► MCP server (stdio) ──┤
CLI (apex new · write · lint · chronicle …) ───────────────────────┤
                                                                   ▼
            @apex-galaxia/core: one library, no UI dependencies
  [ProjectStore] [Bible + activation] [Chronicle] [Context assembler] [Linter]
  [Narrator profiles] [Style memory] [Prompt library] [Harness: write pipeline]
                 │                                          ▲
                 ▼                                          │ reads and writes
   Model adapters (Anthropic · replay · NoModel)      Story project on disk
                 │ HTTPS                                (Markdown · YAML · JSON)
                 ▼
   Claude API: Fable 5.1 (plan, critic), Opus 5.5 (prose), Haiku 5.5 (extract, summary, lint)
```

## Packages

| Package | Role |
| --- | --- |
| `@apex-galaxia/core` | All logic. `project/` (layout, schemas, store, migrations, scaffold), `bible/` (entries, activation), `chronicle/` (state ops, log, handover), `narrator/` (profile loader, dice), `style/` (house rules, lessons, banned phrases), `prompts/` (template library), `context/` (token counting, assembler, inspector), `lint/` (rules, runner), `write/` (contracts, diff, harness), `adapters/` (interface, registry, logging, NoModel), `research/` (dossier sanitizer). |
| `@apex-galaxia/adapters` | `AnthropicAdapter` on the official SDK; `ReplayAdapter` (record and replay by prompt hash); `createAdapter()` resolves keys from the environment or `~/.apex-galaxia/.env`, never from a repository. |
| `@apex-galaxia/cli` | The `apex` command (commander). Thin: every command is a few lines over the harness. |
| `@apex-galaxia/mcp-server` | MCP server over stdio: tools, resources and prompts over the same harness; the prepare/submit pair lets the client be the model. |

## The pipeline of one generation

1. **Assemble** (`context/assembler.ts`). System layers in the fixed order: narrator profile, language module, house rules and project style, the task's output contract, rating and hard limits (last, cache breakpoint). User turn in the fixed order: task instruction, manuscript window (previous chapter tail plus the current chapter up to the cursor), Bible core (premise, glossary, world rules when planning), pinned and always-on entries, triggered entries, chronicle state, rolling summaries, voice card, lessons, settings line. Every part has variants (full, compacted, truncated); trimming runs in the Section 10.3 priority until the budget fits. The inspector records layers, tokens, actions, Bible activations with the alias that fired, lessons and recent rolls.
2. **Estimate and budget check** (`write/harness.ts`): tokens times list price; a project cap stops the call with `BUDGET_EXCEEDED`.
3. **Generate** through the adapter with streaming; the call is appended to `history/calls.jsonl` (prompt hash, model, tokens, cost, latency; acceptance is appended later as a superseding line).
4. **Output contract** (`write/contracts.ts`): prose tasks strip the stop marker, reject preambles, service lines and stray headings, and check the chapter heading; JSON tasks validate against the named schema. One retry with the violations appended; a second failure is surfaced.
5. **Lint** (`lint/`): tier one, deterministic, both languages; hits carry offsets and bilingual messages; the project whitelist suppresses accepted phrases.
6. **Suggestion**: prose is written to `history/suggestions/<id>.md` as pending with its anchor. `accept` is the only path into a chapter; `discard` records the decision.

Planning runs before chapter writes: the planner prompt receives the storyteller rhythm, the harshness definition and, for Randy, the d20 rolled in code and logged in the chronicle; it returns a beat sheet (JSON) that the writer follows. Prose prompts never see pacing rules (Section 10.7).

## Headless mode

`Harness.prepare(task)` returns the assembled prompt and a handle; `Harness.submit(prepared, output)` runs steps 4–6 on output the client produced. The MCP server exposes both as `task_prepare` and `task_submit`. ADR 0007.

## Privacy and security

- Keys: environment or `~/.apex-galaxia/.env`; never in a project or the repository.
- Network: the model endpoint only. Research in headless mode uses Claude Code's web tools; fetched text is sanitized of directive lines before it is stored (`research/save.ts`).
- Prompt injection: every content block in the user turn is wrapped in a delimited tag with a note that it is content, not instructions; the narrator layer repeats the rule.
- No telemetry, no analytics, no uploads elsewhere.

## Performance

Context assembly uses an in-process token counter (exact and cached when the adapter offers one, heuristic otherwise) and reads only the files it needs; the test suite's assembly of a two-chapter Russian project runs in tens of milliseconds. Streaming starts as soon as the provider sends the first delta.

## Seams for later phases

- `ModelAdapter` for OpenAI-compatible and Ollama adapters (ADR 0006 explains the sampling mapping).
- `TokenCounter` for exact counters from other providers.
- Retrieval: alias and keyword activation is deterministic; an embeddings index can implement the same `activateEntries` contract.
- Desktop: the harness is UI-free; the app renders suggestions, diffs and the inspector.
