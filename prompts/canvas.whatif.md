---
task: canvas.whatif
kind: planning
role: plan
output: json:canvas-cards
lessons: [pacing, continuity]
---
The Author asks «what if»: play the hypothesis through the story as it stands. Read the board, the Bible and the chronicle, then propose 3–5 cards in {{language_name}}: the immediate consequence, who gains and who loses, what breaks, the new open question, and one branch card that keeps the hypothesis as an alternative. Follow the world's laws and the characters' logic; respect the harshness.

Narrator rules:
<narrator_rules>
{{planner_rules}}
</narrator_rules>

The board:
<board>
{{board}}
</board>

What if: {{question}}

Return only JSON matching the schema: `cards` (`{kind, title, text, lane, links_to}`) and an optional `note` naming the cost of this path.
