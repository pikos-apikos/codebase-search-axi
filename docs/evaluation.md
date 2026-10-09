# Evaluation evidence and limitations

Status: the original comparison chart and numerical report tables have **not yet been incorporated**. This document summarizes linked GitHub receipts; it does not substitute invented numbers for the raw evaluation artifacts.

## Candidate and comparison

Evaluated implementation: [4513cf5ad994ec0a855112b95a490b5e5a9dbb62](https://github.com/pikos-apikos/codebase-search-axi/commit/4513cf5ad994ec0a855112b95a490b5e5a9dbb62), the Node/axi-sdk-js wrapper after PR #21. Synthetic tasks compared packaged codebase-search with direct ripgrep. The agent receipt identifies gpt-5.6-luna at medium reasoning. No private corpus is part of the publishable fixture evidence.

| Evidence | Tracker receipt | Recorded outcome |
| --- | --- | --- |
| Deterministic search/discovery/context/count checks | [6077710010](https://github.com/pikos-apikos/codebase-search-axi/issues/8#issuecomment-6077710010) | Correctness and completeness agreement under equivalent exclusions |
| Initial sequential agent comparison | [6077795625](https://github.com/pikos-apikos/codebase-search-axi/issues/8#issuecomment-6077795625) | Eight successful task-condition invocations; correctness agreement |
| Final bounded usage capture | [6078039886](https://github.com/pikos-apikos/codebase-search-axi/issues/8#issuecomment-6078039886) | 24-success ceiling; raw input/cached/output/reasoning usage retained on evaluation host |
| Fairness correction | Same final receipt | Parent-scope/omitted mandatory-deny observations excluded; direct context n=1 and direct discovery n=2 |
| Latency | Same final receipt | Optional and deferred; no speed claim |

The deterministic fixture coverage includes implementation/usage search, scoped files, multiline matching, overlapping context, matching-line and occurrence counts, empty/error classification, byte fidelity, and mandatory exclusions.

## Limitations

- The measurements do **not yet establish reliable token savings or a general agent-experience improvement**.
- Input+output totals are session proxies, not isolated search cost. Cached and reasoning fields need their own interpretation.
- Fairness corrections reduce already small samples. Comparisons require equal root/task/access policy and equivalent mandatory exclusions.
- Synthetic correctness agreement does not establish representative large-codebase agent performance.
- Timing remains deferred; no cold/warm latency or speed advantage is asserted.
- The original report, standardized usage summary, chart, and raw events remain on Firstmate's evaluation host. This preparation session did not independently inspect those artifacts. Numerical totals, percentages, and chart values are deliberately absent here.

## Required artifact transfer before release

Firstmate's existing evaluation artifacts are:

- `data/codebase-search-axi-issue-8-evaluation/report.md`
- `data/codebase-search-axi-issue-8-evaluation/comparison-chart.svg`
- `data/codebase-search-axi-issue-8-evaluation/agent-usage-summary.json`

Transfer the original chart, report tables/limitations, and their summary into a reviewable repository change. Preserve exclusions, accepted sample counts, task/model/version metadata, definitions of usage fields, and adverse observations. Check the chart against the summary and inspect publishable content before committing. Record source hashes and the evaluated revision. Do not infer missing metrics or claim broad improvements.

Release publication remains pending that concrete evidence incorporation and the supported visibility/release action. MIT and initial-material distribution rights are already approved; they do not require another selection.
