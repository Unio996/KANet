# Codex review — active-line delta after bridge baseline 6a5016dd

## Git / blob baseline

- Canonical branch checked first: `coord/codex-bridge` HEAD = `6a5016dd52a5e76b21543c2f4a2495a2b6ce0d96`.
- Compare `6a5016dd52a5e76b21543c2f4a2495a2b6ce0d96...coord/codex-bridge`: identical, ahead 0, behind 0, 0 changed files.
- Five bridge blobs at that HEAD:
  - `TO-CODEX.md` = `31c745ca162d97c29313368a2860066fb4ad51f9`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No bridge-file timestamp was used for increment detection.

## Directly related active-line delta

`bshard-m3-deploy` advanced from the last reviewed checkpoint `229c59da5f1fbc4aa991679bc58219a3d5746cdf` to `0bcdbe02337585f063e6faf5a583c4d1a2c54e07`: 6 commits, touching `docs/2026-09-19-bettor-proto-v0-handoff.md`, `docs/DECISIONS.md`, and `docs/iteration/COORD-LEDGER.md`.

Substantive settlement-related evidence reviewed includes active-line ledger entries 1497–1500 and J2 batch-3 commit `68235afb8e8df43b57bb5a62f11cd4ff296276bb`.

## Independent findings

### 1. bettor-key provenance blocker is narrowed, not waived

Current production HTTP bet path does in fact derive `bettorPk` from `committee_pubkeys_json[0]` before inserting `proto_bets`; therefore the earlier claim that every production bet necessarily used an independently generated bettor key was wrong for the current v0 implementation. This supports using the corresponding committee private key for the existing live-market tickets only after proving exact public-key equality.

The previous Codex MUST-PROVE remains mandatory and is now the correct boundary: derive the expected bettor pubkey from the exact ticket/bet provenance, derive the pubkey from the candidate private key, compare byte-for-byte before IPC/signing, and fail closed on mismatch. Add both positive and negative fixtures. `bettorPk == committeePk[0]` is an implementation fact of the current v0 HTTP path, not a covenant/protocol invariant and must not be generalized to future multi-user flows.

Verdict: **CURRENT V0 PROVENANCE SUPPORTED; KEY-EQUALITY GUARD STILL REQUIRED.**

### 2. J2 batch 3 market_seal builder is not merge-cleared yet

Commit `68235afb8e8df43b57bb5a62f11cd4ff296276bb` adds the production `buildMarketSealTxJson`, RootClose genesis construction and dynamic `convert_to_rootclose` witness encoding. Its offline 8/8 tests are useful construction evidence, but the commit itself explicitly says the production bytes have not yet been submitted to official `kaspad 2.0.1` simnet.

The builder also temporarily reuses the register_append 1.0 KAS fee cap rather than carrying independently measured market_seal production provenance. That is acceptable only as a bounded temporary cap, not as proof of an exact production fee algorithm.

D-022's gate is therefore unchanged: exact production-builder bytes must be node-submitted on pinned official 2.0.1 simnet before this batch is mainline-cleared. Dynamic ABI witness encoding is precisely the part that needs byte/consensus closure.

Verdict: **OFFLINE CONSTRUCTION SUPPORTED; MAINLINE MERGE HOLD PENDING PINNED 2.0.1 EXACT-BYTE SIMNET.**

### 3. D-023 Telegram identity reuse does not authorize funds-path activation

D-023 is an operational identity/configuration decision. Its own scope keeps environment writes, broker identity creation/funding, switches, automatic betting and seeder activation behind separate review/Owner gates, and states that real betting flow must not be connected before settlement completion. Reusing the bot identity therefore must not be treated as authorization to enable the settlement driver, betting automation, or any production signing/broadcast path.

The stated safeguards are directionally correct: fresh admin secrets rather than TN12 reuse, no `KANET_TESTNET_NO_LIMITS` in mainnet env, stale bot conversation state backup/clear, and explicit user-facing asset semantics. Secret values must remain outside the public repository.

Verdict: **CONFIG/RUNBOOK DIRECTION SUPPORTED; NO PRODUCTION FUNDS-PATH AUTHORIZATION.**

### 4. Existing settlement holds remain

This delta does not provide pinned-node exact-byte evidence for J2 batch 3 or later production builders, does not prove distinct-key 4-of-5 threshold behavior, and does not close the previously identified claim/refund branch-specific requirements merely by changing operational coordination. Mainnet settlement/claim/refund/withdraw/reclaim remains separately gated.

## Codex disposition

- Keep D-022 exact-production-bytes → official `kaspad 2.0.1` simnet → mainline sequence.
- Require bettor-key byte-equality proof before any ticket/claim signature.
- Do not infer 4-of-5 safety from repeated-key slot tests.
- Do not turn simnet fixed fees or borrowed caps into a production fee oracle without node-backed pre-submit policy/evidence.
- Do not enable or deploy production funds-path changes from this review.
