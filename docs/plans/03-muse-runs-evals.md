# Phase 4–5 core plan: Muse Layer, autonomous runs, lessons, evals

Pulled forward from Phases 4 and 5 (Section 12) because they live in the core and are testable
offline; the desktop app of Phase 3 renders them later. Items the app needs (progress screen,
pause button, pairwise A/B, canvas board) stay in their phases.

- [x] Muse Layer presets `fast` / `balanced` / `best` and `muse:` overrides in `project.yaml`; critic pass by the critic model; bounded revision loop (at most two) that touches only quoted spans; stages visible in the outcome and the suggestion note.
- [x] Autonomous run (`apex run`, `Harness.runBook`): plan, write with the Muse Layer, accept, chronicle applied with the diff log, summary, book export, reader's report; run state saved after every stage under `history/runs/`; resume after a crash; outline gate for long and very long stories; budget stop pauses the run.
- [x] Outline planning (`plan.outline`, one line per chapter without the main twist) into `plan/outline.md` and `plan/chapters.yaml`.
- [x] Lesson capture: `apex lesson propose` from an edit and a note; `apex lesson add` for confirmed lessons; `apex accept --edited --lesson`; MCP `lessons_propose` / `lessons_add`; deduplication by rule text.
- [x] Eval suite (`apex eval`, MCP `eval_run`): golden and fault sets, lint coverage, critic means, prompt variants, baseline deltas; reports under `docs/evals/`.
- [x] `/improve` (`apex improve`, skill): eval, up to three proposed whole-file edits written as a variant, re-run, delta; never applied.
- [ ] Autonomous mode ASK gate for irreversible choices such as a lead's death at harshness 3: the planner prompt forbids it; a code-level gate needs the critic to flag a death, which is Phase 5 UI work.
- [ ] Pairwise A/B in the desktop app feeding the eval record (Phase 5 gate).
- [ ] Canvas board operations (cards, lanes, promote to Bible or plan) and the board UI (Phase 5); `canvas_directions` and `twist` exist.
- [ ] Measured proof that the critic loop beats the bare model on the Author's golden set (needs the golden set and an API key).
