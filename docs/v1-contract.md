# codebase-search v1 contract

Status: normative design for the next implementation slices. This is a
contract document, not a second search implementation.

## Scope and baseline

The product is one small TypeScript/Node package with `axi-sdk-js` as a
runtime dependency, invoking `rg` directly. No Python subprocess bridge is
retained. The wrapper preserves ripgrep matching and ignore behavior,
normalizes its events, and emits agent-facing output. There is no grep
fallback, index, graph, embedding engine, or server in v1.

The SDK owns dispatch, TOON serialization, structured error plumbing, the
version fast path, and opt-in agent integrations. This package owns search
semantics, file policy, byte fidelity, result processing, bounds, completeness,
and command-specific validation. The locked SDK version's extension points
are inspected before glue is added; `--json`, `--fields`, display/scan
bounds, and per-command validation are tool features and are never assumed
to be automatic SDK behavior. Any small adapter needed for SDK integration is
documented here rather than forking or cloning the SDK. Search commands remain
local and read-only: no SDK-provided setup or update side effects may occur
during a search, and SDK-provided maintenance commands, when exposed, are
described separately from the search commands.

The tested baseline is commit
`6f2d53d8aa22cf05380a41bcca93be238c50c3df` (ripgrep 15.2.0 in the test
environment). `tests/codebase-search.test.sh` passes. The baseline currently
has these known defects and omissions:

- only `files`, `search`, `context`, and secondary `metrics` exist; `count`
  does not exist;
- `--all` removes the safe globs, including sensitive-path exclusions, so it
  is not a valid v1 policy escape hatch;
- the wrapper forces `--no-ignore-vcs` and `--hidden`, changing ripgrep's
  normal ignore behavior;
- `--max-results` terminates ripgrep, so a bounded result is also an
  unreported partial scan; `metrics` presents such partial values as ordinary
  totals;
- there are no public literal/regex, case, type/glob, multiline, PCRE2,
  policy, text-byte, output-byte, scan-bound, or completeness controls;
- rg JSON `bytes` values are ignored: searching a file containing
  `b'needle \xff\n'` returns empty `text` instead of the matching bytes.
  Non-UTF8 paths are likewise not decoded by the match adapter. This is a
  result-fidelity defect tracked by #3, not an empty match.

These defects are evidence for the follow-on implementation tickets, not
changes made by this contract ticket.

## Commands and matching

All commands accept `--root PATH`, the common bound flags below, `--policy
PATH`, and `--format toon|json`. `--root` defaults to the current directory.
The default output is compact TOON; `--format json` is stable machine-readable
JSON with the same logical fields. `--json` is an explicit, stable interface
equivalent to `--format json` on every command; it is owned by this tool, not
assumed to be an SDK feature. All commands are non-interactive.

### `files`

Returns the policy-allowed files under the canonical root, in ripgrep traversal
order. A pattern is not required; `--type`, `--type-not`, and `--glob` narrow
the file set. Each item has a root-relative POSIX `path`. The envelope includes
`returned`, `total` when the scan is complete, and `complete.scan` and
`complete.display`.

### `search PATTERN`

Uses ripgrep's regex mode by default and returns one normalized record per
ripgrep match event, in backend order. A record contains `path`, `line`,
`column`, and the matching line as `text`; when useful for fidelity it also
contains ripgrep submatch offsets. `column` is one-based. Matching is not
reimplemented in the wrapper.

The following flags map directly to ripgrep semantics:

- `--fixed-strings` selects literal matching; otherwise the pattern is a
  ripgrep regex and is never shell-expanded or wrapper-escaped;
- `--case-sensitive` is the default; `--ignore-case` and `--smart-case` select
  the corresponding ripgrep modes. Conflicting case modes are a usage error;
- repeated `--type TYPE` and `--type-not TYPE` use ripgrep's type database;
  repeated `--glob GLOB` uses ripgrep glob syntax relative to the root;
- `--multiline` enables ripgrep multiline matching and
  `--multiline-dotall` keeps its native dot-all option. Multiline records carry
  start and end line/column data and the matched span; context is based on the
  span's boundary lines;
