# 0.1.0 release readiness — 2026-10-09

Decision record: [Issue #9](https://github.com/pikos-apikos/codebase-search-axi/issues/9). This document prepares a candidate; it does not select a license or authorize publication.

## Candidate and scope

- Implementation baseline: [4513cf5ad994ec0a855112b95a490b5e5a9dbb62](https://github.com/pikos-apikos/codebase-search-axi/commit/4513cf5ad994ec0a855112b95a490b5e5a9dbb62), following merged PR #21.
- Candidate version: `codebase-search-axi@0.1.0`. Exact preparation PR/head, tarball SHA-256, and verification receipt are recorded on Issue #9 after the preparation commit exists.
- One Node package, official axi-sdk-js 0.1.13, direct ripgrep, compiled launcher, portable skill, notices, and documentation. No Python bridge, MCP, graph, index, or service.
- Current state: private repository, `UNLICENSED` project metadata, no tags/releases. The generated tarball is an unpublished review artifact.
- Proposed first distribution: public GitHub source plus a `v0.1.0` GitHub pre-release with a verified tarball and checksum. npm publication and AXI catalog submission are separate later decisions.

## Verification

The baseline's main CI is green at [run 37902038181](https://github.com/pikos-apikos/codebase-search-axi/actions/runs/37902038181). PR #21's exact-head CI and 69-test completion receipt are linked in the canonical map. These are baseline receipts, not checks inherited by the new preparation head.

Local preparation uses Linux, Node 24.19.0, npm, and ripgrep 15.2.0 with PCRE2:

- `npm ci --ignore-scripts`: succeeds.
- `bash tests/codebase-search.test.sh`: 69 tests attempted, 68 pass; the read-bound strace test cannot run because the execution environment denies ptrace.
- `node --test --test-skip-pattern 'scan byte bounds avoid content reads'`: all 68 executable tests pass; the one unavailable trace test is explicitly excluded, not counted as passed.
- `npm run package:check`: builds, checks skill equality, packs, installs in a fresh directory, runs the installed CLI, and checks hook status/install/uninstall in an isolated home.
- The final tarball is separately installed outside the checkout and checked against the README commands and a synthetic denied-path fixture. Exact results/checksum belong to the Issue #9 candidate receipt.
- The preparation PR's own CI must finish before any merge or release decision is executed. Recheck its actual final head.

Only Linux has release evidence. The full declared Node >=20 range and other operating systems have not received release qualification. Non-UTF8 argv recovery uses Linux /proc; other platforms preserve valid UTF-8 arguments. Hooks currently accept only explicit isolated homes and reject personal account homes/project scope.

## Source/history audit

[The audit manifest](source-audit-manifest.json) pins the checked refs and objects. It is repository-only and excluded from the npm tarball.

Coverage before this preparation: all 11 live branch tips and their returned ancestry, 79 unique commits, 79 recursive trees, 190 unique blob versions across 27 paths; no tags or releases existed. All indexed blobs were fetched successfully. Historical Python code, unmerged branch versions, initial prototype/skill, source/docs/tests, and lockfile were included.

Checks included tree/path inventory, credential-prefix/private-key/JWT patterns, credential-bearing URLs, private-network/developer-home paths, outbound URL inventory, and targeted review of matched fixtures, initial files, attribution, and commit provenance.

No recognizable live credential or unintended private corpus was found in that scope. Private-key header matches are synthetic deny-test strings containing the test marker, not actual key material. Checked URLs identify public upstream repositories/package registries; no developer-home paths or private-network addresses were found in the source blobs. Commit authorship is ordinary Git metadata and will be visible with public history.

This is a bounded audit, not a guarantee that arbitrary secrets cannot exist. It does not cover deleted/unreachable objects, GitHub comments/attachments/workflow artifacts, local Firstmate evaluation files, external corpora, or future commits. Review the final publication diff and newly introduced refs before visibility changes. No history rewrite or branch deletion was performed.

## Provenance and attribution

The root commit `29495b5bb8832ac72881b3e1fb00f6ca749a952b` introduced the prototype and agent skill under the repository owner's GitHub identity without a project license. Subsequent development is recorded in Git history. That record does not establish the source or reuse rights of the initial uploaded material.

Before licensing, the owner must confirm that the original prototype, skill, and subsequent project contributions may be released under the selected license, or identify material requiring separate attribution/replacement. No copyright ownership has been invented and no root LICENSE has been added.

Runtime dependency obligations are recorded with their exact installed license texts in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md):

| Dependency | Locked version | License |
| --- | --- | --- |
| axi-sdk-js | 0.1.13 | MIT |
| @toon-format/toon | 2.3.1 | MIT |
| smol-toml | 1.9.0 | BSD-3-Clause |

Development-only TypeScript, Node types, and undici types are recorded separately; their packages are not shipped. Node and ripgrep are external prerequisites, not redistributed binaries. AXI/gh-axi are cited as interface references; catalog inclusion is not implied.

## License recommendation

Recommended for owner-confirmed project material: [MIT](https://spdx.org/licenses/MIT.html), to permit reuse of this small wrapper with a short retained copyright/license notice.

Concrete alternative: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0), if the owner prefers its explicit patent grant and associated redistribution obligations. Deferring publication and retaining UNLICENSED is also a valid disposition.

After selection and provenance confirmation, add the selected LICENSE with owner-approved copyright attribution, update package/lock metadata, rebuild/repack, and record the resulting exact commit and checksum. The current tarball is not the final licensed public release artifact.

## Evaluation and claims

Issue #8's latest receipts record synthetic correctness and limited agent-session usage evidence. Timing is explicitly deferred and does not block preparation. Parent-scope/mandatory-exclusion fairness corrections and small comparison samples limit generalization.

Raw reports, usage summaries, and charts remain on Firstmate's machine and were not available for independent inspection here. No quantitative token, speed, or general agent-efficiency improvement is asserted in this release candidate. No new paid runs or private-corpus access occurred during preparation.

## Human decision and execution boundary

Before external publication, record all of the following on Issue #9:

1. Provenance confirmation (or required attribution/replacement).
2. Project license and copyright attribution.
3. Exact reviewed candidate/revision after the license change.
4. Whether to make this existing repository public, exposing retained history/branches.
5. Whether to publish the proposed GitHub v0.1.0 pre-release and attach its rebuilt tarball/checksum.
6. Explicit disposition for npm publication and upstream AXI submission; proposed first release defers both.

Do not change visibility, create a tag/release, publish to a registry, rewrite history, or submit upstream before that concrete authorization is recorded. Keep #9 open until the human disposition is recorded; #10 remains blocked until an actual public source revision exists. If publication is deferred, record that disposition and retain the downstream block.
