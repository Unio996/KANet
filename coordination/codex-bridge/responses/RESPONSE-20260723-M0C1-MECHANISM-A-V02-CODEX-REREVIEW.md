# Codex re-review — M0c-1 Mechanism A v0.2

## Cursor and reviewed objects

- Bridge cursor checked: `99ab3d6e250b96b80df9804c4477a3a994d3ca0b` → `coord/codex-bridge` is Git-identical; no new bridge commit.
- Team work reviewed on `bshard-m3-deploy` HEAD: `eefa9eca3848a1d4d0ae4e2818df24eedbc228d7`.
- Mechanism A v0.2 design blob: `da813bfd6264759beae9edb234c6fa8489bf435b`.
- Current implementation blobs inspected:
  - `kasia-relay/src/lib/app-envelope.mjs`: `4350f764f16f6a6de095c1c26e7ea64dd3125823`
  - `kasia-relay/src/lib/authorize.mjs`: `9cded0ad8c6e2775e4d7f8e0000ae1405540918a`
  - `kasia-relay/src/lib/grant-registry.mjs`: `daa786ee5ce5ca29be6b01ea389946f361b506e8`
  - `kasia-console/scripts/m0c1-grant-provision.mjs`: `8d414f6bc9eb2289f98355c23b07aa3bca6d86a4`
  - `kasia-console/src/api/tg-wallet.js`: `157d949a6134f51c005136cef745ff82490a3917`
  - `kasia-relay/src/lib/commands.mjs`: `64e5b7c918b85866768466494184ce1a0413a229`
  - `kasia-relay/src/relay.mjs`: `d8ba00c28131ee3136a735d78ce5d650701a8f30`
- NWT phased-arm/app-provision verdict blobs:
  - `8f38ee031acb4b0cf0aa8389c908080cfaa10bbb`
  - `ade04ea5554d89a54ab053c08cfc0acd291e9fbb`

Document timestamps were not used as cursors.

## Verdict

- **Layering/modularization direction: GREEN.**
- **Staged grant/envelope/origin/phased-arm foundation: GREEN-with-notes.**
- **Mechanism A v0.2 MUST-FIX #1 (dark launch + mandatory gateway verification): CLOSED.**
- **Wallet-transfer capability activation: BLOCKED on one route-specific transformation contract plus one blast-radius truth correction.**

This verdict follows the Owner/team policy: clean system layering and modularization come first; security tightens gradually. Terminal controls are not prerequisites for every scaffold. The requirement is narrower: a new slice must not create new exposure, must remain reversible/observable, and must not claim protections that are not implemented.

## What v0.2 closed correctly

### 1. Gateway fail-open window is closed in the design

The v0.2 design now requires:

- `ADMIN_CAPABILITY_GATEWAY_ENABLED` default-off;
- disabled route returns 503 before Relay IPC;
- gateway signature verification is mandatory, not optional;
- gateway enablement is separate from Relay `ADMIN_M0C1_GATE_ARMED`;
- gateway and Relay arm happen only after the declared harness/activation gates.

This closes the previous G2 failure mode where a newly exposed HTTP money route could coexist with an inert Relay gate and optional gateway verification.

### 2. The staged foundation is coherent with gradual security

The current code provides useful modular seams without pretending the system is finished:

- full canonical-envelope signing and strict field rejection;
- grant public key as the verification source;
- fresh read-only grant lookup and immediate revocation visibility;
- fail-closed parse/registry errors;
- explicit origin classes;
- `legacy-unmigrated` as a named, loud, shrink-only migration debt rather than absence-implies-trusted;
- default-off Relay gate behavior;
- isolated gate-layer harness.

`legacy-unmigrated` is not a security control, but under the agreed phased strategy it is an acceptable migration marker because it does not silently widen the old exposure and has a ratchet toward zero.

## Remaining activation blocker: signed business intent cannot yet become `custodial_transfer`

The previous MUST-FIX #2 remains open.

Mechanism A v0.2 still specifies a generic conversion:

```js
cmd = { type: intent_type, ...envelope.intent, envelope }
```

The current Relay command contract requires:

```js
custodial_transfer = { privkeyHex, target, amount, ... }
```

The current Console path additionally sends `fromAddress` and `network`, and the Relay handler consumes `privkeyHex`, `target`, `amount`, `network`, and `fromAddress`.

At the same time, `checkIntentBindsCmd()` requires the signed intent field set and values to equal the executable command's non-infrastructure field set and values exactly.

Therefore the current generic contract has no valid outcome:

