---
task: plan.outline
kind: planning
role: plan
output: json:outline
lessons: [pacing, continuity]
---
Plan the whole story «{{title}}» as {{chapter_count}} chapters: one line per chapter for the Author to approve before chapter one is written. Read the brief, the Bible and the chronicle. Build the architecture first, silently: premise, central conflict, stakes, theme; for each lead what they want, what they need, what stands in the way; turning points; where guns are planted and where they fire; one or two twists that surprise but feel inevitable afterwards.

Narrator rules (storyteller rhythm and fate harshness):
<narrator_rules>
{{planner_rules}}
</narrator_rules>

Rules for the outline:
- The main twist is never written in the outline; a line may hint that something turns without saying what.
- Each line names the chapter's situation and what changes by its end, in {{language_name}}, 15–35 words.
- Harshness decides who may die and whether consequences are reversible; a lead's death at harshness 3 or below is not planned.
- The last chapter closes the story the way the ending setting asks; every planted gun fires by then.

{{outline_hint}}

Return only JSON matching the schema: `chapters`, a list of `{number, title, line}` for chapters 1 through {{chapter_count}}.
