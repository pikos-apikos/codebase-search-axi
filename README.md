# codebase-search-axi

A small, read-only [ripgrep](https://github.com/BurntSushi/ripgrep) wrapper for agents. One TypeScript/Node package invokes `rg` directly and uses the official [axi-sdk-js](https://github.com/kunchenguid/axi/tree/main/packages/axi-sdk-js) runtime for dispatch, TOON, errors, version discovery, and opt-in integrations.

Use it for file discovery, pattern search, context, counts, and secondary repository metrics. Matching remains ripgrep's responsibility. The wrapper supplies policy, finite display limits, and explicit scan/display completeness.

**Release status:** `0.1.0` is an unpublished experimental candidate, licensed under [MIT](LICENSE). The owner confirmed the initial material may be distributed under MIT on 2026-10-09. [Issue #9](https://github.com/pikos-apikos/codebase-search-axi/issues/9) records the approved first GitHub publication route and outstanding evidence transfer/publication steps. AXI catalog admission is separate; no admission or measured performance improvement is claimed.

## Requirements and installation

- Node.js >= 20, npm, and `rg` on `PATH`.
- PCRE2 matching requires a PCRE2-enabled ripgrep build.
- Linux is the verified release environment. Other platforms and the full Node version range have not received release qualification. Byte-exact non-UTF8 argument recovery uses Linux `/proc/self/cmdline`; other platforms preserve valid UTF-8 arguments only.

From an authorized checkout:

```bash
npm ci
npm run build
bin/codebase-search --version
bin/codebase-search files --root .
```

Prepare a local tarball:

```bash
mkdir -p artifacts
npm pack --pack-destination artifacts
```

In a separate disposable directory, install that tarball by absolute path:

```bash
npm install --ignore-scripts /absolute/path/codebase-search-axi-0.1.0.tgz
npx --no-install codebase-search --version
npx --no-install codebase-search files --root /absolute/path/to/project
```

The tarball contains compiled JavaScript, the launcher, portable skill, documentation, and dependency notices. Execution needs neither the source checkout, TypeScript compiler, Python, nor an agent runtime. npm installs dependencies; install ripgrep separately. There is no published registry installation command yet.

## Usage

For a tarball installation, replace the checkout launcher below with `npx --no-install codebase-search`.

```bash
bin/codebase-search
bin/codebase-search files --root .
bin/codebase-search search 'TODO' --root . --max-results 25 --json
bin/codebase-search search 'literal.text' --root . --fixed-strings
bin/codebase-search context 'pattern' --root . --before 2 --after 2
bin/codebase-search count 'pattern' --root . --full --json
bin/codebase-search metrics --root .
bin/codebase-search search --help
```

TOON is the default; `--json` and `--format json` select JSON. `--fields FIELD,...` projects records while retaining required completeness metadata. Empty results succeed. Usage errors exit `2`; execution/dependency errors exit `1`, with structured stdout records. Bare invocation returns orientation without scanning; bare `-v`, `-V`, and `--version` return the version without invoking ripgrep.

## Bounds and completeness

Default display limits are 50 records, 4,096 decoded content bytes per record, and 65,536 serialized output bytes. Display truncation does **not** automatically stop the backend. Optional `--scan-max-files` and `--scan-max-bytes` bound the scan itself.

Read `complete.scan` and `complete.display` independently. An aggregate `total` appears only when complete for the operation. Bounded `metrics` reports observations (`files_seen`, `bytes_seen`, `lines_seen`) rather than totals.

`--full` removes bounds and optional directory exclusions, conflicts with explicit bounds, and retains mandatory denies. Native ignore rules still apply unless explicitly broadened. `--all` is removed and returns a migration hint.

UTF-8 values are strings; non-UTF8 paths/content use `{ "bytes": "BASE64" }`. Columns are one-based byte positions; submatch offsets refer to untruncated ripgrep event data. See the [v1 contract](docs/v1-contract.md) for schemas, multiline counts, context deduplication, and exact byte rules.

## File policy

Mandatory exclusions cover `.git` trees, `.env*`, `id_rsa*`, and `.pem`, `.key`, `.crt`, `.cer`, `.p12`, `.pfx` files. Positive globs, `--full`, `--hidden`, and `--no-ignore` cannot override them.

Optional defaults exclude `node_modules`, `vendor`, `build`, `dist`, `target`, `coverage`, `.venv`, `venv`, and `__pycache__`. Explicit TOML policy controls optional globs and bound defaults:

```toml
optional_globs = ["!**/private-notes/**"]
max_results = 20
max_text_bytes = 2048
max_bytes = 32768
scan_max_files = 1000
scan_max_bytes = 10485760
```

```bash
bin/codebase-search search 'pattern' --root . --policy /absolute/path/policy.toml --json
```

Policies load only through explicit `--policy`. Unknown keys, malformed TOML, duplicate keys, and unsupported values fail. CLI bounds override policy defaults. Roots are canonicalized; ordinary file/directory symlinks are not followed. This is path policy for this wrapper's commands; the agent runtime owns access through independent tools.

## Optional AXI integration

The portable skill is `skills/codebase-search/SKILL.md`; its checkout mirror is `.agents/skills/codebase-search/SKILL.md`. Searches do not install hooks or contact a registry.

Hook setup requires an explicit isolated home. Personal account homes (including aliases) and project scope are rejected. For a disposable integration check:

```bash
integration_home=$(mktemp -d)
bin/codebase-search setup hooks status --home "$integration_home" --json
bin/codebase-search setup hooks install --home "$integration_home" --json
bin/codebase-search setup hooks uninstall --home "$integration_home" --json
```

SDK `update` and `update --check` are separate, explicit maintenance commands that can contact a registry. They do not imply this candidate is published; use the candidate installation instructions above.

## Verification and evidence

```bash
npm ci
bash tests/codebase-search.test.sh
npm run check:skill
npm run package:check
```

The public suite builds TypeScript and checks search, policy, fidelity, bounds, errors, and SDK integration. Package checks pack and install outside the checkout, then exercise the executable and isolated hook lifecycle. One read-bound regression requires working `strace`/`ptrace`; verification records environment restrictions explicitly.

See [CHANGELOG.md](CHANGELOG.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [release readiness](docs/release-readiness.md). [Evaluation evidence and limitations](docs/evaluation.md) summarize the tracker receipts and link the curated report, usage summary, and chart from [Issue #8](https://github.com/pikos-apikos/codebase-search-axi/issues/8). Timing is deferred; the measurements do not yet establish reliable token savings or a general agent-experience improvement.
