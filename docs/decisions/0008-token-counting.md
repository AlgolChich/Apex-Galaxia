# ADR 0008: Token budget uses exact provider counts when available, a calibrated estimate otherwise

Status: accepted

## Context

Section 10.3 says budgets must use real counts from the adapter, not word counts; Section 8.7 wants context assembly under 200 ms excluding model calls. One network round trip per layer per assembly would break the latter.

## Decision

The assembler takes a `TokenCounter`. The Anthropic adapter supplies an exact counter (`countTokens`) wrapped in a cache keyed by text, so stable layers are counted once per process; without a provider the heuristic estimator (about 4 characters per token for Latin text, 2.2 for Cyrillic) is used. The inspector states which one produced the numbers (`exact` or `estimated`).

## Consequences

- Unit tests and headless mode never touch the network for counting.
- A first assembly with a cold cache can take a few round trips; later ones are fast. If that proves too slow in the app, counts for Bible entries can be cached on disk beside the entries.
