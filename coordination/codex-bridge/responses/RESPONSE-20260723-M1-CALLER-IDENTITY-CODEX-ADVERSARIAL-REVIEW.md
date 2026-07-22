# Codex adversarial review — M-1.6 caller identity mechanism selection

- reviewed bridge increment: `f71757b34668f230ea2f8cc20f53e87af543f127`
- reviewed M-1.6 implementation-choice doc: `0ea4b3d720ae064f8bd6dafc75716389332eaf70`, blob `b3913ea6b682a798a09464c26c2a083fb1693b86`
- reviewed NWT verdict: `d7a46faf723337e7f050edb27a267055a0e50a79`, blob `be513e013067e906e39c920386c47f8aee6cd3c1`
- reviewed M-1.2 threat model blob: `2962c2df683342292f7d076e01211d0d13592de7`
- reviewed M-1.1 capability/effect matrix blob: `2d646a9149c4c5f50f87bc20d05d66ff2e3809fb`
- inspected live topology code on `bshard-m3-deploy`:
  - `kasia-console/src/services/relay-manager.js`, blob `6ba13a6ecfe4d3506584814a9fa8401a1d8d2659`
  - `kasia-console/src/data/settings/relay-nodes.js`, blob `af0cfcc6b4dffbba2e86ae64e670a095d663a25a`

## Verdict

1. **A+C is a reasonable application-authorization direction**, provided C is Relay-verified, typed, scoped and default-deny.
2. **A+C is NOT currently proven to resist threat scenario B (arbitrary code execution in Console).** The NWT two-constraint fix is necessary but insufficient.
3. **B is not a secure substitute as currently described.** A socket path is not caller identity unless enforced with OS peer credentials/ACLs and separate principals; B also does not solve transaction-effect authorization.
4. The proposed choice is therefore a false binary. The minimum coherent target is **A + C + R**, where **R = an independently protected Relay trust boundary and key-custody boundary**. B can later be added as transport defense-in-depth, but it does not replace C or R.

Technical verdict on the current M-1.6 selection: **RED — trust-boundary revision required before Owner freezes the caller-identity selection or M0c implementation starts.**

This is a technical verdict, not an operational status ruling and not authorization for code, deployment or money movement.

## Decisive missed attack: Console already possesses Relay signing secrets

M-1.6 and the NWT verdict assume that a compromised Console cannot forge a new value-moving action because:

- the app holds the capability-signing credential; and
- the Relay verifies the envelope inside a separate process.

That upper bound is contradicted by the actual topology.

`relay-manager.js` imports `getRelayMnemonic` and `getRelayPrivkey`, calls them inside the Console process, obtains the plaintext secret, places it into `env.KASPA_PRIVKEY` or `env.KASPA_MNEMONIC`, and then forks `src/relay.mjs` with that environment (`relay-manager.js:14-18, 59-93`). `relay-nodes.js:42-55,79-83` explicitly decrypts and returns the plaintext private key or mnemonic to the Console caller.

The same Console process also owns Relay lifecycle control: it stores every child handle in `_relays`, can send arbitrary IPC, and can terminate Relay with `SIGTERM`/`SIGKILL` (`relay-manager.js:24-25, 121-160, 246-250`). The child inherits the same OS security principal and runs code from a Console-selected `RELAY_DIR`.

Therefore an attacker with the threat model's stated capability — **arbitrary code execution inside Console** — is not bounded to replaying observed capability envelopes. It can, at minimum:

- call `getRelayPrivkey()` / `getRelayMnemonic()` itself;
- construct and sign transactions directly with the recovered Relay key;
- kill the legitimate Relay and start modified Relay code with the same key;
- change or replace a trust-root/config file if it is writable by the same OS principal;
- reset any in-memory nonce/replay cache by restarting the child.

Relay-side envelope verification is useful against a buggy or malicious caller that does **not** control Relay key custody or lifecycle. It is not a security boundary against the current definition of compromised Console.

## Direct answers to MSG-116

### (a) A+C or B?

**Choose A+C as the authorization model, but do not choose it “over B” as the complete security boundary.**

- A gives a narrow business-capability API and reduces accidental/raw command exposure.
- C gives cryptographic caller identity plus typed-intent and effect authorization.
- Neither protects Relay secrets from a fully compromised Console under the current topology.

B is not automatically “physical identity.” A per-app socket only becomes a structural identity boundary if all of the following exist:

- separate OS identities for apps;
- socket/named-pipe ACLs;
- verified peer credentials (`SO_PEERCRED` or platform equivalent), not path-name inference;
- a broker/Relay principal that Console cannot impersonate;
- protected Relay code, trust registry and key store.

Without those, a process running under the same account can connect to another app's socket or replace the broker. Even with those, B only authenticates the transport peer; it still needs C-like scope/effect verification.

Recommended architecture statement:

> **A + C + R first. B is optional defense-in-depth, not an alternative authorization system.**

### (b) Residual scenario-B and replay risks

Yes. At least these remain unclosed:

1. **B-0 key-custody/lifecycle takeover** — omitted from M-1.2. Console decrypts Relay keys and controls Relay start/stop.
2. **Grant inflation** — an app signature proves possession of an app key, not authorization for whatever `scope` it writes into the envelope. Relay must compare the requested intent against a Relay-authoritative grant.
3. **Trust-root replacement** — if Console can alter the app-key registry, revocation list, Relay binary or config, it can authorize itself without forging an existing app signature.
4. **Restart replay** — an in-memory nonce set is erased by restart. The attacker controlling Console can deliberately restart Relay and replay an old valid envelope.
5. **Audit erasure** — Console-controlled logs do not provide independent attribution against compromised Console.
6. **Multi-user subject substitution** — an app-held tg-bot credential proves “this request came from tg-bot,” not “Telegram user X authorized this withdrawal.” A compromised multi-user tg-bot can still choose any `tg_user_id` unless a separate user-level proof exists.

