# Apex Galaxia

A free, open-source, local-first creative-writing harness for Claude. Every story is a folder
of Markdown and YAML on your own machine; the harness drafts, describes, rewrites, checks and
remembers, and never writes into a chapter without your accept.

*По-русски ниже.*

## What it is

- **Write** in four modes (continue, guided, scene, chapter) from a manuscript window, rolling
  summaries, the Story Bible and the chronicle, under a visible token budget.
- **Story Bible**: characters, locations, factions, items, world rules, glossary, research
  dossiers; aliases in Russian and English; entries activate when the text mentions them.
- **Chronicle**: who is where, wounds, items, who knows what, promises, open threads, planted
  guns, pending consequences; a reader-safe log and a hidden block; a handover command.
- **Narrator system** (Gwen): storytellers Cassandra, Phoebe and Randy (with a real d20 rolled in
  code), fate harshness 1–6, ratings as ceilings, hard limits in code and prompt.
- **AI-tell linter** in both languages, deterministic and tested against a seeded fault set.
- **Context inspector**: which Bible entries, chronicle facts, rules and lessons were in the
  prompt, what was trimmed and why, which model ran and what it cost.
- **Describe** in sensory layers and **Rewrite** as per-paragraph diffs with a voice lock.
- **Headless mode**: the repository works from Claude Code alone through an MCP server, skills
  and subagents, with or without an API key.

About "Muse": Sudowrite's Muse is a proprietary fiction-tuned model. We do not train one. Our
equivalent is the Muse Layer: layered prompts, a prose contract, the linter, a critic pass and a
bounded revision loop. Nothing here is a custom model.

## Status

Phases 0–4 of the build plan are done: core, CLI, headless mode, the desktop app
(`apps/desktop`: Tauri 2 shell, a CodeMirror prose editor, panels, palette, suggestion block,
diffs, wizards, views; installers built in CI, `docs/desktop.md`) and the narrator system in the
app: Gwen's chat panel, the ASK gate for irreversible choices, 2–3 Write candidates with the
pairwise A/B record, planner evals, manuscript and Bible import, the canvas board. From Phase 5
the core pieces exist and are tested offline: the Muse Layer critic loop, autonomous runs with
resume, lesson capture, the eval suite and `/improve`; from Phase 6, exports to Markdown, DOCX and
EPUB. Releases are built by the `Release` workflow on version tags (`docs/release.md`). See
`docs/plans/` and `docs/reports/`.

## Run it

```bash
pnpm install && pnpm build && pnpm test
node packages/cli/dist/bin.js --help

# a shipped sample project
node packages/cli/dist/bin.js open samples/ru-mayak
node packages/cli/dist/bin.js lint samples/ru-mayak/chapters/01-smena.md --project samples/ru-mayak
node packages/cli/dist/bin.js inspect samples/ru-mayak        # what the next Write would see

# your own story (model calls need ANTHROPIC_API_KEY in the environment or ~/.apex-galaxia/.env)
node packages/cli/dist/bin.js new ~/stories/my-story --title "My Story" --lang en --idea "…"
node packages/cli/dist/bin.js bible add character "June" ~/stories/my-story --alias "the deckhand"
node packages/cli/dist/bin.js write ~/stories/my-story --chapter 1
node packages/cli/dist/bin.js accept <suggestion-id> ~/stories/my-story
node packages/cli/dist/bin.js chronicle ~/stories/my-story --propose 1 --apply
node packages/cli/dist/bin.js run ~/stories/my-story --chapters 2       # the whole story, unattended, resumable
node packages/cli/dist/bin.js eval --no-critic                            # the eval suite (lint only without a key)
node packages/cli/dist/bin.js export ~/stories/my-story --format epub     # also md and docx
```

In Claude Code: open the repository and run `/new-story`, `/write-chapter`, `/update-chronicle`,
`/lint-prose`, `/check-bible`, `/research-lore`. Details in `docs/harness-mode.md`.

## Documentation

