# Codex review — unsynced TN12 third-host evidence + Broker registration challenge v0.1

## Review basis

- Bridge baseline / last Codex writeback: `7a55fd2ffa52482dd9bade2ced711d357efc751a`.
- `coord/codex-bridge` HEAD at review start: same SHA; compare status `identical`, ahead 0 / behind 0 / files `[]`.
- Canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because bridge had no increment, active branch `bshard-m3-deploy` was compared from previously reviewed `d0e0e83cc56b409ddb554df8715f40e484a2bc44` to current `f7c48b0a35b3b583daec87d64f64fef3763feee3`: ahead 3 / behind 0.
- Relevant new commits/artifacts:
  - `34467e76150636214194843ffc971fa0c67decd9` — Broker initial-registration signature challenge design v0.1, blob `8fc0e7e6d6ed462f53643188e4ac6413019d7618`.
  - `f7c48b0a35b3b583daec87d64f64fef3763feee3` — TN12 third-host confirmation; TN12 document blob `fef6c7e520ecbdfca80415b0ac3576db6bf70d2c`.

## A. TN12 third-host confirmation

### Accepted

The third machine is a useful independent-host / independent-appdir replication. It again reports `isSynced=false`, the same frozen `virtualDaaScore=76181041` / `blockCount=1104732`, growing `tipHashes`, and the ordinary relay path rejects a channel broadcast with `RPC node is not synced`.

This materially strengthens the narrower claim that the symptom is not unique to one host/appdir. It also confirms the fail-closed relay guard is doing what the code says and must not be weakened merely to restore coordination traffic.

### Still NOT an independent network observation

The new document correctly records that the third machine is connected to the exact same upstream peer pair (`152.53.236.224:16311` and `86.48.24.208:16311`). Therefore the third observation does **not** remove the shared-upstream confound identified in the previous Codex review.

The strongest supported statement is:

> three independent host/appdir/runtime instances converge to the same frozen state while observing TN12 through the same upstream peer pair.

It is still not mechanically justified to say:

> any local-storage cause is ruled out globally, or the observed peer view is the canonical TN12 network state.

The document's older one-line rule — “two independent machines with identical frozen virtualDaaScore means the problem is not in any local storage” — remains too strong and should not be retained as a general diagnostic invariant. Host independence and observation-path independence are separate axes.

### Closure condition remains

To separate host/appdir effects from shared-upstream effects, the next high-information evidence is either:

1. a third observation source with a genuinely different peer set / independently discovered peers; or
2. a controlled peer-set perturbation on one existing host while holding storage/appdir constant.

Until then, classify the current evidence as **SUPPORTED for non-single-host failure**, but **NOT_PROVEN for network-wide TN12 state / exclusion of all local-storage mechanisms**.

## B. Broker initial-registration signature challenge v0.1

The design direction is sound in several important respects: it narrows the proof claim to private-key control at registration time, binds protocol/network/address/role/descriptor/nonce/expiry in the signed payload, explicitly rejects P2SH rather than misusing `XOnlyPublicKey.fromAddress`, requires every write (not only INSERT) to re-prove control, and introduces durable replay state instead of an in-memory nonce placeholder.

However v0.1 is **not ready to become the implementation contract**. Two authorization-boundary gaps must be closed first.

### MUST-FIX B1 — challenge submission is not uniquely addressable

§4 says the service may create durable nonce rows, and §9 permits multiple rows per broker (`id / broker_address / role / descriptor_hash / nonce / expires_at / consumed_at / created_at`). But the submission shape is described as only:

`broker_address + signature`

There is no `challenge_id` or `nonce` in the submission envelope.

That makes verification ambiguous whenever more than one unexpired challenge exists for the same broker address (for example two tabs, retry after timeout, descriptor change, or two concurrent clients). An implementation would then have to either:

- guess “latest active challenge”, which can reject a valid signature and creates race semantics; or
- scan active challenges until one verifies, which creates unbounded/DoS-prone verification behavior and makes exact replay/audit semantics less crisp.

**Required fix:** issue and return an opaque `challenge_id` (or require the nonce itself) and require it back on submission. The server must load exactly one durable row by that identifier, then verify that the immutable row fields match the signed payload and the requested mutation. Consumption must be atomic with the authorized onboarding write.

Recommended invariant:

> one submission → one challenge row → one exact signed payload → one state mutation; no “find any challenge that verifies”.

### MUST-FIX B2 — descriptor binding is still underspecified, so the signature can exist before the authorized mutation is defined

The design correctly says every write must be signed and that the descriptor binds “the normalized digest of submitted bot_username/endpoint information etc.”, but §11 explicitly leaves the final descriptor input set and canonicalization undefined.

That is not a harmless implementation detail. It defines **what the signature authorizes**.

The current production route mutates `bot_token_encrypted` and derives/stores `bot_username` from Telegram `getMe`. If the signed descriptor commits only a user-supplied endpoint/username digest but not the exact intended mutable state (or a canonical commitment to it), a valid control proof can be detached from the specific update that is ultimately applied.

Before route code is authorized, freeze a normative `registration_mutation_digest` (name arbitrary) that commits every externally meaningful field the write can change, with explicit canonicalization and versioning. For the present route this should at minimum settle how the following are represented:

- whether a bot token is being added/replaced/left unchanged;
- the authoritative bot identity resulting from `getMe` (or the request material from which it is deterministically derived);
- any endpoint/descriptor fields introduced by Track B;
- role and network;
- operation type if INSERT vs UPDATE semantics differ.

The signature challenge may still prove only key control — it need not be called an “authorization identity” — but **the signed bytes must be inseparable from the exact state mutation accepted in that request**.

### Additional required test semantics

When B1/B2 are fixed, the acceptance suite should include at least:

- two simultaneous active challenges for one address: each signature can consume only its own challenge;
- challenge A signed for descriptor/mutation A, submitted with mutation B: reject;
- consume race: two concurrent submissions using the same challenge, exactly one transaction commits;
- DB failure between proof verification and onboarding write: no consumed-but-not-applied or applied-but-replayable split state; use one SQLite transaction for challenge consume + onboarding mutation + proof archive;
- mutation of any signed field changes verification outcome;
- testnet/network mutation rejects even where the textual Kaspa testnet address prefix is unchanged across deployments.

## Verdict

- TN12 third-host replication: **ACCEPTED as stronger non-single-host evidence; still not an independent network-view confirmation.**
- TN12 not-synced fail-closed relay guard: **KEEP / CODE-LEVEL CONSISTENT.**
- Broker challenge design direction: **ACCEPTED IN PRINCIPLE.**
- Broker challenge v0.1 as implementation contract: **RED / MUST-FIX B1+B2 before route implementation is considered review-complete.**

No authorization is given here for public endpoint exposure, deployment, production registration traffic, key movement, signing/broadcast, settlement/refund, or any other production money-path change.
