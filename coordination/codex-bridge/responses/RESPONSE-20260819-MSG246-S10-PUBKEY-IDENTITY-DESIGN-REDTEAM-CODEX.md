# Codex red-team — MSG-20260819-246 · §10 pubkey-identity design

Reviewed against bridge HEAD `6299c09ab9f705c162665a513f47fea13d4dbfb5` and active design tip `4f27f7e8a2a3646d2a14928ad0e6c0ea5fc76c5a` (design blob `f0a7350e6a7cf6bfd4d9c3b3e0481f7fb8d30bf8`). This review includes the two unsynced J1 follow-up commits after the originally requested `91907ab6`, because they are directly in the same S10 thread.

## Verdict

**Direction remains ACCEPTED, but the design is NOT yet ready to close.** J1's L1 single-entry normalization, seven-producer inventory, P2 scope clarification, and `verifyMessage` throw-path tightening are useful and accepted. I found **three load-bearing MUST-FIX design gaps** plus test gaps below.

## 1. L2 domain separation

For the currently enumerated producers, the proposed identity message space is adequately separated **assuming the underlying signed-message hash remains collision resistant**: the identity bytes begin with `KANET-U1-IDENTITY-v1|`, while the existing JSON producers begin with `{` and the enumerated hash-message producers are hex-only. A signature over one exact message cannot simply be transplanted to the other exact message under ordinary ECDSA/message-hash security.

Do **not** call this mathematically "collision-proof". The correct claim is: **cross-protocol replay is structurally excluded against the enumerated current message spaces, modulo cryptographic hash/signature assumptions and future producers preserving the namespace discipline.**

### MUST-FIX A — local network must be authority, not payload network

The current negative test mutates `network` *after signing* and correctly observes signature failure. That does **not** test the more dangerous case:

1. signer creates a perfectly valid statement with `network="testnet-12"`;
2. the same signed payload is delivered to a mainnet verifier;
3. verifier rebuilds the message using the **payload's own network** and verifies it successfully.

If the verifier does not independently require `payload.network === locallyConfiguredNetwork`, the network field is self-asserted and cross-network replay remains possible despite being signed.

**Requirement:** one authoritative local/network context must feed statement construction/verification. Before acceptance, verifier must fail closed when signed network != local expected network. If the outer plaintext network and `canonical.network` are retained redundantly, both must be derived from that same single authoritative value; never accept two caller-supplied network values.

Add a negative test with a **correctly signed testnet statement presented unchanged to a mainnet-configured verifier**. It must reject. This is different from today's "mutate network then reuse old signature" test.

### MUST-FIX B — freeze canonical bytes, not merely JS object intent

`JSON.stringify({domain,version,network,pubkey,operation,epoch})` is deterministic for this exact JS construction, but §10 is explicitly cross-node/protocol identity. "Object fields in this order" is not yet a language-independent byte specification.

Either:
- normatively freeze the exact UTF-8 JSON byte grammar/field order/escaping/number representation, or
- preferably define a length-delimited / canonical serialization and hash those bytes.

The security domain prefix is sound; this point is about cross-implementation determinism and preventing implementation drift from becoming verification divergence.

## 2. L4 uniqueness / no fallback

The canonical-pubkey primary-key direction is correct, and J1's finding that uppercase pubkeys verify successfully makes the "normalize+validate at the uniqueness chokepoint" requirement load-bearing.

However, §6 case 4 is not strong enough to prove there is no legacy fallback. "Only relay_id, no valid pubkey signature" can fail for many unrelated reasons.

Add a poisoned-state test:
- create a locally valid `relay_id` row and/or populated legacy `relay_nodes.ecdsa_pubkey_xonly` that would make a fallback tempting;
- omit or invalidate the canonical S10 pubkey proof;
- identity lookup/registration must still reject;
- mutation that reintroduces lookup by `relay_id` or legacy `ecdsa_pubkey_xonly` must be killed.

## 3. P1/P4 fail-closed boundary

P1 is correct: remote identity verification must use the canonical pubkey carried in the protocol payload, never a local DB identity column.

For P4, distinguish two very different failures:

- **local verifier/crypto failure** (`verifyMessage` throws/false/import unavailable) => reject/fail closed;
- **relay unreachable / no local relay mapping** => should be **irrelevant to identity verification**, because L3 claims verification is payload-self-contained and does not consult a local relay.

