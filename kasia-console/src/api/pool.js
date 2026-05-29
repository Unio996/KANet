// B2 v0.5 Sub 2b — Pool API endpoints (5 endpoints per Bettor r330 5-endpoint plan)
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.

import { sqlite } from '../db/client.js';
import { computeSpineP2SH, computeSideP2SH } from '../lib/pool-p2sh.mjs';
import { buildSidesMerkleTree, getMerkleProof } from '../services/pool-merkle-builder.js';
import { sendCommandAsync, transferAndConfirm, isRelayAlive } from '../services/relay-manager.js';
import { estimateStorageMass } from '../services/pool-market-settler.js';
import { categorizeMarket } from '../lib/market-category.js';
import { createHash, randomUUID } from 'node:crypto';

// L4 (area-11): create-time invariants. Hardcoded mirrors of the settler constants;
// kept inline rather than imported because they're stable v0.5 protocol values
// (KIP-9 standardness cap + W3 broker fee floor design choice). Area-10 hardening
// may refactor these into a shared protocol-constants module.
const STORAGE_MASS_SAFE_THRESHOLD_L4 = 400_000;  // KIP-9 cap with 20% buffer
const MIN_BROKER_FEE_SOMPI_L4 = 5_000_000;       // 0.05 KAS broker fee floor
const BETTOR_MIN_STAKE_L4 = 50_000_000;          // 0.5 KAS bettor min (Bug 8)
const MAX_BETTORS_L4 = 50;                       // PoolSpine.sil L13 cap
// 5/28 Owner 钦定: 押注 softcap 拆除 (= 之前 4 KAS testnet 限制阻 UI form 真用户测试). 改 Infinity = 0 cap.
// Per-market math guards (= storage mass / oracle fee floor) still enforce at L1 console + SS contract.
// Env override 保留可 ops set finite cap if needed.
const MAKER_STAKE_MAX_KAS = parseFloat(process.env.POOL_MAKER_STAKE_MAX_KAS) || Infinity;

function deriveXOnlyPubkey(address) {
  return import('kaspa-wasm').then(kaspa => {
    return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
  });
}

