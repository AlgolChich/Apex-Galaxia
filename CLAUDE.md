# Apex Galaxia

A free, open-source, local-first creative-writing harness for Claude: a Story Bible, a chronicle
that keeps long stories consistent, a narrator system (storytellers, fate harshness, ratings), a
bilingual AI-tell linter and a write pipeline whose prose is always a suggestion until the
Author accepts it. One TypeScript core serves the desktop app (later), the `apex` CLI and the
MCP server that Claude Code uses in this repository. Stories live as Markdown and YAML in a
project folder; nothing here phones home.

The human you work with is the Author («Автор»). Code, comments, commits and docs are in
English; the stories are in Russian or English per project; the final comment of a session is
in Russian (see `docs/plans/` and `docs/reports/` for the format).

## Run it

```bash
pnpm install && pnpm build && pnpm test      # clean clone to green
node packages/cli/dist/bin.js --help          # or: pnpm apex -- --help
pnpm apex -- open samples/ru-mayak            # a shipped sample project (Russian)
pnpm apex -- lint samples/en-ferry/chapters/01-eleven.md --project samples/en-ferry
```

Model calls need `ANTHROPIC_API_KEY` in the environment or in `~/.apex-galaxia/.env`. Without a
key, the headless flow below still works: Claude Code itself is the model.

## Where things live

| Path | What |
| --- | --- |
| `packages/core` | All logic, no UI: project store, Bible, chronicle, context assembler, linter, harness |
| `packages/adapters` | Anthropic adapter (official SDK) and the record-and-replay adapter for tests |
| `packages/cli` | The `apex` command |
| `packages/mcp-server` | MCP server over stdio, registered in `.mcp.json`; the desktop's sidecar |
| `apps/desktop` | Tauri 2 shell + React frontend; talks to the core only through the MCP sidecar (ADR 0010) |
| `narrators/gwen` | The default narrator profile as data: persona, storytellers, harshness, ratings, brief |
| `prompts/` | One template per task; `prompts/lang/` holds the Russian and English modules |
| `style/` | House rules, banned phrases (RU/EN), critic rubric, seed lessons |
| `evals/fault-set` | Seeded tells the linter must catch (tested) |
| `samples/` | Two small story projects, Russian and English |
| `docs/` | architecture, project format, prompts, harness mode, decisions (ADRs), plans, reports |

A story project's layout is in `docs/project-format.md`. Schemas: `packages/core/schemas/`.

## Headless harness mode (this repository in Claude Code)

The MCP server `apex` is registered in `.mcp.json`. Skills in `.claude/skills/` drive the
workflow; subagents in `.claude/agents/` split writer, critic, researcher and chronicler.

Two ways to generate text:

1. **With an API key**: tools such as `write_continue`, `write_chapter`, `chronicle_propose`
   call the configured models through the core and return suggestions.
2. **Without a key, Claude Code is the model**: call `task_prepare` to get the fully assembled
   prompt (system layers and user turn, with the context inspector), write the output yourself
   following that prompt exactly, then call `task_submit` with the text. The core runs the same
   output contract, linter and suggestion pipeline on it. The Author accepts with
   `suggestion_accept`; nothing reaches a chapter otherwise.

Rules that hold in both modes:

- Never edit a file under `chapters/` directly; prose goes through suggestions and `suggestion_accept`.
- Never write to `chronicle/` by hand; propose, show the diff, apply only after the Author's confirmation (or in autonomous mode with the diff log).
- Never invent canonical facts for a fandom; unconfirmed goes into the dossier as unconfirmed.
- Hard limits in `narrators/gwen/hard-limits.md` never move.
- Russian prose: em-dash dialogue, «ёлочки», the project's ё policy; English: no said-bookisms, no em-dash chains.
- Run the linter on any chapter you touch (`lint` tool or `apex lint`). Hits are shown to the Author, not silently fixed.

## Conventions

- Conventional commits; every commit leaves `pnpm build && pnpm test && pnpm lint` green.
- Strict TypeScript, ESM, `.js` extensions in relative imports, no default exports in the core.
- Tests live in `packages/*/test`; no network in unit tests (use the replay adapter).
- Keep secrets out: no keys in the repo, no private stories (`private/` is git-ignored).
- When a session ends: write `docs/reports/YYYY-MM-DD-<slug>.md`, tick the phase plan in `docs/plans/`, close with the Russian summary.
