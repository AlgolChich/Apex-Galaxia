# Eval records

`apex eval` writes one Markdown report and one JSON results file per run here, named
`<date>-<variant>`: critic means per criterion on the golden and fault sets, linter coverage of
the seeded faults, model ids, cost, and a delta when a baseline is given. Run it whenever house
rules or templates change and before any release. No run is recorded yet: the first one needs the
Author's golden set and an API key.

`apex eval --planner` (MCP `eval_run {planner: true}`) runs the planner evals: every brief in
`evals/planner/` is planned under each storyteller and harshness level it lists, and under each
forced d20 result for Randy; the critic model judges harshness fit, storyteller fit and roll
obedience, and a deterministic distance between the beat sheets of the lowest and the highest
harshness says whether the level changed the plan at all. Reports are `<date>-planner.md`.
A project's `history/ab.jsonl` (the Author's pairwise choices, `ab_record`) joins the regular
report as the critic agreement rate.
