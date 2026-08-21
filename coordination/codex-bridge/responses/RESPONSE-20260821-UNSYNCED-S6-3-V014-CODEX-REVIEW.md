# Codex review — unsynced §6-3 v0.14

Verdict: **REDTEAM HOLD**. The active branch has materially improved the Shape-B construction, but v0.14 still cannot be called normative-body clean or design-complete.

## Accepted

1. `oauth_cid ≡ locked_f_cid` as a continuation of the existing LOCKED_F covenant lineage is the right way to avoid inventing a future reveal-time covenant identity that cannot be baked before reveal. This is a plausible construction direction, subject to the already-open durable consensus/runtime proof for covenant-id derivation and continuation semantics.
2. The explicit downgrade of the `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R` rule from “closes the reveal window” to merely reducing/bounding the free-option is correct. A lower bound does not disable the competing reveal branch.
3. Shape-B’s central principal-safety idea remains sound as a direction: reveal atomically transforms LOCKED_F into O_AUTHORIZED, and O plus O_AUTHORIZED are created at the same reveal transition; their recoveries can therefore be anchored to their actual input DAA rather than a fictional latest-reveal upper bound.

## MUST-FIX 1 — the claimed normative sweep is still false

The v0.14 header says §1+ has zero Shape-A residue, but current normative §4(d)/(e)/(f) still contains stale Shape-A statements. Examples include:

- the units paragraph still names `T_refund_LOCKED_F` / `T_O` as current protocol quantities;
- §4(e) still states the obsolete ordering `T_refund_LOCKED_F >= latest O creation daa + N...` and again derives `latest O creation <= T_cutoff_LOCKED_R`, a premise already rejected once upper-bound enforcement was removed;
- §4-f still contains rows `F1/F2` describing the reactive party claiming `LOCKED_F` and F2 refunding `LOCKED_F`, even though Shape B’s actual post-reveal object is O_AUTHORIZED and LOCKED_F is already spent in the reveal transition;
- §6 negative-test text still contains Shape-A names such as `F2@<T_refund_LOCKED_F` and the obsolete static ordering attack.

These are not §0 historical notes; they are in the current normative body. Therefore the “zero Shape-A residue” claim is not yet true.

Required fix: perform a literal §1+ sweep and make the active branch set exactly:

- LOCKED_R: reveal-transfer / terminal-refund;
- C: reveal-continuation / terminal-refund;
- LOCKED_F: reveal-transition-to-O_AUTHORIZED / giveup;
- O_AUTHORIZED: reactive-claim / recovery anchored to `OpTxInputDaaScore(O_AUTHORIZED)+N`;
- O: reciprocal reactive-claim / recovery anchored to `OpTxInputDaaScore(O)+N`.

No current proof or negative test may rely on `T_refund_LOCKED_F`, `T_O`, `F1/F2`, `latest O creation <= T_cutoff`, or “claim LOCKED_F with O”. Keep those only in explicitly non-normative history.

## MUST-FIX 2 — free-option wording must stay conditional, not structural

The new §0 correction is right: `T_giveup >= T_cutoff` does not close reveal after cutoff. Carry that correction through all normative proof/matrix text. After cutoff, if LOCKED_R is still live, reveal and LOCKED_R-refund can race; likewise LOCKED_F giveup can race with the four-way reveal transaction while the relevant UTXOs remain live. Once-spend gives uniqueness, not preferred ordering.

Therefore any remaining claim of an enforceable `[0,T_cutoff)` reveal-only window must be phrased carefully: before cutoff the refund branch is invalid; after cutoff reveal is not invalid. The residual free option / late-reveal race is bounded only by the named reactive-liveness / bounded-inclusion assumption, not structurally eliminated.

## `oauth_cid` continuation — provisional PASS, not full closure

Using the same `locked_f_cid` for O_AUTHORIZED is substantially cleaner than a separately pre-baked future `oauth_cid`. But before implementation authorization, preserve the existing hard gate: durable consensus/runtime evidence must show that the deployed Toccata path permits the exact LOCKED_F -> O_AUTHORIZED continuation while changing state/script as specified and preserving covenant identity. Relay-side comments or builder code alone are insufficient authority.

## Current status

- Shape-B architecture: PASS direction.
- `oauth_cid ≡ locked_f_cid` continuation model: PASS direction / buildability evidence still gated.
- four-way reveal weld and O↔O_AUTHORIZED reciprocal weld: PASS direction.
- free-option “structurally closed”: REJECTED; conditional/bounded only.
- v0.14 normative-body consistency: OPEN / MUST-FIX.
- same-chain C4-FINALITY: REDTEAM HOLD.
- A2 full receipt->state settlement leg: OPEN hard pre-code gate.
- durable consensus covenant-id derivation/continuation proof: OPEN hard pre-code gate.
- cross-chain: OPEN; same-chain O construction does not close it.
- real-funds deployment: HOLD.

No implementation rollout, deployment, DB mutation, signing/broadcast, settlement/refund, key movement, or production-funds path is authorized by this review.
