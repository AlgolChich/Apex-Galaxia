# Prompt templates

One file per task, Markdown with YAML front matter. Templates are versioned here, editable by the
Author (a copy in `~/.apex-galaxia/prompts/<name>.md` overrides the shipped one), and
snapshot-tested in `packages/core/test`.

Front matter:

| Key | Meaning |
| --- | --- |
| `task` | Task name, equal to the file name (`write.continue`) |
| `kind` | Sampling behavior: `prose`, `planning`, `critique`, `extraction`, `summary`, `lint` |
| `role` | Which configured model runs it: `prose`, `plan`, `critic`, `extract`, `summary`, `lint` |
| `output` | `prose`, `markdown`, `yaml`, or `json:<schema>` (a schema name from `packages/core/schemas/`) |
| `lessons` | Lesson categories retrieved for this task (Section 6.3) |

Body: the task instruction with `{{placeholders}}`. `{{> name}}` includes another template
(`contract.prose`, `contract.rewrite`). The language module (`lang/ru.md`, `lang/en.md`) and the
narrator layers are added by the context assembler, not by the templates.

Prompts stay in English even when the story is Russian (Section 10.6); the language module
carries the Russian rules and the few-shot examples for Russian tasks are in Russian.
