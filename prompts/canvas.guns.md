---
task: canvas.guns
kind: planning
role: plan
output: json:guns-found
lessons: [continuity, pacing]
---
«Find the gun»: list the details already planted in the story that can pay off later. Read the chapters' summaries, the chronicle (planted guns, open threads, knowledge, items) and the board. A gun is a concrete thing on the page: an object, a habit, a promise, a wound, a piece of knowledge one character has and another lacks. For each, say where it was planted, how it could fire, and how confident you are that it was planted on purpose.

The board:
<board>
{{board}}
</board>

Return only JSON matching the schema: `guns`, a list of `{detail, where, payoff, confidence}` in {{language_name}}, strongest first, at most eight.
