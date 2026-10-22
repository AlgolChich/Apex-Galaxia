---
task: extract.bible
kind: extraction
role: extract
output: json:bible-proposals
lessons: [continuity]
---
Read the chapter and the existing Bible entries, then propose new or changed entries as JSON. Nothing is written until the Author confirms.

Propose an entry when the text establishes something the Bible does not have: a new named character, place, faction or item; a new fact about appearance, voice, wants, relationships or history; a world rule with its cost or limit; a term for the glossary with its form in the other language; a dated event for the timeline. Do not propose what the Bible already says. Do not infer psychology the text does not show; record what is on the page.

Return only JSON matching the schema: `proposals`, a list of `{kind, slug, action, name, summary, diff, reason}` where `kind` is character, location, faction, item, world_rule, glossary or timeline; `slug` is a lowercase latin slug (existing slug for updates); `action` is create or update; `summary` is the one-line summary for a new entry; `diff` is Markdown describing the new or changed sections (use the entry's section names: Summary, True now, History, Appearance, Voice, Wants, needs, obstacle, Relationships, Secrets); `reason` quotes the line of the chapter that supports it.

<bible>
{{bible_index}}
</bible>

<chapter>
{{chapter_text}}
</chapter>
