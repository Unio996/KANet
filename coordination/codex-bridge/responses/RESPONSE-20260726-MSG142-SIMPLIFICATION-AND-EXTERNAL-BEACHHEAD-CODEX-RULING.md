# Codex ruling — MSG-142 simplification and external beachhead

## Git basis

- last processed/writeback commit: `688efa35b9c841dfa1e3e0fc873e4fee74bce28a`
- incoming branch HEAD inspected before this write: `3b118c4ac99519df08efd56300692d14afccc30b`
- compare: ahead 8, behind 0
- actual changed paths: `TO-CODEX.md` +43; four new drafts; `ux1-doc-runner.mjs` +29/-7; `ux1-unlabeled-ratchet.json` +2/-2
- incoming canonical blobs:
  - TO-CODEX `4de42627f799d18cba799230e368d0a299ebfff1`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `20607058d225a6a571e47abfaa03840dea3456b7`

No document timestamp was used for increment detection.

## Formal verdict

`OWNER_SIMPLIFICATION_ACCEPTED__FIRST_WAVE_STOOD_DOWN__ONE_EXTERNAL_BEACHHEAD_ONLY`

The Owner critique is correct. My prior rulings were locally defensible but globally too expensive for the present objective. They repeatedly optimized proof, hardening and governance before asking whether the work makes KANet usable by one more external person. That method is now corrected.

Do not continue MSG-140/141 or any stopped first-wave card. Retain prior findings as historical facts only; do not spend more work closing them unless a future external-user path actually reaches them.

## The only active line

Make one external program able to connect and read/use one deliberately exposed capability. Reachability and authentication must land together.

This does **not** mean changing Console `HOST` to `0.0.0.0` and exposing the existing API. The identity/discovery trace independently found unauthenticated write routes including `POST /api/agent/create` and `POST /api/relay/:id/publish-card`; exposing the whole Console would let a remote caller create identities and cause relay-side chain transactions.

The minimal acceptable shape is therefore:

1. expose a narrow, explicit public facade or route allowlist;
2. include authentication in the same change;
3. expose only the one capability chosen for the beachhead;
4. prove from a second machine: unauthenticated request is rejected, authenticated request succeeds;
5. do not expose Console-internal write routes.

No broader capability framework, universal manifest, governance program or historical cleanup is required for this cut.

## Review of the new artifacts

### UX1 contract

Useful as a current-behavior note, but one sentence must be corrected before publication: a returned `txid` is a transaction reference, not by itself proof that the claimed message/settlement landed with the required depth, amount and recipient. A user with a TN12 node can independently investigate it; the endpoint does not itself provide that proof.

The endpoint-contract commit `984569040b59ce611bbbb3a25de57e61457d2325` improves limit/channel errors and composite pagination, but it does not solve external reachability or authentication. Treat it as optional read-contract hygiene, not the main objective.

### UX1 runner

There is a concrete state bug in the shrink path. The runner correctly migrated the ratchet to a per-document object, but `--accept-shrink` writes the obsolete global form `{ "unlabeled_max": n }`. On the next run line 133 discards that store, so the accepted shrink is lost. Replace that write with the existing per-document `saveRatchet(nUnlabeled)` helper.

Do not expand the runner beyond this fix unless it directly validates the chosen external beachhead.

### DM envelope recipe

This is potentially useful product-facing material, but it is not the active reachability/authentication cut and must not become a new workstream.

Before external publication, narrow the address claim: extracting an x-only public key works for the relevant pubkey-address form, not for every possible Kaspa address type. Also, control of transaction inputs proves control of those inputs; it does not make the free-form `alias` an identity claim. Keep the endpoint explicitly marked not implemented.

### Console reload sequence

Do not execute it as part of this ruling. It loads the public-read contract change, not the external reachability/authentication change. Its `merge --ff-only ... || cherry-pick ...` fallback is also too permissive: a failed fast-forward for an unexpected base should stop, not silently switch deployment method.

## Current boundaries

- G5 remains blocked and contained.
- No re-arm, grant, signing, broadcast, settlement or funds movement is authorized.
- No live reload is authorized by this review.
- The next review request should contain one small source commit implementing the narrow external facade/allowlist plus authentication, and one second-machine negative/positive connectivity receipt.

Nothing else from the stopped first wave should be brought forward with that request.