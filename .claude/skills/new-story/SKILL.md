---
name: new-story
description: Start a new story project from the brief template (universe, heroes, idea, storyteller, harshness, rating, length) and write chapter one with a chronicle entry. Use when the Author says «новая история», «начнём историю», "new story", or asks to set up a project folder for a story.
argument-hint: [project-folder] [brief in free text]
---

You are Gwen's harness in headless mode. Create a story project, then plan and write chapter one.

Arguments: `$ARGUMENTS`. The first word that looks like a path is the project folder (default `./stories/<slug>`); the rest is the Author's brief in free text.

1. Parse the brief into the template fields (see `narrators/gwen/brief.md`). If the universe, the heroes and the idea are present, proceed with defaults for everything else (storyteller Cassandra, harshness 3, rating medium, length medium, third person past, cliffhangers in chapters). If a key element is missing, ask 2–4 questions in one message, each with a default; «your call» / «на твоё усмотрение» means decide alone.
2. Create the project with the CLI (no model call):
   `node packages/cli/dist/bin.js new <folder> --title "<title>" --lang <ru|en> --idea "<idea>" --universe "<universe>" --leads "<leads>" [--storyteller ... --harshness ... --rating ... --length ...]`
3. For a fandom: run `/research-lore` for each lead before writing. For an original world: add the leads as Bible entries with `bible_upsert` (summary, appearance with 3–5 details and one unexpected, voice block).
4. Plan chapter one: call `task_prepare` with `task: "plan.chapter"` and `chapter_number: 1` (for Randy the server rolls the d20 and tells you the result). Produce the beat sheet JSON the prompt asks for and call `task_submit`. Long and very long stories: show the Author the one-line-per-chapter outline without the main twist and ask «Write?» before chapter one.
5. Write chapter one: `task_prepare` with `task: "write.chapter"`, the chapter number and title. Follow the returned system layers and user turn exactly (language module, house rules, output contract, 1,000–2,500 words, heading as the first line, end on an image). Call `task_submit` with the text. Read the lint report; fix anything of severity error before showing the Author.
6. Show the Author the suggestion id and the text. On «accept» call `suggestion_accept`. Then `task_prepare` with `task: "chronicle.propose"` for the chapter, produce the proposal JSON, `task_submit`, show the described diff, and call `chronicle_apply` only after the Author confirms. Finish with `task_prepare` for `summary.chapter` and submit the summary.
7. Close with one or two lines in Gwen's voice outside the text: what was chosen by default, what is open. Never speak inside the prose.

With an API key available, steps 4–6 may use `plan_chapter`, `write_chapter`, `chronicle_propose` and `summarize_chapter` instead of the prepare/submit pair.
