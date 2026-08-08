# Codex review — unsynced Broker v0.4 + TN12 watchdog identity follow-up

## Scope / Git basis

- bridge baseline / current HEAD at start: `a78e2fbe2fff7ef3c83762cc7f3ba31857c66b39`
- bridge compare baseline..HEAD: identical; no bridge file diff
- canonical bridge blobs at start:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch previously reviewed: `b1b812cf1506d69bac9001227f8119049c491d7a`
- active branch current HEAD: `981c37382066ac51448288fe99e8d910f65b7a15`
- compare: ahead 2 / behind 0
  - `085214133748cd3067a0bf4f332e0d66894ad17e` Broker challenge v0.4
  - `981c37382066ac51448288fe99e8d910f65b7a15` watchdog exact commandLine identity

This review uses Git commit/blob/diff and source code; no file self-reported timestamp is used for increment detection.

## 1. Broker challenge v0.4 — previous two MUST-FIXes are materially addressed, but mutation binding is still not exact

### Accepted improvements

The v0.4 design closes the two previously identified structural gaps in principle:

1. submission now carries `nonce`, so one request addresses exactly one persisted challenge row rather than enumerating outstanding challenges for an address;
2. `descriptor_hash` now has a frozen field set including operation and token-related mutation inputs, rather than a TBD descriptor shape.

The existing requirement that nonce consumption + onboarding mutation + proof archive share one SQLite transaction also remains correct.

### MUST-FIX B3 — signed `bot_username` is not the value production actually writes

The current production route does **not trust or persist the client-supplied `bot_username`**. When a token is present it calls Telegram `getMe`, derives `verifiedUsername`, warns if the submitted username differs, and writes `verifiedUsername` to `broker_onboarding`. The submitted username can even be absent while the persisted username is non-null.

v0.4, however, defines the mutation commitment as:

`bot_username: <本次提交的 bot_username>`

That means the signature can commit to a value different from the value actually written. Example: client signs `bot_username=null`; valid token resolves through `getMe` to `alice_bot`; production mutation writes `alice_bot`. The signature is valid while the final state contains an uncommitted value.

This violates the stated purpose of §2-bis: mechanically binding the signature to the actual write.

**Required invariant:** every authorization-relevant value written by the mutation must either be directly committed by the signed mutation digest, or be a deterministic derivation whose authoritative input and derivation rule are themselves committed and verified.

For this route, choose one normative model and test it:

- preferably, challenge issuance derives the authoritative Telegram bot identity from the token, persists that derived identity in the challenge row, includes it in `descriptor_hash`, and submission revalidates that the current `getMe` result matches the committed identity before mutation; or
- explicitly define `bot_username` as an external derived side effect and prove that `bot_token_hash + fixed getMe derivation rule` is the complete signed authority for it. If that model is chosen, the design must address username changes between challenge issuance and submission and fail closed on drift.

Do not sign the untrusted client hint while writing the server-derived truth and call that exact mutation binding.

### MUST-FIX B4 — operation/state recheck must be inside the same transaction as consume + write

v0.4 says the server rechecks whether the onboarding row currently exists and rejects if this disagrees with the operation frozen at challenge issuance. That is correct, but the check is only safe if it executes **inside the same SQLite transaction / serialization boundary** as:

1. operation/state recheck;
2. conditional nonce consumption;
3. onboarding INSERT/UPDATE;
4. proof archive.

If the existence/operation recheck occurs before `BEGIN`, another request can change the row between the check and the write, recreating a TOCTOU gap even though the later three writes are atomic. The acceptance test must include concurrent state change between challenge issuance/submission and verify that only a transactionally consistent operation can commit.

### Broker verdict

- nonce unique addressing: **ACCEPTED in design**
- frozen mutation field set: **ACCEPTED as structural improvement**
- exact binding to production mutation: **NOT YET CLOSED** because client `bot_username` != authoritative persisted `verifiedUsername`
- transactional state/operation consistency: **MUST-FIX / specify recheck inside same transaction**
- production endpoint wiring/deployment: **NOT AUTHORIZED by this review**

## 2. TN12 watchdog — commandLine matching fixes stop-scope, but introduces/retains an unsafe binary ownership decision

The new code correctly improves `Stop-Miner`: PID + executable path is not enough; comparing the recorded OS command line prevents the watchdog from killing a same-exe/different-config process after PID reuse or parallel manual launch.

However `Get-OwnedMinerProcess()` still returns only process-or-null. `null` conflates at least three materially different states:

1. **CONFIRMED_ABSENT** — recorded PID no longer exists;
2. **CONFIRMED_NOT_OURS** — PID exists but path/commandLine proves mismatch;
3. **UNKNOWN** — PID file missing/unparseable, commandLine was not recorded, CIM query failed, or current commandLine cannot be read.

The call sites then do:

`if (-not (Miner-Running)) { ... Start-Miner-Unless-Paused }`

Therefore an `UNKNOWN` identity state is treated exactly like confirmed death and can start another miner. A transient CIM failure while the owned miner is actually alive can thus create a duplicate miner instance. In the TN12 incident context, starting extra mining under uncertainty is not fail-closed; it can re-amplify the condition the brake is meant to contain.

The source comment says an unconfirmed process must never be treated as ours to stop, which is right, but the complementary rule is also required: **an unconfirmed absence must never be treated as proof that it is safe to start another miner.**

### Required fix: tri-state ownership/liveness

Replace the binary process/null contract with an explicit state, e.g.:

- `OWNED_RUNNING`
- `CONFIRMED_ABSENT`
- `UNKNOWN_OR_CONFLICT`

Rules:

- stop only `OWNED_RUNNING`;
- auto-start only after `CONFIRMED_ABSENT` (and no operator pause / brake);
- on `UNKNOWN_OR_CONFLICT`, alert and leave mining state unchanged; do not stop and do not spawn;
- a path/commandLine mismatch at the recorded PID should normally be `CONFLICT`, not evidence that the original owned instance is absent from the host;
- stale/corrupt/missing ownership metadata after watchdog restart needs an explicit recovery/reconciliation procedure, not silent auto-start.

Acceptance tests must include at least: transient CIM failure while owned process remains alive; commandLine unreadable; PID reused by same exe/different args; missing/corrupt pid file while a target-config miner is already running; and normal confirmed-dead restart.

### Watchdog verdict

- exact commandLine check before stop: **ACCEPTED improvement**
- safe process ownership/liveness semantics: **STILL MUST-FIX**
- current auto-start behavior under identity uncertainty: **FAIL-OPEN FOR STARTING / NOT ACCEPTED operationally**
- deployment/restart authorization: **NONE**

## Overall

Both unsynced commits are relevant collaboration feedback and were reviewed at source level. Broker v0.4 closes the prior headline gaps but still does not yet bind the signature to the exact authoritative bot identity written, and its operation recheck needs an explicit transactional boundary. Watchdog commandLine identity fixes the wrong-process kill risk but still conflates UNKNOWN with DEAD and can spawn a duplicate miner under observation failure.

No production money-path change, signing, broadcast, settlement/refund, key movement, deployment, or restart is authorized here.
