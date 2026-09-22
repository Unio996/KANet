# Codex review — F1 exact crash arm closure + sequential append bad-bytes

## Git/bridge basis

- Canonical bridge HEAD inspected before review: `e2542ed652a79ef27d7d720b7387c2247bdb85ac`.
- Compare against last processed/written-back SHA `e2542ed652a79ef27d7d720b7387c2247bdb85ac`: identical, ahead 0, behind 0, 0 commits, 0 files.
- Five canonical bridge blobs re-read from Git: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- No file-internal timestamp was used for increment detection.
- With bridge unchanged, directly-related `bshard-m3-deploy` was checked from prior checkpoint `cb170c30056bab074c1267741a56be86dad3192d` to `52c06c5c1971d98c6ce1c5bd16ff09013c44d392`: ahead 10 commits. Relevant new provenance includes F1 final crash arm `af970f8aee4ef216def85bc1e3b02e7d8627fae3` and append bad-bytes replay repro `e13341855b7eb9197ef6f73ed5bb26a67db5af75` (merged thereafter).

## Independent ruling: F1 exact prepared-before-freeze crash/restart arm = GREEN / CLOSED at implementation+simnet level

The new arm now matches the previously required ordering rather than merely testing a frozen prepared row:

1. market is unfrozen and sealed;
2. with settlement driver disabled as deterministic pre-submit barrier, production `ops.build` / close builder creates and persists a real signed `prepared` close intent before freeze;
3. independent node query records the prepared tx absent from mempool;
4. real `freezeMarket()` path freezes the market after prepared persistence;
5. console is hard-killed (`taskkill /F`), not gracefully stopped;
6. same DB is restarted with settlement driver enabled; recovery immediately holds the pre-existing prepared intent;
7. `submitted_txid` remains null, prepared bytes SHA-256 remains identical, and node-side observation remains absent; the already-landed seal control remains landed rather than being incorrectly held.

The action ordering is materially evidenced (`seed_prepared_close_inserted_prefreeze` before `emergency_freeze_harness`), and the pre-crash snapshot records the frozen market together with the still-prepared resolve intent and null submitted txid. This closes the exact residual F1 crash/recovery criterion from the prior Codex review.

Scope: this is implementation/simnet closure only. It is not production deployment authorization and does not authorize any mainnet funds-path change.

## New independent finding: sequential append bad-bytes is a MUST blocker, not a retry-policy-only issue

NWT's independent repro materially changes the risk picture. The second append was constructed only after bet1 had already landed and the in-flight guard had released, yet the newly constructed transaction was deterministically rejected by the node with `failed to verify the signature script: script ran, but verification failed`. The same prepared tx was then replayed every 20 seconds for 17 attempts over 320 seconds with no backoff/escalation.

Therefore the evidence does **not** support the earlier race framing. At least for the reproduced shape, the defect lies on the held-output / second-sequential-append construction path itself (or a downstream witness/ABI/signing dependency of that path). The infinite replay is a second defect: it amplifies the primary malformed-transaction bug and leaves a market non-terminal.

Ruling:

- **Primary append construction defect: MUST / release blocker for any valuable multi-bet market.** Do not mask it by merely adding retry backoff or auto-rebuild.
- **Prepared deterministic-rejection replay loop: MUST safety/operability fix before autonomous valuable use.** A node-deterministic script-verification rejection of identical bytes must not be retried forever. It should reach a bounded HOLD/ambiguous/manual-review state with alerting; exact policy can follow root-cause work.
- Root-cause closure must use a differential matrix across first append vs second append, same-side vs opposite-side, multiple stakes, and preferably third append, while tracing the held KTT outpoint/state, leaf/root state derivation, covenant entrypoint arguments, sighash/signature material, and final serialized transaction. The fix needs a mutation/regression test that fails on the pre-fix held branch and proves two sequential production-shaped appends land under consensus.
- The current repro has an important boundary: one market shape was tested, and `seal_count=1` plus timing/API acceptance complicates product semantics. That does not invalidate the consensus rejection; it means the claim must remain “confirmed for the reproduced second-append shape” until the differential matrix establishes universality.

The route/API question—whether a second bet should have been accepted for that `seal_count=1` market—is separate and must not be used to dismiss the malformed held-append transaction. If API acceptance is itself wrong, fix it separately.

## Other gates

- F1b remains GREEN.
- F3/F4 implementation/test closure remains unchanged.
- D-032 participant-finality / proposition-binding implementation evidence remains OPEN from prior reviews.
- rusty-kaspa 2.1.0 simnet evidence may inform an upgrade decision, but this review does not grant Owner GO or authorize production node replacement.
- Production/mainnet funds-path expansion remains HOLD.
