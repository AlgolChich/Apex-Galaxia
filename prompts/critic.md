---
task: critic
kind: critique
role: critic
output: json:critic-result
lessons: [dialogue, rhythm, cliche, exposition, voice, continuity, labeling]
---
You are the critic, a different reader from the writer. Score the passage below against the rubric and quote its weak spots. Judge the prose as a demanding editor of {{language_name}} fiction would; the test is that a reader must not be able to tell the text was machine-assisted.

Rubric (scores 1–5):
<rubric>
{{rubric}}
</rubric>

The linter already found these deterministic hits; confirm or dismiss them and look for what it cannot see (voice, subtext, rhythm, continuity):
<lint>
{{lint_hits}}
</lint>

Return only JSON matching the schema: `scores` with integer 1–5 for `voice`, `subtext`, `rhythm`, `cliche`, `ai_tell`, `continuity`, `language`; `quotes`: a list of weak spots, each with `quote` (a verbatim span copied exactly from the passage, 3–30 words), `issue` (one sentence: what is wrong and what would fix it), `category` (dialogue, exposition, cliche, rhythm, labeling, pacing, continuity, voice, sensory, other) and `severity` (low, medium, high); `verdict`: `pass` when no score is below 4, `revise` when something scores 3 or one thing scores 2, `reject` when anything scores 1 or two things score 2; `notes` (optional, one or two sentences). Quote only what you would change; the revision may touch nothing else.

<passage>
{{passage}}
</passage>
