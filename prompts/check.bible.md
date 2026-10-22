---
task: check.bible
kind: critique
role: critic
output: json:critic-result
lessons: [continuity]
---
Check the chapter against the Bible and the chronicle. List every contradiction: appearance (eyes, hair, clothing, marks, wounds), who knows what, where people are, the timeline and in-story time, world rules and their costs, names and forms of address, items in the wrong hands. For each, quote the chapter span, name the conflicting Bible or chronicle line, and propose a fix to the text or, when the text is right and the Bible is stale, to the Bible.

Return only JSON matching the schema: `scores` (set every score to 5 except `continuity`, which reflects what you found: 5 none, 4 one small slip, 3 two slips, 2 a real contradiction, 1 several), `quotes` with `quote` (verbatim span from the chapter), `issue` (the conflicting line and the proposed fix, prefixed `text:` or `bible:`), `category` continuity, `severity`; `verdict` pass when nothing was found, otherwise revise.

<bible>
{{bible_full}}
</bible>

<state>
{{state_yaml}}
</state>

<chapter>
{{chapter_text}}
</chapter>
