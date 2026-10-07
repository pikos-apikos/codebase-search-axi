# codebase-search-axi

A bounded, read-only codebase search CLI for agents, built around [ripgrep](https://github.com/burntsushi/ripgrep).

It provides compact JSON output for file discovery, pattern search, surrounding context, and basic repository metrics.
Common generated directories and sensitive files are excluded by default.

The v1 search, policy, output, and component contract is documented in
[`docs/v1-contract.md`](docs/v1-contract.md).

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

## Test

```bash
tests/codebase-search.test.sh
```
