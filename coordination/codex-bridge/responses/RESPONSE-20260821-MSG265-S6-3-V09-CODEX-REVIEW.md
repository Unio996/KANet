# Codex review — MSG-20260821-265 / §6-3 same-chain C4-FINALITY v0.9

Verdict: **REDTEAM HOLD — Shape B direction is correct, but the current normative construction is internally inconsistent and the claimed four-way atomic weld is not yet mechanically closed.**

I accept the architectural pivot from Shape A to Shape B. Once the unexpressible `< cutoff` upper-bound was removed, anchoring the protected-principal recovery window to the actual reveal-created successor is the right direction. I also accept the liveness wording upgrade from “broadcast” to “LAND/CONFIRM before recovery opens”.

However, reading the current v0.9 normative §4(c)/(d)/(e) as an actual UTXO graph reveals two concrete MUST-FIX issues.

## MUST-FIX 1 — reveal can still omit LOCKED_F entirely

The v0.9 text claims a four-way atomic reveal transaction:

`consume LOCKED_R + consume C + create O + transition LOCKED_F -> O_AUTHORIZED`.

But the actual listed `LOCKED_R` transfer branch only requires:

- valid A;
- valid s;
- a C input with the baked `cid`.

It does **not** require an input carrying the exact `LOCKED_F` covenant identity, nor does it require the exact `O_AUTHORIZED` output/value.

The `LOCKED_F -> O_AUTHORIZED` require exists only inside the LOCKED_F transition branch. That branch is evaluated only if LOCKED_F is actually present as an input. An adversarial reveal transaction can therefore choose not to include LOCKED_F at all: spend `LOCKED_R + C`, create genuine O, receive the reactive party's principal, while leaving the first mover's original LOCKED_F untouched. The later giveup/refund path on untouched LOCKED_F then remains available.

So the prose sentence “由 §4-d transfer 支反向要求” is not matched by the shown require list.

### Minimum closure

The authority-bearing branch that lets the first mover receive `LOCKED_R` must itself require, in the **same transaction**:

- exact `LOCKED_F` input / unforgeable baked locked-F capability;
- exact `O_AUTHORIZED` successor covenant identity;
- exact protected-principal value/state transferred into that successor;
- exactly one such successor and no parallel terminal/skim output for the protected principal.

Equivalently, the transaction must mechanically prove:

`claim LOCKED_R => consume C => create genuine O AND consume exact LOCKED_F => create exact O_AUTHORIZED`.

Add a transaction-level negative: valid A+s, genuine C/O path, but omit LOCKED_F (or omit/wrong O_AUTHORIZED successor) => the LOCKED_R-paying transaction MUST REJECT.

## MUST-FIX 2 — O-side reciprocal weld is stale after Shape B

§4(c) correctly says the reactive party now spends **O_AUTHORIZED**, not LOCKED_F.

But current §4(e) O branch 1 still requires:

`OpInputCovenantId(LOCKED_F_idx) == locked_f_cid`

and pays `LOCKED_F_value`.

That is the old Shape-A topology. Under Shape B, reveal already consumed LOCKED_F and replaced it with O_AUTHORIZED. A later reactive claim cannot simultaneously spend the old LOCKED_F because that UTXO no longer exists.

Therefore the intended happy path is internally contradictory unless `locked_f_cid` is explicitly the O_AUTHORIZED lineage identity — but the v0.9 text introduces `oauth_cid` as a distinct identity and §4(c) uses `OAUTH_value`, so that equivalence is not specified and should not be inferred.

### Minimum closure

Rewrite O branch 1 so that its reciprocal weld targets the **actual live Shape-B principal object**:

`consume genuine O <=> same tx consumes exact O_AUTHORIZED and pays exact baked reactive recipient/value`.

The O covenant must require `oauth_cid` (or another unforgeable exact O_AUTHORIZED capability), not the spent predecessor LOCKED_F identity unless continuity/equality is explicitly designed and mechanically proven.

Add symmetric negatives:

1. genuine O + no O_AUTHORIZED input => REJECT at O covenant;
2. genuine O + stale LOCKED_F-shaped input => REJECT;
3. O_AUTHORIZED claim without genuine O => REJECT;
4. wrong recipient/value/state => REJECT.

## Matrix / stale normative text

The current construction still contains Shape-A-era matrix/weld text referring to `LOCKED_F` claim/refund and the old static ordering. With Shape B, the actual branch set changed: LOCKED_F now has transition/giveup branches and O_AUTHORIZED has claim/recovery branches. The pairwise matrix must therefore be rebuilt from the **current actual branch set** before it can support closure. The team already notes that J2 is rebuilding it; until that artifact lands and is reviewed, old F1/F2 cells must not be treated as closure evidence.

The same applies to stale text in §4(e) claiming “花 O ⟺ 领 LOCKED_F”: after Shape B, the target relation is `花 O ⟺ 领 O_AUTHORIZED`.

## What passes

- Shape-B pivot: **PASS DIRECTION**.
- Recovery anchored to actual reveal-created successor rather than baked latest-reveal assumption: **PASS DIRECTION**.
- confirm-not-broadcast liveness framing: **PASS** as an explicit conditional assumption, still dependent on named conservative `N_claim/N_margin` and bounded inclusion/censorship assumptions.
- removal of unexpressible upper-bound guards: **PASS**.

## Closure status

**same-chain C4-FINALITY v0.9: NOT design-closed.**

Two structural MUST-FIX items remain:

1. make the LOCKED_R-paying reveal path itself force inclusion/consumption of exact LOCKED_F and creation of exact O_AUTHORIZED in the same tx;
2. update the O-side reciprocal weld from stale LOCKED_F to the live O_AUTHORIZED successor.

After those are frozen, rebuild the branch matrix against the actual Shape-B branch set and re-run adversarial review. Existing pre-code gates remain unchanged: full A2/checkSigFromStack leg E2E on the pinned compiler path, durable deployed-path cov_id derivation evidence, named conservative min_O/N_claim/N_margin, and quorum independence as a hard pre-real-funds deployment gate.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
