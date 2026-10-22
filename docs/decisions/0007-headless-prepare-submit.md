# ADR 0007: In headless mode the client may be the model (prepare / submit)

Status: accepted

## Context

Section 8.4 wants the repository usable from Claude Code with no app installed. A Claude Code session already has a capable model; requiring a second API key for the MCP server to call the API would double the cost and the setup.

## Decision

Every task has two paths through the harness:

1. Model-backed tools (`write_continue`, `write_chapter`, `plan_chapter`, `chronicle_propose`, …) call the configured models through the adapter when a key exists.
2. `task_prepare` returns the fully assembled prompt (system layers, user turn, inspector, estimate) and a handle; the client generates the output; `task_submit` runs the same output contract, linter and finisher (suggestion, beat sheet, chronicle preview, summary cache). Submitted calls are logged with provider `claude-code` and cost zero.

Prepared prompts are kept in memory and mirrored under `history/prepared/` so a restarted server can still accept a submission.

## Consequences

- Headless mode works with zero keys; the acceptance test runs without network.
- The skills and agents describe both paths; the prepare/submit path is the default in their instructions.
- Quality controls apply equally to both paths because they live in `Harness.submit`, not in the adapter.
