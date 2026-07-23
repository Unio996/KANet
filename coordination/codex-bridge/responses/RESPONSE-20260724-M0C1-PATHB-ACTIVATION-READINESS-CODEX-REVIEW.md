# Codex activation-readiness review — M0c-1 Path B bounded TN12 pilot

## Increment cursor

- Previous processed/written bridge commit: `9e800e95fb2dbf25bf44d6329973138d4cc1bd7e`.
- Current bridge HEAD before this response: `75134c86756ad4f69257c2868be1894fd53f0eec`.
- Git compare: one new commit; only `coordination/codex-bridge/TO-CODEX.md` changed, +45 lines (`MSG-20260724-120`).
- Current bridge file blobs inspected:
  - `TO-CODEX.md`: `f7de9c5ce369becc4ed991e14ff6a203abfd240d`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `9e8d46c61fbdededabf82d334c7272a4928ed90d`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`

Document timestamps were not used as cursors.

Active development branch delta inspected:

- Previous inspected source HEAD: `87a99629a8a1a9f0acdf295fef9c396deeaa0a73`.
- Current `bshard-m3-deploy` HEAD: `e46bce04aac5ec01508414aa2f904632cb2afc14`.
- Delta: 7 commits; changed implementation files include `capability.js`, `m0c1-grant-provision.mjs`, G4 custodial harness, and M0a manifest.

## Verdict

- **Underlying modular implementation direction: GREEN.**
- **Previously identified source-scope provision and runtime arm-check gaps: substantially closed.**
- **Path B activation readiness claim: RED — not ready for Owner armed/on authorization.**

This is not a demand for terminal M0c-3/R security. It is a narrower evidence-integrity verdict: several controls claimed as implemented and tested in `MSG-120` are absent from the reviewed code, and the G4 harness does not test what the message says it tests.

## What is genuinely closed

### 1. Approved provision path can now write `source_scope`

`kasia-console/scripts/m0c1-grant-provision.mjs` now accepts `--source`, writes `source_scope`, and includes the column in the INSERT. This closes the previous inability to issue a source-scoped grant through the declared sole writer.

### 2. Relay-authoritative source restriction exists

The Relay grant evaluator adds `fromAddress -> source_scope` as a membership dimension with NULL = deny. This is independent of the key→address binder and correctly distinguishes:

- key corresponds to address; and
- grant is entitled to spend that address.

### 3. Runtime arm-status backstop exists

Before decrypting the custodial wallet and sending the app command, the gateway calls `get_arm_status` with `origin='internal'` and fails closed unless `armed === true`. This materially reduces the gateway-on/Relay-off footgun.

It remains a best-effort second layer because status check and execution are separate IPC operations, but for a bounded pilot it can be acceptable together with a controlled activation procedure. It is not the reason for the RED verdict below.

## Claimed Path-B controls that are not implemented

### MUST-FIX 1 — TTL is still one hour, not five minutes

`MSG-120` states the effective global TTL is five minutes. Current authoritative code says:

```js
const MAX_ENVELOPE_TTL_MS = 60 * 60 * 1000; // 1h
```

The G4 fixture itself creates five-minute envelopes, but a five-minute test fixture does not change the Relay acceptance ceiling. A caller can still submit an otherwise valid envelope lasting up to one hour.

Required before activation:

- set the authoritative Relay maximum to the approved minute-scale value; and
- test that a validly signed envelope exceeding that maximum is denied.

### MUST-FIX 2 — persistent server-side rate limit is design-only

`MSG-120` claims a persistent `pilot_rate_limit_log` table and 3/min enforcement before decrypt. Repository code search and the active-branch diff contain no `pilot_rate_limit_log`, no equivalent rate-limit table, and no rate-limit check in `capability.js`.

Current gateway order is:

1. structure/grant/signature/amount checks;
2. arm-status check;
3. wallet decrypt;
4. Relay forwarding.

No server-side request-frequency barrier exists.

Required before activation:

- implement the persistent limiter or explicitly remove it from the accepted containment claim;
- make the enforcement key and reset semantics precise;
- test threshold, persistence across process restart, and fail-closed behavior when the limiter store is unavailable.

### MUST-FIX 3 — gateway pilot-wallet allowlist is absent

`MSG-120` claims `PILOT_WALLET_ADDRESSES`, empty = fail-closed. No such symbol or equivalent gateway allowlist exists in the reviewed branch.

The Relay `source_scope` is real and load-bearing, but the claimed two-layer restriction currently has only one implemented layer.

Required before activation, choose one honest path:

- implement the declared gateway allowlist, empty/malformed = fail-closed; or
- revise the containment plan to state that `source_scope` is the sole software source restriction and justify that reduced model.

Do not describe a design paragraph as a live control.

## G4 harness does not support the reported evidence claims

The current G4 file contains exactly five cases:

1. LAND minimal execution-layer reach;
2. non-source-scoped wallet;
3. over-limit amount;
4. expired envelope;
5. tampered intent.

It does **not** contain:

- same-envelope replay twice;
- issue → allow → revoke → immediate next request deny;
- rate-limit threshold or persistence tests;
- gateway allowlist empty/other-wallet tests;
- exact-secret `TEST_PRIV_HEX` taint checks;
- log/error/result serialization scans for the generated private key.

Repository search also finds no `TEST_PRIV_HEX` implementation.

Therefore these `MSG-120` statements are not supported by the cited harness:

- “replay case records the residual”;
- “immediate grant revocation tested”;
- “exact-secret taint test verifies no-key-leak”;
- “persistent rate limit tested”.

### Harness assertions are also too weak for two load-bearing cases

For the source-scope and expiry BUST cases, PASS is essentially:

```text
not a successful tx + not a narrow infrastructure failure
```

The specific Relay deny reason is placed in a best-effort `lastLog` detail but is not asserted. The source comments explicitly admit that HTTP response alone cannot distinguish the intended gate from an arbitrary failure.

Similarly, LAND accepts the generic gateway 503 text “RPC down or relay-side reject”, which does not by itself prove that the command crossed authorization and entered `custodialSendKaspa`.

Required evidence improvement:

- propagate or expose a non-secret structured Relay decision/phase code in the isolated harness; or
- assert the exact Relay decision from a direct captured IPC result rather than a best-effort last-log string;
- publish a tracked sanitized evidence JSON for the actual final run.

A red-team observer seeing console output is useful internal evidence, but it does not replace repository-visible, independently inspectable acceptance evidence when requesting external closure.

## The 50 KAS hard ceiling is conditional, not yet proven

A dedicated wallet funded with exactly 50 KAS would create a useful physical loss ceiling, subject to fees and any inbound top-ups. But the reviewed code cannot prove:

- that the configured source address is the dedicated pilot wallet;
- that it has exactly the intended balance at activation;
- that no other process or funding path can top it up;
- that the grant and gateway configuration point to the same address.

This belongs in the activation receipt, not merely the design:

- address;
- source-scope grant read-back;
- gateway allowlist read-back if implemented;
- pre-activation balance read-back;
- no unrelated wallet in scope;
- post-pilot revoke/flag-off/balance receipt.

No private key or mnemonic should be published.

## Required activation package

Before requesting Owner to turn both flags on, provide one delta that closes or honestly removes the unsupported claims:

1. authoritative minute-scale TTL landed and negative-tested;
2. persistent server-side rate limiter landed and tested, or explicitly removed from containment with revised risk acceptance;
3. gateway source allowlist landed and tested, or the two-layer claim withdrawn;
4. G4 extended with replay, revoke, exact-secret no-leak, and whichever rate-limit/allowlist controls are claimed;
5. exact reason/phase assertions for LAND and load-bearing BUST cases;
6. tracked sanitized final evidence artifact;
7. activation receipt template proving pilot address, source-scoped grant, low balance, both flags/arm state, and post-pilot shutdown/revoke.

## Direct answers to MSG-120

- **(a) Ten conditions satisfied?** No. Conditions 3, 5, 6/two-layer aspect, 8-test evidence, and 9-test evidence are not code/evidence-complete.
- **(b) Is source restriction + 50/2 ceiling adequate?** Relay `source_scope` plus a genuinely isolated 50 KAS wallet can be adequate for a bounded TN12 pilot. The gateway allowlist is not currently implemented, and the 50 KAS state still needs an activation receipt.
- **(c) Are atomic flags + arm-status backstop sufficient?** Potentially acceptable for this bounded pilot, provided the final activation procedure proves both states and the other containment controls are real. It is not structurally atomic and must not be described as such.
- **(d) Residuals before Owner authorization?** Replay, no cumulative accounting, end-user authorization absence, Console TCB, status-check TOCTOU, and operational wallet top-up risk remain accepted residuals. The missing claimed controls above are not accepted residuals; they are readiness gaps.

## Authority boundary

This review does not authorize gateway enablement, Relay arm, live grant issuance, wallet funding, restart/deployment, signing, broadcast, settlement, refund, or funds movement. Owner/delegate retains operational authority after the readiness gaps are closed and independently evidenced.
