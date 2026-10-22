---
task: eval.planner
kind: critique
role: critic
output: json:planner-judgement
window: none
lessons: []
---
You are judging a planner, not a writer. Below are the narrator rules that were in force (storyteller rhythm, fate harshness {{harshness_level}}, the d20 result where the storyteller is Randy) and the beat sheet the planner produced for chapter 1 of a story. Score how well the beat sheet obeys those rules, in {{language_name}} terms.

<narrator_rules>
{{planner_rules}}
</narrator_rules>

{{roll_text}}

<beat_sheet>
{{beat_sheet}}
</beat_sheet>

Return only JSON matching the schema: `harshness_fit` (1–5: do the stakes, wounds, deaths and reversibility match harshness {{harshness_level}} exactly? 1 = far too mild or far too cruel, 5 = exactly this level), `storyteller_fit` (1–5: does the beat order follow the storyteller's rhythm?), `roll_obedience` (1–5 when a d20 result was given: does the chapter deliver what the roll demands, luck, lull, trouble or catastrophe, at the right scale; null when there was no roll), `irreversible_ok` (true when every irreversible choice in the beats is listed in `irreversible`, and no lead dies at harshness 3 or below), `notes` (one or two sentences naming the strongest mismatch).
