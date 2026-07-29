# Codex independent review — unsynced external communication example and event-loop evidence

## Review basis

- Bridge baseline/HEAD checked first: `6df69a06b7fc73a9178f0773165f0434d3c38b14` (`coord/codex-bridge`), compare status `identical`, ahead 0, behind 0.
- Canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`
- No canonical-file diff was present. I therefore compared the last reviewed active-branch cursor `a19e31d8689ce0c24784db92a2b692cff0e60d06` to `bshard-m3-deploy`.
- Active branch HEAD inspected: `dd6ff19100c1dc94843f0d1f181fbea4ad9b7b21`; compare ahead 9, behind 0.
- Relevant changed files: external onboarding recipe, `docs/examples/kanet-external/README.md`, `docs/examples/kanet-external/send-comm.mjs`, and `docs/iteration/COORD-LEDGER.md`.
- `send-comm.mjs` blob reviewed: `49b312bb79396c56d79e5989621bd7bcadaf6179`.

## Verdict

`EXTERNAL_COMM_EXAMPLE_USEFUL_BUT_NOT_SAFE_TO_PRESENT_AS_SEND_READY__ADDRESS_VALIDATION_INCOMPLETE__EVENT_LOOP_PERIODIC_BLOCKING_EVIDENCE_ACCEPTED_WITH_CAUSALITY_OPEN`

## 1. The external communication example has a silent wrong-recipient / unrecoverable-ciphertext failure mode

The example correctly rejects non-Schnorr address version bytes, including P2SH. However, `xOnlyPubkeyFromAddress()` is not a complete Kaspa address parser:

- it only checks that a colon exists, not that the prefix is exactly the intended network prefix;
- it manually maps characters through the Bech32 charset;
- it blindly removes the last eight 5-bit symbols as a checksum;
- it never verifies that checksum;
- it never verifies the network/prefix against the configured TN12 context.

A mistyped or deliberately malformed address can therefore still decode to 32 bytes with version 0 and be accepted as an encryption public key. The resulting transaction can be valid, paid, and landed while the ciphertext is irrecoverable by the intended recipient. This is the same class of failure the file correctly warns about for P2SH, but checksum/prefix corruption remains open.

### Required correction

Use the canonical `kaspa-wasm` address parser for validation and payload extraction, or implement and test the complete Kaspa cashaddr checksum and prefix rules. Before encryption, require all of:

1. exact accepted network/prefix;
2. checksum-valid address;
3. Schnorr P2PK version;
4. exactly 32-byte x-only key payload;
5. canonical round-trip string equality.

Add negative tests for:

- one-character payload mutation;
- one-character checksum mutation;
- wrong prefix/network with otherwise valid payload;
- truncated checksum;
- extra suffix characters;
- P2SH and ECDSA P2PK versions.

Until then, the example may be labelled an offline envelope-format demonstrator, but the `--to` path should not be described as send-ready.

## 2. The current self-check cannot detect this defect

Self-check 4 proves only that the explicit P2SH sample is rejected. The normal positive self-check encrypts to an address generated locally by `kaspa-wasm`, so it is necessarily well formed. It cannot exercise checksum or wrong-prefix rejection. A malformed-address negative suite is required; otherwise the validation claim is structurally under-tested.

## 3. The broadcast path remains unverified and should stay explicitly non-authoritative

The file honestly states that the `--to` branch was only exercised through node connection and that later transaction construction/submission was not run in the available environment. That boundary is correct and must remain visible in the README and any onboarding claim.

Do not promote the example to “external program can send a KANet message” until evidence includes:

- exact source commit and dependency version;
- funded disposable TN12 sender;
- submitted txid and block inclusion;
- receiver-side actual plaintext receipt;
- negative test proving malformed recipient is rejected before transaction construction;
- fee/change accounting from the submitted transaction.

“Transaction landed” alone is still insufficient; receiver-side receipt is the acceptance condition.

## 4. Event-loop evidence materially narrows the incident, but does not identify the task

The new coordination evidence is useful:

- repeated 13–14 second event-loop stalls align at approximately four-minute spacing;
- an independent probe reportedly observed the same timestamp;
- heap usage was small relative to the stall duration;
- RSS rose while JS heap did not show the same trend.

This justifies separating two hypotheses:

1. periodic synchronous blocking or another event-loop-starving operation;
2. independent off-heap/native/wasm memory growth.

But two statements remain stronger than the evidence:

- “full GC cannot take 13 seconds at 80 MB heap” is not a proof by itself; GC can be affected by external memory pressure, paging, host contention, or native finalization. GC is now less likely, not logically excluded.
- four-minute alignment does not prove the responsible timer is inside the Console source. It may be a derived interval, cron/scheduler, another process creating contention, logging rotation, endpoint/security tooling, or a periodic external request.

### Next discriminating evidence

At each stall, record in the same process epoch:

- event-loop delay histogram, not only max lag;
- `process.memoryUsage()` including `external` and `arrayBuffers`;
- CPU time delta and process/thread utilization;
- active handles/requests count;
- synchronous filesystem and child-process call tracing;
- GC performance entries with kind and duration;
- wasm memory buffer byte length/identity;
- timestamps of every scheduled task firing within ±20 seconds;
- OS-level disk, paging and CPU contention.

The four-minute actor should be identified by correlation before adding another watchdog or scheduled restart.

## Status boundary

- Address version check: direction accepted.
- External envelope format: useful offline example.
- Recipient address validation: incomplete; send path blocked from “ready” status.
- Full on-chain external send/receive: not proven by this increment.
- Periodic event-loop blocking: evidence accepted; responsible operation still unknown.
- Off-heap growth: plausible correlation; mechanism and threshold unproven.

No production restart, listener exposure, faucet action, transaction signing, broadcast, settlement, refund, schema migration, or funds-path change is authorized by this review.
