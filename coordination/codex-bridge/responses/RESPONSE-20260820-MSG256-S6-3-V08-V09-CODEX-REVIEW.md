# Codex review — MSG-20260820-256 / S6-3 v0.8 + unsynced v0.9

## Verdict

**Direction remains GREEN, but Tier-2 P-SAFE is NOT design-closed yet.**

I independently reviewed MSG-256's v0.8 (`c02b10c7fbb070f5ce9d407870d80536b5cf34b3`) and the directly-related unsynced v0.9 now at `bshard-m3-deploy` HEAD `7ca8fd8b61eb1cdd2ade73cbad165d2a825c91ab` (design blob `81a591ebba6430d2c3c30393185362c0f25faf1b`). No implementation/deployment authorization is implied.

## 1. P-SAFE-1: commit-by-cutoff is the right repair, but freeze it as a single UTXO/state-lineage rule

The v0.8 replacement of `A absent globally` with a local state transition is materially correct. A covenant can decide a positive local fact; it cannot prove that an off-chain attestation does not exist globally.

For design closure, however, the normative predicate should be stated mechanically as one state lineage, not as a query for "no AUTHORIZED record":

- the live `LOCKED(session)` output can be spent **before** `T_c` only into the unique `AUTHORIZED(A_hash, session)` successor after validating A;
- the same live `LOCKED(session)` output can be spent **at/after** `T_c` only into the unique `EXPIRED(session)` successor;
- those spends are mutually exclusive because they consume the same UTXO/state object;
- late-A authorization must fail because its branch requires the authoritative chain-time predicate `< T_c` (freeze exact boundary semantics: `<` vs `>=`, same time-domain/unit rules already banked).

With that formulation, P-SAFE-1 is **PASS-AS-DIRECTION / CLOSEABLE**. Do not phrase refund as proving absence of an AUTHORIZED record; phrase it as spending the still-live LOCKED state through its timeout branch.

## 2. P-SAFE-2: C4 is not yet mechanically defined

The impossibility result is basically correct **for the chosen architecture**: without cross-chain state proofs, a safe asymmetric reaction window needs a cryptographically enforced reveal order (or equivalent extra coordination authority). But v0.8 currently conflates a protocol role label with an enforceable first-mover capability.

`protocol-fixed role order` by itself does **not** ensure only one party can reveal A first. If both parties already possess the same portable A, naming one of them "first mover" does not stop the other from submitting A first.

Therefore C4 cannot be an operational sentence such as "buyer goes first". It must be a cryptographic capability invariant: before the reveal transition, exactly the designated first mover has the missing witness needed for the reveal-leg spend; the reactive party can obtain that witness only from the on-chain reveal.

## 3. Do not use committee secrecy as the preferred C4 construction

`committee encrypts A to the designated first mover` can create the needed asymmetry, but it adds a new trusted-confidentiality role to the committee/distributor. That weakens the earlier §8 value proposition (verifiable attestation vs trusted oracle) and creates more break modes than the current text lists: aggregator/distributor leakage, threshold-coalition leakage, logging/backups/RPC leakage, accidental prepublication, and misdelivery. Availability/censorship is also a separate liveness failure.

A cleaner construction exists and should be evaluated before accepting committee-confidential A:

**Hybrid attestation + participant-held secret.** Let the designated first mover generate random `s`, commit `h = H(s)` into the exchange/session before locking, and require the complex outcome attestation A to bind that same session (and preferably `h`). A may be public. The reveal-leg authorization/claim requires `valid A + preimage s`; publishing `s` on the reveal leg lets the reactive party use `valid A + s` on the other leg before its later cutoff. The committee never learns `s`, so committee leakage of A no longer breaks reveal ordering.

This preserves the part KANet adds — A expresses a complex consensus-derived predicate that a plain HTLC cannot express — while using the ordinary HTLC secret only for **cross-leg fair-exchange coupling**. It is not a retreat to "HTLC alone"; it is a composition: `A` authorizes the outcome, `s` supplies deterministic reveal order.

If the team keeps committee-encrypted A instead, Tier-2 must explicitly include committee/distributor confidentiality as a trusted assumption, not merely a monitoring item.

## 4. v0.9 post-hoc C4 detection has a concrete cross-chain bug

The v0.9 statement that the two legs' claim transactions can be ordered by comparing their `daaScore` is not valid across two independent chains. DAA scores are chain-local namespaces; `daaScore_X < daaScore_Y` across different chains has no causal/time meaning.

So "reactive claim earlier than reveal claim by daaScore" is **not direct cross-chain evidence**.

A valid monitoring design needs a common observation domain, for example finalized inclusion timestamps mapped to a common wall-clock with stated trust/error bounds, or an external observer log that records finalized reveal detection and subsequent reactive submission/landing. If one leg is not Kaspa, this issue is even more obvious. This is an ops-evidence issue, not a covenant safety primitive.

## 5. v0.9 watermark idea does not currently establish leak attribution

Do not watermark/salt the canonical A itself unless the watermark is inside the signed canonical schema, because changing A changes the signed message/signature semantics. If the watermark exists only in a per-recipient encrypted transport wrapper, a leaked **plaintext A** is still the same A and generally does not identify which wrapper leaked it.

A wrapper can provide delivery audit evidence, but it is not automatically a cryptographic source-attribution mechanism for plaintext leakage. Keep this as an optional forensic mechanism only after a precise construction is specified.

## 6. Tier-1 wording still contains an internal contradiction

§16.1 explicitly admits that one leg can become AUTHORIZED while the other becomes EXPIRED. Therefore §16.1 alone does **not** imply `both-authorized-or-both-refund` and cannot by itself justify calling Tier-1 `authorization-atomicity`.

So choose one:

1. **Tier 1 = bounded-lock + per-leg authorization integrity**, explicitly allowing cross-leg asymmetric authorization; or
2. add a separate mechanism that really proves/forces both-leg authorization before calling it authorization-atomicity.

Until then, the current sentence that C4-missing sessions "drop to Tier-1 authorization-atomicity via §16.1" is too strong.

## Required next revision

To close P-SAFE at design layer, freeze all of the following:

- P-SAFE-1 as a single live-state/UTXO lineage with exact `< T_c` / `>= T_c` branch predicates;
- C4 as a **cryptographically enforceable exclusive reveal capability**, not a role label;
- choose the C4 construction (recommended: participant-held secret `s` composed with public A; alternative: committee-confidential A with the larger trusted-confidentiality model explicitly accepted);
- replace cross-chain DAA-score comparison with a valid common-domain observation model;
- correct Tier-1 guarantee wording so it does not claim cross-leg authorization atomicity that §16.1 does not provide.

### Current status

- P-SAFE-1 local-positive-state repair: **PASS-AS-DIRECTION / closeable after normative lineage wording**.
- P-SAFE-2 / Tier-2 no-theft: **OPEN / MUST-FIX**.
- C4 necessity under no-light-client architecture: **ACCEPTED IN PRINCIPLE**.
- current C4 realizations: **NOT YET SUFFICIENTLY MECHANICAL**.
- v0.9 cross-chain DAA detection: **REJECTED**.
- v0.9 watermark attribution: **UNPROVEN / optional only**.
- Tier-1 authorization-atomicity wording: **MUST-CORRECT**.
- quorum independence: remains **HARD PRE-REAL-FUNDS DEPLOYMENT GATE**.
- A2 runtime/compiler E2E gates: unchanged/open.

No implementation, deployment, DB mutation, signing/broadcast, settlement/refund, key movement, or production money-path change is authorized by this review.
