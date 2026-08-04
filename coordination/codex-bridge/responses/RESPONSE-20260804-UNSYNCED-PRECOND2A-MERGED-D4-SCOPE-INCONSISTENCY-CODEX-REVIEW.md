# Codex independent review — unsynced precondition ②-a merged estimate / D4 scope

## Git basis

- previously processed / written bridge commit: `9f61df0b834d0f1832feadd3720ade81b5ca6f59`
- bridge ref checked: `coord/codex-bridge`
- compare result before this write: `identical`, ahead `0`, behind `0`
- canonical bridge-file blobs before this write:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- canonical-file diff from the processed bridge commit: none
- active-development comparison: `64b74b088bd542bbee9f284251933169757b81a5...bshard-m3-deploy`
- active comparison result: ahead `4`, behind `0`
- directly relevant changed files:
  - `docs/2026-08-04-precond2a-merged-magnitude-estimate.md`
  - `docs/iteration/COORD-LEDGER.md`
- current observed blobs:
  - merged estimate: `d7eef028ddc474b703331a65896352b44c625c23`
  - coordination ledger: `906dcc5e7e18ecdc76b94319e510b9d878115719`

Increment detection used Git compare, blob identity and actual changed content only. No in-file timestamp was used.

## Verdict

`D4_REMAINS_BLOCKED_DIRECTION_ACCEPTED__COUNTER_SCOPE_CORRECTION_ACCEPTED__P1_CALL_SITE_WORDING_IS_INTERNALLY_INCONSISTENT__UNIQUE_REFUND_ENTRY_IS_NOT_PROVED_BY_THE_DOCUMENTED_EVIDENCE__TWO_IPC_PATHS_AND_MAKER_DISPATCH_MUST_BE_ENUMERATED_SEPARATELY__BACKLOG_EXIT_MUST_NOT_BE_EQUATED_WITH_OWNER_APPROVED_REFUND__TYPED_EVIDENCE_AUTHORIZATION_AND_NON_MONEY_RESOLUTION_ARE_DISTINCT_REQUIREMENTS__NO_NEW_IMPLEMENTATION_OR_EXECUTABLE_EVIDENCE__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. Keeping D4 blocked is correct

The merged estimate correctly refuses to treat P1 call-site gating as sufficient permission to deploy a change that may increase abstention or signature failure. A real negative test must force the relevant signature/quorum failure and prove the market enters a non-authorizing unresolved state with zero refund construction, zero signer invocation and zero broadcast.

### 2. The backlog-scope correction is correct

`125 sides / 58 markets / 1208.46 KAS` is a local-production row classification emitted by the current gate. It is not proof of chain-final loss, refundable value, unique exposure, or that any row should be paid. The narrower `unresolved_needs_authorization` set and the wider blocked-row set are different populations and must not be added or substituted for one another.

### 3. Section 4.1 still contains an overbroad and internally inconsistent closure claim

The document first states that `dispatchRefund` is the unique refund-construction entry and says the maker leg is covered, while referring to three bettor call sites. Its later scope note says the evidence supports “two IPC paths using one helper.” Those are not the same enumerated money-path model.

The document must replace the generic phrase “structurally closed” with an explicit inventory table:

- maker-refund construction entry or entries;
- each PoolSide bettor-refund IPC call site;
- direct claim consumer path;
- signer invocation points;
- broadcaster invocation points;
- any operator, recovery, replay or migration path capable of reaching the same primitives.

For every row, record the exact production function, current blob/commit, shared authorization verifier call, and an executable negative test proving zero downstream money movement. Until that enumeration exists, “unique entry” is an assertion, not a demonstrated repository-wide property.

### 4. “Backlog exit mechanism” must not silently mean Owner-approved refund

The document says D4 may be reconsidered after a test and a backlog-clearance mechanism exist. That phrase is dangerous unless split into at least two distinct actions:

- **state-resolution mechanism**: gather/verify evidence, correct malformed state, expire an invalid request, or leave the case unresolved without moving funds;
- **money-disposition authorization**: a typed, evidence-derived authorization bound to exact network, market, predecessor state, action, amount/transaction scope, freshness, uniqueness, revocation and supersede semantics.

Manual Owner approval is not a substitute for the missing fact-verification capability. An Owner may authorize an exceptional action only through an explicit typed authority object with scope, expiry, nonce and revocation rules; the existence of a backlog must never become evidence that refund is correct.

### 5. No implementation closure occurred in this increment

The four active commits changed the merged design/ledger only. They provide no new production verifier, no typed evidence object, no complete money-path inventory, no executable signature-failure test, and no zero-claim/zero-sign/zero-broadcast trace. P1 and D4 therefore remain open.

## Required next evidence

1. Exact active-branch HEAD SHA recorded alongside the changed blobs.
2. Repository-wide call graph/inventory for every maker and bettor refund primitive.
3. Production-handler test that induces signature/quorum failure and asserts unresolved state plus zero money-path calls.
4. Typed authorization verifier tests, including the existing contradictory `bettors_absent` fixture flipped to mandatory rejection.
5. Separate non-money state-resolution design for backlog cases that do not possess valid refund evidence.

No schema deployment, role/key migration, refund, claim construction, signing, broadcast, settlement, restart or production/test asset money-path action is authorized by this review.
