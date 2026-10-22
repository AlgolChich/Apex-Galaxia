# Fault set

Passages with seeded faults, one file per language and theme. Each file's front matter lists
the linter rules that must fire on it (`expect`) and, optionally, rules that must not
(`forbid`). The test `packages/core/test/lint.test.ts` loads every file here and fails if a
seeded tell goes uncaught, so adding a fault here is the way to extend the linter honestly.

The clean passages (`clean.*.md`) are the control group: the rules listed in `forbid` must stay
silent on them. Text is original and written for this purpose; it is not drawn from any
published work.
