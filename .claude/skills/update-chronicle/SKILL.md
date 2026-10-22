---
name: update-chronicle
description: Propose and apply the chronicle update for a chapter (state diff, reader-safe log entry, hidden block), or print the full handover («летопись») for continuing the story elsewhere. Use for «летопись», «обнови летопись», "update the chronicle", "handover".
argument-hint: [project-folder] [chapter number | --full]
---

Arguments: `$ARGUMENTS`.

- With `--full` (or «полная»/«для передачи»): call `chronicle_get` with `full: true` and show the reader-safe part first, then the block «Скрыто от читателя» separately, labeled as such.
- With a chapter number: `task_prepare` with `task: "chronicle.propose"` for that chapter. Produce the proposal JSON: a reader-safe `summary` of 2–4 sentences (only what already happened), an optional `hidden` note for the planner (guns planted, setups), `in_story_time`, and `ops` against `state.yaml` (locations, condition with wounds and fatigue, inventory, knowledge, relations, open_threads, planted_guns, pending_consequences). Use character slugs from the Bible. `task_submit` validates it and returns the described operations.
- Show the described operations and the summary to the Author. Apply with `chronicle_apply` only after they confirm. Never edit `chronicle/` by hand.
- Without arguments: `chronicle_get` and report where everyone is, what is open, what is ripening, in 3–5 lines.
