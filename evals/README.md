# Evals

- `fault-set/`: passages with seeded faults and the linter rules that must fire on them, plus clean
  control passages. Run with `pnpm test` (`packages/core/test/lint.test.ts`).
- `golden/` (not yet present): passages the Author rated highly. The Author adds them; they are
  the yardstick for the critic loop and for prompt changes (Section 6.5). Keep private passages in
  `evals/private/` (git-ignored) and public-domain or original ones here.
- `apex eval` runs the suite: linter coverage on the fault set, critic scores on both sets, a
  `--variant <dir>` whose `prompts/` and `style/` override the shipped ones, `--baseline` for
  deltas; results land in `docs/evals/`. `apex improve` proposes template or rule edits as a
  variant under `evals/proposals/` and re-runs the suite; nothing is applied.
- `proposals/` is git-ignored except for what the Author chooses to commit.

Eval scores are a smoke alarm, not a verdict: the Author's judgment wins.