- `--pcre2` requests ripgrep's optional PCRE2 engine. If the installed `rg`
  lacks PCRE2, the command returns `unsupported_feature`; it never silently
  falls back to another engine.

### `context PATTERN`

Has the same matching flags and result records as `search`, plus
`--before N` and `--after N` (default `2`). `before` and `after` are arrays of
complete surrounding lines. They never become independent matches and are
not included in match counts. Context at a file boundary is an empty array.
When the before/after windows of adjacent match records in the same file
overlap, the output deduplicates the shared physical lines: a context line
already emitted for an earlier record in the same file is not repeated in a
later record's window, and file order is preserved. Deduplication is a
presentation rule only; it does not change match records, counts, or
positions.

### `count PATTERN`

Returns `{path,count}` records and an aggregate `total` only when the complete
scan succeeded. By default `count` follows ripgrep `--count` semantics: one
count per matching line, except that with `--multiline` and a pattern capable
of spanning lines, native `--count` is equivalent to `--count-matches`.
For example, `a\nb` matching two adjacent lines counts once, not twice.
`--count-matches` always selects ripgrep's per-occurrence semantics.
`matched_files` is the number of files with a non-zero count. A
display-limited list may omit per-file records while retaining a complete
aggregate; a scan-limited result must omit `total` and say why in
`complete.scan`/`help`.

### `metrics` (secondary)

The existing command remains a secondary diagnostic, not a search primitive.
It reports policy-allowed file, byte, and line observations. Its
`--max-results` bound limits files scanned because the output is itself an
aggregate; therefore bounded metrics use `files_seen`, `bytes_seen`, and
`lines_seen`, with `complete.scan: false`, and never label those values as
totals. `--full` is required for complete metrics.

### Ignore and binary behavior

Absent an explicit option, ripgrep's normal ignore files and hidden-file rules
apply (`.gitignore`, `.ignore`, global and parent ignore sources as supported by
the installed `rg`). The wrapper must not force `--no-ignore-vcs` or
`--hidden`. `--no-ignore` and `--hidden` may broaden optional discovery but
cannot admit a mandatory denied path. File encoding, binary detection, and
regex behavior remain ripgrep behavior; the result layer only normalizes
events and output text.

### Text, bytes, and positions

The result layer decodes both rg JSON variants, `{"text":"…"}` and
`{"bytes":"…"}` (base64). In both output formats, valid UTF-8 path and
content values are strings; non-UTF8 values are objects with a single `bytes`
key containing RFC 4648 standard padded base64. This applies to file paths,
diagnostic root paths, matching `text`, matched spans, and each `before`/`after`
line. No replacement characters, surrogate escapes, or empty-string fallback
may replace undecodable data. With display bounds disabled, content retains
rg's emitted bytes, including line terminators; path normalization preserves
the underlying path bytes while making paths root-relative and POSIX as
specified in the path policy below.

Line numbers are one-based. Columns are one-based byte positions within the
corresponding line, not Unicode character positions. Submatch `start`/`end`
offsets are zero-based byte offsets into the untruncated rg event's line data,
with an exclusive end; multiline boundary columns use the same byte units.
Offsets refer to the byte buffer searched by rg, including any native encoding
conversion, rather than assuming they are offsets into the original disk file.
Base64 and output escaping do not change these positions.

## Bounds and completeness

The defaults are deliberately finite for agent output: `--max-results 50`,
`--max-text-bytes 4096` per record, and `--max-bytes 65536` for the serialized
response. `--scan-max-files` and `--scan-max-bytes` are optional safety bounds
for the scan itself and default to unlimited.

`--max-results`, `--max-text-bytes`, and `--max-bytes` are display bounds for
`files`, `search`, `context`, and `count`: the backend continues scanning until
the scan completes or an explicit scan bound/error stops it. A truncated text
field remains present with `text_bytes` and `text_truncated: true`; matching
positions are calculated before display truncation. A response that omits
records due to a display bound sets `complete.display: false` and includes an
actionable `help` hint.

