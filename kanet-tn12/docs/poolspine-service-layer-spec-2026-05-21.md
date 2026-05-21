# PoolSpine + PoolSide Service Layer Spec v0.5

**Date**: 2026-05-21
**Status**: Draft (= post J1 v2 contracts compile PASS)
**Context**: B2 v0.5 hybrid architecture (Option D + Angle 2)

## Architecture overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Maker     │◄────│  Bettor list     │────►│   Oracle     │
│   (host)    │     │  + Merkle tree   │     │   (3 nodes)  │
└─────────────┘     └──────────────────┘     └──────────────┘
       │                                              │
       │                                              │
       ▼                                              ▼
┌─────────────┐                              ┌──────────────────┐
│ PoolSpine   │                              │  chain_events    │
│ P2SH        │                              │  pool_settlement │
│ (anchor)    │                              │  _v1             │
└─────────────┘                              └──────────────────┘
       │
       │ all bettors lock stake to own side
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  PoolSide P2SH × N  (= 1 per bettor, unique scriptPubKey hash) │
└─────────────────────────────────────────────────────────────────┘
```

## Service components

### 1. Maker host service

Responsibilities:
- Bettor registration aggregator (= maintain list of side P2SH hashes + bettor pubkeys + direction + stake)
- Merkle tree builder (= compute sidesMerkleRoot for oracle to sign)
- Front-end UI (= bettor join workflow)

**API endpoints** (proposed on Console):
- `POST /api/pool/market/create` — maker creates market with 3 oracle pubkeys, deploys spine + initial stake
- `POST /api/pool/market/:id/bettor/register` — bettor announces intent (= sends bettor pubkey + direction + planned stake)
- `GET /api/pool/market/:id/sides_merkle` — maker computes + serves current Merkle root
- `POST /api/pool/market/:id/settle` — maker triggers settlement (= broadcasts spine settle TX)

### 2. Oracle relay service

Responsibilities:
- Listen for market settlement triggers (= maker DM OR cron sweep deadline-past markets)
- Fetch market outcome (= polymarket gamma OR LLM-judged source)
- Sign canonical settlement message: `blake2b(market_id || winner || totalYesPool || totalNoPool || sidesMerkleRoot || marketMetadataHash)`
- Broadcast `chain_events.pool_settlement_v1` (= oracle DM with oracle sig + settlement params)

Existing voter daemon adaptations:
- Re-use existing voter cron loop pattern from Phase 4a v0
- Add oracle settlement signing for pool markets
- DM settlement message to maker for spine settle TX assembly

### 3. Bettor self-claim service

Responsibilities:
- Each bettor's Console scans `chain_events.pool_settlement_v1` for their market
- Verify all 3 oracle sigs over settlement message
- Compute own Merkle proof for own side (= using maker-provided Merkle tree OR rebuild from public bettor list)
- Submit claim_winner TX with full proof

### 4. Settler service (Console daemon)

Adapts existing `bettor-prediction-settler.js` pattern:
- Cron tick: detect pool markets in `verifying` state (= deadline past, oracle votes collected)
- Coordinate spine settle TX via Path A (1 big TX) OR Path B (oracle authorizes individual claims)
- Track market state transitions (= matched → verifying → collecting_sigs → completed)

## DB schema additions (= v62 migration)

```sql
-- New table: pool_markets
CREATE TABLE pool_markets (
  id TEXT PRIMARY KEY,                  -- ext-pool-<timestamp>-<random>
  maker_relay_id TEXT NOT NULL,
  spine_p2sh TEXT NOT NULL,             -- spine P2SH address
  spine_lock_tx TEXT,                   -- TX that funded spine
  market_metadata_hash TEXT NOT NULL,   -- 32-byte hex sha256 of market spec
  oracle1_pk TEXT, oracle2_pk TEXT, oracle3_pk TEXT,
  broker_pk TEXT,
  deadline INTEGER NOT NULL,            -- unix seconds
  miner_fee INTEGER,
  broker_fee_pct INTEGER,
  oracle_bond_amount INTEGER,
  maker_stake_amount INTEGER,
  outcome_market_source TEXT,           -- polymarket / kanet_native / wikipedia
  outcome_condition_id TEXT,
  outcome_token_id TEXT,
  resolution_rule_spec TEXT,
  protocol_status TEXT DEFAULT 'pending_bettors',
  settle_txid TEXT, refund_txid TEXT,
  sides_merkle_root TEXT,               -- hex when computed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- New table: pool_bettor_sides
CREATE TABLE pool_bettor_sides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL REFERENCES pool_markets(id),
  bettor_pk TEXT NOT NULL,
  direction INTEGER NOT NULL,           -- 0 = YES, 1 = NO
  stake_amount INTEGER NOT NULL,
  side_p2sh TEXT NOT NULL,              -- this bettor's side P2SH
  side_lock_tx TEXT,                    -- TX that funded side
  merkle_index INTEGER,                 -- position in Merkle tree (= leaf index)
  claim_txid TEXT,                      -- when bettor claimed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Workflow timeline

### Market creation (T0)
1. Maker calls `POST /api/pool/market/create` with market spec
2. Console computes spine P2SH from PoolSpine.sil + ctor params
3. Maker relay locks `makerStakeAmount + 3 * oracleBondAmount` to spine P2SH
4. Console inserts pool_markets row

### Bettor join (T0 → T+deadline-X)
1. Bettor calls `POST /api/pool/market/:id/bettor/register` with bettor pubkey + direction + stake amount
2. Console computes side P2SH from PoolSide.sil + ctor params (= bettor pubkey + spine hash + market metadata)
3. Bettor relay locks `stakeAmount` to side P2SH
4. Console inserts pool_bettor_sides row + recomputes Merkle tree
5. Repeat for each bettor (= parallel, no race)

### Settlement (T+deadline)
1. Settler cron detects pool_markets row with `protocol_status='pending_bettors'` AND `outcome_end_date <= now`
2. Settler triggers oracle relays to vote
3. 3 oracle relays vote (= existing voter daemon pattern)
4. If 3 sign settle_unanimous, maker triggers spine settle TX
5. If 2 sign + 1 silent 24h, maker triggers settle_majority_forfeit_1
6. If all silent 24h, maker triggers refund_unanimous_silent

### Claim (T+settle → T+claim_deadline)
1. Bettors scan `chain_events.pool_settlement_v1` for market
2. Each winning bettor self-claims via PoolSide.claim_winner
3. (Alternative Path B: maker triggers oracle-authorized redistribution via consumed_by_oracle_settlement)

## Open questions for Bettor review

### Q-S1: Spine settle TX construction
- Maker host computes settle TX layout (= maker stake distribution + bond returns + winner payouts)
- 3 oracle sign TX hash for SS contract checkSig verification
- For Path B: spine settle is simpler (= broker fee + bond returns only, NO bettor payouts)

### Q-S2: Oracle settlement message broadcast vs DM
- Option DM-only (= existing pattern, oracle DM to maker)
- Option chain_event public (= maker broadcasts oracle-signed settlement on chain via TX with payload)
- Recommend hybrid: DM for immediate maker, chain_event for bettor self-claim discovery

### Q-S3: Bettor list visibility
- Public (= all bettor pubkeys + sides on chain) — easy verification, privacy loss
- Private (= bettor list in maker DB, sides_merkle_root on chain) — privacy, but maker can lie about list contents
- v0.5: public bettor list (= sides_merkle_root on chain + public bettor pubkey list off-chain, verifiable)

## Path B status — DEFERRED Phase 2b (per Bettor r342 + r343 audit + r343 accept defer)

**Phase 2a (current) ships Path A only** (= cooperative spine settle_unanimous TX with all bettor payouts as outputs). PoolSide consumed via `settled_via_spine` entry 0 — no output value verification, no Merkle proof needed.

**Path B (= bettor self-claim via PoolSide.claim_winner)** NOT shipped in Phase 2a. 3 bugs to fix before Phase 2b ship:

### PoolSide.sil Phase 2b backlog (= Bettor r342 audit)

1. **Bug 1: Merkle proof position info missing** — lines 72/74/76/78/80/82 always-right concat. Only leaf at position 0 verifies. Fix candidate: add `int leafIndex` ctor param + if-else for bit at each level.
2. **Bug 2: Payout math mismatch** — line 89 `stakeAmount * totalPool / winnerPool` ≠ computePoolPayouts. Side contract must accept (losingPool, totalWinnerStake, brokerFee, winnerForfeitShare, minerFee) oracle-signed + re-derive same math.
3. **Bug 3: Canonical leaf not full** — line 71 `blake2b(bettorPk)` insufficient. Use `blake2b(bettorPk || direction || stakeAmount || marketMetadataHash)` for cross-market identity collision resistance.

### Path B revisit trigger

If Phase 2a Path A testnet e2e fails (= 50-bettor TX size limit / sig issue / etc) → fix 3 bugs + ship Path B fallback. Otherwise Phase 2b ships post-v0.5 MVP.

## TODO Phase 2 (post-v0.5 MVP)

- Path B PoolSide.claim_winner 3 bug fixes (= above)
- Padding sentinel strategy for variable depth Merkle proofs
- Refund_all distribution math (= losing side stakes split per spec 50/25/25)
- Bond forfeit math reconciliation (= 25% reward to remaining signed oracles)
- Toccata covenant opcode integration (if 6/4 mainnet upgrade brings them)
- Multi-broker registry (= deferred from v0.5 spec)

## File references

- Contracts: `kasia-console/src/lib/PoolSpine.sil` (714 bytes), `kasia-console/src/lib/PoolSide.sil` (595 bytes)
- Existing settler pattern: `kasia-console/src/services/bettor-prediction-settler.js`
- Voter daemon pattern: `kasia-console/src/services/bettor-prediction-voter.js`
- Migration template: `kasia-console/src/db/migrate.js` (next version v62)
