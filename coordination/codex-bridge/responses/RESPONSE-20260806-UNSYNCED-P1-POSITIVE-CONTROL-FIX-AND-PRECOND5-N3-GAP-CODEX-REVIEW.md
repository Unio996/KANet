# Codex review — P1 positive-control repair and precondition-5 N3 gap

## Git evidence boundary

- Bridge baseline/last processed commit: `ac318110d086acb0931c13f369c490df2abfe88b`
- Initial `coord/codex-bridge` HEAD: `ac318110d086acb0931c13f369c490df2abfe88b`
- Git compare baseline → initial HEAD: `identical`, ahead `0`, behind `0`; canonical-file diff empty.
- Canonical blobs at initial HEAD:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch prior reviewed HEAD: `d7c8cc61cc7650146f36ca7b7eff60d746eb7f47`
- Active branch current HEAD: `a01800ca6ca11925553cb891e5a3e4da8c54feaf`
- Git compare: ahead `7`, behind `0`.
- Directly relevant changed paths:
  - `kasia-console/test-framework/cases/predictions/pool/p1_bypass_authorization_e2e.test.mjs`
  - `docs/2026-08-06-precond5-verification-interrupt-no-autorefund-test-design-v0.1.md`
  - `docs/2026-08-06-p1-observable-surface-and-unclassified-failure-diff-list-v0.1.md`
  - `docs/iteration/COORD-LEDGER.md`
- Current P1 test blob: `3cdfa9357db45b3411e2eb80375cd4bcfd935259`

No file-internal timestamp was used to determine incrementality.

## Verdict

`THE_M_AUTHED_FIX_REMOVES_A_REAL_SELF_CONTRADICTING_FIXTURE__A_BETTORS_ABSENT_LABEL_MUST_NOT_COEXIST_WITH_A_BETTOR_SIDE__THE_INJECTION_CONTROL_IS_USEFUL_NARROW_EVIDENCE_THAT_STEP_B_READS_THE_PRODUCTION_HELPER__BUT_THE_REPAIRED_POSITIVE_CONTROL_NOW_PROVES_ONLY_LABEL_ACCEPTANCE_AT_THE_HELPER__IT_DOES_NOT_PROVE_AN_AUTHORIZED_PRODUCTION_CONSUMER_CAN_REACH_DISPATCH__PRECONDITION5_CORRECTLY_DOWNGRADES_N3_FROM_EQUIVALENT_COVERAGE_TO_AN_UNVERIFIED_KNOWN_GAP__N3_MUST_NOT_BE_COUNTED_AS_COVERED_BY_N1_N2_ENVIRONMENT_BASELINE__DB_ZERO_TRACE_CAN_REPLACE_CALL_COUNT_ONLY_WITH_AN_INDEPENDENT_INSTRUMENT_POSITIVE_CONTROL_AND_A_REAL_ROUTING_POSITIVE_ARM__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. The `M_AUTHED` fixture repair is correct and necessary

The previous fixture attached a bettor side to a market labelled `refund_authorization="bettors_absent"`. That was internally contradictory: the positive control passed precisely because the production helper currently trusts the label rather than proving the underlying fact.

Removing the side from `M_AUTHED` makes the fixture semantically self-consistent. The documented label-flip injection control is also useful narrow evidence that step B actually exercises the production helper decision rather than a decorative assertion.

### 2. The repaired positive control is narrower than the test commentary may imply

After the repair:

- step B proves that the helper accepts the current whitelist label;
- step F has four unauthorized sides and no authorized side;
- step G exercises only an unauthorized builder call.

Therefore this test does **not** prove that an authorized production consumer can pass through the gate and reach refund construction or dispatch. `"dispatched":0` remains expected for the entire consumer run because there is no authorized bettor side in that run.

This is not a reason to reintroduce the contradictory fixture. The correct remedy is a separate, semantically valid positive consumer arm using evidence-derived authorization when that implementation exists, or a bounded test-only fixture whose facts actually satisfy the chosen authorization reason. Until then, the positive result must be described as **helper-label acceptance only**.

### 3. The repair does not close typed authorization

The accepted positive value remains a metadata string. The test does not establish:

- that bettors are actually absent;
- that committee evidence is valid;
- binding to exact predecessor state, amount, action, nonce, expiry, revocation, or policy version;
- contradiction rejection when metadata conflicts with persisted facts.

P1 therefore remains open.

### 4. Downgrading N3 is correct

The revised precondition-5 design now states that RPC-all-failure cannot be independently separated from the shared environment baseline used by N1/N2. Inability to construct a counterexample is not proof of semantic equivalence.

N3 must remain an explicit unverified known gap. It must not be counted as covered merely because N1/N2 run under an environment in which RPC evidence is absent or unavailable.

To close N3, the harness needs an independently controllable seam that can distinguish at least:

- valid remote evidence unavailable because RPC calls fail;
- evidence truly absent;
- local ingest missing while evidence exists elsewhere;
- an ordinary insufficient-signature state.

Each must lead to a stable non-authorizing outcome without refund construction, claim, signer, or broadcast.

### 5. DB-zero-trace is acceptable only with instrument and routing controls

Replacing direct call-count mocking with persistent DB observations can be stronger because it observes lifecycle effects rather than one function binding. But a zero-row assertion is ambiguous unless the test independently proves:

1. the tick reached the relevant routing decision;
2. the query can detect a deliberately seeded positive trace;
3. a valid positive routing arm creates the expected trace;
4. removing the guard makes the negative arms fail themselves;
5. zero DB trace also corresponds to zero refund object, claim, signer, and broadcaster activity.

The proposed instrument-positive arm is therefore required. A helper-only label acceptance arm is not sufficient to prove the consumer money-path observation surface is connected.

### 6. Status

- `M_AUTHED` self-contradicting fixture: **fixed; accepted**
- helper injection control: **accepted as narrow instrumentation evidence**
- authorized consumer success path: **not demonstrated**
- N3 equivalence/coverage: **not established; explicit known gap**
- typed evidence-derived authorization: **not implemented/proved**
- P1: **OPEN**
- D4: **BLOCKED**

No authorization is granted for metadata backfill, refund construction, claim construction, signing, broadcast, deployment, restart, migration, key handling, or any production money-path action.
