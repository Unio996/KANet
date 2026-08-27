# Codex review — unsynced §6-3 gate (a) buildability evidence

Verdict: **MATERIAL PROGRESS, BUT GATE (a) REMAINS OPEN.**

I reviewed the new active-branch artifact `docs/2026-08-27-j1-s63-gate-a-buildability.md` (blob `f21543eb5b893d4511040127a8d4a99d8589b9af`) against the previously frozen gate-(a) acceptance scope and the live continuation precedent in `kasia-relay/src/lib/p2sh.mjs`.

## What the new probe does prove

The J1 probe is useful and correctly scoped in one important sense: it proves that the pinned `silverc-zk-8065184.exe` accepts the specific primitive shapes needed by the current v0.15 design which lacked an exact live syntax precedent:

- `OpCovOutputCount(cid) == 1`;
- `OpCovOutputCount(cid) == 0`;
- multiple input cov-id reads in one transaction;
- the lower-bound timelock form used by the construction.

The fact that the patched and legacy compilers emit byte-identical probe artifacts is also interpreted correctly: this probe does not exercise the OP_PICK-sensitive path, so it must not be used as additional OP_PICK provenance evidence.

I therefore grant a narrow closure:

**gate-(a0) primitive compileability: PASS.**

## Why this does not close gate (a)

The artifact redefines gate (a) too narrowly. The previously frozen gate-(a) requirement was not merely “do `==1` / `==0` compile?”. The load-bearing question is the exact Shape-B transition:

`LOCKED_F (cov_id = locked_f_cid) -> O_AUTHORIZED successor (same covenant identity, changed successor state/script)`

on the deployed Toccata covenant path.

The v0.15 normative topology depends on reveal consuming exact `LOCKED_F` and producing exact `O_AUTHORIZED` that continues `locked_f_cid`; later O and O_AUTHORIZED are reciprocally welded. A compiler accepting generic cov-id opcodes does not prove that this exact continuation can be constructed, accepted by consensus, and later consumed with the intended successor state.

There is strong existing precedent that narrows the remaining gap: `unlockBshardConsolidate()` reads the input PayoutShard cov_id, computes a changed continuation state/address, and creates the output with `new CovenantBinding(0, new Hash(psCovId))`, preserving the same cov_id across a state-changing continuation. That is real architecture evidence that “same cov_id + changed continuation state/address” is a supported pattern.

But it is not yet the exact `LOCKED_F -> O_AUTHORIZED` proof. The current J1 probe never creates that transition, never produces a real `CovenantBinding` for it, and never executes it through the deployed consensus/runtime path.

## Minimum remaining gate-(a) acceptance

Before gate (a) can be CLOSED, produce a durable minimal transition artifact or the eventual real covenant path that proves all of the following together:

1. genesis/locked input has a nonzero authoritative `locked_f_cid`;
2. the reveal transaction consumes that exact input;
3. the successor output is bound with the **same** `locked_f_cid` through the deployed CovenantBinding/consensus path;
4. the successor has the intended O_AUTHORIZED state/script/address, not merely a same-template no-op continuation;
5. the landed successor is read back from RPC/UTXO state with the expected cov_id and can enter the intended reactive-claim/recovery branches;
6. wrong cid, omitted binding, stale LOCKED_F, or wrong successor state/script must fail for the expected consensus/covenant reason;
7. evidence must be durable enough to independently audit: source/ctor, compiler identity, generated artifact hash, transaction/outpoint evidence, and rejection evidence.

A full funds-bearing A-covenant is not required merely to close this buildability gate; a minimal deployed-path transition probe is sufficient if it exercises the exact identity-continuation semantics above. It must remain isolated from production money paths.

## Status

- primitive compileability (`==1`, `==0`, multi-input cov-id read, lower-bound timelock): **PASS**;
- existing PayoutShard same-cov-id state-changing continuation precedent: **CONFIRMED / useful supporting evidence**;
- exact Shape-B `LOCKED_F -> O_AUTHORIZED` continuation buildability: **OPEN**;
- gate (a) overall: **OPEN**;
- same-chain Shape-B design-spec remains **CONDITIONALLY CLOSED**; this review does not reopen the design proof;
- no build/deployment/money-path authorization is granted.

No production migration, restart, signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path action is authorized by this review.