`--max-text-bytes` measures the decoded content bytes per record, summed over
`text`, matched spans, and all context lines that are emitted, including line
terminators and repeated content; paths and metadata are excluded.
`text_bytes` is that record's content-byte size before truncation.
Truncation retains content prefixes within the budget, at UTF-8 character
boundaries for strings and byte boundaries for `bytes` values, and sets
`complete.display: false`. Base64 expansion does not consume this text budget.
`--max-bytes` instead measures the entire serialized stdout response in UTF-8
bytes, including envelope, metadata, escaping, base64 expansion, and any final
newline, for the selected output format.

`--full` removes display and scan bounds and includes optional excluded paths,
but it never disables mandatory denied paths. It conflicts with an explicit
bound rather than silently choosing one. `--all` is removed and returns a
usage error with a migration hint: use `--full` for unbounded output and
optional excluded paths; mandatory denied paths remain denied.

Every successful response reports:

```text
complete:
  scan: whether every policy-allowed input was visited
  display: whether every result produced by that scan was returned
```

`total` is present only when it is complete for the operation. Empty results
are successful and explicit (`returned: 0`, `total: 0` when the scan is
complete); they are not errors and do not look like a missing response.

## Policy and paths

Policy is an intersection, not a replacement for safety:

1. The built-in mandatory deny set always applies: `.git` trees, `.env*`
   files, private-key and certificate extensions (`.pem`, `.key`, `.crt`,
   `.cer`, `.p12`, `.pfx`), and `id_rsa*` names.
2. Optional default exclusions are `node_modules`, `vendor`, `build`, `dist`,
   `target`, `coverage`, `.venv`, `venv`, and `__pycache__` trees. `--full` or
   an explicit policy may include these again.
3. Ripgrep ignore files and command filters (`--glob`, type flags,
   `--no-ignore`, and `--hidden`) refine the optional set only.

No search argument, including `--full`, `--no-ignore`, `--hidden`, an
unrestricted ripgrep option, or a positive glob, can weaken the mandatory deny
set. A policy test runs after every root/filter change and before any result is
returned. Policy denials are not reported as ordinary matches.

V1 loads policy only from an explicit `--policy PATH`; it does not execute or
auto-load repository-local configuration. The file is TOML data, must be a
regular readable file, and is trusted only because the caller named it; it can
set optional exclusions and bound defaults, but cannot set the root, add a
backend, disable mandatory denies, or enable symlink traversal. Malformed or
unreadable explicit policy is `invalid_policy`, not a silent fallback. There is
no environment-variable policy injection.

Precedence is: built-in mandatory denies; command-line safety and matching
flags; explicit policy values; built-in optional defaults and ordinary command
defaults. CLI values override policy defaults, while mandatory denies override
everything. The policy path is resolved relative to the invoking directory;
policy glob patterns are interpreted relative to the canonical search root.

The root is resolved to an absolute canonical directory before policy loading.
Results use root-relative POSIX paths, never `..`; the response may include the
canonical root for diagnostics. A root change re-resolves the root, policy
patterns, and all deny checks; no state is carried across invocations. A root
symlink is canonicalized to its target. Other symlinks are not followed,
matching ripgrep's default; v1 has no flag that enables traversal through
symlink directories. This is a path policy guarantee for this CLI, not an OS
sandbox or a promise about other tools.

## Output and errors

The internal result model is format-neutral. TOON is the default for agent
readability; JSON is stable for composition. Default schemas stay minimal, but
truncated large text is represented rather than silently omitted. `--full` is
the explicit escape hatch for complete display.

The executable identifies itself as `codebase-search` with a concise
description. With no arguments it succeeds with compact workspace orientation
(root, commands, and useful next steps) under finite bounds, without an
undisclosed expensive full scan. Each command provides concise `--help`.
Bare `-v`, `-V`, and `--version` print the version and exit successfully without
scanning or invoking rg.

`--fields FIELD,...` selects result-record fields in either format. Unknown
fields are usage errors; projection does not change matching, counts, or scan
completeness. Envelope completeness, truncation metadata, and encoding tags
needed to interpret selected values remain present.

All normal and error responses are structured on stdout. Stderr is reserved for
diagnostics and must not contain data needed to interpret stdout. Exit codes
are `0` for success (including an empty result), `1` for a valid request that
cannot be completed (`invalid_root`, `invalid_policy`, `invalid_pattern`,
`unsupported_feature`, `ripgrep_failed`, or `ripgrep_unavailable`), and `2`
for usage errors such as unknown commands, unknown flags, conflicting flags,
or invalid bounds. Errors include an actionable `message` and, where useful, a
`help` hint; raw ripgrep stack/diagnostic text and backend names are not leaked.
No partial success is emitted after a scan error.

