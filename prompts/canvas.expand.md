---
task: canvas.expand
kind: planning
role: plan
output: json:canvas-cards
lessons: [pacing, continuity]
---
Expand the arc on the Author's canvas into concrete cards: scenes with a want and an obstacle, turns, open questions. Read the board, the Bible and the chronicle; propose 3–6 new cards in {{language_name}} that grow from what is already there. Characters act from their own logic; coincidence may create a problem, never solve one; respect the harshness.

Narrator rules:
<narrator_rules>
{{planner_rules}}
</narrator_rules>

The board:
<board>
{{board}}
</board>

The card to expand: {{focus}}

Return only JSON matching the schema: `cards`, a list of `{kind, title, text, lane, links_to}` where `kind` is idea, scene, arc, twist, branch or question, `text` is two to four sentences, `lane` is one of the board's lanes when the template has them, and `links_to` names the existing cards each new card connects to; optional `note` for the Author.
