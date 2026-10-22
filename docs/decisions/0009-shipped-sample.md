# ADR 0009: The shipped sample projects are original text under the repository license

Status: accepted, revisit when a public-domain text can be fetched

## Context

Section 9 asks for a public-domain text as the shipped sample so the Author's private stories stay out of the repository. The build environment could not reach Project Gutenberg or Wikisource (network policy), and reproducing a public-domain text from memory risks a corrupted copy.

## Decision

`samples/ru-mayak` and `samples/en-ferry` are short original story projects written for the repository and covered by its MIT license. They exercise every file type and every command. Replacing a chapter with a public-domain text is a one-file change.

## Consequences

- The samples are not an eval golden set; the golden set is the Author's own rated passages.
- When a public-domain text is added, keep the Bible entries and chronicle of the sample consistent with it.
