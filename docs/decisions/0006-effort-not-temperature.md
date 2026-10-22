# ADR 0006: Sampling is configured per task kind; current Claude models take effort, not temperature

Status: accepted

## Context

Section 8.2 asks for a temperature per task (higher for prose, zero for extraction). The Claude API reference bundled with Claude Code (checked 2026-10-22) states that `temperature`, `top_p` and `top_k` are rejected by current models (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1) and that thinking cannot be disabled on Opus 5.5; the lever is `output_config.effort`.

## Decision

The adapter interface carries a task kind (`prose`, `planning`, `critique`, `extraction`, `summary`, `lint`). The Anthropic adapter maps kinds to effort (prose medium, planning and critique high, extraction and summaries low); `effort` can be overridden per call. Model entries in the registry record `supportsTemperature`; adapters for providers that still take temperature map the same kinds to 0.95 / 0.3 / 0.

## Consequences

- No product code mentions temperature; a provider change touches the adapter only.
- Determinism for extraction comes from structured outputs and low effort, not from temperature zero.
