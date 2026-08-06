# Codex review — unsynchronized D-012/P1 failure classification and observability drafts

- review_basis_bridge_commit: `a16758ee779afc5113ec1fddef80f4dfbb258801`
- reviewed_active_range: `36ef74793268a69a8379262e54ea072fbd459f53..d7c8cc61cc7650146f36ca7b7eff60d746eb7f47`
- active_head_reviewed: `d7c8cc61cc7650146f36ca7b7eff60d746eb7f47`
- authority: code/design review only; no implementation, deployment, refund, claim, signing or broadcast authorization

## Verdict

`OBSERVABILITY_CORRECTIONS_ARE_NEEDED_AND_SHOULD_NOT_BE_USED_AS_BEHAVIOR_EVIDENCE__UNKNOWN_FAILURE_CURRENTLY_FALLING_THROUGH_TO_SILENT_RETRY_IS_A_REAL_CONTROL_PLANE_DEFECT__BUT_TWO_INDEPENDENT_BOOLEANS_STRUCTURAL_AND_TRANSIENT_ARE_NOT_A_CLOSED_TYPED_CLASSIFICATION__UNKNOWN_OR_INTERNAL_FAILURE_SHOULD_FAIL_CLOSED_IN_A_DISTINCT_NON_AUTHORIZING_STATE__DO_NOT_LABEL_UNKNOWN_AS_STRUCTURAL_BY_DEFAULT__REQUIRE_EXHAUSTIVE_OUTCOME_HANDLING_AND_ADVERSARIAL_FIXTURES__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent assessment

### 1. D-observability corrections are justified, but remain evidence-surface changes

The enumerated stale comments/logs and the five `refund++` increments on freeze paths materially misdescribe runtime behavior. Correcting them is useful because operators otherwise read a safe freeze as an actual refund attempt. Adding a separate `frozen` count is preferable to deleting increments, provided the returned object shape is versioned or its consumers are mechanically checked.

The repository-wide negative grep is supporting evidence only. It cannot prove there is no consumer through aliasing, object spreading, serialization, positional logging, or external tooling. Before changing the return shape, generate a call-site inventory and run compatibility tests. These edits do not prove any money-path property by themselves.

### 2. The current unclassified-failure fallthrough is a real lifecycle defect

At the two described consumers, an `{ok:false}` result that is neither `unauthorized` nor `structural` receives no terminal or explicit retry classification. The market remains unchanged and is reconsidered on the next tick. That can create silent, unbounded retries with no durable reason, no escalation owner, and no bounded backoff.

Money remains fail-closed, but lifecycle handling is incomplete. This is a control-plane defect, not evidence of refund authorization.

### 3. The proposed `structural` + `transient` booleans are not a safe closed contract

Two independent booleans permit contradictory or ambiguous states:

- `structural=true, transient=true`
- `structural=false, transient=false`
- either field absent
- future callers setting only one field

The proposed consumer predicate `transient !== true` treats every malformed, unknown, programmer, data-corruption, and policy error as the same class. That is safer than automatic refund, but calling all of them "structural" overstates what is known and can hide implementation defects inside a business-state label.

Use one exhaustive discriminant instead, for example:

```text
kind = authorized_and_dispatched
     | rejected_unauthorized
     | retryable_dependency_failure
     | blocked_structural_failure
     | blocked_internal_error
     | blocked_unclassified_failure
```

Every `{ok:false}` producer must return exactly one non-success `kind`. Every consumer must switch exhaustively and fail tests when a new kind is added without handling.

### 4. Unknown must fail closed, but into a distinct non-authorizing state

An unknown/catch-all error should not continue silently and should never become refund authority. It should persist a bounded, explicit state such as:

```text
refund_blocked_internal_error
refund_blocked_unclassified_failure
```

with stable reason code, attempt count, first/last observation, source call site, and correlation ID. It should alert and stop automatic money-path progression. It must not synthesize `owner_authorized`, `bettors_absent`, timeout authority, or any other whitelist label.

### 5. Catch-all handling must preserve operational diagnostics

Freezing every thrown error without preserving stack/cause can convert a code bug into a durable unexplained backlog. The error path must separate a safe persisted public reason from restricted diagnostics, avoid secrets, and retain enough information to identify the exact producer and failure class.

Retryable errors need explicit bounded backoff and a maximum-attempt transition into a distinct blocked state. They must not retry forever and must not become authorized merely because the retry budget expires.

### 6. Required tests before implementation acceptance

At minimum, use the real producer/consumer path and prove:

1. catch-all/internal exception -> distinct blocked non-authorizing state;
2. explicit retryable dependency failure -> bounded retry, no freeze on first allowed retry;
3. retry budget exhausted -> blocked state, not refund authority;
4. structural failure -> blocked structural state;
5. unauthorized -> rejected/blocked unauthorized state;
6. contradictory or missing classification -> deterministic fail-loud test failure;
7. adding a new outcome kind without consumer handling -> compile/lint/test failure;
8. every blocked/retry scenario produces zero refund object, zero claim, zero signer invocation and zero broadcast;
9. replay is idempotent and does not increment economic disposition twice;
10. stale logs/counters are corrected and tests verify `refund` excludes freezes while `frozen` includes them.

The positive control must prove only the intended retry/blocked transition. It must not use a whitelist metadata label as a substitute for evidence-derived authorization.

## Status

- D-observability inventory: accepted as a useful draft, pending complete consumer compatibility proof.
- Unknown failure silent retry defect: confirmed.
- Proposed two-boolean classification: rejected as insufficiently typed.
- Safe direction: exhaustive discriminated outcome plus distinct non-authorizing blocked states.
- P1: OPEN.
- D4: BLOCKED.
- No production money-path authorization.