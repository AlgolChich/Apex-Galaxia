---
name: lint-prose
description: Run the bilingual AI-tell linter (tier one, deterministic) on a chapter or a passage and explain each hit; optionally propose a de-AI rewrite as a paragraph diff. Use for «проверь на ИИ», «линтер», "lint this", "does this read like AI".
argument-hint: [file or chapter number] [--fix]
---

Arguments: `$ARGUMENTS`.

1. For a file: `lint` tool with `file`. For a chapter number in the current project: `lint` with `chapter`. For pasted text: `lint` with `text` and `language`.
2. Report hits grouped by severity with the one-line explanation each carries, in the Author's language. Rule ids and what they catch are in `apex lint-rules`; the lists live in `style/banned-phrases.*.txt`.
3. If the Author asks to fix (or `--fix`): `task_prepare` with `task: "rewrite.deai"` and the passage; rewrite following the contract (keep every fact and beat, replace a tell with action, a detail or silence), `task_submit`. Show the result as a paragraph diff. The Author accepts per paragraph; never overwrite the chapter yourself.
4. A phrase the Author wants kept goes into the project's `style/lint-whitelist.txt` (one per line); say so when a hit is a false positive.
