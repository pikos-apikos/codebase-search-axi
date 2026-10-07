# codebase-search-axi

A bounded, read-only codebase search CLI for agents, built around [ripgrep](https://github.com/burntsushi/ripgrep) and designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface) principles.

It provides compact JSON output for file discovery, pattern search, surrounding context, and basic repository metrics.
Common generated directories and sensitive files are excluded by default.
Ripgrep's normal ignore, hidden-file, binary, and encoding behavior applies.

The planned v1 search, policy, output, and component contract is documented in
[`docs/v1-contract.md`](docs/v1-contract.md).

## Usage

```bash
bin/codebase-search files --root .
bin/codebase-search search 'pattern' --root . --max-results 25
bin/codebase-search context 'pattern' --root . --before 2 --after 2
bin/codebase-search metrics --root .
```

Run `bin/codebase-search --help` for the complete interface.

The default result limit is 50. `--max-results N` changes that display limit;
files, search, and context still finish the scan and report `total`, `returned`,
and `complete.scan`/`complete.display`. `count` retains its existing meaning of
returned records. `--all` removes the result limit for the current commands but
keeps every existing path exclusion; it conflicts with an explicit
`--max-results`. Bounded metrics report `files_seen`, `bytes_seen`, and
`lines_seen` with `complete.scan: false`; `metrics --all` returns full aggregates
within those exclusions.

Pass a pattern beginning with a dash after the argument separator:

```bash
bin/codebase-search search --root . --all -- -needle
```

Match and context text retain rg's line terminators. Valid UTF-8 values are
strings; non-UTF8 paths, text, context lines, and submatches are lossless
`{"bytes":"<base64>"}` values. Columns and submatch offsets count bytes.
Failed or interrupted scans return structured errors without partial results.
Missing rg, invalid patterns, and backend failures exit 1; invalid CLI requests
exit 2; successful empty results exit 0. Backend diagnostics go to stderr.

## Requirements

- Python 3
- [ripgrep](https://github.com/burntsushi/ripgrep) (`rg`)

## AXI conformance

This project follows the reference-AXI pattern set by tools such as [gh-axi](https://github.com/kunchenguid/gh-axi): a thin, non-interactive wrapper over an existing CLI (`rg`) that gives agents bounded, machine-readable results, structured error records with nonzero exit codes, a default limit with an explicit `--all` escape hatch, a skill under `.agents/skills/`, and tests that exercise the public CLI contract.

Deliberate divergences from `gh-axi`, kept because they fit a small local-search tool rather than a networked service adapter:

- Output is compact JSON instead of TOON (principle 1).
- No no-argument dashboard; a subcommand is required (principle 8).
- Output records carry no next-step suggestions (principle 9).
- No npm package or release pipeline; use the repository directly via `bin/codebase-search`.
- Implemented in Python 3 instead of TypeScript/Node.

The rg adapter slice implements only backend and result prerequisites. The
planned `--full`, policy configuration, count command, text/serialized-byte and
explicit scan bounds, TOON, and explicit JSON selection remain downstream.
Adjacent context records may repeat overlapping lines; context overlap
deduplication and an explicit `--json` interface are still unresolved downstream
contract gaps. The existing `--all` adapter also retains optional generated-path
exclusions until the later policy/migration slice. It cannot bypass sensitive
path exclusions. See [the adapter evidence](docs/rg-adapter.md) for scope and
verification details.

## Test

```bash
tests/codebase-search.test.sh
```
