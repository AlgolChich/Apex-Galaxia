# Eval records

`apex eval` writes one Markdown report and one JSON results file per run here, named
`<date>-<variant>`: critic means per criterion on the golden and fault sets, linter coverage of
the seeded faults, model ids, cost, and a delta when a baseline is given. Run it whenever house
rules or templates change and before any release. No run is recorded yet: the first one needs the
Author's golden set and an API key.
