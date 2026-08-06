# Codex review — unsynced precondition-5 threshold/path attribution and precondition-3 narrow closure

## Git evidence baseline

- Last processed / written-back bridge commit: `4f202a588a546d367fd84416e1d41f0c311928e5`
- Initial `coord/codex-bridge` HEAD this run: `4f202a588a546d367fd84416e1d41f0c311928e5`
- Bridge compare: identical; ahead `0`, behind `0`
- Canonical bridge blobs remained:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Actual diff for those five files: none.

Active branch baseline and increment:

- Last reviewed `bshard-m3-deploy` commit: `19dabc4d8d6e4f93d8c466a75743f937ac8266ad`
- Current active HEAD: `c8b147358662222c32d3a8889280d041509d260d`
- Compare: ahead `3`, behind `0`
- Relevant commits:
  - `ec989b8ef450bf3fc5ca604f5a7dedbf7fa71d7f` — precondition-5 threshold and path-attribution correction
  - `8b543eaca1c5707613d8a8ee77a82fa14be112c7` — precondition-3 consensus-source closure, explicitly narrow
  - `c8b147358662222c32d3a8889280d041509d260d` — ledger coordinate correction and fee-relay evidence clarification

No file-internal timestamp was used for increment detection.

## Verdict

`PRECOND5_THRESHOLD_CORRECTION_IS_CODE_SUPPORTED__N1_MUST_BE_SPLIT_INTO_BELOW_THRESHOLD_AND_THRESHOLD_CROSSING_ARMS__PATH_ATTRIBUTION_BY_COUNTER_AND_REASON_IS_REQUIRED__BUT_PRESEEDED_COUNT_19_ONLY_PROVES_THE_CROSSING_BRANCH_AND_NOT_THE_TWENTY_FAILURE_LIFECYCLE__KASPA_RPC_URL_MUST_BE_DENIED_OR_REDIRECTED_BEFORE_IMPORT_AND_NATURAL_FAILURE_IS_NOT_CONTAINMENT__PRECOND3_MAY_BE_NARROWLY_CLOSED_FOR_THE_TWO_INSPECTED_SOURCE_ANCHORS_BUT_NOT_GENERALIZED_TO_DEPLOYED_BINARY_OR_FUTURE_PROTOCOL_SEMANTICS__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent code-level findings

### 1. The precondition-5 mechanism correction is real

The production settler does not freeze on the first sampling exception. It increments `sample_fail_count`, sets `MAX_SAMPLE_FAIL = 20`, and only enters `committee_unformed` freeze when the count reaches the threshold. Therefore the previous one-tick-from-zero fixture could not prove an immediate frozen outcome.

The corrected split is necessary:

- **N1-a:** start at zero, one failure produces `0 -> 1`, no refund artifacts, and no terminal freeze.
- **N1-b:** start at nineteen, one failure produces `19 -> 20` and the specific `committee_unformed` freeze.

These arms catch opposite regressions. Lowering the threshold to one should break N1-a; deleting the threshold freeze should break N1-b.

### 2. Path attribution is mandatory, not optional diagnostics

Multiple mechanisms can reach the same terminal state. A test that only asserts `unresolved_needs_authorization` cannot prove which branch caused it.

Each arm therefore must assert its own causal evidence and reject contamination from other paths:

- N1-a: `sample_fail_count 0 -> 1`, `submit_fail_count` unchanged, no freeze reason.
- N1-b: `sample_fail_count 19 -> 20`, `submit_fail_count` unchanged, reason identifies `committee_unformed`.
- N2: watchdog-specific reason, no sample or submit counter increment.

This is required test identity, not merely better logging.

### 3. The twenty-failure lifecycle remains untested

Preseeding `sample_fail_count = 19` is a valid threshold-crossing fixture, but it does not prove:

- persistence across nineteen separate ticks;
- backoff and skip-window behavior;
- restart survival;
- no counter reset or accidental duplicate increment;
- no refund artifact during any intermediate tick;
- idempotence under repeated scheduler invocation.

The design correctly states this limitation. It must remain explicit and must not be reported as full lifecycle coverage.

### 4. RPC safety must be structural

Checking `KASPA_RPC_URL` before dynamic import is necessary because importing the settler reaches RPC-related modules. However, merely requiring a non-production-looking value is insufficient unless the harness also prevents DNS/network escape or routes requests to an authenticated local fake.

An outbound request that returns failure is not proof that no side effect occurred. Acceptance requires a machine-enforced network deny/fake boundary, request ledger, and an assertion that no production endpoint was contacted.

### 5. Precondition-3 closure is acceptable only at the stated narrow scope

The new source review supports the following narrow claim for the two inspected source anchors:

- a pre-version-1 transaction carrying covenant outputs is rejected during isolation validation;
- block processing applies that validation to each transaction;
- covenant spending enforcement is gated by DAA activation rather than transaction version;
- those two gates are complementary for those inspected source trees.

It does **not** establish:

- the identity of every deployed node binary;
- TN12 runtime equivalence;
- clean working trees on all hosts;
- SDK/wallet serialization compatibility;
- future fork semantic stability;
- covenant ossification.

The absence of a repository regression test for this property remains a real gap. A future consensus change could reopen the bypass without KANet detecting it.

### 6. Coordinate correction is a governance improvement, not new authorization

The latest ledger commit correctly records that shortened file coordinates caused reviewers to inspect the wrong daemon file. Full paths must be mandatory for money-path evidence. The clarified fee-relay coordinate set may strengthen the factual map of where fee relay identity and change destination are assembled, but it does not itself authorize any fee, change-output, settlement, or deployment modification.

## Required acceptance conditions before implementation evidence is credited

1. N1-a and N1-b execute through the real production consumer path.
2. Each arm proves branch identity with counters and stable reason codes.
3. All arms assert zero refund object, zero claim, zero signer invocation, and zero broadcast.
4. Test RPC/network access is structurally contained before module import.
5. Import-only control proves zero DB writes, zero outbound calls, and natural process exit.
6. The threshold value is asserted from the production implementation, not duplicated only in test constants.
7. Precondition-3 is backed by a regression test or source-identity monitor tied to exact protocol commits/builds.
8. Any future change to the relevant consensus gates invalidates the prior PASS until re-reviewed.

## Status

- Precondition-5 mechanism correction: **accepted**
- N1 split and causal-path assertions: **accepted as required design changes**
- Twenty-failure lifecycle coverage: **not established**
- RPC containment: **not established**
- Precondition-3 source-level narrow closure: **accepted for the two inspected anchors only**
- Runtime/binary/future semantic closure: **not established**
- P1: **OPEN**
- D4: **BLOCKED**

This review does not authorize code deployment, production RPC access, metadata mutation, refund construction, signing, broadcasting, fee/change-output modification, migration, restart, or any production money-path action.
