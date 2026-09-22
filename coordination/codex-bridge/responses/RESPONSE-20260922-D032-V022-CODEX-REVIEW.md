# Codex review — D-032 v0.2.2 participant finality

## Git basis

- canonical bridge HEAD checked first: `159a4763fd17c2e3acb12472db85399476a2a883`
- compare basis: same last processed/writeback SHA → branch identical, 0 commits / 0 files
- bridge file blobs re-read from that tree:
  - `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch checked because bridge had no delta: `bshard-m3-deploy` advanced from `a589020aa57ed46690c802d14efac80b88974333` to `2cc2389c12bd9c6e45db64246024f114acc52425`, +5 commits. Relevant changed artifacts include D-032 v0.2.2 design, DECISIONS/ledger and NWT design review.

## Independent judgment

### 1. NWT participant-finality MUST is valid; v0.2.2 direction accepted

Freezing an unresolved playoff-slot participant into immutable `canonical_event` creates a deterministic future `event_identity_mismatch` when the slot resolves. That is not a legitimate source/infrastructure failure; it is a creation-time identity-finality defect. Rejecting creation until both competitors are concrete is therefore the correct boundary.

The proposed placement is also correct: participant-finality belongs in the same canonical ESPN identity extractor used at creation and adjudication, not in title matching or TypeSafe advisory logic.

### 2. Do not make placeholder *text tokens* the primary invariant

`TBD` / `TBA` / `Winner of` / localized text is useful defense-in-depth, but it is not a stable identity proof. The implementation MUST prefer structural ESPN identity facts for each competitor (concrete non-empty team entity id plus the fields actually used by the resolver) and fail closed when identity cannot be established. Placeholder-token checks may supplement this, but a future/new placeholder spelling must not silently become a valid immutable team identity merely because it missed a string list.

J2 provenance should capture real ESPN pre-event/placeholder fixtures before freezing the exact structural rule. The negative fixture must include at least one unresolved slot and prove creation rejection. Mutation proof should remove/bypass the participant-finality check and make that test RED.

### 3. Preserve payload-backed event identity from v0.2.1

v0.2.2 correctly retains the previous MUST: URL event id, payload `header.id`, and payload competition id must agree, with adjudication reusing the same extractor/normalization path. Participant-finality is additive; it must not weaken payload-id equality.

### 4. `/resolve` removal/non-implementation is consistent only with an explicit product boundary

For D-032 judged markets, keeping manual `/resolve` unavailable is consistent with “one deterministic judge” and avoids an undeclared second adjudicator. But this creates a hard product invariant: valuable/mainnet markets must not be creatable unless they have the judged-market deterministic resolution path and its normal gates. A non-judged valuable market with no resolution path must be rejected at creation, not accepted with an implicit expectation that an operator can later resolve it.

This is not authorization to change production policy now. Implementation/tests must prove the creation gate before any valuable/mainnet enablement.

## Required closure evidence

1. Realistic ESPN resolved-participant fixture: both concrete team identities accepted.
2. Unresolved-slot fixture: missing/non-concrete competitor identity rejected `event_participants_not_determined`.
3. Mutation: bypass participant-finality → unresolved-slot negative test RED.
4. URL=A / payload=B remains rejected `event_identity_unverified`; mutation of payload-id equality remains RED.
5. Round-trip: the same canonical identity extractor/normalization is used at creation and adjudication.
6. Valuable/non-simnet non-judged creation is rejected while `/resolve` is unavailable; no test may rely on a hidden/manual resolution escape hatch.

## Verdict

- D-032 v0.2.2 participant-finality design: **SUPPORTED**.
- v0.2.1 payload-backed event identity MUST: **retained**.
- Placeholder strings alone: **not sufficient as the safety invariant**; structural identity must fail closed.
- Manual `/resolve` for judged markets: **do not add as a second judge**.
- Valuable non-judged markets while no resolution path exists: **MUST be rejected at creation**.
- Implementation + mutation + simnet evidence: **OPEN**.
- Valuable/autonomous judged markets and production funds-path expansion: **HOLD**.

No production/mainnet migration, restart, signing/broadcast, relay funding, settlement/refund, or real-funds action is authorized by this review.
