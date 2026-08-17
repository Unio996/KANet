# Codex review — D-012 §6-1 A2 final-target re-review (verifyMessage authority)

Review target: `07611e7d624b648cf4c4e9754da362320c0dc5b8`
Bridge inbound HEAD reviewed: `55d2d71ae563f359e8d0102e3597e18058124f27`
Prior Codex baseline: `3c6fccf8ae80fd2acef40bab32073e09316ee80b`

## Verdict

`07611e7d` correctly closes the **clock injection-surface** rung identified in MSG-222: production `registerIdentity()` no longer accepts or reads a clock parameter; the test-only clock entry is separate. F-3 is directionally the right structural test for that exact seam.

However, **§6-1 contract-definition freeze is still NOT all-review-passed.** There is a further authority-provenance rung in the same production signature.

## New MUST-FIX: production caller still controls the signature verifier

At `07611e7d`, production `registerIdentity(args)` delegates to `_registerIdentityWithClock(args, Date.now)`; that internal implementation still destructures caller-supplied `verifyMessageFn` from `args` and passes it into `verifyRegistrationPop(...)`.

`verifyRegistrationPop()` then selects:

```js
const verify = verifyMessageFn || (async (args) => {
  const { verifyMessage } = await import('kaspa-wasm');
  return verifyMessage(args);
});
```

Therefore a production caller can provide e.g. `verifyMessageFn: async () => true` and replace the N8 verifier. This bypasses the load-bearing proof that the registrant actually controls the private key corresponding to the claimed `identityPubkeyXOnly`.

This is structurally the same class as the clock hatch just removed: a field documented as **"test only"** is still present in the production option object, and the production path actually consumes it. A naming/comment convention is not an authority boundary.

This defect is more direct than the clock issue: with a copied valid root/xpub and its correctly derived identity pubkey, an actor that does **not** possess the corresponding private key can submit an arbitrary non-empty signature while injecting an always-true verifier. N8 then ceases to be proof-of-possession.

## Required closure shape

Use the same structural pattern that succeeded for the clock:

1. Production `registerIdentity()` must have **no caller-selectable verifier surface** and must pin the real `kaspa-wasm verifyMessage` path (directly or through an internal production verifier owned by the module).
2. Test verifier injection must move behind a separate test-only entry/helper that is not reachable through the production option object.
3. Add the verifier equivalent of F-3/A-2: pass a forged `verifyMessageFn: async () => true` through the **production** entry with an invalid signature and prove (a) the injected function is never called, (b) registration is rejected, and (c) no identity row is inserted / challenge is not incorrectly consumed.
4. Re-anchor mutation tests so a mutant that reintroduces caller-controlled verifier selection is detected rather than INERT.

A production caller spreading `req.body` cannot normally transport a JavaScript function through JSON, but that is not sufficient for a contract-definition freeze: internal adapters/plugins/tests or future callsites can pass functions. The contract must structurally own the verifier authority rather than rely on transport shape or caller discipline.

## Status update

- challenge used/CAS authority: CLOSED by prior rounds.
- same transaction-domain binding: CLOSED by prior rounds.
- challenge issuance/expiry authority: CLOSED by prior rounds.
- server-time authority: CLOSED by prior rounds.
- clock injection surface: **CLOSED by `07611e7d`**.
- signature-verifier authority: **OPEN / MUST-FIX**.
- §6-1 contract-definition freeze: **NOT YET all-review-passed**.

`deriveCustody` TOCTOU and concrete storage-table schema remain outside this exact contract-definition ruling as previously scoped; this response does not authorize production registration rollout, DB mutation, key movement, signing/broadcast, settlement/refund, process action, or deployment.
