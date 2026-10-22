---
name: check-bible
description: Check a chapter against the Story Bible and the chronicle (appearance, who knows what, timeline, world rules, names) and propose fixes to the text or to the Bible; or extract new Bible entries from a chapter. Use for «сверь с библией», «проверь непротиворечивость», "check continuity", "extract characters".
argument-hint: [project-folder] [chapter number] [--extract]
---

Arguments: `$ARGUMENTS`.

- Check: `task_prepare` with `task: "check.bible"` and the chapter. Read every entry and the state the prompt includes; list each contradiction as JSON per the schema: the chapter span, the conflicting Bible or chronicle line, a fix prefixed `text:` or `bible:`. `task_submit`. Present the list; apply nothing yourself. A `text:` fix becomes a rewrite suggestion only if the Author asks; a `bible:` fix becomes a `bible_upsert` only after confirmation.
- Extract (`--extract`): `task_prepare` with `task: "extract.bible"`, produce the proposals JSON (new or changed entries, each with the supporting line), `task_submit`. Show them; write confirmed ones with `bible_upsert`, keeping the entry template sections (Summary, True now, History, Appearance, Voice, Wants, needs, obstacle, Relationships, Secrets, Sources).
- Never record a character's psychology the text does not show; record what is on the page.
