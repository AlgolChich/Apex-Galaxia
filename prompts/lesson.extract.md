---
task: lesson.extract
kind: extraction
role: extract
output: json:lesson-proposal
---
The Author changed a generated passage, or left a note about it. Turn the change into one lesson the harness can apply next time. Classify the change, state the rule in one line in the Author's own terms (what they prefer, not why they might prefer it), and attach a before/after pair taken from the actual edit. Record what the Author did or said, never a reading of the Author's psychology. If the change is a mere typo or a factual correction with no rule behind it, return `category: other` and an empty `rule`.

Return only JSON matching the schema: `category` (dialogue, exposition, cliche, rhythm, labeling, pacing, continuity, voice, sensory, other), `rule` (one sentence), `before` (the generated span, verbatim, at most two sentences), `after` (the Author's version, verbatim, at most two sentences), `language` (ru, en or both).

Generated text:
<before>
{{before}}
</before>

The Author's version:
<after>
{{after}}
</after>

The Author's note, if any:
<note>
{{note}}
</note>

Existing lessons, to avoid duplicates (if the rule already exists, return its exact `rule` text so the harness can raise its weight):
<lessons>
{{existing_lessons}}
</lessons>
