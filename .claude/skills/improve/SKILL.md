---
name: improve
description: Improve the harness itself: run the eval suite (linter coverage on the fault set, critic scores on the golden and fault sets), propose up to three edits to prompt templates or house rules as a variant, re-run with the variant and show the delta. Never applies anything; the Author merges. Use for «улучши харнесс», «прогони евалы», "run the evals", "improve the prompts".
argument-hint: [--no-critic]
---

Arguments: `$ARGUMENTS`.

1. With an API key: run `node packages/cli/dist/bin.js improve` (add `--no-critic` for lint-only). It writes `evals/proposals/<stamp>/` with the proposed files under `variant/`, `baseline.json`, `variant.json` and `report.md`, and prints the report with the delta.
2. Without a key: call `eval_run` (lint only) for the baseline. Then read the files `/improve` may change (`prompts/contract.prose.md`, `prompts/write.chapter.md`, `prompts/write.continue.md`, `prompts/critic.md`, `prompts/revise.md`, `prompts/lang/ru.md`, `prompts/lang/en.md`, `style/house-rules.md`) and write at most three improved versions under `evals/proposals/<stamp>/variant/<same path>`, each targeting a weakness the report shows. Re-run `eval_run` with `variant_dir` pointing at that folder and compare.
3. Present to the Author: the baseline, the variant, the delta per criterion and per set, and the diff of each proposed file (`git diff --no-index prompts/x.md evals/proposals/<stamp>/variant/prompts/x.md`). Say plainly when a proposal lowers any score.
4. Never copy a proposal over a shipped file yourself; never remove a hard limit, a quality check, a language rule or the output contract. The Author merges what they accept.
5. The golden set is the Author's rated passages in `evals/golden/` (or `evals/private/golden/`, git-ignored). If it is empty, say so: without it the suite measures only the fault set, which is a smoke alarm, not a verdict.
