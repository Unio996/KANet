# Codex review — R-a NWT implementation review + D-032 question-creation red-team

Canonical bridge baseline checked before review: `19091df0aa0257792c95acc0ad3aa18498e0ea0d`; Git compare against that same last-processed/writeback SHA was identical (0 commits, 0 files). Canonical five-file blobs at the checked HEAD: `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`; `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No self-reported timestamp was used for delta detection.

Because the bridge itself had no delta, I compared the directly active development branch from the last inspected checkpoint `51babaa71efbfa7921b51555a8cd9003e1cc5e79` to current `d85f8abbb28d93860c17536812372eddc5c4ca69`: +15 commits. I excluded unrelated capability/docs changes and inspected the directly relevant R-a/NWT and D-032 provenance/code changes.

## R-a refund_flip — independent assessment

NWT's implementation review materially strengthens the evidence for the narrow R-a conclusion. The review independently reran the directly affected suites, linted changed source, exercised an independent mutation set, and stress-tested v214 migration. The remaining M3 finding is real but is a regression-coverage gap rather than a demonstrated current runtime safety failure: `deriveRefundClaims` computes both sides of its conservation comparison from the same confirmed-ticket relation in one synchronous better-sqlite3 call path, making mismatch unreachable under the current implementation. However, because the design explicitly names `Σ claims != pool => HOLD` as an invariant, a test must make the independent comparison injectable/mockable (or monkey-patch the SUM query) so deleting the guard turns a test red. Keep this as a MUST-before-R-b/R-c closure, not as a reason to revoke the already narrow R-a simnet GREEN.

I also accept NWT's verification that R-a did not silently widen the controlled funnel to `convert_to_refundclaim`/`refund_payout`, and that observed third-party refund_flip lineage is constrained by covenantId + exact SPK/value successor facts, old-outpoint disappearance, and depth-gated landing. The absence of a direct spender-txid query remains a disclosed evidence limitation, not a new authorization to broaden the IPC read surface.

F3/F4 remain OPEN. Nothing in the R-a NWT review demonstrates cross-entry shared-relay-wallet fee-candidate parity/reservation. `refund_flip` must eventually participate in the same select+reserve critical section as genesis/bet/settlement, with an adversarial concurrent test proving a sibling operation cannot prepare/broadcast the same fee outpoint.

## D-032 — question-creation red-team

The D-032 red-team exposes a more fundamental issue than a generic "ambiguous wording" problem: the current creation contract can bind two independent adjudication identities that are never proven to describe the same proposition. `validateJudgedMarketInput` can accept a valid ESPN predicate and a syntactically valid but semantically unrelated Polymarket `outcomeConditionId`; downstream extractor and UMA paths then answer different questions and only meet again after both have been mapped into the same binary side space. That is a structural identity-binding defect at creation time, and it must be closed before valuable/autonomous judged markets are enabled.

I do **not** consider weak fuzzy text matching alone a sufficient final invariant. Team-name/title overlap is useful UX screening but can false-positive on rematches, series, dates, props, home/away variants, or similarly named events. The minimum safe contract should persist and operator-confirm a canonical cross-source binding artifact at creation: fetched Polymarket condition id + immutable question/title (and event/market identifier where available), fetched canonical-source event identity, explicit local proposition/predicate, and explicit polarity mapping. Creation must fail closed if either remote identity cannot be fetched or the operator has not confirmed the displayed binding. If deterministic machine-verifiable event identifiers exist for a supported source pair, use them; otherwise classify the binding as operator-attested and keep valuable autonomous activation gated rather than pretending text similarity proves semantic equivalence.

The red-team's second finding is also valid: `secondary_sources`, `ambiguity_handler`, `dispute_keywords`, and `edge_case_examples` must not be represented as automatic adjudication controls while the runtime judge does not consume them. Either label them clearly as human dispute/audit metadata or remove them from the automatic-safety claim. Do not wire natural-language ambiguity text directly into deterministic adjudication merely to make the fields look "used".

The polarity issue is a separate MUST for operational closure. `polymarket_outcome_side` is currently operator-supplied and a reversal can deterministically manufacture disagreement even when both sources describe the same event. Before any valuable autonomous judged-market enablement, creation UI/API must display the fetched Polymarket proposition/outcome labels beside the local YES/NO predicate and require explicit polarity confirmation that is persisted in the frozen resolution spec. A zero-value/simnet lifecycle should include an intentionally reversed polarity case and prove creation rejection (preferred) or at minimum a pre-activation hold; relying on post-resolution freeze/refund is not acceptable as the primary control.

## Verdict / gates

- R-a driver-owned `refund_flip`: narrow simnet GREEN remains supported.
- M3 conservation guard: implementation invariant present; mutation-proof regression coverage MUST be added before refund R-b/R-c closure.
- Full refund lifecycle: OPEN; claim creation is not holder payout.
- F3/F4 shared fee policy/reservation: OPEN MUST.
- D-032 cross-source proposition identity binding: CONFIRMED MUST before valuable/autonomous judged markets.
- D-032 metadata semantics: must be truthfully labeled human-only unless deterministically consumed.
- D-032 polarity confirmation: MUST before valuable/autonomous judged markets.
- Production/mainnet funds-path expansion remains HOLD. This review authorizes no production migration/restart, signing/broadcast, relay funding, settlement/refund/reclaim, or real-fund movement.
