# Codex review — MSG-20260827-285 / §10 pubkey identity v1 five-slice delivery

Verdict: **GREEN AT CODE LAYER, REGISTER-ONLY / LIVE REMAINS HOLD.**

I independently read the landed C1/C2/C3/C4 code paths and the design anchor rather than accepting the report summary. I do not find a new remote first-squatter bypass in the current register-only path.

## 1. Five-slice mapping to L1–L5

**L1 canonical pubkey — PASS.** `u1-s10-identity.mjs` rejects anything other than lowercase 64-hex and also requires kaspa-wasm x-only parse/round-trip equality. The v198 primary-key CHECK independently enforces lowercase 64-hex at storage. The production registration path reaches this verifier before the authority row is written.

**L2 canonical/domain-separated statement — PASS.** The signed statement uses the frozen six-field `u32be(len)||utf8(value)` serialization; prefix is derived from domain/version; network is present in the canonical hash and in the outer signed message. `operation` is hard-whitelisted to `register`.

**L3 payload-self-contained crypto verification — PASS.** The S10 verifier uses the pubkey from `env.relayPubkeyXOnly`, has no DB/relay/IPC lookup, and treats `verifyMessage=false` and throw as rejection. The production caller does not expose the verifier injection hook.

**L4 uniqueness/replay — PASS for v1 register-only.** v198 keys identity by `relay_pubkey_xonly`, pins `operation='register'`, and makes `epoch` unique. The A2 challenge remains separately CAS-consumed in the same `.immediate` transaction; S10 insert failure rolls back the A2 row and leaves the challenge unconsumed.

**L5 local relay binding — PASS for the current threat model.** `relay_nodes.address` is re-derived to x-only at registration time and compared to the already-verified S10 pubkey. The code does not use `relay_nodes.ecdsa_pubkey_xonly` or another legacy identity column as authority. The binding is repeated inside the write transaction, after challenge re-read/expiry check and before challenge consumption, closing the pre-screen→write TOCTOU on the mutable relay address.

## 2. The two plan deviations

**Deviation 1: S10 pre-screen before PoP — ACCEPTED.** It does not weaken an authority boundary: S10 itself uses the real verifier, not the PoP test hook; no state has been written; the subsequent PoP/challenge path remains fail-closed. Keeping S10 outside the PoP hook also preserves the existing concurrent-test barrier semantics.

**Deviation 2: in-transaction S10 block after challenge re-read/expiry re-check, before consume — ACCEPTED.** This is the better ordering for the stated invariant. It preserves the pre-existing CAS rejection semantics and still ensures any S10 PK/epoch/binding failure rolls back the earlier A2 INSERT before challenge consumption. No signature re-verification inside the synchronous better-sqlite3 transaction is required because the signed fields used for the authority row come from the already-verified `s10pre`; the transaction re-checks the mutable DB-side binding.

## 3. ⑦ claim scope

The current wording is acceptable **only with the existing scope qualifier**:

> remote/cross-node squatting of an **existing locally-bound relay row** now requires control of the private key corresponding to that row's address-derived x-only key.

That closes the old `relay_id` first-squatter shape for a remote caller who cannot mutate the target console's local relay state. It does **not** prove same-host principal ownership, does not close the loopback/file-system capability model, and does not establish rotate/revoke or legacy-key succession. Those exclusions must remain explicit.

## 4. Injection / authority-surface review

I did not find a new request-controlled authority injection in the production register path:

- `localNetwork` comes from local process configuration in the production entry and missing/invalid values fail closed;
- S10 crypto uses the real verifier, not the PoP `verifyMessageFn` hook;
- signature authority comes from the payload pubkey, while the DB address read is binding-only;
- the mutable DB-side address binding is repeated inside the `.immediate` transaction;
- challenge read/consume authority remains bound to the same sqlite handle/table.

The remaining explicit trust surfaces are process/environment control and the supplied sqlite handle — already outside the remote-input threat model.

## 5. Evidence class / live gate

The submitted offline evidence is sufficient for **GREEN-at-code-layer** when combined with the inspected code structure. It is **not** evidence of a live deployment. The report correctly states that the live DB is still v197, v198 has not been migrated, and the console has not been restarted.

To reach **GREEN-at-live**, after Owner-authorized D-005 migration/restart, re-run at minimum:

1. migration/schema acceptance against the actual live DB, including v198 presence and expected constraints;
2. positive S10 registration on an Owner-controlled relay, verifying both A2 and `u1_relay_identity` rows plus challenge consumption;
3. replay of the same submission → reject with no additional identity rows;
4. missing-S10 HTTP negative → `RELAY_NOT_OWNED`, no A2/S10 row, challenge not consumed;
5. controlled R7 negative: attempt to claim relay B with another controlled key X → reject, then B's correct key positive → pass;
6. cross-network negative against the live local network authority;
7. legacy-poisoning negative showing `ecdsa_pubkey_xonly` cannot substitute for the address-derived key;
8. DB-identity positive control so the e2e proves it is observing the intended live DB, not a cwd-created stray DB.

All authority-bearing live runs must remain Owner-controlled and must not expose a production funds path.

## 6. One pre-live schema hardening — SHOULD-FIX, not a blocker to current code-layer GREEN

Before v198 is migrated live, I recommend tightening:

`network TEXT NOT NULL`

into a table-level closed-enum CHECK matching C1, e.g. `CHECK (network IN ('testnet-12','mainnet'))`.

Today the sole writer reaches the S10 verifier first, so an invalid network cannot enter through the inspected production registration path; this is why I am not reopening code-layer GREEN. But `operation` and canonical pubkey are already structurally pinned at the table layer, while `network` is only a writer invariant. Adding the CHECK now prevents a future internal/direct writer from creating an authority row outside the signed protocol domain and makes the storage invariant match the verifier's closed enum.

## Final status

- **§10 v1 five-slice register-only landing: GREEN AT CODE LAYER.**
- **Two deliberate ordering deviations: ACCEPTED.**
- **Remote/cross-node relay-id squatting claim: ACCEPTED WITH THE EXISTING SAME-HOST/ROTATION SCOPE LIMITS.**
- **Live migration / live registration / external exposure: NOT AUTHORIZED BY THIS REVIEW.**
- **GREEN-at-live: OPEN pending D-005 + the post-migration arms above.**
- **Schema network enum: SHOULD-FIX before live migration.**

No implementation beyond the reviewed landed code, deployment, signing/broadcast, DB migration, settlement/refund, key movement, or production money-path action is authorized by this review.