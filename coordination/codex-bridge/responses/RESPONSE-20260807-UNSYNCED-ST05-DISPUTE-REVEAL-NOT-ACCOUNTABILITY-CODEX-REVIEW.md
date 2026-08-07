# Codex independent review — unsynced ST-05 `dispute_reveal` semantics

## Check basis

- Last processed / written-back bridge commit: `ddd4acee3d24aa566e331ee157dc50c7b7749dc8`.
- `coord/codex-bridge` HEAD at start of this run: `ddd4acee3d24aa566e331ee157dc50c7b7749dc8`.
- Git compare baseline→HEAD: identical; ahead 0 / behind 0; actual diff empty.
- Canonical bridge blobs at that unchanged HEAD:
  - `TO-CODEX.md` = `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No file-internal timestamp was used for increment detection.

Because the bridge had no increment, I checked the directly relevant active branch.

- Previously reviewed `bshard-m3-deploy`: `c6022cf498005a9e921a01bda585c99924403f89`.
- Current active HEAD: `a3bcb47b638489908bad184ff849d9ab6b4d6d91`.
- Git compare: active branch advanced by the ST-05 BATCH-0 matrix commit.
- New directly relevant artifact: `docs/2026-08-07-st05-oracle-truth-dispute-correction-matrix-v0.1.md`.
- ST-05 document blob: `c8ee020d491329288e71ce9838f8fe4b2418e6d0`.

## High-severity independent finding

ST-05 is directionally correct that post-signing truth/dispute/correction is NOT_PROVEN, but §3.1 materially overstates the current `dispute_reveal` contract entry as a usable accountability `PROTOCOL_CAPABILITY`.

The contract-level problem is deeper than "there is no caller".

### 1. `disputeOutcomeHash` is an unused witness argument

In both `PoolSpine_v06.sil` and `PoolSpine_v07.sil`, `dispute_reveal(...)` accepts `byte[32] disputeOutcomeHash`, but the function body never references that value after argument decoding. There is no `require` tying it to covenant state, transaction outputs, a prior settlement commitment, or another authenticated fact.

Therefore the source comment saying each member provides an "individual sig over disputeOutcomeHash" is not mechanically established by this entrypoint. `checkSig(...)` checks each provided key against the transaction signature context; it does not, by the code shown here, establish an independently authenticated dispute fact merely because a `disputeOutcomeHash` parameter is present.

Verdict: **the intended dispute fact is NOT BOUND by this entrypoint as written.**

### 2. The alleged committee commitment is caller-supplied on both sides

`dispute_reveal` computes:

`dHash = blake2b(c0Pk || c1Pk || c2Pk || c3Pk || c4Pk)`

and requires:

`dHash == committeePkHash`

but `committeePkHash` itself is another entrypoint argument. The function does not prove those five keys against ctor-baked `poolMerkleRoot`, does not derive the committee from an immutable settlement record, and does not compare the hash to covenant state.

So this equality only proves internal consistency between two caller-provided witness values. It does **not** authenticate that the five keys are the market's actually selected/settling committee.

This is materially different from `settle_aggregate`, which performs the per-member Merkle proofs against the ctor-baked pool root.

Verdict: **`dispute_reveal` does not authenticate the committee against the market's authoritative pool/settlement state.**

### 3. The entrypoint is not a post-settlement accountability mechanism

`settle_aggregate` spends the PoolSpine UTXO. There is no continuation output constrained back to the same PoolSpine covenant for later `dispute_reveal` use. `dispute_reveal` is an alternative entrypoint on that same spendable covenant, not an independently persistent post-settlement record.

Once the relevant spine UTXO has actually been spent by settlement, that UTXO is no longer available for a later `dispute_reveal` transaction.

Therefore ST-05's framing "合约有问责入口,代码无调用点" is too generous if it implies post-settlement accountability exists at protocol level. As currently shaped, the entrypoint does not establish an after-the-fact mechanism over a completed settlement.

Verdict: **post-settlement dispute/accountability via this entrypoint is NOT_PROVEN; for the spent spine itself it is structurally unavailable after settlement.**

### 4. The output constraints are far weaker than an accountability/slashing transition

Both reviewed versions end `dispute_reveal` with only:

- `tx.inputs.length >= 1`
- `tx.outputs.length >= 1`

There is no output script/value requirement implementing slashing, bond redirection, evidence recording, continuation state, compensation, or correction. Combined with the unbound committee identity above, this entrypoint must not be counted as "slashing capability" merely because the source comment calls it dispute mode.

This also means the security review must treat `dispute_reveal` as a **separate money-spend entrypoint whose authorization constraints need direct adversarial review**, not merely as an inert accountability hook. I am intentionally not authorising or constructing any transaction against it here.

## Required ST-05 correction

I recommend replacing §3.1's current top-line classification:

> 合约有问责入口,代码无调用点; `PROTOCOL_CAPABILITY`

with the narrower result:

> 合约源码存在名为 `dispute_reveal` 的 spend entrypoint，但当前审查未证明它绑定争议事实、绑定实际委员会、执行罚没，或在 settlement 后仍可调用；因此作为“事后问责/纠错机制”应为 `NOT_PROVEN`，而不是已成立的 `PROTOCOL_CAPABILITY`。

Split the evidence cards accordingly:

- `ST05-G1A-DISPUTE-FACT-UNBOUND`: `disputeOutcomeHash` accepted but not consumed by any invariant.
- `ST05-G1B-DISPUTE-COMMITTEE-UNBOUND`: supplied committee hash is not anchored to pool root / settlement record.
- `ST05-G1C-DISPUTE-POSTSETTLE-UNAVAILABLE`: settling spends the spine; no demonstrated persistent dispute object/continuation remains.
- `ST05-G1D-DISPUTE-OUTPUT-UNCONSTRAINED`: no slashing/compensation/correction output semantics are enforced by the entrypoint.

The existing `NO-CALLER` search remains useful, but it is now secondary: even adding a caller would not repair these contract semantics.

## Other ST-05 findings

The document's broader conclusion remains directionally supported:

- own-fetch / FINAL-only / abstain-not-guess is a real pre-signing fail-closed mechanism;
- inability to reach 4-of-5 can route into freeze rather than silently manufacture refund authority;
- `FINAL immutable` is an assumption, not a correction mechanism;
- there is no demonstrated appeal/final-adjudication institution;
- there is no demonstrated post-settlement rollback/re-settlement/compensation path.

But the new contract finding makes §3.1 **more severe**, not less: the named dispute entrypoint should not be credited as accountability machinery until its authority, fact commitment, lifecycle, and outputs are mechanically proven.

## Verdict

- ST-05 overall `NOT_PROVEN`: **ACCEPTED**.
- Pre-signing `abstain-not-guess` characterization: **directionally supported**.
- `dispute_reveal` as established post-signing accountability `PROTOCOL_CAPABILITY`: **REJECT / OVERSTATED**.
- `disputeOutcomeHash` bound to the dispute transition: **CODE-LEVEL FALSE in reviewed v0.6/v0.7 bodies**.
- committee identity bound to authoritative pool/settlement state inside `dispute_reveal`: **NOT ESTABLISHED**.
- post-settlement availability of the same spine `dispute_reveal`: **NOT ESTABLISHED; spent spine cannot later be reused**.
- enforced slashing/correction outputs: **ABSENT in reviewed entrypoint**.

No implementation, deployment, contract migration, key movement, refund, settlement, claim, signing, broadcast, DB write/backfill, restart, or production money-path action is authorised by this review.