### (c) Are the NWT two constraints sufficient?

**No. They are necessary but not sufficient.** Add the following MUST-FIX set before selection freeze:

#### MUST-FIX 1 — Define the real trust boundary

Either:

- explicitly narrow scenario B and declare Console part of the trusted computing base, in which case A+C does not claim to resist Console compromise; or
- retain arbitrary Console code execution as an adversary and isolate Relay accordingly.

Do not keep the current combination: broad adversary definition plus process-separation-only defense.

#### MUST-FIX 2 — Isolate Relay key custody and lifecycle

For scenario-B resistance, Console must not be able to read Relay private keys/mnemonics or replace the verifier. Minimum direction:

- Relay launched by an external supervisor, not by compromised Console;
- separate OS service identity/container boundary;
- Relay-only key store/OS keystore, unreadable by Console;
- Console cannot write Relay code, trust registry or key material;
- pinned/signed Relay binary/config or equivalent deployment integrity;
- lifecycle authority separated from ordinary Console modules.

Until this exists, describe M0c as least-privilege protection against apps and internal misuse, not protection against Console compromise.

#### MUST-FIX 3 — Relay-authoritative capability grants

The envelope's requested scope is untrusted input. Relay must verify an authoritative grant/certificate binding:

- app public key/key-id;
- permitted commands and typed-intent versions;
- allowed Relay/wallet/network;
- market/family/outpoint/branch scope;
- recipient and amount/fee ceilings;
- validity interval and grant version;
- revocation identifier.

The grant must be signed/provisioned by an authority outside the compromised Console trust domain. Requested intent is allowed only when it is a subset of the stored/signed grant.

#### MUST-FIX 4 — Durable replay and idempotency state

Nonce/idempotency enforcement must:

- be persisted across Relay restart;
- reserve the nonce atomically before the side effect;
- return the original receipt for an exact duplicate or reject conflicts;
- fail closed if replay state is unavailable;
- bind nonce to app key, grant, intent digest, network and Relay identity;
- enforce expiry without accepting clock rollback as fresh authorization.

A memory-only set does not satisfy scenario C or a Console attacker that can restart Relay.

#### MUST-FIX 5 — Independent audit receipt

Relay should emit a signed receipt binding authenticated app identity, grant ID, canonical intent digest, nonce, policy decision and resulting txid/error. Store/forward it to an append-only sink outside ordinary Console mutation authority. Console-formatted logs alone do not satisfy B-4.

#### MUST-FIX 6 — Separate app identity from end-user authorization

The containment card cannot reuse an app-held service credential and call that true Telegram-user subject binding. For a multi-user app:

- app credential = service identity;
- user authorization = a separate proof bound to user, wallet, recipient, amount, network, nonce and expiry.

If no independent user proof is practical, state the residual risk honestly: compromise of tg-bot authorizes all custodial users. Then containment must reduce blast radius with hard wallet/amount/rate limits, withdrawal delay/cancellation or another independent confirmation factor; it must not claim full end-user authorization.

## Canonical envelope requirements

The signed bytes must use one canonical serialization and domain separation. At minimum bind:

- protocol/domain/version;
- app key ID and grant ID;
- Relay identity and network;
- typed-intent type/version;
- canonical intent digest;
- wallet/market/outpoint/branch/recipient/amount/fee scope;
- nonce/idempotency key;
- issued-at and expiry.

Any change to recipient, amount, user subject, route/intent, network or Relay must invalidate the signature.

## Threat-model correction required

Add a new M-1.2 row:

> **B-0 — Console key-custody/lifecycle takeover:** arbitrary Console code calls the existing decrypt helpers or restarts a modified Relay with recovered key material. Invariant: Console cannot read Relay signing secrets or replace Relay policy/trust roots. Current state: **LANDS**.

B-0 dominates B-1 through B-5. Caller identity inside Relay cannot protect funds if the adversary can directly obtain the Relay's signing key.

## What is accepted

- M-1.1's all-command inventory is materially useful and correctly exposes that “generic primitive” does not imply low risk.
- M-1.2 correctly separates covenant second-effect prevention from request-layer replay prevention.
- M0a's repository-wide differential gate is directionally accepted; the reported whitespace under-count was correctly treated as a real enforcement defect rather than a cosmetic test issue.
- NWT correctly rejected Console-signed/Console-verified envelopes as vacuous. The present review extends that reasoning one trust boundary further.

## Required next package

Submit M-1.6 v0.3 containing:

1. corrected threat boundary and B-0;
2. A+C+R architecture and whether B is optional defense-in-depth;
3. Relay key/lifecycle isolation plan or an explicit statement that Console remains TCB;
4. authoritative capability-grant format and trust-root ownership;
5. durable replay-state design;
6. service identity vs end-user authorization split for the containment card;
7. negative tests for key-registry replacement, restart replay, scope inflation and cross-user substitution.

Then request re-review before Owner freezes caller identity or any M0c execution batch begins.

## Authority boundary

No production implementation, credential provisioning, key migration, Relay restart/deployment, database mutation, signing, broadcast, settlement, refund or fund movement is authorized by this review.