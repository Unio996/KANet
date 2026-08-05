# Codex independent review — unconsumed refund rejection signals

## Verification basis

- Previous processed/written bridge commit: `558c3a761893bb9b499eef49387a75a58334afcf`
- Initial `coord/codex-bridge` HEAD: `558c3a761893bb9b499eef49387a75a58334afcf`
- Git compare: identical; canonical bridge files have no content diff.
- Canonical blobs remain:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch previously reviewed through: `f7ada7db8fffe5b831d23c4157f6a0d70414f928`
- Active branch observed HEAD: `960c9bfdfc010087edff77ed7496467cf9a56f66`
- Active compare: ahead 47, behind 0.
- Directly relevant source commit: `960c9bfdfc010087edff77ed7496467cf9a56f66`; ledger blob `d0cec937aa1b3c8dceb4cb043515b33fabb1200f`.

Increment judgment used Git commit/blob/diff only, not document timestamps.

## Verdict

`UNCONSUMED_REFUND_REJECTION_SIGNAL_IS_A_REAL_CONTROL_PLANE_DEFECT__FAIL_CLOSED_MONEY_SAFETY_DOES_NOT_IMPLY_LIFECYCLE_COMPLETION__IGNORING_THE_RETURN_VALUE_PREVENTS_CALLERS_FROM_RECORDING_OR_ROUTING_THE_REJECTED_STATE__BUT_THE_CLAIM_THAT_THIS_ALONE_EXPLAINS_THE_FULL_125_SIDE_1208_46_KAS_BACKLOG_IS_NOT_YET_PROVED__EACH_BACKLOG_ROW_MUST_BE_ATTRIBUTED_TO_AN_ACTUAL_CALL_PATH_AND_REJECTION_RESULT__DO_NOT_TURN_REJECTION_HANDLING_INTO_AUTOMATIC_REFUND_AUTHORITY__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

1. The newly reported defect is structurally important. A fail-closed refund dispatcher can correctly prevent transaction construction while still leaving the market lifecycle incomplete. If callers discard the result, they cannot distinguish authorization rejection from successful dispatch, persist a non-authorizing blocked state, enqueue evidence remediation, or expose an actionable operator reason.

2. This is not merely an observability issue. It is a control-plane contract defect between the authorization gate and its callers. The dispatcher result needs a typed, exhaustive outcome such as `authorized_and_dispatched`, `rejected_missing_evidence`, `rejected_invalid_evidence`, `rejected_stale_state`, `temporarily_unavailable`, and `internal_error`; every production caller must handle every variant or deliberately propagate it to a single state-transition owner.

3. The ledger's stronger causal statement is not yet established. `12/14` callers ignoring a return value plausibly explains why rejected work can remain unresolved, but it does not by itself prove that all `125 sides / 58 markets / 1208.46 KAS` passed through those callers or that no other state-sync, relay-locality, retry, evidence, or legacy-row mechanism contributed. Closure requires a reproducible attribution table for every backlog row: market/side identity, triggering caller, attempted time or deterministic replay, dispatcher outcome, persisted state before/after, and downstream zero-call trace.

4. Fixing return handling must not weaken the money-path boundary. A rejected result must lead only to a non-authorizing state such as `unresolved_needs_evidence` or `refund_blocked`, with zero refund construction, zero claim construction, zero signing, and zero broadcast. It must not be translated into `owner_authorized`, timeout refund, generic retry-to-refund, or any other synthetic authorization.

5. The correct architectural direction is one owner for rejection disposition. Fourteen call sites should not each invent state semantics. Either all callers must propagate a typed result to one lifecycle coordinator, or the dispatcher must atomically write a narrowly defined non-authorizing rejection record in the same state boundary. The latter must remain separate from authorization generation and must be idempotent, predecessor-state-bound, and auditable.

6. Required executable evidence before accepting this gap as closed:
   - mechanical inventory of all production `dispatchRefund` callers and exact return handling;
   - mutation test proving each caller fails when rejection handling is removed;
   - forced missing/invalid/stale authorization at every caller, proving the expected blocked state is persisted;
   - repeated/replayed rejection remains idempotent and cannot escalate authority;
   - zero refund object, zero claim, zero signer, zero broadcaster traces for every rejection variant;
   - row-level reconciliation showing whether and how the 125-side backlog moves into explicit non-authorizing states without moving funds.

No production refund, claim, signing, broadcasting, settlement, deployment, restart, migration, or other money-path action is authorized by this review.