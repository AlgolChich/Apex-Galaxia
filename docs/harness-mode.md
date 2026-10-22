# Headless harness mode

The repository is usable from Claude Code with no desktop app installed. A `CLAUDE.md`, skills,
subagents, a hook and an MCP server expose the core; the same project folder works in the CLI
and later in the app.

## Setup

```bash
git clone <repo> && cd ApexGalaxia
pnpm install && pnpm build          # builds the MCP server the .mcp.json points at
claude                              # Claude Code picks up CLAUDE.md, .claude/, .mcp.json
```

On first use Claude Code asks to approve the project-scoped MCP server `apex` (`.mcp.json`);
`.claude/settings.json` pre-approves it for trusted folders. No API key is required: in the
prepare/submit flow Claude Code is the model. With `ANTHROPIC_API_KEY` set (environment or
`~/.apex-galaxia/.env`), the model-backed tools use the configured models instead.

## Skills

| Skill | What it does |
| --- | --- |
| `/new-story <folder> <brief>` | parse the brief, create the project, research or add leads, plan and write chapter one, chronicle, summary |
| `/write-chapter [folder] [n] [note]` | plan with the storyteller and harshness (d20 for Randy), write one chapter, lint, suggest, accept, chronicle |
| `/update-chronicle [folder] [n \| --full]` | propose and apply the state diff, or print the handover with the hidden block separated |
| `/lint-prose <file \| chapter> [--fix]` | run the linter and explain hits; optional de-AI rewrite as a diff |
| `/check-bible [folder] <n> [--extract]` | contradictions against the Bible and chronicle; extraction of new entries |
| `/research-lore [folder] <topic> [canon point]` | research with web tools in order of trust; save a dossier with provenance |

| `/improve [--no-critic]` | run the eval suite, propose up to three template or rule edits as a variant, re-run, show the delta; never applies |

## Subagents

`writer`, `critic`, `researcher`, `chronicler` in `.claude/agents/`, each limited to the MCP tools
its job needs. The writer never judges, the critic never rewrites, the researcher never invents,
the chronicler records only what happened.

## Hook

`.claude/hooks/lint-on-save.mjs` runs after every Write or Edit of a file under `chapters/` and
returns the lint report as additional context. It never blocks.

## MCP tools

Project: `project_open`, `project_create`, `project_chapters`, `chapter_get`. Bible:
`bible_search`, `bible_get`, `bible_upsert`, `bible_extract` (model). Chronicle:
`chronicle_get`, `chronicle_apply`, `chronicle_propose` (model). Writing: `task_prepare`,
`task_submit`, `suggestion_get`, `suggestions_list`, `suggestion_accept`, `suggestion_discard`,
`write_continue` (model), `write_chapter` (model), `plan_chapter` (model), `summarize_chapter`
(model). Quality: `lint`, `critic_review` (model), `check_bible` (model), `inspect`. Craft:
`describe` (model), `rewrite` (model), `canvas_directions` (model), `lessons_propose` (model),
`lessons_add`, `research_save`, `eval_run`, `export_book`, `weave` (model). Canvas: `canvas_get`,
`canvas_add`, `canvas_link`, `canvas_remove`, `canvas_template`, `canvas_promote`, `canvas_outline`,
`canvas_ai` (model). App (used by the desktop, usable from Claude Code too): `model_status`,
`chapter_save` (the Author's own edit), `chapter_create`, `project_settings_update`,
`user_config_get`, `user_config_set`, `bible_list`, `bible_remove`, `plan_get`, `plan_save`,
`lint_whitelist_add`, `voice_card` (model), `narrator_options`, `run_start` (background, progress
as logging notifications with logger `apex.run`), `run_pause`, `run_get`, `run_list`.
`write_continue` and `write_chapter` stream their text as `notifications/progress` when the
client sends a progress token; `suggestion_accept` takes `edited_text`. Resources: `apex://project/config`, `apex://project/chronicle/state`,
`apex://project/chronicle/log`, `apex://project/brief`, `apex://project/chapters/{stem}`,
`apex://project/bible/{kind}/{slug}`, `apex://prompts/{task}`. Prompts: `brief`, `handover`.

### The prepare / submit flow

```
task_prepare {task: "write.chapter", chapter_number: 2}
  → handle, system layers, user turn, inspector, estimate, expected heading
(Claude Code writes the chapter following the prompt)
task_submit {handle, output}
  → contract check (violations come back to fix), lint report, suggestion id
suggestion_accept {id}
  → chapters/02-<slug>.md is created or extended
task_prepare {task: "chronicle.propose", chapter: 2} → task_submit → chronicle_apply
task_prepare {task: "summary.chapter", chapter: 2} → task_submit
```

Write outputs never touch a chapter until `suggestion_accept`; chronicle changes never land
until `chronicle_apply`; both are the Author's decisions.

## Acceptance test

`packages/mcp-server/test/server.test.ts` starts the server over stdio with no key and runs the
whole flow: create a project, add a Bible entry, prepare and submit a beat sheet (the d20 is
rolled for Randy), submit a chapter that violates the contract and then one that passes, accept
it, propose and apply a chronicle update, cache a summary, lint, save a sanitized dossier, and
confirm that a model-backed tool fails with a clear `ADAPTER_ERROR`. It runs in `pnpm test`.

The Author's own Team Fortress 2 project is not in the repository; to dogfood it, open its
folder with `project_open` (or set `APEX_PROJECT`) and run `/write-chapter`.
