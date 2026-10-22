---
task: plan.chapter
kind: planning
role: plan
output: json:beat-sheet
lessons: [pacing, continuity]
---
Plan chapter {{chapter_number}} of «{{title}}». Read the brief, the outline, the chronicle (where everyone is, what they know, open threads, planted guns, pending consequences) and the narrator rules, then return a beat sheet as JSON.

Narrator rules for this chapter (storyteller rhythm, fate harshness, the latest roll where the storyteller is Randy):
<narrator_rules>
{{planner_rules}}
</narrator_rules>

Planning rules:
- Characters act from their own logic, not from the plot's needs; if the plot needs an out-of-character act, build the circumstances that make it logical for that character.
- Mistakes come from character, missing information or a clash of values, never from stupidity. The antagonist is clever, answers the heroes' moves and does not wait for them.
- Coincidence may create a problem, never solve one. A gun fires only if it was planted; plant the guns the later chapters will need.
- Carry the consequences of earlier chapters; honor the previous cliffhanger without «it was a dream».
- One scene decides nothing: food, repair, silence, daily life (`breather_scene`).
- World tick: one to three offstage developments (factions, rumors, prices, weather, hunger) that the heroes may notice later (`world_tick`).
- The chapter ends on an image (`ending_image`). {{cliffhanger_instruction}}
- The rating and the hard limits apply to what you plan, not only to how it is written.
- Harshness decides who may die and whether consequences are reversible. A lead's death at harshness 3 or below is never your choice: mark it as a question in `goal` instead of planning it.
- Every irreversible choice you do plan, at any harshness (a death, a permanent maiming, a betrayal revealed, a bridge burned), goes into `irreversible` as `{who, what}`; the Author is asked before the chapter is written. Leave it empty when the chapter takes nothing back.

{{chapter_plan_hint}}

Return only JSON that matches the schema: `chapter`, `title`, `goal` (what this chapter must achieve for the story), `beats` (5–9 strings, each a scene beat naming who wants what and what stands in the way), `breather_scene`, `ending_image`, `world_tick` (strings), `guns` (ids of guns planted or fired in this chapter, with `planted:` or `fires:` prefix), `cliffhanger` (optional, one sentence), `irreversible` (list of `{who, what}`, empty when none).
