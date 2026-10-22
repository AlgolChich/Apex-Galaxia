# Phase 4 plan: the narrator system in the app

Goal (Section 12): brief wizard, storytellers with the d20, harshness, ratings, chronicle view,
autonomous mode, all in the app. Acceptance (12.1): wizard to chapter end to end; the d20 is
rolled in code, logged and obeyed; harshness levels change planner output measurably in evals;
autonomous mode writes a two-chapter story unattended and resumes after being killed mid-run.
Several Phase 5 items that live next to these are pulled in (pairwise A/B, the canvas board).

## Core and server

- [x] ASK gate for irreversible choices (5.9): beat sheets list `irreversible` `{who, what}`; `runBook` stops with `awaiting_decision` before the chapter is written and continues after `approveDecision`; CLI `apex run --approve-decision`; MCP `run_start {approve_decision}`; tested in the core and over stdio.
- [x] The narrator outside the story (5.1): the `chat` task with Gwen's persona, the command vocabulary from `commands.yaml` matched deterministically (`/дальше`, `next`, `/летопись`…), a model reply with an optional action line; MCP `narrator_chat` streams it and answers commands without a model when none is configured.
- [x] Candidates (4.1): two or three drafts of one Write ranked by the critic, each a pending suggestion; `apex write --candidates`, MCP `write_candidates`.
- [x] Pairwise A/B (6.5): `history/ab.jsonl` through `recordAb` / `ab_record`, the critic agreement in `apex eval` reports.
- [x] Planner evals: `evals/planner/` briefs under every storyteller, harshness and forced d20; a judge model scores harshness fit, storyteller fit and roll obedience; a deterministic distance between the beats of the lowest and the highest harshness; `apex eval --planner`, MCP `eval_run {planner}`.
- [x] Manuscript and Bible import (4.2): `apex import`, `apex bible import`, MCP `project_import` (with preview), `bible_import`.
- [x] Kill-and-resume: a background run whose server process is killed mid-chapter resumes from a fresh server without rewriting the finished chapter (`run-resume.test.ts`).
- [x] `canvas_update` for the board UI.

## App

- [x] Wizard to chapter end to end in the browser: `e2e/wizard.spec.ts` creates a project from the wizard with defaults, writes a chapter from the palette, accepts it, applies the chronicle update and caches the summary.
- [ ] Gwen's chat panel with the Park Planet accent, command chips, action cards (next, plan, chronicle, directions, settings) and per-project history.
- [ ] Run screen: the decision card for `awaiting_decision` (approve, edit the plan, stop).
- [ ] Candidates dialog: side-by-side comparison, the critic's pick, choose or tie, the A/B record, the chronicle offer after the accept.
- [ ] Canvas as a pannable, zoomable board with lanes, links, drag, AI actions and promotion.
- [ ] Import dialog (manuscript, Bible entries, research dossier), the wizard's import path, the welcome screen button, the evals section in Settings.

## Acceptance evidence

- The d20: rolled in code (`rollD20`, seeded in tests), logged in `chronicle/state.yaml` `rolls`, handed to the planner as `planner_rules`; obedience is scored by the planner evals (real numbers need a key).
- Harshness: the planner evals measure the distance between the plans at harshness 1 and 6 and the judge's fit per level; with the scripted stand-in the distance is 0 by construction, which the metric reports honestly.
- Autonomous mode: two chapters unattended in the core test, the kill-and-resume server test, the ASK gate test.

## Left for later

- Real-API runs of the planner evals and the first A/B session need the Author's key.
- Research mode in the app stays "paste a dossier"; web search in the desktop is not wired (decision 10: none in Phase 1).
- The lead's-death check at harshness 3 is a planner rule plus the gate; no deterministic death detector exists.
