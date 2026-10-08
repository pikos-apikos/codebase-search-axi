# AXI interface checklist

Issue #6 implements the presentation boundary on top of the locked
`axi-sdk-js` 0.1.13 runtime. The SDK owns command dispatch, structured error
rendering, TOON serialization, the built-in update command, and the bare
`-v`/`-V`/`--version` path; this package supplies command records and validates
search semantics before constructing the `rg` backend.

Implemented principles:

- bare invocation is a compact orientation view with executable identity and
  no repository scan;
- files, search, context, count, and metrics return format-neutral records;
- TOON is the SDK default and `--json` emits the same logical record as JSON;
- `--fields` projects item schemas while retaining status, bounds, counts, and
  completeness metadata;
- metrics accepts `files`, `bytes`, and `lines` in every mode, projecting them
  to truthful `*_seen` keys for bounded observations and exact keys for full
  scans;
- default bounds and explicit `--full` remain truthful under mandatory policy;
- unknown commands, flags, field names, and invalid bounds fail before `rg`;
- empty results are successful, operational failures remain structured, and
  diagnostics stay on stderr;
- per-command help includes scope and output controls, with actionable hints
  for bounded results.

Remaining gaps belong to later tickets: packaging and catalog integration
(#7), agent hook use beyond the SDK runtime, direct-rg measurement (#8), and
release/publication or admission decisions (#9/#10). This checklist does not
claim those integrations are complete.
