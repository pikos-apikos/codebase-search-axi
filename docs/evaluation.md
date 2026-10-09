# Evaluation evidence and limitations

Status: the curated report, machine-readable summary, and standalone chart are incorporated under [evaluation/2026-10-09](evaluation/2026-10-09/).
Raw transcripts and prompts remain intentionally excluded.

## Candidate and comparison

Evaluated implementation: [4513cf5ad994ec0a855112b95a490b5e5a9dbb62](https://github.com/pikos-apikos/codebase-search-axi/commit/4513cf5ad994ec0a855112b95a490b5e5a9dbb62), the Node/axi-sdk-js wrapper after PR #21. Synthetic tasks compared packaged codebase-search with direct ripgrep. The agent receipt identifies gpt-5.6-luna at medium reasoning. No private corpus is part of the publishable fixture evidence.

| Evidence | Tracker receipt | Recorded outcome |
| --- | --- | --- |
| Deterministic search/discovery/context/count checks | [6077710010](https://github.com/pikos-apikos/codebase-search-axi/issues/8#issuecomment-6077710010) | Correctness and completeness agreement under equivalent exclusions |
| Initial sequential agent comparison | [6077795625](https://github.com/pikos-apikos/codebase-search-axi/issues/8#issuecomment-6077795625) | Eight successful task-condition invocations; correctness agreement |
| Final bounded usage capture | [6078039886](https://github.com/pikos-apikos/codebase-search-axi/issues/8#issuecomment-6078039886) | 24-success ceiling; curated input/cached/output/reasoning usage summary incorporated below |
| Fairness correction | Same final receipt | Parent-scope/omitted mandatory-deny observations excluded; direct context n=1 and direct discovery n=2 |
| Latency | Same final receipt | Optional and deferred; no speed claim |

The deterministic fixture coverage includes implementation/usage search, scoped files, multiline matching, overlapping context, matching-line and occurrence counts, empty/error classification, byte fidelity, and mandatory exclusions.

## Limitations

- The measurements do **not yet establish reliable token savings or a general agent-experience improvement**.
- Input+output totals are session proxies, not isolated search cost. Cached and reasoning fields need their own interpretation.
- Fairness corrections reduce already small samples. Comparisons require equal root/task/access policy and equivalent mandatory exclusions.
- Synthetic correctness agreement does not establish representative large-codebase agent performance.
- Timing remains deferred; no cold/warm latency or speed advantage is asserted.
- The curated report, standardized usage summary, and chart are now checked in under [evaluation/2026-10-09](evaluation/2026-10-09/).
- Raw events, transcripts, prompts, account/session identifiers, private corpus data, and operational host paths are intentionally omitted.

## Incorporated evidence

The incorporated files preserve the source report's tables, accepted sample counts, task/model/version metadata, usage-field definitions, fairness exclusions, adverse observations, source hashes, and evaluated revision.
The chart is a portable SVG and its values agree with the JSON summary.
The source report's local operational paths were replaced with an explicit omitted-raw scope.
No missing metric was inferred and no broad improvement is claimed.

The approved GitHub publication is complete at [v0.1.0](https://github.com/pikos-apikos/codebase-search-axi/releases/tag/v0.1.0), targeting `3dc5b60ff3adf58086ecdb6f1fd45d1c919fe102`.
MIT and initial-material distribution rights are already approved; they do not require another selection.
