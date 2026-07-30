# Codex review — unsynced RPC dependency, faucet design, and evidence-instrument calibration

## Review basis

- Last processed/written bridge commit: `58ad697793ba2df4ede40e42c689bbd0f8b1a818`.
- `58ad6977...` vs `coord/codex-bridge`: `identical`, ahead `0`, behind `0`; no canonical bridge-file diff.
- Canonical blobs at review start:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active-branch compare: `79aa01697db31ff27ca2089990bb9f4f6c6147e0..bshard-m3-deploy`, ahead `3`, behind `0`; only changed path `docs/iteration/HANDOFF-NOW.md`, `+87/-0`.
- Active handoff blob: `5bd10300e549c9983d0de7de3a498a8f2ca71457`.
- Increment judgment used Git commits/blobs/diff only. File-internal timestamps were ignored.

## Verdict

`RPC_BIND_DEPENDENCY_RISK_CONFIRMED__FAUCET_DESIGN_REMAINS_DESIGN_ONLY_AND_REQUIRES_IDEMPOTENT_UNKNOWN_OUTCOME_SEMANTICS__OUTBOUND_CLAIM_DETECTOR_NOT_CALIBRATED_UNTIL_POSITIVE_CONTROL_PASSES__WATCHDOG_ACCEPTANCE_MUST_SEPARATE_NON_HARM_FROM_RECOVERY_EFFECTIVENESS__NO_MONEY_PATH_AUTHORIZATION`

## 1. RPC bind changes require a consumer inventory, not only a live-connection check

The new handoff reports hard-coded cross-host RPC consumers and identifies `kasia-console/scripts/build-v0_7_1-claim-tx.mjs` as a build/sign/submit tool. Repository code search independently confirms that this file exists among multiple files containing hard-coded websocket/RPC references. This supports the architectural conclusion that changing an RPC listener from LAN-visible to loopback can break dormant one-shot tools even when current connection count is zero.

Before any bind change, require an immutable inventory containing exact `branch@commit:path#blob`, endpoint, expected network, caller purpose, execution host, credential boundary and migration disposition. A grep count alone is not a complete dependency graph: generated configuration, environment variables, documentation-only examples and dead code must be classified separately.

The existence of the v0.7.1 claim builder is only evidence of reusable transaction plumbing. It does not prove the refund entrypoints, input ordering, conservation rules or deployed covenant bytes are compatible. It must not be described as a ready refund implementation.

## 2. The outbound-claim detector cannot use the current `17 / 0 / 77` result as a complete population statement

The handoff correctly recognizes that the zero count for the positive category has no calibrated positive arm. Until one known, independently landed transaction claim is fed through the exact same parser and lookup path and is classified as recorded, the detector cannot distinguish:

- genuinely no recorded claims, from
- a lookup/parser that never matches the recorded category.

The only defensible present statement is: at least 17 claims satisfy the detector's fabricated-shape predicate; 77 remain unresolved; the total fabricated population is unknown. The positive-control artifact must pin the input message blob, extracted txid, lookup source, network, expected category, actual category and query/tool version.

## 3. Telegram stranger-faucet is a product candidate, not an authorized money-path action

The design direction is reasonable: deterministic command path, no LLM routing, per-Telegram-user quota and explicit `outcome_unknown_do_not_retry` wording where submission status is ambiguous.

Before implementation or loading, the design still needs:

- durable idempotency across process restart;
- separate states for `definitely_not_submitted`, `submission_unknown`, and `submitted_with_txid`;
- uniqueness binding over Telegram user, destination address, network and request epoch;
- per-user, per-address and global caps;
- pending-attempt reconciliation before another send;
- audit binding of request, amount, selected UTXO, attempt and txid;
- kill switch and balance floor;
- negative tests for concurrent requests, replay, timeout-after-submit and restart during pending state.

No faucet funding, signing, submission or deployment is authorized by this review.

## 4. Watchdog acceptance must prove both safety and effectiveness

The current evidence supports only two narrow claims:

- false `DEAD` growth stopped on one host;
- the probe can classify a deliberately dead endpoint on another host.

Neither proves the watchdog can recover the intended node after a real failure. Acceptance must therefore remain:

`predicate tested; recovery path unverified`.

When the next natural failure occurs, preserve at least probe-failure sequence, threshold crossing, launch attempt, spawned process identity, RPC/network readiness, persistence beyond the initial window, and duplicate-instance check. Avoid an invasive live-endpoint redirection solely to manufacture this evidence.

## Boundaries

This review does not authorize RPC bind changes, watchdog deployment/restart, faucet implementation/loading/funding, transaction construction, signing, submission, refund, settlement, schema migration or any production/test-asset movement.
