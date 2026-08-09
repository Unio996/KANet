# Codex review — unsynced `payout_ps_addr` writer fix

## Git/bridge verification

- bridge baseline actually processed/written: `924337fd2a0b085d91586fcb90d51ad76848fee8`
- bridge HEAD at start of this run: `924337fd2a0b085d91586fcb90d51ad76848fee8`
- Git compare: identical; ahead 0 / behind 0 / commits 0 / files []
- canonical blobs at that HEAD:
  - `TO-CODEX.md`: `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no increment, so the directly related active branch was checked.

## Active branch increment

- previous reviewed active-branch point: `da467a353c1b958a12ac466345c9d0d0a9fe97fb`
- current `bshard-m3-deploy` HEAD: `f45f94bf04d58ad20ca45fe52b8699a67d8a4f79`
- compare: ahead 8 / behind 0
- latest relevant commit: `f45f94bf04d58ad20ca45fe52b8699a67d8a4f79` (`fix(bshard): refresh payout_ps_addr on every splice -- NOT DEPLOYED, for review`)
- directly inspected current blobs:
  - `kasia-console/src/services/bshard-settle-daemon.mjs`: `ffbbd518eae47efd1620e682d766085d0ec2d83d`
  - `kasia-console/src/services/bshard-close-voter.js`: `ace7a2283ff479a70feac52efd87ab2186839af5`
  - `kasia-console/src/lib/bshard-payout-writer-addr-refresh.test.mjs`: `7303abbddb9fa4e9c30fc9201aa54fdce7f862de`

## Independent code judgement

### 1. Root-cause and writer-side direction: ACCEPTED IN PRINCIPLE

The diagnosis is coherent with the code: the post-splice `payout_redeem_hex` and `payout_ps_outpoint` were being advanced while `payout_ps_addr` remained the genesis-derived address. Because the coherence gate recomputes P2SH from the current stored redeem, this creates a deterministic mismatch after a splice.

The four writer changes follow the right authority direction: derive the address from the same newly authoritative redeem that is persisted, rather than weakening the gate or treating the stale address as authoritative. The close-voter call sites now `await _persistAttestedPsState`, and `_persistAttestedPsState` explicitly loads kaspa-wasm before synchronous P2SH derivation. That closes the obvious async/load-order hazard in this path.

The deliberate degradation rule is also defensible: if address derivation fails, keeping the new authoritative redeem/outpoint while leaving the diagnostic/cache address stale preserves the already-existing fail-closed coherence-gate behavior instead of preserving stale spend-state bytes. This is acceptable only because the gate remains intact and because this change is not being treated as deploy authorization.

### 2. The new “class guard” test is NOT a semantic class guard: MUST-FIX before calling the defect mechanically closed

`bshard-payout-writer-addr-refresh.test.mjs` classifies every `UPDATE payout_shards ... payout_redeem_hex=...` that omits `payout_ps_addr` as acceptable whenever *any* addr-writing UPDATE exists in the same file within `PAIR_WINDOW = 15` lines.

That proves proximity, not pairing.

A fifth defective writer can therefore false-green if it is placed within 15 lines of an unrelated compliant writer. The test does not prove that the bare fallback and the addr-writing UPDATE:

- belong to the same control-flow branch pair,
- use the same new redeem value,
- target the same `logical_market_id`,
- use the same new outpoint,
- or are mutually exclusive success/fallback arms of one derivation attempt.

This matters because the commit explicitly claims the test guards the *class* “a fifth writer forgot addr”. It currently does not establish that property.

Required strengthening: either parse/inspect the AST/control-flow for the UPDATE pair, or factor persistence into one helper whose API takes `{marketId, redeem, outpoint, addr|null}` and test that helper plus statically ban direct redeem-mutating UPDATEs outside it. A regex/proximity scanner can remain as a cheap lint, but it must not be the final semantic acceptance oracle.

### 3. Positive closure evidence is still intentionally incomplete: KEEP OPEN

The commit itself correctly states that historical backfill and positive live acceptance are not covered. That is load-bearing, not bookkeeping: existing divergent rows are not repaired by the writer fix, and a green source scan does not demonstrate that an already-drifted funded market passes K-18 step(d) after a controlled backfill.

Therefore the correct status is:

- writer-side invariant direction: **ACCEPTED IN PRINCIPLE / CODE PRESENT**;
- “future fifth writer” regression guard: **MUST-FIX (false-green possible)**;
- historical divergent-row repair: **OPEN**;
- positive live/coherence acceptance: **OPEN / NOT VERIFIED**;
- production deployment / funded settlement authorization: **NOT GRANTED**.

No production DB mutation, backfill, settlement/refund, signer/broadcaster change, key movement, or funded-path deployment is authorized by this review.
