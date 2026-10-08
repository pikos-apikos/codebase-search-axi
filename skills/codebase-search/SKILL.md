---
name: codebase-search
description: Use when an agent needs bounded, read-only file discovery, pattern search, context, or repository metrics.
user-invocable: false
metadata:
  internal: true
---

# Codebase search

Use the installed `codebase-search` executable for quick, read-only codebase inspection. For a local npm tarball installation, invoke it with `npx --no-install codebase-search`; it invokes ripgrep directly and does not require Python or an agent runtime.

## Workflow

Start with `npx --no-install codebase-search files` to discover relevant paths, then use `search` for a pattern or `context` when surrounding lines matter. Use `metrics` for a bounded file, byte, and line summary. Pass `--root PATH` when the repository root is not the current directory.

```bash
npx --no-install codebase-search files --root .
npx --no-install codebase-search search 'pattern' --root . --max-results 25
npx --no-install codebase-search context 'pattern' --root . --before 2 --after 2
npx --no-install codebase-search metrics --root .
```

## Safety and output contract

Every successful invocation prints one compact TOON record to stdout and exits zero. Pass `--json` when a stable JSON envelope is required. Empty discovery and search results are successful records. Output is bounded by default; use `--full` only when an unbounded scan is intended. Mandatory denied paths remain excluded.

For opt-in agent session integration, use `npx --no-install codebase-search setup hooks status` before choosing `setup hooks install`; use `npx --no-install codebase-search setup hooks uninstall` to remove only this tool's managed entries. Ordinary search commands never install hooks or contact a registry.
