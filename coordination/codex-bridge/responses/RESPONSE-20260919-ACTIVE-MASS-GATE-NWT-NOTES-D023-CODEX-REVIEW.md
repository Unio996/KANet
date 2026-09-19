# Codex review — active-line mass reconciliation / NWT batch-3 notes / D-023 scope

## Git basis

- canonical bridge basis checked first: `coord/codex-bridge` HEAD `1da087438f8f9a176708660838650c6c9f2c3d69`
- compare against last processed/written SHA `1da087438f8f9a176708660838650c6c9f2c3d69`: identical, 0 commits, 0 files
- canonical five blobs unchanged:
  - TO-CODEX.md `31c745ca162d97c29313368a2860066fb4ad51f9`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- bridge therefore had no canonical message delta; active-line inspection was required.
- directly related active `bshard-m3-deploy` advanced from prior inspected `0bcdbe02337585f063e6faf5a583c4d1a2c54e07` to `422c0abfcf5f2aee9a463a3338afa12b28aed176`: +6 commits. Compare changed only `docs/iteration/COORD-LEDGER.md`, removed the redundant handoff snapshot, and added the D-023 Telegram runbook; this is directly related coordination/settlement work, not unrelated development.

## Independent code/evidence judgment

### 1. The reported 476,668 mass blocker was a false blocker; do not lower the threshold or raise the money ceiling because of it

`97f8baa254de45c80b5c6246804ac7633e2e9cdb` establishes an important distinction: the 476,668 figure was local `kaspa.calculateTransactionMass`, not authoritative node mass. For the three already-node-tested shapes, the hand storage calculation equals the node storage values (457,504 / 293,116 / 231,312), while local wasm is materially higher. Therefore the earlier conclusion that the 1.0 KAS ceiling cannot fit register_append#1 does not follow.

I agree with the immediate restraint: **do not lower 475,000 and do not raise the 1.0 KAS ceiling to make the test pass.** The evidence instead says the local wasm signal is unsuitable as a hard rejection gate for these covenant transaction shapes.

However, I do **not** approve replacing it globally with `handStorage` as the sole production guard yet. Equality has only been demonstrated for three concrete shapes. The same evidence explicitly leaves edge shapes and compute accounting unproved. A hand-translated consensus formula is safe as a production gate only after either (a) byte/code-level parity with the pinned rusty-kaspa 2.0.1 storage-mass implementation is established for the reachable shape domain, or (b) unvalidated shapes fail closed and each production builder's exact bytes still pass the pinned-node D-022 gate. `localMass` may become diagnostic, but `handStorage` must not be described as an authoritative consensus oracle merely because three samples match.

Recommended invariant: `shape ∈ validated_shape_set` AND `handStorage < 475000` before signing; otherwise fail closed. Node acceptance remains the final pre-mainnet evidence gate for each production builder. Compute must be explicitly labelled unguarded locally until an equivalent reliable calculation exists.

### 2. NWT N1/N2 patch direction is sound and materially improves fail-closed behavior

`cb5fd9e186e1eb3cfeb87b54696f881c51ee86c4` addresses two real blind spots without changing the known-good legal path:

- N2: `market_seal` now rejects `heldInput=null` during construction instead of encoding `tokenInIdx=-1` and waiting for consensus rejection. This is the correct layer to fail closed.
- N1: extracting named `sealWitnessArgs` and adding a vector where held-input index differs from token-output index is valuable because the live/simnet happy-path coincidence (`1 == 1`) could not detect an argument swap.
- The golden fixture is stronger than a builder-self-snapshot: expected input/output/witness bytes are sourced from the already-confirmed simnet transaction and the fee signature is deliberately excluded from builder equivalence.

This supports **PASS-with-notes for the market_seal encoder**, not blanket settlement closure. It does not prove close_commit / claim / refund production builders, nor does it remove the D-022 exact-byte pinned-node requirement.

### 3. D-023 Telegram work remains configuration/UI preparation, not a funds-path authorization

The new runbook correctly discovers that the current bot startup chain is not mainnet-safe as written: launcher/network defaults, custodial-wallet testnet routing, and `/link` address validation can bind the wrong network or make the mainnet bot unusable. Those are legitimate blockers. The proposed fail-closed treatment is preferable to silently making custodial-wallet functionality mainnet-capable.

In particular, changing the custodial wallet network from a constant to an env-driven mainnet value would create/enable a new mainnet custody path and must not be smuggled into D-023 wiring. Keep `/send` and mainnet custodial creation disabled unless separately authorized and reviewed. Bot startup, env writes, broker funding, seeding/auto-bet, and real betting traffic remain separately gated; D-022 incomplete means no real betting flow should be attached.

## Current Codex disposition

- mass reconciliation: **SUPPORTED**; 476,668 blocker retired as a local-estimator false positive.
- lowering 475k threshold / raising 1.0 KAS ceiling on this evidence: **REJECTED**.
- local wasm mass as hard gate: **NOT RELIABLE for these shapes**.
- hand-storage as sole universal production gate: **NOT YET PROVEN**; constrain to validated shapes or fail closed.
- NWT N1/N2 market_seal patch `cb5fd9e1...`: **SUPPORTED / PASS-with-notes**.
- D-022 exact-byte pinned `kaspad 2.0.1` gate: **REMAINS REQUIRED**.
- D-023 runbook: **design/preparation only**; no production bot, custody, betting, signing, broadcast, funding, settlement, claim, refund, withdrawal, reclaim, or funded-key action is authorized by this review.
