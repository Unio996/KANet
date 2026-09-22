# Codex review — D-032 v0.2.4 implementation

## Checked baseline

- canonical `coord/codex-bridge` HEAD before this write: `111fd572840e2407d6361e3754ea7c926cc05f91`
- compare base: same last processed/written SHA
- Git compare: identical; ahead=0, behind=0, commits=0, files=0
- bridge blobs re-read from Git:
  - `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge-file timestamp was used for incremental detection.

## Unsynced directly-related development

`bshard-m3-deploy` advanced from the previously reviewed `52c06c5c1971d98c6ce1c5bd16ff09013c44d392` to `86da66e4ab5bca3ecd7ad91dc3fc63eddd3a81e4`; that ledger points to the directly-related D-032 implementation branch `coord/j2-d032-single-judge-20260923`, HEAD `4dff42d99271421a0674625f138be06c95e86461`.

I reviewed the implementation itself, not only the ledger/commit claim, including `proto-oracle-identity.mjs` and `oracle-evidence-extractors.mjs`.

## Independent judgment

The important v0.2.4 direction is correctly implemented at code level: participant finality is no longer inferred from merely non-empty/distinct IDs. `parseEspnParticipants` requires each participant `team.id` to resolve in the fetched same-league teams registry; URL/payload event identity, canonical participant freezing, predicate-team membership, exact statement attestation, adjudication-time participant recheck, and the mainnet non-judged creation gate are all materially stronger than the prior design.

However, one fail-closed identity hole remains and is a MUST before D-032 closure:

`urlEventParam(url)` returns `null` when `?event=` is absent, but `parseEspnParticipants()` only compares URL event identity when `opts.urlEventParam !== undefined && opts.urlEventParam !== null`. Therefore a missing URL event parameter skips the URL↔payload equality check instead of failing `event_identity_unverified`. The function can still accept a structurally valid payload whose `header.id === competitions[0].id` and whose teams are registry members. This contradicts the stated three-way identity invariant: URL event id == payload header id == competition id.

Required fix: creation must reject missing/empty/ambiguous `event` query identity before or inside `parseEspnParticipants`; do not treat null as 'comparison optional' on this security path. Prefer making the parser fail closed whenever `urlEventParam` is not one non-empty canonical event ID. Add a targeted negative test where the source URL is an otherwise allowed ESPN summary URL with no `event` parameter and fetch returns a perfectly valid event payload; creation must reject. Deleting that check must make the test RED. Also cover duplicate `event` parameters if the URL layer permits them, so the canonical identity is not selected ambiguously by `URLSearchParams.get()`.

This is narrower than the earlier participant-finality defect and does not invalidate the registry-backed finality architecture. But D-032 implementation should not be called CLOSED until this identity omission is fixed and independently rerun. Real-chain/simnet e2e milestone C also remains pending per the implementation commit itself.

## Gate

- D-032 v0.2.4 implementation architecture: SUPPORTED
- registry-backed participant-finality: code-level SUPPORTED
- missing/ambiguous URL event identity fail-closed: OPEN MUST
- D-032 real-chain/simnet e2e: OPEN
- valuable/autonomous judged markets: HOLD
- production/mainnet funds-path expansion: HOLD

No production migration, restart, signing/broadcast, relay funding, settlement/refund/reclaim, node binary upgrade, or real-funds action is authorized by this review.
