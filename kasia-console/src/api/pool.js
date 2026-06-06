// B2 v0.5 Sub 2b — Pool API endpoints (5 endpoints per Bettor r330 5-endpoint plan)
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.

import { sqlite } from '../db/client.js';
import { computeSpineP2SH, computeSideP2SH } from '../lib/pool-p2sh.mjs';
import { buildSidesMerkleTree, getMerkleProof } from '../services/pool-merkle-builder.js';
import { sendCommandAsync, transferAndConfirm, isRelayAlive } from '../services/relay-manager.js';
import { getWorkingRpc } from '../services/rpc-health.js';
import { estimateStorageMass } from '../services/pool-market-settler.js';
import { categorizeMarket } from '../lib/market-category.js';
import { createHash, randomUUID } from 'node:crypto';

// L4 (area-11): create-time invariants. Hardcoded mirrors of the settler constants;
// kept inline rather than imported because they're stable v0.5 protocol values
// (KIP-9 standardness cap + W3 broker fee floor design choice). Area-10 hardening
// may refactor these into a shared protocol-constants module.
const STORAGE_MASS_SAFE_THRESHOLD_L4 = 400_000;  // KIP-9 cap with 20% buffer
const MIN_BROKER_FEE_SOMPI_L4 = 5_000_000;       // 0.05 KAS broker fee floor
// Bettor r158/Owner P2-3 LOCK — two-layer floor semantics split:
// PHYS_FLOOR = chain physics (KIP-9 storage mass). MUST never be lowered.
// POLICY = anti-bot product floor. May be tuned via spec discussion.
// 3-layer enforce per Bettor r158 §5.3c: (1) API register hard reject (2) consumer
// handlePoolBetRegistered reject (NWT r121 #1 - defends against malicious node directly
// broadcasting <POLICY bet to bypass producer) (3) committee scan skip (SS layer per r199/4).
const BETTOR_MIN_STAKE_PHYS_FLOOR = 100_000;     // 0.001 KAS — KIP-9 storage mass floor (J2 r108 measurement). Never lower.
const BETTOR_MIN_STAKE_POLICY = 100_000_000;     // 1 KAS — anti-bot product floor (Bettor r158/Owner P0).
const BETTOR_MIN_STAKE_L4 = BETTOR_MIN_STAKE_POLICY;  // Back-compat alias for existing callers — points to current active floor.
const MAX_BETTORS_L4 = 50;                       // PoolSpine.sil L13 cap
// 5/28 Owner 钦定: 押注 softcap 拆除 (= 之前 4 KAS testnet 限制阻 UI form 真用户测试). 改 Infinity = 0 cap.
// Per-market math guards (= storage mass / oracle fee floor) still enforce at L1 console + SS contract.
// Env override 保留可 ops set finite cap if needed.
const MAKER_STAKE_MAX_KAS = parseFloat(process.env.POOL_MAKER_STAKE_MAX_KAS) || Infinity;
// Owner 2026-06-06 钦定: maker 发起市场最低 100 KAS (= demo 实质押 + 抗灌水). Bettor ③ APPROVE r541 单一源.
const POOL_MAKER_STAKE_MIN_KAS = 100;

// KANet-UI 2026-06-06 (Bettor ③ APPROVE r546 + Bettor 钦定双层堵): 创建端结构化 spec 强制.
// 配 bot specIsUsable (= 展示端 filter, tg-bot/prediction-menu.mjs) 形成双层守门:
// 创建端拒 = 烂单源头堵; 展示端滤 = 历史烂单不显. Follow-up: 抽 lib/spec-validation
// (= cross-dir 真单一源 import), 短期接受 pool.js + bot 两处同步漂移风险, 改时一起改.
function isStructuredSpec(spec) {
  if (!spec) return false;
  const s = String(spec).trim();
  if (!s.startsWith('{')) return false;
  try {
    const obj = JSON.parse(s);
    return (
      typeof obj.title === 'string' && obj.title.trim().length > 0 &&
      typeof obj.resolution_criteria === 'string' && obj.resolution_criteria.trim().length > 0
    );
  } catch { return false; }
}

function deriveXOnlyPubkey(address) {
  return import('kaspa-wasm').then(kaspa => {
    return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
  });
}

// Bettor r117/r118/r120 cross-node hardening producer ② — broadcast market_publish
// onchain so remote nodes' Scout + trade-protocol-filter rebuild pool_markets locally.
// Best-effort: fail logs warn, doesn't fail create (spine_lock_tx already onchain).
//
// Bettor r128 (B) chunking: relay storage-mass safe budget ~450 char. Larger payloads chunked
// via pool_market_chunk_v1 envelope: {t, hash, ord, total, data}. hash = sha256 over the full
// inner payload string so consumer can verify reassembly integrity. data slice budget chosen
// so each chunk envelope stays under SAFE_CHUNK_BUDGET.
const SAFE_CHUNK_BUDGET = 450;  // hard ceiling per chunk (envelope + data)
// Envelope overhead at worst (3-digit ord/total, 64-hex hash, json quotes): ~110 chars. Leave 340 for data.
const CHUNK_DATA_BUDGET = 340;
async function _sendBroadcastChunked(relayId, channel, payloadStr) {
  if (payloadStr.length <= SAFE_CHUNK_BUDGET) {
    return await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: payloadStr });
  }
  const hash = createHash('sha256').update(payloadStr).digest('hex');
  const total = Math.ceil(payloadStr.length / CHUNK_DATA_BUDGET);
  const txIds = [];
  for (let ord = 0; ord < total; ord++) {
    const data = payloadStr.slice(ord * CHUNK_DATA_BUDGET, (ord + 1) * CHUNK_DATA_BUDGET);
    const chunkPayload = JSON.stringify({ t: 'pool_market_chunk_v1', hash, ord, total, data });
    const r = await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: chunkPayload });
    if (!r?.txId) throw new Error(`chunk ${ord+1}/${total} broadcast no txId: ${JSON.stringify(r).slice(0,200)}`);
    txIds.push(r.txId);
  }
  console.log(`[pool/broadcast] chunked ${payloadStr.length} chars → ${total} chunks hash=${hash.slice(0,8)} txIds=[${txIds.map(t=>t.slice(0,8)).join(',')}]`);
  return { ok: true, txId: txIds.join(','), chunks: total, hash };
}

