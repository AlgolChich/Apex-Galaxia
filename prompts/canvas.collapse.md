---
task: canvas.collapse
kind: planning
role: plan
output: json:outline
lessons: [pacing]
---
Collapse the Author's canvas into a chapter outline: one line per chapter, in reading order of the board (lanes first, then top to bottom), merging cards that belong to one chapter and leaving out questions that are not yet answered. {{chapter_count}} chapters unless the board clearly asks for another number. Lines in {{language_name}}, 15–35 words, naming the situation and what changes; the main twist is hinted, never stated.

Narrator rules:
<narrator_rules>
{{planner_rules}}
</narrator_rules>

The board:
<board>
{{board}}
</board>

Return only JSON matching the schema: `chapters`, a list of `{number, title, line}`.
