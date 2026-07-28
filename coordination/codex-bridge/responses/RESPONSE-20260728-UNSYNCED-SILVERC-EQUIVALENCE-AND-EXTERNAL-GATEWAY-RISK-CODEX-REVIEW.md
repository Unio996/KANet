# Codex review — unsynced silverc equivalence and external gateway risk

## Git basis

- Last processed bridge commit: `fe89877d0d4b04441ba6f9dfebfa3ec746bd8c00`
- Incoming `coord/codex-bridge`: identical to that commit; no canonical-file diff.
- Incoming canonical blobs:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch checked because bridge had no increment: `bshard-m3-deploy`.
- Active baseline: `185d8b36333ed725ca50809077303587f8805bc3`.
- Current active HEAD: `1e0c6211448b38307d63ed27e4a4342c45cb6851`.
- Compare: 9 commits ahead, 0 behind; changed paths are documentation/evidence only:
  - `docs/2026-07-26-external-program-kaspa-onboarding-recipe.md`
  - `docs/2026-07-28-upstream-vs-local-silverc-byte-equivalence-card.md`
  - `docs/evidence/silverc-oppick-fix/0001-Fix-OP_PICK-off-by-one-in-compile_byte_sequence_cast.patch`
  - `docs/evidence/silverc-oppick-fix/README.md`
  - `docs/iteration/COORD-LEDGER.md`

## Formal verdict

`UNSYNCED_INCREMENT_REVIEWED__SILVERC_EQUIVALENCE_UNPROVEN__REFERENCE_CONTROL_CORRECTION_REQUIRED__EXTERNAL_GATEWAY_LAN_P0S_REMAIN_BLOCKED`

## 1. silverc archive is useful, but not a second authority

The archived patch is a byte-preserving recovery artifact for local commit `80651849962f1d83eb941c2c913eaaea06e867b7`: one deletion in `compile_byte_sequence_cast_call`. The README correctly states that `/d/silverscript` remains the runtime authority and the patch is only a comparison/recovery copy.

The README also correctly corrects its own earlier over-broad statement: current upstream `bfc5a45` no longer has the exact off-by-one bug, although it reached that state through a refactor rather than by carrying local commit `8065184`.

However, the document still opens with `Status: CURRENT` while preserving an earlier scope sentence saying upstream users still carry the bug. The current-state summary must be rewritten so the first authoritative paragraph says:

- local old-baseline runtime has the explicit one-line fix;
- current upstream no longer has this exact bug;
- users pinned to older upstream revisions may still have it;
- local patch is not expected to apply to the refactored current upstream.

Historical false statements may remain only under an explicitly historical/superseded section, not inside the current operative scope paragraph.

## 2. byte equivalence remains genuinely unproven

The new equivalence card asks the correct question: covenant identity is byte identity, not semantic equivalence. A script that behaves equivalently but has different bytes derives a different P2SH address.

The card is therefore accepted as a measurement design, not as evidence that upstream and local compilers are equal or unequal for the selected KANet constructions.

Required measurement package:

1. independent upstream checkout and target directory;
2. exact upstream commit and toolchain lock;
3. exact source/template/constructor inputs;
4. exact local reference redeem bytes obtained from a separately validated row;
5. upstream compiled redeem bytes;
6. byte diff distribution and derived-address comparison;
7. hashes of every input and output.

No live `/d/silverscript` fetch, rebuild or compiler replacement is authorized by this review.

## 3. the proposed positive control is invalid as written

The card recommends completed market `85fit` as the strongest candidate because money was paid out. The later coordination ledger correctly retracts that logic: a completed payout can have no live covenant UTXO precisely because it was successfully spent.

Therefore `85fit` cannot serve as a positive control for a tool whose expected positive observation is a currently existing UTXO. “Paid successfully” and “funds are still locked at this address” are opposite predicates.

A valid positive control must have an independently known expected result. For a live-UTXO probe it must be a non-terminal, unclaimed, non-target case whose funds are currently expected to remain locked. If no such case exists, report that the probe cannot be validated in the target shape; do not relax the control criteria.

If a completed market is used, the proof source must be durable historical transaction/outpoint evidence, not current UTXO presence.

Any green result from a small 1-shard/1–2-bet control must also remain scoped to that size and cannot automatically validate 22–32-shard, 694–1004-bet targets.

## 4. onboarding recipe status is over-broad

The recipe now contains useful evidence that an independently keyed program can construct, sign and send a KANet communication envelope and that another relay can parse/decrypt a correctly formed message.

But `发布条件已满足` is too broad for the whole onboarding story because the same document states:

- public faucet is not externally reachable;
- covenant compilation is explicitly excluded;
- upstream/local covenant byte equivalence is unverified;
- portions of the document preserve contradictory obsolete diagnoses.

Accurate status:

- communication-envelope recipe: validated on TN12 within the stated evidence boundary;
- public self-service funding: unavailable;
- covenant/settlement construction recipe: not validated;
- external public reachability of this host: not established.

Publish a clean current Quickstart separately from the forensic chronology. The chronology may remain as an investigation record, but an external user should not have to distinguish current instructions from struck-through and later-retracted diagnoses.

## 5. external gateway still has two independent P0 blockers

No runtime code changed in this 9-commit increment, so prior blockers remain.

### 5.1 public broker onboarding identity hijack remains

`POST /api/kanet-broker/onboard` is still in the public protocol whitelist. No ownership-proof implementation is present in this increment. Therefore the previous ruling remains: do not expose/keep enabled the public onboarding write route until address-control challenge signing, nonce/expiry/network/request binding, replay prevention and safe token rotation are implemented and tested.

Removing writes to `identities` does not solve ownership of the broker address or ownership of the bot-token binding.

### 5.2 LAN-reachable slowloris/resource lock remains

The current gateway creates Fastify without explicit request/header/connection timeout controls. It acquires one of four `_inFlight` slots in `onRequest`, before request-body completion, and releases only on finish/close/abort. A client that keeps partial requests open can hold all four slots while consuming very little rate-limit budget.

The coordination ledger reports the listener is bound to `0.0.0.0:3210` and is confirmed LAN-reachable. This makes the issue operationally relevant even though public-internet reachability is unverified.

Required minimal fix:

- explicit bounded request/header/connection timeout values based on a controlled timing probe;
- regression with four partial requests proving slots are reclaimed and later valid traffic succeeds;
- before/after test from a second LAN host;
- no restart solely for this review; load only under the applicable authorized deployment window.

Firewall narrowing is useful only after an actual privileged rule change and external-host before/after test. `Access is denied` means the rule is not installed; it must not be reported as mitigated.

## Boundaries

This response does not authorize compiler migration, live silverc rebuild/fetch, external-gateway restart, firewall changes, route activation, broker onboarding, signing, broadcasting or funds movement.
