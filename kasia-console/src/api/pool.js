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
// 创建端拒 = 烂单源头堵; 展示端滤 = 历史烂单不显.
// **绑死 voter deriveVote 依赖** (Bettor r243 加固): voter (bettor-prediction-voter.js)
// kanet_native deriveVote 强制 obj.data_source_canonical URL non-empty (= 否则
// 'kanet_native missing data_source_canonical URL' fail, qrv65 实证). isStructuredSpec
// qualifications MUST == voter derivable. 漂移 = c06178c 类回归源, 改时三端 (pool.js
// + bot specIsUsable + voter deriveVote) 必同步.
// Follow-up: 抽 lib/spec-validation cross-dir 真单一源 import (= 不在 HALT 域).
export function isStructuredSpec(spec) {
  if (!spec) return false;
  const s = String(spec).trim();
  if (!s.startsWith('{')) return false;
  try {
    const obj = JSON.parse(s);
    return (
      typeof obj.title === 'string' && obj.title.trim().length > 0 &&
      typeof obj.resolution_criteria === 'string' && obj.resolution_criteria.trim().length > 0 &&
      typeof obj.data_source_canonical === 'string' && obj.data_source_canonical.trim().length > 0
    );
  } catch { return false; }
}

// KANet-UI 2026-06-07 P0-#5 form 软化 (Bettor r291b 关1 PASS 条件):
// 用户从 source_kind 下拉选预设源, 后端 derive canonical URL 塞回 spec.
// 三端单一源守: voter deriveVote / bot specIsUsable / isStructuredSpec contract 不变
// (= 入库 spec 永远含 data_source_canonical URL), 后端入口 derive 是唯一新增. r243 单一源.
const SOURCE_KIND_DERIVERS = {
  polymarket: (p) => {
    const cond = p?.condition_id || p?.token_id;
    if (!cond || typeof cond !== 'string') throw new Error('polymarket 需 condition_id 或 token_id');
    return `https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(cond)}&closed=true`;
  },
  binance: (p) => {
    const sym = p?.symbol;
    if (!sym || typeof sym !== 'string') throw new Error('binance 需 symbol (例 BTCUSDT)');
    return `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=1d&limit=1`;
  },
  sport: (p) => {
    // 测试网占位: 走 local mock test-oracle (deterministic by _yes/_no suffix). voter 真能 fetch.
    const eid = p?.event_id;
    if (!eid || typeof eid !== 'string') throw new Error('sport 需 event_id (含 _yes/_no 后缀决 mock outcome)');
    const port = process.env.PORT || '3200';
    return `http://localhost:${port}/api/test-oracle/${encodeURIComponent(eid)}`;
  },
  'kaspa-onchain': (p) => {
    const tx = p?.tx_hash;
    if (!tx || typeof tx !== 'string' || !/^[0-9a-fA-F]{64}$/.test(tx)) throw new Error('kaspa-onchain 需 tx_hash (64 hex)');
    return `https://api-tn12.kaspa.org/transactions/${tx}`;
  },
};

export function deriveCanonicalFromSourceKind(sourceKind, sourceParams) {
  const fn = SOURCE_KIND_DERIVERS[sourceKind];
  if (!fn) throw new Error(`未知 source_kind: ${sourceKind} (支持: ${Object.keys(SOURCE_KIND_DERIVERS).join('/')})`);
  return fn(sourceParams || {});
}

function _maybeDeriveSpecFromSourceKind(b) {
  if (!b.source_kind) return;
  let spec = {};
  try { spec = JSON.parse(b.resolution_rule_spec || '{}') || {}; } catch { spec = {}; }
  if (!spec.data_source_canonical || !String(spec.data_source_canonical).trim()) {
    spec.data_source_canonical = deriveCanonicalFromSourceKind(b.source_kind, b.source_params);
  }
  spec.source_kind = b.source_kind;
  if (b.source_params && typeof b.source_params === 'object') spec.source_params = b.source_params;
  b.resolution_rule_spec = JSON.stringify(spec);
}

function deriveXOnlyPubkey(address) {
  return import('kaspa-wasm').then(kaspa => {
    return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
  });
}

// KANet-UI 2026-06-11 (Bettor r606/r607 + J1 #143 chokepoint + NWT r66): broker/gateway 收款址必 P2PK.
// 否则 settle always-pk-derive (J2 ca5e8658) 从 broker_pk 派生的地址 ≠ 意图收款址 → fee 到错处.
// 所有 create 函数 derive brokerPk 后必经此校验 = chokepoint 覆盖全 gateway-设置路径 (无旁路).
// reject guard, derive 后建 payload 前拦, 不改 signed payload = 0 跨节点 hash 风险.
// ⚠ MAINTAIN (Bettor r608): 每个 `deriveXOnlyPubkey(brokerRow.address)` 点【必】紧跟调本 helper.
//   现 3 处 (create/v06/v07). 将来加第 4 条 broker_pk-derive 建市路径忘调 = 非 P2PK gateway 旁路漏.
async function assertBrokerP2PK(brokerPk, brokerAddress) {
  const kaspa = await import('kaspa-wasm');
  const net = (brokerAddress || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
  const roundTrip = new kaspa.XOnlyPublicKey(brokerPk).toAddress(net).toString();
  if (roundTrip !== brokerAddress) {
    const e = new Error('broker relay 地址非 P2PK (round-trip ≠ 原址) — gateway 须 P2PK 保跨节点 settle fee 派生到对处 (Bettor r606/J1 #143)');
    e.code = 400;
    throw e;
  }
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
async function _sendBroadcastChunked(relayId, channel, payloadStr, timeoutMs) {
  // J2-tn 跨节点一致 (Bettor r559 / J1 #84): 6476f167 只改了 lib/pool-broadcast.mjs sendBroadcastChunked
  // (settler sign_req 路径), 这份 pool.js 私函数 (market-publish 路径) 漏同步 → IPC 默认 30s。J1 :3300
  // 两份都补了, :3200 这份也同步 90s 灭跨节点 drift。market-publish 现 5-chunk 小 (30s 也够), 但大
  // payload (未来/边界) 不被 30s 截 + 与 lib/J1 一致。env BROADCAST_CHUNK_TIMEOUT_MS 同一变量。
  const tmo = timeoutMs || parseInt(process.env.BROADCAST_CHUNK_TIMEOUT_MS, 10) || 90_000;
  if (payloadStr.length <= SAFE_CHUNK_BUDGET) {
    return await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: payloadStr }, tmo);
  }
  const hash = createHash('sha256').update(payloadStr).digest('hex');
  const total = Math.ceil(payloadStr.length / CHUNK_DATA_BUDGET);
  const txIds = [];
  for (let ord = 0; ord < total; ord++) {
    const data = payloadStr.slice(ord * CHUNK_DATA_BUDGET, (ord + 1) * CHUNK_DATA_BUDGET);
    const chunkPayload = JSON.stringify({ t: 'pool_market_chunk_v1', hash, ord, total, data });
    const r = await sendCommandAsync(relayId, { type: 'send_broadcast', channel, message: chunkPayload }, tmo);
    if (!r?.txId) throw new Error(`chunk ${ord+1}/${total} broadcast no txId: ${JSON.stringify(r).slice(0,200)}`);
    txIds.push(r.txId);
  }
  console.log(`[pool/broadcast] chunked ${payloadStr.length} chars → ${total} chunks hash=${hash.slice(0,8)} txIds=[${txIds.map(t=>t.slice(0,8)).join(',')}]`);
  return { ok: true, txId: txIds.join(','), chunks: total, hash };
}

