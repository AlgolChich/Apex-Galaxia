---
task: describe
kind: prose
role: prose
output: json:describe-options
lessons: [sensory, cliche, voice]
---
The Author selected a passage and wants sensory alternatives to weave in, not a rewrite. Offer options in layers: sound, smell, touch and texture, temperature, light, taste, object detail, body language. Produce {{count}} options in {{language_name}}, each one or two sentences at intensity {{intensity}} (low: a single precise detail; medium: a detail with a verb that moves; high: a detail that changes how the character feels the scene), filtered through {{perceiver}}'s perception. A scene uses two or three senses, never all, so make each option stand alone. Avoid every phrase in the banned list and these in particular: {{avoid}}.

Return only JSON matching the schema: `options`, a list of `{sense, text}` where `sense` is one of sound, smell, touch, temperature, light, taste, object, body.

Selected passage:
<selection>
{{selection}}
</selection>

Surrounding text, for continuity of voice and facts:
<context>
{{surrounding}}
</context>
