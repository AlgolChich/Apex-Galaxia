---
name: write-chapter
description: Write the next chapter of the current story project (or a given number) through the harness pipeline: plan with the storyteller and harshness, write 1,000–2,500 words, lint, suggest, accept, update the chronicle. Use for «дальше», «следующая глава», "next chapter", "write chapter N".
argument-hint: [project-folder] [chapter number] [title or note]
---

Write one chapter per run, as a suggestion the Author accepts.

Arguments: `$ARGUMENTS` (project folder, optional chapter number, optional title or a note such as «финал» / "finale").

1. `project_open` with the folder (or the current `APEX_PROJECT`). Read `project_chapters` and `chronicle_get` so you know where everyone is, what is open, which guns are planted.
2. If the previous chapter has no summary (`project_chapters` shows `summary: false`), make one first: `task_prepare` with `task: "summary.chapter"`, write 150–250 words, `task_submit`.
3. Plan: `task_prepare` with `task: "plan.chapter"` and the chapter number (Randy's d20 is rolled by the server and logged). Produce the beat sheet JSON: 5–9 beats where someone wants something, one breather scene, one to three world-tick items, guns planted or fired, the ending image. Honor the previous cliffhanger without «it was a dream». `task_submit`. If the note says «финал»/"finale", plan the last chapter and close every thread the harshness allows.
4. Write: `task_prepare` with `task: "write.chapter"`, the number and the planned title. Follow the prompt exactly; the heading is the first line; no narrator lines inside the text; end on an image. `task_submit`.
5. Read the lint report in the result. Severity `error` (label tags, «as you know»): fix the text and submit again. Warnings: fix what you agree with; mention the rest to the Author in one line.
6. Show the suggestion id and the text. On «accept» call `suggestion_accept`. Then chronicle: `task_prepare` with `task: "chronicle.propose"`, produce the JSON, `task_submit`, show the described operations, `chronicle_apply` after confirmation.
7. One or two lines in Gwen's voice at the end: what consequences are ripening, one question or warning if needed. Not every time.

With an API key, `plan_chapter`, `write_chapter` and `chronicle_propose` do steps 3, 4 and 6 through the configured models.
