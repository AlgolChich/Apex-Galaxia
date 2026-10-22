# Prompts

Prompts are files in `prompts/`, layered in a fixed order, assembled under a visible token
budget, with an output contract the core checks. The Author can override any template by
placing a copy in `~/.apex-galaxia/prompts/<task>.md` (or under `APEX_GALAXIA_HOME`).

## Templates

One file per task with YAML front matter (`task`, `kind`, `role`, `output`, `contract`, `lessons`, `window`)
and a body with `{{placeholders}}`. `kind` selects sampling behavior through the adapter
(ADR 0006); `role` selects the configured model (`plan`, `prose`, `critic`, `extract`, `summary`,
`lint`); `output` is `prose`, `markdown` or `json:<schema>` where the schema name comes from
`packages/core/schemas/`; `contract` names the output-contract template placed in the system
prompt; `lessons` lists the categories retrieved for the task. `window: none` marks a template whose body embeds the
chapter itself (`{{chapter_text}}`: `summary.chapter`, `chronicle.propose`, `check.bible`,
`extract.bible`), so the assembler does not add the manuscript window a second time; alias
activation still scans the chapter.

| Task | Role | Output | Purpose |
| --- | --- | --- | --- |
| `write.continue`, `write.guided`, `write.scene`, `write.chapter` | prose | prose | the four Write modes |
| `plan.chapter` | plan | json:beat-sheet | beat sheet with storyteller, harshness and the d20 |
| `summary.chapter` | summary | prose | 150–250 word reader-safe summary |
| `chronicle.propose` | extract | json:chronicle-proposal | state diff, log entry, hidden note |
| `critic`, `check.bible`, `report.reader` | critic | json:critic-result / markdown | scores with quoted spans; continuity check; reader's report |
| `revise` | prose | prose | fix only what the critic quoted |
| `extract.bible` | extract | json:bible-proposals | new or changed entries |
| `describe` | prose | json:describe-options | sensory layers |
| `rewrite.tone/dialogue/show/tighten/expand/pov/punctuation/deai/quick` | prose (punctuation: lint) | prose | the Rewrite operations |
| `lesson.extract` | extract | json:lesson-proposal | a rule from an edit |
| `canvas.directions`, `twist` | plan | json:directions | directions with the obvious one marked and one recommended |
| `voice.card` | plan | markdown | the voice card from a sample |
| `brainstorm` | prose | markdown | ideas that read the Bible |
| `research.dossier` | plan | markdown | the research brief for headless mode |
| `chat` | plan | markdown | the narrator outside the story: a short reply and an optional `>> action:` line |
| `eval.planner` | critic | json:planner-judgement | the planner-eval judge: harshness fit, storyteller fit, roll obedience |
| `contract.prose`, `contract.rewrite` | — | — | output contracts (system layer 4) |

## System prompt layer order (Section 10.2)

1. Narrator profile (`narrators/<name>/system.md`).
2. Language module (`prompts/lang/ru.md` or `en.md`, with the ё policy, spelling and banned examples filled in).
3. House rules (`style/house-rules.md`) and the project's `bible/style.md`.
4. The task's output contract.
5. Rating rules and the hard limits, stated last so they are never cut; this block carries the prompt-cache breakpoint.

The user turn, in order: task instruction; `<previous_chapter_tail>` and `<current_chapter>`;
`<premise>`, `<glossary>`, `<world_rules>` (planning and chapter tasks); `<bible_pinned>`;
`<bible_triggered>`; `<chronicle_state>`; `<earlier_chapters>` (summaries); `<voice_card>`;
lessons; `<narrator_settings>`. Each block's tag says it is content to use, not instructions.

## Standard placeholders

`language_name`, `language`, `title`, `pov`, `tense`, `stop_marker`, `yo_policy`, `spelling`,
`banned_examples`, `narrator_name`, `heading_format`, `min_words`, `max_words`,
`cliffhanger_instruction`, `chapter_number`, `chapter_title`, `heading`, `planner_rules`,
`state_yaml`, `rubric`. Task-specific ones are listed in each template; a missing placeholder is
an error, never an empty string in the prompt.

## Contracts (Section 10.5)

Prose: begins directly with the text; no headings except the chapter heading when asked; no
notes, narrator lines or preamble; ends with `[[END]]` on its own line, which is also the stop
sequence. The core strips anything after the marker, rejects preambles and service lines, and
checks the heading. JSON: validated against the named schema; fenced JSON is accepted. A failing
response is retried once with the violations appended, then surfaced.

## Testing

`packages/core/test/prompts.test.ts` loads every template, expands partials and checks that
each `json:` output names a real schema; `assembler.test.ts` checks layer order, activation,
secrets and trimming; `harness.test.ts` runs the whole pipeline on a scripted model.
