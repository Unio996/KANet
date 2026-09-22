# Codex review — D-032 milestone C / append matrix

## Git/bridge baseline

- canonical branch checked first: `coord/codex-bridge`
- pre-write HEAD: `ddf67d6b10aff2ca00ad5e3f80aed2cff2274f0a`
- compare baseline = last Codex write `ddf67d6b10aff2ca00ad5e3f80aed2cff2274f0a`: identical, 0 commits, 0 files
- five canonical blobs re-read at that HEAD:
  - TO-CODEX.md `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No self-reported timestamp was used for increment detection.

## Unsynced relevant development increments reviewed

`bshard-m3-deploy` advanced from `86da66e4ab5bca3ecd7ad91dc3fc63eddd3a81e4` to `739ff6a1c69112e38989be0a676f705fbcead5a7` (3 commits). Relevant evidence includes NWT append matrix provenance and D-032 milestone-C provenance.

D-032 implementation branch advanced from reviewed `4dff42d99271421a0674625f138be06c95e86461` to `d4405fb8fdefd22c33b7453eea2861c8cd935302`.

## Independent findings

### 1. Previous missing/ambiguous URL event-id MUST: CLOSED at code/test level

Commit `1ce55ee8c0ec06e99e64e8baff5e27c1a943b289` changes `parseEspnParticipants` so presence of the `urlEventParam` key requires a non-null/non-empty exact match to payload event identity. `urlEventParam()` also collapses missing/repeated event parameters to rejection. Targeted production-path negatives cover missing, duplicate and empty event values, plus a structural negative. This closes the concrete bypass found in review `ddf67d6b`.

### 2. D-032 positive single-judge lifecycle: GREEN at implementation + isolated simnet level

Milestone-C provenance `d4405fb8fdefd22c33b7453eea2861c8cd935302` supplies a production-shaped isolated simnet H arm: two-step exact attestation, canonical ESPN identity binding, two bets, seal, extractor verdict, promote, close_commit, convert_to_claim and claim_draw. The recorded chain steps are real broadcasts/confirmations and the public `judge.statement/canonical_event` round-trip is reported byte-consistent with creation state.

This is sufficient to close the previously open “real simnet/e2e” requirement for the positive D-032 single-judge path. It is not production authorization.

### 3. D-032 upstream-never-final fail-closed behavior: GREEN for no-verdict/no-promotion; automatic deadline freeze is NOT newly proven

The R arm waits 50+ minutes with the upstream remaining non-final and observes zero `proto_market_verdicts`, hence no promotion. That is useful direct evidence that a non-final source does not manufacture a verdict.

However, the eventual freeze was an explicitly accelerated `operator_emergency_stop`; provenance itself states the legal automatic cutoff was still ~79.4 minutes away. Therefore this run must not be described as evidence that the normal deadline/cutoff path automatically freezes at the correct time. Existing refund/freeze evidence may stand on its own, but milestone C does not add that particular proof.

### 4. Sequential append finding is reclassified, not erased

NWT matrix provenance shows two production-shaped appends land cleanly when `seal_count=2`, while the previously failing second append was an over-capacity append under `seal_count=1`. Therefore the earlier hypothesis of a generic held-output/second-append byte-construction defect is NOT supported and should be withdrawn.

The remaining defect is still material: the API/driver accepts an append beyond the contractual seal threshold, the contract then correctly rejects it, and the deterministic rejection can enter repeated replay. Required fix scope is therefore admission/preparation policy + terminal-rejection handling, not covenant byte assembly. Valuable multi-bet release remains blocked until over-capacity requests fail before durable prepared/broadcast state and deterministic consensus rejection cannot replay indefinitely.

## Verdict

- D-032 missing/duplicate/empty URL event identity MUST: **CLOSED (code/test)**.
- D-032 single-judge positive lifecycle: **GREEN (implementation + isolated simnet)**.
- D-032 non-final source => no verdict/no promotion: **GREEN**.
- D-032 automatic deadline freeze: **not newly proven by milestone C**; do not overclaim the emergency-stop arm.
- Generic sequential-append bad-byte defect: **RETRACT / NOT SUPPORTED** by the seal_count=2 matrix.
- Over-capacity append admission + deterministic-rejection infinite replay: **OPEN MUST**.
- Production/mainnet funds-path changes or deployment: **HOLD / NOT AUTHORIZED**.
