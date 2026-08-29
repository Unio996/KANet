# Codex review — unsynced §6-3 recovery A′ builder follow-up

Verdict: **MATERIAL PROGRESS; A′ recovery design stays conditionally accepted, but builder wiring remains HOLD with two pre-wiring MUST-FIXes.**

This review is based on an actual bridge Git compare and current blobs, not file timestamps. `coord/codex-bridge` was identical to the last processed/written commit `9eab914a3b5961216f0d2cc893a3ff283ea0e70f` (ahead 0 / behind 0 / files=[]). Current canonical blobs: TO-CODEX `761460b40d37650c775b11a8b3be6d0c2c4e91c0`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

The active `bshard-m3-deploy` branch has advanced from the prior inspected checkpoint `2a368108b55d93d9c2f5d61c3ee76506169c62fc` to `a61f45a3458ef1aa415b0d1cc36060c7ea58ad18`. I filtered unrelated ZK/broker/ops work and independently inspected the load-bearing recovery artifacts:

- `kasia-relay/src/lib/cltv-locktime.mjs` blob `89e6b6d9ed85d54ecf28bd97a0bbd1df5be91354`
- `kasia-relay/src/lib/cltv-locktime.test.mjs` blob `416d68f7078f9cf9a773db677b91580e79932545`
- `kasia-relay/src/lib/recovery-lock-builder.mjs` blob `ce8f205273e6ff12f1ccdb6197bcaeae78bd6abf`
- `kasia-relay/src/lib/recovery-lock-builder.test.mjs` blob `fc80cf8512e89d99f113e8230e4d29a8f6fb0e34`
- durable v0.3 probe README blob `46fcd037d3f10ab3cc9e211f851fa729097c6e94`

## Accepted closures from the previous review

1. **Sequence u64 upper bound: CLOSED at helper/test layer.** `cltvSequence()` now enforces `0 <= s < MAX_TX_IN_SEQUENCE_NUM`; MAX, MAX+1 and huge BigInts are explicitly rejected. This closes the prior `2^64` overflow/implicit-truncation footgun.

2. **Zero-delay recovery: CLOSED at helper/config-loader layer.** Production `cltvLockTime()` rejects DAA `E==0`; the only allow-zero entry is explicitly test-only. `loadRecoveryConfig()` calls `assertPositiveDelay`, and the new private WeakSet brand prevents callers from forging a frozen `{nDelayDaa,...}` object to bypass that validation. The mutation control removing `BRAND.has` is load-bearing evidence, not a self-confirming green test.

3. **A′ byte-level compiler evidence: PASS as durable pre-runtime evidence.** The v0.3 probe independently pins `OpTxInputDaaScore + n`, `E>=0`, `E<5e11`, and CLTV in the emitted script, with two-machine byte-identical compilation. This does not close deployed runtime behavior; the README correctly keeps N6–N9 + positive landing open.

4. **Construction wording correction: ACCEPTED.** The current v0.15 text now describes A′ as the same fail-closed domain predicate / same CLTV semantics, not byte-for-byte equivalent lowering to upstream `tx.daa`.

## New MUST-FIX A — recovery ABI entry must not be raw-config authority

`loadRecoveryConfig(raw)` currently does:

`const entry = raw.entry === undefined ? RECOVERY_DAA_ENTRY : raw.entry;`

and only checks that the supplied entry is a non-negative integer.

That means the same raw configuration object that supplies the recovery delay can select a different covenant entry point. This is the wrong authority boundary. Entry-point identity is part of the compiled covenant ABI / builder wiring, not an operator-tunable recovery parameter.

A valid-but-wrong `entry` (0/1/2/...) can silently route the witness to a different branch or turn an ABI drift into an operational funds-path error. The fact that today's probe uses entry 3 does not make a runtime config override safe.

**Minimum closure:**

- remove `raw.entry` from the production config contract;
- pin the entry in code from the reviewed ABI at wiring time (or derive/verify it from a pinned ABI artifact);
- `planRecoveryDaa()` must receive only that code/ABI-bound entry;
- add a negative proving a config object containing `entry: <different valid integer>` cannot change the resulting spend branch;
- when the real covenant ABI replaces the probe ABI, re-pin the constant and acceptance evidence rather than exposing an override.

Until this is fixed, `recovery-lock-builder.mjs` remains **unwired/HOLD**, which is already the current runtime state.

## New MUST-FIX B — sane-max must not be self-overridable by the same raw config

`loadRecoveryConfig(raw)` also passes `raw.max` into `assertPositiveDelay(...)`:

`raw.max !== undefined ? { max: raw.max } : {}`

The intended `1e7 DAA` sane ceiling is a safety policy. Allowing the same raw config being validated to raise its own ceiling defeats that policy: a typo/malformed operator config can set both an excessive delay and a larger `max`, converting a fail-closed unit/availability guard into a self-authorized override.

This is not a principal-theft bypass, but it is funds-availability load-bearing: an excessive recovery delay can immobilize principal for an unintended duration.

**Minimum closure:**

- production `loadRecoveryConfig(raw)` must use a code/policy-pinned maximum, not `raw.max`;
- if tests need custom maxima, expose a clearly test-only/internal helper rather than a production raw-config field;
- add a negative showing `{n_recovery_delay_daa: 10_000_000, max: 10_000_001}` is rejected by the production loader;
- retain the separate gate-(d) production band check (`[1e3,1e7)` or its finally frozen successor) at the actual ctor/wiring boundary.

## Remaining gate-(a) closure

These builder fixes do **not** replace deployed-path acceptance. Gate (a) remains OPEN until TN12 evidence demonstrates the actual same-cid successor and intended successor spend, plus A′ lock behavior:

- exact O_AUTHORIZED successor RPC/UTXO readback with same consensus cov-id;
- intended successor `claim(0)` submit → LAND → required depth;
- recovery `lock_time=E-1` or equivalent early-boundary case rejected for lock semantics;
- DAA/time domain mismatch rejected at the lock/covenant layer;
- tip/containing-block DAA not beyond E rejected as not finalized;
- after the boundary, positive recovery/claim path lands;
- wrong cid / omitted binding / stale or wrong successor state/script remain provenance-specific rejects rather than generic pre-verifier failures.

No production wiring, deployment, signing/broadcast, DB mutation, settlement/refund or key movement is authorized by this review.
