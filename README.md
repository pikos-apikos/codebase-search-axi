# codebase-search-axi

A bounded, read-only codebase search CLI for agents, built around [ripgrep](https://github.com/burntsushi/ripgrep) and designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface) principles.

It provides compact JSON output for file discovery, pattern search, surrounding context, and basic repository metrics.
Common generated directories and sensitive files are excluded by default.

## Usage

```bash
bin/codebase-search files --root .
bin/codebase-search search 'pattern' --root . --max-results 25
bin/codebase-search context 'pattern' --root . --before 2 --after 2
bin/codebase-search metrics --root .
```

Run `bin/codebase-search --help` for the complete interface.

## Requirements

- Python 3
- [ripgrep](https://github.com/burntsushi/ripgrep) (`rg`)

## AXI conformance

This project follows the reference-AXI pattern set by tools such as [gh-axi](https://github.com/kunchenguid/gh-axi): a thin, non-interactive wrapper over an existing CLI (`rg`) that gives agents bounded, machine-readable results, structured error records with nonzero exit codes, a default limit with an explicit `--all` escape hatch (currently unbounded for `files` and `metrics`; `search` and `context` remain capped), a skill under `.agents/skills/`, and tests that exercise the public CLI contract.

Deliberate divergences from `gh-axi`, kept because they fit a small local-search tool rather than a networked service adapter:

- Output is compact JSON instead of TOON (principle 1).
- No no-argument dashboard; a subcommand is required (principle 8).
- Output records carry no next-step suggestions (principle 9).
- No npm package or release pipeline; use the repository directly via `bin/codebase-search`.
- Implemented in Python 3 instead of TypeScript/Node.

## Test

```bash
tests/codebase-search.test.sh
```
