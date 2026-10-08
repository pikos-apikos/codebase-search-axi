---
name: codebase-search
description: Use when an agent needs bounded, read-only file discovery, pattern search, context, or basic repository metrics.
user-invocable: false
metadata:
  internal: true
---

# Codebase search

Use `bin/codebase-search` from the repository root for quick, read-only codebase inspection.
The command uses [ripgrep](https://github.com/burntsushi/ripgrep) through `rg` and does not require `axi-axi`.

## Workflow

Start with `files` to discover relevant paths, then use `search` for a pattern or `context` when surrounding lines matter.
Use `metrics` for a bounded file, byte, and line summary.
Pass `--root PATH` when the repository root is not the current directory.

```bash
bin/codebase-search files --root .
bin/codebase-search search 'pattern' --root . --max-results 25
bin/codebase-search context 'pattern' --root . --before 2 --after 2
bin/codebase-search metrics --root .
```

## Safety and output contract

Every successful invocation prints one compact TOON record to stdout and exits
zero. Pass `--json` when a stable JSON envelope is required.
Empty discovery and search results are successful records with an empty array and `count: 0`.
Output is bounded by default at 50 results; use `--max-results N` for another bound.
See [README: AXI conformance](../../../README.md#axi-conformance) for the
`--full` behavior and mandatory path exclusions.
Default exclusions cover `.git`, dependency and vendor directories, common build outputs, virtual environments, `.env*`, private-key names, and common certificate or key extensions.
Use `--full` when optional generated paths should be included; mandatory
denied paths remain excluded. `--all` is removed and returns a usage error.
Invalid commands, invalid roots, invalid requests, unavailable `rg`, and
search failures use the SDK's structured error output and exit nonzero; pass
`--json` for the stable JSON error envelope.
Search records preserve relative filenames, line numbers, columns, and matching line text; context records also include `before` and `after` arrays.