1. Put `privkeyHex` in the app-signed intent: secret leakage into the envelope/signing/audit surface — unacceptable.
2. Keep `privkeyHex` out and add it in the gateway: `intent != cmd`, so current verify-value-source rejects.
3. Sign only `tg_user_id/target/amount`: Relay cannot prove which decrypted key/source address the Console selected.

### Required route-specific contract

Before `/api/capability/wallet/transfer` can be enabled, define a secret-free two-object contract:

- **Signed business intent**, for example:
  - service subject / opaque end-user reference;
  - source wallet address or stable wallet handle;
  - target;
  - amount;
  - network;
  - nonce/expiry/grant identifiers.
- **Derived execution command**:
  - `privkeyHex` obtained inside the current Console TCB;
  - `fromAddress`;
  - target;
  - amount;
  - network.

A route-specific binder must verify before execution:

- target/amount/network are byte/semantic-equal across intent and command;
- selected wallet/source address equals the signed source address/handle resolution;
- the derived private key corresponds to that source address;
- any `tg_user_id` owner check is performed in the Console business layer and is not misrepresented as app-key authentication;
- `privkeyHex` never enters the envelope, canonical signing bytes, logs, audit rows, errors, receipts, or response payloads.

The existing generic `intent == cmd` verifier remains suitable for commands whose public business fields are the same as execution fields. `custodial_transfer` needs an explicit typed transformer/binder instead of weakening the generic verifier.

This blocks only the wallet-transfer capability activation, not continued scaffold, gateway-library, origin-migration or generic-envelope work.

## Truth correction: cumulative cap is not implemented

Mechanism A v0.2 calls `max_amount_sompi` and `max_cumulative_sompi` the core blast-radius controls. Current code does not implement the second one:

- schema contains `max_cumulative_sompi`;
- provision CLI exposes no cumulative-limit argument and writes `max_cumulative_sompi: null`;
- `checkIntentWithinGrant()` enforces `max_amount_sompi`, but never reads or updates cumulative usage;
- M0c-3 durable replay/accounting is not landed;
- the same valid envelope can still be replayed during its expiry window.

So the current enforceable boundary is:

> per-transaction cap only; no cumulative cap; replay window remains.

Because `payee_scope` is intentionally ineffective for arbitrary withdrawal destinations and end-user binding is residual, this distinction is load-bearing.

### Acceptable gradual paths

Either path is consistent with modularization-first:

**Path A — wait for M0c-3 before wallet capability activation**

Implement cumulative accounting plus durable/atomic nonce reservation, then claim single + cumulative limits.

**Path B — bounded TN12 pilot before M0c-3**

Permit the route only if the documentation and runtime configuration explicitly say:

- per-transaction cap only;
- no cumulative/replay protection claim;
- very low amount cap;
- short envelope/grant window rather than the general 1-hour ceiling;
- route-specific rate limit;
- localhost/TN12 only;
- feature flag default off;
- immediate grant revocation available;
- repeated valid-envelope replay included in the negative/known-residual evidence.

Do not present the unused schema column as an active control.

## Evidence classification

The app-provision harness is valuable and exercises the real Relay authorization path with an isolated DB and dead RPC. Its positive case reaches the Relay switch and then returns an execution-layer `RpcClient not ready`/no-UTXO style error.

That proves **gate allow/deny behavior**, not an on-chain custodial-transfer E2E. The referenced `logs/test-runs/m0c1-gate-harness-latest.json` is not present on the reviewed branch, so Codex cannot independently inspect the claimed 22-command run from the repository. For external evidence closure, publish an immutable sanitized evidence artifact or a hash-pinned manifest. This does not block internal modularization progress.

## Requested v0.3 delta

1. Add a route-specific secret-free business-intent → custodial execution-command transformer/binder.
2. Add no-key-leak tests covering envelope, canonical bytes, logs, audit, errors and response.
3. Correct all cumulative-cap claims, or implement cumulative enforcement through M0c-3.
4. Add a replay-of-the-same-valid-envelope test and classify it honestly according to the chosen gradual path.
5. Keep gateway default-off and do not activate `/api/capability/wallet/transfer` until the above route-specific contract is reviewed.
6. Publish or hash-pin the sanitized harness evidence if requesting Codex evidence closure.

## Authority boundary

This review does not authorize capability-route enablement, production grant issuance, Relay arm, key migration, restart/deployment, signing, broadcast, settlement, refund, or funds movement. Operational authority remains with Owner/delegate under the existing protocol.
