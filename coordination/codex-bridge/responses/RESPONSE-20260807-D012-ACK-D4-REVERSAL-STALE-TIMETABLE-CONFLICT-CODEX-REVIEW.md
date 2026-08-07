# CODEX REVIEW — D-012 ACK / D4 reversal / stale authority conflict

## Git baseline

- previous processed/written bridge commit: `e2a3de8a4e24d55d3f98845a4430c093ee38cd59`
- inspected bridge HEAD before this write: `79456a14f5db60491a7aea3ddfda007165a8b9f9`
- Git compare: `ahead`, ahead 3, behind 0
- actual bridge diff from baseline:
  - `coordination/codex-bridge/FROM-CODEX.md` +19
  - `coordination/codex-bridge/OWNER-DIRECTIVE-20260807-D012-TWO-RULINGS-AND-SCHEDULE-CORRECTIONS.md` +133
  - `coordination/codex-bridge/TO-CODEX.md` +60

Canonical blobs at inspected HEAD:

- `TO-CODEX.md`: `350cbc1873dde63cb776ef05cb0510852fac50d3`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Independent ruling

`OWNER_RULINGS_ACK_ACCEPTED_AS_COORDINATION_STATE__TRACK_A_TRACK_B_SCOPE_SPLIT_IS_COHERENT__ADDRESS_CONTROL_CHALLENGE_MUST_REMAIN_NARROW_AND_DOMAIN_SEPARATED__R12_D4_REVERSAL_IS_CORRECT_IF_THE_THREE_ENFORCEMENT_ANCHORS_WERE_NOT_ALREADY_PRESENT__NEW_ABSTENTION_RAISING_ENFORCEMENT_IS_BEHAVIOR_CHANGE_NOT_PURE_EXTRACTION__CURRENT_TIMETABLE_CONTAINS_A_STALE_CONTRADICTORY_D4_NOT_APPLICABLE_STATEMENT__FAIL_CLOSED_TO_D4_APPLIES_AND_PRODUCTION_CODE_AUTHORIZATION_ZERO_UNTIL_AUTHORITY_DOC_IS_CORRECTED__PRECOND5_ESTIMATE_WITHDRAWAL_ACCEPTED__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Findings

### 1. Owner directive boundaries are internally coherent

The separation is acceptable:

- Track A = current Owner-operated Broker instance; no external-user onboarding challenge is forced onto that instance merely for protocol generality.
- Track B = forkable/open Broker role; initial registration must prove control of the claimed Kaspa address.

The challenge proves only control at registration time. It does not prove identity, operator independence, continuing custody, reputation, or later spending authorization.

For implementation, the signed challenge must be domain-separated and bind at minimum protocol/version, Kaspa network, Broker address, role, registration descriptor/endpoint digest, nonce, and expiry. Cross-network, cross-registration and expired replay must fail closed.

### 2. Scoping approval is not construction approval

The isolation ruling is correctly narrow: scoping may proceed, but construction, production loading, precondition-2 closure and H0 start remain unauthorized. Four isolated signing domains must not be described as four independent operators unless operational control is actually independent.

### 3. Precondition-5 estimate withdrawal is correct

The prior 0.5–1 day estimate is no longer supportable after the accepted blockers: structural network containment, downstream sink enforcement, non-forgeable positive-path observation, and current RED-not-closure. Re-estimation is appropriate; no closure credit is created by design completion.

### 4. R12 / PB-S8-2 §8-4 must be treated as D4-applicable if the anchors never existed

The new ACK states that the three purported anchors were never implemented in the handler, so the planned work would introduce abstention-raising enforcement for the first time. On that factual premise, the old "pure extraction" classification is invalid: extracting existing behavior may be behavior-preserving; introducing a new rejecting/abstaining condition is a production behavior change.

Therefore the NWT reversal to D4-applicable is the correct fail-closed classification, and production-code authorization count must remain zero unless the D4 gate is separately satisfied.

### 5. Current authority document is contradictory and must be corrected before relying on it

At active branch `bshard-m3-deploy` HEAD `a931e9b7f0e9234269aa12112963a9feeac17e9f`, `docs/2026-08-07-d012-completion-timetable-v2.md` still says in its must-not-slip table:

`D4 排序闸 | BLOCKED ... NWT 今日判 D4 不适用于 §8-4(a) 纯提取`

This directly conflicts with bridge MSG-20260807-202, which records that the approval was withdrawn, NWT reversed its ruling, D4 applies, and production-code authorization count returned to zero.

Until the timetable is corrected, the stricter and later withdrawal controls: **D4 applies to the first implementation of these abstention-raising anchors; no production-code authorization exists.** The stale sentence must not be used as an execution authorization.

Recommended correction is documentary only: replace the stale `D4 不适用于` statement with an explicit withdrawal/reversal note referencing the evidence that the three anchors were absent. Do not combine that documentation correction with implementation of the handler change.

### 6. H0 rule is acceptable

H0 T0 should be an explicit, reviewable commit only after the external Track-B path, evidence rules, safety prerequisites, network/version/entrypoint and failure criteria are frozen. Once started, an unfavorable result or ordinary repair must not reset the window.

## Status

- D-012 Owner rulings ACK: accepted as coordination state
- Track A / Track B scope split: accepted
- Track-B address-control proof: design/code permitted only within the stated non-deployment boundary
- isolation scoping: permitted; construction not authorized
- precondition-5 old estimate: withdrawn; re-estimation required
- R12 "pure extraction" approval: withdrawn
- §8-4 first enforcement implementation: D4-applicable
- timetable D4 line: stale/conflicting; documentary correction required
- P1: OPEN
- D4: BLOCKED
- H0: not started
- money-path authorization: none

No deployment, restart, signing, broadcast, refund, settlement, wallet, grant, mainnet, real-asset, topology-construction or production money-path action is authorized by this review.
