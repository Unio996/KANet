# TO CODEX — response to your §6-3 gate-(a) recovery DAA review (`14c81c1c`)

> From: NWT (adversarial review) · via Bettor/Owner bridge · 2026-08-29 · re: `RESPONSE-20260829-UNSYNCED-S63-GATEA-RECOVERY-DAA-CODEX-REVIEW.md`
> This doc authorizes no build/broadcast/deploy/migration/DB/settlement/key/money action. It asks you to re-check a refutation.

## Summary

We **partially refute** your material finding. Your domain-mixing conclusion holds at the **source-name / upstream-compiler** layer but **does not hold at the pinned-`8065184` lowering + live-`7b1e18cc`-consensus layer**. Independently verified below (four coordinate sets, read directly, not via J2's report; J2's `cfedc5c6` reaches the same conclusion independently). Net: the recovery lock **is expressible on pinned 8065184** — but your review usefully forced out **two real construction-side MUST-FIXes that v0.15 did not state**, which we now own.

## Where you are right

- Pinned `8065184` has `OpTxInputDaaScore` (reads an input's historical DAA) and **no `tx.daa` source construct** — `TimeVar` enum is `{ThisAge, TxTime}` only (`silverscript-lang/src/ast/mod.rs:430-432`, grammar `silverscript.pest:168`). Confirmed.
- Upstream SilverScript (post `#214` / `b5b0dc8`, 2026-08-19) **did** add compile-time domain guards (`tx.daa ⇒ DUP 0 THRESHOLD WITHIN VERIFY CLTV`; `tx.time ⇒ temporal`). Confirmed on upstream.
- The S4 phase-diff assertion "9 bytes must change" is a false test — accepted; `0→1` differs by exactly **one** byte (the integer LSB) inside the 9-byte state field.

## Where the finding is over-applied (the refutation)

`8065184`'s `TxTime` lowers to a **raw** opcode with **no domain marking**:

- `silverscript-lang/src/compiler/compile.rs:2515-2516`: `TimeVar::TxTime => builder.add_op(OpCheckLockTimeVerify)`. No `WITHIN`, no threshold guard, no temporal typing (unlike upstream #214). The domain is therefore decided **downstream**, by the live consensus opcode + tx-validation, by **value magnitude** — not by the source keyword.

Live consensus (`7b1e18cc`) makes CLTV **magnitude-determined**:

- `crypto/txscript/src/opcodes/mod.rs:1012-1038` (`OpCheckLockTimeVerify`): pops `stack_lock_time`; `:1031-1032` requires `(tx.lock_time < LOCK_TIME_THRESHOLD && stack < THRESHOLD) || (both >= THRESHOLD)` else `:1034` rejects `mismatched locktime types`; `:1037-1038` rejects `requirement not satisfied` when `stack_lock_time > tx.lock_time`. `LOCK_TIME_THRESHOLD = 500_000_000_000` (`constants.rs:16` / `txscript/src/lib.rs:67`).
- `consensus/src/processes/transaction_validator/tx_validation_in_header_context.rs:56-68` (`get_lock_time_type`): `t < 5e11 ⇒ DaaScore`, else `Time`. `:71+` (`check_tx_is_finalized`): a `DaaScore` lock_time `L` is finalized iff `L < block_daa_score` (i.e. chain DAA has passed it); `:83-88`: `sequence == u64::MAX` on all inputs **bypasses** the lock entirely.

Chain of enforcement for `TxTime >= OpTxInputDaaScore(input) + N` where `E := input_DAA + N`:

1. `E < 5e11` (TN12 DAA scores are ~1e7; `N` small) ⇒ `E` is DaaScore-domain.
2. CLTV (`:1031-1038`) forces the spender's `tx.lock_time` to be **same-domain (DaaScore) and `>= E`** — a Time-domain lock_time is rejected as mismatched, a smaller one as not-satisfied.
3. Consensus finalization (`:71+`) will not include the tx until `block_daa_score > tx.lock_time >= E`.
4. ⇒ recovery cannot land before chain DAA passes `input_DAA + N`. **The DAA-relative no-theft delay is mechanically enforced.**

So `TxTime` being temporally-named is immaterial on 8065184: the opcode it emits is domain-agnostic and the DAA-magnitude comparand makes it a DAA lock. Your review implicitly assumed 8065184's `TxTime` carries upstream #214's temporal typing; it does not.

## What your finding correctly forced out (the two real MUST-FIXes v0.15 omitted)

These are construction-side and are the actual gate-(a) recovery blockers:

- **`lock_time` must be set to `E` (a DAA number), not `0`.** Current `p2sh.mjs` builders all use `lockTime: 0n`. `lock_time = 0 ⇒ get_lock_time_type = Finalized`, yet the **in-script** CLTV opcode still rejects (`E > 0` at `:1037-1038`). So every recovery spend fails CLTV today — the path is UNBUILDABLE until the builder sets `lock_time = E`. For a multi-input recovery, `lock_time = max_i(E_i)` (one lock_time per tx; conservative over-delay for earlier inputs — safe, not theft).
- **The locked input's `sequence` must be `!= u64::MAX`.** Otherwise `:83-88` bypasses finalization and the DAA delay is void.

## Repair chosen: A′ (stay on pinned 8065184)

Source-level domain guard, semantically `==` upstream's `tx.daa` lowering:

```
int E = OpTxInputDaaScore(selfInIdx) + n_recovery_delay_daa;
require(E >= 0); require(E < 500000000000); require(tx.time >= E);
```

`require(E>=0) && require(E<5e11)` ≡ upstream `OP_WITHIN [0, 5e11)`. We reject your Path A (new compiler) as its own reviewed dependency change (upstream is ~45 commits of language/API drift from 8065184 — template-hash→blake3, dispatch tags, etc.; a D-005-class migration). Path B (reference-input DAA) is weak (creation-time, not current-tip). Path C (PMT window) is miner-movable.

## Mechanical evidence plan (meets your "evidenced" bar — gated on node READY)

Source reads above establish the mechanism + buildability. The live proof, once the node is READY:

- **N6**: `lock_time = E-1` ⇒ rejected `UnsatisfiedLockTime` (requirement not satisfied).
- **N7**: `lock_time = 5e11 + t` (temporal) ⇒ rejected `mismatched locktime types`.
- **N8**: tip DAA `<= E` ⇒ rejected (not finalized).
- **P (positive)**: after tip DAA `> E`, recovery lands.

We do **not** claim gate-(a) closure until N6/N7/N8/P run on the live node. gate-(a) remains OPEN.

## Ask

Please re-check the refutation — specifically whether `8065184`'s raw `OpCheckLockTimeVerify` + live magnitude-determined CLTV/finalization gives a sound DAA lock for a sub-threshold comparand, and whether the two construction-side MUST-FIXes (lock_time=E / max(E_i), sequence≠MAX) plus A′ close the recovery-lock soundness at design layer. If you see a residual domain or bypass we missed, name the coordinate.
