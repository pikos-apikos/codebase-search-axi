# Issue #8 evaluation report

Date: 2026-10-09 UTC
Scope: evaluation only; synthetic/local fixtures; no product changes, paid run, private corpus, or publication.

## Result

The merged v1 candidate agreed with equivalent direct `rg` on implementation/usage search, scoped discovery, multiline matching, overlapping context, count semantics, empty results, and mandatory exclusion behavior.
This evidence establishes correctness agreement for the tested fixture, not improved agent outcomes, reliable token savings, latency, or cost.

Timing was deferred because the evaluation host was not stable/idle.
No paid cost was measured.

## Revision and environment

- Evaluated revision: `4513cf5ad994ec0a855112b95a490b5e5a9dbb62`.
- Model: `gpt-5.6-luna`, medium effort.
- Corpus: synthetic `evaluation-fixture`; no private corpus is included.
- Node `v22.23.2`, ripgrep `15.2.0`, PCRE2 available, `axi-sdk-js` `0.1.13`.
- Deterministic package/test checks recorded 69/69 passing on the candidate lineage.

## Deterministic comparison

| Task | Expected | Wrapper actual | Direct actual | Result |
| --- | --- | --- | --- | --- |
| Implementation/usage literal `greet` | 3 matches in `src/app.ts` | Same paths, lines, columns, text and offsets | 3 matching events with the same values | PASS |
| Scoped files with default policy | 4 files | Same 4; complete scan/display | Same 4 after root-relative normalization | PASS |
| Multiline `BEGIN\\n(.*?)\\nEND` | One record with two submatches | One record, span lines 1–3 | Same text/submatches; native occurrence detail is 2 | PASS; record/occurrence distinction |
| Overlapping context, `needle`, before/after 2 | 5 records without repeated shared context | 5 records; adjacent context deduplicated | Equivalent windows under the same policy | PASS |
| Count matching lines | Aggregate 5 across 2 files | Same per-file counts and aggregate | Same native counts | PASS |
| Count occurrences | Fixture occurrence total 5 | Same per-file and aggregate | Same native counts | PASS |
| Empty pattern result | Successful empty result | Exit 0, complete, zero matches | Native `rg` exit 1 for no match | PASS for wrapper contract |
| Invalid regex `[` | Structured invalid-pattern error | Exit 1 with `invalid_pattern` | Exit 2 with native diagnostic | PASS for classification |
| Required exclusions with `--full needle` | Optional vendor may appear; `.env.secret` must not | 6 matches, no `.env.secret` | Same policy result | PASS |

## Bounded agent usage comparison

The maximum bounded run contained 24 successful invocations, with three attempted observations per task/condition and one initial direct-rg sandbox failure.
The machine-readable values and standalone chart are [agent-usage-summary.json](agent-usage-summary.json) and [comparison-chart.svg](comparison-chart.svg).

The reported arithmetic proxy is `input_tokens + output_tokens` from `turn.completed`.
Input, cached-input, output, and reasoning-output fields are distinct; cached and reasoning tokens are not added to the proxy.
The proxy is a session total, not isolated search cost.
The CLI itself exposes no model-token telemetry.

| Task | Direct-rg median proxy | Wrapper median proxy | Accepted sample note |
| --- | ---: | ---: | --- |
| Implementation/usage | 39,045 (n=2) | 30,470.5 (n=2) | Fair fixture-scoped observations |
| Scoped discovery | 47,565 (n=1) | 38,638 (n=2) | Direct sample limited; one observation omitted mandatory exclusions |
| Multiline | 35,513 (n=2) | 30,544 (n=2) | Fair fixture-scoped observations |
| Overlapping context | 24,325 (n=1) | 30,640.5 (n=2) | Direct sample limited; later runs searched parent scope |

The initial direct-rg sandbox failure was an execution-capability finding, not a product result.
Invalid parent-scope or omitted-mandatory-exclusion observations remain excluded rather than silently counted.
The unequal sample sizes, exploratory context, and session-level proxy prevent a general token-saving or agent-experience claim.

## Limitations and exclusions

- Correctness agreement is from a small synthetic fixture and does not establish representative large-codebase performance.
- Direct discovery has only one valid observation and direct context has only one valid observation after fairness correction.
- Timing is deferred; no speed or latency advantage is asserted.
- Pricing, search-process model tokens, and subjective preference are unknown; no paid-cost claim is made.
- Raw transcripts, prompts, session/account identifiers, private corpus data, and operational host paths are intentionally omitted from this repository.
- Raw permitted events remain on the evaluation host and were used as read-only validation inputs; this release contains no raw directory.
- The report does not cover deleted/unreachable objects, tracker attachments, external corpora, or future evaluation runs.

## Reproducibility and provenance

The source artifacts used for this curated transfer have these SHA-256 digests:

| Source | SHA-256 |
| --- | --- |
| `report.md` | `85bd17af55fcaeaf964fc7b7ceb6255949a65565b0281bf7229636e4d413dcba` |
| `agent-usage-summary.json` | `a9dcbd3426dc1c42b436cdfd6dded58d0d79be678ce2ea039423979aeb10249a` |
| `comparison-chart.svg` | `a580e05304c7bfcc20524616fae879b0341629ee4a572b9b51d1db150c8ee2e8` |

The source report included local operational paths; this portable copy replaces them with the explicit omitted-raw scope above.
The published JSON and chart retain the approved observations and values without shipping transcripts or credentials.