export async function registerPoolRoutes(fastify) {
  // POST /api/pool/market/create — maker creates market + locks stake
  // Bettor r449 4 决策 — backend defaults for omitted V2-wireframe fields:
  //   D1: oracle_relay_ids omitted → server-side Fisher-Yates sample 3 from is_oracle=1 pool
  //   D2: outcome_market_source / outcome_condition_id / outcome_token_id → auto-fill defaults
  //   D3: oracle_bond_kas omitted → 1 KAS (v0.5 hardcoded per Area 1.3)
  //   D4: broker_fee_pct omitted → 0; broker_relay_id omitted → maker_relay_id (maker == broker thesis)
  fastify.post('/api/pool/market/create', async (request, reply) => {
    const b = request.body || {};
    // Truly required: only the irreducible per-market choices the maker must make.
    const required = ['maker_relay_id', 'outcome_side', 'outcome_end_date', 'resolution_rule_spec', 'maker_stake_kas'];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || b[k] === '') return reply.code(400).send({ ok: false, error: `missing ${k}` });
    }

    // D4: broker defaults to maker (maker == broker thesis); broker_fee_pct default 0.
    if (b.broker_relay_id === undefined || b.broker_relay_id === null || b.broker_relay_id === '') b.broker_relay_id = b.maker_relay_id;
    if (b.broker_fee_pct === undefined || b.broker_fee_pct === null || b.broker_fee_pct === '') b.broker_fee_pct = 0;

    // D3: oracle_bond_kas default 1 KAS hardcoded per v0.5 Area 1.3 + L1 worst-case math.
    if (b.oracle_bond_kas === undefined || b.oracle_bond_kas === null || b.oracle_bond_kas === '') b.oracle_bond_kas = 1;

    // D2: metadata defaults — UI 0 expose, backend single source of truth.
    if (b.outcome_market_source === undefined || b.outcome_market_source === null || b.outcome_market_source === '') b.outcome_market_source = 'kanet_v05';
    if (b.outcome_token_id === undefined || b.outcome_token_id === null || b.outcome_token_id === '') b.outcome_token_id = 'KAS_native';
    if (b.outcome_condition_id === undefined || b.outcome_condition_id === null || b.outcome_condition_id === '') {
      b.outcome_condition_id = createHash('sha256').update(`${b.resolution_rule_spec}||${b.outcome_end_date}||${b.outcome_side}`).digest('hex').slice(0, 16);
    }

    // S-B (Bettor r240): discovery category for the prediction-menu bot. Caller may pass an explicit
    // category (= seeder forwards gamma tags); otherwise auto-classify from the rule text. Never null.
    if (b.category === undefined || b.category === null || b.category === '') {
      b.category = categorizeMarket(b.resolution_rule_spec);
    }

    // D1: oracle_relay_ids omitted → server-side Fisher-Yates sample 3 from is_oracle=1 pool
    // (excluding maker to prevent self-adjudication per area-1 invariant Q11).
    if (!Array.isArray(b.oracle_relay_ids) || b.oracle_relay_ids.length === 0) {
      // Sample from is_oracle=1, but only LIVE relay processes. r211 O-3: a DB is_oracle=1 row whose
      // relay process is dead (e.g. UAT-Test relays not auto-started) → its bond deposit fails and the
      // market sticks at pending_oracle_deposits forever. Mirrors the bettor.js publish isRelayAlive guard.
      const candidates = sqlite.prepare('SELECT id FROM relay_nodes WHERE is_oracle = 1 AND id != ?').all(b.maker_relay_id);
      const live = candidates.filter(r => isRelayAlive(r.id).alive);
      if (live.length < 3) {
        return reply.code(503).send({ ok: false, error: `oracle pool insufficient: ${live.length} live of ${candidates.length} is_oracle=1 relays (excluding maker) — need 3 running. Start more oracle relays.` });
      }
      for (let i = live.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [live[i], live[j]] = [live[j], live[i]]; }
      b.oracle_relay_ids = live.slice(0, 3).map(r => r.id);
    }
    if (!Array.isArray(b.oracle_relay_ids) || b.oracle_relay_ids.length !== 3) {
      return reply.code(400).send({ ok: false, error: 'oracle_relay_ids must be 3 unique relay ids (v0.5 3-of-3)' });
    }
    if (new Set(b.oracle_relay_ids).size !== 3) {
      return reply.code(400).send({ ok: false, error: 'oracle_relay_ids must be 3 unique' });
    }

    // Lookup addresses + derive pubkeys
    const makerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.maker_relay_id);
    const brokerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.broker_relay_id);
    if (!makerRow?.address || !brokerRow?.address) return reply.code(400).send({ ok: false, error: 'maker or broker relay has no resolvable address' });
    const oracleRows = b.oracle_relay_ids.map(rid => {
      const r = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ? AND is_oracle = 1').get(rid);
      if (!r) throw new Error(`oracle relay ${rid.slice(0,8)} not registered as is_oracle=1`);
      return r;
    });

    const makerPk = await deriveXOnlyPubkey(makerRow.address);
    const brokerPk = await deriveXOnlyPubkey(brokerRow.address);
    const oraclePks = await Promise.all(oracleRows.map(r => deriveXOnlyPubkey(r.address)));

    // deadline + amounts.
    // UAT pain point #2: 15-min minimum is friction for quick testnet demos. POOL_DEADLINE_MIN_OVERRIDE
    // env lets testnet relax it (e.g. =2 for a 2-min demo). Defaults to 15 — mainnet leaves it unset.
    const minDeadlineMin = parseInt(process.env.POOL_DEADLINE_MIN_OVERRIDE, 10) || 15;
    const outcomeEndMs = new Date(b.outcome_end_date).getTime();
    if (!Number.isFinite(outcomeEndMs) || outcomeEndMs < Date.now() + minDeadlineMin * 60_000) {
      return reply.code(400).send({ ok: false, error: `outcome_end_date must be > now + ${minDeadlineMin} minutes` });
    }
    // E7 (area-8): pool market deadline hard cap. Without this, a maker can lock funds
    // for 100 years. Testnet 30 day default; mainnet 365 day. Super-long horizon markets
    // (= cross-year election cycles, etc.) deferred to Phase 5 explicit hardening.
    const maxDeadlineDay = parseInt(process.env.POOL_DEADLINE_MAX_DAY, 10) || 30;
    if (outcomeEndMs > Date.now() + maxDeadlineDay * 86400_000) {
      return reply.code(400).send({ ok: false, error: `outcome_end_date must be <= now + ${maxDeadlineDay} days (POOL_DEADLINE_MAX_DAY hard cap, area-8 E7)` });
    }
    const deadline = Math.floor(outcomeEndMs / 1000);
    const minerFee = parseInt(b.miner_fee, 10) || 50_000;
    const brokerFeePct = parseInt(b.broker_fee_pct, 10);
    if (!Number.isFinite(brokerFeePct) || brokerFeePct < 0 || brokerFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'broker_fee_pct must be 0-9999 basis points' });
    }

    // Sub 5b-4 (Oracle v0.3 J1 #21 critical gap fix #4): oracleFeePct ctor param wire.
    // Per Bettor r17 §10 truth matrix + NWT sub 4 SS ctor 14 params + R7 close.
    // Default 100 bps (= 1% per truth matrix). Range 0-10000 basis points.
    if (b.oracle_fee_pct === undefined || b.oracle_fee_pct === null || b.oracle_fee_pct === '') b.oracle_fee_pct = 100;
    const oracleFeePct = parseInt(b.oracle_fee_pct, 10);
    if (!Number.isFinite(oracleFeePct) || oracleFeePct < 0 || oracleFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'oracle_fee_pct must be 0-9999 basis points' });
    }

    // Sub 5b-3 (Oracle v0.3 J1 #21 critical gap fix #3): Layer 1 console-side min-spendable check.
    // Per J1 #12 dynamic formula `max(5_KAS_floor, 12500/oracleFeePct_bps)`.
    // Prevents NWT sub 4 SS Layer 2 require(spendable >= X) reject with ugly error.
    // Friendly create-time pool size error per user-facing UX (= 跟 W6 same pattern).
    const SS_MIN_SPENDABLE_FLOOR_KAS = 5;  // hard floor per J1 #12 spec (= storage mass safety)
    const dynamicMinKasFromFee = oracleFeePct > 0 ? Math.ceil(12500 / oracleFeePct) : 0;
    const minSpendableKas = Math.max(SS_MIN_SPENDABLE_FLOOR_KAS, dynamicMinKasFromFee);
    // 5/28 Owner 钦定: testnet 不要限制. KANET_TESTNET_NO_LIMITS=1 bypass min-spendable + min-stake guards.
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (parseFloat(b.maker_stake_kas) < minSpendableKas) {
        return reply.code(400).send({
          ok: false,
          error: `maker_stake_kas ${b.maker_stake_kas} < min spendable ${minSpendableKas} KAS (per Layer 1 console check, J1 #12 dynamic formula max(${SS_MIN_SPENDABLE_FLOOR_KAS}, 12500/${oracleFeePct})). Increase stake OR lower oracle_fee_pct.`
        });
      }
    }

    const makerStakeKas = parseFloat(b.maker_stake_kas);
    const oracleBondKas = parseFloat(b.oracle_bond_kas);
    if (!Number.isFinite(makerStakeKas) || makerStakeKas <= 0) return reply.code(400).send({ ok: false, error: 'maker_stake_kas must be positive' });
    if (!Number.isFinite(oracleBondKas) || oracleBondKas <= 0) return reply.code(400).send({ ok: false, error: 'oracle_bond_kas must be positive' });
    // 5/28 Owner 钦定: testnet 0 limits. Skip 1 KAS min + softcap when KANET_TESTNET_NO_LIMITS=1.
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (makerStakeKas < 1) return reply.code(400).send({ ok: false, error: 'maker_stake_kas must be >= 1 KAS (v0.5 minimum — smaller stakes produce a settle TX exceeding Kaspa storage mass cap)' });
      if (makerStakeKas > MAKER_STAKE_MAX_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be <= ${MAKER_STAKE_MAX_KAS} KAS (v0.5 testnet per-market softcap, Bettor r444 + Owner钦定 SS-baked)` });
    }
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    const oracleBondAmount = Math.round(oracleBondKas * 1e8);
    const makerStakeStr = (makerStakeAmount / 1e8).toFixed(8);

    // L4 (area-11): create-time invariants reject configs that cannot settle later.
    // Worst-case scenario: 50 bettors at min stake all on the winning side opposite the
    // maker → maker is the sole loser, distributable = maker_stake − broker_fee − minerFee,
    // each winner output ≈ bettor_min_stake + distributable/50 (= tiny if maker_stake is
    // small relative to fee floor), 3 oracle bond returns at oracleBondAmount. Storage mass
    // and losingPool ≥ fee-floor checks below mirror the runtime checks in dispatchPhase2
    // (settler L454) so a doomed config is rejected at create instead of locking maker stake.
    const minerFee_L4 = parseInt(b.miner_fee, 10) || 50_000;
    // 5/28 Owner 钦定: testnet 0 limits. Skip L4 worst-case guards when KANET_TESTNET_NO_LIMITS=1.
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      const worstLosingPool = makerStakeAmount;
      if (worstLosingPool < MIN_BROKER_FEE_SOMPI_L4 + minerFee_L4) {
        return reply.code(400).send({ ok: false, error: `worst-case losingPool ${worstLosingPool} sompi < broker_fee_floor ${MIN_BROKER_FEE_SOMPI_L4} + minerFee ${minerFee_L4} — market would be unsettlable (area-11 L4)` });
      }
      const worstDistributable = worstLosingPool - MIN_BROKER_FEE_SOMPI_L4 - minerFee_L4;
      const worstWinnerOutput = BETTOR_MIN_STAKE_L4 + Math.floor(worstDistributable / MAX_BETTORS_L4);
      const worstInputs = [makerStakeAmount, oracleBondAmount, oracleBondAmount, oracleBondAmount];
      for (let i = 0; i < MAX_BETTORS_L4; i++) worstInputs.push(BETTOR_MIN_STAKE_L4);
      const worstOutputs = [MIN_BROKER_FEE_SOMPI_L4];
      for (let i = 0; i < MAX_BETTORS_L4; i++) worstOutputs.push(worstWinnerOutput);
      worstOutputs.push(oracleBondAmount, oracleBondAmount, oracleBondAmount);
      const worstMass = estimateStorageMass(worstInputs, worstOutputs);
      if (worstMass > STORAGE_MASS_SAFE_THRESHOLD_L4) {
        return reply.code(400).send({ ok: false, error: `worst-case storage mass ${worstMass} > safe threshold ${STORAGE_MASS_SAFE_THRESHOLD_L4} (oracle_bond_kas=${oracleBondKas} relative to maker stake produces dust outputs) — area-11 L4` });
      }
    }

    // market_metadata_hash
    const metaInput = JSON.stringify({
      source: b.outcome_market_source,
      condition: b.outcome_condition_id,
      token: b.outcome_token_id,
      side: b.outcome_side,
      end: b.outcome_end_date,
      rule: b.resolution_rule_spec,
    });
    const marketMetadataHash = createHash('sha256').update(metaInput).digest('hex');

    // Compute spine P2SH
    const network = makerRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    let spineResult;
    try {
      spineResult = await computeSpineP2SH({
        makerPk, brokerPk, oraclePks,
        deadline, minerFee, brokerFeePct, oracleFeePct,
        oracleBondAmount, makerStakeAmount,
        marketMetadataHash,
        network,
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `spine SS compile fail: ${e.message}` });
    }

    // Maker relay locks stake → spine P2SH.
    // Bug 7 fix: transferAndConfirm verifies the UTXO actually landed (NO TX NO STATE CHANGE) +
    // surfaces the real transfer error (= not a generic "failed after 3 attempts").
    let spineTxId = null;
    try {
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr);
      spineTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `maker stake lock failed: ${err.message} (spine_p2sh=${spineResult.p2shAddr})` });
    }

    // INSERT pool_markets row
    const marketId = 'ext-pool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    try {
      // Stash spine_redeem_script_hex in metadata at create time (= Phase 2c prerequisite per Bettor r348).
      // Required for settle/refund TX scriptSig assembly downstream (= P2SH unlock needs redeem script).
      const initialMetadata = JSON.stringify({
        spine_redeem_script_hex: spineResult.redeemScript,
      });

      sqlite.prepare(`INSERT INTO pool_markets (
        id, maker_relay_id, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, spineResult.p2shAddr, spineTxId, marketMetadataHash,
        oraclePks[0], oraclePks[1], oraclePks[2], brokerPk,
        deadline, minerFee, brokerFeePct, oracleBondAmount, makerStakeAmount,
        b.outcome_market_source, b.outcome_condition_id, b.outcome_token_id, b.outcome_side, b.resolution_rule_spec,
        'pending_oracle_deposits', '', JSON.stringify(b.oracle_relay_ids), b.broker_relay_id, initialMetadata, b.category,
      );
    } catch (e) {
      console.error(`[pool/market/create] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail (spine TX done ${spineTxId}): ${e.message}` });
    }

    return reply.send({
      ok: true,
      market_id: marketId,
      spine_p2sh: spineResult.p2shAddr,
      spine_lock_tx: spineTxId,
      maker_stake_locked_kas: makerStakeAmount / 1e8,
      oracle_bond_required_kas: oracleBondAmount / 1e8,
      // D4 wallet preview: fee breakdown for UI浮窗
      miner_fee_sompi: minerFee,
      broker_fee_pct_bps: brokerFeePct,
      category: b.category,
      status: 'pending_oracle_deposits',
      next_step: '3 oracle relays must call POST /api/pool/market/' + marketId + '/oracle/deposit',
    });
  });

  // GET /api/pool/config — static defaults for UI pre-submit preview (D4 wallet浮窗 estimate fee)
  fastify.get('/api/pool/config', async (request, reply) => {
    return reply.send({
      ok: true,
      default_miner_fee_sompi: 50_000,
      maker_stake_min_kas: 1,
      maker_stake_max_kas: MAKER_STAKE_MAX_KAS,
      bettor_stake_min_kas: 0.5,
      bettors_max: 50,
      deadline_max_days: parseInt(process.env.POOL_DEADLINE_MAX_DAY, 10) || 30,
      disagreement_timeout_min: parseInt(process.env.DISAGREEMENT_TIMEOUT_MIN, 10) || 5,
      oracle_silent_timeout_min: parseInt(process.env.ORACLE_SILENT_TIMEOUT_MIN, 10) || 30,
    });
  });

  // POST /api/pool/market/:id/oracle/deposit — oracle 自 locks bond to spine
  fastify.post('/api/pool/market/:id/oracle/deposit', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    if (!b.oracle_relay_id) return reply.code(400).send({ ok: false, error: 'oracle_relay_id required' });

    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_oracle_deposits') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, oracle deposits already closed` });
    }

    const oracleRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ? AND is_oracle = 1').get(b.oracle_relay_id);
    if (!oracleRow) return reply.code(400).send({ ok: false, error: 'oracle_relay_id not registered as is_oracle=1' });

    const oraclePk = await deriveXOnlyPubkey(oracleRow.address);
    const oraclePks = [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk];
    if (!oraclePks.includes(oraclePk)) {
      return reply.code(403).send({ ok: false, error: 'oracle_relay_id pubkey not in market oracle set' });
    }

    // Check if this oracle already deposited (= via chain_events 'pool_oracle_deposit')
    const existing = sqlite.prepare(`SELECT id FROM chain_events WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?`)
      .get(`%"market_id":"${marketId}","oracle_pk":"${oraclePk}"%`);
    if (existing) return reply.code(409).send({ ok: false, error: 'oracle already deposited' });

    const bondStr = (market.oracle_bond_amount / 1e8).toFixed(8);
    // Bug 7 fix: transferAndConfirm verifies the bond UTXO actually landed at the spine P2SH.
    let bondTxId = null;
    try {
      const r = await transferAndConfirm(b.oracle_relay_id, market.spine_p2sh, bondStr);
      bondTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `oracle bond lock failed: ${err.message}` });
    }

    // Record deposit chain_event
    const { randomUUID } = await import('node:crypto');
    const syntheticTxid = `pool_oracle_deposit:${marketId.slice(0,8)}:${oraclePk.slice(0,8)}:${Date.now()}`;
    sqlite.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?,?,'pool_oracle_deposit',?,?,?,'pool-api', CURRENT_TIMESTAMP)`).run(
      randomUUID(), syntheticTxid, oracleRow.address, market.spine_p2sh,
      JSON.stringify({ market_id: marketId, oracle_pk: oraclePk, deposit_tx: bondTxId, bond_amount: market.oracle_bond_amount }),
    );

    // Check if all 3 oracles deposited → transition to pending_bettors
    const depositedCount = sqlite.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='pool_oracle_deposit' AND payload LIKE ?`)
      .get(`%"market_id":"${marketId}"%`).c;
    if (depositedCount >= 3) {
      sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('pending_bettors', marketId);
    }

    return reply.send({
      ok: true,
      market_id: marketId,
      oracle_pk: oraclePk,
      deposit_tx: bondTxId,
      deposits_received: depositedCount,
      market_status: depositedCount >= 3 ? 'pending_bettors' : 'pending_oracle_deposits',
    });
  });

  // POST /api/pool/market/:id/bettor/register — bettor locks stake to own side P2SH
  fastify.post('/api/pool/market/:id/bettor/register', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    if (!b.bettor_relay_id || b.direction === undefined || !b.stake_kas) {
      return reply.code(400).send({ ok: false, error: 'bettor_relay_id, direction, stake_kas required' });
    }

    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, bettor registration closed` });
    }

    // Area-1 invariant: oracle ∩ bettor = ∅ (PoolSpine.sil L9-16, pp.txt 1.4). An oracle
    // betting on its own adjudication is a direct manipulation vector. Reject before
    // transferAndConfirm so no stake gets stranded.
    let oracleIds = [];
    try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch {}
    if (oracleIds.includes(b.bettor_relay_id)) {
      return reply.code(403).send({ ok: false, error: 'bettor_relay_id is in market oracle set — oracle/bettor exclusivity (area-1 invariant)' });
    }

    // Area-1: maker is the implicit bettor via outcome_side at create (stake locked at
    // spine, direction = outcome_side). Allowing maker to also bettor/register would
    // create a second stake at the maker's PoolSide → computePoolPayouts L374-376 would
    // count the maker twice in `participants` (once isMaker:true from spine, once from
    // sides.map). Block at registration to preserve "maker 恒 bettor" single identity.
    if (b.bettor_relay_id === market.maker_relay_id) {
      return reply.code(403).send({ ok: false, error: 'bettor_relay_id is the market maker — maker bets implicitly via outcome_side (area-1 invariant)' });
    }

    const bettorRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.bettor_relay_id);
    if (!bettorRow?.address) return reply.code(400).send({ ok: false, error: 'bettor relay not found' });

    const bettorPk = await deriveXOnlyPubkey(bettorRow.address);
    const direction = parseInt(b.direction, 10);
    if (direction !== 0 && direction !== 1) return reply.code(400).send({ ok: false, error: 'direction must be 0 (YES) or 1 (NO)' });
    // Q13 (area-8 E2): parseFloat('abc') = NaN; NaN <= 0 is false; NaN < 50M is also false →
    // NaN/Infinity slip through both checks. Use Number.isFinite (matches create endpoint at
    // L51/57/63/64). Reject before transferAndConfirm so no stake gets stranded.
    const stakeAmount = Math.round(parseFloat(b.stake_kas) * 1e8);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) return reply.code(400).send({ ok: false, error: 'stake_kas must be a positive finite number' });
    // Bug 8: minimum bettor stake — a tiny stake → tiny winner-payout output → KIP-9 storage mass overflow.
    if (stakeAmount < 50_000_000) return reply.code(400).send({ ok: false, error: 'stake_kas must be >= 0.5 KAS (v0.5 minimum — smaller stakes produce a settle TX exceeding Kaspa storage mass cap)' });

    // PoolSpine.sil L13 v0.5 hard rule: 50 bettors max per market. Checked here — before
    // transferAndConfirm locks stake on-chain — so a rejected 51st bettor never strands funds.
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    if (bettorCount >= 50) {
      return reply.code(409).send({ ok: false, error: 'market full — 50 bettors max per market (v0.5 scope, PoolSpine.sil L13)' });
    }

    // Q14 (area-8 E8): PoolSide ctor has no disambiguator. Same (bettor_pk, direction,
    // stake_amount) derives the IDENTICAL PoolSide P2SH. A second registration with these
    // exact params would lock stake to the same address; SS PoolSide.claim_winner unlocks
    // only one UTXO at that address → second stake permanently stuck. Block at registration.
    const dup = sqlite.prepare('SELECT id FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? AND stake_amount = ?')
      .get(marketId, bettorPk, direction, stakeAmount);
    if (dup) {
      return reply.code(409).send({ ok: false, error: 'same (bettor_pk, direction, stake_amount) already registered — vary stake_kas to register an additional position' });
    }

    // Compute side P2SH
    const oraclePks = [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk];
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');  // placeholder, production uses actual P2SH script hash
    const network = bettorRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';

    let sideResult;
    try {
      sideResult = await computeSideP2SH({
        bettorPk, spineP2shHash, oraclePks,
        marketMetadataHash: market.market_metadata_hash,
        direction, stakeAmount, deadline: market.deadline,
        network,
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `side SS compile fail: ${e.message}` });
    }

    // Lock stake to side P2SH.
    // Bug 7 fix: transferAndConfirm verifies the stake UTXO actually landed at the side P2SH.
    const stakeStr = (stakeAmount / 1e8).toFixed(8);
    let sideTxId = null;
    try {
      const r = await transferAndConfirm(b.bettor_relay_id, sideResult.p2shAddr, stakeStr);
      sideTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `bettor stake lock failed: ${err.message}` });
    }

    // Get current bettor count for merkle_index
    const merkleIndex = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;

    try {
      sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(marketId, bettorPk, b.bettor_relay_id, direction, stakeAmount, sideResult.p2shAddr, sideTxId, merkleIndex, sideResult.redeemScript);
    } catch (e) {
      console.error(`[pool/bettor/register] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail (side TX done ${sideTxId}): ${e.message}` });
    }

    // Recompute Merkle root
    const bettors = sqlite.prepare('SELECT bettor_pk FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(b => b.bettor_pk));
    sqlite.prepare('UPDATE pool_markets SET sides_merkle_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(tree.root, marketId);

    return reply.send({
      ok: true,
      market_id: marketId,
      bettor_pk: bettorPk,
      side_p2sh: sideResult.p2shAddr,
      side_lock_tx: sideTxId,
      merkle_index: merkleIndex,
      sides_merkle_root: tree.root,
    });
  });

  // ── External (0-key) pool betting — TG/wallet users with NO Console relay (prediction-menu bot
  // stage4-5, Bettor r240). Path locked Bettor r263 after J1 r84 caught the pool-vs-publish-v2 path
  // mismatch + J2 r86 protocol ruling. Two steps:
  //   prep-external    → compute the DETERMINISTIC per-bettor side P2SH + exact stake (UI shows it + a kaspa: URI)
  //   confirm-external → user paid that P2SH from their own wallet → 3 validations → register (parity w/ bettor/register)
  // Binding is the deterministic address itself (PoolSide.sil bakes bettorPk+stake into the ctor, J2 r86 ③),
  // so the SENDER is NOT checked — any wallet may pay; the winner must later claim with the /link-bound key.
  // Wrong-payment is protocol-unrecoverable (underpay = locked till deadline; overpay excess → miner), so
  // prevention (exact sompi + amount-baked kaspa: URI, built UI-side) is the only gate — see Bettor r263.
  function _extStakeValidate(b) {
    if (!b.linked_addr || b.direction === undefined || b.stake_kas === undefined) {
      return { error: 'linked_addr, direction, stake_kas required', code: 400 };
    }
    const direction = parseInt(b.direction, 10);
    if (direction !== 0 && direction !== 1) return { error: 'direction must be 0 (YES) or 1 (NO)', code: 400 };
    const stakeAmount = Math.round(parseFloat(b.stake_kas) * 1e8);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) return { error: 'stake_kas must be a positive finite number', code: 400 };
    if (stakeAmount < 50_000_000) return { error: 'stake_kas must be >= 0.5 KAS (v0.5 minimum — smaller stakes overflow the settle-TX storage mass cap)', code: 400 };
    return { direction, stakeAmount };
  }
  // Derive the deterministic side P2SH for an external bettor (by /link-bound address). Throws {code,message}
  // on the area-1 exclusivity invariants (oracle / maker cannot be a bettor).
  async function _extStakeDeriveSide(market, linkedAddr, direction, stakeAmount) {
    const bettorPk = await deriveXOnlyPubkey(linkedAddr);
    if ([market.oracle1_pk, market.oracle2_pk, market.oracle3_pk].includes(bettorPk)) {
      throw Object.assign(new Error('linked address is an oracle of this market — oracle/bettor exclusivity (area-1)'), { code: 403 });
    }
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address && (await deriveXOnlyPubkey(makerRow.address)) === bettorPk) {
      throw Object.assign(new Error('linked address is the market maker — maker bets implicitly via outcome_side (area-1)'), { code: 403 });
    }
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');
    const network = market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const sideResult = await computeSideP2SH({
      bettorPk, spineP2shHash,
      oraclePks: [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk],
      marketMetadataHash: market.market_metadata_hash,
      direction, stakeAmount, deadline: market.deadline, network,
    });
    return { bettorPk, sideResult, network };
  }

  // POST /api/pool/market/:id/bettor/register-external/prep — step 1: compute the side P2SH + canonical exact stake.
  fastify.post('/api/pool/market/:id/bettor/register-external/prep', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    const v = _extStakeValidate(b);
    if (v.error) return reply.code(v.code).send({ ok: false, error: v.error });
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, bettor registration closed` });
    }
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    if (bettorCount >= 50) return reply.code(409).send({ ok: false, error: 'market full — 50 bettors max per market (PoolSpine.sil L13)' });
    let d;
    try { d = await _extStakeDeriveSide(market, b.linked_addr, v.direction, v.stakeAmount); }
    catch (e) { return reply.code(e.code || 500).send({ ok: false, error: e.message }); }
    // Q14: same (bettor_pk, direction, stake) → identical PoolSide P2SH → a 2nd stake there is unclaimable.
    const dup = sqlite.prepare('SELECT id FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? AND stake_amount = ?')
      .get(marketId, d.bettorPk, v.direction, v.stakeAmount);
    if (dup) return reply.code(409).send({ ok: false, error: 'this (linked addr, direction, stake) already registered — vary stake_kas to add a position' });
    return reply.send({
      ok: true,
      market_id: marketId,
      direction: v.direction,
      bettor_pk: d.bettorPk,
      side_p2sh: d.sideResult.p2shAddr,
      redeem_script: d.sideResult.redeemScript,
      exact_stake_sompi: v.stakeAmount,                       // CANONICAL — show sompi (float KAS rounding = 错付永锁)
      exact_stake_kas: (v.stakeAmount / 1e8).toFixed(8),
      network: d.network,
      deadline: market.deadline,
      // Prevention (Bettor r263): UI builds the amount-baked kaspa: URI from side_p2sh + exact_stake_sompi
      // (UI owns the URI amount-unit per its r122 catch) + shows a prominent permanent-lock warning.
      warning: 'Pay EXACTLY exact_stake_sompi to side_p2sh. Underpayment is locked until the deadline; overpayment excess is lost to fee. Claim winnings with your /link-bound key.',
    });
  });

  // POST /api/pool/market/:id/bettor/register-external/confirm — step 2: detect/verify the on-chain
  // payment → register. UI POLLS this with NO tx_hash → the endpoint AUTO-DETECTS the payment in
  // kaspa_tx_log (a TX to the deterministic side P2SH for the exact stake, not yet registered). An
  // explicit tx_hash may be passed to verify a specific TX. 3 validations (Bettor r263 lock):
  // dest==side_p2sh + amount==exact_sompi + idempotent UNIQUE tx. (sender NOT checked — deterministic
  // address binds, J2 r86 ③.) Parity w/ relay bettor/register (insert pool_bettor_sides + Merkle).
  fastify.post('/api/pool/market/:id/bettor/register-external/confirm', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    const v = _extStakeValidate(b);
    if (v.error) return reply.code(v.code).send({ ok: false, error: v.error });
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, bettor registration closed` });
    }
    let d;
    try { d = await _extStakeDeriveSide(market, b.linked_addr, v.direction, v.stakeAmount); }
    catch (e) { return reply.code(e.code || 500).send({ ok: false, error: e.message }); }
    const sideP2sh = d.sideResult.p2shAddr;
    // Verify against the FULL outputs of each indexed TX (kaspa_tx_log.outputs_json = [{address,amount_sompi}]).
    // NOT the to_address column — that's a single best-guess output biased to KNOWN relay addresses, so a
    // payment's output to a (non-relay) side P2SH only shows in outputs_json. (Caught in e2e: the to_address
    // held the maker's change, not the 0.5 to the side P2SH.) ① dest + ② amount fold into one exact check.
    const hasExactSideOutput = (oj) => { try { return JSON.parse(oj || '[]').some(o => o.address === sideP2sh && Number(o.amount_sompi) === v.stakeAmount); } catch { return false; } };
    const hasAnySideOutput   = (oj) => { try { return JSON.parse(oj || '[]').some(o => o.address === sideP2sh); } catch { return false; } };
    // Resolve the payment TX: explicit tx_hash, else AUTO-DETECT (UI polls w/o tx_hash) — scan indexed TXs
    // whose outputs_json mentions this side P2SH, newest first, excluding already-registered TXs.
    let txId = (b.tx_hash || '').trim() || null;
    if (!txId) {
      const cands = sqlite.prepare(`
        SELECT tx_id, outputs_json FROM kaspa_tx_log
        WHERE outputs_json LIKE ?
          AND tx_id NOT IN (SELECT side_lock_tx FROM pool_bettor_sides WHERE side_lock_tx IS NOT NULL)
        ORDER BY block_time DESC LIMIT 20
      `).all('%' + sideP2sh + '%');
      const exactCand = cands.find(c => hasExactSideOutput(c.outputs_json));
      if (!exactCand) {
        // Re-poll AFTER a successful registration: auto-detect excludes this bettor's own (now-registered)
        // TX, so it finds nothing new — report the existing registration as done (not "pending").
        const mine = sqlite.prepare('SELECT side_lock_tx, merkle_index FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? AND stake_amount = ?')
          .get(marketId, d.bettorPk, v.direction, v.stakeAmount);
        if (mine) return reply.send({ ok: true, registered: true, already_registered: true, side_p2sh: sideP2sh, side_lock_tx: mine.side_lock_tx, merkle_index: mine.merkle_index });
        if (cands.some(c => hasAnySideOutput(c.outputs_json))) {
          return reply.send({ ok: true, registered: false, wrong_payment_detected: true, side_p2sh: sideP2sh, exact_stake_sompi: v.stakeAmount, note: '错付: payment to the side P2SH found but amount ≠ exact stake — locked till deadline. Pay EXACTLY exact_stake_sompi.' });
        }
        return reply.send({ ok: true, registered: false, pending: true, side_p2sh: sideP2sh, exact_stake_sompi: v.stakeAmount, note: 'no matching payment detected yet — keep polling (indexer lag or unpaid)' });
      }
      txId = exactCand.tx_id;
    }
    // ③ idempotent: this exact TX already registered → replay returns ok (UNIQUE side_lock_tx, no double-count).
    const already = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, merkle_index FROM pool_bettor_sides WHERE market_id = ? AND side_lock_tx = ?').get(marketId, txId);
    if (already) return reply.send({ ok: true, registered: true, already_registered: true, side_lock_tx: txId, ...already });
    // Verify the resolved TX (NO TX NO STATE CHANGE): outputs_json must contain an output to the side P2SH
    // for EXACTLY the stake (① dest + ② amount in one check).
    const txRow = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(txId);
    if (!txRow) return reply.code(404).send({ ok: false, error: 'tx_hash not in kaspa_tx_log (indexer lag — retry, or the TX did not land)' });
    if (!hasExactSideOutput(txRow.outputs_json)) {
      if (hasAnySideOutput(txRow.outputs_json)) return reply.code(400).send({ ok: false, error: `amount mismatch: tx pays the side P2SH but not EXACTLY ${v.stakeAmount} sompi (错付 → locked till deadline)` });
      return reply.code(400).send({ ok: false, error: `dest mismatch: tx ${txId} has no output to side P2SH ${sideP2sh}` });
    }
    // Q14 dup + 50-bettor cap (re-check at register time)
    const dup = sqlite.prepare('SELECT id FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? AND stake_amount = ?')
      .get(marketId, d.bettorPk, v.direction, v.stakeAmount);
    if (dup) return reply.code(409).send({ ok: false, error: 'this (linked addr, direction, stake) already registered' });
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    if (bettorCount >= 50) return reply.code(409).send({ ok: false, error: 'market full — 50 bettors max per market' });
    // Register — parity with the relay bettor/register: insert pool_bettor_sides + recompute Merkle root.
    // bettor_relay_id = NULL marks an external (0-key) bettor; side_lock_tx = the user's OWN payment TX.
    const merkleIndex = bettorCount;
    try {
      sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(marketId, d.bettorPk, null, v.direction, v.stakeAmount, sideP2sh, txId, merkleIndex, d.sideResult.redeemScript);
    } catch (e) {
      console.error(`[pool/register-external/confirm] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail: ${e.message}` });
    }
    const bettors = sqlite.prepare('SELECT bettor_pk FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(x => x.bettor_pk));
    sqlite.prepare('UPDATE pool_markets SET sides_merkle_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(tree.root, marketId);
    return reply.send({
      ok: true, registered: true, market_id: marketId, bettor_pk: d.bettorPk, direction: v.direction,
      side_p2sh: sideP2sh, side_lock_tx: txId, merkle_index: merkleIndex, sides_merkle_root: tree.root,
      bettor_count: bettorCount + 1, external: true,
    });
  });

  // GET /api/predictions/polymarket/search?q=K — Polymarket keyword search (Owner r455 钦定)
  // Owner thesis: 不 dump 热门 list, 关键字搜索式 → top 5 → 点选 auto-fill maker create form.
  // Implementation: fetch active markets from Polymarket gamma + filter by question.includes(q).
  fastify.get('/api/predictions/polymarket/search', async (request, reply) => {
    const q = (request.query.q || '').trim().toLowerCase();
    if (q.length < 2) return reply.send({ ok: true, query: q, results: [] });
    try {
      const r = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volume24hr&ascending=false', {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return reply.code(502).send({ ok: false, error: `polymarket gamma ${r.status}` });
      const markets = await r.json();
      const results = (markets || [])
        .filter(m => (m.question || '').toLowerCase().includes(q))
        .slice(0, 5)
        .map(m => {
          let outcomePrices = null;
          try { outcomePrices = JSON.parse(m.outcomePrices || '[]'); } catch {}
          return {
            condition_id: m.conditionId || m.condition_id,
            question: m.question,
            description: m.description,
            end_date: m.endDate || m.end_date_iso,
            volume_24h: parseFloat(m.volume24hr || 0),
            yes_price: outcomePrices?.[0] ? parseFloat(outcomePrices[0]) : null,
            slug: m.slug,
          };
        });
      return reply.send({ ok: true, query: q, results });
    } catch (e) {
      return reply.code(502).send({ ok: false, error: `polymarket fetch fail: ${e.message}` });
    }
  });

  // GET /api/pool/market/:id/sides_merkle — return Merkle root + tree
  // GET /api/pool/market/:id — full row + computed status (= UI detail A.2b + cycle 5 poll-script fix)
  // Returns: { ok, market: {...all columns + parsed metadata}, sigs_collected, bettor_count }
  // GET /api/pool/markets — discovery list for the prediction-menu bot (S-C) + UI. S-B (Bettor r240).
  // Read-only. Filters: ?status= (e.g. pending_bettors), ?category= (politics/economy/sports/crypto/other),
  // ?limit= (default 50, cap 200), ?offset=. Newest first. Summary fields only + live bettor_count,
  // so the grammY menu can group by category without N round-trips.
  fastify.get('/api/pool/markets', async (request, reply) => {
    const q = request.query || {};
    const where = [];
    const params = [];
    if (q.status)   { where.push('protocol_status = ?'); params.push(String(q.status)); }
    if (q.category) { where.push('category = ?'); params.push(String(q.category)); }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = sqlite.prepare(`
      SELECT id, resolution_rule_spec, outcome_side, category, protocol_status,
             deadline, maker_stake_amount, oracle_bond_amount,
             outcome_market_source, outcome_condition_id, created_at,
             (SELECT COUNT(*) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id) AS bettor_count
      FROM pool_markets
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = sqlite.prepare(`SELECT COUNT(*) c FROM pool_markets ${whereSql}`).get(...params).c;
    const markets = rows.map(r => ({
      ...r,
      maker_stake_kas: r.maker_stake_amount != null ? r.maker_stake_amount / 1e8 : null,
    }));
    return reply.send({ ok: true, total, count: markets.length, limit, offset, markets });
  });

  fastify.get('/api/pool/market/:id', async (request, reply) => {
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    let metaParsed = {};
    try { metaParsed = JSON.parse(market.metadata || '{}'); } catch {}
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    const sigsCollected = sqlite.prepare(`
      SELECT COUNT(*) c FROM chain_events
      WHERE event_type IN ('pool_oracle_tx_sig', 'pool_oracle_refund_disagreement_tx_sig')
        AND payload LIKE ?
    `).get(`%"market_id":"${marketId}"%`).c;
    return reply.send({
      ok: true,
      market: { ...market, metadata: metaParsed },
      protocol_status: market.protocol_status,
      bettor_count: bettorCount,
      sigs_collected: sigsCollected,
    });
  });

  // GET /api/agent/roles?relay_id=X — returns {is_oracle, is_broker, is_maker} for UI role-conditional tabs (A.3)
  // is_oracle: relay_nodes.is_oracle column
  // is_broker / is_maker: existence as broker_relay_id / maker_relay_id in pool_markets (= per-market role)
  fastify.get('/api/agent/roles', async (request, reply) => {
    const relayId = request.query.relay_id;
    if (!relayId) return reply.code(400).send({ ok: false, error: 'relay_id query required' });
    const relay = sqlite.prepare('SELECT id, address, is_oracle FROM relay_nodes WHERE id = ?').get(relayId);
    if (!relay) return reply.code(404).send({ ok: false, error: 'relay not found' });
    const isMaker = sqlite.prepare('SELECT 1 FROM pool_markets WHERE maker_relay_id = ? LIMIT 1').get(relayId) ? 1 : 0;
    const isBroker = sqlite.prepare('SELECT 1 FROM pool_markets WHERE broker_relay_id = ? LIMIT 1').get(relayId) ? 1 : 0;
    return reply.send({
      ok: true,
      relay_id: relayId,
      address: relay.address,
      is_oracle: !!relay.is_oracle,
      is_broker: !!isBroker,
      is_maker: !!isMaker,
    });
  });

  fastify.get('/api/pool/market/:id/sides_merkle', async (request, reply) => {
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT id, sides_merkle_root FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });

    const bettors = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, merkle_index FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(b => b.bettor_pk));

    return reply.send({
      ok: true,
      market_id: marketId,
      sides_merkle_root: tree.root,
      bettor_count: bettors.length,
      bettors,
    });
  });

  // POST /api/pool/market/:id/settle — trigger settlement (= oracle vote + spine settle TX)
  fastify.post('/api/pool/market/:id/settle', async (request, reply) => {
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, not settle-ready` });
    }
    if (market.deadline > Math.floor(Date.now() / 1000)) {
      return reply.code(403).send({ ok: false, error: 'deadline not past yet' });
    }

    // Transition to verifying (= settler daemon picks up + triggers oracle vote)
    sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('verifying', marketId);

    return reply.send({
      ok: true,
      market_id: marketId,
      status: 'verifying',
      next_step: 'pool-settler cron picks up market, triggers 3 oracle vote, then spine settle TX',
    });
  });

  // POST /api/pool/market/:id/oracle/vote — manual oracle vote with explicit outcome.
  // For Owner UAT + stress testing (= Scenario 4 disagreement needs controlled outcomes).
  // Production path is the voter daemon's LLM-derived auto-vote; this is the manual override.
  fastify.post('/api/pool/market/:id/oracle/vote', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    if (!b.oracle_relay_id) return reply.code(400).send({ ok: false, error: 'oracle_relay_id required' });
    const outcome = (b.outcome || '').toUpperCase();
    // F1 (area-3 钦定 + Owner): protocol layer accepts only YES/NO. The "DISPUTE" exit was
    // spec-外 加戏 (pp.txt review found 0 mention in 5/21 spec). Oracle 接单 = commit to
    // YES/NO; uncertainty is handled at accept time (don't deposit). silent = bond forfeit.
    if (outcome !== 'YES' && outcome !== 'NO') {
      return reply.code(400).send({ ok: false, error: 'outcome must be YES or NO (DISPUTE removed per area-3 spec — oracle 接单 commits to YES/NO; uncertainty → reject at accept time)' });
    }

    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'verifying') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, not in 'verifying' (vote requires verifying state)` });
    }

    let oracleIds;
    try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
    if (!oracleIds.includes(b.oracle_relay_id)) {
      return reply.code(403).send({ ok: false, error: 'oracle_relay_id not in market oracle set' });
    }

    const oracleRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.oracle_relay_id);
    if (!oracleRow?.address) return reply.code(400).send({ ok: false, error: 'oracle relay has no resolvable address' });

    // Skip if already voted
    const existing = sqlite.prepare(`
      SELECT id FROM chain_events WHERE event_type = 'pool_oracle_vote'
        AND from_address = ? AND payload LIKE ? LIMIT 1
    `).get(oracleRow.address, `%"market_id":"${marketId}"%`);
    if (existing) return reply.code(409).send({ ok: false, error: 'this oracle already voted on this market' });

    // get oracle x-only pubkey via relay IPC
    let oraclePubkey;
    try {
      const pkResult = await sendCommandAsync(b.oracle_relay_id, { type: 'get_pubkey' });
      oraclePubkey = pkResult?.x_only_pubkey;
      if (!oraclePubkey || oraclePubkey.length !== 64) throw new Error(`get_pubkey invalid: ${oraclePubkey}`);
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `get_pubkey fail: ${e.message}` });
    }

    const unsignedPayload = {
      t: 'pool_oracle_vote_v1',
      market_id: marketId,
      voter_relay_id: b.oracle_relay_id,
      voter_pubkey: oraclePubkey,
      outcome,
      evidence_url: 'uat_manual_vote',
      evidence_hash: createHash('sha256').update(`uat_manual_vote:${outcome}`).digest('hex'),
      vote_timestamp: new Date().toISOString(),
    };
    let signature;
    try {
      const signResult = await sendCommandAsync(b.oracle_relay_id, { type: 'ecdsa_sign', message: JSON.stringify(unsignedPayload) });
      signature = signResult?.signature;
      if (!signature) throw new Error('ecdsa_sign returned empty');
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `ecdsa_sign fail: ${e.message}` });
    }
    const votePayload = { ...unsignedPayload, signature };

    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address) {
      try {
        await sendCommandAsync(b.oracle_relay_id, { type: 'send_message', target: makerRow.address, message: JSON.stringify(votePayload) });
      } catch { /* DM best-effort — chain_event is the source of truth for settler */ }
    }

    const syntheticTxid = `pool_oracle_vote:${b.oracle_relay_id.slice(0,8)}:${marketId.slice(0,12)}:${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'pool_oracle_vote', ?, ?, ?, 'uat-manual-vote', CURRENT_TIMESTAMP)
    `).run(randomUUID(), syntheticTxid, oracleRow.address, makerRow?.address || '', JSON.stringify(votePayload));

    const voteCount = sqlite.prepare(`
      SELECT COUNT(*) c FROM chain_events WHERE event_type = 'pool_oracle_vote' AND payload LIKE ?
    `).get(`%"market_id":"${marketId}"%`).c;

    return reply.send({
      ok: true,
      market_id: marketId,
      oracle_relay_id: b.oracle_relay_id,
      outcome,
      votes_recorded: voteCount,
      next_step: voteCount >= 3
        ? 'all 3 votes in — pool-settler cron will aggregate consensus + dispatch settle TX'
        : `${3 - voteCount} more oracle vote(s) needed`,
    });
  });
}
