# rg execution and result fidelity slice

Starting base: `d72a4abb1801731fa35bb1a207b0850a41425a2e`, current main at
dispatch and the merged v1 contract. This slice addresses
[Issue #3](https://github.com/pikos-apikos/codebase-search-axi/issues/3).

`bin/codebase_search/backend.py` owns subprocess execution. Patterns are values
following `-e`, and the root follows `--`. No native option passthrough exists.
`--no-config` prevents ambient ripgrep configuration from changing the approved
argument model; ordinary native ignore, hidden-file, binary, and encoding
behavior is preserved. Stderr is spooled separately to avoid pipe deadlocks;
errors forward at most 65536 diagnostic bytes to stderr with a generic,
actionable structured stdout error. Children are terminated and reaped on
early stream closure or interruption, with kill escalation after one second.
Search requires both native successful termination and the rg summary event.

`bin/codebase_search/results.py` normalizes text/base64 event values without
loss. UTF-8 becomes strings and other bytes become standard padded base64
objects. Path bytes remain root-relative; internal filesystem surrogate transport
is never emitted. Line terminators and byte positions are retained, including
submatch positions. Context consumes rg events so native encoding conversion is
preserved. Context remains one before/after array per match record and may repeat
overlapping lines; this does not resolve the downstream overlap deduplication gap.

See [README: Usage](../README.md#usage) for current result limits, completeness
fields, metrics observations, and failure behavior.

The current `--all` behavior documented in the README is the smallest
compatibility boundary for the existing CLI while keeping sensitive-path denies.
The future `--full`/`--all` migration and optional exclusion/policy framework
belong to the later policy/interface slices. This work does not establish the
full policy guarantee for every future root/filter/configuration combination.

The complete new command surface, count, text/output/scan-bound flags, TOON,
explicit `--json` selection, field projection, packaging, and output discovery
remain downstream. Both the explicit JSON interface and context overlap
deduplication gaps noted in the contract handoff remain open.

## Verification

Run `tests/codebase-search.test.sh` for the original shell scenarios plus the
public Python regressions. Python 3's standard `unittest` runner is sufficient;
no new dependency is required. The fixtures use ripgrep 15.2.0 at implementation
time.

The initial regressions reproduced unsafe `-needle` matching, 50 of 76 results
under `--all` in both search and context, byte-valued path/content failures,
missing completeness metadata, a stderr-fill timeout, false success after a
backend SIGTERM or a late error, and a CLI SIGINT traceback/SIGTERM termination.
Invalid regex was reported as generic `invalid_request` with exit 2. The
explicit bound/`--all` conflict was separately observed failing before repair.
Bounded metrics mislabeling was reproduced through the original executable
from the unchanged starting commit in an isolated fixture.

Regression coverage exercises the public executable with native rg for pattern
safety, 76 matches, display totals, UTF-8 and base64 paths/text/context/submatches,
byte offsets, non-UTF8 roots, native UTF-16 conversion, mandatory denies, ignore
and binary behavior, empty matches, and invalid regex. Controlled subprocesses
exercise stderr flooding, late failures, malformed/missing-completion streams,
backend signals, CLI SIGINT/SIGTERM, and child reaping. Ordinary permitted search
is compared to normalized direct `rg --no-config --json -e` events including
every submatch offset and the full emitted line bytes.

No configured CI checks were reported at dispatch. Local verification is not
evidence of CI readiness; no-mistakes delivery and exact tested/pushed head are
recorded in the Firstmate handoff after implementation.
