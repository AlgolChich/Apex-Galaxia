# Session report: 2026-10-22 (third session), Phase 4

## Done

- Phase 4 core (Section 12), tested offline with the scripted stand-in and the replay adapter:
  - The ASK gate (5.9): beat sheets list `irreversible` `{who, what}`; `runBook` stops with
    `awaiting_decision` before the chapter is written and continues after approval
    (`apex run --approve-decision`, MCP `run_start {approve_decision}`); tested in the core and over
    stdio, including a server killed mid-chapter and resumed from a fresh process without rewriting
    the finished chapter.
  - The narrator outside the story (5.1): the `chat` task with Gwen's persona and the command
    vocabulary from `commands.yaml`, matched deterministically before any model call; MCP
    `narrator_chat` streams the reply and answers commands with a canned line when no model is
    configured.
  - Candidates (4.1) and pairwise A/B (6.5): two or three drafts of one Write ranked by the critic,
    each a pending suggestion (`apex write --candidates`, `write_candidates`); the Author's choice
    recorded in `history/ab.jsonl` (`ab_record`, `ab_list`) and summarized in eval reports.
  - Planner evals: briefs under every storyteller, harshness and forced d20 in `evals/planner/`; a
    judge model scores harshness fit, storyteller fit and roll obedience; a deterministic Jaccard
    distance between the beats at harshness 1 and 6 (`apex eval --planner`, `eval_run {planner}`).
  - Manuscript and Bible import (4.2): `splitManuscript` on headings, «Глава N» and "Chapter N";
    `apex import`, `apex bible import`, MCP `project_import` with preview and `bible_import`.
  - `canvas_update` for the board.
- Phase 4 in the app (`apps/desktop`, `docs/desktop.md`, "The narrator in the app"):
  - Gwen's chat panel: streaming replies, command chips, action cards that run only on a press,
    directions and handover as attachments, history kept per project on the machine.
  - The run screen's decision card for `awaiting_decision` (approve and continue, edit the plan,
    stop); a gate is shown as a pause, and saved runs at the gate carry a Decide button.
  - The candidates dialog: form, progress, side-by-side comparison with the critic's pick, lint
    counts and cost, keys 1–3 and Enter, tie, discard all with a confirmation, the A/B record and
    the chronicle offer after the accept; the "A/B so far" line from `ab_list`.
  - The canvas board: pannable and zoomable, lanes, links, drag, inline edit, AI actions and
    promotion into the Bible and the plan.
  - The import dialog (manuscript into the open or a new project with a preview, Bible entries by
    kind, research dossier through the sanitizer with its report), the wizard's import path, the
    welcome button, the Bible view's buttons; Settings → Evals with the linter and planner evals, the
    report, and the A/B agreement.
  - Playwright: `wizard.spec.ts` creates a project from the wizard with defaults, writes a chapter
    from the palette, accepts it, applies the chronicle update and caches the summary; the smoke
    test stays. Both run serially against one bridge.
- Release: the `Release` workflow builds the installers on a version tag and attaches them to a
  draft GitHub release with the bilingual notes from `docs/release-notes/<tag>.md`; signing is
  switched on by repository secrets (`docs/release.md`); `v0.1.0` notes drafted.
- Fixes along the way: templates that embed the chapter no longer also receive the manuscript
  window (`window: none`); the server holds the harness instance in a local during a project
  switch; two flaky tests made deterministic (the chronicle timeline test waits for its items; the
  stdio candidates test asserts the progress sequence as a prefix, because a notification that shares
  a chunk with the result is dropped by the SDK client).

## Verified how

- `pnpm install && pnpm build && pnpm lint && pnpm test` on an export of each commit's tree:
  40 test files, 241 tests at the end of the session (packages and the desktop as two Vitest
  projects); `pnpm --filter @apex-galaxia/desktop typecheck` and `build` clean.
- Over stdio with the scripted model: the ASK gate, the narrator chat, candidates with progress,
  the A/B record, planner evals, import with preview, kill-and-resume.
- Playwright against the bridge and the scripted model: the smoke test and the wizard-to-chapter
  test pass here (`APEX_CHROMIUM=/opt/pw-browsers/chromium pnpm e2e`).
- Each feature was driven live in a browser by the agent that built it (chat, candidates and the
  gate, the canvas, import and evals), with screenshots checked and the defects they showed fixed
  (dialog focus when phases change, a gate reported as a finished run, a missing status string).

## Not done

- Real-API runs: no key in this environment, so the planner evals report the scripted distance
  (0 by construction, stated as such), no cassette was recorded and no real A/B session happened.
- The plan view does not edit beat sheets; "Edit the plan" on the decision card opens the plan
  view and names the file to edit.
- Dossiers cannot be listed from the app (no list tool); the Bible view shows the folder and the
  paths saved in this session. The canvas has no single-link removal (no `canvas_unlink` tool),
  no multi-select, and pinch zoom only as ctrl+wheel; lane names are the templates' English names.
- Files with CRLF line endings are not normalized by the core; `.gitattributes` pins LF for the
  repository (Windows CI was red for that reason), but a chapter edited elsewhere with CRLF is a
  follow-up.
- A real Tauri window is still verified only in CI builds and the headless Linux lifecycle test;
  `v0.1.0` is not tagged (the `Desktop` workflow must first be green on `main`), and signing needs
  the Author's certificates.
- Research mode in the app stays "paste a dossier"; no web search in the desktop.

## Decisions taken

- A tie in the candidates dialog records `tie` and accepts the critic's pick (or the first draft
  without a critic), so the Author always keeps a continuation.
- The gate is a pause: the run screen never calls a run at the gate finished.
- The eval reports name the configured model ids as the core writes them; the UI adds none.
- Four agents built the chat, the gate and candidates, the canvas, and the import and evals in
  parallel with disjoint file ownership; the orchestrator owned the shared files, the fixes and the
  docs, and verified every commit on an export of its tree.

## Next step

Phase 4 acceptance by the Author on a desktop with a real key: the chat panel, a run with an
irreversible choice, a candidates session that writes the first real A/B records, the planner
evals with the judge. Then Phase 5 per the build prompt: lesson review in the app, the eval
dashboard, `/improve` from the desktop, and the first real cassette once the key and the TF2
folder exist.
