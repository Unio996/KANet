# Codex review — T3 current-constructor regression / HOLD scope

- reviewed canonical bridge head: `a43b13fb2f2cbe0fa417af8189683007437c6770`
- previous processed/written head: `9626917a7c7597ac39181644f234ce2e7cd89384`
- canonical compare: ahead 1 / behind 0 / one changed file (`coordination/codex-bridge/TO-CODEX.md`, +16/-0)
- canonical blobs at review head:
  - `TO-CODEX.md` = `54dc196b493ce40459756cf0b765129ce4ffeb81`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- reviewed side branch: `coord/j2-t3-market-sil` @ `18c000b0607daa8ef1445bc83da361dd7f78b484`
- side-branch compare from prior checkpoint `a3bc74acebc29428033d0d82420fbb5a483325ad`: ahead 3 / behind 0; changes are the PayoutShard/PayoutShardV2 current-constructor regression/provenance sets and as-built doc updates.

## Independent judgment

The specific blockers recorded in the previous Codex review are now closed at the code/evidence level.

1. **Sole-source / two-valid-leaf silent-burn MUST-FIX is independently reproduced.** NWT `948545c3eeb708b84f00dbe13ecdd03193ee9315` did not rely on the producer's summary: it created an independent worktree at `18c000b0`, recompiled from `.sil` + ctor, and forced the two-valid-leaf / one-designated-shard negative vector to the new `countStrayNonOwnedTokenInputs(...) == 0` guard in both PayoutShard and PayoutShardV2, with `strayCount=1`. It separately forced the self-owned `shardInIdx` vector to the `owner != self` guard. This is sufficient to show the two new requires are independently load-bearing rather than one accidentally masking the other.

2. **The stale-constructor regression gap is closed for the two changed absorb/claim-family contracts.** Fresh suites are built against the current constructor shapes (PayoutShard 25 params; PayoutShardV2 30 params). NWT independently reproduced `43/43` and `44/44` via `--run-all`, verified the manifests, and deep-compared rebuilt bytecode/state-span constants with zero drift (`{offset:1,len:204}` / `{offset:1,len:288}`). This directly addresses the prior objection that historical suites with old ctor arities could not establish current-code regression completeness.

3. **Retiring old V-absorb-3 is technically justified, not a coverage deletion.** At covenant-visible fields, an unrelated foreign same-template token and an omitted legitimate ShardLeaf are indistinguishable to the consumer. Permitting the former necessarily re-opens the latter silent-burn class. Fail-closed rejection plus the new sole-source successor vector is therefore the correct invariant.

4. **The previously found P+S double-count/freeze issue remains closed by the same-transaction atomic hand-off design; the newer sole-source issue is now independently closed as above.** No contradictory code/evidence appeared in the three new side-branch commits.

## Ruling

**LIFT the Codex T3 cross-contract integration design+code HOLD for exact side-branch head `18c000b0607daa8ef1445bc83da361dd7f78b484`.**

This means the reviewed T3 contract set may be treated as **DESIGN+CODE SUPPORTED for merge preparation** at that exact head. The promised vector-currency/as-built audit-table docs may land before merge without reopening Codex review **provided they are docs-only and no contract/test semantics change**. Any code change after `18c000b0`, any altered vector semantics, or any constructor/signature change reopens review for the affected scope.

This ruling is deliberately narrower than production authorization. It does **not** authorize or approve token deployment/genesis, covenant activation, real-KAS funding or transfer, payout/refund/settlement activation, signing/broadcast, funded-key movement, or any other production value-path mutation. Those remain separately Owner-gated / operationally gated and outside this Codex ruling.

## Evidence-strength note

The as-built v0.5 text still contains an older sentence saying the sole-source fix was "待 NWT 独立复现"; that statement is superseded by the later NWT commit `948545c3`. Likewise, the current HOLD decision is based on commit/blob/code/test evidence, not on that document's self-reported timestamps or status labels.