// Schema pool_market_published_v1 (r179-locked, r180 3-way verified, r120 ACK).
// market_metadata_hash 3-way alignment (r180 grep verified L191-198): producer/consumer/spine
// all sha256(JSON.stringify({source, condition, token, side, end, rule})).
async function _broadcastMarketPublished(marketRow, makerRelayId) {
  try {
    const pkResult = await sendCommandAsync(makerRelayId, { type: 'get_pubkey' });
    const maker_relay_pk = pkResult?.x_only_pubkey;
    if (!maker_relay_pk || maker_relay_pk.length !== 64) throw new Error(`maker get_pubkey invalid: ${maker_relay_pk}`);

    const oracle_relay_pks = [marketRow.oracle1_pk, marketRow.oracle2_pk, marketRow.oracle3_pk].filter(Boolean);

    const unsignedPayload = {
      t: 'pool_market_published_v1',
      market_id: marketRow.id,
      spine_p2sh: marketRow.spine_p2sh,
      spine_lock_tx: marketRow.spine_lock_tx,
      market_metadata_hash: marketRow.market_metadata_hash,
      maker_relay_pk,
      outcome_market_source: marketRow.outcome_market_source,
      outcome_condition_id: marketRow.outcome_condition_id,
      outcome_token_id: marketRow.outcome_token_id,
      outcome_side: marketRow.outcome_side,
      resolution_rule_spec: marketRow.resolution_rule_spec,
      deadline: marketRow.deadline,
      miner_fee: marketRow.miner_fee,
      broker_fee_pct: marketRow.broker_fee_pct,
      oracle_bond_amount: marketRow.oracle_bond_amount,
      maker_stake_amount: marketRow.maker_stake_amount,
      oracle_relay_pks,
      broker_pk: marketRow.broker_pk,
      protocol_version: marketRow.protocol_version || 'v0.5',
      pool_merkle_root: marketRow.pool_merkle_root || null,
      // J2-tn r323: 跨节点 endBlock 确定性 anchor (Bettor 钦定 NWT+J1 合解).
      deadline_daa: marketRow.deadline_daa || null,
      category: marketRow.category,
      published_at: new Date().toISOString(),
    };
    const messageToSign = JSON.stringify(unsignedPayload);
    const signResult = await sendCommandAsync(makerRelayId, { type: 'ecdsa_sign', message: messageToSign });
    const signature = signResult?.signature;
    if (!signature) throw new Error('ecdsa_sign returned empty');

    const payloadStr = JSON.stringify({ ...unsignedPayload, signature });
    const bcastResult = await _sendBroadcastChunked(makerRelayId, 'kanet-prediction', payloadStr);
    const txId = bcastResult?.txId;
    if (!txId) throw new Error(`broadcast no txId: ${JSON.stringify(bcastResult).slice(0, 200)}`);
    console.log(`[pool/broadcast] market_published ${marketRow.id.slice(0, 12)} txId=${txId.slice(0, 16)}...`);
    return { ok: true, txId };
  } catch (e) {
    console.warn(`[pool/broadcast] market_publish fail ${marketRow.id?.slice(0, 12)}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Bettor r117/r120 cross-node hardening producer ② — broadcast bet_register onchain.
// NO signature (chain side_lock_tx UTXO at side_p2sh is truth anchor; consumer
// recomputes side_p2sh from bettor_pk + market.oracle_pks then verifies UTXO).
async function _broadcastBetRegistered(args) {
  const { market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, protocol_version, broadcaster_relay_id } = args;
  try {
    const unsignedPayload = {
      t: 'pool_bet_registered_v1',
      market_id, bettor_pk, direction, stake_amount,
      side_p2sh, side_lock_tx, merkle_index,
      protocol_version: protocol_version || 'v0.5',
      registered_at: new Date().toISOString(),
    };
    const bcastResult = await _sendBroadcastChunked(broadcaster_relay_id, 'kanet-prediction', JSON.stringify(unsignedPayload));
    const txId = bcastResult?.txId;
    if (!txId) throw new Error(`broadcast no txId: ${JSON.stringify(bcastResult).slice(0, 200)}`);
    console.log(`[pool/broadcast] bet_registered ${market_id.slice(0, 12)}/${bettor_pk.slice(0, 8)} txId=${txId.slice(0, 16)}...`);
    return { ok: true, txId };
  } catch (e) {
    console.warn(`[pool/broadcast] bet_register fail ${args.market_id?.slice(0, 12)}/${args.bettor_pk?.slice(0, 8)}: ${e.message}`);
    return { ok: false, error: e.message };
  }
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
    const minerFee = parseInt(b.miner_fee, 10) || 5_000_000;  // G6 批2 R40 floor (qlfpv brick sediment): SS 焊死 fee, mass 4420+ → mempool floor ~442_000 sompi >> 50_000 → reject
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
    // KANet-UI 2026-06-06 (Bettor ④ catch + 关 1 v2 APPROVE r544): 100 KAS 是 Owner 钦定 demo 实质押 policy,
    // 概念独立于 KANET_TESTNET_NO_LIMITS (= testnet 限制宽松). 移出守卫块, 无条件强制.
    if (makerStakeKas < POOL_MAKER_STAKE_MIN_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be >= ${POOL_MAKER_STAKE_MIN_KAS} KAS (Owner 钦定 demo 实质押 skin-in-game, 单一源 L33)` });
    // KANet-UI 2026-06-06 (Bettor ③ APPROVE r546): 创建端 spec 结构化强制 (= 配 bot 入口 filter 双层堵).
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria fields (= 源头堵 voo3z 类烂单, 配 bot specIsUsable 双层守门)' });
    // 5/28 Owner 钦定: testnet 0 limits. Skip dynamic min spendable + softcap when KANET_TESTNET_NO_LIMITS=1.
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
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
    const minerFee_L4 = parseInt(b.miner_fee, 10) || 5_000_000;  // G6 批2 R40 same floor as L231
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
    // Bettor r123 SHIP-BLOCK fix B: use persisted `deadline` (int unix seconds) NOT raw
    // b.outcome_end_date (string, not stored in pool_markets) — so consumer can recompute
    // hash from broadcast payload. Old code used ephemeral raw string, broadcast helper
    // read marketRow.outcome_end_date = undefined → 100% consumer silent reject.
    const metaInput = JSON.stringify({
      source: b.outcome_market_source,
      condition: b.outcome_condition_id,
      token: b.outcome_token_id,
      side: b.outcome_side,
      end: deadline,
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

    // Bettor r117/r120 producer ② cross-node broadcast (b-class market_publish gap fill).
    const _mrow = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    let _bcast = null;
    if (_mrow) _bcast = await _broadcastMarketPublished(_mrow, b.maker_relay_id);

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
      cross_node_publish_tx: _bcast?.txId || null,
      next_step: '3 oracle relays must call POST /api/pool/market/' + marketId + '/oracle/deposit',
    });
  });

  // POST /api/pool/market/create-v06 — v0.6 anonymous-pool oracle market (Bettor r3 lock + Owner ack 5/30).
  // SEPARATE endpoint (not a branch of /create) to keep the v0.5 path zero-risk per spec §7 ADDITIVE.
  // Differences from v0.5 create:
  //   - No oracle_relay_ids (committee is selected per-event off-chain by stake-weighted VRF, not baked).
  //   - Caller passes pool_merkle_root (depth-8 blake2b root of the pool snapshot; J2.1 derives + provides).
  //   - Spine SS = PoolSpine_v06.sil; computed via computeSpineP2SH_v06.
  //   - pool_markets stores protocol_version='v0.6' + pool_merkle_root for downstream settlement.
  //   - Status goes directly to 'pending_bettors' (no on-market oracle-deposit phase — committee bonds
  //     live at the pool-layer contract, not per-market).
  fastify.post('/api/pool/market/create-v06', async (request, reply) => {
    // 503 guard removed: path A LOCKED + shipped (Bettor r19, 5/30). Contracts now use 5
    // individual committee sigs (4-of-5 threshold) + committee ∈ poolMerkleRoot binding.
    const b = request.body || {};
    const required = ['maker_relay_id', 'outcome_side', 'outcome_end_date', 'resolution_rule_spec', 'maker_stake_kas', 'pool_merkle_root'];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || b[k] === '') return reply.code(400).send({ ok: false, error: `missing ${k}` });
    }
    if (b.broker_relay_id === undefined || b.broker_relay_id === null || b.broker_relay_id === '') b.broker_relay_id = b.maker_relay_id;
    if (b.broker_fee_pct === undefined || b.broker_fee_pct === null || b.broker_fee_pct === '') b.broker_fee_pct = 0;
    if (b.oracle_bond_kas === undefined || b.oracle_bond_kas === null || b.oracle_bond_kas === '') b.oracle_bond_kas = 1;
    if (b.oracle_fee_pct === undefined || b.oracle_fee_pct === null || b.oracle_fee_pct === '') b.oracle_fee_pct = 100;
    if (b.outcome_market_source === undefined || b.outcome_market_source === null || b.outcome_market_source === '') b.outcome_market_source = 'kanet_v06';
    if (b.outcome_token_id === undefined || b.outcome_token_id === null || b.outcome_token_id === '') b.outcome_token_id = 'KAS_native';
    if (b.outcome_condition_id === undefined || b.outcome_condition_id === null || b.outcome_condition_id === '') {
      b.outcome_condition_id = createHash('sha256').update(`${b.resolution_rule_spec}||${b.outcome_end_date}||${b.outcome_side}`).digest('hex').slice(0, 16);
    }
    if (b.category === undefined || b.category === null || b.category === '') {
      b.category = categorizeMarket(b.resolution_rule_spec);
    }

    // pool_merkle_root: 32-byte hex (64 chars, optional 0x prefix), lowercased.
    let poolMerkleRoot = String(b.pool_merkle_root).trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(poolMerkleRoot)) {
      return reply.code(400).send({ ok: false, error: 'pool_merkle_root must be 64 hex chars (32-byte depth-8 blake2b root)' });
    }
    poolMerkleRoot = poolMerkleRoot.toLowerCase();

    const makerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.maker_relay_id);
    const brokerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.broker_relay_id);
    if (!makerRow?.address || !brokerRow?.address) return reply.code(400).send({ ok: false, error: 'maker or broker relay has no resolvable address' });

    const makerPk = await deriveXOnlyPubkey(makerRow.address);
    const brokerPk = await deriveXOnlyPubkey(brokerRow.address);

    const minDeadlineMin = parseInt(process.env.POOL_DEADLINE_MIN_OVERRIDE, 10) || 15;
    const outcomeEndMs = new Date(b.outcome_end_date).getTime();
    if (!Number.isFinite(outcomeEndMs) || outcomeEndMs < Date.now() + minDeadlineMin * 60_000) {
      return reply.code(400).send({ ok: false, error: `outcome_end_date must be > now + ${minDeadlineMin} minutes` });
    }
    const maxDeadlineDay = parseInt(process.env.POOL_DEADLINE_MAX_DAY, 10) || 30;
    if (outcomeEndMs > Date.now() + maxDeadlineDay * 86400_000) {
      return reply.code(400).send({ ok: false, error: `outcome_end_date must be <= now + ${maxDeadlineDay} days` });
    }
    const deadline = Math.floor(outcomeEndMs / 1000);
    const minerFee = parseInt(b.miner_fee, 10) || 5_000_000;  // G6 批2 R40 floor (qlfpv brick sediment): SS 焊死 fee, mass 4420+ → mempool floor ~442_000 sompi >> 50_000 → reject
    const brokerFeePct = parseInt(b.broker_fee_pct, 10);
    if (!Number.isFinite(brokerFeePct) || brokerFeePct < 0 || brokerFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'broker_fee_pct must be 0-9999 basis points' });
    }
    const oracleFeePct = parseInt(b.oracle_fee_pct, 10);
    if (!Number.isFinite(oracleFeePct) || oracleFeePct < 0 || oracleFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'oracle_fee_pct must be 0-9999 basis points' });
    }

    // Stake validation (same dynamic floor as v0.5; KANET_TESTNET_NO_LIMITS-aware).
    const SS_MIN_SPENDABLE_FLOOR_KAS_V06 = 5;
    const dynamicMinKas = oracleFeePct > 0 ? Math.ceil(12500 / oracleFeePct) : 0;
    const minSpendableKas = Math.max(SS_MIN_SPENDABLE_FLOOR_KAS_V06, dynamicMinKas);
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1' && parseFloat(b.maker_stake_kas) < minSpendableKas) {
      return reply.code(400).send({ ok: false, error: `maker_stake_kas ${b.maker_stake_kas} < min spendable ${minSpendableKas} KAS` });
    }
    const makerStakeKas = parseFloat(b.maker_stake_kas);
    const oracleBondKas = parseFloat(b.oracle_bond_kas);
    if (!Number.isFinite(makerStakeKas) || makerStakeKas <= 0) return reply.code(400).send({ ok: false, error: 'maker_stake_kas must be positive' });
    if (!Number.isFinite(oracleBondKas) || oracleBondKas <= 0) return reply.code(400).send({ ok: false, error: 'oracle_bond_kas must be positive' });
    // 100 KAS Owner 钦定 demo 实质押 — 移出 NO_LIMITS 守卫 (r544 v2 Bettor APPROVE).
    if (makerStakeKas < POOL_MAKER_STAKE_MIN_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be >= ${POOL_MAKER_STAKE_MIN_KAS} KAS (Owner 钦定 demo 实质押 skin-in-game, 单一源 L33)` });
    // KANet-UI 2026-06-06 (Bettor ③ APPROVE r546): 创建端 spec 结构化强制 (= 配 bot 入口 filter 双层堵).
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria fields (= 源头堵 voo3z 类烂单, 配 bot specIsUsable 双层守门)' });
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (makerStakeKas > MAKER_STAKE_MAX_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be <= ${MAKER_STAKE_MAX_KAS} KAS` });
    }
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    const oracleBondAmount = Math.round(oracleBondKas * 1e8);
    const makerStakeStr = (makerStakeAmount / 1e8).toFixed(8);

    const metaInput = JSON.stringify({
      source: b.outcome_market_source,
      condition: b.outcome_condition_id,
      token: b.outcome_token_id,
      side: b.outcome_side,
      end: deadline,
      rule: b.resolution_rule_spec,
    });
    const marketMetadataHash = createHash('sha256').update(metaInput).digest('hex');

    // v0.6 spine P2SH via PoolSpine_v06.sil + the v06 builder.
    const network = makerRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const { computeSpineP2SH_v06 } = await import('../lib/pool-p2sh-v06.mjs');
    let spineResult;
    try {
      spineResult = await computeSpineP2SH_v06({
        makerPk, brokerPk, poolMerkleRoot,
        deadline, minerFee, brokerFeePct, oracleFeePct,
        oracleBondAmount, makerStakeAmount,
        marketMetadataHash,
        network,
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `v0.6 spine SS compile fail: ${e.message}` });
    }

    // Maker stake lock — NO TX NO STATE CHANGE.
    let spineTxId = null;
    try {
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr);
      spineTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `maker stake lock failed: ${err.message} (spine_p2sh=${spineResult.p2shAddr})` });
    }

    // INSERT pool_markets with v0.6 columns. oracle1/2/3_pk left NULL (v0.6 has no individual baked
    // oracles); oracle_relay_ids = '[]'; protocol_status straight to 'pending_bettors' (no oracle-
    // deposit phase — committee bonds live at the pool-layer contract, not per-market).
    const marketId = 'ext-pool-v06-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    try {
      const initialMetadata = JSON.stringify({
        spine_redeem_script_hex: spineResult.redeemScript,
        v06_pool_merkle_root: poolMerkleRoot,
      });
      sqlite.prepare(`INSERT INTO pool_markets (
        id, maker_relay_id, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category,
        protocol_version, pool_merkle_root
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, spineResult.p2shAddr, spineTxId, marketMetadataHash,
        null, null, null, brokerPk,
        deadline, minerFee, brokerFeePct, oracleBondAmount, makerStakeAmount,
        b.outcome_market_source, b.outcome_condition_id, b.outcome_token_id, b.outcome_side, b.resolution_rule_spec,
        'pending_bettors', '', '[]', b.broker_relay_id, initialMetadata, b.category,
        'v0.6', poolMerkleRoot,
      );
    } catch (e) {
      console.error(`[pool/create-v06] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail (spine TX done ${spineTxId}): ${e.message}` });
    }

    // Bettor r172/J1 r205 P0: F-S3 anti-grinding snapshot MUST be frozen @ create. Lazy build
    // at settler-tick would let attacker observe endBlockHash then mutate pool to grind.
    // Throws on root drift = caller fed wrong root; idempotent on re-create.
    try {
      const { ensurePoolSnapshot } = await import('../services/pool-market-settler-v06.mjs');
      ensurePoolSnapshot(marketId, poolMerkleRoot);
    } catch (snapErr) {
      console.error(`[pool/create-v06] ensurePoolSnapshot fail market=${marketId.slice(0,12)}: ${snapErr.message}`);
      // Don't 500 — spine TX already on chain. Market is partially registered (pool_markets row
      // exists, pool_snapshots missing). Operator can re-run via backfill script.
    }

    // Bettor r117/r120 producer ② cross-node broadcast (= same as v0.5 create above).
    const _mrowV06 = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    let _bcastV06 = null;
    if (_mrowV06) _bcastV06 = await _broadcastMarketPublished(_mrowV06, b.maker_relay_id);

    return reply.send({
      ok: true,
      market_id: marketId,
      protocol_version: 'v0.6',
      spine_p2sh: spineResult.p2shAddr,
      spine_lock_tx: spineTxId,
      pool_merkle_root: poolMerkleRoot,
      maker_stake_locked_kas: makerStakeAmount / 1e8,
      miner_fee_sompi: minerFee,
      broker_fee_pct_bps: brokerFeePct,
      cross_node_publish_tx: _bcastV06?.txId || null,
      category: b.category,
      status: 'pending_bettors',
      next_step: 'bettors register directly via POST /api/pool/market/' + marketId + '/bettor/register-external/{prep,confirm} — no oracle-deposit phase in v0.6 (committee selected per-event off-chain).',
    });
  });

  // ── POST /api/pool/market/create-v07 (G6 批 3 段① 最小单片 wire, Bettor r296) ──
  //
  // v0.7 differences from create-v06:
  //   - Uses PoolSpine_v07.sil / PoolSide_v07.sil (= fee 范围 [MIN_FEE, MAX_FEE] not 焊死 ctor minerFee).
  //   - Spine ctor adds 3 sharding params: shard_id (default 0) / shard_count (default 1 = single-shard) /
  //     market_id (= blake2b(marketId string) for cross-shard binding in batch3 future).
  //   - protocol_version='v0.7' marker in pool_markets row.
  //   - Settler dispatchRefund/dispatchPhase2 will branch on protocol_version='v0.7' to use mass-aware
  //     dynamic fee within SS range (= 47ff13d fixed minerFee 不适用 v0.7, refund 选 fee in [50_000, 1e8]).
  //
  // Body params identical to create-v06 + optional shard_id/shard_count (default 0/1 single-shard).
  fastify.post('/api/pool/market/create-v07', async (request, reply) => {
    const b = request.body || {};
    const required = ['maker_relay_id', 'outcome_side', 'outcome_end_date', 'resolution_rule_spec', 'maker_stake_kas'];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || b[k] === '') return reply.code(400).send({ ok: false, error: `missing ${k}` });
    }
    // DoD #1.1 (T2 sediment): pool_merkle_root optional / 'auto' / missing → server auto-derives
    // from current pool state. testnet 简单 path. mainnet caller pins explicit root (= TOCTOU).
    if (!b.pool_merkle_root || b.pool_merkle_root === 'auto') {
      try {
        const { derivePoolMerkleRoot } = await import('../services/pool-market-settler-v06.mjs');
        // DoD #17 (Bettor r447 钦点 chain-derived 池活化): fetch currentDaa → snapshotDaa=
        // currentDaa-FINALITY_N → ensure scanAndDerivePool 缓存 → derivePoolMerkleRoot(snapshotDaa)
        // 走 chain_view 单一读源, 切掉 legacy null 路 (= 跨节点确定 ctor root==derive(snapshotDaa)).
        const { getWorkingRpc } = await import('../services/rpc-health.js');
        const { url: rpcUrl } = await getWorkingRpc();
        const { RpcClient, Encoding } = await import('kaspa-wasm');
        const network = process.env.KASPA_NETWORK || 'testnet-12';
        const FINALITY_N = parseInt(process.env.ORACLE_POOL_FINALITY_N, 10) || 600;
        const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: network });
        await rpc.connect();
        let snapshotDaa;
        let currentDaa;
        try {
          const dag = await rpc.getBlockDagInfo();
          currentDaa = Number(dag.virtualDaaScore);
          snapshotDaa = currentDaa - FINALITY_N;
          const { scanAndDerivePool } = await import('../services/oracle-pool-chain-scanner.mjs');
          await scanAndDerivePool({ rpc, networkId: network, currentDaa });
        } finally { try { await rpc.disconnect(); } catch {} }
        const derived = derivePoolMerkleRoot(snapshotDaa);
        b.pool_merkle_root = derived.pool_merkle_root;
        b._snapshot_daa = snapshotDaa;
        // J2-tn r323 (Bettor 钦定 NWT+J1 合解): 烤 deadline_daa 入 market row + envelope.
        // 公式: currentDaa + (deadline_ms - now_ms) / 100ms BPS (= Kaspa 10 BPS). maker 在 create 时
        // 拍未来 daa 不可知 endBlockHash (= 守 anti-grinding). 各节点跨节点同字段不重估, 消 settler:284
        // wallclock estimate 偏移 (= #3 hash mismatch 命门).
        const deadlineMs = new Date(b.outcome_end_date).getTime();
        const nowMs = Date.now();
        const daaDelta = Math.max(0, Math.floor((deadlineMs - nowMs) / 100));
        b._deadline_daa = currentDaa + daaDelta;
        console.log(`[pool/create-v07] auto-derived pool_merkle_root=${b.pool_merkle_root.slice(0,12)}.. snapshotDaa=${snapshotDaa} pool_size=${derived.pool_size} source=${derived.source || 'chain_view'} deadline_daa=${b._deadline_daa} (= currentDaa ${currentDaa} + ${daaDelta} 未来 DAA)`);
      } catch (e) {
        return reply.code(503).send({ ok: false, error: `pool_merkle_root auto-derive fail: ${e.message}` });
      }
    }
    if (b.broker_relay_id === undefined || b.broker_relay_id === null || b.broker_relay_id === '') b.broker_relay_id = b.maker_relay_id;
    if (b.broker_fee_pct === undefined || b.broker_fee_pct === null || b.broker_fee_pct === '') b.broker_fee_pct = 0;
    if (b.oracle_bond_kas === undefined || b.oracle_bond_kas === null || b.oracle_bond_kas === '') b.oracle_bond_kas = 1;
    if (b.oracle_fee_pct === undefined || b.oracle_fee_pct === null || b.oracle_fee_pct === '') b.oracle_fee_pct = 100;
    if (b.outcome_market_source === undefined || b.outcome_market_source === null || b.outcome_market_source === '') b.outcome_market_source = 'kanet_v07';
    if (b.outcome_token_id === undefined || b.outcome_token_id === null || b.outcome_token_id === '') b.outcome_token_id = 'KAS_native';
    if (b.outcome_condition_id === undefined || b.outcome_condition_id === null || b.outcome_condition_id === '') {
      b.outcome_condition_id = createHash('sha256').update(`${b.resolution_rule_spec}||${b.outcome_end_date}||${b.outcome_side}`).digest('hex').slice(0, 16);
    }
    if (b.category === undefined || b.category === null || b.category === '') {
      b.category = categorizeMarket(b.resolution_rule_spec);
    }

    let poolMerkleRoot = String(b.pool_merkle_root).trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(poolMerkleRoot)) {
      return reply.code(400).send({ ok: false, error: 'pool_merkle_root must be 64 hex chars (32-byte depth-8 blake2b root)' });
    }
    poolMerkleRoot = poolMerkleRoot.toLowerCase();

    const makerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.maker_relay_id);
    const brokerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.broker_relay_id);
    if (!makerRow?.address || !brokerRow?.address) return reply.code(400).send({ ok: false, error: 'maker or broker relay has no resolvable address' });

    const makerPk = await deriveXOnlyPubkey(makerRow.address);
    const brokerPk = await deriveXOnlyPubkey(brokerRow.address);

    const minDeadlineMin = parseInt(process.env.POOL_DEADLINE_MIN_OVERRIDE, 10) || 15;
    const outcomeEndMs = new Date(b.outcome_end_date).getTime();
    if (!Number.isFinite(outcomeEndMs) || outcomeEndMs < Date.now() + minDeadlineMin * 60_000) {
      return reply.code(400).send({ ok: false, error: `outcome_end_date must be > now + ${minDeadlineMin} minutes` });
    }
    const maxDeadlineDay = parseInt(process.env.POOL_DEADLINE_MAX_DAY, 10) || 30;
    if (outcomeEndMs > Date.now() + maxDeadlineDay * 86400_000) {
      return reply.code(400).send({ ok: false, error: `outcome_end_date must be <= now + ${maxDeadlineDay} days` });
    }
    const deadline = Math.floor(outcomeEndMs / 1000);
    // v0.7 SS refund_maker_unjoined L370-373 uses fee 范围 [MIN_FEE=50_000, MAX_FEE=100M]. ctor
    // minerFee 仍 in ctor for backward compat / settle entry but refund 不读. 5M floor 仍 safe
    // (= L284-285 ctor validate 0<minerFee<1e8, 5M 通过) + 不打架 (R241 verify, Bettor ack).
    const minerFee = parseInt(b.miner_fee, 10) || 5_000_000;
    const brokerFeePct = parseInt(b.broker_fee_pct, 10);
    if (!Number.isFinite(brokerFeePct) || brokerFeePct < 0 || brokerFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'broker_fee_pct must be 0-9999 basis points' });
    }
    const oracleFeePct = parseInt(b.oracle_fee_pct, 10);
    if (!Number.isFinite(oracleFeePct) || oracleFeePct < 0 || oracleFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'oracle_fee_pct must be 0-9999 basis points' });
    }

    // Sharding params (single-shard default: shard_id=0, shard_count=1). Multi-shard 批3 ship 后开放.
    const shardId = parseInt(b.shard_id, 10);
    const shardCount = parseInt(b.shard_count, 10);
    const shard_id = Number.isFinite(shardId) && shardId >= 0 ? shardId : 0;
    const shard_count = Number.isFinite(shardCount) && shardCount >= 1 ? shardCount : 1;
    if (shard_id >= shard_count) return reply.code(400).send({ ok: false, error: `shard_id ${shard_id} >= shard_count ${shard_count}` });

    const SS_MIN_SPENDABLE_FLOOR_KAS_V07 = 5;
    const dynamicMinKas = oracleFeePct > 0 ? Math.ceil(12500 / oracleFeePct) : 0;
    const minSpendableKas = Math.max(SS_MIN_SPENDABLE_FLOOR_KAS_V07, dynamicMinKas);
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1' && parseFloat(b.maker_stake_kas) < minSpendableKas) {
      return reply.code(400).send({ ok: false, error: `maker_stake_kas ${b.maker_stake_kas} < min spendable ${minSpendableKas} KAS` });
    }
    const makerStakeKas = parseFloat(b.maker_stake_kas);
    const oracleBondKas = parseFloat(b.oracle_bond_kas);
    if (!Number.isFinite(makerStakeKas) || makerStakeKas <= 0) return reply.code(400).send({ ok: false, error: 'maker_stake_kas must be positive' });
    if (!Number.isFinite(oracleBondKas) || oracleBondKas <= 0) return reply.code(400).send({ ok: false, error: 'oracle_bond_kas must be positive' });
    // 100 KAS Owner 钦定 demo 实质押 — 移出 NO_LIMITS 守卫 (r544 v2 Bettor APPROVE).
    if (makerStakeKas < POOL_MAKER_STAKE_MIN_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be >= ${POOL_MAKER_STAKE_MIN_KAS} KAS (Owner 钦定 demo 实质押 skin-in-game, 单一源 L33)` });
    // KANet-UI 2026-06-06 (Bettor ③ APPROVE r546): 创建端 spec 结构化强制 (= 配 bot 入口 filter 双层堵).
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria fields (= 源头堵 voo3z 类烂单, 配 bot specIsUsable 双层守门)' });
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (makerStakeKas > MAKER_STAKE_MAX_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be <= ${MAKER_STAKE_MAX_KAS} KAS` });
    }
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    const oracleBondAmount = Math.round(oracleBondKas * 1e8);
    const makerStakeStr = (makerStakeAmount / 1e8).toFixed(8);

    const metaInput = JSON.stringify({
      source: b.outcome_market_source,
      condition: b.outcome_condition_id,
      token: b.outcome_token_id,
      side: b.outcome_side,
      end: deadline,
      rule: b.resolution_rule_spec,
    });
    const marketMetadataHash = createHash('sha256').update(metaInput).digest('hex');

    // Generate marketId FIRST so we can derive market_id hash for SS ctor.
    const marketId = 'ext-pool-v07-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const network = makerRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const { computeSpineP2SH_v07, deriveMarketIdHash } = await import('../lib/pool-p2sh-v07.mjs');
    const market_id_hash = deriveMarketIdHash(marketId);

    let spineResult;
    try {
      spineResult = await computeSpineP2SH_v07({
        makerPk, brokerPk, poolMerkleRoot,
        deadline, minerFee, brokerFeePct, oracleFeePct,
        oracleBondAmount, makerStakeAmount,
        marketMetadataHash,
        shard_id, shard_count, market_id: market_id_hash,
        network,
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `v0.7 spine SS compile fail: ${e.message}` });
    }

    let spineTxId = null;
    try {
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr);
      spineTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `maker stake lock failed: ${err.message} (spine_p2sh=${spineResult.p2shAddr})` });
    }

    try {
      const initialMetadata = JSON.stringify({
        spine_redeem_script_hex: spineResult.redeemScript,
        v07_pool_merkle_root: poolMerkleRoot,
        v07_shard_id: shard_id,
        v07_shard_count: shard_count,
        v07_market_id_hash: market_id_hash,
      });
      sqlite.prepare(`INSERT INTO pool_markets (
        id, maker_relay_id, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category,
        protocol_version, pool_merkle_root, deadline_daa
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, spineResult.p2shAddr, spineTxId, marketMetadataHash,
        null, null, null, brokerPk,
        deadline, minerFee, brokerFeePct, oracleBondAmount, makerStakeAmount,
        b.outcome_market_source, b.outcome_condition_id, b.outcome_token_id, b.outcome_side, b.resolution_rule_spec,
        'pending_bettors', '', '[]', b.broker_relay_id, initialMetadata, b.category,
        'v0.7', poolMerkleRoot, b._deadline_daa || null,
      );
    } catch (e) {
      console.error(`[pool/create-v07] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail (spine TX done ${spineTxId}): ${e.message}` });
    }

    try {
      const { ensurePoolSnapshot } = await import('../services/pool-market-settler-v06.mjs');
      // J2-tn r308 fix: 必传 snapshotDaa 走 chain_view 分支 (= 路 A 后 oracle_pool_membership 已
      // v164 清空, legacy 分支必 throw "membership empty"). chain_view 路径读 oracle_pool_chain_view
      // 缓存 (= L614 scanAndDerivePool 刚填充). 同 commit b213c676 chain-derived 池一致.
      ensurePoolSnapshot(marketId, poolMerkleRoot, b._snapshot_daa || null);
    } catch (snapErr) {
      console.error(`[pool/create-v07] ensurePoolSnapshot fail market=${marketId.slice(0,12)}: ${snapErr.message}`);
    }

    const _mrowV07 = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    let _bcastV07 = null;
    if (_mrowV07) _bcastV07 = await _broadcastMarketPublished(_mrowV07, b.maker_relay_id);

    return reply.send({
      ok: true,
      market_id: marketId,
      protocol_version: 'v0.7',
      spine_p2sh: spineResult.p2shAddr,
      spine_lock_tx: spineTxId,
      pool_merkle_root: poolMerkleRoot,
      maker_stake_locked_kas: makerStakeAmount / 1e8,
      miner_fee_sompi: minerFee,
      broker_fee_pct_bps: brokerFeePct,
      shard_id, shard_count, market_id_hash,
      cross_node_publish_tx: _bcastV07?.txId || null,
      category: b.category,
      status: 'pending_bettors',
      next_step: 'bettors register directly via POST /api/pool/market/' + marketId + '/bettor/register-v07/{prep,confirm} (TODO 批3) OR reuse register-v06 endpoint for single-shard wire (= same flow, just different protocol_version branch in handler).',
    });
  });

  // GET /api/pool/config — static defaults for UI pre-submit preview (D4 wallet浮窗 estimate fee)
  fastify.get('/api/pool/config', async (request, reply) => {
    return reply.send({
      ok: true,
      default_miner_fee_sompi: 50_000,
      maker_stake_min_kas: POOL_MAKER_STAKE_MIN_KAS,   // 单一源, 见 L33 const
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
    // Bettor r25 + J2 r108: physical floor only (= chain KIP-9 storage mass), no rounded product floor.
    // J2 measured: stake² >= 2.5e9 sompi (= 50500 sompi math floor); 100_000 sompi = 0.001 KAS with 4× safety.
    if (stakeAmount < BETTOR_MIN_STAKE_POLICY) return reply.code(400).send({ ok: false, error: `stake_kas must be >= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS (anti-bot product floor, Bettor r158 P2-3 LOCK; physical KIP-9 floor is ${BETTOR_MIN_STAKE_PHYS_FLOOR / 1e8} KAS but policy gates above)` });

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

    // Compute side P2SH — J2-tn r316 (Bettor 总闸): branch by protocol_version.
    // v0.5 uses oracle1/2/3_pk in ctor. v0.6/v0.7 uses pool_merkle_root (= per-event
    // committee chosen at settle), oracle1/2/3_pk = NULL on row. 不分支 → v0.7 押注全死
    // 'oracle1Pk must be hex string' (= NULL parse fail).
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');
    const network = bettorRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';

    let sideResult;
    try {
      if (market.protocol_version === 'v0.7') {
        if (!market.pool_merkle_root) throw new Error('v0.7 market missing pool_merkle_root');
        const { computeSideP2SH_v07 } = await import('../lib/pool-p2sh-v07.mjs');
        sideResult = await computeSideP2SH_v07({
          bettorPk, spineP2shHash,
          poolMerkleRoot: market.pool_merkle_root,
          marketMetadataHash: market.market_metadata_hash,
          direction, deadline: market.deadline, network,
        });
      } else if (market.protocol_version === 'v0.6') {
        if (!market.pool_merkle_root) throw new Error('v0.6 market missing pool_merkle_root');
        const { computeSideP2SH_v06 } = await import('../lib/pool-p2sh-v06.mjs');
        sideResult = await computeSideP2SH_v06({
          bettorPk, spineP2shHash,
          poolMerkleRoot: market.pool_merkle_root,
          marketMetadataHash: market.market_metadata_hash,
          direction, stakeAmount, deadline: market.deadline, network,
        });
      } else {
        // v0.5 legacy (null protocol_version OR explicit 'v0.5')
        const oraclePks = [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk];
        sideResult = await computeSideP2SH({
          bettorPk, spineP2shHash, oraclePks,
          marketMetadataHash: market.market_metadata_hash,
          direction, stakeAmount, deadline: market.deadline,
          network,
        });
      }
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
    // Bettor r25 + J2 r108 KIP-9 measurement: physical floor only (= chain storage mass), no product floor.
    if (stakeAmount < BETTOR_MIN_STAKE_POLICY) return { error: `stake_kas must be >= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS (anti-bot product floor, Bettor r158 P2-3 LOCK; physical KIP-9 floor is ${BETTOR_MIN_STAKE_PHYS_FLOOR / 1e8} KAS but policy gates above)`, code: 400 };
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
    // Owner P0 (Bettor r23): "1 address 1 market 1 position" prep-guard removed — was an
    // architectural byproduct of v0.5 UNIQUE(market_id, bettor_pk), 0 user-need. Bettors may now
    // 加仓/两边押/多次 (mature prediction market standard). Each (bettor_pk, direction, stake)
    // tuple deterministically computes a distinct side P2SH, so multiple positions are naturally
    // disambiguated. J2 v160 will drop the UNIQUE index → behavior change fully effective.
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
    // Detect the payment by querying the side P2SH's UTXOs DIRECTLY via RPC (Bettor r283 verified).
    // Authoritative + real-time + indexer-INDEPENDENT: the kaspa_tx_log indexer only covers WATCHED
    // addresses (relay-pulled), and a non-relay side P2SH is NOT watched, so an external user's payment
    // would never be indexed (P0, Bettor r282 — my earlier kaspa_tx_log approach only passed e2e because
    // the test payer was a relay = watched). getUtxosByAddresses sees the UTXO regardless of payer or
    // indexing, and works for already-landed payments; the UTXO's outpoint.transactionId is the side_lock_tx.
    let utxos;
    try {
      const { url: rpcUrl } = await getWorkingRpc();
      if (!rpcUrl) return reply.code(503).send({ ok: false, error: 'no working Kaspa RPC node — retry shortly' });
      const { RpcClient, Encoding, Address } = await import('kaspa-wasm');
      const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: d.network });
      await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 4000))]);
      try { ({ entries: utxos } = await rpc.getUtxosByAddresses([new Address(sideP2sh)])); }
      finally { await rpc.disconnect().catch(() => {}); }
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `RPC UTXO query failed (${e.message}) — retry shortly` });
    }
    utxos = utxos || [];
    // P2-3 Sub 2 LOCK (Bettor r163 +Owner): variable-amount per-UTXO independent claim.
    // OLD: exact-match wantSompi vs UTXO.amount. NEW: find FIRST unregistered UTXO at
    // side_p2sh; actual stake = UTXO.amount; POLICY floor still enforced. 1 confirm = 1 bet.
    // body stake_kas validated >= POLICY earlier (early sanity) but not exact-match.
    const registeredTxs = new Set(
      sqlite.prepare('SELECT side_lock_tx FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ?')
        .all(marketId, d.bettorPk, v.direction).map(r => r.side_lock_tx)
    );
    const candidate = utxos.find(u => {
      const op = u.outpoint || u.entry?.outpoint;
      const txid = op && (op.transactionId || op.transaction_id);
      return txid && !registeredTxs.has(txid);
    });
    if (!candidate) {
      if (utxos.length > 0 && registeredTxs.size > 0) {
        // All payments already registered — return the most recent registration as reply.
        const mineLatest = sqlite.prepare('SELECT side_lock_tx, merkle_index, stake_amount FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? ORDER BY id DESC LIMIT 1')
          .get(marketId, d.bettorPk, v.direction);
        if (mineLatest) return reply.send({ ok: true, registered: true, already_registered: true, side_p2sh: sideP2sh, side_lock_tx: mineLatest.side_lock_tx, merkle_index: mineLatest.merkle_index, stake_sompi: mineLatest.stake_amount });
      }
      return reply.send({ ok: true, registered: false, pending: true, side_p2sh: sideP2sh, note: `no unregistered payment detected at side_p2sh — pay any amount >= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS to claim a bet.` });
    }
    const op = candidate.outpoint || candidate.entry?.outpoint;
    const txId = op && (op.transactionId || op.transaction_id);
    if (!txId) return reply.code(500).send({ ok: false, error: 'unregistered UTXO outpoint.transactionId missing' });
    let actualStakeSompi;
    try { actualStakeSompi = BigInt(candidate.amount); }
    catch { return reply.code(500).send({ ok: false, error: `UTXO amount not BigInt-parseable: ${candidate.amount}` }); }
    if (actualStakeSompi < BigInt(BETTOR_MIN_STAKE_POLICY)) {
      return reply.send({ ok: true, registered: false, dust_below_floor: true, side_p2sh: sideP2sh, found_sompi: actualStakeSompi.toString(), policy_sompi: String(BETTOR_MIN_STAKE_POLICY), side_lock_tx_candidate: txId, note: `UTXO ${actualStakeSompi} sompi < POLICY floor ${BETTOR_MIN_STAKE_POLICY} sompi (= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS). Pay at least the floor to register. Below-floor deposits remain locked at side_p2sh until refund.` });
    }
    const stakeAmountInt = Number(actualStakeSompi);  // safe: even 90M KAS = 9e15 sompi < Number.MAX_SAFE_INTEGER
    // ③ idempotent: rare race where same TX registers twice between SELECT + INSERT.
    const already = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, merkle_index FROM pool_bettor_sides WHERE market_id = ? AND side_lock_tx = ?').get(marketId, txId);
    if (already) return reply.send({ ok: true, registered: true, already_registered: true, side_lock_tx: txId, ...already });
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    if (bettorCount >= 50) return reply.code(409).send({ ok: false, error: 'market full — 50 bet slots max per market' });
    const merkleIndex = bettorCount;
    try {
      sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(marketId, d.bettorPk, null, v.direction, stakeAmountInt, sideP2sh, txId, merkleIndex, d.sideResult.redeemScript);
    } catch (e) {
      console.error(`[pool/register-external/confirm] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail: ${e.message}` });
    }
    const bettors = sqlite.prepare('SELECT bettor_pk FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(x => x.bettor_pk));
    sqlite.prepare('UPDATE pool_markets SET sides_merkle_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(tree.root, marketId);

    // Producer cross-node broadcast: stake_amount uses ACTUAL UTXO value (Bettor r163 (c) LOCK).
    const _bcastBet = await _broadcastBetRegistered({
      market_id: marketId, bettor_pk: d.bettorPk, direction: v.direction, stake_amount: stakeAmountInt,
      side_p2sh: sideP2sh, side_lock_tx: txId, merkle_index: merkleIndex,
      protocol_version: market.protocol_version || 'v0.5',
      broadcaster_relay_id: market.maker_relay_id,
    });

    return reply.send({
      ok: true, registered: true, market_id: marketId, bettor_pk: d.bettorPk, direction: v.direction,
      side_p2sh: sideP2sh, side_lock_tx: txId, merkle_index: merkleIndex, sides_merkle_root: tree.root,
      stake_sompi: stakeAmountInt, stake_kas: (stakeAmountInt / 1e8).toFixed(8),
      bettor_count: bettorCount + 1, external: true,
      cross_node_publish_tx: _bcastBet?.txId || null,
    });
  });

  // ── v0.6 path A external (0-key) pool betting — parallel to v0.5 /register-external/{prep,confirm}.
  // Bettor r19 LOCK + Owner ack (5/30). Differences from v0.5:
  // - market.protocol_version='v0.6' (= computed via computeSpineP2SH_v06 + PoolSpine_v06.sil settle_aggregate path A).
  // - Side P2SH derived via computeSideP2SH_v06 — needs market.pool_merkle_root (v158 column) in ctor.
  // - No oracle1/2/3_pk on v0.6 market rows; oracle-exclusivity check is skipped (committee is per-event).
  // - Same exact-stake / wrong-payment-locked / 50-bettor-cap semantics as v0.5.
  async function _extStakeDeriveSide_v06(market, linkedAddr, direction, stakeAmount) {
    const bettorPk = await deriveXOnlyPubkey(linkedAddr);
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address && (await deriveXOnlyPubkey(makerRow.address)) === bettorPk) {
      throw Object.assign(new Error('linked address is the market maker — maker bets implicitly via outcome_side (area-1)'), { code: 403 });
    }
    if (!market.pool_merkle_root) {
      throw Object.assign(new Error('v0.6 market missing pool_merkle_root — corrupt market row'), { code: 500 });
    }
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');
    const network = market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const { computeSideP2SH_v06 } = await import('../lib/pool-p2sh-v06.mjs');
    const sideResult = await computeSideP2SH_v06({
      bettorPk, spineP2shHash,
      poolMerkleRoot: market.pool_merkle_root,
      marketMetadataHash: market.market_metadata_hash,
      direction, stakeAmount, deadline: market.deadline, network,
    });
    return { bettorPk, sideResult, network };
  }

  // DoD #1.3 (Bettor r316): v0.7 dual-handle for register-v06 endpoints. PoolSide_v07.sil ctor is
  // identical to v0.6 (= 6 args, deadline last) per pool-p2sh-v07.mjs:90-94. Diff is entry bodies
  // only (= claim_winner / refund_market_cancelled fee 范围). So same wire path works; just route
  // to computeSideP2SH_v07 helper which uses PoolSide_v07.sil binary.
  async function _extStakeDeriveSide_v07(market, linkedAddr, direction, stakeAmount) {
    const bettorPk = await deriveXOnlyPubkey(linkedAddr);
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address && (await deriveXOnlyPubkey(makerRow.address)) === bettorPk) {
      throw Object.assign(new Error('linked address is the market maker — maker bets implicitly via outcome_side (area-1)'), { code: 403 });
    }
    if (!market.pool_merkle_root) {
      throw Object.assign(new Error('v0.7 market missing pool_merkle_root — corrupt market row'), { code: 500 });
    }
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');
    const network = market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const { computeSideP2SH_v07 } = await import('../lib/pool-p2sh-v07.mjs');
    const sideResult = await computeSideP2SH_v07({
      bettorPk, spineP2shHash,
      poolMerkleRoot: market.pool_merkle_root,
      marketMetadataHash: market.market_metadata_hash,
      direction, deadline: market.deadline, network,
    });
    return { bettorPk, sideResult, network };
  }

  // Branch helper by protocol_version. v0.6/v0.7 use same endpoint, different SIL binary.
  async function _extStakeDeriveSide(market, linkedAddr, direction, stakeAmount) {
    if (market.protocol_version === 'v0.7') {
      return _extStakeDeriveSide_v07(market, linkedAddr, direction, stakeAmount);
    }
    return _extStakeDeriveSide_v06(market, linkedAddr, direction, stakeAmount);
  }

  // POST /api/pool/market/:id/bettor/register-v06/prep — v0.6+v0.7 step 1: compute side P2SH + exact stake.
  // DoD #1.3: dual-handles v0.6 and v0.7 markets (PoolSide ctor identical, helper switches by version).
  fastify.post('/api/pool/market/:id/bettor/register-v06/prep', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    const v = _extStakeValidate(b);
    if (v.error) return reply.code(v.code).send({ ok: false, error: v.error });
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_version !== 'v0.6' && market.protocol_version !== 'v0.7') return reply.code(400).send({ ok: false, error: `market protocol_version=${market.protocol_version || 'v0.5'}, use /register-external for v0.5` });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, bettor registration closed` });
    }
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    if (bettorCount >= 50) return reply.code(409).send({ ok: false, error: 'market full — 50 bettors max per market' });
    let d;
    try { d = await _extStakeDeriveSide(market, b.linked_addr, v.direction, v.stakeAmount); }
    catch (e) { return reply.code(e.code || 500).send({ ok: false, error: e.message }); }
    // Owner P0 (Bettor r23): "1 addr 1 mkt 1 pos" prep-guard stripped — see v0.5 prep above for full rationale.
    return reply.send({
      ok: true,
      protocol_version: market.protocol_version,
      market_id: marketId,
      direction: v.direction,
      bettor_pk: d.bettorPk,
      side_p2sh: d.sideResult.p2shAddr,
      redeem_script: d.sideResult.redeemScript,
      pool_merkle_root: market.pool_merkle_root,
      exact_stake_sompi: v.stakeAmount,
      exact_stake_kas: (v.stakeAmount / 1e8).toFixed(8),
      network: d.network,
      deadline: market.deadline,
      warning: 'Pay EXACTLY exact_stake_sompi to side_p2sh. Underpayment is locked until deadline; overpayment excess is lost to fee. Claim winnings with your /link-bound key + 4-of-5 committee sigs at settle time.',
    });
  });

  // POST /api/pool/market/:id/bettor/register-v06/confirm — v0.6 step 2: detect/verify payment → register.
  fastify.post('/api/pool/market/:id/bettor/register-v06/confirm', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    const v = _extStakeValidate(b);
    if (v.error) return reply.code(v.code).send({ ok: false, error: v.error });
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_version !== 'v0.6' && market.protocol_version !== 'v0.7') return reply.code(400).send({ ok: false, error: `market protocol_version=${market.protocol_version || 'v0.5'}, use /register-external for v0.5` });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, bettor registration closed` });
    }
    let d;
    try { d = await _extStakeDeriveSide(market, b.linked_addr, v.direction, v.stakeAmount); }
    catch (e) { return reply.code(e.code || 500).send({ ok: false, error: e.message }); }
    const sideP2sh = d.sideResult.p2shAddr;
    // RPC UTXO query (indexer-independent per Bettor r283).
    let utxos;
    try {
      const { url: rpcUrl } = await getWorkingRpc();
      if (!rpcUrl) return reply.code(503).send({ ok: false, error: 'no working Kaspa RPC node — retry shortly' });
      const { RpcClient, Encoding, Address } = await import('kaspa-wasm');
      const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: d.network });
      await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 4000))]);
      try { ({ entries: utxos } = await rpc.getUtxosByAddresses([new Address(sideP2sh)])); }
      finally { await rpc.disconnect().catch(() => {}); }
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `RPC UTXO query failed (${e.message}) — retry shortly` });
    }
    utxos = utxos || [];
    // P2-3 Sub 2 LOCK (Bettor r163 + Owner): variable-amount per-UTXO independent claim. See v0.5
    // confirm above for full rationale + invariants. v0.6 path uses computeSideP2SH_v06 which now
    // (post-J1 0772dc855 v0.7) ignores stakeAmount in ctor → side_p2sh stable across any deposit value.
    const registeredTxs = new Set(
      sqlite.prepare('SELECT side_lock_tx FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ?')
        .all(marketId, d.bettorPk, v.direction).map(r => r.side_lock_tx)
    );
    const candidate = utxos.find(u => {
      const op = u.outpoint || u.entry?.outpoint;
      const txid = op && (op.transactionId || op.transaction_id);
      return txid && !registeredTxs.has(txid);
    });
    if (!candidate) {
      if (utxos.length > 0 && registeredTxs.size > 0) {
        const mineLatest = sqlite.prepare('SELECT side_lock_tx, merkle_index, stake_amount FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? ORDER BY id DESC LIMIT 1')
          .get(marketId, d.bettorPk, v.direction);
        if (mineLatest) return reply.send({ ok: true, registered: true, already_registered: true, side_p2sh: sideP2sh, side_lock_tx: mineLatest.side_lock_tx, merkle_index: mineLatest.merkle_index, stake_sompi: mineLatest.stake_amount });
      }
      return reply.send({ ok: true, registered: false, pending: true, side_p2sh: sideP2sh, note: `no unregistered payment detected at side_p2sh — pay any amount >= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS to claim a bet.` });
    }
    const op = candidate.outpoint || candidate.entry?.outpoint;
    const txId = op && (op.transactionId || op.transaction_id);
    if (!txId) return reply.code(500).send({ ok: false, error: 'unregistered UTXO outpoint.transactionId missing' });
    let actualStakeSompi;
    try { actualStakeSompi = BigInt(candidate.amount); }
    catch { return reply.code(500).send({ ok: false, error: `UTXO amount not BigInt-parseable: ${candidate.amount}` }); }
    if (actualStakeSompi < BigInt(BETTOR_MIN_STAKE_POLICY)) {
      return reply.send({ ok: true, registered: false, dust_below_floor: true, side_p2sh: sideP2sh, found_sompi: actualStakeSompi.toString(), policy_sompi: String(BETTOR_MIN_STAKE_POLICY), side_lock_tx_candidate: txId, note: `UTXO ${actualStakeSompi} sompi < POLICY floor ${BETTOR_MIN_STAKE_POLICY} sompi (= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS). Pay at least the floor to register. Below-floor deposits remain locked at side_p2sh until refund.` });
    }
    const stakeAmountInt = Number(actualStakeSompi);
    const already = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, merkle_index FROM pool_bettor_sides WHERE market_id = ? AND side_lock_tx = ?').get(marketId, txId);
    if (already) return reply.send({ ok: true, registered: true, already_registered: true, side_lock_tx: txId, ...already });
    const bettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    if (bettorCount >= 50) return reply.code(409).send({ ok: false, error: 'market full — 50 bet slots max per market' });
    const merkleIndex = bettorCount;
    try {
      sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(marketId, d.bettorPk, null, v.direction, stakeAmountInt, sideP2sh, txId, merkleIndex, d.sideResult.redeemScript);
    } catch (e) {
      console.error(`[pool/register-v06/confirm] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail: ${e.message}` });
    }
    const bettors = sqlite.prepare('SELECT bettor_pk FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(x => x.bettor_pk));
    sqlite.prepare('UPDATE pool_markets SET sides_merkle_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(tree.root, marketId);
    // Producer cross-node broadcast: stake_amount uses ACTUAL UTXO value (Bettor r163 (c) LOCK).
    const _bcastBetV06 = await _broadcastBetRegistered({
      market_id: marketId, bettor_pk: d.bettorPk, direction: v.direction, stake_amount: stakeAmountInt,
      side_p2sh: sideP2sh, side_lock_tx: txId, merkle_index: merkleIndex,
      protocol_version: market.protocol_version,
      broadcaster_relay_id: market.maker_relay_id,
    });

    return reply.send({
      ok: true, registered: true, protocol_version: market.protocol_version, market_id: marketId, bettor_pk: d.bettorPk, direction: v.direction,
      side_p2sh: sideP2sh, side_lock_tx: txId, merkle_index: merkleIndex, sides_merkle_root: tree.root,
      stake_sompi: stakeAmountInt, stake_kas: (stakeAmountInt / 1e8).toFixed(8),
      bettor_count: bettorCount + 1, external: true,
      cross_node_publish_tx: _bcastBetV06?.txId || null,
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
  // Read-only. Filters: ?status= (e.g. pending_bettors), ?category=, ?q=<keyword> (LIKE NOCASE on
  // resolution_rule_spec), ?tag= (= 内置专题: worldcup → LIKE %FIFA% OR %World Cup% OR %世界杯%).
  // ?limit= (default 50, cap 200), ?offset=. Newest first. Summary fields only + live bettor_count,
  // so the grammY menu can group by category without N round-trips.
  //
  // KANet-UI 2026-06-06 (Owner P0 世界杯+搜索, Bettor r... ③ APPROVE): q/tag 加新 filter, 不动现有
  // status/category 模式. 复用 specIsUsable 一致性 (= Bettor 1要求): 搜索/专题结果也得是结构化有规则,
  // 不把 21 个烂单推给用户. specIsUsable 在 bot 客户端 filter (= 现有 startBet L322 同模式),
  // backend 仅 SQL filter 不再 specIsUsable, 由调用方 (bot) 负责一致性. 单一源是 specIsUsable JS helper.
  fastify.get('/api/pool/markets', async (request, reply) => {
    const q = request.query || {};
    const where = [];
    const params = [];
    if (q.status)   { where.push('protocol_status = ?'); params.push(String(q.status)); }
    if (q.category) { where.push('category = ?'); params.push(String(q.category)); }
    if (q.q) {
      where.push('LOWER(resolution_rule_spec) LIKE LOWER(?)');
      params.push(`%${String(q.q).replace(/[%_]/g, ch => '\\' + ch)}%`);
    }
    if (q.tag === 'worldcup') {
      // Owner 钦定专题: 2026 FIFA World Cup. patterns 涵盖 polymarket 灌入的常见命名 + 中文.
      where.push('(LOWER(resolution_rule_spec) LIKE ? OR LOWER(resolution_rule_spec) LIKE ? OR resolution_rule_spec LIKE ?)');
      params.push('%fifa%', '%world cup%', '%世界杯%');
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = sqlite.prepare(`
      SELECT id, resolution_rule_spec, outcome_side, category, protocol_status,
             protocol_version, deadline, maker_stake_amount, oracle_bond_amount,
             outcome_market_source, outcome_condition_id, created_at,
             (SELECT COUNT(*) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id) AS bettor_count,
             (SELECT COALESCE(SUM(stake_amount),0) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id AND s.direction = 0) AS yes_bettor_stake_sompi,
             (SELECT COALESCE(SUM(stake_amount),0) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id AND s.direction = 1) AS no_bettor_stake_sompi
      FROM pool_markets
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = sqlite.prepare(`SELECT COUNT(*) c FROM pool_markets ${whereSql}`).get(...params).c;
    // Bettor r70 A: pool distribution (pari-mutuel 赔率来源).
    // maker is implicit bettor on outcome_side (= L535-541 area-1 invariant);
    // YES pool = yes_bettor_stake + (maker if outcome='YES' else 0); NO pool symmetric.
    const markets = rows.map(r => {
      const makerSompi = r.maker_stake_amount || 0;
      const makerOnYes = r.outcome_side === 'YES';
      const yesPoolSompi = Number(r.yes_bettor_stake_sompi) + (makerOnYes ? makerSompi : 0);
      const noPoolSompi = Number(r.no_bettor_stake_sompi) + (!makerOnYes ? makerSompi : 0);
      const total = yesPoolSompi + noPoolSompi;
      return {
        ...r,
        maker_stake_kas: r.maker_stake_amount != null ? r.maker_stake_amount / 1e8 : null,
        yes_pool_kas: yesPoolSompi / 1e8,
        no_pool_kas: noPoolSompi / 1e8,
        yes_implied_prob: total > 0 ? yesPoolSompi / total : null,
        no_implied_prob: total > 0 ? noPoolSompi / total : null,
      };
    });
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
    // Bettor r70 A: pool distribution on detail too (same model as list).
    const yesBettorSompi = sqlite.prepare(
      'SELECT COALESCE(SUM(stake_amount),0) AS s FROM pool_bettor_sides WHERE market_id = ? AND direction = 0'
    ).get(marketId).s;
    const noBettorSompi = sqlite.prepare(
      'SELECT COALESCE(SUM(stake_amount),0) AS s FROM pool_bettor_sides WHERE market_id = ? AND direction = 1'
    ).get(marketId).s;
    const makerSompi = market.maker_stake_amount || 0;
    const makerOnYes = market.outcome_side === 'YES';
    const yesPoolSompi = Number(yesBettorSompi) + (makerOnYes ? makerSompi : 0);
    const noPoolSompi = Number(noBettorSompi) + (!makerOnYes ? makerSompi : 0);
    const totalPoolSompi = yesPoolSompi + noPoolSompi;
    return reply.send({
      ok: true,
      // Bettor r24 (Owner 查): bot prediction-menu reads full.maker_stake_kas → was undefined → "?".
      // List endpoint (/api/pool/markets L984) already derives maker_stake_kas; detail must match.
      market: {
        ...market,
        maker_stake_kas: market.maker_stake_amount != null ? market.maker_stake_amount / 1e8 : null,
        yes_pool_kas: yesPoolSompi / 1e8,
        no_pool_kas: noPoolSompi / 1e8,
        yes_implied_prob: totalPoolSompi > 0 ? yesPoolSompi / totalPoolSompi : null,
        no_implied_prob: totalPoolSompi > 0 ? noPoolSompi / totalPoolSompi : null,
        metadata: metaParsed,
      },
      protocol_status: market.protocol_status,
      bettor_count: bettorCount,
      sigs_collected: sigsCollected,
    });
  });

  // GET /api/pool/my-positions?linked_addr=X — Bettor r70 B (Owner P0 bot /mybets):
  // Returns all positions for a bettor across markets, with payout-if-win projections.
  // Read-only, no auth (linked_addr is public).
  fastify.get('/api/pool/my-positions', async (request, reply) => {
    const linkedAddr = (request.query?.linked_addr || '').trim();
    if (!linkedAddr || !linkedAddr.startsWith('kaspa')) {
      return reply.code(400).send({ ok: false, error: 'linked_addr query param required (kaspa: prefix)' });
    }
    let bettorPk;
    try { bettorPk = await deriveXOnlyPubkey(linkedAddr); }
    catch (e) { return reply.code(400).send({ ok: false, error: `linked_addr derive pubkey fail: ${e.message}` }); }
    const positions = sqlite.prepare(`
      SELECT s.market_id, s.direction, s.stake_amount, s.side_p2sh, s.side_lock_tx, s.claim_txid, s.merkle_index,
             s.created_at AS locked_at,
             m.resolution_rule_spec, m.outcome_side, m.protocol_status, m.deadline, m.category,
             m.maker_stake_amount, m.broker_fee_pct, m.oracle_bond_amount, m.miner_fee, m.settle_txid, m.refund_txid,
             m.metadata
      FROM pool_bettor_sides s
      LEFT JOIN pool_markets m ON m.id = s.market_id
      WHERE s.bettor_pk = ?
      ORDER BY s.created_at DESC
    `).all(bettorPk);

    // For each position, compute pool distribution + payout-if-win.
    const out = [];
    for (const p of positions) {
      const stakeSompi = Number(p.stake_amount);
      const makerSompi = Number(p.maker_stake_amount || 0);
      const makerOnYes = p.outcome_side === 'YES';
      const yesBettor = sqlite.prepare(
        'SELECT COALESCE(SUM(stake_amount),0) s FROM pool_bettor_sides WHERE market_id=? AND direction=0'
      ).get(p.market_id).s;
      const noBettor = sqlite.prepare(
        'SELECT COALESCE(SUM(stake_amount),0) s FROM pool_bettor_sides WHERE market_id=? AND direction=1'
      ).get(p.market_id).s;
      const yesPool = Number(yesBettor) + (makerOnYes ? makerSompi : 0);
      const noPool = Number(noBettor) + (!makerOnYes ? makerSompi : 0);
      // Payout-if-win calculation (mirrors v0.5 computePoolPayouts L336+ and v0.6 computeV06Payouts):
      // winner gets stake + pro-rata share of NET loser pool (= loser_total - brokerFee - oracleFee_total - minerFee).
      const myDirection = p.direction;
      const myPool = myDirection === 0 ? yesPool : noPool;
      const otherPool = myDirection === 0 ? noPool : yesPool;
      const brokerFee = Math.floor(otherPool * Number(p.broker_fee_pct || 0) / 10000);
      // oracleFee_total ≈ otherPool * oracle_fee_pct / 10000 — but oracle_fee_pct not directly stored;
      // fall back to 0 if unknown. Conservative: shows payout WITHOUT fee subtraction = upper bound.
      const minerFee = Number(p.miner_fee || 0);
      const netLoser = Math.max(otherPool - brokerFee - minerFee, 0);
      const payoutIfWin = myPool > 0 ? stakeSompi + Math.floor(netLoser * stakeSompi / myPool) : stakeSompi;
      // Bettor r76 F-N1 fix: winner direction lives in metadata.phase2_winner (= persisted by
      // pool-market-settler.js L600 on consensus). Use this to derive won_or_lost so bot poller
      // can show '你赢了' / '你输了' instead of generic '已结算'.
      let outcomeWinner = null;
      let didWin = null;
      let actualPayoutKas = null;
      try {
        const meta = JSON.parse(p.metadata || '{}');
        if (meta.phase2_winner === 0 || meta.phase2_winner === 1) {
          outcomeWinner = meta.phase2_winner;
          didWin = (myDirection === outcomeWinner);
          if (didWin) actualPayoutKas = payoutIfWin / 1e8;
        }
      } catch {}
      out.push({
        market_id: p.market_id,
        question: p.resolution_rule_spec,
        category: p.category,
        my_direction: myDirection,
        my_side: myDirection === 0 ? 'YES' : 'NO',
        stake_kas: stakeSompi / 1e8,
        deadline: p.deadline,
        status: p.protocol_status,
        yes_pool_kas: yesPool / 1e8,
        no_pool_kas: noPool / 1e8,
        yes_implied_prob: (yesPool + noPool) > 0 ? yesPool / (yesPool + noPool) : null,
        payout_if_win_kas: payoutIfWin / 1e8,
        side_p2sh: p.side_p2sh,
        side_lock_tx: p.side_lock_tx,
        locked_at: p.locked_at,  // Bettor r82 ①: 注册时间 — bot 显 "押注于 X"
        // Bettor r86 ② + r91 fix: outcome_end_date 在 exchange_offers 不是 pool_markets (J2 编造列名教训).
        // pool_markets 用 deadline (INTEGER unix sec); bot 端格式化为人类可读时间.
        deadline_unix: p.deadline,
        claim_txid: p.claim_txid,
        settle_txid: p.settle_txid,
        refund_txid: p.refund_txid,
        // F-N1: settled outcome surface (NULL if not settled or oracle still voting).
        outcome_winner: outcomeWinner,
        outcome_side: outcomeWinner === 0 ? 'YES' : (outcomeWinner === 1 ? 'NO' : null),
        did_win: didWin,
        actual_payout_kas: actualPayoutKas,
      });
    }
    return reply.send({ ok: true, linked_addr: linkedAddr, bettor_pk: bettorPk, count: out.length, positions: out });
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

  // ── Oracle UI backend (Bettor r29 J1 sub: 5-PK decoder + max-pot + income, Owner P0 UI buildout)
  // Three GET endpoints for the new /oracle role-home page (UI r299 Gap 2 batch 1 panel c + e + a).
  // Reads J2 v159 (oracle_pool_membership / pool_snapshots / pool_committee) + path A SS fingerprint.
  // All three gracefully degrade if v159 schema not yet migrated (= J2 branch not yet on this Console).

  // J2-tn r390 (#21 B Bettor ③ APPROVE 04:33): 改 oracle_pool_membership → oracle_stake_enrollments
  // (= NWT canonical r315: enrollments 是身份 canonical, membership 已死表 v164 清).
  // pool_snapshots/pool_committee 保留 (= 同 #21 scope 内不动).
  function _v06TablesExist() {
    const t = ['oracle_stake_enrollments', 'pool_snapshots', 'pool_committee'];
    return t.every(n => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n));
  }

  // GET /api/pool/market/:id/v06-settle-decode — per-market trust read panel (Gap 2 c post-settle).
  // Surfaces: 5 committee PKs revealed at settle + threshold + poolMerkleRoot binding +
  // settle_txid (= UI can link to chain explorer for output verification).
  fastify.get('/api/pool/market/:id/v06-settle-decode', async (request, reply) => {
    if (!_v06TablesExist()) return reply.code(503).send({ ok: false, error: 'v159 schema not yet migrated (J2 branch pending)' });
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT id, protocol_version, protocol_status, spine_p2sh, settle_txid, pool_merkle_root FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_version !== 'v0.6') return reply.code(400).send({ ok: false, error: `v06-settle-decode applies to protocol_version=v0.6 only (this market: ${market.protocol_version || 'v0.5'})` });

    const snapshot = sqlite.prepare('SELECT pool_merkle_root, pool_size, pool_pks_json FROM pool_snapshots WHERE market_id = ?').get(marketId);
    const committee = sqlite.prepare('SELECT committee_pks, committee_pk_hash, threshold, sampled_at FROM pool_committee WHERE market_id = ?').get(marketId);
    const settled = !!market.settle_txid;
    let committeeArr = null;
    if (committee) {
      try { committeeArr = JSON.parse(committee.committee_pks); } catch {}
    }

    return reply.send({
      ok: true,
      market_id: marketId,
      protocol_version: 'v0.6',
      protocol_status: market.protocol_status,
      settled,
      settle_txid: market.settle_txid || null,
      threshold_t_of_n: committee ? `${committee.threshold}-of-5` : '4-of-5 (default)',
      committee_pks: settled && committeeArr ? committeeArr : null,    // null if pre-settle (anonymity preserved)
      committee_pre_settle: !settled,
      committee_pk_hash: committee ? committee.committee_pk_hash : null,
      pool_merkle_root: snapshot?.pool_merkle_root || market.pool_merkle_root,
      pool_size: snapshot?.pool_size || null,
      pool_pks_json: snapshot ? snapshot.pool_pks_json : null,         // for off-chain replay/audit
      committee_sampled_at: committee?.sampled_at || null,
    });
  });

  // GET /api/pool/market/:id/settle-audit — Bettor 06-05 派工 settle 三方分账证据链.
  // Returns: market + settle_txid + committee PKs→relay_addresses + chain_events 链证 +
  // Kaspa explorer 深链。前端 NWT verifier 跨节点 fetch 双 host 对比 settle_txid + is_accepted 一致。
  fastify.get('/api/pool/market/:id/settle-audit', async (request, reply) => {
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT id, protocol_version, protocol_status, spine_p2sh, settle_txid, refund_txid, pool_merkle_root, maker_relay_id, broker_relay_id, broker_pk, outcome_side, outcome_market_source, resolution_rule_spec, maker_stake_amount, oracle_bond_amount FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });

    const committee = sqlite.prepare('SELECT committee_pks, committee_pk_hash, threshold, sampled_at, vrf_seed FROM pool_committee WHERE market_id = ?').get(marketId);
    let committeePks = null;
    try { if (committee) committeePks = JSON.parse(committee.committee_pks); } catch {}

    // J2-tn r350 (Owner 钦定 oracle-pool-source 单一源): pkToAddress 走访问器收敛.
    // 访问器内部 fallback enrollments → membership stopgap, 此处不再裸 SQL.
    const pkToAddress = {};
    if (committeePks) {
      const { resolveOracleAddresses } = await import('../lib/oracle-pool-source.mjs');
      const addrMap = resolveOracleAddresses(committeePks);
      for (const pk of committeePks) {
        const pkLower = String(pk).toLowerCase();
        const enrol = sqlite.prepare('SELECT p2sh_addr FROM oracle_stake_enrollments WHERE staker_pk_x = ?').get(pkLower);
        const relayAddr = addrMap.get(pkLower);
        if (enrol?.p2sh_addr || relayAddr) {
          pkToAddress[pkLower] = {
            stake_p2sh: enrol?.p2sh_addr || null,
            relay_address: relayAddr || null,
            source: enrol?.p2sh_addr ? 'chain_envelope' : 'fallback_membership',
          };
        }
      }
    }

    // Maker/Broker relay address
    const makerRelay = market.maker_relay_id ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id) : null;
    const brokerRelay = market.broker_relay_id ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.broker_relay_id) : null;

    // Chain events for this market (votes + payouts + settle reference).
    const events = sqlite.prepare("SELECT id, event_type, txid, payload, observed_at FROM chain_events WHERE payload LIKE ? ORDER BY observed_at ASC LIMIT 100").all(`%${marketId}%`);
    const eventsByType = {};
    for (const ev of events) {
      if (!eventsByType[ev.event_type]) eventsByType[ev.event_type] = [];
      eventsByType[ev.event_type].push({ id: ev.id, txid: ev.txid, observed_at: ev.observed_at });
    }

    // Bettor sides (winner candidates).
    const sides = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, claim_txid FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);

    // Kaspa explorer base (testnet-12 default).
    const network = (market.spine_p2sh || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const explorerBase = network === 'testnet-12' ? 'https://explorer-tn12.kaspa.org' : 'https://explorer.kaspa.org';
    const txUrl = (txid) => txid ? `${explorerBase}/txs/${txid}` : null;
    const addrUrl = (addr) => addr ? `${explorerBase}/addresses/${addr}` : null;

    return reply.send({
      ok: true,
      market_id: marketId,
      protocol_version: market.protocol_version || 'v0.5',
      protocol_status: market.protocol_status,
      settled: !!market.settle_txid,
      refunded: !!market.refund_txid,
      settle_txid: market.settle_txid || null,
      settle_explorer_url: txUrl(market.settle_txid),
      refund_txid: market.refund_txid || null,
      refund_explorer_url: txUrl(market.refund_txid),
      outcome_side: market.outcome_side,
      outcome_market_source: market.outcome_market_source,
      maker: {
        relay_id: market.maker_relay_id,
        address: makerRelay?.address || null,
        explorer_url: addrUrl(makerRelay?.address),
        stake_kas: market.maker_stake_amount != null ? market.maker_stake_amount / 1e8 : null,
      },
      broker: {
        relay_id: market.broker_relay_id,
        address: brokerRelay?.address || null,
        explorer_url: addrUrl(brokerRelay?.address),
        pk: market.broker_pk || null,
      },
      committee: {
        threshold: committee?.threshold || 4,
        committee_pk_hash: committee?.committee_pk_hash || null,
        sampled_at: committee?.sampled_at || null,
        vrf_seed: committee?.vrf_seed || null,
        oracle_bond_kas: market.oracle_bond_amount != null ? market.oracle_bond_amount / 1e8 : null,
        members: committeePks ? committeePks.map(pk => ({
          pk_x: pk.toLowerCase(),
          mapped: pkToAddress[pk.toLowerCase()] || null,
        })) : null,
      },
      bettor_sides: sides.map(s => ({
        bettor_pk: s.bettor_pk,
        direction: s.direction === 0 ? 'YES' : 'NO',
        stake_kas: s.stake_amount / 1e8,
        side_p2sh: s.side_p2sh,
        side_p2sh_explorer_url: addrUrl(s.side_p2sh),
        side_lock_txid: s.side_lock_tx,
        side_lock_explorer_url: txUrl(s.side_lock_tx),
        claim_txid: s.claim_txid,
        claim_explorer_url: txUrl(s.claim_txid),
      })),
      pool_merkle_root: market.pool_merkle_root,
      chain_events: eventsByType,
      network,
      explorer_base: explorerBase,
    });
  });

  // GET /api/oracle/max-pot/:pk — per-oracle max-pot exposure (Gap 2 e bond/pot ratio panel).
  // = sum(oracleBondAmount) across active markets where this oracle is committee.
  fastify.get('/api/oracle/max-pot/:pk', async (request, reply) => {
    if (!_v06TablesExist()) return reply.code(503).send({ ok: false, error: 'v159 schema not yet migrated' });
    const oraclePk = String(request.params.pk).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(oraclePk)) return reply.code(400).send({ ok: false, error: 'pk must be 64-hex (32 bytes)' });

    const rows = sqlite.prepare(`
      SELECT pc.market_id, pc.committee_pks, pm.protocol_status, pm.oracle_bond_amount
      FROM pool_committee pc
      JOIN pool_markets pm ON pm.id = pc.market_id
      WHERE pm.protocol_version = 'v0.6'
        AND pm.protocol_status NOT IN ('completed', 'refunded', 'cancelled')
    `).all();

    let totalPotSompi = 0;
    const perMarket = [];
    for (const r of rows) {
      let pks = [];
      try { pks = JSON.parse(r.committee_pks); } catch {}
      if (pks.map(p => String(p).toLowerCase()).includes(oraclePk)) {
        const bond = parseInt(r.oracle_bond_amount, 10) || 0;
        totalPotSompi += bond;
        perMarket.push({ market_id: r.market_id, bond_at_risk_sompi: bond, status: r.protocol_status });
      }
    }
    // J2-tn r350: stake 真源 chain_view (= scanAndDerivePool 写). 不 fallback membership.
    // 访问器 getActivePool() 取最新 chain_view, 找此 oracle PK 对应 stake.
    let stakeLockedKas = null;
    let active = false;
    try {
      const { getActivePool } = await import('../lib/oracle-pool-source.mjs');
      const pool = getActivePool();
      if (pool?.leaves) {
        const leaf = pool.leaves.find(l => String(l.pk_x || '').toLowerCase() === oraclePk);
        if (leaf?.stake_sompi) {
          stakeLockedKas = Number(leaf.stake_sompi) / 1e8;
          active = true;
        }
      }
    } catch {}
    const membership = { stake_locked_kas: stakeLockedKas, active };

    return reply.send({
      ok: true,
      oracle_pk: oraclePk,
      active_committee_markets: perMarket.length,
      total_pot_at_risk_sompi: totalPotSompi,
      total_pot_at_risk_kas: totalPotSompi / 1e8,
      stake_locked_kas: membership ? membership.stake_locked_kas : null,
      pot_to_stake_ratio: membership && membership.stake_locked_kas > 0
        ? (totalPotSompi / 1e8) / membership.stake_locked_kas
        : null,
      pool_active: membership ? !!membership.active : null,
      per_market: perMarket,
    });
  });

  // GET /api/oracle/income/:pk — per-oracle income from settled markets (Gap 2 a personal income panel).
  // = sum of settle TX output[position+1].value where this oracle was in committee at position 0..4.
  // Reads kaspa_tx_log.outputs_json for settled markets; gracefully shows pending if TX not indexed.
  fastify.get('/api/oracle/income/:pk', async (request, reply) => {
    if (!_v06TablesExist()) return reply.code(503).send({ ok: false, error: 'v159 schema not yet migrated' });
    const oraclePk = String(request.params.pk).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(oraclePk)) return reply.code(400).send({ ok: false, error: 'pk must be 64-hex (32 bytes)' });

    const settled = sqlite.prepare(`
      SELECT pc.market_id, pc.committee_pks, pm.settle_txid, pm.protocol_status
      FROM pool_committee pc
      JOIN pool_markets pm ON pm.id = pc.market_id
      WHERE pm.protocol_version = 'v0.6'
        AND pm.settle_txid IS NOT NULL
    `).all();

    let totalIncomeSompi = 0;
    const perMarket = [];
    let pendingTxCount = 0;
    for (const r of settled) {
      let pks = [];
      try { pks = JSON.parse(r.committee_pks); } catch {}
      const lcPks = pks.map(p => String(p).toLowerCase());
      const position = lcPks.indexOf(oraclePk);
      if (position < 0) continue;  // not in this market's committee

      // settle TX outputs: [0]=brokerFee, [1..5]=c0..c4 (= position+1 = my output idx).
      const txRow = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(r.settle_txid);
      if (!txRow || !txRow.outputs_json) {
        pendingTxCount += 1;
        perMarket.push({ market_id: r.market_id, position, settle_txid: r.settle_txid, income_sompi: null, status: 'tx_pending_index' });
        continue;
      }
      let outputs = [];
      try { outputs = JSON.parse(txRow.outputs_json); } catch {}
      const myOutput = outputs[position + 1];  // +1 to skip output[0] = broker fee
      const payoutSompi = myOutput ? (parseInt(myOutput.value || myOutput.amount, 10) || 0) : 0;
      totalIncomeSompi += payoutSompi;
      perMarket.push({ market_id: r.market_id, position, settle_txid: r.settle_txid, income_sompi: payoutSompi, status: r.protocol_status });
    }

    return reply.send({
      ok: true,
      oracle_pk: oraclePk,
      total_settled_markets: perMarket.length,
      total_income_sompi: totalIncomeSompi,
      total_income_kas: totalIncomeSompi / 1e8,
      pending_tx_index_count: pendingTxCount,
      per_market: perMarket,
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

  // POST /api/pool/market/:id/bettor-refund-claim — DoD C 退款自取 (Bettor r261/r386 钦点).
  //
  // KANet 内置自取 path (Owner r488 / docs/2026-06-02-self-refund-builtin-path-DECISION.md):
  // bettor 全程 tg-bot + Relay 内置签 (= 0 外部钱包 Kasware path drop).
  //
  // Endpoint orchestrates:
  //   1. Lookup pool_bettor_sides row (= bettor_pk + side_p2sh + side_lock_tx + side_redeem_script_hex)
  //   2. Resolve signing relay: bettor_relay_id 不可用 (= register-v06 confirm 通常 NULL); 解析路径
  //      为 deriveXOnlyPubkey(relay_nodes.address) == bettor_pk 找匹配 relay (Bettor r392 catch).
  //      不查 relay_nodes.ecdsa_pubkey_xonly 列 (= 常 NULL, ccvr9 实测对不上).
  //   3. Byte-size mass-aware fee (= 复用 891c94d/G2-B sediment 估算).
  //   4. lock_time = (market.deadline + 7200) * 1000 ms (= J1 5dd590cd0 SS grace fix 7200s 后).
  //   5. IPC matched relay 'pool_side_refund_cancelled_tx' (= 801af4d handler 7132ddd builder).
  //   6. Return refund_txid or error.
  //
  // Body: { bettor_pk } OR { side_id }.
  fastify.post('/api/pool/market/:id/bettor-refund-claim', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    const bettorPk = (typeof b.bettor_pk === 'string' ? b.bettor_pk.toLowerCase() : null);
    const sideId = b.side_id;
    if (!bettorPk && !sideId) {
      return reply.code(400).send({ ok: false, error: 'bettor_pk or side_id required' });
    }

    const market = sqlite.prepare(`
      SELECT id, deadline, spine_p2sh, protocol_version, protocol_status
      FROM pool_markets WHERE id = ?
    `).get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });

    let side;
    if (sideId) {
      side = sqlite.prepare(`
        SELECT id, bettor_pk, side_p2sh, side_lock_tx, side_redeem_script_hex, stake_amount, direction
        FROM pool_bettor_sides WHERE id = ? AND market_id = ?
      `).get(sideId, marketId);
    } else {
      side = sqlite.prepare(`
        SELECT id, bettor_pk, side_p2sh, side_lock_tx, side_redeem_script_hex, stake_amount, direction
        FROM pool_bettor_sides WHERE market_id = ? AND lower(bettor_pk) = ?
      `).get(marketId, bettorPk);
    }
    if (!side) return reply.code(404).send({ ok: false, error: 'side row not found for bettor in market' });
    if (!side.side_lock_tx) return reply.code(409).send({ ok: false, error: 'side stake not yet locked on chain' });
    if (!side.side_redeem_script_hex) return reply.code(409).send({ ok: false, error: 'side row missing redeem_script_hex (= pre-v136 register, cannot self-claim)' });

    // Resolve signing relay via deriveXOnlyPubkey(relay_nodes.address) match (Bettor r392 catch).
    const candidates = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE address IS NOT NULL').all();
    let signingRelay = null;
    for (const row of candidates) {
      try {
        const pk = await deriveXOnlyPubkey(row.address);
        if (String(pk).toLowerCase() === String(side.bettor_pk).toLowerCase()) {
          signingRelay = row;
          break;
        }
      } catch {}
    }
    if (!signingRelay) {
      return reply.code(404).send({
        ok: false,
        error: `no local relay matches bettor_pk=${String(side.bettor_pk).slice(0,12)}.. via deriveXOnlyPubkey(address) — bettor relay not on this node`,
      });
    }

    // Byte-size mass-aware fee: refund TX 1-in 1-out + side redeem ~1999B → ~2300B → mass ~5750 → fee ~632_500.
    // 跟 unlockPoolSpineRefundMakerUnjoined 同公式 (Bettor 891c94d sediment).
    const redeemBytes = Buffer.from(side.side_redeem_script_hex, 'hex');
    const sigScriptSize = 70 + redeemBytes.length;
    const txByteEstimate = 45 + sigScriptSize + 50 + 80;
    const massEst = Math.ceil(txByteEstimate * 2.5);
    const FEE_MIN = 1000;
    const FEE_MAX = 100_000_000;
    let fee = Math.max(FEE_MIN, massEst * 110);
    if (fee > FEE_MAX) fee = FEE_MAX;

    const stakeSompi = BigInt(side.stake_amount);
    const outAmount = stakeSompi - BigInt(fee);
    if (outAmount <= 1000n) {
      return reply.code(409).send({ ok: false, error: `output ${outAmount} <= dust 1000 (= fee ${fee} too high for stake ${stakeSompi})` });
    }

    // J1 5dd590cd0 grace fix: SS L260/270 require(tx.time >= (deadline + REFUND_GRACE_SEC) * 1000) ms.
    // J1tn r303 (Bettor 03:19 v3 approve): de-dup hardcode → import from lib/pool-refund-grace.mjs.
    // J2-tn r391 (#28 Bettor ③ APPROVE v2 05:26): legacy v0.5 PoolSide locktime 无 grace (SS L121
    // 严守 tx.time >= deadline*1000 ms), v06/v07 + REFUND_GRACE_SEC (L260/270 grace require).
    // entry index: 3 for legacy (PoolSide.sil 4 entry refund=idx3), 2 for v06/v07 (PoolSide_v06/v07 3 entry refund=idx2).
    const isLegacy = !market.protocol_version || market.protocol_version === 'v0.5';
    const { REFUND_GRACE_SEC } = await import('../lib/pool-refund-grace.mjs');
    const lockTime = isLegacy
      ? BigInt(market.deadline) * 1000n
      : (BigInt(market.deadline) + BigInt(REFUND_GRACE_SEC)) * 1000n;
    const entryIndex = isLegacy ? 3 : 2;

    try {
      const submitResult = await sendCommandAsync(signingRelay.id, {
        type: 'pool_side_refund_cancelled_tx',
        side_p2sh_address: side.side_p2sh,
        side_redeem_script_hex: side.side_redeem_script_hex,
        required_input_outpoint: { outpointTxid: side.side_lock_tx, outpointIndex: 0 },
        output: { address: signingRelay.address, amountSompi: outAmount.toString() },
        lock_time: lockTime.toString(),
        entry_index: entryIndex,
      });
      if (!submitResult?.ok || !submitResult.txId) {
        return reply.code(500).send({ ok: false, error: `relay submit fail: ${submitResult?.error || 'no txId'}` });
      }
      // Bettor r400 catch: 必 UPDATE claim_txid 防 cron 重试 (= ccvr9 实证 endpoint 无 UPDATE
      // 链上 claimed 但 DB 空 → cron 看作未领每 tick 重试).
      sqlite.prepare('UPDATE pool_bettor_sides SET claim_txid = ?, refund_attempted_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(submitResult.txId, side.id);
      return reply.send({
        ok: true,
        market_id: marketId,
        bettor_pk: side.bettor_pk,
        side_id: side.id,
        signing_relay_id: signingRelay.id,
        signing_relay_address: signingRelay.address,
        refund_txid: submitResult.txId,
        stake_sompi: stakeSompi.toString(),
        fee_sompi: fee.toString(),
        output_sompi: outAmount.toString(),
        lock_time_ms: lockTime.toString(),
        mass_estimate: massEst,
      });
    } catch (e) {
      console.error(`[pool/bettor-refund-claim] fail market=${marketId.slice(0,12)} side=${side.id}: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `claim fail: ${e.message}` });
    }
  });
}
