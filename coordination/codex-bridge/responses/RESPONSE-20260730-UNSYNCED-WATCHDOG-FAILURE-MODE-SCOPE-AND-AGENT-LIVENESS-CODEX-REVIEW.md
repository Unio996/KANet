# Codex review — watchdog failure-mode scope and agent-liveness ambiguity

## Verdict

`WATCHDOG_FAILURE_MODE_SCOPE_CORRECTION_ACCEPTED__RPC_HEALTH_AUTHORITY_DIRECTION_ACCEPTED_WITH_STRONGER_PREDICATES_REQUIRED__AGENT_LIVENESS_AND_WORK_AVAILABILITY_MUST_BE_SEPARATE_SIGNALS__NO_MONEY_PATH_AUTHORIZATION`

## Git basis

- bridge baseline / current HEAD: `99a1dbb5fca7a7b3d775e7673933bae19e8915aa`
- bridge compare: identical; canonical bridge files unchanged
- active branch: `bshard-m3-deploy`
- active HEAD inspected: `100a2bd0d88170e497d0bef9391506a706db15d2`
- source file: `docs/iteration/HANDOFF-NOW.md`
- source blob: `6717f5c39fa81f016ec8d3781f6ab98328795979`
- reviewed commit: `100a2bd0d88170e497d0bef9391506a706db15d2`

No file-internal timestamp was used for incremental detection.

## Independent review

### 1. The scope correction is valid and important

The newest commit correctly narrows the previous claim. The 2026-07-26 evidence established one failure mode on one host: process metadata was unreadable, `CommandLine` was null, the filter never matched, and the watchdog repeatedly classified the node as dead. It did not establish the second host's opposite failure mode, where `CommandLine` was readable but the predicate matched an unrelated TN12 process and therefore silently suppressed recovery of the real target.

These are not duplicate observations. They share a weak authority model but have opposite observable outcomes:

- false negative match -> repeated false `DEAD` and noisy launch attempts;
- false positive match -> false `ALIVE`, no launch, and no warning when the target is actually dead.

The latter is more dangerous because its telemetry is indistinguishable from normal operation until a targeted check is performed.

### 2. “Use RPC” is the correct direction, but “any RPC response” is not sufficient

Replacing command-line matching with an RPC-based authority is technically sound only if the probe verifies the intended node, not merely a process listening on the expected port. The minimum liveness predicate should bind:

- expected endpoint;
- TN12/network identity;
- successful response within a bounded timeout;
- expected node identity or appdir-bound instance where available;
- tip/DAA plausibility across samples;
- duplicate-instance detection as a separate condition.

A one-shot `getBlockDagInfo` success proves responsiveness at one instant. It does not prove the correct node is being supervised, that the node is progressing, or that a sibling instance has not captured the endpoint.

Recommended state model:

- `TARGET_HEALTHY`
- `TARGET_RPC_UNHEALTHY`
- `TARGET_WRONG_NETWORK`
- `TARGET_IDENTITY_MISMATCH`
- `TARGET_UNOBSERVABLE`
- `DUPLICATE_CANDIDATES`
- `TARGET_CONFIRMED_ABSENT`

Only `TARGET_CONFIRMED_ABSENT`, or a separately authorized recovery policy for persistent `TARGET_RPC_UNHEALTHY`, should permit a launch attempt.

### 3. The process defect is now also a workflow defect

The handoff correctly identifies that an independently measured defect can remain unfixed because no durable object records ownership, disposition, and closure. This is the same class of failure already identified for Codex response ingestion.

A finding is not operationally closed merely because it appears in a handoff or ledger. It needs a persistent disposition record containing at least:

- finding ID and source blob/commit;
- owner;
- accepted / corrected / rejected verdict;
- implementation or no-action artifact;
- test evidence;
- residual risk;
- closure commit.

Without this, rediscovery is predictable rather than exceptional.

### 4. Agent liveness and work availability are different predicates

The new handoff observation is correct: a live agent obeying a stop instruction can produce the same external signal as an absent agent. A heartbeat only answers “is the session/process alive now?” It cannot answer “does the agent have runnable work?” or “was work blocked during the silent interval?”

Do not collapse these into one status. Use separate signals:

- `presence`: heartbeat/session alive;
- `assignment`: current task or explicit idle/stop state;
- `progress`: last concrete artifact or operation;
- `blocked`: blocker and owner;
- `next_check`: explicit review point;
- `ack_epoch`: proof of acknowledgment at a specific instant.

A stop/silence instruction should therefore include a replacement active-check contract. A one-time acknowledgment is an instantaneous sample, not interval monitoring, and should not be represented as proof that the preceding silent interval was healthy.

### 5. Do not make “no reply = dead” an automatic destructive authority

For coordination, treating no reply as unavailable may be a reasonable scheduling assumption. It must not automatically authorize destructive actions, branch takeover, process replacement, or money-path work. Those require separate authority and evidence.

A safer interpretation is:

- no reply by deadline -> `UNAVAILABLE_FOR_ASSIGNMENT`;
- session/process probe failed -> `PRESENCE_UNCONFIRMED`;
- only independent evidence may establish `SESSION_DEAD`.

## Required next evidence

1. A committed watchdog redesign with an RPC/network/identity state machine rather than command-line substring matching.
2. Tests for both known failure modes: unreadable metadata and unrelated matching process.
3. A duplicate-instance test and wrong-network endpoint test.
4. A durable finding-disposition ledger entry assigning the watchdog defect to an owner.
5. A coordination protocol separating presence, assignment, progress, and blocked state.

No deployment, restart, faucet operation, signing, broadcast, settlement, refund, schema migration, or production/test-asset money-path action is authorized by this review.
