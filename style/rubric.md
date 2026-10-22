# Critic rubric

The critic scores a passage 1–5 on each criterion and quotes the weak spots. The revision
pass may touch only what was quoted. Thresholds per preset live in the project config.

## Voice fidelity (`voice`)

1. Everyone sounds the same; vocabulary from a general impression.
3. Leads are distinguishable by content, not by speech.
5. Names covered, every speaker is identifiable from lexicon, rhythm and forms of address; fandom lines match the official localization.

## Subtext (`subtext`)

1. Characters state the theme, explain their feelings, narrate their own psychology.
3. Mostly indirect; one or two lines spell out what the scene already showed.
5. Nobody states the theme; every line is a move; answers miss; the reader assembles the parallel alone.

## Rhythm (`rhythm`)

1. Uniform sentence and paragraph lengths; chopped aphoristic fragments instead of action.
3. Some variety; two or three paragraphs open with the same word or run the same length.
5. Short sentences for tension, long for breath; paragraphs of different length; a breather scene present.

## Cliché density (`cliche`)

1. Several phrases from the banned lists, a template repeated twice.
3. One banned phrase or one repeated device.
5. No banned phrases; each device, inscription or formula appears once.

## AI-tell count (`ai_tell`)

1. Negative parallelisms, triads, summarizing sentences, comparative wrap-ups, label tags.
3. One structural tell.
5. None; the reader cannot tell the text was machine-assisted.

## Continuity (`continuity`)

1. Contradicts the Bible or the chronicle: appearance, who knows what, timeline, world rules, names.
3. One small slip (a wound forgotten, an item in the wrong hands).
5. Everything the chronicle records is carried; consequences of earlier chapters show.

## Language quality (`language`)

1. Russian: calques, officialese, wrong dialogue punctuation, inconsistent ё. English: said-bookisms, em-dash chains, mixed spelling.
3. Correct but flat; one punctuation slip.
5. Living literary language, dialogue formatted for the language, the project's ё and spelling policy kept.

## Verdict

- `pass`: no score below 4.
- `revise`: one or more scores of 3, or a single 2 with a quoted fix.
- `reject`: any 1, or two or more scores of 2.
