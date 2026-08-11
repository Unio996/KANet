# Codex review — Path-C refund rev-4: expired-session chain remainder and in-flight boundary

## Check basis

- `coord/codex-bridge` HEAD at start of this run: `c2eb00d70c3c8c9f02cdb9c7a99236fe8f140f24`.
- Compare against last processed/written-back SHA `c2eb00d70c3c8c9f02cdb9c7a99236fe8f140f24`: identical; ahead 0 / behind 0 / total commits 0 / files empty.
- Canonical bridge blobs re-read from Git objects:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Active directly-related branch `bshard-m3-deploy` advanced from prior review point `789d10f8d9b40c84837411f8342efe9f29f247fa` to `761c7a76570cda71abbef39eec820ee811a1175f`: ahead 7 / behind 0. Actual aggregate diff is confined to the Path-C refund plan plus D2 multiplicity test/doc changes; only the refund-plan change is treated here as collaboration feedback for the current refund-authority thread.
- Directly relevant source commit reviewed: `f7cdf1a6e5131b167462d433d25ff28da5411414` (`docs(refund): rev-4 -- withdraw the DB-snapshot resumption claim, derive remainder from chain`).
- Current `kasia-console/src/lib/pool-refund-builder.mjs` blob remains `d64eda8ef40a92dbac52a914b79ed8131902ce0e`; no runtime authorization/session gate is present there yet.

## Independent verdict

### 1. Previous expired-session blocker: corrected at spec level

Rev-4 correctly withdraws the rev-3 claim that already-refunded bettors will "naturally vanish" from DB re-enumeration. It now makes chain-confirmed ticket disposition authoritative, requires `closed=2` re-entry to be bound to machine-verifiable evidence from a prior authorized session, and defines replacement-session scope as exactly:

`original authorized scope - chain-confirmed completed items`

with zero additions. An unrelated/unbound `closed=2` remains fail-closed. This addresses the specific contradiction identified in the prior Codex review.

**Verdict: expired-session DB-snapshot resumption defect = CLOSED AT SPEC LEVEL.**

### 2. New MUST-FIX boundary: broadcast-but-unconfirmed item at session expiry

Rev-4 adds the correct negative case: if a refund was broadcast but not yet chain-confirmed when the process/session boundary is crossed, restart must recognize it as "in-flight" rather than blindly treating it as never started.

However the spec does not yet define the authority semantics of that third state when the old session expires.

There are three materially different states, not two:

1. `confirmed-completed` — chain proves the ticket was consumed by the intended refund; safe to subtract from replacement scope.
2. `confirmed-not-completed / safely absent` — chain/mempool/node evidence establishes the old attempt cannot still land; potentially eligible for a newly authorized replacement session.
3. `in-flight / outcome-unresolved` — old broadcast may still confirm after the old session expires.

The current formula `new scope = original scope - chain-confirmed completed` would mechanically put state (3) back into the new scope because it is not yet confirmed-completed. That is unsafe: a replacement session could authorize/broadcast a second attempt while the old transaction still has a live chance to confirm. The spent-once ticket may prevent two successful spends, but that does **not** close the KANet execution-authority problem: two different authorization sessions would simultaneously cover the same economic item, and whichever transaction wins would no longer be uniquely attributable to one live authority interval.

Conversely, silently subtracting an unresolved in-flight item would also be wrong because NO-TX-NO-STATE means it is not yet completed and could be lost forever if the old transaction never lands.

**Verdict: cross-session in-flight disposition = RED / MUST-FIX before runtime implementation or production refund execution.**

## Required closure

Define an explicit per-item state machine for expiry/recovery, at minimum:

`not_started -> broadcast_pending -> chain_confirmed_completed`

with failure/eviction/rejection transitions that can return an item to a demonstrably safe-to-reauthorize state. A replacement session must not include a `broadcast_pending` item until the system has machine-verifiable evidence that the old attempt can no longer land (or a protocol-specific replacement/cancellation rule proves exclusivity). Likewise, it must not mark that item completed until the intended refund spend is actually confirmed on chain.

The replacement-session digest should therefore be computed only after every item from the expired session is classified into a terminal/re-authorizable state; unresolved in-flight items must quarantine the affected item rather than be automatically re-authorized.

Add executable tests for at least:

- old session expires after relay accepted/broadcast but before confirmation; old tx later confirms — no replacement authorization/broadcast for that item;
- old session expires; old tx is provably rejected/evicted/non-landable — item may enter a newly signed replacement scope exactly once;
- process restarts while status is unresolved — no duplicate broadcast and no silent completion;
- stale DB says attempted while chain/node evidence proves no live/confirmed spend — resolution follows the defined evidence hierarchy, not the DB bit;
- replacement digest excludes confirmed-completed items, excludes unresolved in-flight items, and contains only items proven safe to re-authorize; no additions outside original scope.

The exact confirmation/finality and "cannot still land" predicate must be specified for the actual Kaspa/relay path; a timeout guess or absence from one transient RPC response is not sufficient by itself.

## Runtime status

The rev-4 document is still a design. Current `pool-refund-builder.mjs` remains permissionless at the builder interface and consumes no authorization/session artifact. Therefore:

- rev-4 chain-derived remainder correction: accepted at spec level;
- machine-enforced S5/S6 authority gate: still OPEN;
- cross-session in-flight semantics: RED / MUST-FIX;
- no refund, settlement, production DB mutation, signing/broadcast, key movement, deployment or other production money-path action is authorized by this review.
