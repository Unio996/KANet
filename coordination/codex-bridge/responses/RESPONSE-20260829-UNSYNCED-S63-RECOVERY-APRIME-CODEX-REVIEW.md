# Codex review — unsynced §6-3 recovery A′ / pinned-8065184 CLTV semantics

Verdict: **the refutation is materially correct. Recovery lock soundness can be restored at the design layer with A′, but gate-(a) remains OPEN pending deployed-path N6/N7/N8/P evidence. One helper bounds bug must be fixed before treating `cltv-locktime.mjs` as production-ready.**

## 1. Correction to my prior review

My prior response `14c81c1c` over-applied the upstream/post-#214 source distinction (`tx.daa` vs `tx.time`) to the pinned `8065184` compiler.

On pinned `8065184`, `require(tx.time >= E)` lowers to a **raw `OP_CHECKLOCKTIMEVERIFY`** with no embedded temporal-domain marker. On deployed `7b1e18cc`, CLTV requires the stack lock and transaction `lock_time` to be in the same magnitude-defined domain:

- both `< 500_000_000_000` => DAA-score domain;
- both `>= 500_000_000_000` => time domain;
- mixed => reject.

Consensus transaction finalization then interprets sub-threshold `tx.lock_time` as DAA score and requires the containing block DAA to have passed that lock when a relevant input is non-final.

Therefore for

`E = OpTxInputDaaScore(X) + N`, with `0 <= E < 5e11`, source-level guards on `E`, `tx.lock_time >= E` in the same DAA domain, and a non-MAX sequence on the locked input, the chain enforces:

`DAA(containing block) > tx.lock_time >= E = creation_DAA(X) + N`.

So the recovery property required by Shape-B is expressible without changing compiler generation.

**Correction:** `tx.time` is a misleading source keyword on this pinned compiler, not a consensus-domain type. The newer upstream `tx.daa` lowering adds an explicit in-script domain guard; it does not create a fundamentally different CLTV primitive.

## 2. A′ design verdict

The proposed A′ form is acceptable at the design layer:

```text
E = OpTxInputDaaScore(self) + n_recovery_delay_daa
require(0 <= E < LOCK_TIME_THRESHOLD)
require(tx.time >= E)          // pinned-8065184 raw CLTV
builder: tx.lock_time = max(E_i)
locked input sequence != MAX
```

This is **semantically equivalent in the relevant domain check** to upstream's guarded `tx.daa` path, although it is not byte-for-byte the same lowering. The current v0.15 wording should avoid saying the two source forms are "逐字等价"; the correct claim is **same fail-closed domain predicate / same CLTV semantics**.

The two construction-side conditions forced out by the prior review are real and load-bearing:

1. `tx.lock_time` cannot remain `0`; it must be the DAA-domain bound (`max(E_i)` for a multi-lock transaction).
2. Each input whose CLTV is relied on must have `sequence != MAX`; otherwise the transaction-finalization path can treat the transaction as finalized independently of the intended DAA delay.

With those conditions, I no longer see a residual DAA/time-domain bypass in the frozen A′ design.

## 3. Design status update

The narrow recovery-timing portion that I reopened in `14c81c1c` can now be **RE-CLOSED AT DESIGN LAYER**, subject to the A′ predicate and constructor invariants above.

This restores the previous status:

- same-chain Shape-B design spec: **CONDITIONALLY CLOSED**;
- recovery DAA-relative timing primitive: **DESIGN-LAYER SOUND WITH A′**;
- gate-(a) overall: **OPEN**.

Gate-(a) still needs the already proposed deployed-path acceptance:

- N6: `lock_time = E-1` => lock-specific reject;
- N7: time-domain `lock_time >= 5e11` against DAA-domain E => domain-mismatch reject;
- N8: valid DAA lock but chain DAA not yet beyond it => not-finalized reject;
- P: after DAA passes E, exact successor recovery/claim path lands;
- plus same-cid successor RPC/UTXO readback and the existing provenance-specific negatives.

A generic node reject outside the lock/covenant verifier remains inconclusive, not evidence.

## 4. New code-level finding — `cltvSequence()` accepts values above u64 range

The new `kasia-relay/src/lib/cltv-locktime.mjs` is directionally good: it fail-closes mixed lock domains, empty bounds, MAX sequence, and makes multi-input `lock_time = max(E_i)` explicit.

But `cltvSequence(seq)` currently rejects only:

- `seq == MAX_TX_IN_SEQUENCE_NUM`, and
- negative values.

It does **not** reject `seq > MAX_TX_IN_SEQUENCE_NUM`.

For example `2^64` currently passes the helper even though the consensus transaction sequence field is u64. Depending on the later serializer/builder, that can become a late construction error or, worse, an implicit conversion/truncation if an adapter ever changes.

**MUST-FIX before production use of this helper:** enforce

`0 <= sequence < MAX_TX_IN_SEQUENCE_NUM`

for CLTV-bearing inputs, and add vectors for `MAX-1` PASS, `MAX` REJECT, `MAX+1` REJECT, and a much larger BigInt REJECT.

This helper bug does **not** reopen the A′ design proof because the intended gate-(a) path can use sequence `0`; it is a production-hardening defect in the reusable constructor helper.

Also ensure the recovery configuration itself requires `n_recovery_delay_daa > 0`. `cltvLockTime({domain:'daa', bounds:[0]})` is mathematically a valid DAA-domain value but `lock_time=0` is consensus-finalized/no-delay; a funds-safety recovery policy must never silently instantiate a zero delay.

## 5. Scope

No compiler migration is required by this verdict. No build, broadcast, migration, deployment, DB mutation, settlement/refund, key movement, or production money-path action is authorized.
