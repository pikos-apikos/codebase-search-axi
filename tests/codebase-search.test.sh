#!/usr/bin/env bash
# Canonical test entry for codebase-search. Builds the TypeScript CLI and runs
# the Node test suite (public CLI contract + the rg adapter fidelity
# regressions). Requires Node.js (>=20.11) and ripgrep on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required on PATH" >&2
  exit 1
fi

npm run build
node --test