// Schema pool_market_published_v1 (r179-locked, r180 3-way verified, r120 ACK).
// market_metadata_hash 3-way alignment (r180 grep verified L191-198): producer/consumer/spine
// all sha256(JSON.stringify({source, condition, token, side, end, rule})).
// J2-tn fee-on-total maker_pk 单源 (NWT/J1 #294-299 + Bettor r863): maker payout addr 派生口径
// 单源化 = create 持久化 maker_pk 列 + 跨节点广播 sentinel 都用【这同一个 get_pubkey x_only_pubkey】
// (relay 实际 pk, 非 deriveXOnlyPubkey(address) round-trip = 非 P2PK edge fork)。列==sentinel 逐字节同
// = 全节点单一 derivation。helper 保 3 create path + broadcast 同口径 (NWT "一个变量/口径")。
async function _getMakerRelayPk(makerRelayId) {
  const pkResult = await sendCommandAsync(makerRelayId, { type: 'get_pubkey' });
  const pk = pkResult?.x_only_pubkey;
  if (!pk || pk.length !== 64) throw new Error(`maker get_pubkey invalid: ${pk}`);
  return pk;
}

async function _broadcastMarketPublished(marketRow, makerRelayId) {
  try {
    const maker_relay_pk = await _getMakerRelayPk(makerRelayId);

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
      // J2-tn (2a) 跨节点 publish 根治 (Bettor r507) + KANet-UI 2026-06-13 isNaN guard (Bettor r888):
      // DB 把 outcome_side 存成字符串。create 的 market_metadata_hash 用 b.outcome_side 算 (L451):
      //   数字市场 (b.outcome_side=0, DB '0.0') → hash 用数字 0 → 发 Number('0.0')=0 还原 ✓
      //   字符串市场 (b.outcome_side='YES', DB 'YES') → hash 用字符串 'YES' → 但 Number('YES')=NaN→
      //   JSON 'null' ≠ create 'YES' → consumer L608 重算 hash 不命中 → 跨节点 auto-publish 拒。
      // = L198 旧 Number() 是 DoD#1.4b 数字 case 的修, latent edge 咬所有 YES/NO 字符串 v07 市场
      //   (205 个: YES 193/yes 11/NO 1) auto cross-node publish 不可见 (须手动 re-broadcast raw side).
      // 修 (isNaN 守, 配 create canonical 两路一致): 数字 Number / 字符串 raw string.
      outcome_side: isNaN(Number(marketRow.outcome_side)) ? marketRow.outcome_side : Number(marketRow.outcome_side),
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

// J2-tn task#13 (Bettor r913 GREENLIT): broker 经手市场 create 后自动推单 → 通电 broker_recommendations
// '③ recommended' 链 (此前表空=没 caller 触发 POST /api/broker/recommend, J2 scope r894 实证 1 行)。
// 复用 POST endpoint 同款 prevet+history+INSERT 逻辑 (内部 fetch, 零逻辑重复=不 drift)。fire-and-forget:
// 不 await/不 fail create (prevet 30s LLM 不阻 create); prevet tier!='pass' → endpoint 自然 reject 不入表
// (= 质量门, 劣市场不上推荐位)。自家 broker 验在 endpoint L2702 (market.broker_relay_id==broker_relay_id)。
// ⚠ 设计点待 reviewer 裁: self-broker (broker==maker, 当前 fee 模型多数市场) 也推 = prevet-gate 兜质量;
//   若只推 distinct broker (独立第三方背书) 则这里加 brokerRelayId != makerRelayId 条件 (现 incl 全 broker-handled)。
// J2-tn task#12 (b) (Bettor r923 + NWT determinism 轴 PASS): :8000 饱和探针。GET /slots, 所有 slot
// is_processing=true → 饱和。只读轻量, fail-open (探针失败 → false 不误 skip; auto-recommend 非关键)。
// 供【非共识 caller】gate 让 slot 给共识路 deriveVote。⚠ 绝不碰 deriveVote (NWT 命门: 共识路永不 node-local
// skip, 它靠现有 voter-timeout block/超时; 本函数+gate 只在非共识展示层 auto-recommend, 零引用 deriveVote 路)。
async function is8000Saturated() {
  try {
    const r = await fetch('http://127.0.0.1:8000/slots', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const slots = await r.json();
    if (!Array.isArray(slots) || !slots.length) return false;
    return slots.every(s => s.is_processing === true);
  } catch { return false; }
}

function _autoRecommendBrokeredMarket(marketId, brokerRelayId) {
  if (!brokerRelayId) return;
  const port = process.env.PORT || '3200';
  // task#12 (b): :8000 饱和 → skip auto-推单 (非共识展示层让 slot 给共识 deriveVote/Mind)。deriveVote 零碰。
  is8000Saturated().then(saturated => {
    if (saturated) {
      console.log(`[pool/auto-recommend] market=${marketId.slice(0, 12)} SKIP — :8000 saturated (非共识让 slot 给共识, task#12 b)`);
      return;
    }
    return fetch(`http://127.0.0.1:${port}/api/broker/recommend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify({ broker_relay_id: brokerRelayId, market_id: marketId }),
    }).then(r => r.json()).then(j => {
      console.log(`[pool/auto-recommend] market=${marketId.slice(0, 12)} broker=${brokerRelayId.slice(0, 8)} → ${j?.ok ? 'recommended tier=' + j.prevet_tier + ' score=' + j.prevet_score : 'skip: ' + (j?.error || '?')}`);
    });
  }).catch(e => console.warn(`[pool/auto-recommend] market=${marketId.slice(0, 12)} fail: ${e.message}`));
}

// Bettor r117/r120 cross-node hardening producer ② — broadcast bet_register onchain.
// NO signature (chain side_lock_tx UTXO at side_p2sh is truth anchor; consumer
// recomputes side_p2sh from bettor_pk + market.oracle_pks then verifies UTXO).
async function _broadcastBetRegistered(args) {
  const { market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, protocol_version, broadcaster_relay_id } = args;
  try {
    // J2-tn r400 #29 D9 跨节点 bet ingest gap fix (Bettor r274 关1 PASS):
    // 原 caller 传 market.maker_relay_id 当 broadcaster. :3300 上 maker_relay_id 是 cross-node
    // sentinel (= 不是真本地 relay), _sendBroadcastChunked IPC silent fail → 0 broadcast →
    // consumer 节点 0 ingest → D9 :3200 0 见 :3300 sides (78K stuck). 实证 broadcast_messages
    // pool_bet_registered_v1 0 笔. 修: broadcaster 不可用时 fallback 任一本地 alive relay.
    let broadcaster = broadcaster_relay_id;
    const isCrossNode = typeof broadcaster === 'string' && broadcaster.startsWith('cross-node:');
    if (!broadcaster || isCrossNode) {
      try {
        const { getStatus, isRelayAlive } = await import('../services/relay-manager.js');
        const candidates = getStatus() || [];
        const localAlive = candidates.find(r => r.pid && isRelayAlive(r.relayNodeId)?.alive);
        if (!localAlive) throw new Error(`no locally-alive relay for broadcast (cross-node sentinel maker, ${candidates.length} relays checked)`);
        broadcaster = localAlive.relayNodeId;
      } catch (e) {
        return { ok: false, error: `broadcaster fallback fail: ${e.message}` };
      }
    }
    const unsignedPayload = {
      t: 'pool_bet_registered_v1',
      market_id, bettor_pk, direction, stake_amount,
      side_p2sh, side_lock_tx, merkle_index,
      protocol_version: protocol_version || 'v0.5',
      registered_at: new Date().toISOString(),
    };
    const bcastResult = await _sendBroadcastChunked(broadcaster, 'kanet-prediction', JSON.stringify(unsignedPayload));
    const txId = bcastResult?.txId;
    if (!txId) throw new Error(`broadcast no txId: ${JSON.stringify(bcastResult).slice(0, 200)}`);
    console.log(`[pool/broadcast] bet_registered ${market_id.slice(0, 12)}/${bettor_pk.slice(0, 8)} txId=${txId.slice(0, 16)}... via ${broadcaster?.slice(0,8)}`);
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

    // D4: broker defaults to maker (maker == broker thesis).
    if (b.broker_relay_id === undefined || b.broker_relay_id === null || b.broker_relay_id === '') b.broker_relay_id = b.maker_relay_id;
    // KANet-UI 2026-06-13 (Bettor r866/r870 全3路覆盖): broker_fee_pct 硬固定 190 (Owner 终裁 FIXED 1.9%),
    // 含 self-broker (上方塌 maker)。删旧 self-broker=0(致 rake 1.1%≠3%)。同 v06/v07 两路一致硬固定。
    b.broker_fee_pct = 190;

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
    try { await assertBrokerP2PK(brokerPk, brokerRow.address); } catch (e) { return reply.code(e.code || 400).send({ ok: false, error: e.message }); }
    const oraclePks = await Promise.all(oracleRows.map(r => deriveXOnlyPubkey(r.address)));
    // maker_pk 列 = 实际 relay pk (== broadcast/sentinel 同源, 单源化 NWT/Bettor r863). ctor 仍用 makerPk
    // (deriveXOnlyPubkey, L448 不动 = 不改 P2SH 地址). payout 用 maker_relay_pk (settle pk-derive).
    const maker_relay_pk = await _getMakerRelayPk(b.maker_relay_id);

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
    try { _maybeDeriveSpecFromSourceKind(b); } catch (e) { return reply.code(400).send({ ok: false, error: `source_kind derive fail: ${e.message}` }); }
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria + data_source_canonical (= 可填可信源下拉 source_kind 自动 derive, 或自填 canonical URL)' });
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
        id, maker_relay_id, maker_pk, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, maker_relay_pk, spineResult.p2shAddr, spineTxId, marketMetadataHash,
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
    _autoRecommendBrokeredMarket(marketId, b.broker_relay_id);  // J2-tn task#13 通电 broker_recommendations (fire-and-forget)

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
    const brokerProvided = !(b.broker_relay_id === undefined || b.broker_relay_id === null || b.broker_relay_id === '');
    if (!brokerProvided) b.broker_relay_id = b.maker_relay_id;  // 塌 maker (maker == broker thesis)
    // KANet-UI 2026-06-13 (Bettor r866/r867 + Owner 终裁 broker FIXED 1.9%): broker_fee_pct 硬固定
    // 190 bps for ALL markets — real-broker AND self-broker (塌 maker: 上方 broker_relay_id=maker)。
    // 删旧 gateway-default / self-broker=0 两分支: self-broker=0 致 rake 1.1%≠3% (NWT gate② 缺口) =
    // 'no-broker 市场反而便宜砸 broker 模型' (spec no-broker 一致性解要防的反面)。硬固定 190 → self-broker
    // 的 broker output(1.9%) via broker_relay_id==maker (settler 单源 brokerPk=makerPk, 4c41137e) 落 maker
    // = maker 自任恒定 3% (190 broker→maker + 100 oracle + 10 maker)。不让 per-gateway/caller override
    // (Owner '固定')。只新市场生效, 不 backfill 已建 (J2 determinism caveat: home 190/peer 200 → 跨节点碎)。
    b.broker_fee_pct = 190;
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
    try { await assertBrokerP2PK(brokerPk, brokerRow.address); } catch (e) { return reply.code(e.code || 400).send({ ok: false, error: e.message }); }
    // maker_pk 列 = 实际 relay pk (单源 == broadcast/sentinel, NWT/Bettor r863). ctor 仍 makerPk 不动.
    const maker_relay_pk = await _getMakerRelayPk(b.maker_relay_id);

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
    try { _maybeDeriveSpecFromSourceKind(b); } catch (e) { return reply.code(400).send({ ok: false, error: `source_kind derive fail: ${e.message}` }); }
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria + data_source_canonical (= 可填可信源下拉 source_kind 自动 derive, 或自填 canonical URL)' });
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
        id, maker_relay_id, maker_pk, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category,
        protocol_version, pool_merkle_root
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, maker_relay_pk, spineResult.p2shAddr, spineTxId, marketMetadataHash,
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
    _autoRecommendBrokeredMarket(marketId, b.broker_relay_id);  // J2-tn task#13 通电 broker_recommendations (fire-and-forget)

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
    // J2-tn r411 DoD-E Bettor r383 关1 PASS — 源头堵 oracle pool < 5 卡死单 gap.
    // 现状: 委员从建市时 pool_snapshots 定格. snapshot eligible < COMMITTEE_SIZE (5) →
    // 委员永远抽不出 → 市场永卡 + 资金锁死 (= 7un1d 实证).
    // 修: 建市前查 oracle_pool_chain_view 最新 snapshot pool_size, < 5 reject 503.
    // 同源同标准 (Bettor 条件): pool_size 字段 = 当前 snapshot eligible (= active + lock_until_daa
    // > snapshot_daa 已 filter, 跟 sampler 同口径).
    const COMMITTEE_SIZE_GUARD = 5;
    try {
      const latestSnapshot = sqlite.prepare(
        'SELECT pool_size, snapshot_daa FROM oracle_pool_chain_view ORDER BY snapshot_daa DESC LIMIT 1'
      ).get();
      if (!latestSnapshot) {
        return reply.code(503).send({ ok: false, error: 'oracle pool snapshot 不可用, 暂不能建市 (= 等 chain_view 同步)' });
      }
      if (latestSnapshot.pool_size < COMMITTEE_SIZE_GUARD) {
        return reply.code(503).send({
          ok: false,
          error: `oracle pool insufficient (eligible ${latestSnapshot.pool_size} < ${COMMITTEE_SIZE_GUARD} needed) — 等 pool admin re-enroll oracle 后重试`,
          pool_size: latestSnapshot.pool_size,
          required: COMMITTEE_SIZE_GUARD,
          snapshot_daa: latestSnapshot.snapshot_daa,
        });
      }
    } catch (e) {
      console.warn(`[create-v07] oracle pool guard query fail: ${e.message}`);
      // Defensive: query fail 不挡建市 (= 仅警告), 让创建路径不被守门误杀.
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
        // J1tn r303 DoD §硬 gap (Bettor r382b 钦定 大众测试致命): 建市时 eligible pool < COMMITTEE_SIZE
        // 5 应拒建. 否则池 dip 期间建的单全永卡死 + 资金锁死 (= 7un1d 真实事故). 修: pre-create
        // 检查 derived.pool_size >= 5, 不足直拒 400 + 清晰错误 + 建议下一步 (= maker 等更多 enroll).
        const { COMMITTEE_SIZE: REQ_POOL_SIZE } = await import('../services/pool-committee-sampler.mjs');
        if (!derived.pool_size || derived.pool_size < REQ_POOL_SIZE) {
          return reply.code(400).send({
            ok: false,
            error: `oracle pool 不足: snapshot 含 ${derived.pool_size || 0} 名 oracle, 需 >= ${REQ_POOL_SIZE} 才能建市. 现役 oracle 太少, 建市后 committee 永远抽不出 → market 永卡死 + 资金锁死. 请等更多 oracle 注册或主动 enroll 后再试.`,
            pool_size: derived.pool_size || 0,
            required_pool_size: REQ_POOL_SIZE,
            next_step: `等更多 oracle 经 POST /api/oracle-pool/enroll 进池. 当前可用 ${derived.pool_size || 0}, 需 ${REQ_POOL_SIZE - (derived.pool_size || 0)} 名 oracle 才能开建市.`,
          });
        }
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
    const brokerProvided = !(b.broker_relay_id === undefined || b.broker_relay_id === null || b.broker_relay_id === '');
    if (!brokerProvided) b.broker_relay_id = b.maker_relay_id;  // 塌 maker (maker == broker thesis)
    // KANet-UI 2026-06-13 (Bettor r866/r867 + Owner 终裁 broker FIXED 1.9%): broker_fee_pct 硬固定
    // 190 bps for ALL markets — real-broker AND self-broker (塌 maker: 上方 broker_relay_id=maker)。
    // 删旧 gateway-default / self-broker=0 两分支: self-broker=0 致 rake 1.1%≠3% (NWT gate② 缺口) =
    // 'no-broker 市场反而便宜砸 broker 模型' (spec no-broker 一致性解要防的反面)。硬固定 190 → self-broker
    // 的 broker output(1.9%) via broker_relay_id==maker (settler 单源 brokerPk=makerPk, 4c41137e) 落 maker
    // = maker 自任恒定 3% (190 broker→maker + 100 oracle + 10 maker)。不让 per-gateway/caller override
    // (Owner '固定')。只新市场生效, 不 backfill 已建 (J2 determinism caveat: home 190/peer 200 → 跨节点碎)。
    b.broker_fee_pct = 190;
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
    try { await assertBrokerP2PK(brokerPk, brokerRow.address); } catch (e) { return reply.code(e.code || 400).send({ ok: false, error: e.message }); }
    // maker_pk 列 = 实际 relay pk (单源 == broadcast/sentinel, NWT/Bettor r863). ctor 仍 makerPk 不动.
    const maker_relay_pk = await _getMakerRelayPk(b.maker_relay_id);

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
    try { _maybeDeriveSpecFromSourceKind(b); } catch (e) { return reply.code(400).send({ ok: false, error: `source_kind derive fail: ${e.message}` }); }
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria + data_source_canonical (= 可填可信源下拉 source_kind 自动 derive, 或自填 canonical URL)' });
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
        id, maker_relay_id, maker_pk, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category,
        protocol_version, pool_merkle_root, deadline_daa
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, maker_relay_pk, spineResult.p2shAddr, spineTxId, marketMetadataHash,
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
    _autoRecommendBrokeredMarket(marketId, b.broker_relay_id);  // J2-tn task#13 通电 broker_recommendations (fire-and-forget)

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

    // J2-tn r400 #29 D9 跨节点 bet ingest gap fix (Bettor r274 关1 PASS):
    // 漏 _broadcastBetRegistered 调用 → :3200 testers 押注 D9 数据死在本地 DB, :3300 0 ingest.
    // 对齐 /bettor/register-external/confirm L1230 + /bettor/register-v06/confirm L1418 模式.
    // broadcaster_relay_id 用本机 bettor relay (= 100% local IPC alive 保证).
    const _bcastBet = await _broadcastBetRegistered({
      market_id: marketId, bettor_pk: bettorPk, direction, stake_amount: stakeAmount,
      side_p2sh: sideResult.p2shAddr, side_lock_tx: sideTxId, merkle_index: merkleIndex,
      protocol_version: market.protocol_version || 'v0.5',
      broadcaster_relay_id: b.bettor_relay_id,
    });

    return reply.send({
      ok: true,
      market_id: marketId,
      bettor_pk: bettorPk,
      side_p2sh: sideResult.p2shAddr,
      side_lock_tx: sideTxId,
      merkle_index: merkleIndex,
      sides_merkle_root: tree.root,
      cross_node_publish_tx: _bcastBet?.txId || null,
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
      // Bettor r472: UNIQUE constraint on side_lock_tx is BENIGN — the bet is already registered
      // (concurrent confirm race, OR the L1522 idempotency check raced this INSERT). Returning 500
      // made the client retry → re-fire every tick → 1817 error-logs in a 5MB log window, a
      // contributor to the 2026-06-10 fork-exhaustion incident. Treat as idempotent success.
      if (/UNIQUE constraint failed/.test(e.message)) {
        const dup = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, merkle_index FROM pool_bettor_sides WHERE side_lock_tx = ?').get(txId);
        if (dup) return reply.send({ ok: true, registered: true, already_registered: true, side_lock_tx: txId, ...dup });
      }
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
    // KANet-UI 2026-06-07 r308: LEFT JOIN relay_nodes 加 maker_name, 列名 fully-qualify 防 ambiguous
    if (q.status)   { where.push('pool_markets.protocol_status = ?'); params.push(String(q.status)); }
    if (q.category) { where.push('pool_markets.category = ?'); params.push(String(q.category)); }
    /* KANet-UI 2026-06-07 r316 (Bettor 正解, my-markets r603 fetch-all-519 绕路退): API 诚实读 maker_relay_id */
    if (q.maker_relay_id) { where.push('pool_markets.maker_relay_id = ?'); params.push(String(q.maker_relay_id)); }
    /* J2-tn r741 broker Phase1: broker_relay_id filter (= broker DM agent markets-tool 列本 broker 经手市场 + recommended 通电复用). additive, 不传则全量同旧行为. */
    if (q.broker_relay_id) { where.push('pool_markets.broker_relay_id = ?'); params.push(String(q.broker_relay_id)); }
    if (q.q) {
      where.push('LOWER(pool_markets.resolution_rule_spec) LIKE LOWER(?)');
      params.push(`%${String(q.q).replace(/[%_]/g, ch => '\\' + ch)}%`);
    }
    if (q.tag === 'worldcup') {
      // Owner 钦定专题: 2026 FIFA World Cup. patterns 涵盖 polymarket 灌入的常见命名 + 中文.
      where.push('(LOWER(pool_markets.resolution_rule_spec) LIKE ? OR LOWER(pool_markets.resolution_rule_spec) LIKE ? OR pool_markets.resolution_rule_spec LIKE ?)');
      params.push('%fifa%', '%world cup%', '%世界杯%');
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);  /* KANet-UI 2026-06-07 r316: cap 退 200 (= r316 backend maker_relay_id filter ship 后, per-agent fetch 单 agent <200 单足够, fetch-all 绕路退) */
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = sqlite.prepare(`
      SELECT pool_markets.id, pool_markets.resolution_rule_spec, pool_markets.outcome_side,
             pool_markets.category, pool_markets.protocol_status, pool_markets.protocol_version,
             pool_markets.deadline, pool_markets.maker_stake_amount, pool_markets.oracle_bond_amount,
             pool_markets.outcome_market_source, pool_markets.outcome_condition_id, pool_markets.created_at,
             pool_markets.maker_relay_id, pool_markets.broker_relay_id, pool_markets.oracle_relay_ids,  /* KANet-UI r308 maker 名显 + J2-tn r741 broker filter/markets-tool */
             rn_maker.name AS maker_name,                       /* LEFT JOIN: 跨节点 maker 不在本表 → NULL, 前端兜底 */
             (SELECT COUNT(*) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id) AS bettor_count,
             (SELECT COALESCE(SUM(stake_amount),0) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id AND s.direction = 0) AS yes_bettor_stake_sompi,
             (SELECT COALESCE(SUM(stake_amount),0) FROM pool_bettor_sides s WHERE s.market_id = pool_markets.id AND s.direction = 1) AS no_bettor_stake_sompi
      FROM pool_markets
      LEFT JOIN relay_nodes rn_maker ON rn_maker.id = pool_markets.maker_relay_id
      ${whereSql}
      ORDER BY pool_markets.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    // total count 用 pool_markets 单表 + 同 whereSql (= 列名同已 fully-qualify, 不 ambiguous)
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
    // KANet-UI 2026-06-07 r308 maker 名显: LEFT JOIN relay_nodes 取 maker_name (跨节点 NULL, 前端兜底)
    const _makerRow = market.maker_relay_id
      ? sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(market.maker_relay_id)
      : null;
    market.maker_name = _makerRow?.name || null;
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

  // KANet-UI 2026-06-07 P0-#4 UX 实时进度 (Bettor r291b 关1 PASS):
  // GET /api/pool/market/:id/events — 拉 chain_events ORDER BY observed_at ASC, 详情页 timeline 渲.
  // NWT r335 实际 event_type 名 (= 非 _v1 后缀): pool_oracle_vote / pool_oracle_tx_sig /
  // pool_settle_consensual_dispatched / pool_oracle_deposit / pool_oracle_refund_disagreement_tx_sig.
  // 复用 settler/voter 已有 pattern: payload JSON 含 market_id, LIKE '%marketId%' 滤.
  fastify.get('/api/pool/market/:id/events', async (request, reply) => {
    const marketId = request.params.id;
    if (!marketId) return reply.code(400).send({ ok: false, error: 'market id required' });
    const rows = sqlite.prepare(`
      SELECT id, txid, event_type, payload, observed_by, observed_at
      FROM chain_events
      WHERE payload LIKE ?
      ORDER BY observed_at ASC
      LIMIT 500
    `).all(`%${marketId}%`);
    const events = [];
    for (const r of rows) {
      let payload = null;
      try { payload = JSON.parse(r.payload || '{}'); } catch {}
      // 严过滤 — 仅含 market_id 字段对得上的 events (= 防 LIKE 偶 match 别市场)
      if (!payload || payload.market_id !== marketId) continue;
      events.push({
        id: r.id,
        txid: r.txid,
        event_type: r.event_type,
        observed_at: r.observed_at,
        observed_by: r.observed_by,
        payload,
      });
    }
    return reply.send({ ok: true, market_id: marketId, count: events.length, events });
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

    // Byte-size mass-aware fee + KIP-9 storage_mass (= helper refactor lib/kip9-mass.mjs).
    // J1tn r303 P0-#1 sweep (Bettor r341+r346/r366b 钦定 helper refactor): 公式抽 lib/kip9-mass.mjs
    // computeSingleOutputFee, 5 site 不再各抄 STORAGE_MASS_C + 公式.
    const { computeSingleOutputFee } = await import('../lib/kip9-mass.mjs');
    const redeemBytes = Buffer.from(side.side_redeem_script_hex, 'hex');
    const sigScriptSize = 70 + redeemBytes.length;
    const txByteEstimate = 45 + sigScriptSize + 50 + 80;
    const computeMassEst = Math.ceil(txByteEstimate * 2.5);
    const sideStakeInt = parseInt(side.stake_amount, 10) || 1_000_000_000;
    const feeResult = computeSingleOutputFee(computeMassEst, sideStakeInt, 1000, 100_000_000);
    const massEst = feeResult.totalMass;
    const fee = feeResult.dynamicFee;

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

  // J2-tn r408 P0-A MVP Bettor r361 锁契约 — backend LLM prevet 评估端点.
  // POST /api/pool/prevet
  // body: { maker_relay_id, title, resolution_rule_spec, data_source_canonical }
  // returns: { score 0-10, tier 'pass'|'warn'|'critical', why[], suggestions[],
  //           llm_votes[{provider, model, score, why}], llm_endpoint_hash }
  //
  // MVP 单 LLM (Qwen via maker_relay_id adapter); 多 LLM scaffold 留 llm_votes[] 数组.
  // 不锚链, 不 challenge tx (= J1 cluster Phase2). 仅查 'structural resolvability':
  //   - 源 URL parseable + 已知 extractor domain → +3
  //   - title+criteria 含明确 outcome 词 → +3
  //   - deadline UTC 锚 → +2
  //   - domain in sport/finance/政治 → +2
  // Heuristic baseline + LLM 修正; LLM 不通过仅启发 (= UI 标'启发非保证').
  // J2-tn r421 (Bettor r441 关1 PASS 钉1+钉2): maker-facing mock-extract prevet.
  // 区别于 /api/pool/prevet (= 启发 + LLM 评分): 此 endpoint 实跑 KNOWN_EXTRACTORS registry
  // 对 canonical URL fetch + extract, 返结构化 verdict 给 maker 当场决策.
  //
  // Bettor 钉1: KNOWN_EXTRACTORS 共用 voter (= findExtractor single source) — 不另搞 map.
  // Bettor 钉2: 'judgeable_pending' = GREEN (= 结构 OK + 未 final 是建未来事件的正常态).
  //
  // Body: { data_source_canonical }
  // 返回: { ok, verdict, label?, kind?, preview?, advice }
  //   verdicts: judgeable_now / judgeable_pending (= GREEN) | no_extractor / canonical_unreachable / shape_mismatch (= RED)
  fastify.post('/api/pool/prevet-extract', async (request, reply) => {
    const b = request.body || {};
    const url = String(b.data_source_canonical || '').trim();
    // r422 (Bettor r442 关2 漏抓): outcome_market_source 也校验 enum 接受 (= voter 路由).
    const source = b.outcome_market_source !== undefined ? String(b.outcome_market_source) : undefined;
    try {
      const { diagnoseSource } = await import('../lib/oracle-evidence-extractors.mjs');
      const result = await diagnoseSource(url, source);
      return reply.send(result);
    } catch (e) {
      return reply.code(500).send({ ok: false, verdict: 'internal_error', advice: `diagnose 异常: ${String(e.message || '').slice(0,120)}` });
    }
  });

  fastify.post('/api/pool/prevet', async (request, reply) => {
    const b = request.body || {};
    if (!b.maker_relay_id || !b.title || !b.resolution_rule_spec) {
      return reply.code(400).send({ ok: false, error: 'maker_relay_id + title + resolution_rule_spec required' });
    }
    const title = String(b.title).trim();
    const dsc = String(b.data_source_canonical || '').trim();
    // Heuristic baseline (= 不需 LLM 也能跑出基础分).
    let score = 0;
    const why = [];
    const suggestions = [];
    // (a) URL parseable + extractor 已知域名 +3
    // J2-tn r690 gap3 (J1 line-E N=30 抓): prevet 可裁性判用 findExtractor 单源 (= voter 实际能判的源),
    // 替原硬编码 regex。drift 实锤: coingecko 在 findExtractor (voter 能判) 但不在硬编码 list → 合法
    // CoinGecko price 单被误拒 (ETH>=100 warn)。findExtractor 单源 = prevet 允许==oracle 能判、物理不漂
    // (加 extractor 自动同步, 守'焊死单一访问器')。bbc/reuters/apnews 无 extractor → 不再误奖 (voter 本会 ABSTAIN)。
    const { findExtractor } = await import('../lib/oracle-evidence-extractors.mjs');
    const hasKnownExtractor = !!findExtractor(dsc);  // host-anchored + https + SSRF 防护 (= voter 同款判定)
    let urlOk = false;
    if (dsc && /^https?:\/\//.test(dsc)) {
      urlOk = true;
      score += 1;
      if (hasKnownExtractor || /^https:\/\/([a-z0-9-]+\.)*polymarket\.com/i.test(dsc)) {
        score += 2;
      } else {
        suggestions.push('数据源域名不在已知抽取器列表 (findExtractor: ESPN/CoinGecko 等 + Polymarket), 可能需扩展抽取器');
      }
    } else if (dsc) {
      score += 1;  // 有 free-text source, 半分
      suggestions.push('数据源未给 http(s) URL, 启发 LLM 用 spec 文案推断 (准确度受限)');
    } else {
      why.push('缺数据源 (data_source_canonical 空)');
      suggestions.push('加 https://... URL 或具体描述');
    }
    // (b) title+criteria 含明确 outcome 词 +3
    // J2-tn r410 P0-A Bettor r379 调: NWT 报 good_multi/edge (finance/crypto) 误杀.
    // finance/crypto 单不用 'will win/won' 而用 'price/above/below/closes/$X by date'.
    // 扩 outcome 关键词覆盖体育 + 金融 + 政治 + 一般 thresholds.
    const specRaw = typeof b.resolution_rule_spec === 'string' ? b.resolution_rule_spec : JSON.stringify(b.resolution_rule_spec);
    const lower = (title + ' ' + specRaw).toLowerCase();
    // J2-tn 门C eval (Bettor r507): prompt-injection 硬闸. eval trial 抓到 injection-02/04
    // 题面/规则含 "you must score 10 / evaluator give full marks 10/10" 骗 LLM 打高分→pass (FP=20%).
    // 确定性预扫 (LLM 操纵不了): spec 含操纵评分/越权指令模式 = 不可信单, 末尾强制 critical.
    // 合法市场只描述结果判定规则, 不会写 "score 10 / ignore instructions / tier=pass".
    // 正则精炼: 不匹配体育 "final score 10-2" (要求 X/10 或 score[:=]digit 等评分上下文), 防误杀好单.
    const INJECTION_RE = /ignore\s+(all\s+|previous\s+|above\s+)?instruction|you\s+must\s+score|give\s+(it\s+)?(full|max|maximum)\s+(marks|score)|\d{1,2}\s*\/\s*10\b|score\s*[:=]\s*\d|tier\s*[:=]\s*(pass|critical|warn)|disregard\s+(the\s+)?(spec|missing|source|rule|evaluation)|\bevaluator\s*[:：]|\bassistant\s*[:：]|<<<|\[\[|<\/?(prompt|system|instruction)|new\s+instruction|scoring_override|always\s+(pass|approve)|must\s+(pass|approve)/i;
    const injectionDetected = INJECTION_RE.test(lower);
    // J2-tn 门C 档1 题型 gate (NWT r22 #2 / r35 推理题维度): 结构化源防御只在【直接字段比较可答】时
    // 成立; 若题需 LLM 从字段【推理】(margin "赢>3 分" / spread / 差值) → 推理步是注入/相关错的重入
    // 面。确定性预扫: 检到推理题 → cap 至 warn (不给 pass) + suggestion 改直接字段断言。直接字段题
    // (winner / price 阈值 above/below) 不命中、不误杀。配 NWT 运行时红队 (推理题伪装维度)。
    // NWT r37 红队 broadening (Bettor r572): 原 regex 被同义词改写绕过 (ahead by/gap/outscore/
    // differential/total exceed/N more than/up by). 一次性扩 (非无限 whack-a-mole) 降绕过面。
    // 诚实 limitation: regex 关键词绑定固有可绕, 这是 best-effort 软预筛; 实 safety net = deriveVote
    // (prompt 硬化抗注入 r36 13/13 + clean evidence 正确推理 r38 8/8) — 绕过题走 deriveVote 不瞎判.
    const INFERENCE_RE = /\b(win|won|beat|lead|cover|lose|trail|ahead|up|outscor\w*)\b[^.]{0,25}\bby\b\s+(more than\s+|at least\s+|over\s+|under\s+|greater than\s+)?\d|\bby\s+(more than|at least|over|under|greater than)\s+\d+\s*(point|run|goal|score)|\bmargin\b|\bdifferential\b|point[\s-]*spread|\bspread\b|\bgap\b|\bdifference\b|combined\s+(score|total|points)|(total|score|runs|points|goals)\b[^.]{0,20}\b(exceed|greater than|more than|over|above|below|under)\s*\d|\d+\s*(point|run|goal|score)?s?\s+(more|fewer|less)\s+than|how many .*\b(more|fewer|less)\b/i;
    const inferenceDetected = INFERENCE_RE.test(lower);
    // J2-tn r690 gap2① (NWT line-E 命门: deriveVote backstop 对主观题失效=高 conf 硬判 0/4 abstain,
    // 故 prevet 主观闸是【唯一】拦纯主观题的有效门, 非可选 best-effort)。纯主观措辞(无客观判定标准:
    // play well/deserve/fair/exciting/打得好/配赢/公平/精彩)→ cap warn (不给 pass)。诚实 limitation:
    // 措辞绑定固有可绕 (best-effort 软预筛), 残留主观题文档标 known limitation (Bettor r691, SS 三态/dispute 兜)。
    // FP 控制实测: 7/7 主观命中 + 6/6 客观题 (win/price 阈值) 不命中。
    const SUBJECTIVE_RE = /\b(play|played|playing|perform\w*|do|did|does)\s+(well|poorly|badly|great|good)\b|\bdeserved?\b|\b(was|is|were)\s+(it|this|that|the\s+\w+\s+)?(fair|unfair|exciting|boring|impressive|entertaining|enjoyable|dominant|convincing)\b|\b(fair|unfair|exciting|boring|deserved|impressive)\s+(game|win|victory|outcome|result|performance)\b|打得(好|不好|烂|棒|怎么样)|配(得上)?(赢|win)|公平吗|精彩吗|值得(赢|win)|应该赢|表现(好|出色)/i;
    const subjectiveDetected = SUBJECTIVE_RE.test(lower);
    const outcomePattern = /(will win|won|finalized|>=|<=|>|<|\bover\b|\bunder\b|above|below|wins?|loses?|result|outcome|champion|elected|defeated|score|price|close[ds]?|reach|exceed|hits?|threshold|target|by [0-9]|\$[0-9]|percent|%|\d+\s*(usd|kas|eth|btc))/i;
    if (outcomePattern.test(lower)) {
      score += 3;
    } else {
      why.push('题目/规则缺明确 outcome 关键词 (will win / price >= / will close above 等)');
      suggestions.push('题目应含明确 outcome 描述, e.g. "Will TEAM A win?" 或 "Will BTC close above $100K by 2026-12-31?"');
    }
    // (c) deadline UTC 锚 +2
    if (b.outcome_end_date && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(b.outcome_end_date))) {
      score += 2;
    } else {
      why.push('截止时间未给 ISO UTC');
      suggestions.push('截止时间用 ISO 8601 UTC 格式 e.g. 2026-06-15T18:00:00Z');
    }
    // (d) domain in sport/finance/politics +2
    // J2-tn r410 调: 扩 finance/crypto 域关键词覆盖更多 ticker 和市场名 (NWT FP fix).
    if (/(nba|nfl|mlb|nhl|premier|champion|election|btc|bitcoin|eth|ethereum|sol|solana|stock|nasdaq|s&p|sp500|sp-500|dow|congress|president|senate|euro|usd|gbp|jpy|cny)/i.test(lower)) {
      score += 2;
    } else {
      suggestions.push('题目主题不在已知高可裁 domain (体育/金融/政治), 可能 LLM 难判');
    }
    // J2-tn r412 Oracle 框架 Bettor r404 钉死 + r690 gap3 单源: prevet 验 canonical extractor coverage。
    // 用 hasKnownExtractor (findExtractor 单源, 上方算) 替原硬编码 KNOWN_EXTRACTOR_DOMAINS_PREVET regex —
    // prevet 允许==oracle 能判 (= voter findExtractor), 物理不漂; coingecko 等 findExtractor 源 +3 不再误拒。
    if (urlOk && hasKnownExtractor) {
      score += 3;
    } else if (urlOk) {
      score -= 2;
      why.push('数据源域名不在 KANet extractor 已知列表 (= oracle 会 ABSTAIN, 此单可能等 silent_timeout 退款)');
      suggestions.push('用 ESPN / CoinGecko 等 findExtractor 已知源, 或等 framework 加 extractor 此源');
    }
    // LLM 修正 (MVP 单 Qwen via maker_relay_id adapter).
    let llmEndpointHash = null;
    const llmVotes = [];
    try {
      const { sqlite } = await import('../db/client.js');
      const row = sqlite.prepare(`
        SELECT a.ai_provider_url, a.ai_model
        FROM relay_nodes r JOIN adapter_nodes a ON r.adapter_node_id = a.id
        WHERE r.id = ?
      `).get(b.maker_relay_id);
      const providerUrl = process.env.QWEN_LLM_URL || row?.ai_provider_url || null;
      const providerModel = row?.ai_model || null;
      if (providerUrl) {
        const llmUrl = providerUrl.replace(/\/$/, '') + '/chat/completions';
        const { createHash } = await import('crypto');
        llmEndpointHash = createHash('blake2b512').update(llmUrl + '|' + (providerModel || '') + '|0.1').digest('hex').slice(0, 32);
        const prompt = `你是预测市场可裁决性评估器. 仅评 spec 结构, 不评结果.\n` +
          `题目: ${title}\n` +
          `判定规则: ${specRaw.slice(0, 800)}\n` +
          `数据源: ${dsc.slice(0, 200)}\n` +
          `评估 (0-10):\n- 数据源能否在截止后取到确定结果?\n- 规则是否歧义?\n- outcome 是否清晰二元?\n` +
          `只回 JSON {"score": 0-10, "why": ["..."], "suggestions": ["..."]}`;
        const llmRes = await fetch(llmUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model: providerModel || undefined,
            messages: [{ role: 'user', content: prompt }],
            chat_template_kwargs: { enable_thinking: false },
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 300,
          }),
        });
        if (llmRes.ok) {
          const j = await llmRes.json();
          const content = j?.choices?.[0]?.message?.content || '{}';
          let parsed = {};
          try { parsed = JSON.parse(content); } catch {}
          const llmScore = Math.max(0, Math.min(10, parseInt(parsed.score, 10) || 0));
          llmVotes.push({ provider: 'qwen', model: providerModel || 'qwen', score: llmScore, why: Array.isArray(parsed.why) ? parsed.why.slice(0, 5) : [] });
          if (Array.isArray(parsed.why)) why.push(...parsed.why.slice(0, 3));
          if (Array.isArray(parsed.suggestions)) suggestions.push(...parsed.suggestions.slice(0, 3));
          // LLM 修正: 启发分 + LLM 分平均.
          score = Math.round((score + llmScore) / 2);
        }
      } else {
        suggestions.push('未配置 LLM provider (= adapter ai_provider_url 缺), 仅启发分');
      }
    } catch (e) {
      suggestions.push(`LLM 修正失败 ${e.message?.slice(0,80)}, 仅启发分`);
    }
    // J2-tn 门C: injection 硬闸覆盖 LLM 评分. 检测到操纵指令 → 强制 critical (score<=2),
    // LLM 被骗打多高都没用 (= 确定性, 闭 eval trial FP=20% 的 injection-02/04 漏洞).
    if (injectionDetected) {
      score = Math.min(score, 2);
      why.unshift('检测到 prompt-injection / 评分操纵模式 (e.g. "score 10" / "ignore instructions" / "tier=pass" / "evaluator:") — 标记不可信单, 强制 critical');
      suggestions.unshift('移除 spec/题目中任何指示评估器评分或越权的文本; 合法市场只描述结果判定规则');
    }
    // J2-tn 门C 档1 题型 gate: 推理题 (需从字段计算 margin/spread/差值, 非直接字段比较) → cap 至 warn
    // (score<=6, 不 pass). 非 critical (不是恶意, 是结构不可直判 = 推理步注入/相关错重入面). injection
    // 已 critical 时不叠加 (injection 优先级高). suggestion 改成直接字段断言 = 可结构化直判防推理步攻击.
    if (inferenceDetected && !injectionDetected) {
      score = Math.min(score, 6);
      why.unshift('题型=推理题 (需 LLM 从字段计算 margin/spread/差值, 非直接字段比较) — 推理步是注入/相关错重入面, prevet 不给 pass');
      suggestions.unshift('改成直接字段断言 (e.g. "X 队赢" / "价格 > Y" 而非 "X 赢超 N 分" / "X cover the spread") = 可结构化直判, 防推理步攻击');
    }
    // J2-tn r690 gap2① 主观题 gate: 纯主观措辞 (无客观判定标准) → cap warn。deriveVote backstop 对主观题
    // 失效 (命门: 高 conf 硬判 0/4 abstain), prevet 是唯一有效闸。injection 优先级高时不叠加。
    if (subjectiveDetected && !injectionDetected) {
      score = Math.min(score, 6);
      why.unshift('题型=主观题 (play well/deserve/fair/exciting/打得好/配赢 等无客观判定标准) — oracle 无客观证据可判, deriveVote 会过度自信硬判 (非弃权), prevet 不给 pass');
      suggestions.unshift('改成有客观判定标准的题 (e.g. "X 队赢了吗" / "得分 > N" 而非 "X 打得好吗" / "X 配赢吗") = 有 final 事实可裁');
    }
    score = Math.max(0, Math.min(10, score));
    let tier;
    if (score >= 7) tier = 'pass';
    else if (score >= 4) tier = 'warn';
    else tier = 'critical';
    return reply.send({
      ok: true,
      score, tier, why: why.slice(0, 8), suggestions: suggestions.slice(0, 8),
      llm_votes: llmVotes,
      llm_endpoint_hash: llmEndpointHash,
    });
  });

  // J2-tn r409 DoD 问1 Bettor r369 锁契约 — broker 推单 prevet-gate.
  // POST /api/broker/recommend { broker_relay_id, market_id }
  // 1. 调 /api/pool/prevet 跑 prevet (复用 endpoint 同 LLM 路径)
  // 2. <pass tier → reject + 0.01K bond 没 (= 自利推劣经济防)
  // 3. >=pass → 入 broker_recommendations 表 + 退 bond
  fastify.post('/api/broker/recommend', async (request, reply) => {
    const b = request.body || {};
    if (!b.broker_relay_id || !b.market_id) {
      return reply.code(400).send({ ok: false, error: 'broker_relay_id + market_id required' });
    }
    const market = sqlite.prepare('SELECT id, broker_relay_id, resolution_rule_spec FROM pool_markets WHERE id = ?').get(b.market_id);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    // 自家 broker 验.
    if (market.broker_relay_id !== b.broker_relay_id) {
      return reply.code(403).send({ ok: false, error: 'broker_relay_id mismatch market.broker_relay_id (只能推自家做 broker 的 market)' });
    }
    // Parse spec for prevet input.
    let specObj;
    try { specObj = JSON.parse(market.resolution_rule_spec || '{}'); } catch { specObj = {}; }
    // Internal prevet call (= 复用 /api/pool/prevet 同款 LLM eval).
    let prevetScore = 0, prevetTier = 'critical';
    try {
      const prevetReq = await fetch(`http://127.0.0.1:${process.env.PORT || '3200'}/api/pool/prevet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          maker_relay_id: market.broker_relay_id,  // 用 broker_relay_id 当 adapter source
          title: specObj.title || '',
          resolution_rule_spec: market.resolution_rule_spec,
          data_source_canonical: specObj.data_source_canonical || '',
        }),
      });
      const j = await prevetReq.json();
      if (j?.ok) {
        prevetScore = j.score;
        prevetTier = j.tier;
      }
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `prevet 调用失败: ${e.message}` });
    }
    if (prevetTier !== 'pass') {
      // 0.01K bond 没 (MVP: 不实际转账, 只 record).
      return reply.code(409).send({
        ok: false, error: `prevet ${prevetTier} (score ${prevetScore}/10) — 推单 reject, 0.01K bond 没收`,
        prevet_score: prevetScore, prevet_tier: prevetTier,
      });
    }
    // Compute history accuracy: settled markets where this broker recommended.
    let historyAccuracy = null;
    try {
      const hist = sqlite.prepare(`
        SELECT br.market_id, pm.protocol_status, pm.outcome_side
        FROM broker_recommendations br
        JOIN pool_markets pm ON pm.id = br.market_id
        WHERE br.broker_relay_id = ? AND pm.protocol_status = 'completed'
      `).all(b.broker_relay_id);
      if (hist.length > 0) {
        const correct = hist.filter(h => h.outcome_side).length;
        historyAccuracy = correct / hist.length;
      }
    } catch {}
    // Insert recommendation.
    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      sqlite.prepare(`
        INSERT INTO broker_recommendations (id, broker_relay_id, market_id, prevet_score, prevet_tier, bond_status, history_accuracy_at_time)
        VALUES (?, ?, ?, ?, ?, 'returned', ?)
      `).run(id, b.broker_relay_id, b.market_id, prevetScore, prevetTier, historyAccuracy);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return reply.code(409).send({ ok: false, error: 'broker 已推过此 market (UNIQUE constraint)' });
      }
      return reply.code(500).send({ ok: false, error: `insert fail: ${e.message}` });
    }
    return reply.send({
      ok: true,
      recommendation_id: id,
      broker_relay_id: b.broker_relay_id,
      market_id: b.market_id,
      prevet_score: prevetScore,
      prevet_tier: prevetTier,
      bond_status: 'returned',
      history_accuracy: historyAccuracy,
    });
  });

  // GET /api/broker/recommendations?broker_id=X&limit=10
  // 排序 (Bettor r369 locked): 0.7 × prevet_score/10 + 0.2 × history_accuracy + 0.1 × recency.
  fastify.get('/api/broker/recommendations', async (request, reply) => {
    const brokerId = request.query.broker_id;
    const limit = Math.min(50, parseInt(request.query.limit, 10) || 10);
    if (!brokerId) return reply.code(400).send({ ok: false, error: 'broker_id required' });
    const rows = sqlite.prepare(`
      SELECT br.market_id, br.prevet_score, br.prevet_tier, br.history_accuracy_at_time,
             br.recommended_at, pm.resolution_rule_spec, pm.protocol_status, pm.created_at as market_created_at
      FROM broker_recommendations br
      JOIN pool_markets pm ON pm.id = br.market_id
      WHERE br.broker_relay_id = ?
        AND pm.protocol_status IN ('pending_bettors', 'verifying')
    `).all(brokerId);
    const now = Date.now();
    const enriched = rows.map(r => {
      let title = '';
      try { title = JSON.parse(r.resolution_rule_spec || '{}').title || ''; } catch {}
      const daysSince = (now - new Date(r.market_created_at).getTime()) / (24 * 3600 * 1000);
      const recencyFactor = 1 / (1 + daysSince / 7);
      const hist = r.history_accuracy_at_time ?? 0.5;
      const totalScore = 0.7 * (r.prevet_score / 10) + 0.2 * hist + 0.1 * recencyFactor;
      return {
        market_id: r.market_id,
        title,
        prevet_score: r.prevet_score,
        prevet_tier: r.prevet_tier,
        broker_history_accuracy: r.history_accuracy_at_time,
        recency_days: Math.round(daysSince * 10) / 10,
        total_score: Math.round(totalScore * 100) / 100,
      };
    }).sort((a, b) => b.total_score - a.total_score).slice(0, limit);
    return reply.send({ ok: true, broker_id: brokerId, recommendations: enriched });
  });
}
