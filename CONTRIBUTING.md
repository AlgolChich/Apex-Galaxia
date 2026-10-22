# Contributing

## Ground rules

- Code, comments, commit messages, docs, tests and prompt templates are in English. UI strings
  come in English and Russian in the same commit.
- Conventional commits (`feat(core): …`, `fix(lint): …`, `docs: …`). Every commit leaves
  `pnpm lint && pnpm build && pnpm test` green.
- No stub behind a visible feature. If something is not wired end to end, it is not listed as done.
- Keep secrets and private stories out of the repository: `.env*` and `private/` are ignored.

## Setup

```bash
pnpm install
pnpm build          # tsc for every package (the MCP server needs dist/ for .mcp.json)
pnpm test           # vitest; no network, the replay adapter stands in for the model
pnpm lint
pnpm schemas        # after changing packages/core/src/project/schemas.ts
```

## Where to add things

| Change | Where | Test |
| --- | --- | --- |
| A linter rule | `packages/core/src/lint/rules.ts` + a seeded case in `evals/fault-set/` | `lint.test.ts` fails until every rule id is covered |
| A prompt | `prompts/<task>.md` with front matter | `prompts.test.ts` loads every template |
| A file format field | `schemas.ts`, then `pnpm schemas` and a migration if it breaks projects | `project.test.ts` compares the committed JSON Schemas |
| A narrator table | `narrators/gwen/*.yaml` | `narrator-style.test.ts` |
| A CLI command | `packages/cli/src/program.ts` | the CI smoke test |
| An MCP tool | `packages/mcp-server/src/server.ts` | `server.test.ts` runs the server over stdio |

## Recording a replay cassette

`APEX_GALAXIA_CASSETTE=path/to/cassette.json` with an API key records responses by prompt hash;
without a key the same file replays them. Commit cassettes only for fixtures that contain no
private text.

## Session discipline (for Claude Code sessions)

Read `CLAUDE.md` and the latest `docs/reports/`, pick the next unchecked item of the current
phase plan in `docs/plans/`, work in small verified steps, run the tests before claiming anything,
tick the plan, write the report, close with the Russian summary.
