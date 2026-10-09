# 0.1.0 release readiness — 2026-10-09

Decision record: [Issue #9](https://github.com/pikos-apikos/codebase-search-axi/issues/9). The owner approved MIT, initial-material distribution rights, and the first GitHub publication route on 2026-10-09; [decision receipt](https://github.com/pikos-apikos/codebase-search-axi/issues/9#issuecomment-6080016390). This document records the historical preparation evidence and the verified publication receipt.

## Candidate and scope

- Implementation baseline: [4513cf5ad994ec0a855112b95a490b5e5a9dbb62](https://github.com/pikos-apikos/codebase-search-axi/commit/4513cf5ad994ec0a855112b95a490b5e5a9dbb62), following merged PR #21.
- Released version: `codebase-search-axi@0.1.0`, GitHub pre-release from `3dc5b60ff3adf58086ecdb6f1fd45d1c919fe102`. Tarball SHA-256 and verification receipt are recorded below and on Issue #9.
- One Node package, official axi-sdk-js 0.1.13, direct ripgrep, compiled launcher, portable skill, notices, and documentation. No Python bridge, MCP, graph, index, or service.
- Historical preparation state: the repository was private with no tag/release before publication. The final rebuilt tarball is the published pre-release asset.
- Approved first distribution: public existing GitHub repository with retained history/branches plus a `v0.1.0` GitHub pre-release with verified tarball/checksum, after the original evaluation materials are incorporated and final checks pass. npm publication and AXI catalog submission remain deferred.

## Verification

The baseline's main CI is green at [run 37902038181](https://github.com/pikos-apikos/codebase-search-axi/actions/runs/37902038181). PR #21's exact-head CI and 69-test completion receipt are linked in the canonical map. These are baseline receipts, not checks inherited by the new preparation head.

Local preparation uses Linux, Node 24.19.0, npm, and ripgrep 15.2.0 with PCRE2:

- `npm ci --ignore-scripts`: succeeds.
- `bash tests/codebase-search.test.sh`: 69 tests attempted, 68 pass; the read-bound strace test cannot run because the execution environment denies ptrace.
- `node --test --test-skip-pattern 'scan byte bounds avoid content reads'`: all 68 executable tests pass; the one unavailable trace test is explicitly excluded, not counted as passed.
- `npm run package:check`: builds, checks skill equality, packs, installs in a fresh directory, runs the installed CLI, and checks hook status/install/uninstall in an isolated home.
- The final tarball was separately installed outside the checkout and checked against the README commands and a synthetic denied-path fixture. Its SHA-256 is `9b149f5ac67d79fd7bd98c5539ac6f175803d7421bcdfd2ecf9fd1af05b06d38`.
- Merged-main CI passed at [run 37928439182](https://github.com/pikos-apikos/codebase-search-axi/actions/runs/37928439182) for `3dc5b60ff3adf58086ecdb6f1fd45d1c919fe102`.

Only Linux has release evidence. The full declared Node >=20 range and other operating systems have not received release qualification. Non-UTF8 argv recovery uses Linux /proc; other platforms preserve valid UTF-8 arguments. Hooks currently accept only explicit isolated homes and reject personal account homes/project scope.

## Source/history audit

[The audit manifest](source-audit-manifest.json) pins the checked refs and objects. It is repository-only and excluded from the npm tarball.

Coverage before this preparation: all 11 live branch tips and their returned ancestry, 79 unique commits, 79 recursive trees, 190 unique blob versions across 27 paths; no tags or releases existed. All indexed blobs were fetched successfully. Historical Python code, unmerged branch versions, initial prototype/skill, source/docs/tests, and lockfile were included.

Checks included tree/path inventory, credential-prefix/private-key/JWT patterns, credential-bearing URLs, private-network/developer-home paths, outbound URL inventory, and targeted review of matched fixtures, initial files, attribution, and commit provenance.

No recognizable live credential or unintended private corpus was found in that scope. Private-key header matches are synthetic deny-test strings containing the test marker, not actual key material. Checked URLs identify public upstream repositories/package registries; no developer-home paths or private-network addresses were found in the source blobs. Commit authorship is ordinary Git metadata and will be visible with public history.

This is a bounded audit, not a guarantee that arbitrary secrets cannot exist. It does not cover deleted/unreachable objects, GitHub comments/attachments/workflow artifacts, local Firstmate evaluation files, external corpora, or future commits. Review the final publication diff and newly introduced refs before visibility changes. No history rewrite or branch deletion was performed.

## Provenance and attribution

The root commit `29495b5bb8832ac72881b3e1fb00f6ca749a952b` introduced the prototype and agent skill under the repository owner's GitHub identity without a project license. Subsequent development is recorded in Git history. That record does not establish the source or reuse rights of the initial uploaded material.

The owner confirmed that the initial prototype/skill may be distributed under MIT in the 2026-10-09 conversation. The decision is recorded on Issue #9. A root MIT LICENSE attributes project material to Yiannis Miliaresis and contributors; package and lock metadata now declare MIT. Existing third-party attribution remains separate.

Runtime dependency obligations are recorded with their exact installed license texts in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md):

| Dependency | Locked version | License |
| --- | --- | --- |
| axi-sdk-js | 0.1.13 | MIT |
| @toon-format/toon | 2.3.1 | MIT |
| smol-toml | 1.9.0 | BSD-3-Clause |

Development-only TypeScript, Node types, and undici types are recorded separately; their packages are not shipped. Node and ripgrep are external prerequisites, not redistributed binaries. AXI/gh-axi are cited as interface references; catalog inclusion is not implied.

## Selected license

[MIT](https://spdx.org/licenses/MIT.html) is selected. LICENSE and package/lock metadata implement the owner's decision. Rebuild/repack after the final evaluation transfer and record the actual final commit/checksum; do not reuse the earlier UNLICENSED tarball as a release asset.

## Evaluation and claims

Issue #8's latest receipts record synthetic correctness and limited agent-session usage evidence. Timing is explicitly deferred and does not block preparation. Parent-scope/mandatory-exclusion fairness corrections and small comparison samples limit generalization.

The curated report, usage summary, and chart are incorporated under [docs/evaluation/2026-10-09](evaluation/2026-10-09); raw reports, transcripts, prompts, and private corpus data remain excluded. No quantitative token, speed, or general agent-efficiency improvement is asserted in this release. No new paid runs or private-corpus access occurred during preparation.

## Recorded decision and remaining execution boundary

The explicit owner disposition on Issue #9 is complete: MIT and initial-material distribution rights confirmed; existing repository made public with retained history/branches, followed by GitHub v0.1.0 pre-release with rebuilt tarball/checksum. npm and upstream AXI submission remain deferred. No repeat license/provenance selection is needed.

Historical preparation gates and their verified outcomes:

1. The incorporated chart, report tables/limitations, and source-hash manifest are recorded in [docs/evaluation.md](evaluation.md).
2. Inspect the publishable evidence and any new refs/diff within the history-audit boundary.
3. Verify the actual final head, package installation and CI, and record the licensed tarball checksum.
4. The approved visibility/release actions were executed through the authorized GitHub capability.
5. Actual public URLs, released revision, and asset digest are recorded in the [Issue #9 publication receipt](https://github.com/pikos-apikos/codebase-search-axi/issues/9#issuecomment-6080659991).

Issue #9 is closed after its execution/completion record was satisfied. #10 remains blocked pending its separate upstream authorization and admission review. No history rewrite, npm publication, or upstream submission was performed.
