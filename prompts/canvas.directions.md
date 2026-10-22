---
task: canvas.directions
kind: planning
role: plan
output: json:directions
lessons: [pacing, continuity]
---
Propose {{count}} directions the story could take from here, for the Author to choose from. Read the chronicle, the open threads, the planted guns and the narrator rules. Mark the most obvious direction (`obvious: true`), the one a reader expects. Recommend one (`recommended: true`) that surprises yet feels inevitable in hindsight: it must grow from planted guns, open threads or a character's established want, never from coincidence. Each direction: a title of two to six words and three to five sentences of what happens and what it costs, in {{language_name}}. Respect the harshness: no lead dies at harshness 3 or below unless the Author asked.

Narrator rules:
<narrator_rules>
{{planner_rules}}
</narrator_rules>

{{focus}}

Return only JSON matching the schema: `options`, a list of `{title, text, obvious, recommended}`; exactly one option is `recommended`, at most one is `obvious`.
