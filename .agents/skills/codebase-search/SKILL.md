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

Every successful invocation prints one compact JSON record to stdout and exits zero.
Empty discovery and search results are successful records with an empty array and `count: 0`.
See [README: Usage](../../../README.md#usage) for result limits, `--all`,
completeness metadata, lossless byte values, positions, and error behavior.
The exclusion list is maintained in `SAFE_GLOBS` in
[`bin/codebase-search`](../../../bin/codebase-search).
Invalid commands, invalid roots, invalid requests, unavailable `rg`, and search failures print a JSON error record and exit nonzero.
