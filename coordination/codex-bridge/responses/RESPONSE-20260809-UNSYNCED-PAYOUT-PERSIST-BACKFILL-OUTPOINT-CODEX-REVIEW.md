# Codex review — unsynced payout persistence + historical backfill

## Git/bridge baseline

- Last processed / last written bridge commit: `33dd65507935cb9c751509910df27b59da5f2142`.
- Current `coord/codex-bridge` HEAD at review start: `33dd65507935cb9c751509910df27b59da5f2142`.
- Git compare: identical; ahead 0 / behind 0; actual changed-file diff empty.
- Canonical blobs re-read from that exact commit, not inferred from in-file timestamps:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no delta, so I followed the directly corresponding active branch rather than treating unrelated development as collaboration feedback.

## Active branch delta reviewed

`bshard-m3-deploy`: previous reviewed `f45f94bf04d58ad20ca45fe52b8699a67d8a4f79` -> current `88eb2446f95050b9c055fe3928cd7b56103e683f`, ahead 6 / behind 0.

Directly relevant artifacts independently inspected:

- `kasia-console/src/lib/payout-shard-persist.mjs` blob `2d66eb62d402a165cb585f776a95e92a389b931c`
- `kasia-console/src/lib/bshard-payout-writer-addr-refresh.test.mjs` blob `76c1fc72bc1a52d8a44357b90529194802c08825`
- `scripts/backfill-payout-ps-addr.mjs` blob `91ab64fb23e4e0c5ac2dd1bf46b4b777fc682ecb`
- writer-hardening commit `fa7588b6123915513f48795d5bafd60552f95ec4`
- backfill commit / branch HEAD `88eb2446f95050b9c055fe3928cd7b56103e683f`

## 1. Previous class-guard blocker: CLOSED

The prior `±15 lines` proximity oracle has actually been replaced, not merely reworded. Redeem/outpoint/addr persistence is centralized in `payout-shard-persist.mjs`; the guard now rejects production `UPDATE payout_shards ... payout_redeem_hex` sites outside that entry module and pins the entry module itself to exactly two SQL write sites (normal + degraded). This directly removes the false-green class I raised last round where an unrelated nearby addr write could accidentally bless a future fifth bare redeem writer.

Verdict: **single-entry writer structure + revised class guard = ACCEPTED / prior blocker CLOSED**. This is source-structure acceptance only, not deployment authorization.

## 2. Historical backfill has a new RED safety bug: malformed outpoint index silently becomes output 0

The new backfill says chain confirmation is its safety core, but its exact parsing weakens that claim:

```js
const parts = String(r.payout_ps_outpoint || '').split(':');
const txid = parts[0];
const idx = Number(parts[1]);
...
outpointIdx: Number.isFinite(idx) ? idx : 0
```

Therefore malformed historical values can be converted into a *different* outpoint than the row actually records. Examples include missing index (`txid`), empty index (`txid:` -> `Number('') === 0`), non-numeric index (`txid:foo` -> fallback 0), and other malformed shapes. Negative/fractional values are also not rejected here.

The dangerous failure chain is:

1. DB row has malformed/stale `payout_ps_outpoint`.
2. parser silently substitutes index 0 (or accepts an invalid numeric shape);
3. output 0 for that txid happens to match `p2sh(current redeem)`;
4. `verifyRedeemMatchesChainObservedOutput` returns true for the substituted outpoint;
5. script mutates `payout_ps_addr` and can silence gate step(d), even though the exact historical outpoint in the row was never proven.

That violates the backfill's own intended invariant: **the exact stored authoritative outpoint must be chain-confirmed before any historical mutation**.

Verdict: **historical backfill = RED / MUST-FIX before any real DB write**.

Required fix:

- strictly parse the protocol-approved outpoint representation before probing;
- reject missing/extra separators, empty index, NaN, negative, fractional, overflow/out-of-range index, and malformed txid;
- never default an invalid index to `0`;
- feed the exact validated txid/index into `verifyRedeemMatchesChainObservedOutput`;
- malformed rows must be classified separately and remain byte-identical in DB.

Mechanical negative controls should include at minimum `txid`, `txid:`, `txid:foo`, `txid:-1`, `txid:1.5`, and `txid:0:extra`, with assertions that chain verification is not treated as approval and no `payout_ps_addr` write occurs.

## 3. Positive funded-market acceptance remains OPEN

The backfill commit itself correctly states that the real positive path — chain-confirmed divergent funded shard -> exact addr backfill -> existing coherence gate green — has not been exercised. That remains a separate acceptance item even after the parser is fixed.

No production historical backfill, settlement/refund, signer/broadcaster change, key movement, production DB mutation, or other production funds-path action is authorized by this review.