`docs/architecture.md`, `docs/project-format.md`, `docs/prompts.md`, `docs/harness-mode.md`,
`docs/competitive-analysis.md`, `docs/decisions/` (ADRs), `docs/attribution.md`,
`docs/plans/`, `docs/reports/`.

## Privacy

Everything inside a story project is yours. It goes only to the model API you configured; no
telemetry, no analytics, no uploads elsewhere. Keys live in the environment or in
`~/.apex-galaxia/.env`, never in the repository or a project.

## License

MIT. See `LICENSE` and `docs/attribution.md`.

---

# Apex Galaxia (по-русски)

Бесплатный открытый локальный харнесс для писателя, работающий с Claude. Каждая история —
папка с Markdown и YAML на вашем компьютере; харнесс пишет черновики, описывает, переписывает,
проверяет и помнит, но никогда не правит главу без вашего «принять».

## Что умеет

- **Написать**: продолжение, продолжение по заданию, сцена, глава; контекст из окна рукописи,
  кратких содержаний прежних глав, Библии и летописи, с видимым бюджетом токенов.
- **Библия истории**: персонажи, места, фракции, предметы, законы мира, глоссарий, досье;
  псевдонимы на русском и английском; записи подключаются, когда текст их упоминает.
- **Летопись**: кто где, раны, предметы, кто что знает, обещания, открытые линии, заложенные
  ружья, назревающие последствия; журнал для читателя и скрытый блок; команда передачи.
- **Рассказчица Гвин**: Кассандра, Фиби и Рэнди (настоящий d20 в коде), жёсткость судьбы 1–6,
  рейтинг как потолок, жёсткие границы в коде и в промпте.
- **Линтер ИИ-следов** на двух языках, детерминированный, проверенный на наборе ошибок.
- **Инспектор контекста**: какие записи, факты, правила и уроки попали в промпт, что урезано и
  почему, какая модель и сколько стоило.
- **Описать** по слоям чувств и **Переписать** как построчный диф с замком голоса.
- **Безголовый режим**: репозиторий работает из Claude Code через MCP-сервер, скиллы и агентов,
  с ключом API или без него.

О «Muse»: у Sudowrite это закрытая модель, дообученная на прозе. Мы ничего не обучаем. Наш
ответ — слой Muse: слоистые промпты, контракт прозы, линтер, критик и ограниченный цикл правок.
Своей модели здесь нет.

## Состояние

Готовы фазы 0–3: ядро, командная строка, безголовый режим и настольное приложение
(`apps/desktop`: оболочка Tauri 2, редактор прозы на CodeMirror, панели, палитра команд, блок
предложений, диффы, мастера, виды; инсталляторы собираются в CI, см. `docs/desktop.md`). Из
фаз 4–5 сделаны и проверены без сети части ядра: цикл критика (слой Muse), автономный режим с
возобновлением, уроки из правок, набор евалов, `/improve` и канвас (карточки, полосы,
продвижение, ИИ-действия); из фазы 6 — экспорт в Markdown, DOCX и EPUB. Ещё не сделаны: чат
рассказчицы (фаза 4), визуальная доска и парное сравнение (фаза 5). Планы в `docs/plans/`,
отчёты в `docs/reports/`.

## Запуск

```bash
pnpm install && pnpm build && pnpm test
node packages/cli/dist/bin.js open samples/ru-mayak
node packages/cli/dist/bin.js new ~/stories/moya --title "Моя история" --lang ru --idea "…"
node packages/cli/dist/bin.js write ~/stories/moya --chapter 1      # нужен ANTHROPIC_API_KEY
```

В Claude Code: откройте репозиторий и запустите `/new-story`, `/write-chapter`,
`/update-chronicle`, `/lint-prose`, `/check-bible`, `/research-lore`.

## Приватность

Всё внутри проекта истории принадлежит вам и уходит только в настроенный API модели. Никакой
телеметрии и аналитики. Ключи хранятся в окружении или в `~/.apex-galaxia/.env`, никогда в
репозитории или проекте.

Лицензия MIT.
