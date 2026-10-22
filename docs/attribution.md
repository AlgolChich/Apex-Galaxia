# Attribution

Feature ideas are fair; UI layouts, copy, prompt texts and brand assets of other products are not (Section 3.4). This file lists what the repository borrowed and under which terms. No source code from another project is copied.

| Material | Source and license | How it is used here |
| --- | --- | --- |
| Categories of machine-writing tells | *Wikipedia:Signs of AI writing* (WikiProject AI Cleanup), Wikipedia contributors, CC BY-SA 4.0. https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing | The page's categories (vocabulary, negative parallelism, rule of three, vague attribution, em dashes, summarizing endings) informed which linter rules exist. No text, example phrases or lists from the page are reproduced; the phrase lists in `style/` come from the Author's memo and from this project. |
| Storyteller names and the fate-harshness idea | RimWorld (Ludeon Studios): the storytellers Cassandra Classic, Phoebe Chillax and Randy Random, and the difficulty naming | The Author's existing Gwen narrator uses these names as an homage to RimWorld's pacing engines; this repository ports Gwen's rules as data under `narrators/gwen/`. The names refer to the inspiration and are not RimWorld assets; no RimWorld text or art is used. |
| The narrator's image | *Knights of Guinevere* (Glitch Productions, 2025) | The image of an android princess of an amusement park inspired Gwen's persona. The show's plot, lines and art are not used. |
| Lint rule shape (name, level, message, tokens or pattern; project override file) | Ghostwriter by Rich Stokoe, MIT. https://github.com/richstokoe/ghostwriter | Idea only; our rules are written from scratch in `packages/core/src/lint/rules.ts` with Russian morphology and bilingual messages. |
| Append-only cost ledger with frozen cost at write time | local-writing-app by Anton Lauridsen, MIT. https://github.com/antoncl/local-writing-app | Idea only, applied to `history/calls.jsonl`. |
| Hash-bound critic findings and a minimum of located findings | Open-Write Studio (Open-Write contributors, Dean Peterson), Apache-2.0. https://github.com/Open-Write/open-write-studio | Idea only, applied to the critic output contract (`quotes[]` with verbatim spans). |
| One Markdown file per document with a header block; `@tag` cross-references | novelWriter by Veronica Berglyd Olsen, GPL-3.0. https://github.com/vkbo/novelWriter | Idea only (no code; GPL). Our front matter and alias activation are an independent design. |
| Suggest mode: AI returns diffs, the author accepts | Orison Space (LumenStorm), Apache-2.0. https://github.com/LumenStorm/OrisonSpace | Idea only; our suggestion files and paragraph diff are independent. |
| Model IDs, prices and API behavior | Claude API reference bundled with Claude Code (checked 2026-10-22) | Encoded in `packages/core/src/adapters/models.ts`; the Author's config overrides it. |

The Author's own material (the dialogue and prose memo, the Gwen system prompt, the Team Fortress 2 stories) belongs to the Author. The memo and the Gwen rules are reproduced in `style/house-rules.md` and `narrators/gwen/` with the Author's permission as the repository owner; the stories stay out of the repository (`private/` is git-ignored).
