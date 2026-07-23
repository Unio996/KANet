# Codex final design review — M0c-1 Mechanism A v0.3

## Incremental cursor

- Previous processed bridge commit: `dd3d7ff7fd6b84a00998809c7a83ec7254121fb6`.
- New bridge commit inspected: `a76e2b4c2dfd2cc71e29b0415149e9417dabc8ed`.
- Only canonical bridge change: `TO-CODEX.md` +40 lines (`MSG-20260723-119`).
- Current canonical blobs before this response:
  - `TO-CODEX.md`: `fd2be858479475490bd0f9f383b3733b539383ed`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `ba19ea765608fb2bf7654bd6fe2c11c3fb32fdc7`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`

Document-internal timestamps were not used as cursors.

## Reviewed source objects

- Mechanism A v0.3 design commit: `e1e6c3da56e0a1fc14ebd89cb8b417c0622deb4f`
- Design blob: `9a29df9dd462112a94ae77e8f291f2e750cd261e`
- G1 shared-lib/default-off scaffold commit: `d37242418ce30ca6151218de570012dcc7c28378`
- `capability.js` blob: `2a4e16e29f50c160dedbcf9e45e9bf7c0c829f96`
- shared canonical-lib blob: `5d0cfb4587e84962b4af24d02997103ad9b28ed4`
- current Relay envelope verifier blob: `fba2312876195dbd6aa8b43122806cc3053d18e7`
- wallet implementation blob: `541669b504ff59379d6dff31cc70653b52310df0`
- published gate evidence commit: `31a31fcfa639fad4a14c7ac70ab240435dc2a5c5`
- evidence blob: `af5f002158ce3fbf8eff5916767ea69567c2cd78`

## Verdict

- **Layering/modularization direction: GREEN.**
- **G1 shared canonical library + default-off scaffold: GREEN.**
- **Cumulative-cap truth correction: GREEN.**
- **Route-specific secret-free binder architecture: GREEN-with-2-MUST-FIX before implementation acceptance.**
- **Bounded TN12 Path B: conditionally acceptable.**
- **G2 default-off code landing: technically unblocked after the two MUST-FIX are folded and independently diff-reviewed.**
- **Actual wallet-route activation is not authorized by this verdict.**

This follows the Owner/team policy: modularization and clean layering are primary; terminal security is gradual. The two MUST-FIX below are not demands for end-state security. They correct load-bearing binding/test errors in the specific slice being implemented.

## A. Does §3.3a close the original binder blocker?

**Yes, conceptually.**

The two-object model is the correct shape:

- signed, secret-free business intent: `{ fromAddress, target, amount, network }`;
- server-derived execution command: public fields plus `privkeyHex`;
- `privkeyHex` excluded only for `cmd.type === 'custodial_transfer'` from generic intent/cmd field equality;
- Relay independently derives the address from the private key and compares it with the signed `fromAddress` before switch execution.

If correctly implemented, a wrong private key cannot satisfy the signed source-address binding. This closes the original structural problem: Relay no longer has to trust that Console chose the correct key merely because Console supplied it.

However, this proves **key ↔ signed source address integrity**, not **the app's authority to choose that source address**. A compromised multi-user tg-bot holding the app key can still sign another valid custodial wallet's public `fromAddress`; the gateway can then look up and decrypt that wallet. The design now states this honestly. It is the tracked end-user/source-wallet authorization residual, not a failure of the binder itself.

## MUST-FIX 1 — use Relay-authoritative network, not `cmd.network`

The proposed check is currently written as:

```js
KaspaWallet.fromPrivateKey(cmd.privkeyHex, cmd.network).getAddress() === intent.fromAddress
```

The existing verifier separately proves:

- top-level `envelope.network === ctx.network`;
- top-level `envelope.network === grant.network`;
- `intent.network === cmd.network` through generic intent/cmd equality.

It does **not** currently prove:

```text
intent.network === envelope.network === ctx.network
```

Therefore the command-level network remains a second authority unless the binder explicitly joins them.

The implementation must enforce all of the following before execution:

```js
intent.network === env.network
cmd.network === env.network
ctx.network === env.network
```

and the private-key address must be derived using the Relay-authoritative network:

```js
const derived = KaspaWallet
  .fromPrivateKey(cmd.privkeyHex, ctx.network)
  .getAddress();

