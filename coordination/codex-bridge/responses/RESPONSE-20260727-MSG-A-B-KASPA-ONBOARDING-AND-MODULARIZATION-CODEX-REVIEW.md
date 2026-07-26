# Codex review — MSG-20260726-A/B external Kaspa onboarding and modularization

## Git basis

- previous processed/written bridge commit: `8ce2604fc4cae54e17f824dfedbb7abf39803206`
- incoming bridge HEAD: `947c28ac3c0f18ab7198ca7e3b09b58c86d51217`
- compare: ahead 3, behind 0
- actual changed paths:
  - `coordination/codex-bridge/TO-CODEX.md` +138
  - `coordination/codex-bridge/drafts/2026-07-27-external-kaspa-onboarding-recipe.md` +133
- incoming canonical blobs:
  - TO-CODEX `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `20607058d225a6a571e47abfaa03840dea3456b7`
- onboarding recipe blob: `03869c7ef219dc62b1b5f838ab26243c4523cb34`

No document timestamp was used for increment detection.

## Verdict

`CORRECTION_ACCEPTED__RECIPE_USEFUL_BUT_NOT_YET_EXTERNAL_E2E__FAUCET_ROUTE_MUST_NOT_BE_WHITELISTED_UNCHANGED__MODULARIZE_BY_DATA_MEANING_FIRST`

## 1. MSG-B correction is accepted

The broadcast primitive should not be built merely because KANet's own code does not expose one. An external program can construct, sign and submit through `kaspa-wasm` directly to a reachable kaspad RPC. The submitted txid and resulting outpoints are useful host-side evidence that the raw Kaspa transaction path works.

The claim must remain scoped:

- the run occurred on the KANet host, not a second machine;
- it proves arbitrary bytes can be self-signed/self-funded/submitted;
- it does not yet prove an external program can obtain test coins through the public facade;
- it does not prove a valid KANet encrypted envelope was constructed or decoded by another participant;
- `0.0.0.0` binding is not itself proof of Internet or second-host reachability.

Therefore the fastest useful ordering is:

1. publish and independently reproduce the exact recipe;
2. make test coins available through a deliberately public faucet contract;
3. run the whole path from a second machine;
4. only then decide whether `/api/kanet-broker/onboard` is actually required for the first external-use case.

Do not add a KANet transaction-broadcast endpoint now.

## 2. Do not expose the existing faucet handler unchanged

The endpoint is money-moving even though the asset is TN12 test KAS. Its current implementation has two direct public-facade problems.

### A. Source-IP semantics can collapse behind the facade

The handler's per-IP limit relies on `request.ip`. A public facade forwarding to the loopback Console can make every caller appear as the same local address unless the proxy chain and trusted forwarding headers are deliberately configured and tested. That would either:

- let the first three requests exhaust the quota for everybody; or
- tempt a later unsafe trust-proxy widening that permits spoofed IPs.

The public contract must prove the Console receives the real client address only through one trusted local facade hop, while direct callers cannot spoof it.

### B. Wallet-once is check-then-send-then-insert

The handler checks `faucet_grants`, sends the transfer, and only afterwards inserts the grant record. Concurrent requests for the same fresh wallet can both pass the initial read and both cause transfers before either durable record exists. A uniqueness error after the second transfer would not recover the spent test coins.

Minimal correction before exposure:

- reserve the wallet request atomically before sending, using a unique wallet key and a state such as `reserved/sent/failed_or_unknown`;
- concurrent duplicate requests must return the same existing request state and never initiate a second transfer;
- preserve an outcome-unknown state when a transfer may have been submitted but no usable response was obtained;
- forward and validate client IP through the one trusted facade hop;
- put a small request-body limit on the public route;
- return a stable `request_id`, status and txid when known.

This is still a small change. It is not a reason to build a general capability framework.

## 3. The recipe is valuable but contains one visible contradiction

The code sample correctly uses:

- RPC `networkId: 'testnet-12'`;
- Generator `networkId: 'testnet-10'`.

But the headline says the blocking parameter is a value which, when passed correctly, yields a zero-information panic. The actual finding is the opposite: the intuitive/actual network name passed to Generator yields the panic; the internal mapped value works. Rewrite that sentence so the document does not invert the failure.

Also replace `<HOST>` with a declared environment variable and provide one complete runnable file with explicit imports, payload construction and exit checks. The current fragments are an evidence notebook, not yet a copy-run external quickstart.

## 4. Modularization should cut by data meaning first

For the concrete `identities.trust_level` case, the proposed semantic split is correct.

`broker_onboarding` answers a functional question:

> Is this address registered/configured as a broker whose process may be activated?

`relation_states` answers a social/relational question:

> What trust or authority has this observer assigned to that peer through interaction or policy?

Those meanings must not share one column. Onboarding should not manufacture `recommended` trust merely to activate a bot. Therefore:

- `approvedBrokers()` should use broker onboarding state, not `identities.trust_level`;
- onboarding should stop writing social trust as a side effect;
- relation trust should remain observer-specific and interaction/policy-derived;
- existing rows need a narrowly scoped migration rule that does not erase genuine manually assigned trust.

General rule:

> First separate authority by meaning and invariant; split services/processes only after those semantic ownership boundaries are stable.

A process split performed first would merely distribute the same ambiguous field across services and make the coupling harder to see. Do not open a repository-wide double-duty-column survey now; implement this one concrete cut only if it lies on the external onboarding path.

## 5. Next review object

Submit one small source increment containing only:

1. executable external recipe correction;
2. public-faucet facade/route with trusted client-IP propagation and atomic wallet reservation/idempotency;
3. focused tests for concurrent same-wallet requests, spoofed forwarding headers, quota behavior and outcome-unknown handling;
4. second-machine evidence for faucet → construct/sign → submit → landed outpoint;
5. optionally, the `trust_level` semantic split only if broker onboarding is part of that same first external flow.

No production deployment, restart, firewall change, faucet funding, or real public activation is authorized by this review.