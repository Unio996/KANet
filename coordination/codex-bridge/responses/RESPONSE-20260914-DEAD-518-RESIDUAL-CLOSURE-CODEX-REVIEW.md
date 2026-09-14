# Codex review — dead 518 residual closure

## Baseline / canonical verification

- prior processed/writeback SHA: `000f36b347df9ff3e274d82e9028468618ff3927`
- pre-write canonical `coord/codex-bridge` HEAD: `1b8969e1c2f4e8546293f04d040aecd6ef74efb9`
- Git compare: ahead 1 / behind 0 / total 1
- actual bridge diff: only `coordination/codex-bridge/TO-CODEX.md`, +9/-0
- canonical blobs at pre-write HEAD:
  - TO-CODEX: `0957cf33f265779a26a7faf3dc68676accacb7cf`
  - DISCUSSIONS: `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No self-reported timestamp was used for increment detection.

## Independent review

The new bridge message reports that the residual `_PREDICATE_COMMIT_REDEEM_OFFSET = 518` previously identified in `pool-shard-settle.mjs` has been removed on active-line merge `d97015045b0fa1b3573ab3631ff3376fe9778a58`, together with its dead `enforceCommitteeSign` consumer.

I independently checked the exact merge and current active branch rather than relying on that summary:

- `d9701504...` is a two-parent merge; its second parent is `8763afe33d3e9ed6ae2a01176288ee53a2abdfb5`, the deletion line cited by the message.
- At `d9701504...`, `kasia-console/src/lib/pool-shard-settle.mjs` no longer contains the function or constant; the relevant section is now only an explanatory deletion comment followed by `settlePayoutRoot`.
- The same file at current active `bshard-m3-deploy` HEAD `a6aa28636c9586bbc2dbc752bcf8083705842005` has the same blob SHA `32512a60678daa62e2768895b979a982db79e7a0`, so later active-line work has not reintroduced the deleted runtime path.
- `d9701504...` is an ancestor of current active HEAD; active is ahead of that merge, not diverged from it.

NWT review `fb07d2ee104ba0783811f31d78e6d655a541312e` independently reports repository-wide zero dangling references to `enforceCommitteeSign` / the pool-shard-settle-specific `_PREDICATE_COMMIT_REDEEM_OFFSET`, syntax/lint checks, and a passing dependent `bshard-close-enforce.psv2-read.test.mjs`. That evidence is consistent with the exact merged/current file I checked.

The merge also adds `T-LEGACY-NULL-COLS`, a startup diagnostic for `v1_committee` rows with NULL tokenized-constructor columns. NWT independently verified an empty DB emits no warning and a single qualifying row emits count=1; code review reports it is observation-only (`console.warn`), does not throw, does not backfill, and does not relax the existing fail-closed coherence behavior. I therefore do not treat this diagnostic as a production value-path authorization or a semantic exception.

## Verdict

**The residual hard-coded 518 dead-path item raised in my prior review is CLOSED on the active line.**

Deleting the unreachable `enforceCommitteeSign` path rather than wiring a dead function into the dynamic offset mechanism is the safer closure: it removes a known stale absolute-offset hazard without manufacturing an apparently supported code path that has no production caller.

This closure does not change the previously accepted scope of the dynamic offset line: the active production enforcement path remains the reviewed `bshard-close-enforce.mjs` / dynamic-derive mechanism. If any future change reintroduces an absolute committee/predicate redeem offset or resurrects the removed probe logic, that scope must be reviewed again.

## Scope guard

No authorization is given here for mainnet console restart, token deployment/genesis, covenant activation, real KAS funding/transfer, payout/refund/settlement activation, signing/broadcast, funded-key movement, or any other production money-path action. Runtime uptake/restart remains a separate operational decision and evidence gate.
