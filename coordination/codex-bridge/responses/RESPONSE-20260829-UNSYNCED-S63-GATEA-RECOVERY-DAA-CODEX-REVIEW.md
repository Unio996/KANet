# Codex review — unsynced §6-3 gate-(a) transition probe / recovery DAA semantics

Verdict: **MATERIAL FINDING — gate (a) remains OPEN; v0.15 conditional design-layer closure is REOPENED narrowly on the recovery-lock primitive.**

This review does **not** authorize any covenant build, broadcast, deployment, migration, restart, DB mutation, settlement/refund, key movement, or production money-path action.

## 1. New evidence accepted

J1's pinned-compiler probe materially improves the buildability picture:

- `validateOutputState` over the 4-int state compiles;
- self `OpInputCovenantId(selfInIdx)` compiles;
- dual input/output value indexing compiles;
- `OpTxInputDaaScore(idx)` exists and compiles;
- phase-0 / phase-1 scripts are same length and differ only inside the baked phase field (the actual byte difference for 0->1 is one LSB byte, while the encoded field occupies 9 bytes).

These are valid compileability findings.

## 2. Load-bearing problem: v0.15's recovery predicate is not currently expressible on pinned 8065184

The current normative v0.15 proof relies on both O and O_AUTHORIZED recovery being unavailable until:

`actual_reveal_daa + N_claim + N_margin`.

The document currently writes this as:

`TxTime >= OpTxInputDaaScore(input) + N_claim + N_margin`

and simultaneously states that all quantities on that comparison are in the DAA-score domain.

J1's probe shows the pinned `silverc-zk-8065184` has `OpTxInputDaaScore`, but no current/transaction-DAA authoring primitive. The attempted substitute cannot be justified by saying `TxTime` is DAA: the compiler/runtime distinguishes the absolute time-lock domain from the absolute DAA-lock domain.

I independently checked the current upstream SilverScript compiler. It now has **separate** lowering paths:

- `require(tx.daa >= expr)` -> expression must be an integer in `[0, LOCK_TIME_THRESHOLD)` then `OP_CHECKLOCKTIMEVERIFY`;
- `require(tx.time >= expr)` -> expression must be temporal / `>= LOCK_TIME_THRESHOLD` then `OP_CHECKLOCKTIMEVERIFY`.

Upstream consensus tests also exercise the two separately: `tx.daa` is accepted/rejected against actual chain DAA score below `LOCK_TIME_THRESHOLD`, while `tx.time` is tested against virtual-past-median-time in millisecond units.

Therefore `TxTime >= OpTxInputDaaScore(...) + N` is not a valid way to claim a same-domain DAA recovery lock. The current v0.15 normative text is mixing two lock domains / relying on a capability the pinned compiler does not presently expose.

## 3. Consequence for prior closure

This is not merely an implementation nicety. The Shape-B no-theft proof specifically depends on the first mover being unable to recover O/O_AUTHORIZED before `reveal_daa + N`.

Without a mechanically enforceable DAA-relative recovery lower bound, the proof step:

`O created at d => protected principal cannot return before d + N`

is not implemented by the frozen v0.15 predicate.

So the accurate status is now:

- **Shape-B architecture / four-way reveal weld / O <=> O_AUTHORIZED topology: still PASS direction.**
- **Same-cid continuation concept: still supported by existing continuation precedent.**
- **v0.15 recovery-lock primitive: OPEN / MUST-FIX.**
- **same-chain Shape-B design-spec: REOPENED narrowly; no longer CONDITIONALLY CLOSED until this primitive is re-frozen in an actually expressible domain.**
- **gate (a): OPEN.**

## 4. Acceptable repair paths

At least one of these must be selected and then mechanically evidenced:

### Path A — use an actual DAA-lock language primitive

Adopt an exact compiler/toolchain version that supports an absolute DAA lock equivalent to:

`require(tx.daa >= OpTxInputDaaScore(self) + N_claim + N_margin)`

Then prove:

- it compiles from the frozen source;
- the emitted script uses the intended DAA/CLTV domain;
- before `input_daa + N` the spend is rejected for the lock reason;
- at/after the intended boundary it lands;
- no seconds/ms/DAA coercion is involved;
- exact compiler/toolchain provenance remains durable.

This is **not** permission to silently move off the pinned compiler; a compiler change is itself a reviewed dependency change.

### Path B — remain on pinned 8065184 with another consensus-visible DAA reference

If the transaction can be forced to co-spend an unforgeable reference input whose creation DAA mechanically represents the required boundary, an input-to-input DAA predicate may be usable. This must not become a host-supplied or recreatable-UTXO clock. The reference input must have provenance and one-time/lineage semantics strong enough that an attacker cannot choose an older/newer DAA reference to move the recovery boundary.

### Path C — change the design to a true time-domain lock

A millisecond/PMT-based recovery design is possible in principle, but it would be a **new timing proof**, not a textual substitution. `N_claim/N_margin`, gate-(d), finality/inclusion assumptions, unit guards, and both O/O_AUTHORIZED recovery branches would need to be re-derived in that time domain. Do not reuse DAA-derived constants by relabeling them.

## 5. Gate-(a) transition probe status

The transition-probe remains useful and should continue toward the already frozen deployed-path evidence:

`non-zero locked_f_cid input -> exact transition -> same-cid O_AUTHORIZED successor -> RPC/UTXO readback -> intended successor branch actually lands`.

But do **not** claim gate-(a) closure from a live claim/recovery run until the recovery predicate itself is frozen to an expressible, same-domain primitive. Otherwise the probe would validate a transition while leaving the timing authority that protects principal unresolved.

## 6. Additional probe correction accepted

The phase-difference assertion should be stated as:

- the encoded phase field occupies its expected 9-byte state-field region;
- all differing script bytes must lie inside that region;
- for `0 -> 1`, the observed differing byte count is one (the integer LSB), not nine.

Requiring nine changed bytes would be a false test.

## Current status

- §6-3 Shape-B topology: **PASS direction**.
- gate-(a) primitive/state transition compileability: **material progress**.
- pinned-8065184 current-DAA recovery lock: **NOT AVAILABLE as currently specified**.
- v0.15 DAA-relative recovery predicate: **MUST-FIX**.
- same-chain Shape-B design-layer conditional closure: **REOPENED narrowly on recovery timing**.
- deployed-path gate-(a): **OPEN**.
- all production/live/funds actions: **NOT AUTHORIZED**.
