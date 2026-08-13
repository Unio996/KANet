# Codex review — unsynced canary#2 side-lock recovery state

## Git basis
- `coord/codex-bridge` checked HEAD: `aa81ec740a92491b7d8d314d8bb6ebfb9f70e6bc`.
- Previous processed/written baseline: same SHA; Git compare is identical (0 ahead / 0 behind / 0 files).
- Canonical bridge blobs re-read from Git objects: `TO-CODEX=f7d8a0e0f0f19a239b6b2244b56ffbcc2b31f70c`, `DISCUSSIONS=313bb29aabc3fe906c721beb528735400de2969c`, `STATUS=c4be60e4c4380e1401f2f718d17d94dc19ff7809`, `DECISIONS=895334928a0ff58c1b9ca795ea3a27d328005fa4`, `FROM-CODEX=0023782bbe6f0fa649100ac726f1c4fbadd3e769`; canonical diff is empty. No file self-reported timestamps were used for increment detection.

## Relevant unsynced development delta
`bshard-m3-deploy` advanced from `1100a302c1dddcbe8b09b37150c9b91b0b9a2879` to `7bf6e6a1952a0af645ce2a4b0d5563275a15577f` (21 commits ahead, aggregate code diff only `docs/iteration/COORD-LEDGER.md`). Most entries are coordination/runtime status; two items are directly relevant.

### 1. B-2 state_start evidence
Commit `fe9fb4053e95977f96a51c16efa46fa55af4e17b` records `u1-continuation-statestart.test.mjs` at 4 PASS / 0 FAIL and specifically records that default `state_start` and explicit `state_start=1` are output-identical. This is consistent with the prior Codex ruling: the drop-argument mutant on a typed PoolRoot path where the validated authoritative value is 1 is an equivalent mutant, not a meaningful missing red test. This evidence does not reopen or newly close CP4; it reinforces the earlier distinction between propagation sensitivity and provenance authority.

### 2. Canary#2 has entered an active money-path recovery gate
The ledger now records Owner GO for canary#2 settlement, but the latest state is **not settlement evidence**. The current blocker is eight `pool_bettor_sides` rows for market `j34vb` whose `side_lock_daa` is NULL. The planned recovery sequence is read-only until a txid is independently mapped to a retained `block_hash`, then to a `daaScore`; only then may `recaptureSideLockDaaForMarket` perform its guarded/CAS backfill before committee gate + settlement. Latest commit `7bf6e6a1952a0af645ce2a4b0d5563275a15577f` says the process is still waiting for the eight `side_lock_tx` txids to start the multi-machine scan.

Independent code check: `pool-market-settler-v06.mjs` explicitly states that it does not own actual transaction submission; relay-side IPC owns submission. Therefore an Owner/ledger GO, a reconstructed DB precondition, or a settler tick is not proof that funds moved. The existing requirement to withhold success until the same real `settle_txid` is independently confirmed on two nodes is appropriate and should remain the closure gate.

## Codex ruling
- **B-2 default==explicit-1 evidence:** ACCEPTED; supports equivalent-mutant classification only.
- **Canary#2 settlement:** ACTIVE / NOT CLOSED.
- **Eight side-lock DAA recovery:** OPEN GATE. Do not infer a missing DAA from timeout, absence in one local log, or DB state. A write is justified only after a concrete `side_lock_tx` is mapped through an independently observed chain/index artifact to the corresponding block/DAA, with the market/ticket identity checked before CAS.
- **Three-machine all-miss:** must remain fail-closed and return to the stated Owner decision domain; it is not evidence that an arbitrary/excluded DAA can be synthesized.
- **Success criterion:** actual settle transaction broadcast + independently confirmed same `settle_txid` on two nodes, followed by the stated S7 state checks. Until then, report preparation/recovery only.

No production refund, settlement, DB mutation, signing/broadcast, key movement, node restart, or deployment is authorized by this Codex review.