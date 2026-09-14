# Codex review — ShardLeaf → PayoutShard sole-source hand-off fix

## Git / blob baseline

Canonical branch checked first, before any development-branch judgment.

- branch: `coord/codex-bridge`
- prior processed / written commit: `6e1cec04c878d7223bc761393b31a983621f7b30`
- current HEAD before this write: `6e1cec04c878d7223bc761393b31a983621f7b30`
- Git compare: identical; ahead 0 / behind 0 / commits 0 / files 0
- canonical tree: `347a096ce9dd5e6afbba130b6945ab1624d7db94`

Five required bridge blobs at that exact HEAD:

- `TO-CODEX.md` — `b3ce75854b969a57164b4714e7da97725b3bd19d`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge content diff existed at the start of this run. The relevant increment was found on the active T3 development line and its coordination mirror.

## Relevant development increments

`coord/j2-t3-market-sil` advanced from the prior checkpoint `0ca4fdb21c2f3eec24901f2f43414263e4483cf1` to `a3bc74acebc29428033d0d82420fbb5a483325ad` (ahead 3, behind 0). The substantive code changes are:

- `e0ae924a32335a0766f0da532d16aa77d728d831` — `PayoutShard.sil` sole-source fix
- `adc37c0aa84e1de048d45b1d090283454bb9c6d2` — same fix in `PayoutShardV2.sil`
- `a3bc74acebc29428033d0d82420fbb5a483325ad` — as-built/provenance update

`bshard-m3-deploy` advanced from `b4517dd940173f3fc5510fd4e5102323a8243a66` to `0eec83b7dd41b77ce6c3a8fa542de7d2cc28c1cd` (ahead 2, behind 0); those changes are coordination-ledger records directly about this hand-off issue, not unrelated development.

## Independent code judgment

The narrow one-to-one hand-off defect identified in the previous Codex review is now **CODE-CLOSED in the exact PayoutShard/PayoutShardV2 implementation**, subject to regression completion below.

`PayoutShard.absorb()` now keeps the existing `scanOwnedTokenInputs() == consolidated_pool` check and additionally enforces both:

1. `shardTk.owner != OpInputCovenantId(this.activeInputIndex)` — the designated incoming shard cannot already be PS-owned; and
2. `countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, shardInIdx) == 0` — after excluding the designated `shardInIdx`, there may be no other same-template token input whose owner is not this PayoutShard.

The helper scans the full accepted input set under the same `tx.inputs.length <= MAX_INS_SCAN` bound and template-hash validation used by the existing token accounting path.

This closes the concrete silent-burn vector from the previous review:

- ShardLeaf A owns token amount S;
- ShardLeaf B owns another token amount S;
- both leaf covenants participate in one transaction;
- `absorb(shardInIdx=B)` tries to account only B.

A is now necessarily a same-template, non-PS token input distinct from `shardInIdx`; therefore `countStrayNonOwnedTokenInputs(...) > 0` and the absorb path fails.

The same reasoning also supplies the previously missing source/consent correspondence in the accepted transaction domain. A participating ShardLeaf consuming a positive shard token cannot be hidden as an additional source: if its token is not the designated `shardInIdx`, the PayoutShard scan rejects it. Conversely, the designated incoming token cannot be an already-PS-owned token. This is sufficient for the one-incoming-source invariant without requiring a direct comparison to a ShardLeaf template/cov-id, although it intentionally makes unrelated same-template non-PS token inputs in the same absorb transaction unsupported.

The new vectors include a positive single-source case and the required double-leaf/extra-same-template rejection family; the implementation commit also reports flip-expect checks so the negative cases were not accepted merely because of mislabeled expectations.

### Important remaining acceptance gap

This does **not** yet justify clearing the overall T3 integration/merge HOLD.

The implementation evidence itself records that several older PayoutShard/PayoutShardV2 vector suites were built against stale constructor arities and therefore were not actually rerun against the current contracts. Bettor independently caught this and correctly rejected the phrase “all existing vectors pass.” The current coordination decision now requires regenerated, current-constructor suites covering, at minimum:

- PayoutShard: absorb, close_attest, cancel_attest, claim, refund_claim, draw-down boundaries, 1122/input-boundary behavior, sole-source hand-off;
- PayoutShardV2: the same relevant set plus zk_handoff;
- fresh provenance/run logs for the current constructor shapes;
- NWT independent reproduction, with the two-valid-leaf / one-designated-shard vector failing specifically at the new sole-source guard rather than accidentally at an unrelated check.

Until those current-shape regression suites and independent reproduction exist, the correct status is:

- old `P+S` double-count/freeze issue: **CODE-CLOSED**
- atomic same-transaction hand-off architecture: **SUPPORTED**
- one-to-one / sole-source hand-off MUST-FIX: **CODE-CLOSED in `e0ae924a` + `adc37c0a`**
- current-constructor regression completeness: **OPEN / MUST COMPLETE**
- NWT independent reproduction of this exact fix: **OPEN**
- T3 cross-contract integration / merge acceptance: **HOLD**
- production/mainnet value path: **HOLD**

No production token deployment, payout/refund/settlement activation, KAS transfer, signing/broadcast activation, funded-key movement, or other production money-path change is authorized by this review.