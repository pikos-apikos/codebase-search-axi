# codebase-search-axi

A bounded, read-only codebase search CLI for agents, built around [ripgrep](https://github.com/burntsushi/ripgrep) and designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface) principles.

**Target architecture (settled):** see the [v1 contract's scope and ownership boundaries](docs/v1-contract.md#scope-and-baseline).

**Current implementation:** Node.js / TypeScript, dispatching through [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js) and driving `rg` directly (no Python bridge).

It provides compact TOON output by default, with explicit JSON output for file discovery, pattern search, surrounding context, and basic repository metrics.
Common generated directories and sensitive files are excluded by default.

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

## Requirements

- Node.js >= 20 (TypeScript build uses `tsc`)
- [ripgrep](https://github.com/burntsushi/ripgrep) (`rg`)

## Setup

```bash
npm install
npm run build
```

`bin/codebase-search` is a Node launcher; it requires the compiled `dist/` output from `npm run build`.

## AXI conformance

This project follows the reference-AXI pattern set by tools such as [gh-axi](https://github.com/kunchenguid/gh-axi): a thin, non-interactive wrapper over an existing CLI (`rg`) that gives agents bounded, machine-readable results, structured error records with nonzero exit codes, a default limit with an explicit `--full` escape hatch, an explicit `--json` interface, a skill under `.agents/skills/`, and tests that exercise the public CLI contract.

Deliberate divergences from `gh-axi`, kept because they fit a small local-search tool rather than a networked service adapter:

- JSON is available through the explicit `--json` selector; TOON remains the default (principle 1).
- No no-argument dashboard; a subcommand is required (principle 8).
- Output records carry no next-step suggestions (principle 9).
- No published npm package or release pipeline; use the repository directly via `bin/codebase-search` (after `npm install && npm run build`).

## Test

```bash
tests/codebase-search.test.sh
```

The entry point builds the TypeScript CLI (`npm run build`) and runs the Node test suite (`node --test`), covering the public CLI contract and the rg adapter fidelity regressions.
