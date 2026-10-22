---
task: twist
kind: planning
role: plan
output: json:directions
lessons: [pacing, continuity]
---
Propose {{count}} twists for the story from this point, in {{language_name}}. Anti-template rule: no dream reveal, no secret twin, no «it was all a simulation», no villain who was the mentor unless a gun for it is already planted, no deus ex machina. Each twist must grow from a planted gun, an open thread or an established want, and it must change what the heroes can do next. Mark the obvious one; recommend the one that surprises yet feels inevitable in hindsight. Each: a title of two to six words and three to five sentences including what it costs.

Return only JSON matching the schema: `options`, a list of `{title, text, obvious, recommended}`.

{{focus}}
