# Codex review — Batch 9 9-2b merged driver / active-line delta

## Git baseline

- canonical branch checked first: `coord/codex-bridge`
- pre-write HEAD: `2de8cd6e4f2b53d29bc99d5e53128b68db39e100`
- previous processed/write-back SHA: same `2de8cd6e4f2b53d29bc99d5e53128b68db39e100`
- Git compare: identical; ahead 0 / behind 0 / 0 commits / 0 changed files.
- five canonical blobs at that HEAD:
  - `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No timestamp fields were used for incremental detection.

Because bridge was unchanged, I inspected the directly related active branch. `bshard-m3-deploy` advanced from the prior checked `ec1cdf0b051a813b480e40fab5d53366b5a8051a` to `cd0b9f8889f106343b240a841d61ca2ca7fa373c`, including the 9-2b(iii-2) ops / pointer fix and merge milestone.

## Independent code judgment

### 1. Previous prepared-resume concern is substantively closed, but by a different contract than the stale core comment

Current `proto-settlement-store.mjs::listWork()` explicitly places every `prepared` Batch-9 row into `advances` before new triggers. `advanceStep()` owns the prepared-row same-byte replay contract. Therefore a separate `work.resumes` loop is not required. The current core comment still describes `resumes:[intent]`; that comment is stale and should be removed/updated so future reviewers do not infer a second scheduler contract.

This closes my prior scheduler-gap MUST provided the existing tests continue proving: prepared row -> `advances` -> `advanceStep` -> `driveIntent` same bytes/expected txid, builder not called.

### 2. New MUST before 9-4 / production activation: same-tick fee-input reservation

Current ops `prepare()` returns `inflightOutpoints: []` unconditionally. Current `runTick({cap=5})` can process multiple `advances` in one tick. Each advance independently obtains C1 fee candidates and `build()` chooses a fee UTXO by construction. There is no tick-local reservation set carried from a successful first submission into later advances.

That means two independently ready settlement steps in one tick can select the same relay fee UTXO from the same chain snapshot. The first may submit successfully; the second then attempts a conflicting spend. This is not evidence of theft or an authorization bypass, but it violates the intended single-flight premise and can create avoidable relay/node rejection, false broadcast-failure escalation, and nondeterministic liveness exactly when several markets become ready together.

Required closure before 9-4 is treated as production-readiness evidence:

1. maintain a tick-local `reservedFeeOutpoints` set (or equivalent) populated immediately after a successful submission / prepared replay that spends a fee input;
2. exclude those outpoints from later C1 fee candidates in the same tick, fail-closed if no candidate remains;
3. regression with >=2 ready advances sharing the same first fee candidate: second step must either select a different candidate or return waiting/no-suitable-fee; it must never serialize/broadcast the already-reserved outpoint;
4. include prepared replay/submitted-in-flight fee outpoints in the exclusion model where they can overlap the current relay wallet candidate set.

An alternative is a proven `cap=1` production invariant enforced at the actual wiring boundary, but a default parameter of 5 plus an informal “single flight” statement is not that invariant.

### 3. 9-2b merge status

The pointer correction (`convert_to_claim` intent belongs to the claim subject) and the four-step ops integration are directionally sound. The offline end-to-end evidence is useful for DB/pointer/C1/builder orchestration, but its own provenance correctly says it does not prove node consensus/relay acceptance. Therefore 9-4 pinned-node/simnet exact-byte acceptance remains mandatory.

## Ruling

- 9-2b merged non-activated code: **SUPPORTED WITH FOLLOW-UP**.
- previous prepared-resume scheduler gap: **CLOSED by prepared->advances contract**; stale comment should be corrected.
- same-tick fee-input reservation: **NEW MUST before production-readiness / 9-4 closure**.
- 9-4 consensus/relay acceptance: **still required**.
- production settlement driver / mainnet signing-broadcast / funded-key movement: **HOLD**.

No production configuration, database, key, signing, broadcast, settlement, claim/refund/withdraw/reclaim, or funded path is authorized or modified by this review.
