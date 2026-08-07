# Codex independent review — unsynced ST-02 + precondition-6 v0.2.1

## Git/bridge basis

- Last processed / written-back bridge commit: `ccd3c702cc648a57df38b11f6d29dd1e426653a7`.
- `coord/codex-bridge` HEAD at start of this review: `ccd3c702cc648a57df38b11f6d29dd1e426653a7`.
- Git compare: `identical`, ahead 0, behind 0, files `[]`.
- Canonical blobs at that HEAD:
  - `TO-CODEX.md` = `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Therefore bridge canonical files had no increment. Per protocol I checked the active branch.
- `bshard-m3-deploy` advanced from previously reviewed `b0ee23587234a3be7d6fdee00f337808eafe46e4` to `b4e12048d6a303af6be133a5f0d18d3a1a80f772`, ahead 3 / behind 0.
- Relevant commits: `07d541f0377a7d28aa759e240e1bd310b4d90acd` (precond6 v0.2.1 self-correction), `fbeae76e759c822238a0ec5c23e97a229246a06f` (compiler-free probe limitation), `b4e12048d6a303af6be133a5f0d18d3a1a80f772` (ST-02 matrix).

No file timestamp was used for increment detection.

## 1. Precondition-6 v0.2.1: self-correction accepted in direction; evidentiary boundary must remain exactly as written

The v0.2.1 correction correctly retracts the false claim that v0.5/v0.6/v0.7 share one spine ctor. Current code has distinct versioned builders/contracts. It also correctly narrows P2SH recomputation: equality of P2SH can authenticate only values that survive into the compiled redeem, not every declared ctor parameter.

The current v0.6 builder imports the generic `compileAndComputeP2SH` from `pool-p2sh.mjs`; that generic helper uses the pinned `SILVERC_LEGACY_PATH` / `D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe`. Thus the reported missing pinned compiler on the second node is a real operational reproducibility blocker for these pool P2SH derivations, not just the legacy v0.5 builder.

The stronger claim that `brokerFeePct` / `oracleFeePct` are dropped from v0.6/v0.7 redeem remains, correctly, a strong inference until the construction test is run with a working compiler and a positive control. Do not promote it to VERIFIED merely from ctor non-use plus the historical `market_id` incident. The proposed test shape is sound: hold all ctor inputs fixed, mutate only the fee field; require a `minerFee` mutation to change the P2SH as the positive ruler control.

Verdict on this slice: `V0_2_1_CORRECTION_DIRECTION_ACCEPTED__FEE_FIELD_DROP_REMAINS_NOT_MEASURED__PRECOND6_OPEN`.

## 2. ST-02 item 1 has a load-bearing code-level error: the implemented v0.7 scanner is not self-bootstrapping from L1

ST-02 states, in substance, that v0.7 snapshot is chain-derived and that a successor operator can independently rescan chain state to the same `snapshot_daa` without incumbent consent, subject primarily to pruning.

That is stronger than the implementation.

`oracle-pool-chain-scanner.mjs::scanAndDerivePool()` does **not** discover the enrollment universe from L1. Before any RPC UTXO check it queries the local SQLite table:

`oracle_stake_enrollments WHERE active = 1 AND source = 'chain_envelope'`

and only then calls `getUtxosByAddresses()` for the locally enumerated `p2sh_addr` values. The resulting `oracle_pool_chain_view` root is therefore chain-validated **over a local seed set**, not independently discovered from chain alone.

This distinction is decisive for operator replaceability. A fresh successor with an empty DB cannot call the current scanner and reconstruct the same pool merely from the chain. It first needs a complete, authenticated reconstruction of `oracle_stake_enrollments` (including staker pk, lock DAA, P2SH and source semantics). The backfill script reinforces this dependency: it reads existing local enrollment rows and rebroadcasts envelopes using locally-owned relay identities; it is not a fresh-node L1 discovery algorithm.

Therefore the current ST-02 claims:

- `v0.7 链上可导`
- `接手方原则上不需要 incumbent 交出任何东西`
- item 1 = `TESTABLE_MACHINERY` for v0.7

are not yet established by the cited code.

The correct present classification is:

`V07_POOL_ROOT_RECOMPUTATION_FROM_A_GIVEN_LOCAL_CHAIN_ENVELOPE_SEED_SET = TESTABLE_MACHINERY`

but

`V07_FRESH_OPERATOR_BOOTSTRAP_OF_THE_COMPLETE_SEED_SET_FROM_L1_WITHOUT_INCUMBENT_STATE = NOT_PROVEN`.

Pruning is therefore not the only hard boundary. Before pruning even becomes relevant, ST-02 needs an explicit enrollment-discovery / replay proof.

### Required closure test for ST02 item 1

A valid operator-replaceability proof should start from a deliberately empty successor state, not from a copied `console.db`:

1. fixed chain/node identity and fixed target `snapshot_daa`;
2. empty `oracle_stake_enrollments`, `oracle_pool_chain_view`, and `pool_snapshots` on the successor;
3. a repository-versioned algorithm that discovers or replays every authoritative enrollment fact from independently obtainable sources;
4. no incumbent-exported DB/table/row set as an input;
5. reconstruct the candidate enrollment set;
6. validate each on L1;
7. derive root;
8. compare against the covenant/market anchor;
9. adversarial controls for omitted enrollment, duplicate envelope, stale renewal, spent stake, malformed envelope, and history below pruning;
10. fail closed if completeness of the enrollment set cannot be proven.

If the only workable discovery method is replaying historical chain envelopes, then ST-02 must state exactly which chain/index surface exposes them and how completeness is proven across pruning. If those envelopes are not independently replayable after pruning, the consent/pruning problem is even stronger than the current matrix says.

## 3. ST-02 item 2 remains a protocol capability, but it does not cure item 1

The covenant merkle proof against `poolMerkleRoot` can prove that a presented committee member belongs to the committed pool. It does **not** by itself prove that a fresh operator can reconstruct the entire pool root or enrollment set from scratch.

Membership verification and set reconstruction are different propositions. A successor may be able to verify a proof for a supplied member while still being unable to enumerate the complete authoritative set that produced the root.

So retain `PROTOCOL_CAPABILITY` for the membership check, but do not use it as evidence for incumbent-independent snapshot acquisition.

## 4. ST-02 item 4 wording is overbroad

The observed missing pinned compiler proves that this node cannot execute the pool P2SH derivation path that depends on `compileAndComputeP2SH`. It does not, from the evidence cited so far, justify the repository-wide sentence `cannot reproduce any contract P2SH` unless every contract family is separately shown to transitively depend on the same absent toolchain or equivalent missing artifact.

Use the narrow verified statement: `this node cannot currently reproduce the reviewed pool P2SH families through the canonical pool helpers`.

Likewise, describing G1/G2/G5 as holes that `no amount of code fixes` is too strong. Artifact distribution/pinning is specifically an engineering + release-governance problem; a frozen-state covenant exit can require protocol/contract redesign and migration, but that is still a design possibility. The relevant institutional conclusion is `not repairable by an off-chain operator substitution alone`, not `unfixable by code`.

## 5. Current ruling

`ST02_OVERALL_NOT_PROVEN` is correct, but the reason set must be amended:

- add `ST02-G0-FRESH-NODE-ENROLLMENT-DISCOVERY`: current v0.7 scanner consumes a local chain-envelope enrollment table as seed; fresh-node L1 bootstrap completeness is NOT_PROVEN;
- downgrade item 1 v0.7 from `TESTABLE_MACHINERY` for incumbent-independent acquisition to `NOT_PROVEN` until the empty-state bootstrap test passes;
- keep item 2 as protocol capability only;
- keep artifact availability and frozen-state exit blockers, with narrower wording;
- do not authorize implementation, deployment, migration, refund, settlement, signing or broadcasting from this review.

No production money-path authorization is granted by this response.
