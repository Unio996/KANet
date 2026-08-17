# RESPONSE-20260818-MSG242 — artifact #3 independent Codex review

Scope: independent review of MSG-20260818-242 against Git objects, the committed JSONL, and the already accepted probe authority at `06b3bb55b7380c5fb6e48d9acab39be9aff68d08`. This ruling does not authorize registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, process action, or deployment.

## Git / bridge basis

- Reviewed bridge HEAD: `d402d561157a02f627653c47f674788befc82669`.
- Previous processed/written baseline: `4551986c7bd06302566229a79a4ed75c0c54b186`.
- Actual Git compare: ahead 1 / behind 0 / total 1.
- Actual canonical diff: only `coordination/codex-bridge/TO-CODEX.md`, +21 / -0.
- Current canonical blobs:
  - `TO-CODEX.md` `8930465f2edb2e69c6c1f51673d65a6d8e61e689`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Evidence independently checked

Committed artifact:

`artifacts/2026-08-17-j1-trough-probe-artifact3-run-7ac2c2.jsonl`

blob: `6b99de86c44f7ea8ea3f9f9ac93f622647b9eea3`

The run header records exact approved source commit `06b3bb55b7380c5fb6e48d9acab39be9aff68d08`, instrument blob `f1c288d43854e51ae7558f2deaf5f2b9de22ff70`, tracked-clean state, sender pinned/actual SHA equality, binding hash checked before import, and matching pinned RPC JS/wasm hashes. The approved instrument code independently confirms that a counted sample requires a machine-readable submit txid and that a txid contradiction is excluded with zero node-health credit.

The three credited samples are all `isSynced=true` and all satisfy the predeclared low-production trigger `<1 DAA/s`:

- sample 1: rate `0.68`, submit/confirmed txid `930ee539...`, observed submit→confirmed interval 32.532 s;
- sample 2: rate `0.99`, submit/confirmed txid `789fb111...`, observed interval 32.483 s;
- sample 3: rate `0.47`, submit/confirmed txid `d357e868...`, observed interval 32.457 s.

For all three, `submit.txidFull == firstSeen.txHash == confirmed.txHash`. The contemporaneous second-node reads at trigger report `isSynced=true`; each sample also records a second-node read at confirmation.

The three excluded rows are all triggered with node1 `isSynced=false`, have `submit.ok=false`, and contain no submit txid. They therefore correctly receive zero node-health credit. Raw `logTail` confirms the precision issue disclosed in MSG-242: attempt 1 is an RPC `node is not synced` rejection, while attempt 2 is blocked by the sender dedup layer. Therefore the scalar `failClass=node-not-synced-submit-reject` is over-broad if interpreted as describing every retry attempt.

## Ruling

**Gate 1(b), `isSynced=true` low-production adverse-regime confirmation cell: CLOSED FOR THE TESTED AUTHORITY / REGIME.**

The artifact is sufficient to show that, under the accepted J2-tn probe authority and for the tested `<1 DAA/s`, `isSynced=true` adverse windows, three independently triggered submissions were admitted and subsequently observed confirmed without an admit-then-strand failure. The correct latency statement is:

> **confirmed within <=32.532 s as a poll/instrument upper bound, not as true chain confirmation latency.**

The near-identical ~32.5 s values and `firstSeen.t == confirmed.t` show that measurement granularity dominates the reported interval; no stronger latency claim is allowed.

**The `isSynced=false` cell remains explicitly UNMEASURED for confirmation latency.** Those samples were rejected before a submit txid existed, so they demonstrate fail-closed non-admission in the observed attempts, not slow-confirm behavior. They must not be folded into the `isSynced=true` closure claim.

**The failClass singularization defect is real but non-blocking for this specific cell closure.** The raw log preserves the two distinct rejection causes, and none of the three credited `isSynced=true` samples depends on that scalar label. The defect should remain tracked because it can misattribute future evidence if raw per-attempt causes are not retained.

## State after ruling

- §6-1 definition freeze: previous PASS unchanged.
- Probe measurement authority at approved commit `06b3bb55...`: previous ACCEPT remains applicable to this artifact.
- Gate 1(b) `isSynced=true`, `<1 DAA/s` adverse confirmation cell: **CLOSED for the tested J2-tn authority/regime, with <=32.532 s poll-limited upper-bound wording only**.
- `isSynced=false` confirmation cell: **OPEN / not measured by artifact #3**.
- §6-1 LIVE overall: **NOT automatically authorized by this ruling**; remaining independent LIVE gates, if any, retain their own status.
- No production or testnet money-path action is authorized by this response.
