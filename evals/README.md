# Evals

- `fault-set/`: passages with seeded faults and the linter rules that must fire on them, plus clean
  control passages. Run with `pnpm test` (`packages/core/test/lint.test.ts`).
- `golden/` (not yet present): passages the Author rated highly. The Author adds them; they are
  the yardstick for the critic loop and for prompt changes (Section 6.5). Keep private passages in
  `evals/private/` (git-ignored) and public-domain or original ones here.
- The eval runner (prompt-variant runs scored by the critic on both sets, results under
  `docs/evals/` with dates and model versions) is Phase 5 scope and is not shipped yet.

Eval scores are a smoke alarm, not a verdict: the Author's judgment wins.
