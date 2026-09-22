# Codex review — F3/F4 implementation closure

## Scope / provenance

Canonical bridge baseline checked first: `coord/codex-bridge@0725750bb31bab51438a6a98803c698baf562c74`; Git compare against the last processed/written-back SHA is identical (0 commits / 0 files). Five canonical bridge blobs were re-read from Git, not inferred from timestamps: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Because the bridge itself had no delta, I inspected the directly-related active branch. `bshard-m3-deploy` advanced beyond the prior relevant checkpoint `d85f8abbb28d93860c17536812372eddc5c4ca69`; relevant implementation/evidence includes `87f1a4675e1562f4b4d500e3e6ae0989903b78cb`, corrective/NWT follow-up `d557f67d9d15c4030c7c21ee8f60e3af116043f8`, and mutation-proof regression `ce530931deedfe849de987c1e631874f521d17ee`.

## Independent judgment

### F3 — shared fee-candidate eligibility: implementation-level CLOSED

The important property is not merely that settlement is hardened; genesis and bet must consume the same eligibility semantics. The implementation moves the shared filter into the common tx-assembly layer, removes the old naked `toFeeUtxoCandidates` path, makes unknown facts fail closed, and adds an anti-bypass lint rule. This materially closes the cross-path policy drift identified earlier. Refund-flip inherits the settlement build path rather than defining a fourth eligibility policy.

### F4 — shared relay-wallet reservation: implementation-level CLOSED, with one operational caveat

The final design has the two layers required by the race model: (1) DB-derived reservation from persisted non-terminal prepared/submitted/ambiguous transaction bytes and (2) synchronous in-process select-and-reserve covering the pre-persistence window. The corrective follow-up is important: it restored `proto_markets.genesis_prepared_tx_json` and `proto_bet_intents.prepared_tx_json` as real DB reservation sources after verifying that the relay ingest path does write them, fixed parsing of the production stored shape `JSON.stringify([txJsonString])`, and stopped unconditional release when IPC outcome is uncertain. An uncertain send now keeps the in-memory reservation until delayed reconciliation can hand it to the DB layer or safely release it.

The refund-flip migration is also no longer only inferred: real production-shaped `refund_flip` and genesis/settlement operations are run concurrently against the same best candidate and the invariant is checked at the actual broadcast set. This is sufficient for implementation-level closure of the earlier same-tick/shared-wallet MUST.

The mutation evidence in `ce530931...` materially strengthens closure: direct non-terminal genesis/bet DB-source tests were added, then the SOURCES list was actually mutated back to settlement-only and the new assertions went red before byte-identical restoration. This closes the earlier weakness where high-level fixtures transitioned too quickly to terminal state and could not detect removal of those DB sources.

Operational caveat: this does not authorize deployment. The reservation state is partly process-local, so restart/crash behavior still relies on persisted prepared state and fail-closed reconciliation. Deployment acceptance should therefore include restart/crash recovery under a real non-terminal prepared genesis/bet/settlement/refund intent; absence of sibling double-spend construction after restart should be observed, not inferred from unit tests.

### Other gates remain independent

F1/F1b remains implementation-level GREEN but still needs the already-requested patched simnet adverse rerun (`prepared close -> durable freeze -> zero first-send/replay`, with mempool/landed positive controls). F2 remains code-level CLOSED. D-032 cross-source proposition identity/polarity remains an independent MUST before valuable/autonomous judged markets. Refund lifecycle beyond driver-owned `refund_flip` remains separately gated; claim creation is not holder withdrawal.

## Verdict

- F3: CLOSED at implementation/test level.
- F4: CLOSED at implementation/test level, including refund_flip cross-entry contention and mutation-proof DB-source coverage.
- F3/F4 production deployment: NOT AUTHORIZED by this review; require normal Owner deployment gate plus restart/crash recovery evidence.
- F1 adverse simnet rerun: still REQUIRED.
- D-032 identity/polarity binding: still REQUIRED before valuable/autonomous judged markets.
- No production/mainnet migration, restart, signing/broadcast, relay funding, settlement/refund, or real-funds action is authorized here.
