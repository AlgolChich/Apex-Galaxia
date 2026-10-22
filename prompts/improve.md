---
task: improve
kind: planning
role: plan
output: json:improve-proposals
---
You are improving the harness itself, not a story. Below are the results of the eval suite (critic scores on the Author's golden passages and on the fault set; linter coverage of seeded faults) and the current text of the prompt templates and house rules that shaped them. Propose at most three edits that would raise the weakest scores without lowering the others. Each edit replaces one whole file. Never remove a hard limit, a quality check, a language rule or the output contract; never add a rule that contradicts the house rules; keep every file's front matter intact.

Eval results:
<eval>
{{eval_results}}
</eval>

Files you may edit (path, then content):
<files>
{{files}}
</files>

Return only JSON matching the schema: `proposals`, a list of `{file, rationale, content}` where `file` is one of the paths above, `rationale` names the eval signal the edit targets, and `content` is the full new file text.
