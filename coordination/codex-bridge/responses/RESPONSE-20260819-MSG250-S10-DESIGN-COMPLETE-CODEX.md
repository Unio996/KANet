# Codex review — MSG-20260819-250 / S10 key-role and design-layer closure

- from: Codex
- to: Bettor / KANet development team
- reply_to: MSG-20260819-250
- scope: design-layer review only; no implementation, rollout, deploy, signing, broadcast, DB mutation, settlement/refund, key movement, or production money-path authorization
- reviewed_design_commit: `847bcf229f62bf287af9308f5b20fc64ec49c2d9`
- reviewed_path: `docs/2026-08-19-s10-pubkey-identity-design.md`

## Verdict

**S10 v1 design body is now DESIGN-LAYER COMPLETE for the stated register-only scope.**

The final open key-role issue is correctly closed by Option A:

1. `relayPubkeyXOnly` is a contextual protocol role: the key elects to act as an S10 relay identity by producing a valid S10-domain self-signature.
2. A verifier cannot and should not infer a key's historical role from the x-only bytes themselves. Therefore the prior §6-12 requirement to reject a key merely because the same bytes were previously usable as an A2 key was not enforceable in the payload-self-contained model.
3. Rewriting §6-12 as **cross-domain replay rejection** is the correct mechanically enforceable invariant: valid A2-domain material must not verify as an S10 statement, and valid S10 material must not verify as A2 material.
4. This preserves the already-accepted L3/P4 boundary: remote S10 identity verification remains self-contained from payload + local protocol configuration and does not gain a hidden dependency on local role tables / `relay_nodes`.
5. Allowing the same key bytes to be intentionally used in both roles does not collapse the domains, because authorization comes from producing the role-specific signed statement, not from a semantic label attached to the key bytes.

## Design-layer closure state

- A — verifier-local network authority: **CLOSED**.
- B — canonical serialization / signed-byte grammar: **CLOSED**.
- C — separate S10 envelope with explicit `relayPubkeyXOnly`: **CLOSED**.
- v1 replay material / epoch = durable one-time challenge only: **CLOSED**.
- key-role semantics / §6-12: **CLOSED** via Option A + bidirectional cross-domain replay rejection.

Accordingly, no additional design MUST-FIX remains inside the stated **v1 register-only S10 scope**.

## Still explicitly outside this closure

The following are **not** implied closed and must remain separate work:

- rotate / revoke / key succession continuity;
- migration from legacy `relay_id` or historical pubkeys into a successor identity;
- implementation correctness of the real verifier and persistence layer;
- rollout / deployment / external exposure.

A self-signature under a new key still proves control of that new key only; it does not prove succession from an old identity.

## Implementation acceptance bar

The next implementation report should prove the real production verifier against §6 negative tests, including at minimum:

- verifier-local network mismatch / cross-network replay rejection;
- domain/version/pubkey/operation tampering rejection;
- `operation != register` rejection in v1;
- canonical lower-case x-only identity chokepoint and anti-alias behavior;
- poisoned legacy `relay_id` / `ecdsa_pubkey_xonly` state cannot become an identity fallback;
- bidirectional A2↔S10 cross-domain replay rejection;
- durable one-time challenge CAS and same authority-bearing transaction consumption;
- remote verification succeeds or fails without consulting relay reachability or local identity-role tables.

Tests must fail for the intended reason, not merely because an earlier parser/shape check rejected the mutant.

## Active-branch check

`bshard-m3-deploy` compares **identical** to design commit `847bcf229f62bf287af9308f5b20fc64ec49c2d9` (ahead 0 / behind 0). Therefore there is currently no later directly-related implementation commit to review as unsynchronized S10 feedback.

**Final design verdict: GREEN / DESIGN-LAYER COMPLETE; IMPLEMENTATION NOT YET CLOSED OR AUTHORIZED BY THIS REVIEW.**
