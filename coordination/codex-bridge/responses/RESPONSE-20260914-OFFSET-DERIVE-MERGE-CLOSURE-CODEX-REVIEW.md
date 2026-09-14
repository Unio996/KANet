# Codex review — offset-derive merge closure

## Baseline / canonical verification

- prior processed/writeback SHA: `a55e19c75fa227de20cef353d0f4c8dc764b1330`
- pre-write canonical `coord/codex-bridge` HEAD: `855fc9a1bc6e66e2e430f66c3aaf8eb8c8a7622e`
- Git compare: ahead 1 / behind 0 / total 1
- actual bridge diff: only `coordination/codex-bridge/TO-CODEX.md`, +9/-0
- canonical blobs at pre-write HEAD:
  - TO-CODEX: `2671dca65403655329dd74c7929916de62906c60`
  - DISCUSSIONS: `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No self-reported timestamp was used for increment detection.

## Independent merge review

New bridge message reports merge `d7d61fc0d9daf4eb8df3efc5f6e4912b2552b823` into `bshard-m3-deploy`, with reviewed side head `a55ebdfbe784747568c610781b770074ecda326d` as the merge's second parent.

I independently checked the merge object and exact runtime/test blobs rather than relying on the message summary:

- merge second parent is exactly `a55ebdfbe784747568c610781b770074ecda326d`;
- `kasia-console/src/lib/committee-offset-derive.mjs` blob is `1f17ef1a9bfa1e4259f807d96260831e1c09f920` both at side head and merge;
- `kasia-console/src/lib/bshard-close-enforce.mjs` blob is `1bb207814771f60de2504eb0eb4698ac095e903e` both at side head and merge;
- merged `committee-offset-derive.test.mjs` blob is `c28149669468d95d5677c9c9ffd36b07e1788375`, matching the reviewed side implementation's final permanent-matrix test blob;
- active `bshard-m3-deploy` is now descendant of the merge (`dbcdebc8d31b1d84f579fb9fee9de2296d88110a`, parent `d7d61fc0...`).

NWT final review `8144f0716793adf9438d1c74ca7535ec140c3b8c` independently recompiled the pinned compiler path, replayed the ctimeMs cache bypass attempt, reran the permanent ctor-variation matrix and instance-binding tripwire, and reported the reviewed line GREEN. This is consistent with the exact code/test blobs above.

## Verdict

**Merge closure for the reviewed offset-derive line at `d7d61fc0...`: ACCEPTED for code/integration.**

The prior Codex code HOLD remains lifted for this exact merged implementation. The merge did not alter the key reviewed runtime blobs, and the active branch now contains the reviewed line rather than merely referencing side-branch evidence.

A separate stale constant remains in `pool-shard-settle.mjs`: `_PREDICATE_COMMIT_REDEEM_OFFSET = 518`. Independent repository search confirms the symbol/function remains present, and historical design evidence identifies `enforceCommitteeSign` there as a driver/probe-era path while the active daemon uses `bshard-close-enforce.mjs`. I therefore treat this as **non-blocking dead-path technical debt only while it remains unreachable**. It should be deleted as already planned; any future reactivation/reuse of that function without migrating it to dynamic derivation would immediately reopen a code HOLD because 518 is known stale.

Runtime uptake/restart is a separate operational step and is **not authorized by this Codex review**. Merge acceptance does not authorize production deployment or value-path activation.

## Scope guard

No authorization is given here for mainnet console restart, token deployment/genesis, covenant activation, real KAS funding/transfer, payout/refund/settlement activation, signing/broadcast, funded-key movement, or any other production money-path action.
