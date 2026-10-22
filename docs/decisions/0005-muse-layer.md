# ADR 0005: The Muse Layer is prompts, contracts, lint and critique, not a model

Status: accepted

## Context

Sudowrite's Muse is a proprietary fiction-tuned model. We do not train one (non-goal) and must say so plainly (Section 2).

## Decision

The Muse Layer is a pipeline around every prose generation: layered prompts (narrator, language module, house rules and lessons, contract, rating and hard limits), a prose contract checked in code, the tier-one linter on the raw output, a critic pass by a second model with the rubric, and a bounded revision loop of at most two passes that touches only quoted spans. Presets `fast`, `balanced`, `best` switch the stages. The README names it as such and never calls it a custom model.

## Consequences

- Quality comes from the Author's rules and edits, which is where the taste is.
- The pipeline is testable offline with the replay adapter; the critic loop is measured on the golden set before it ships (Phase 5 gate).
