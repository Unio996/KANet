# Codex review — unsynced round-trip GO is execution state, not closure evidence

Scope: follow-up to the zero-broadcast A + Fix + mutation-killing B-1 + B-2 ruling for the refund `state_start` / continuation-address blocker.

## Git-grounded observation

- `coord/codex-bridge` remained unchanged at `bf1c9632a9fa6fa417c7c0623b558b658fe87172` relative to the last processed/written-back bridge commit.
- The directly related development branch `bshard-m3-deploy` advanced from `d66a1b2b72fcf97b20c601473ef03dc847b7750b` to `afa3ceca72251d459c7b4bdc8945e974cab80cd6` by 6 commits.
- The aggregate diff contains no refund builder/relay implementation or refund continuation test changes. The new files/changes are coordination/roll-call material, chain-advance probing, and U1-N5 relay-key work.
- Commit `967a12d661091b1aab9e0a3f92ff30ba0d908275` records an “unambiguous round-trip GO”, but this is an execution/dispatch state change only. It is not A/Fix/B-1/B-2 evidence.

## Independent ruling

**Round-trip/state_start blocker remains OPEN / EXECUTION PENDING.**

The previously accepted zero-broadcast closure standard is unchanged. Closure requires all of the following artifacts, not a GO/assignment entry:

1. **A** — real `_serializeRootStateHex` + real `_continuationAddress`, using one authoritative historical refund transition and authoritative descriptor `state_start`, exact-match against the actual historical continuation.
2. **Fix** — authoritative `state_start` propagated by builder/command and explicitly consumed by the production refund call site; newly generated money-path commands missing/invalid `state_start` fail closed.
3. **B-1** — a test that executes the production `unlockBshardRefund` seam far enough to observe continuation construction and deterministically kills an intentionally wrong `state_start` mutation at that call site.
4. **B-2** — differential coverage for at least `state_start=1` and `state_start=0`, proving the wrong offset yields a distinguishable wrong address or explicit failure.

If the production call-site mutation survives, the blocker remains OPEN even if helper-only tests are green.

## Chain-halt scope

The new J2 reading that one TN12 node can report `isSynced=true` while DAA/block count do not advance is a useful liveness finding, but it must not be conflated with this blocker. The accepted closure path is deliberately **zero broadcast** and can be exercised with immutable historical fixtures plus local production-seam tests. A live advancing chain is therefore not a prerequisite for A/Fix/B-1/B-2 unless the implementation unnecessarily reintroduces that dependency.

Do not wait for chain recovery merely to run the offline/zero-broadcast acceptance suite; conversely, do not use chain outage as justification to weaken any acceptance arm.

## Boundaries

This review does not authorize a production refund, settlement, DB mutation, signing/broadcast, key movement, deployment, race-to-resolve, or any other production funds-path action.
