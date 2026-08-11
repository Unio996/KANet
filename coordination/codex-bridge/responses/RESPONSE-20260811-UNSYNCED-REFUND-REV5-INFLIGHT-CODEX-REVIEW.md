# Codex review — unsynced Path-C rev-5 in-flight state machine

## Review basis

- `coord/codex-bridge` actual Git ref HEAD at review start: `84983bca99365d29ddb74d2f217bd550c4d6b7df`.
- Baseline / last Codex write handled: same SHA. Git compare is identical; canonical bridge files therefore have no content diff this run.
- Directly related active branch: `bshard-m3-deploy`, reviewed from prior point `761c7a76570cda71abbef39eec820ee811a1175f` to current `fa6e05b7ffcf458c7abf762b3cd4e0f70c2a651f`.
- Relevant new design commit: `679472bff1ec1f630b3290c2120c1da74bf8dfb0` (`docs/2026-08-11-path-c-refund-execution-plan.md`, current blob `10b2c75bb914d93958dfef724962e3eeb30298fe`).
- Relevant red-team artifact: `docs/2026-08-12-NWT-redteam-path-c-refund-rev5-item-state-machine.md`, blob `82b3fad75da4d36b2872d355cee066d8ff31759c`.
- Runtime builder independently re-read at active-branch HEAD: `kasia-console/src/lib/pool-refund-builder.mjs`, blob remains `d64eda8ef40a92dbac52a914b79ed8131902ce0e`.

## Independent ruling

### 1. Prior in-flight conceptual gap: CLOSED AT SPEC LEVEL

Rev-5 correctly rejects the old binary classification (`completed` vs `not completed`) and introduces an explicit per-item lifecycle:

`not_started -> broadcast_pending -> {chain_confirmed_completed, safely_absent}`.

That is the right abstraction. In particular, a broadcast that may still confirm after session expiry must not be silently re-authorized merely because it is not yet chain-confirmed, and it must not be silently discarded as if completion were proven. Rev-5 also correctly states that a timeout guess or a single RPC miss is insufficient evidence that an old transaction can no longer land.

So the specific defect raised in the previous Codex review — replacement authorization accidentally overlapping an unresolved old broadcast — is now addressed at the specification level.

### 2. `safely_absent` remains a runtime authority predicate, not an implementation detail

Rev-5 deliberately leaves the exact Kaspa/relay-specific `cannot still land` predicate unresolved. That is acceptable for a design draft, but it means the money-path gate is still OPEN for implementation/deployment.

The eventual transition `broadcast_pending -> safely_absent` is authority-bearing: it is what permits the same economic item to become eligible for fresh authorization. It must therefore be machine-verifiable and fail closed. A timeout, local DB flag, process restart, relay disconnect, one mempool/RPC miss, or operator assertion cannot by itself establish this transition.

### 3. NWT A/B ambiguity is real in the document, but serial continuation topology narrows its operational significance

The red-team note correctly identifies contradictory wording between (A) blocking replacement-session digest generation until every old item resolves and (B) quarantining unresolved items outside a partial replacement digest.

However, the same red-team artifact also independently identifies the more fundamental constraint: refunds consume a single continuation pool UTXO serially. If an earlier broadcast is unresolved, the next valid pool outpoint itself is unresolved. Therefore, even if bookkeeping uses a partial digest, later refund execution cannot safely advance past the unresolved continuation without first resolving that chain conflict.

The spec should still remove the A/B ambiguity, but it must not imply that choosing partial-digest bookkeeping magically permits later bettors to be paid while the predecessor pool spend is unresolved.

### 4. RED / MUST-FIX: proposed `race-to-resolve` needs its own authorization semantics

NWT suggests resolving a stuck broadcast by constructing a competing refund spend from the last confirmed continuation UTXO for another bettor, so that whichever conflict confirms makes the other structurally dead.

This can be a technically useful conflict-resolution mechanism, but it is **not automatically authorized by rev-5**.

If the original refund session has already expired, broadcasting a newly constructed competitor is a new production money-path action. It cannot borrow authority from the expired session merely because the purpose is to force the old transaction into `safely_absent`. Conversely, a replacement session cannot yet authorize the competitor if its issuance is defined to wait for the unresolved item to become safe. Without an explicit rule, the proposed recovery action creates an authority cycle.

Before adopting `race-to-resolve`, the design must specify one of the following (or an equivalent fail-closed construction):

- the recovery/competitor transaction was already within the immutable scope and validity interval of the still-active original authorization; or
- a distinct, narrowly scoped conflict-resolution authorization can be issued, binding the exact pool outpoint, exact competing ticket/item, disposition, output/value commitment, operation id, expiry and replay protection, without simultaneously authorizing the unresolved original item under a second normal refund session.

A recovery authorization must not be a generic bypass around session expiry.

### 5. Runtime enforcement is still OPEN

The actual `pool-refund-builder.mjs` remains unchanged and permissionless at the application interface. `buildRefundCommand()` still takes no authorization/session artifact and verifies no approver identity, immutable scope digest, session/item state, expiry, replay state, or `broadcast_pending/safely_absent` transition.

Therefore rev-5 is a specification improvement only. It is not evidence that the executable builder/relay/broadcast boundary is closed.

## Acceptance criteria before this blocker can close in code

At minimum:

1. Machine-defined `broadcast_pending -> chain_confirmed_completed` and `broadcast_pending -> safely_absent` predicates, with negative tests showing timeout / DB attempted flag / single RPC miss do not qualify.
2. Crash/restart persistence of unresolved item state.
3. No replacement-session authorization for any unresolved item.
4. Late confirmation of an old broadcast cannot coexist with a second normal authorization for the same item.
5. If conflict/race recovery is supported, its authorization is explicitly modeled and tested; expired ordinary session authority cannot be reused implicitly.
6. Builder/relay/broadcast path consumes and validates the authorization/session/item state before gaining broadcast capability.
7. Tests cover serial continuation UTXO behavior: unresolved predecessor blocks advancement unless a separately authorized conflict-resolution path establishes a new confirmed continuation.

## Status

- Rev-5 in-flight classification: **ACCEPTED AT SPEC LEVEL**.
- Previous binary replacement-scope defect: **CLOSED AT SPEC LEVEL**.
- Exact `safely_absent` protocol predicate: **OPEN / MUST-FIX BEFORE CODE GATE CLOSES**.
- NWT digest A/B wording: **MUST CLARIFY**, with serial continuation topology explicitly preserved.
- NWT `race-to-resolve` suggestion: **CONDITIONALLY VALID MECHANISM, BUT RED UNTIL AUTHORITY SEMANTICS ARE DEFINED**.
- Runtime refund authorization/session enforcement: **OPEN**.

No production refund, settlement, DB mutation, signing/broadcast, key movement, deploy, or other production money-path action is authorized by this review.
