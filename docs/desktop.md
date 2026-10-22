# The desktop app

Apex Galaxia on the desktop is the same core as the CLI and the headless mode, wrapped in a
window: a Tauri 2 shell starts the MCP server as a Node sidecar and the React frontend talks
to it over stdio (ADR 0010). Nothing leaves the machine except calls to the model API you
configured; the app opens no network port and sends no telemetry.

## Install

Installers for Windows (`.msi`, `.exe`), macOS (`.dmg`) and Linux (`.deb`, `.AppImage`) are
built by the `desktop` workflow in CI for every push to `main` (download them from the
workflow run's artifacts) and attached to a draft GitHub release by the `Release` workflow for
every version tag (`docs/release.md`). The installers are unsigned until the Author adds
signing certificates: Windows SmartScreen and macOS Gatekeeper will ask once.

To build from source: Rust stable, the Tauri 2 prerequisites for your platform, Node 22, pnpm.

```bash
pnpm install && pnpm build
cd apps/desktop
pnpm sidecar:bundle && pnpm sidecar:node     # the MCP server as one file + the Node runtime for this platform
pnpm tauri build                             # installers in src-tauri/target/release/bundle
pnpm tauri dev                               # a development window against the repository
```

## First run

1. Interface language (Russian or English; the story language is a project setting).
2. The model key: pasted once, stored in the OS keychain (service `apex-galaxia`), passed to
   the sidecar through its environment at spawn and never shown again. Skip it to work
   without a model: editing, lint, Bible, chronicle and exports work offline; Write needs a
   key, or Claude Code in headless mode (`docs/harness-mode.md`). If the keychain is not
   available (some Linux sessions without a Secret Service), the CLI's `~/.apex-galaxia/.env`
   with `ANTHROPIC_API_KEY=` is the fallback, written by you, never by the app.
3. Create a story through the wizard (the brief template with one-line explanations; an empty
   wizard still produces a working project) or open an existing project folder.
4. Optionally paste a sample of your own prose: the voice card distilled from it rides every
   prose prompt.

## The window

- Left: the project tree (chapters with status and words, Bible, Chronicle, Plan, Runs,
  Settings).
- Center: a distraction-free serif editor (CodeMirror 6, Markdown, typewriter scrolling,
  lint underlines with explanations on hover and a one-click whitelist), or a view.
- Right: a panel with Bible (what is active for this chapter), Chronicle (state and log),
  Lint, Critic (scores and quoted weak spots) and Inspector (what the next Write would see,
  layer by layer, with tokens, trims and the cost estimate).
- Below: words, selection, in-story date, cost so far, lint counts, save state, model.
- `Ctrl/Cmd+K`: the command palette with every action and its shortcut. `Esc` leaves focus
  mode.

## Writing

`Ctrl/Cmd+Enter` continues from the cursor. The text streams into a suggestion block under the
editor with the model and the cost in small print; nothing touches the chapter until you
press Accept (optionally after editing the suggestion in place). Retry, Retry with a note
and Discard are one key away. After an accept the app offers the chronicle update: the
proposal is shown as a readable diff and applied only when you confirm; a summary can be
cached right after. Guided and scene writes take your beat or scene card; chapter mode plans
with the storyteller and the harshness first (Randy rolls a real d20).

Rewrite (tone, dialogue, show, tighten, expand, pov, punctuation, de-AI, quick), Weave and
Describe work on a selection and come back as per-paragraph diffs with accept or reject per
block; applying one is your own edit of the chapter, and the app can propose a lesson from
it. Lint runs as you type; the critic and the Bible check run on request.

The run screen writes a whole story unattended: plan, write, accept, chronicle, summary per
chapter, with the streamed text, the cost so far and a pause button; a paused run resumes
where it stopped.

## The narrator in the app

- **Gwen's panel** (`Ctrl/Cmd+Shift+6`): talk to the narrator outside the story. Command chips
  («дальше» / next, план / plan, летопись / chronicle, directions, settings) match the vocabulary
  from `narrators/gwen/commands.yaml`; a reply that proposes an action comes with a card (write
  the next chapter, open the plan, update the chronicle, show the handover) that runs only when
  you press it. Without a model the panel still answers commands. The history is kept per project
  on this machine.
- **Candidates** (`Ctrl/Cmd+Shift+C`): two or three drafts of one Write, side by side, with the
  critic's pick, the lint counts and the cost per draft. Choose one (keys 1–3, Enter), or call it
  a tie; the others are discarded and your choice is recorded in `history/ab.jsonl` as the
  pairwise A/B that the eval reports summarize. The chronicle offer follows the accept as usual.
- **The ASK gate**: when a beat sheet lists choices the story cannot take back (a death, a
  betrayal, a burned bridge), an unattended run stops before the chapter is written and the run
  screen shows the decision card: approve and continue, edit the plan (`plan/beats/NN.json`,
  then resume), or stop. A gate is a pause, not a finished run.
- **Canvas** (`Ctrl/Cmd+7`): a pannable, zoomable board of cards in lanes with links; drag to
  move, double-click to edit, AI actions (expand, what if, find the gun, collapse to outline) on
  a card, and promotion of a card into the Bible or the plan.
- **Import**: a Markdown manuscript into the open project or a new one (chapters split on
  headings, previewed before anything is written), Bible entries by kind, and a research dossier
  through the sanitizer (lines that read as instructions are removed and shown). The first-run
  wizard offers the import path, the welcome screen and the Bible view carry the buttons.
- **Evals** (Settings): run the linter eval and the planner eval, with or without the critic as
  judge, read the report, copy it, and see how often the critic agreed with your A/B choices.

## Development mode

```bash
cd apps/desktop
APEX_GALAXIA_SCRIPTED=1 pnpm dev:bridge     # the MCP server with a scripted stand-in model, relayed over 127.0.0.1
pnpm dev                                    # the frontend in a browser at http://127.0.0.1:1420
pnpm test && pnpm e2e                       # unit tests (jsdom) and the Playwright tests (smoke, wizard to chapter)
```

The scripted model is a deterministic test double, labelled as such in the status bar and by
`model_status`; it exists so the interface can be developed and tested without a key and
without network. The bridge is a development tool only and is never shipped.

## Where things are

Projects stay where you created them (Markdown and YAML, `docs/project-format.md`); the app
keeps only interface preferences and the list of recent projects locally. User settings shared
with the CLI live in `~/.apex-galaxia/config.yaml`. Logs of model calls are in each project's
`history/calls.jsonl`.
