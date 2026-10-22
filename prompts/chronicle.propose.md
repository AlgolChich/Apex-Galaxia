---
task: chronicle.propose
window: none
kind: extraction
role: extract
output: json:chronicle-proposal
lessons: [continuity]
---
Read chapter {{chapter_number}} and the current chronicle state, then propose the state update as JSON. Nothing you return is applied until the Author confirms it.

The state file has these keys: `in_story_time`, `locations` (character slug → place), `condition` (slug → {wounds[], fatigue, mood}), `inventory` (slug → items[]), `knowledge` (list of {id, fact, known_by[], since_chapter}), `relations` (list of {between[a,b], trust, promises[], debts[], grudges[]}), `open_threads` ({id, text, since_chapter, status}), `planted_guns` ({id, what, planted_in, payoff, fired_in}), `pending_consequences` ({id, text, due, done}), `rolls`. Use the character slugs given in the Bible section, never display names.

Return JSON with:
- `chapter`: {{chapter_number}}.
- `summary`: the reader-safe chronicle entry in {{language_name}}, 2–4 sentences: what changed, what consequences are ripening, what threads are open. Only what has already happened in the text; never planned twists.
- `hidden` (optional): what the planner should remember but the reader must not see: guns planted this chapter, setups for later, in {{language_name}}.
- `in_story_time` (optional): the in-story date and time at the end of the chapter.
- `ops`: a list of operations against the state. Each is one of `{"op":"set","path":"locations.<slug>","value":"..."}`, `{"op":"merge","path":"condition.<slug>","value":{...}}`, `{"op":"append","path":"open_threads","value":{...}}` (an append with an existing `id` updates that item), `{"op":"remove","path":"open_threads","where":{"id":"..."}}`, `{"op":"unset","path":"..."}`. Record wounds, dirt and changes of clothing; who learned what; promises and debts; items changing hands; threads opened or resolved; guns planted or fired; consequences now pending.

<state>
{{state_yaml}}
</state>

<chapter>
{{chapter_text}}
</chapter>
