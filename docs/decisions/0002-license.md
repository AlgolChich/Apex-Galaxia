# ADR 0002: License — MIT

Status: accepted as the proposed default (gate question 2)

## Context

The product is free and open (Section 2). The open-source peers are MIT (Ghostwriter, local-writing-app, CharacterArc), Apache-2.0 (Open-Write, Orison) and GPL-3.0 (novelWriter, Vela). Borrowing code from a GPL project would bind the repository to GPL; we borrow ideas from those and code from none.

## Decision

MIT, copyright the Author (Algol) and contributors. Third-party material under other licenses is listed in `docs/attribution.md`; nothing GPL-licensed is copied.

## Consequences

- Anyone can embed the core in another tool, including commercial ones; the Author keeps the name and the narrator persona as their own.
- Wikipedia-derived material (CC BY-SA) is used as ideas only, not copied, so the linter lists stay MIT.
