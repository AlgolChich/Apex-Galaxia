# Project format

A story project is a folder the Author can open in any editor, diff in git and move between
machines. Format version 1. Schemas: `packages/core/schemas/*.schema.json` (generated from the
Zod definitions in `packages/core/src/project/schemas.ts`; `pnpm schemas` regenerates them).

```
my-story/
  project.yaml            settings: title, language (ru|en), narrator, storyteller, harshness 1–6,
                          rating, length, pov, tense, cliffhangers, ending, yo_policy, spelling,
                          original_characters, preset, models (per role), budget, window, series_bible
  bible/
    premise.md            ## Premise, ## Synopsis, ## Genre and tone, ## Theme
    style.md              project style notes; added to the global house rules
    characters/<slug>.md  front matter + sections (below)
    locations/<slug>.md   same shape; Details instead of Appearance/Voice
    factions/<slug>.md
    items/<slug>.md
    world-rules.md        ## Laws, ## Costs and limits
    timeline.md
    glossary.md           terms and names in both languages
    relationships.yaml    pairs: between, trust, debts, grudges, history
    research/<topic>.md   dossiers: front matter topic, canon_point, sources, unconfirmed
  chronicle/
    state.yaml            machine-readable state (below)
    chronicle.md          reader-safe log, one ## entry per chapter
    hidden.md             planned twists and planted guns; never reader output
    summaries/<stem>.md   cached reader-safe summaries (front matter: chapter, source_hash, model)
  plan/
    brief.md              the filled brief template
    outline.md            one line per chapter
    chapters.yaml         chapters: number, title, status, target_words, beats, turning_point, cliffhanger
    beats/NN.json         full beat sheets written by the planner
  chapters/
    NN-<slug>.md          front matter: number, title, status, words, pov, in_story_date
  canvas/board.json       cards and links (Phase 5)
  style/
    voice-card.md         six sections; falls back to the global card when empty
    lessons.md            dated lessons with provenance (format below)
    banned-phrases.<lang>.txt   project additions, one per line, optional `| note`
    lint-whitelist.txt    phrases the linter must not flag
  history/
    calls.jsonl           append-only call log (one JSON object per line)
    suggestions/<id>.md   generated prose awaiting accept / discard
    chronicle-diffs.jsonl applied chronicle operations
    prepared/<handle>.json  prompts prepared for headless submission
    migrations/           backups of project.yaml before a migration
  exports/
  _trash/                 deleting is always a move here
```

## Bible entry

Front matter: `name`, `aliases` (`ru: []`, `en: []`), `kind` (`canon` | `original`), `always_on`,
`pinned`, `age`, `first_appears`, `tags`. Body sections, recognized in English or Russian:
`Summary` (one line, injected whenever the entry triggers), `True now`, `History`, `Appearance`
(3–5 precise details and one unexpected), `Voice` (lexicon, rhythm, catchphrases, forms of
address, what they never say), `Wants, needs, obstacle`, `Relationships`, `Secrets` (hidden from
Write until a beat sheet lists `fires:<slug>`), `Sources`. Locations, factions and items use
`Details` instead of the character-only sections.

Activation (`bible/activation.ts`): the name and every alias are matched in the current window.
Cyrillic aliases of four letters or more match as stems with up to three trailing letters, a final
vowel or soft sign shed first («Гвиневра» matches «Гвиневрой»); capitalized Cyrillic aliases are
case-sensitive so «Маша» never fires on «машина». English aliases accept plural and possessive
endings. Order in the prompt: always-on, pinned, then triggered by hits and recency.

## Chronicle state

Keys the planner reads: `in_story_time`, `last_chapter`, `locations` (slug → place), `condition`
(slug → wounds[], fatigue, mood), `inventory` (slug → items[]), `knowledge` (id, fact, known_by[],
since_chapter), `relations` (between[a,b], trust, promises, debts, grudges), `open_threads` (id,
text, since_chapter, status), `planted_guns` (id, what, planted_in, payoff, fired_in),
`pending_consequences` (id, text, due, done), `rolls` (chapter, die, result, outcome, at, note).

A proposal is `{chapter, summary, hidden?, in_story_time?, ops[]}` where each op is `set`,
`merge`, `append` (an append with an existing `id` updates that item), `remove` (`where` or
`index`) or `unset` on a dot path. `applyOps` validates the result against the schema and
rejects anything that would corrupt the state.

## Lessons file

```
## lesson-0003 · 2026-10-22 · dialogue

Rule: One sentence in the Author's own terms.
Provenance: where it came from (an edit of chapter 2, a retry note)
Weight: 2
Language: ru

Before:
> the generated span

After:
> the Author's version
```

## History records

`calls.jsonl` lines validate against `history-call.schema.json`: id, ts, task, provider, model,
prompt_hash, input/output/cache tokens, cost_usd, latency_ms, accepted (null until decided),
suggestion, replay, note. Acceptance is recorded as a new line with the same id; readers keep
the last line per id.

## Migrations and safety

`format_version` is checked on open. A newer version than the build understands is refused
with `UNSUPPORTED_FORMAT_VERSION`; an older one is migrated step by step with a backup under
`history/migrations/`. Every write is atomic (temp file + rename). The harness never rewrites a
chapter: suggestions apply on accept, and the only writer of chapters is `ProjectStore.saveChapter`.

## Added in Phase 4

- `history/ab.jsonl`: one line per pairwise choice the Author made between two suggestions
  (`left`, `right`, `choice`, `critic_preferred`, `agreed`, optional `note`).
- `history/runs/<id>.json` gains `pending_decision` and `approved_decisions`: a run stops with
  status `awaiting_decision` when a beat sheet lists `irreversible` choices (`plan/beats/<nn>.json`)
  and continues once the Author approved them.
