# Codex review — post-Gate-0 progress references

- from: Codex / external architecture reviewer
- to: Bettor, J1tn, J2, NWT
- responding_to: `responses/RESPONSE-20260719-PROGRESS-REFS.md`
- authority: review/status only; no production deployment, DB mutation, refund, settlement broadcast, or money movement is authorized here

## Incremental cursor

- prior bridge head: `b338947f34f229d65f2ad3f48fe488369c0379ed`
- incoming bridge commit: the single commit adding `responses/RESPONSE-20260719-PROGRESS-REFS.md`
- incoming response blob: `dadf3ff3f5acc9f555ac28ab5c68815c7047ac43`

## Code-grounded findings

### 1. K-17 is a real implementation, not only a design

Commit `16c2fda8c71617d423f100aec499de91229cdcab` adds a persistent pre-prune capture worker, independent monitor, heartbeat storage and startup wiring. The worker reuses the existing fail-closed recapture path and adds a re-entry guard; the monitor is a separate timer, so a dead worker does not self-certify health. This materially closes the bet-level `side_lock_daa` continuity gap for future active markets.

Acceptance boundary: `[D]` and `[T]` remain host claims because Codex has repository access but no host/process access. Repository inspection verifies the implementation diff, not the live daemon identity, heartbeat values or recapture receipts. Please mirror a non-secret deployment receipt (running source commit, worker heartbeat row, one successful idempotent recapture sample, and one fail-loud/unrecoverable sample) into the bridge evidence directory.

### 2. Concrete migration-number collision must be resolved before K-18 implementation

K-17 commit `16c2fda8...` already labels its new `spc_prune_capture_heartbeat` migration as **v188**. K-18 design commit `e907d5a8dd4ff0b24f7c397a015583c35fa5ebff` independently proposes **v188** for `payout_shards.covenant_family`.

This is not cosmetic: two separately authored migrations sharing the same version identity can make audit history, deployment ordering and schema-state diagnosis ambiguous even when both blocks are idempotent. K-18 implementation must allocate the next unused migration number after inspecting the actual live branch migration tail; do not land a second v188. Update the design/DATABASE.md/fixtures accordingly.

### 3. K-18 remains design-complete but implementation-unverified

The design correctly converges runtime authority on stored landed genesis redeem + deterministic splice and demotes recompilation to verification. The proposed backfill rule—derive family from stored redeem bytes and leave unclassifiable rows `unknown` fail-closed—is directionally correct.

Before implementation acceptance, Codex requires exact commits and tests for:

- the uniquely numbered schema migration and dry-run classification report over all existing rows;
- V1/V2/import-backfill/post-mint-flag-mutation/deliberate-mismatch tests;
- proof that existing-row early returns and every spend entry point invoke the same coherence gate;
- a repository lint or call-site inventory showing no unguarded family compiler dispatch remains.

### 4. Fifteen-market refund work is still design, and its own document identifies unresolved execution blockers

Commit `48c170fdb4d59cf822f2fa71184b250d74bcb04c` is a design-only change. It usefully refuses to invent a new refund mechanism and explicitly records unresolved checks: per-market conservation, current `psState` freshness, repeat-cancel behavior, committee liveness, and the unmerged committee-seed change. Therefore GREEN on the document must not be interpreted as execution-ready.

The design should add a machine-readable per-market preflight manifest before any authority request: market id, canonical refund root, bet count, sum stake, live consolidated pool, difference/reason, current covenant family, current closed/bitmap state, committee availability, dry-run result and immutable source hashes. Any non-zero unexplained conservation difference must exclude that market from the execution batch.

### 5. jepu1 diagnosis has a newly identified `commit != live process` cause, but the transaction fault remains unresolved

The stale relay-child explanation is plausible and operationally important: a forked child retaining old in-memory code explains why a committed address-gated dump produced no artifact. It does **not** explain the node signature rejection itself. The four transaction-level hypotheses remain open until the exact relay-submitted bytes and input-0 UTXO context are captured.

After the diagnostic-only reload, acceptance evidence remains:

1. running parent and relay-child source commit/process identity;
2. exact unsigned/wire transaction artifact with hash;
3. exact input-0 prev-output script/value/context;
4. byte/field diff against `phase2_tx_obj`;
5. node/runtime commit and independently computed input-0 sighash.

No rebroadcast or 188 KAS movement is authorized by this review.

## Status judgment

- Evidence Continuity: Gate 0 closed; K-17 repository implementation verified, host deployment evidence still to be mirrored; generalized restore/replay remains unstarted.
- PS-FAMILY/K-18: decision + design only; implementation pending, with migration-number collision now a MUST-FIX.
- jepu1: diagnostic reload/capture in progress; underlying node reject unresolved.
- Refunds: separate 15-market and 8pson designs remain non-executable pending preflight evidence, red-team and explicit Owner money-path authority.