## Package seams

Keep the implementation in one TypeScript/Node package with `axi-sdk-js` as
a runtime dependency and four small boundaries. No Python process is in the
shipped execution path, and there is no shell-based `rg` invocation:

- `policy`: canonicalize root and policy paths, load trusted explicit TOML,
  apply mandatory denies and optional exclusions, and return an immutable
  effective policy. It never invokes `rg`.
- `backend`: the only subprocess boundary, invoking `rg` directly through Node
  subprocess APIs. It checks capabilities, translates the approved flag model
  to native ripgrep arguments, streams
  events, and translates dependency failures. It never chooses policy or
  formats output. There is no second backend.
- `results`: normalize events into files/matches/context/count/metrics,
  enforce display and scan limits, calculate completeness, and preserve
  aggregate-vs-returned distinctions. It never reparses patterns.
- `cli`: parse and validate command flags, resolve dispatch through the SDK,
  select TOON/JSON (including the explicit `--json` interface), and map
  errors/exit codes through the SDK's structured error plumbing. It does not
  scan files or construct raw `rg` arguments directly.

## Verification and downstream mapping

The following cases are the acceptance matrix for the next tickets; each must
exercise the public CLI, not private helpers.

| Case | Contract evidence | Planned ticket |
| --- | --- | --- |
| V1 | Existing baseline suite, required `rg`, no fallback, structured errors | #3, #6 |
| V2 | Regex/literal, case modes, type/glob, multiline, optional PCRE2 match `rg` | #3 |
| V3 | Files/search/context/count schemas, ordering, byte offsets, context boundaries, and deduplicated overlapping context for adjacent records in one file; native multiline count versus per-line count | #5 |
| V4 | Normal ignore behavior versus `--no-ignore`/`--hidden`; binary behavior | #3, #5 |
| V5 | Mandatory denied paths remain denied under `--full`, globs, and ignore flags | #4 |
| V6 | Explicit policy loading, precedence, root changes, canonical paths, symlinks | #4 |
| V7 | Result/text/output/scan bounds in decoded versus serialized bytes, `--full`, `complete`, and non-total partial metrics/counts | #5 |
| V8 | Empty result, malformed pattern/policy/root, missing capability, and exit codes | #6 |
| V9 | Default TOON, stable JSON via `--format json` and the explicit `--json` interface, minimal fields, truncation metadata, actionable help | #6 |
| V10 | UTF-8 strings and lossless base64 path/text/context values agree with rg bytes; multibyte and non-UTF8 byte positions survive truncation | #3, #5, #6 |
| V11 | Content-first no-argument workspace orientation, executable identity and description, finite work without an undisclosed full scan | [#6](https://github.com/pikos-apikos/codebase-search-axi/issues/6) |
| V12 | Per-command help and bare fast `-v`/`-V`/`--version` work without rg or a scan | [#6](https://github.com/pikos-apikos/codebase-search-axi/issues/6) |
| V13 | `--fields` projects TOON/JSON results consistently, preserves required metadata, and rejects unknown fields | [#6](https://github.com/pikos-apikos/codebase-search-axi/issues/6) |
| V14 | Removed `--all` returns a usage error and `--full` migration hint without exposing mandatory denied paths | [#4](https://github.com/pikos-apikos/codebase-search-axi/issues/4), #6 |

This maps to the AXI principles of token-efficient/minimal output, explicit
truncation with a `--full` escape hatch, pre-computed aggregates, definitive
empty states, structured stdout errors, fail-loud unknown input, and no
interactive prompts. V11–V13 map the content-first orientation, executable
identity, help, version discovery, and field-selection principles to #6.
The corresponding source is the
[AXI CLI skill](https://github.com/kunchenguid/axi/blob/main/.agents/skills/axi/SKILL.md).
Ambient integrations, packaging, benchmarking, publication, and catalog
admission remain outside this contract and belong to later map tickets.
