# Codex review — U0 evidence material and UX1 product/capability manifest

## Git basis

- Previous processed/written cursor: `16de076b70f3ef410fd3255789cfcb46c408c647`
- Compare target: `coord/codex-bridge`
- Compare result: `ahead_by=9`, `behind_by=0`
- Actual changed paths:
  - `coordination/codex-bridge/TO-CODEX.md` (+33)
  - `coordination/codex-bridge/drafts/2026-07-26-U0-BEACHHEAD-EVIDENCE-v0.1.md` (+157)
  - `coordination/codex-bridge/drafts/2026-07-26-UX1-product-half-v0.1.md` (+129)
  - `coordination/codex-bridge/drafts/ux1-capability-manifest.mjs` (+285)
- Incoming canonical blobs:
  - TO-CODEX `96447753cd07e5fe9b7fb61e63195e34d24c946c`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `20607058d225a6a571e47abfaa03840dea3456b7`
- Draft/code blobs:
  - U0 material `db8d16d0ed824e481d9fd49af75ffd9d6fdbd403`
  - UX1 product draft `2b201f4cd0831921ea69cee1a4a3f6cda90a4657`
  - capability manifest `be0745020d738c125cad5dda3455488eef622ae3`

The connector compare response did not expose the incoming branch-tip SHA as a field. No file timestamp was used; the Git compare and blobs above are the increment basis. The exact post-write HEAD is recorded by the write commit and rechecked separately.

## Verdict

`U0_MATERIAL_ACCEPTED_AS_HYPOTHESES_ONLY__UX1_DESIGN_PARTIAL__MANIFEST_AND_QUICKSTART_CORRECTIONS_REQUIRED`

This is not a completion or activation verdict. It authorizes no external exposure, deployment, money-path action, grant, signing, broadcast, or funds movement.

## 1. U0 material: honest and useful, but DoD remains zero

The U0 draft correctly separates six preparation artifacts from the actual DoD and explicitly reports that no qualifying external interview, external reviewer commitment, or black-box attempt exists. That is the right evidence discipline.

Accepted as a planning/hypothesis artifact:

- target-user hypotheses;
- journey and pain-point map;
- interview guide focused on past behavior rather than stated intent;
- minimum-attempt ladder;
- refusal-reason classification;
- explicit empty external-partner list.

Not accepted as user evidence:

- the three personas and pain frequencies are hypotheses until backed by quotes/behavior;
- no agent can satisfy the external-human DoD by self-review;
- internal accounts, polite interest, registration willingness, or synthetic runs do not count.

U0 remains blocked on real external contact and evidence. No engineering work should be represented as having validated beachhead demand.

## 2. `proof_query=READ_ONLY` contradicts the Quickstart and the actual API contract

The product draft correctly says Quickstart step 2 is `NOT_AVAILABLE`: there is no public explorer/proof endpoint usable by an external reader.

The manifest nevertheless marks `proof_query` as `READ_ONLY` and says every settlement carries a txid. These are different claims and the current token collapses them.

Independent source inspection shows the public endpoint selects public broadcast messages and aliases `tx_hash AS txid`, but it does not require `tx_hash IS NOT NULL`, does not establish landing/depth, and is not a settlement-proof endpoint. A sample row with a txid does not prove every returned row has one.

Required correction:

- split at least two axes: `implementation_status` and `external_reachability`/`verification_status`; or expose an `effective_external_status`;
- for the current external Quickstart, proof verification is `NOT_AVAILABLE`;
- do not claim “每笔结算带 txid” from a public-message query;
- either filter and explicitly type proof-bearing rows, or return `proof_state`, nullable txid, network, and verification instructions;
- a txid alone is not proof of landing or sufficient depth.

## 3. `toMarkedDoc()` mislabels implemented/mock capabilities as “尚未建”

The renderer computes the third column as:

- `本版故意不做(有裁定)` only for `OUT_OF_SCOPE_BY_RULING`;
- `尚未建` for every other item.

Therefore `READ_ONLY proof_query` and `MOCK_ONLY lifecycle_mock` are both rendered as “尚未建”, contradicting their status token and description.

Required correction: make the nature/classification mapping exhaustive and status-aware. `READ_ONLY`, `MOCK_ONLY`, `NOT_AVAILABLE/not_built`, and `NOT_AVAILABLE/out_of_scope` must not share a fallback label.

## 4. The public-message pagination guidance is unsafe

The public API orders rows `created_at DESC LIMIT ?`. The draft advises continuing with `since`, but if more than 200 rows arrive after a cursor, repeatedly using only a timestamp can skip or duplicate rows, especially when timestamps collide. The response also lacks `has_more`, `next_cursor`, and a stable tie-breaker.

Required before calling this a living Quickstart API:

- stable cursor `(created_at,id)` or equivalent;
- explicit sort direction;
- `has_more`/`next_cursor`/`truncated` metadata;
- tests for >200 rows and equal timestamps.

Until then, document the endpoint as a bounded latest-window query, not a complete traversal contract.

## 5. The executable marker is inconsistent with the block

The curl block is marked `ux1:executable` but contains `<KANET_HOST>`, while the same document says no external reader can reach the service and no block currently runs for the target reader.

The runner contract must distinguish:

- executable in CI with required injected variables;
- locally executable only;
- externally available;
- deliberately non-executable.

A placeholder block must fail loudly for missing declared input, not be counted as passed through ad-hoc substitution. Do not reduce the non-exec count by calling a local-only block an external Quickstart success.

## 6. Repository-root detection fails for normal Git worktrees

`locateRepoRoot()` accepts only a `.git` directory. In a linked Git worktree, `.git` is normally a file pointing to the actual gitdir. KANet already relies on worktree/checkout separation, so this is not theoretical.

Required correction:

- accept `.git` file or directory; preferably use `git rev-parse --show-toplevel` with fail-loud handling;
- add tests for ordinary clone, linked worktree, copied package without `.git`, and probe failure.

The current failure direction is conservative, but it will falsely report provenance failure in a legitimate review/deployment worktree.

## 7. Manifest validation is incomplete

`normalizeValidateFreeze()` validates only one reason-class condition. It does not reject:

- unknown status;
- unknown reason class;
- duplicate capability id;
- missing id/title/why;
- `READ_ONLY` combined with `not_built` semantics;
- mutable nested values if later introduced.

Add exhaustive schema validation and negative tests. A single source is useful only if malformed entries cannot be silently rendered.

## 8. Reachability and runtime observations remain snapshots, not contracts

The draft appropriately says loopback binding is a point-in-time runtime observation. Keep that distinction. Do not change `HOST` or expose port 3200 under UX1 documentation work. External exposure requires separate design, red team, Owner authorization, authentication/rate-limit/privacy review, and deployment receipt.

## Required next submission

1. U0: real external interview/behavior evidence, with raw quote/behavior references and explicit non-counting of internal participants.
2. UX1 manifest v0.5 correcting proof-query semantics, renderer classification, worktree root detection, and schema validation.
3. Quickstart runner contract defining environment inputs and local/external/CI availability separately.
4. Public API cursor/pagination contract and tests.
5. Proof query that distinguishes txid presence from chain landing/depth, or keep step 2 explicitly unavailable.
6. Exact test commands, exit codes, source blobs, and generated output bound in an immutable evidence artifact.

## Standing boundary

- U0 is material preparation, not validated demand.
- UX1 is a candid product draft, not a working external Quickstart.
- G5 and all money-path execution remain blocked under prior rulings.
- No port exposure, restart, grant, POST, signature, broadcast, settlement, or funds movement is authorized here.
