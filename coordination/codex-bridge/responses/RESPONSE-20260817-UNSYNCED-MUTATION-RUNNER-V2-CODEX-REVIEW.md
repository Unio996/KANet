# Codex review — unsynced D-012 post-definition mutation-runner v2

Bridge baseline checked: `65ee6818fcc660cb55ab6e500347405273132f29` (no canonical bridge delta).
Active branch evidence reviewed: `bshard-m3-deploy` advanced beyond prior checkpoint `5ee9e9d1681aee687a2681ce867999ba10217b8a`; directly relevant implementation target `72b839f685fc9bdc54827748e98f1fa16d14097d`, later coordination promotion `afc0582c1b26b6790e28644846521bffc0476342`.

## Ruling

**Mutation-runner v2 is accepted as a substantive post-definition test-infrastructure improvement. It does not alter or reopen the immutable §6-1 definition-freeze target `154291d8d89adf8966d538e55ade78eb2ef2eec5`, and it provides no LIVE/deployment authority.**

Independent code reread confirms the important structural changes rather than relying on the four-party PASS transcription:

1. mutations run against a copied `kasia-console/src` tree under `.mut-tmp-<pid>` rather than rewriting the shared production source;
2. no junction/symlink is created into the shared `node_modules`, removing the delete-through mechanism that caused the first harness incident;
3. the copy uses the current working-tree source/test rather than silently testing HEAD;
4. the runner distinguishes DETECTED / MISSED / INERT / BROKEN and does not count static UNREACHABLE declarations as runtime discrimination;
5. the repository self-check contains both a known-positive mutation and a semantic no-op negative control. The negative arm is the load-bearing discriminator against the previously observed constant-red failure mode.

The earlier harness-v1 readings that were produced under the ESM/`NODE_PATH` constant-red device must remain retired; identical numbers from v2 are not evidence by themselves. The useful evidence is that v2's negative control survives while the positive control is detected.

## One wording boundary

The current side-effect check hashes the real source file, but for `node_modules` it checks only the **top-level directory entry count** before/after. That is enough to catch the previously observed wholesale deletion shape, and the no-link design structurally removes that particular delete-through path. It is **not a general proof that dependency contents were byte-for-byte unmodified**: an in-place content change, replacement, or delete+add preserving the entry count would evade that metric.

Therefore descriptions such as “node_modules count unchanged / previous deletion shape not reproduced” are supported. A stronger claim such as “dependency tree zero modification proven” is not supported by the present measurement unless a recursive manifest/hash or equivalent integrity check is added.

I do **not** treat that measurement-scope limitation as a blocker to using v2 for the current mutation suites, because the runner itself no longer constructs a write path into shared dependencies. It is a precision requirement on the evidence claim and a useful hardening item for future harness changes.

## Scope boundary

The later active-branch findings concerning relay outbound dedup, sendable-UTXO redundancy, change-index visibility, and mempool-reject UTXO marking are explicitly non-D-012 and parked; they are not counted as §6-1 collaboration closure evidence here and must not be used to justify a money-path change without separate Owner scope/review.

**Disposition:** mutation-runner v2 post-land harness refactor = ACCEPTED WITH EVIDENCE-WORDING BOUNDARY; §6-1 definition freeze remains PASS at `154291d8...`; §6-1 LIVE / production rollout remains NOT AUTHORIZED by this review.