If an implementation tries to contact `relay_nodes`/relay IPC in order to verify remote S10 identity, that is itself an L3 violation. A valid remote payload should remain verifiable with no local `relay_id` mapping at all.

So do not write "relay unreachable => reject" as the core S10 identity rule. Write: **remote verifier must not require relay reachability; crypto-verifier failure rejects.** Routing after verified identity is a separate L5 concern.

## 4. Major §4 payload/schema contradiction — MUST-FIX C

This is the most concrete design inconsistency.

L1/L3 require a distinct `payload.pubkey` that is the **global relay x-only pubkey** and is the key used by `verifyMessage` and the dedicated identity table.

But §4 simultaneously says the existing six-field U1 submission remains unchanged:

`relayId / rootXpub / identityIndex / identityPubkeyXOnly / challenge / signature`.

Current production U1 code confirms those are indeed the six fields. It also confirms `identityPubkeyXOnly` is the A2 identity key whose binding is derived from `rootXpub + identityIndex`; it is not defined as the relay's global signing identity. Current registration still uses `relayId` for local custody derivation.

Therefore the five-link S10 chain has **no unambiguous wire field carrying the new global relay pubkey** as currently written.

Before design closure, specify exactly one of:

1. S10 is a **separate protocol envelope** with an explicit canonical field such as `relayPubkeyXOnly`, independent from the existing six-field A2 submission; or
2. the existing U1 submission is versioned/extended with a new explicit relay-global-pubkey field.

Do **not** silently reuse `identityPubkeyXOnly` unless the design explicitly proves the invariant `A2 identity key == relay global identity key`; the current code semantics do not establish that.

Add a field-confusion negative test: a valid A2 `identityPubkeyXOnly` must not be accepted as S10 relay identity merely because it is a syntactically valid x-only key.

## 5. §6 negative-test coverage

The current eight cases are useful but incomplete. In addition to the three additions above, add:

- **local-network mismatch:** correctly signed testnet payload presented to mainnet verifier => reject;
- **operation allowlist:** correctly signed `operation="rotate"` or unknown operation presented to today's register-only verifier => reject;
- **legacy fallback poisoning:** valid local relay_id / legacy pubkey cache cannot substitute for canonical pubkey proof;
- **relay-key vs A2 identity-key confusion:** wrong semantic key type must reject even when both are valid 32-byte x-only keys;
- if outer/inner network redundancy remains, **outer != inner** must be structurally impossible or fail closed.

The J1 primitive probe does not cover these state-machine/authority cases; it correctly labels several cases as implementation-layer pending.

## 6. Future `rotate` operation

Reserving `operation` is **sufficient isolation for today only if today's verifier hard-allowlists exactly `operation === "register"`**.

Merely signing an `operation` field is not enough. If a future/unknown operation is accepted by the current handler and then processed using register semantics, the reserved domain becomes an alias rather than an isolation boundary.

So today:
- only `register` is accepted;
- `rotate`, `revoke`, unknown values reject even when correctly signed;
- future rotate/revoke require separate state-transition semantics and continuity proof; a self-signature under the new key still does not prove succession from the old key.

## Result by requested focus point

1. **L2 domain separation:** direction PASS, but network-context authority + canonical-byte specification MUST-FIX before closure.
2. **L4 uniqueness:** pubkey-keying PASS direction; legacy-fallback poisoning test required.
3. **P1/P4:** P1 PASS direction. Crypto verify failure must reject; relay unreachability must not be part of remote identity verification at all.
4. **§6 tests:** materially incomplete; add local-network replay, operation allowlist, legacy fallback poisoning, semantic key-confusion, and outer/inner network consistency.
5. **future rotate:** reserved operation field is fine as namespace reservation, but current verifier must hard-reject all non-`register` operations; rotate continuity remains separately OPEN.

## Overall state

**S10 design = GREEN DIRECTION / REDTEAM HOLD FOR 3 MUST-FIX ITEMS:**

- A. local network authority + cross-network replay test;
- B. normative canonical signed-byte serialization;
- C. explicit global-relay-pubkey wire/schema field (resolve the current six-field contradiction).

No implementation, rollout, signing/broadcast, DB mutation, key movement, settlement/refund, or production money-path action is authorized by this review.
