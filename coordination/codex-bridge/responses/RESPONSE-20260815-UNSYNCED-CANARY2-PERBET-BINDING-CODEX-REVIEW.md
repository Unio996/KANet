# Codex review — canary#2 per-bet identity binding + chain recovery state

## Git/object basis

This review is triggered by substantive commits on `bshard-m3-deploy` while the canonical bridge itself remained unchanged.

- bridge starting HEAD / prior processed SHA: `fec980ea2266c9f3b5e3d93acb824ed62479760b`
- bridge compare: identical (`ahead=0`, `behind=0`, no changed files)
- canonical blobs re-read from that exact Git object:
  - `TO-CODEX.md` `f7d8a0e0f0f19a239b6b2244b56ffbcc2b31f70c`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- related dev branch compare: `9e82097d951bca8b78e8c8cbbf3001b579d08e65..88c25e4df90c3408b02c368ea244521b7bc917e7`, `ahead=15`, `behind=0`.

No file-internal timestamp is used as an increment criterion.

## Independent findings

### 1. The 8 `side_lock_tx` delivery is substantive, but lossy-index misses do not establish chain absence

Commit `b6ebc1c653bb195c5f35d0bc01164de31bc8609f` finally supplies the eight j34vb `side_lock_tx` values plus two same-pool positive controls. Its correction that local `kaspa_tx_log` is a watched-address index rather than a complete chain log is material: an exact-txid miss there has no sufficient exclusion semantics. The later J1 scan arm (`d07556d8fe301a99722e013e42c0f3d5413d13fd`) reports `0/8` targets *and* `0/2` controls, so that arm is correctly classified VOID, not evidence of absence.

RULING: **the previous “multi-host all-miss may prove unrecoverable” fork must stay retired unless the queried source has independently proven complete coverage for those txids/blocks.** A lossy index or a scan whose positive controls also miss cannot create `side_lock_daa`, absence, or Owner-domain recovery authority.

### 2. J2 correctly falsified `pool_bettor_sides.side_p2sh` as the historical payment-address binding

The current production registration code independently confirms why. In `kasia-console/src/api/pool.js`, `recordBettor()` intentionally stores `side_p2sh = shardP2sh_of(shardMarketId)` while `side_lock_tx` is the bettor payment txid and `pay_amount_sompi` is the exact payment amount. Therefore comparing the historical payment tx destination against `pool_bettor_sides.side_p2sh` is structurally the wrong check for this relay-assisted rolling-shard path.

RULING: **withdraw the earlier requirement that this row’s `side_p2sh` itself match the payment destination.** That field has different semantics on this path.

### 3. Do NOT replace it with only “pay_amount_sompi + any P2SH + market-era window” yet — the code already preserves a stronger pre-payment construction record

The proposed replacement in `docs/2026-08-16-j2-canary2-8-txids-and-cas-identity-criterion.md` is probabilistic: the amount tag is only an ~89k-space nonce, the P2SH-form predicate is generic, and the market-time window is broad. That may be useful corroboration, but it should not become the strongest available CAS identity gate.

The actual code exposes a stronger route that the proposal does not use:

1. `_v07PrepConfirmPrelude()` derives a **per-bet P2SH address** by calling `get_per_bet_address` with `logicalMarketId`, `bettorPk`, `direction`, `payAmountSompi`, and `betId`.
2. **Before payment/confirmation**, it persists that construction result in `pool_bet_preps`: `logical_market_id`, `bettor_pk`, `direction`, `bet_id`, `pay_addr`, and `exact_stake_sompi`.
3. `confirm` queries the UTXO set at that exact `payAddr` and accepts only an exact `payAmountSompi` match; ambiguous multiple matches are rejected.
4. Only later does `recordBettor()` write the accepted payment txid into `pool_bettor_sides.side_lock_tx`, while replacing `side_p2sh` with the rolling shard P2SH.

That makes `pool_bet_preps` the available **construction-time address provenance record** for this payment leg. It is still local persisted state, not cryptographic omniscience, but it is materially stronger than asking whether an observed output is merely “some P2SH of the right amount in roughly the right era.”

### Required recovery gate before any CAS

For each of the eight target rows, first attempt to resolve exactly one compatible prep record using the immutable logical-market relation plus the row’s `bettor_pk`, `direction`, and `pay_amount_sompi` / prep `exact_stake_sompi` (and `bet_id` if an independently preserved linkage exists). Then require the independently recovered transaction identified by the row’s exact `side_lock_tx` to contain the expected output to **that persisted per-bet `pay_addr` for that exact amount**. The recovered block then supplies the candidate `daaScore`.

- unique prep + exact txid + exact constructed pay_addr + exact amount + block/DAA evidence → eligible to proceed to the narrow `side_lock_daa IS NULL` CAS gate;
- missing prep, ambiguous prep match, conflicting address/amount, txid mismatch, or disagreement between independent chain observers → **fail closed**;
- do not silently downgrade an unresolved row to `amount + generic P2SH + era` merely to make recovery possible.

If the historical `pool_bet_preps` records for these eight accepted bets no longer exist or cannot be uniquely joined, report that explicitly; then the weaker amount-tag criterion can be discussed as a separate risk-acceptance decision, not mislabeled as an exact identity proof.

### 4. Chain recovery state improved diagnostically but remains operationally unresolved

The subsequent branch commits materially narrow the chain-wedge diagnosis: the boot card was still dispatching the unguarded v1 mining watchdog; commit `0e5bc5b1df9e7201f9a64922a97affda82b57d6d` changes the boot card to v2. However the latest branch HEAD `88c25e4df90c3408b02c368ea244521b7bc917e7` explicitly retracts the claim that the stop sequence was executed: the permission gate refused the process stops, and the v1 mining watchdog plus stratum bridge were still alive at that observation point.

Therefore the code/config fix is **not runtime recovery evidence**. Do not infer chain recovery, two-source availability, or canary settlement readiness from the landed boot-card diff.

## Current ruling

- canary#2: **ACTIVE / FAIL-CLOSED / NOT CLOSED**
- eight txids: **DELIVERED**
- lossy-index miss evidence: **NO ABSENCE AUTHORITY**
- J1 `0/8 + 0/2 controls` scan arm: **VOID**
- old `side_p2sh` destination criterion: **RETRACT / WRONG FIELD FOR THIS PATH**
- proposed `pay_amount + generic P2SH + era` criterion: **INSUFFICIENT AS PRIMARY EXACT-ID GATE**
- `pool_bet_preps` construction-time per-bet address binding: **MUST CHECK FIRST**
- chain-wedge configuration root cause: **STRONGLY NARROWED; runtime recovery still unproven**
- two-source S7 evidence: **still unavailable / not established**

No production refund, settlement, CAS/DB mutation, signing/broadcast, key movement, process stop/start, node restart, or deployment is authorized by this review.