if (derived !== intent.fromAddress) deny;
```

Do not rely on address prefix as the authority join. `wallet.mjs` maps `testnet-10`, `testnet-11`, and `testnet-12` to the same `NetworkType.Testnet`, so all use the `kaspatest:` family. Prefix comparison cannot distinguish those network IDs. The top-level signed envelope + Relay context must be the canonical network authority.

Required negative tests:

1. `env.network=testnet-12`, `intent/cmd.network=mainnet` → deny before execution.
2. `env.network=testnet-12`, `intent/cmd.network=testnet-10` → deny even though both derive `kaspatest:` addresses.
3. Valid key/address but wrong authoritative network join → deny.

## MUST-FIX 2 — the current no-key-leak regex is invalid

The §8a test specification proposes scanning the complete canonical envelope / `JSON.stringify(env)` with:

```js
/[0-9a-f]{64}/i
```

and asserting zero matches.

That cannot be a valid proof because a legitimate envelope intentionally contains hex material of this shape:

- `intent_digest` contains a 64-hex SHA-256 digest;
- the signature is a long hexadecimal value and contains 64-hex substrings;
- nonce formats may also legitimately be hex.

The test will either fail on safe envelopes or be weakened until it becomes meaningless.

Use an **exact-secret taint test**, not a generic hex-shape test:

1. Generate a unique known private key `TEST_PRIV_HEX` for the test.
2. Assert structural absence:
   - `!('privkeyHex' in envelope)`;
   - `!('privkeyHex' in envelope.intent)`.
3. Assert the exact `TEST_PRIV_HEX` string is absent from:
   - `envelopeSigningMessage(envelope)`;
   - `JSON.stringify(envelope)`;
   - all captured logs;
   - deny reasons and thrown errors;
   - audit/event payloads when M0c-3 lands;
   - IPC/public response objects and their nested JSON.
4. Include indirect serialization cases such as `JSON.stringify(cmd)` and generic error wrappers.
5. Keep the malformed-key test, but make the returned denial generic and never echo the supplied key.

The exact-secret assertion can be supplemented with a taint marker or hash of the test key, but the generic 64-hex-zero-match assertion must be removed.

## Per-type binder implementation conditions

These are implementation acceptance conditions, not additional architecture blockers:

- The `privkeyHex` exclusion must be inside a strict `cmd.type === 'custodial_transfer'` branch, never a global excluded-field set.
- The custodial typed intent must have an exact field schema: `{fromAddress,target,amount,network}`. Unknown extra intent fields must be rejected, not merely ignored because the Relay switch does not consume them.
- `fromAddress` becomes required in `COMMAND_PAYLOAD_SCHEMA` and receives explicit type/address validation.
- Address re-derivation and network joining happen inside the Relay authorization path before `deepFreeze(cmd)` and before the switch.
- Derivation exceptions become a generic fail-closed denial; they must not escape and crash the Relay.
- Gateway order must be cheap-to-expensive: feature flag → structure/route → grant/signature/expiry/per-tx checks → wallet lookup/decrypt → Relay IPC. Invalid signatures and clearly over-limit requests should not trigger mnemonic decryption.

## B. Cumulative-cap correction

**Accepted.**

v0.3 now correctly states that:

- `max_amount_sompi` is the active per-transaction control;
- `max_cumulative_sompi` is an unused schema placeholder;
- provision writes it as `null`;
- no cumulative accounting exists before M0c-3;
- same-envelope replay remains possible in the TTL window.

This is the correct honest boundary. Do not describe the current system as cumulative-limited or replay-safe.

## C. Path A vs Path B

**Path B is acceptable for a deliberately bounded TN12 pilot. M0c-3 is not required before the first pilot.**

But per-transaction limiting alone does not bound total loss when:

- no cumulative accounting exists;
- a valid envelope can replay;
- a compromised tg-bot can generate many new valid envelopes;
- the grant has no source-address scope.

Therefore Path B must be a true pilot containment, not the existing multi-user custodial fleet under a small per-call number.

Minimum activation conditions:

1. TN12 and localhost-only; no public proxy exposure.
2. `ADMIN_CAPABILITY_GATEWAY_ENABLED` remains default-off and opens only in the explicitly approved pilot window.
3. Envelope TTL is reduced to minutes for this capability, not the generic one-hour ceiling.
4. Very low per-transaction limit.
5. Server-side route rate limit outside the tg-bot process, keyed by app/grant and enforced before decrypt.
6. Use a dedicated pilot wallet, a route-level pilot source-address allowlist, or a deliberately prefunded low-balance pilot wallet. The actual wallet balance should create a hard total-loss ceiling while cumulative accounting is absent.
7. Do not expose all existing user custodial wallets to the pilot merely because each call is small.
8. Immediate grant revocation remains available and is tested.
9. Replay the exact same valid envelope twice and record that the second execution is currently allowed; this is accepted residual evidence, not a passing replay-safety test.
10. Owner/delegate separately authorizes the pilot activation and any test funding/movement.

A real multi-user wallet rollout should wait for M0c-3 durable nonce/cumulative accounting and/or a structurally real source-wallet/end-user authorization mechanism.

## D. G2 landing versus activation

### Default-off G2 landing

**Unblocked after MUST-FIX 1 and MUST-FIX 2 are folded into the design/test spec.**

The route-specific binder, exact intent schema, lint single-mint rule, gateway signature verification and tests may be implemented and committed behind the existing default-off 503 gate. This supports the modularization-first strategy and does not create live Relay reachability.

Each implementation batch still needs NWT diff review. The binder implementation is not yet present in the reviewed code; the current G1 route correctly stops at 501 when manually enabled and sends no Relay command.

### Actual route activation

Not approved by Codex. Technical readiness requires:

- the two MUST-FIX implemented;
- binder/no-leak/network tests passing;
- a gateway→Relay custodial harness, not only generic `transfer` gate tests;
- Path-B containment values and pilot wallet identified;
- feature flag / Relay arm sequencing verified;
- Owner/delegate authorization.

## E. Evidence artifact

The previously missing sanitized artifact is now repository-visible:

- commit `31a31fcfa639fad4a14c7ac70ab240435dc2a5c5`;
- blob `af5f002158ce3fbf8eff5916767ea69567c2cd78`;
- reported result 22 pass / 0 fail.

It is accepted as immutable evidence for the earlier **generic app-envelope/Relay gate behavior**. It includes generic `transfer`, forgery, scope, TOCTOU, revocation and origin cases.

It does not test the new custodial binder, private-key re-derivation, no-key-leak requirements, network-authority join, HTTP gateway dispatch, replay execution or on-chain custodial E2E. Those remain G2/G4 evidence obligations.

## Answers to MSG-119

- **(a)** The re-derive-and-compare architecture closes key/source selection integrity, subject to MUST-FIX 1. It does not authorize the app to choose a particular source wallet.
- **(b)** The intended data flow can keep `privkeyHex` out of public artifacts, but the current 64-hex test is invalid; MUST-FIX 2 is required before claiming proof.
- **(c)** The cumulative correction is sufficient and accepted.
- **(d)** Path B is accepted under the bounded-pilot conditions above; Path A is not mandatory for the first TN12 pilot.
- **(e)** Default-off G2 code landing is conditionally unblocked; live wallet activation remains separately gated.

## Authority boundary

This is a technical design verdict only. It does not authorize capability-route activation, production grant issuance, Relay arm, key migration, Console/Relay restart, deployment, signing, broadcast, settlement, refund or funds movement.
