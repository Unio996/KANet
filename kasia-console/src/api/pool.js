// B2 v0.5 Sub 2b — Pool API endpoints (5 endpoints per Bettor r330 5-endpoint plan)
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.

import { sqlite } from '../db/client.js';
import { computeSpineP2SH, computeSideP2SH } from '../lib/pool-p2sh.mjs';
import { buildSidesMerkleTree, getMerkleProof } from '../services/pool-merkle-builder.js';
import { sendCommandAsync, transferAndConfirm, isRelayAlive } from '../services/relay-manager.js';
import { getWorkingRpc } from '../services/rpc-health.js';
import { estimateStorageMass } from '../services/pool-market-settler.js';
import { categorizeMarket } from '../lib/market-category.js';
import { isStructuredSpec, assertSpecPredicateValid } from '../lib/spec-validation.js';
// FINDING-2 (NWT) ③ entry-gate — SINGLE SOURCE commingled-spine guard. assertNotCommingled is called at the
// top of EVERY bettor stake-lock handler (6 entries); lint-kanet R-COMMINGLE-GUARD flags any that forgot. 禁内联.
import { assertNotCommingled } from '../lib/pool-commingle-detect.mjs';
import { getSidesByLogicalMarket } from '../lib/pool-bettor-sides-query.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { verifyIngestRequest } from '../services/ingest-auth.js';  // P1 fix (NWT): broker-fee-dm PII 端点 auth
import { REORG_SAFE_MIN_DEPTH } from '../lib/pool-shard-register.mjs';  // #33 整顿(NWT review): 单一具名常量取代多处硬编码 20
import { ZK_GATE } from '../lib/zk-close-builder.mjs';
import { ensureGateTmplHashFresh } from '../lib/gate-tmpl-hash.mjs';
import { kaspaZk } from '../services/zk-prove-worker.mjs';

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
// G3 (Owner 世界杯上线门, 2026-07-04, Bettor+NWT 钦定): bshard 无限押注(SHARD_SEAL_COUNT=32 无限开新片)
// 没有市场级上限, 但 PayoutShard 结算侧硬顶 1024 leaf/片(pool-payout-root.mjs CAP, 需 #18 rolling-payout-shard
// 才能 >1024, 该功能公测前未建)。900 = 留 12% 安全边界的软顶(按 distinct bet/叶子数计, 非人数——一人多笔=
// 多叶子, NWT 澄清-2)。到顶后 register-v07/prep 拒绝新押注(NO TX NO STATE, 未付款前拒·非退款), 已存在的
// 押注不受影响。#18 rolling 落地后此软顶可解除/抬高。
const MARKET_MAX_LEAVES_G3 = 900;
// 5/28 Owner 钦定: 押注 softcap 拆除 (= 之前 4 KAS testnet 限制阻 UI form 真用户测试). 改 Infinity = 0 cap.
// Per-market math guards (= storage mass / oracle fee floor) still enforce at L1 console + SS contract.
// Env override 保留可 ops set finite cap if needed.
const MAKER_STAKE_MAX_KAS = parseFloat(process.env.POOL_MAKER_STAKE_MAX_KAS) || Infinity;
// Owner 2026-06-06 钦定: maker 发起市场最低 100 KAS (= demo 实质押 + 抗灌水). Bettor ③ APPROVE r541 单一源.
const POOL_MAKER_STAKE_MIN_KAS = 100;

// KANet-UI 2026-06-06 (Bettor ③ APPROVE r546 + Bettor 钦定双层堵): 创建端结构化 spec 强制.
// 配 bot specIsUsable (= 展示端 filter, tg-bot/prediction-menu.mjs) 形成双层守门:
// 创建端拒 = 烂单源头堵; 展示端滤 = 历史烂单不显.
// **绑死 voter deriveVote 依赖** (Bettor r243 加固): voter kanet_native deriveVote 强制
// obj.data_source_canonical URL non-empty. isStructuredSpec qualifications MUST == voter derivable.
// J2-tn 2026-06-13 (Bettor r971 + L3 cross-surface finding): isStructuredSpec 移到 lib/spec-validation.js
// = L44 flag 的真单一源落地. 现 4 端共用同一 import (pool.js create-gate + tg-bot specIsUsable[mirror]
// + Kasia broker-llm-agent markets-tool + voter deriveVote contract). re-export 保 external callers 不变.
export { isStructuredSpec };

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

// ZK-native 结算(2026-07-07，Owner"ZK走到底"钦定首证市场)。Bettor 拍板(#9ufcxq)：zk_native 必须是
// resolution_rule_spec 里一个独立、显式的顶层布尔字段——不能从 outcome_market_source(judge类型，怎么判输赢)
// 推断 covenant 版本(钱走 PayoutShard 还是 PayoutShardV2)，这两者是正交的两件事，今天恰好一对一是巧合
// (首证市场用区块哈希奇偶判定+同时是唯一的ZK-native盘)，未来 ESPN/UMA 判定的市场也可能想走 ZK-native，
// 届时不该因为 judge 类型不是 blockhash_parity 就被这条推断挡住。
// 🔴 单一真值(2026-07-08, Bettor #bo75z6): 曾经两处调用点(monolithic /register-v07 + /register-v07/confirm)
// 各自独立读取这段逻辑, 后者漏抄导致 cswib 首证撞见的 zk_native=true 市场静默铸成 V1 PayoutShard 事故——
// 抽成这一个共享函数, 两处调用同一份, 不再各自维护各自的副本(今晚已两次撞"两套并行实现同族病"教训)。
function _resolveZkNativeCtorExtras(market, silverc, computeCloseZkTmplAnchor) {
  let zkNative = false, closeZkTmplAnchor = null;
  try { zkNative = JSON.parse(market.resolution_rule_spec || '{}')?.zk_native === true; } catch {}
  if (zkNative) {
    // 🔴 STOP修正(2026-07-09, 规则55同族雷·docs/2026-07-08-gate-tmplhash-live-derive-design.md §4 落地清单
    // 第5条): 不接受硬编码 fallback('511b0ead...'是 repro4 时代旧值、'_j2_closezk_repro4.sil' 是 Repro4
    // 永久禁铸令的残留路径, 两者都会悄悄过期)——缺 env 直接 throw, 跟 pool.js:1863-1866/
    // bshard-close-transport.mjs:453-461 已落地的同款纪律对齐, 不留"看起来能跑但值可能不对"的窗口。
    if (!process.env.ZK_GATE_TMPL_HASH) throw new Error('_resolveZkNativeCtorExtras: ZK_GATE_TMPL_HASH env 必需(不接受硬编码 fallback, 该值随 guest image 变化易过期)');
    if (!process.env.ZK_CLOSEZK_SIL_PATH) throw new Error('_resolveZkNativeCtorExtras: ZK_CLOSEZK_SIL_PATH env 必需(不接受硬编码 fallback, 路径随归位进度变化)');
    // 根修(2026-07-09, NWT finding①(b)HIGH): 这是 zkNative 市场 genesis-mint 的 ctor 组装点——之前的
    // guard 只在 prove/close(genesis 下游)才检查, 这里(genesis 本身)从来没人验过 env 跟 ZK_GATE 是否
    // 配对新鲜。force=true: 走进这个 if 分支已经确定 zkNative=true(真在铸 ZK-native genesis), 非 ZK 节点
    // 根本不会进这里, flag 在这没有可用性风险; 没装 WASM 的节点 fail-loud 拒铸, 好过烤一个没法验证的值。
    ensureGateTmplHashFresh(ZK_GATE, kaspaZk, { force: true });
    const gateTmplHash = process.env.ZK_GATE_TMPL_HASH;
    const closeZkSilPath = process.env.ZK_CLOSEZK_SIL_PATH;
    closeZkTmplAnchor = computeCloseZkTmplAnchor(closeZkSilPath, gateTmplHash, silverc).anchorHex;
  }
  return { zkNative, closeZkTmplAnchor };
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
    // SEAM fix (NWT FINDING-1): 建市 chokepoint — spec 带 resolution_predicate 必过 validateResolutionPredicate (shape+护栏6 半线单源)。整数线/畸形 → 400, 不依赖 caller 走 buildSportsCard。
    { const _pv = assertSpecPredicateValid(b.resolution_rule_spec); if (!_pv.valid) return reply.code(400).send({ ok: false, error: `resolution_predicate 非法 (建市拒, 防 un-settleable): ${_pv.reason}` }); }
    // 5/28 Owner 钦定: testnet 0 limits. Skip dynamic min spendable + softcap when KANET_TESTNET_NO_LIMITS=1.
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (makerStakeKas > MAKER_STAKE_MAX_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be <= ${MAKER_STAKE_MAX_KAS} KAS (v0.5 testnet per-market softcap, Bettor r444 + Owner钦定 SS-baked)` });
    }
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    // J2-tn #28 hotfix (NWT r1206 trial 抓): SS PoolSpine ctor 强制 oracleBondAmount ∈ [1, MAX] (compile-time),
    // bond=0 (#28 默认) → 'got 0' → create-v07 HTTP 500 = 生产建市破。我 r1091 SS 分析只查 spend-side
    // require(output>=oracleBond) 漏了 ctor [1,MAX] 约束。clamp 到 1 sompi 最小: committee floor = 5×1=5 sompi
    // ≈ 0% → oracle ≈ feeShare = #28 目标 (oracle 1%) 保住 + SS ctor 满足。v0.5 (bond>=1 KAS) clamp no-op。
    const oracleBondAmount = Math.max(1, Math.round(oracleBondKas * 1e8));
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
      // 事故硬化(2026-07-08, yxllc spine 100KAS 追踪战役): 落库(下面 INSERT INTO pool_markets)前的
      // landed 确认必须是深确认(minDepth=REORG_SAFE_MIN_DEPTH), 不能停在浅/mempool-accepted 级——
      // block 是 blue 不代表这笔 tx 本身赢了 acceptance(同一源 UTXO 可能被 gateway 自己另一笔并发 tx
      // 竞争抢先, 浅确认看不出来, 一旦落库就把从未真正确权的 spine_lock_tx 当权威记录, DB 有记录但链上
      // 没钱)。maxWaitMs 相应放宽到 60s, 给 20 个确认累积的时间(即使按今晚测到的最低速率也够)。这个坑
      // 三处 create 端点(v0.6 legacy ×2 + v0.7 一处)字面同一段代码, 一次性堵完(不留同形状副本)。
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr, { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 });
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
    // J2-tn #28 (Bettor sprint, NWT r1171 economic-verify): committeeMode (v0.6/v0.7) 委员不押链上 bond —
    // settle 每委员 output = oracleBond + oracleFee/N (ADDITIVE, settler computePoolPayouts L1421-1428)。
    // 固定默认 1 KAS 使 5 委员 = 5 KAS pool-funded 主导小池 (151 池 oracle 实拿 4.31% vs spec 1%)。默认 0 →
    // committee output = oracleFee/N = 正好 spec 1%, winner 拿回省下的 bond reserve。SS PoolSpine_v07 L261
    // committee output require >= oracleBondAmount=0 trivially 过; 实际 output=feeShare (MIN_POT 100 →
    // >= 0.2 KAS = 2e7 sompi >> SS dust 1000 sompi)。mass-safe (worst 100 池/50 bettor → 353k < settler
    // STORAGE_MASS_SAFE_THRESHOLD 470k)。bond=fake pool-funded 非实 collateral (oracle 实 stake 在 oracle
    // pool), 设 0 无安全损。caller 显式传 oracle_bond_kas 则尊重 (省掉=拿 0)。
    if (b.oracle_bond_kas === undefined || b.oracle_bond_kas === null || b.oracle_bond_kas === '') b.oracle_bond_kas = 0;
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
    // J2-tn #28: committeeMode bond=0 合法 (pool-funded 委员奖, 非实 collateral) → 允许 0, 仅拒负值/NaN。
    if (!Number.isFinite(oracleBondKas) || oracleBondKas < 0) return reply.code(400).send({ ok: false, error: 'oracle_bond_kas must be >= 0 (v0.6/v0.7 committeeMode: 0 = no pool-funded committee bond, oracle paid via fee only)' });
    // 100 KAS Owner 钦定 demo 实质押 — 移出 NO_LIMITS 守卫 (r544 v2 Bettor APPROVE).
    if (makerStakeKas < POOL_MAKER_STAKE_MIN_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be >= ${POOL_MAKER_STAKE_MIN_KAS} KAS (Owner 钦定 demo 实质押 skin-in-game, 单一源 L33)` });
    // KANet-UI 2026-06-06 (Bettor ③ APPROVE r546): 创建端 spec 结构化强制 (= 配 bot 入口 filter 双层堵).
    try { _maybeDeriveSpecFromSourceKind(b); } catch (e) { return reply.code(400).send({ ok: false, error: `source_kind derive fail: ${e.message}` }); }
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria + data_source_canonical (= 可填可信源下拉 source_kind 自动 derive, 或自填 canonical URL)' });
    // SEAM fix (NWT FINDING-1): 建市 chokepoint — spec 带 resolution_predicate 必过 validateResolutionPredicate (shape+护栏6 半线单源)。整数线/畸形 → 400, 不依赖 caller 走 buildSportsCard。
    { const _pv = assertSpecPredicateValid(b.resolution_rule_spec); if (!_pv.valid) return reply.code(400).send({ ok: false, error: `resolution_predicate 非法 (建市拒, 防 un-settleable): ${_pv.reason}` }); }
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (makerStakeKas > MAKER_STAKE_MAX_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be <= ${MAKER_STAKE_MAX_KAS} KAS` });
    }
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    // J2-tn #28 hotfix (NWT r1206 trial 抓): SS PoolSpine ctor 强制 oracleBondAmount ∈ [1, MAX] (compile-time),
    // bond=0 (#28 默认) → 'got 0' → create-v07 HTTP 500 = 生产建市破。我 r1091 SS 分析只查 spend-side
    // require(output>=oracleBond) 漏了 ctor [1,MAX] 约束。clamp 到 1 sompi 最小: committee floor = 5×1=5 sompi
    // ≈ 0% → oracle ≈ feeShare = #28 目标 (oracle 1%) 保住 + SS ctor 满足。v0.5 (bond>=1 KAS) clamp no-op。
    const oracleBondAmount = Math.max(1, Math.round(oracleBondKas * 1e8));
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
      // 事故硬化(2026-07-08, yxllc spine 100KAS 追踪战役): 落库(下面 INSERT INTO pool_markets)前的
      // landed 确认必须是深确认(minDepth=REORG_SAFE_MIN_DEPTH), 不能停在浅/mempool-accepted 级——
      // block 是 blue 不代表这笔 tx 本身赢了 acceptance(同一源 UTXO 可能被 gateway 自己另一笔并发 tx
      // 竞争抢先, 浅确认看不出来, 一旦落库就把从未真正确权的 spine_lock_tx 当权威记录, DB 有记录但链上
      // 没钱)。maxWaitMs 相应放宽到 60s, 给 20 个确认累积的时间(即使按今晚测到的最低速率也够)。这个坑
      // 三处 create 端点(v0.6 legacy ×2 + v0.7 一处)字面同一段代码, 一次性堵完(不留同形状副本)。
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr, { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 });
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
    // 🔴 #27 层A (Owner 钦定 2026-06-30 "大胆修·测试网无妨"): pre-broadcast conditionId 去重闸 — 止重复盘。
    //   根因(六层查实): 重复盘今天密集成簇产生(0xf161×5/32秒)·seeder 早有 dedup(L92)但 check-then-act RACE
    //   (DB查在前·create-v07 异步锁链落库在后·burst-builder/多实例发得比落库快→同 conditionId 重复 create)。
    //   create-v07 是【所有建市 chokepoint】(seeder/burst/手动全走此)→ 在此【锁 stake 前】查重 = path-independent 根治
    //   (非只改 seeder JS)。active 同 conditionId 已存 → 409 拒·一分钱不花(spine lock TX 在下方·此处在其前)。
    if (b.outcome_condition_id) {
      try {
        const _condStr = String(b.outcome_condition_id);
        // #15 查漏补缺(2026-07-05, o70vh/2ua7d真实重复盘案例): 白名单IN('pending_bettors','verifying')
        // 只覆盖v0.7两个状态, 漏了v0.6专属'pending_oracle_deposits'等非终态——反转成黑名单排除真终态
        // (cancelled/archived/refunded=市场从没真正跑起来或已清理干净), 其余一律算 active 挡重复
        // (含completed/settled_partial_claims: 真实赛事结果已产生过一次, 不该允许同conditionId再建新盘)。
        const _dup = sqlite.prepare(
          "SELECT id FROM pool_markets WHERE outcome_condition_id = ? AND protocol_status NOT IN ('cancelled','archived','refunded') LIMIT 1"
        ).get(_condStr);
        if (_dup) {
          return reply.code(409).send({
            ok: false, duplicate: true, existing_market_id: _dup.id,
            error: `duplicate market: conditionId ${_condStr.slice(0, 14)}.. 已有 active 盘 ${String(_dup.id).slice(0, 12)} (#27 dedup·不重复建·不烧 stake)`,
          });
        }
      } catch (e) { console.warn(`[create-v07] #27 dedup-gate query fail (放行不挡建市): ${e.message}`); }
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
    // J2-tn #28 (Bettor sprint, NWT r1171 economic-verify): committeeMode (v0.6/v0.7) 委员不押链上 bond —
    // settle 每委员 output = oracleBond + oracleFee/N (ADDITIVE, settler computePoolPayouts L1421-1428)。
    // 固定默认 1 KAS 使 5 委员 = 5 KAS pool-funded 主导小池 (151 池 oracle 实拿 4.31% vs spec 1%)。默认 0 →
    // committee output = oracleFee/N = 正好 spec 1%, winner 拿回省下的 bond reserve。SS PoolSpine_v07 L261
    // committee output require >= oracleBondAmount=0 trivially 过; 实际 output=feeShare (MIN_POT 100 →
    // >= 0.2 KAS = 2e7 sompi >> SS dust 1000 sompi)。mass-safe (worst 100 池/50 bettor → 353k < settler
    // STORAGE_MASS_SAFE_THRESHOLD 470k)。bond=fake pool-funded 非实 collateral (oracle 实 stake 在 oracle
    // pool), 设 0 无安全损。caller 显式传 oracle_bond_kas 则尊重 (省掉=拿 0)。
    if (b.oracle_bond_kas === undefined || b.oracle_bond_kas === null || b.oracle_bond_kas === '') b.oracle_bond_kas = 0;
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
    if (!makerRow?.address) return reply.code(400).send({ ok: false, error: 'maker relay has no resolvable address' });
    const makerPk = await deriveXOnlyPubkey(makerRow.address);

    // ── broker 身份 = 地址 (Owner 钦定 2026-06-22 接通外部 broker: 地址涵盖 relay, 向前兼容) ──
    //   broker_address 提供 → 外部 broker 直接用地址 (无 relay; 玩家绑的地址转 broker 不变, 轻路只有地址制才可能)。
    //   不提供则走 broker_relay_id relay 路 (relay 有地址 = relay 是"恰好有地址的特例")。两路都 → brokerPk + P2PK
    //   校验。settle always-pk-derive 从 broker_pk 派生收款址 (pool.js 顶 invariant) → fee 落 brokerPk 对应地址。
    let brokerPk, _brokerResolvedAddr;
    if (b.broker_address && String(b.broker_address).trim()) {
      _brokerResolvedAddr = String(b.broker_address).trim();
      b.broker_relay_id = null;   // 外部地址 broker 无 relay; DB broker_relay_id 存 null (settle 用 broker_pk 不依赖 relay)
    } else {
      const brokerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.broker_relay_id);
      if (!brokerRow?.address) return reply.code(400).send({ ok: false, error: 'broker relay has no resolvable address' });
      _brokerResolvedAddr = brokerRow.address;
    }
    try { brokerPk = await deriveXOnlyPubkey(_brokerResolvedAddr); }
    catch (e) { return reply.code(400).send({ ok: false, error: `broker pubkey derive fail (${String(_brokerResolvedAddr).slice(0, 18)}): ${e.message}` }); }
    try { await assertBrokerP2PK(brokerPk, _brokerResolvedAddr); } catch (e) { return reply.code(e.code || 400).send({ ok: false, error: e.message }); }
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

    // #35/G1 pre-flight gate (J2, 2026-07-04, Bettor 决策·opt-in 非全局强制): 只在 caller 显式传
    // b.preflight_check 时才跑三项核对(镜像源逻辑等价/deadline充足/judge时机)——create-v07 是全体
    // v0.7 建市 chokepoint(polymarket 镜像盘/ESPN spread-total 盘等都走这条路), 这些市场类型没有
    // "镜像源逻辑等价"这个概念, 强制跑会误伤。只有世界杯 advance/win 盘(本 cron)主动传入这个字段
    // 才受 gate 约束, 其它建市路径零影响(向后兼容)。
    if (b.preflight_check) {
      try {
        const { runPreflightGate } = await import('../lib/pool-preflight-gate.mjs');
        const gateResult = runPreflightGate(b.preflight_check);
        if (!gateResult.pass) {
          const failed = Object.entries(gateResult.checks).filter(([, c]) => !c.pass).map(([k, c]) => `${k}: ${c.reasons.join('; ')}`);
          return reply.code(409).send({ ok: false, error: `preflight gate failed: ${failed.join(' | ')}`, preflight: gateResult });
        }
        b._preflightGateResult = gateResult; // 建市成功后落 metadata (下方 writeback 处读取)
      } catch (e) {
        return reply.code(500).send({ ok: false, error: `preflight gate check threw: ${e.message}` });
      }
    }
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
    // J2-tn #28: committeeMode bond=0 合法 (pool-funded 委员奖, 非实 collateral) → 允许 0, 仅拒负值/NaN。
    if (!Number.isFinite(oracleBondKas) || oracleBondKas < 0) return reply.code(400).send({ ok: false, error: 'oracle_bond_kas must be >= 0 (v0.6/v0.7 committeeMode: 0 = no pool-funded committee bond, oracle paid via fee only)' });
    // 100 KAS Owner 钦定 demo 实质押 — 移出 NO_LIMITS 守卫 (r544 v2 Bettor APPROVE).
    if (makerStakeKas < POOL_MAKER_STAKE_MIN_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be >= ${POOL_MAKER_STAKE_MIN_KAS} KAS (Owner 钦定 demo 实质押 skin-in-game, 单一源 L33)` });
    // KANet-UI 2026-06-06 (Bettor ③ APPROVE r546): 创建端 spec 结构化强制 (= 配 bot 入口 filter 双层堵).
    try { _maybeDeriveSpecFromSourceKind(b); } catch (e) { return reply.code(400).send({ ok: false, error: `source_kind derive fail: ${e.message}` }); }
    if (!isStructuredSpec(b.resolution_rule_spec)) return reply.code(400).send({ ok: false, error: 'resolution_rule_spec must be JSON with non-empty title + resolution_criteria + data_source_canonical (= 可填可信源下拉 source_kind 自动 derive, 或自填 canonical URL)' });
    // SEAM fix (NWT FINDING-1): 建市 chokepoint — spec 带 resolution_predicate 必过 validateResolutionPredicate (shape+护栏6 半线单源)。整数线/畸形 → 400, 不依赖 caller 走 buildSportsCard。
    { const _pv = assertSpecPredicateValid(b.resolution_rule_spec); if (!_pv.valid) return reply.code(400).send({ ok: false, error: `resolution_predicate 非法 (建市拒, 防 un-settleable): ${_pv.reason}` }); }
    if (process.env.KANET_TESTNET_NO_LIMITS !== '1') {
      if (makerStakeKas > MAKER_STAKE_MAX_KAS) return reply.code(400).send({ ok: false, error: `maker_stake_kas must be <= ${MAKER_STAKE_MAX_KAS} KAS` });
    }
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    // J2-tn #28 hotfix (NWT r1206 trial 抓): SS PoolSpine ctor 强制 oracleBondAmount ∈ [1, MAX] (compile-time),
    // bond=0 (#28 默认) → 'got 0' → create-v07 HTTP 500 = 生产建市破。我 r1091 SS 分析只查 spend-side
    // require(output>=oracleBond) 漏了 ctor [1,MAX] 约束。clamp 到 1 sompi 最小: committee floor = 5×1=5 sompi
    // ≈ 0% → oracle ≈ feeShare = #28 目标 (oracle 1%) 保住 + SS ctor 满足。v0.5 (bond>=1 KAS) clamp no-op。
    const oracleBondAmount = Math.max(1, Math.round(oracleBondKas * 1e8));
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
      // 事故硬化(2026-07-08, yxllc spine 100KAS 追踪战役): 落库(下面 INSERT INTO pool_markets)前的
      // landed 确认必须是深确认(minDepth=REORG_SAFE_MIN_DEPTH), 不能停在浅/mempool-accepted 级——
      // block 是 blue 不代表这笔 tx 本身赢了 acceptance(同一源 UTXO 可能被 gateway 自己另一笔并发 tx
      // 竞争抢先, 浅确认看不出来, 一旦落库就把从未真正确权的 spine_lock_tx 当权威记录, DB 有记录但链上
      // 没钱)。maxWaitMs 相应放宽到 60s, 给 20 个确认累积的时间(即使按今晚测到的最低速率也够)。这个坑
      // 三处 create 端点(v0.6 legacy ×2 + v0.7 一处)字面同一段代码, 一次性堵完(不留同形状副本)。
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr, { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 });
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
        ...(b._preflightGateResult ? { preflight: b._preflightGateResult } : {}),
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

  // POST /api/pool/market/:id/bettor/register-v07 — (A)-model rolling-shard bettor register (production register wiring (a), J2 2026-06-21).
  //   :id = logical market id (pool_markets v0.7 row). Routes the bet to the open shard (or opens a new ShardLeaf via genesis),
  //   register_append (splice, drift-safe), NO-TX accounting (market_shards). Gateway-custody (testnet): bettor relay funds the
  //   gateway (maker), the gateway builds the register. Wraps pool-shard-register orchestrator (allocator + pool-register-builder).
  fastify.post('/api/pool/market/:id/bettor/register-v07', async (request, reply) => {
    const logicalMarketId = request.params.id;
    const b = request.body || {};
    if ((!b.bettor_relay_id && !b.bettor_pk) || b.direction === undefined || !b.stake_kas) {
      return reply.code(400).send({ ok: false, error: 'bettor_relay_id OR bettor_pk (fresh keypair, cross-node fixture), direction, stake_kas required' });
    }
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(logicalMarketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_version !== 'v0.7') return reply.code(409).send({ ok: false, error: `register-v07 requires protocol_version v0.7, got ${market.protocol_version}` });
    if (market.protocol_status !== 'pending_bettors') return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, registration closed` });
    if (!market.pool_merkle_root) return reply.code(409).send({ ok: false, error: 'v0.7 market missing pool_merkle_root (committee)' });

    // FINDING-2 (NWT) ③ 入口闸 — 单源守卫 (commit1 此处内联, 现迁 shared assertNotCommingled = call-site 单源).
    //   commingled spine_p2sh 被 >1 v0.7 市场共享 → 跨市场替换风险. entry-block ≠ status-cancel (J1 decoupling):
    //   只拒新押注, 不碰 status/资金; 已有押注走 deadline 自动退款 (outpoint-precise) → 不 orphan 退款路.
    if (assertNotCommingled(market, reply, sqlite)) return;

    // G3 (世界杯上线门): 同 register-v07/prep 的市场级总 leaf 上限(结算侧 PayoutShard 1024 硬顶, #18 rolling 未建).
    const existingLeafCountG3 = getSidesByLogicalMarket(logicalMarketId, sqlite).length;
    if (existingLeafCountG3 >= MARKET_MAX_LEAVES_G3) {
      return reply.code(409).send({
        ok: false, error: 'market_full',
        message: `This market has reached its bet capacity (${existingLeafCountG3}/${MARKET_MAX_LEAVES_G3}) and cannot accept new bets. Please choose another market.`,
      });
    }

    const direction = parseInt(b.direction, 10);
    if (direction !== 0 && direction !== 1) return reply.code(400).send({ ok: false, error: 'direction must be 0 (YES) or 1 (NO)' });
    const stakeSompi = Math.round(parseFloat(b.stake_kas) * 1e8);
    if (!Number.isFinite(stakeSompi) || stakeSompi < BETTOR_MIN_STAKE_POLICY) return reply.code(400).send({ ok: false, error: `stake_kas must be >= ${BETTOR_MIN_STAKE_POLICY / 1e8} KAS` });

    // oracle/bettor exclusivity (area-1 invariant) — same as /bettor/register.
    let oracleIds = [];
    try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch {}
    // fresh keypair bettor (cross-node 命门③ fixture, NWT 干净地址要求 — 解 (c) gateway-as-bettor 派彩淹没 fixture 教训):
    //   b.bettor_pk 直传(64-hex x-only), gateway-sponsored 资助(testnet test, 无 bettor relay). 非 fresh 走 relay custody 模型.
    const freshBettor = !!(b.bettor_pk && !b.bettor_relay_id);
    let bettorPk, network;
    if (freshBettor) {
      if (!/^[0-9a-f]{64}$/i.test(b.bettor_pk)) return reply.code(400).send({ ok: false, error: 'bettor_pk must be 64-hex x-only pubkey' });
      bettorPk = b.bettor_pk.toLowerCase();
      network = 'testnet-12';
    } else {
      if (oracleIds.includes(b.bettor_relay_id)) return reply.code(403).send({ ok: false, error: 'bettor is in market oracle set (area-1 exclusivity)' });
      const bettorRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.bettor_relay_id);
      if (!bettorRow?.address) return reply.code(400).send({ ok: false, error: 'bettor relay not found' });
      bettorPk = await deriveXOnlyPubkey(bettorRow.address);
      network = bettorRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    }

    // gateway relay = market host (maker_relay_id); funds genesis/register, custodies bettor stake (testnet ramp).
    const gatewayRelayId = market.maker_relay_id;
    if (!isRelayAlive(gatewayRelayId)) return reply.code(503).send({ ok: false, error: 'gateway (maker) relay not alive' });
    const gw = await sendCommandAsync(gatewayRelayId, { type: 'get_pubkey' });
    const relayAddr = gw.address;
    if (!relayAddr) return reply.code(503).send({ ok: false, error: 'gateway relay get_pubkey returned no address' });

    // bettor funds the gateway (custody-bound, like publish): stake + register/genesis fee headroom.
    //   fresh keypair bettor: gateway sponsors stake from its own balance (testnet fixture, no bettor relay to transfer from).
    if (!freshBettor) {
      try { await transferAndConfirm(b.bettor_relay_id, relayAddr, ((stakeSompi + 200_000_000) / 1e8).toFixed(8)); }
      catch (e) { return reply.code(503).send({ ok: false, error: `bettor→gateway funding failed: ${e.message}` }); }
    }

    // relay helpers for the orchestrator (all on the gateway relay).
    const kaspa = await import('kaspa-wasm');
    const p2sh = (redeemHex) => kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), network).toString();
    const rc = (cmd) => sendCommandAsync(gatewayRelayId, cmd, 90000);
    // 事故硬化(2026-07-08, yxllc追踪): 这笔transfer的产物(fundTx)被喂进genesis-mint(ensurePayoutShardV2)
    // 当funding input, 最终落payout_shards表——同create-v07 spine那条纪律, 也升级深确认。
    const transfer = async (addr, sompi) => { const r = await transferAndConfirm(gatewayRelayId, addr, (Number(sompi) / 1e8).toFixed(8), { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 }); return r.txId; };
    // minDepth: 20 (J1 phantom-leaf 根治) — reorg-safe DAA-深度门: 浅确认 UTXO(被 reorg 退)不算 landed → register land-gate 不记 phantom leaf。poll 到 depth≥20 才 true; 超时返 false → caller throw(NO-TX-NO-STATE 不推进 leaf)。
    const landed = async (txid, addr, n = 25) => { for (let i = 0; i < n; i++) { const j = await sendCommandAsync(gatewayRelayId, { type: 'check_utxo_landed', address: addr, txid, minDepth: REORG_SAFE_MIN_DEPTH }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; };

    // shard→pool_markets row: each physical shard is a minimal pool_markets clone (FK shard_market_id REFERENCES pool_markets(id);
    //   foreign_keys=ON). UI aggregates shards under the logical market via market_shards.logical_market_id. ⚠ DESIGN-FLAG for team:
    //   (A)-model shards are ShardLeafs not independent markets — clone keeps the v171 FK satisfied; a leaner shard-row schema is a follow-up.
    const pmCols = sqlite.prepare('PRAGMA table_info(pool_markets)').all().map(c => c.name);
    const createShardMarketRow = async (shardIndex, shardP2sh) => {
      const shardMarketId = `${logicalMarketId}-s${shardIndex}`;
      // protocol_status='shard_internal' (Bettor clean-fix): excludes shard-clone rows from oracle-pool scan / /api/pool/markets
      //   aggregation / settle sweep (NOT 'pending_bettors' which would double-count). UI aggregates真 market by market_shards.logical_market_id.
      // maker_stake_amount=0 (Bettor clone-leak fix half-3, NWT 280≠80 discrepancy root): maker stakes ONCE on the parent market
      //   (outcome_side implicit bettor); shard clones are FK rows — copying parent's maker_stake → aggregation double-counts
      //   (N shards × maker stake = inflated pool display). Zero it on clones so only the parent carries maker stake.
      const clone = { ...market, id: shardMarketId, spine_p2sh: shardP2sh, protocol_status: 'shard_internal', maker_stake_amount: 0 };
      try {
        sqlite.prepare(`INSERT OR IGNORE INTO pool_markets (${pmCols.join(',')}) VALUES (${pmCols.map(() => '?').join(',')})`).run(...pmCols.map(c => clone[c]));
      } catch (e) { console.warn(`[register-v07] shard pool_markets clone warn: ${e.message}`); }
      return shardMarketId;
    };
    const recordBettor = async ({ shardMarketId, shardIndex, bettorPk: pk, direction: dir, stakeSompi: st, leafTx }) => {
      try {
        sqlite.prepare(`INSERT OR IGNORE INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(shardMarketId, pk, b.bettor_relay_id, dir, st, shardP2sh_of(shardMarketId), leafTx, shardIndex, '');
      } catch (e) { console.warn(`[register-v07] recordBettor warn: ${e.message}`); }
    };
    const shardP2sh_of = (smid) => (sqlite.prepare('SELECT shard_p2sh FROM market_shards WHERE shard_market_id = ?').get(smid)?.shard_p2sh) || '';

    try {
      const { registerBettorOnShard, computeCloseZkTmplAnchor } = await import('../lib/pool-shard-register.mjs');
      // 事故硬化(2026-07-08 backlog 调查, Bettor④指令): 这两处曾各自独立声明危险默认(target/release/
      // silverc.exe，会随任意 cargo build 原地漂移，07-07 事故的确切病灶), 改跟 pool-bshard-artifacts.mjs
      // 已修的那行同一模式——固定 versioned-builds 下按族 pin 的已知良性文件, 不再吃 target/release 默认。
      const silverc = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';
      const { zkNative: _zkNative, closeZkTmplAnchor: _closeZkTmplAnchor } = _resolveZkNativeCtorExtras(market, silverc, computeCloseZkTmplAnchor);
      // 命门① genesis coherence (NWT/Bettor load-bearing): PayoutShard 烤 predicate_commit = blake2b(canonicalPredicate(predicate))
      //   (单源 computePredicateCommit, 与 enforce 同函数) — 非 market_metadata_hash (= sha256({全市场元}) ≠ blake2b(canonical(predicate))
      //   → 委员 enforce hash-bind 永假 → close 永 BUST). predicate-less 市场(无结构化判)fallback metadata_hash(无命门③ enforce).
      const { computePredicateCommit, computeMarketCommit } = await import('../lib/pool-shard-settle.mjs');
      let _predicate = null;
      try { _predicate = JSON.parse(market.resolution_rule_spec || '{}')?.resolution_predicate || null; } catch {}
      // 命门④ v1 fee provenance (NWT 底线): fee 市场烤 computeMarketCommit({predicate, fee_recipients:{broker_pk, introducer_pk}})
      //   进 PS offset-518 commit slot (折进 predicate_commit 同一 32B, .sil 不变零 re-deploy). 委员 enforce 从被花 PS 读 + 同函数
      //   验 → settler 改 broker/introducer 地址 → 不符 → BUST. broker_pk/introducer_pk = market row create-baked (链同步).
      //   predicate-less 市场 fallback market_metadata_hash (无 fee provenance, 无 enforce). 单源 (genesis+enforce 同 computeMarketCommit).
      const _feeRecipients = { brokerPk: market.broker_pk || null, introducerPk: market.introducer_pk || null };
      const predicateCommit = _predicate ? computeMarketCommit(_predicate, _feeRecipients) : market.market_metadata_hash;
      // 件1(J1 deadline-gate, NWT option-a): partial-shard sweep gate = market.deadline (Unix s, = outcome_end floor,
      //   市场创建时 ctor-baked 非 spender → verify-value-source). ShardLeaf bakes it; partial 片仅 tx.time>=deadline 可归集
      //   (满片随时). 缺则 registerBettorOnShard fail-closed throw. predicate-less / 旧 .sil(无 deadline 参)则被忽略=无害.
      if (!Number.isFinite(Number(market.deadline)) || Number(market.deadline) <= 0) {
        return reply.code(409).send({ ok: false, error: 'v0.7 market missing deadline (partial-shard sweep gate, 件1)' });
      }
      const result = await registerBettorOnShard({
        db: sqlite, rc, transfer, landed, p2sh, logicalMarketId,
        poolMerkleRoot: market.pool_merkle_root, predicateCommit,
        bettorPk, direction, stakeSompi, relayAddr, silverc, sealCount: 32, deadline: market.deadline,
        createShardMarketRow, recordBettor,
        zkNative: _zkNative, closeZkTmplAnchor: _closeZkTmplAnchor,   // 非 zkNative 市场: false/null，等价于不传，行为不变
      });
      return reply.send({ ok: true, logical_market_id: logicalMarketId, bettor_pk: bettorPk, ...result });
    } catch (e) {
      console.error(`[pool/register-v07] ${logicalMarketId} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `register-v07 failed: ${e.message}` });
    }
  });

  // ── B (无限滚动分片押注) 0-custody 两步流: register-v07/prep + register-v07/confirm (J2 2026-06-30, Owner 钦定 fresh 实现) ──
  //   缺口: register-v07 (单体 L1103) 是 gateway-custody 一步 (无 /prep /confirm); bot 0-custody 用户自付流用不了 → 回退 v06 (单片 50-cap).
  //   本两步流 = 把现成 registerBettorOnShard (allocate-at-confirm·满 SHARD_SEAL_COUNT=32 自动开新片·无限) 包装成 0-custody-风格两步 (编排非造新机制).
  //   §3 命门 (J1 covenant·代码实证): relay handler unlockBshardRegister(p2sh.mjs:2024) 用 wallet.getPrivateKey() 签 funding input
  //     → funding 地址只能是 gateway relay 自己钱包地址 → 口径 = relay-assisted (relay 持 funds + 签); 纯 0-custody (bettor 自签) = follow-up.
  //   付款 attribution (shared relayAddr 防误吞): pay_amount = 注金 + per-(market,bettor,direction) deterministic nonce
  //     (sha256(market|pk|dir) % 9000 + 1000 sompi, <0.0001 KAS) → confirm 按 exact pay_amount 匹配 UTXO; 注金本身 = 注的整额 (nonce 不进池/不进 DB stake).
  //   经济守恒: bettor 付 pay_amount 到 relayAddr → gateway 余额 +pay_amount → registerBettorOnShard 从 gateway 余额垫 stake 进 leaf → gateway 净平 (+nonce 吸收 fee).
  //   betId = 可选 caller idempotency key (bot 每笔押注生成 UUID, 传 prep+confirm 两步) → 额外熵: 解同 bettor 同向【复押】碰撞
  //   (Bettor flag: hash(market+pk+dir) 对复押同 nonce → 同额 → 歧义). 无 betId 退化为 deterministic per (market,pk,dir).
  //   残余碰撞 (不同 betId hash 撞同 tag) → confirm 的 >1-match 拒绝/挂起 (J1 no-strand #1) 兜住, 非 strand.
  function _v07PayNonce(logicalMarketId, bettorPk, direction, betId) {
    const h = createHash('sha256').update(`${logicalMarketId}|${bettorPk}|${direction}|${betId || ''}`).digest();
    return 1000 + (h.readUInt32BE(0) % 89000);   // 1000..89999 sompi (<0.0009 KAS) attribution tag (relay 吸收, 不进池/DB stake)
  }
  // shared prelude for prep+confirm: validate + market gates + bettor_pk + area-1 exclusivity + gateway pay address.
  async function _v07PrepConfirmPrelude(logicalMarketId, b, reply) {
    const v = _extStakeValidate(b);
    if (v.error) { reply.code(v.code).send({ ok: false, error: v.error }); return null; }
    // 🔴 #28-followup (2026-07-01, Owner "第二次押注失败"): bot mybets/add-more reuses the POSITION's market_id, which is
    //   the SHARD id (pool_bettor_sides.market_id = shard_market_id, status=shard_internal) → prep/confirm would reject
    //   "market status=shard_internal, registration closed". Resolve a shard id → its logical parent so a re-bet routes to
    //   the open rolling shard exactly like a first bet. No-op for a real logical id (not in market_shards.shard_market_id).
    const _shardParent = sqlite.prepare('SELECT logical_market_id FROM market_shards WHERE shard_market_id = ?').get(logicalMarketId);
    if (_shardParent && _shardParent.logical_market_id) logicalMarketId = _shardParent.logical_market_id;
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(logicalMarketId);
    if (!market) { reply.code(404).send({ ok: false, error: 'market not found' }); return null; }
    if (market.protocol_version !== 'v0.7') { reply.code(409).send({ ok: false, error: `register-v07 requires protocol_version v0.7, got ${market.protocol_version}` }); return null; }
    if (market.protocol_status !== 'pending_bettors') { reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, registration closed` }); return null; }
    if (!market.pool_merkle_root) { reply.code(409).send({ ok: false, error: 'v0.7 market missing pool_merkle_root (committee)' }); return null; }
    // 件1 (J1 deadline-gate): ShardLeaf bakes deadline as the partial-shard sweep gate. fail-closed if missing.
    if (!Number.isFinite(Number(market.deadline)) || Number(market.deadline) <= 0) { reply.code(409).send({ ok: false, error: 'v0.7 market missing deadline (partial-shard sweep gate, 件1)' }); return null; }
    // NOTE: FINDING-2 ③ commingled guard is enforced INLINE in each register* handler (R-COMMINGLE-GUARD convention —
    //   the guard must be visible in the handler body, not hidden in a helper; see prep/confirm below).
    let bettorPk;
    try { bettorPk = await deriveXOnlyPubkey(b.linked_addr); }
    catch (e) { reply.code(400).send({ ok: false, error: `linked_addr → pubkey failed: ${e.message}` }); return null; }
    // area-1 exclusivity: oracle/maker cannot bet (mirror _extStakeDeriveSide guards).
    if ([market.oracle1_pk, market.oracle2_pk, market.oracle3_pk].includes(bettorPk)) { reply.code(403).send({ ok: false, error: 'linked address is an oracle of this market — oracle/bettor exclusivity (area-1)' }); return null; }
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address && (await deriveXOnlyPubkey(makerRow.address)) === bettorPk) { reply.code(403).send({ ok: false, error: 'linked address is the market maker — maker bets implicitly via outcome_side (area-1)' }); return null; }
    // gateway relay = market host (maker_relay_id); its P2PK wallet address = relay-signable funding/payment address (§3 relay-assisted).
    const gatewayRelayId = market.maker_relay_id;
    if (!isRelayAlive(gatewayRelayId)) { reply.code(503).send({ ok: false, error: 'gateway (maker) relay not alive' }); return null; }
    const gw = await sendCommandAsync(gatewayRelayId, { type: 'get_pubkey' });
    const relayAddr = gw.address;
    if (!relayAddr) { reply.code(503).send({ ok: false, error: 'gateway relay get_pubkey returned no address' }); return null; }
    const network = relayAddr.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const nonce = _v07PayNonce(logicalMarketId, bettorPk, v.direction, b.bet_id);
    const payAmountSompi = v.stakeAmount + nonce;
    // 🔴 #28 (B) wire-3/3 (J1 2026-07-01·Owner money-path 根治): payAddr = 【per-bet 独立 P2SH】(替共享 gw relayAddr)。
    //   付款根隔离 → relay 通用选币(defrag/transfer 等 17 路)物理碰不到 → 免并发花费(Martin paid-no-bet 根治)。
    //   ⚠ 确定性 by construction (Bettor wire-3/3 命门 option a): prep 与 confirm 【共用本 _v07PrepConfirmPrelude】·
    //   同参数(marketId|bettorPk|direction|payAmountSompi|betId·单源)→ get_per_bet_address 派生【同址】(perBetNonce 确定性)。
    //   per-bet 址唯一 → 该址只有这一笔付款·confirm exact-amount-match 在唯一址仍 work(零 commingle/零并发竞态)。
    //   perBetRedeem 带回供 confirm 后 sweep_per_bet 报销 gateway(gateway 已垫·sweep 异步·失败不 strand bet·daemon 重试)。
    const perBet = await sendCommandAsync(gatewayRelayId, {
      type: 'get_per_bet_address',
      marketId: logicalMarketId, bettorPk, direction: v.direction, payAmountSompi: String(payAmountSompi), betId: b.bet_id,
    });
    if (!perBet?.address || !perBet?.redeem_hex) { reply.code(503).send({ ok: false, error: `gateway relay get_per_bet_address failed (per-bet P2SH 派生): ${JSON.stringify(perBet).slice(0, 120)}` }); return null; }
    const payAddr = perBet.address;
    // #19 根治(2026-07-08, Martin孤儿单事故, 设计稿 docs/2026-07-08-betid-persistence-and-pending-
    // lifecycle-design.md, NWT审GREEN 0297e50e): 服务端持久化betId+payAddr, 不再让它只活在bot进程内存
    // pendingPayments里——console/bot任一重启, 这笔在途付款仍可按(marketId,bettorPk,direction)反查恢复。
    // UNIQUE建在bet_id本身(不是三元组), 允许同用户同方向多笔独立在途加注并存, 不覆盖冲掉彼此。
    try {
      sqlite.prepare(`
        INSERT INTO pool_bet_preps (logical_market_id, bettor_pk, direction, bet_id, pay_addr, exact_stake_sompi, stake_kas, created_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(bet_id) DO UPDATE SET
          pay_addr=excluded.pay_addr, exact_stake_sompi=excluded.exact_stake_sompi,
          stake_kas=excluded.stake_kas, created_at=excluded.created_at
      `).run(logicalMarketId, bettorPk, v.direction, String(b.bet_id || ''), payAddr, payAmountSompi, v.stakeAmount / 1e8, Math.floor(Date.now() / 1000));
    } catch (e) { console.warn(`[pool.js#19] pool_bet_preps持久化失败(不阻断prep/confirm主流程): ${e.message}`); }
    return { v, market, bettorPk, gatewayRelayId, payAddr, perBetRedeem: perBet.redeem_hex, relayAddr, network, payAmountSompi, logicalMarketId };
  }

  // POST /api/pool/market/:id/bettor/register-v07/prep — B step 1: compute pay address + exact pay amount (NO TX, no state change).
  fastify.post('/api/pool/market/:id/bettor/register-v07/prep', async (request, reply) => {
    let logicalMarketId = request.params.id;
    const p = await _v07PrepConfirmPrelude(logicalMarketId, request.body || {}, reply);
    if (!p) return;   // prelude already sent the error reply
    logicalMarketId = p.logicalMarketId;   // #28-followup: prelude resolved a shard id → its logical parent (re-bet routing)
    const { v, market, bettorPk, payAddr, network, payAmountSompi } = p;
    // FINDING-2 ③ commingled guard (单源·inline per R-COMMINGLE-GUARD convention).
    if (assertNotCommingled(market, reply, sqlite)) return;
    // G3 (世界杯上线门): SHARD_SEAL_COUNT=32 仍是无限开新片(片级无 cap), 但整个 logical market 的
    // 总 leaf 数(跨全部 shard)顶 MARKET_MAX_LEAVES_G3 — 结算侧 PayoutShard 硬顶 1024, #18 rolling
    // 未建前必须挡在这里(未付款前拒, NO TX NO STATE, 不是退款)。
    const existingLeafCount = getSidesByLogicalMarket(logicalMarketId, sqlite).length;
    if (existingLeafCount >= MARKET_MAX_LEAVES_G3) {
      return reply.code(409).send({
        ok: false, error: 'market_full',
        message: `This market has reached its bet capacity (${existingLeafCount}/${MARKET_MAX_LEAVES_G3}) and cannot accept new bets. Please choose another market.`,
      });
    }
    return reply.send({
      ok: true,
      protocol_version: 'v0.7',
      market_id: logicalMarketId,
      direction: v.direction,
      bettor_pk: bettorPk,
      side_p2sh: payAddr,                                  // bot 复用 v06 渲染字段 ("付到 side_p2sh"); 这里 = relay P2PK 收款地址
      pay_to_address: payAddr,
      bet_stake_sompi: v.stakeAmount,                      // 实际下注额 (进池/进 DB)
      bet_stake_kas: (v.stakeAmount / 1e8).toFixed(8),
      exact_stake_sompi: payAmountSompi,                   // 实付额 = 注金 + 唯一 nonce (attribution); bot/用户付这个
      exact_stake_kas: (payAmountSompi / 1e8).toFixed(8),
      pool_merkle_root: market.pool_merkle_root,
      network,
      deadline: market.deadline,
      custody: 'relay-assisted',
      warning: 'Pay EXACTLY exact_stake_kas to side_p2sh. relay-assisted custody: the gateway relay holds & signs the funding input — this is NOT non-custodial; for real funds use your own /link wallet. Your bet routes to the open rolling shard (auto-opens a new shard past 32 bets per shard — no per-market cap). The small amount above bet_stake_kas is a per-bettor payment tag absorbed by the gateway.',
    });
  });

  // POST /api/pool/market/:id/bettor/register-v07/confirm — B step 2: detect payment → registerBettorOnShard splice (NO TX NO STATE).
  fastify.post('/api/pool/market/:id/bettor/register-v07/confirm', async (request, reply) => {
    let logicalMarketId = request.params.id;
    const p = await _v07PrepConfirmPrelude(logicalMarketId, request.body || {}, reply);
    if (!p) return;
    logicalMarketId = p.logicalMarketId;   // #28-followup: prelude resolved a shard id → its logical parent (re-bet routing)
    const { v, market, bettorPk, gatewayRelayId, payAddr, perBetRedeem, network, payAmountSompi } = p;
    // FINDING-2 ③ commingled guard (单源·inline per R-COMMINGLE-GUARD convention).
    if (assertNotCommingled(market, reply, sqlite)) return;

    // ── detect payment: query relayAddr UTXOs, find one == payAmountSompi (exact, bettor-unique) not yet consumed ──
    let utxos;
    try {
      const { url: rpcUrl } = await getWorkingRpc();
      if (!rpcUrl) return reply.code(503).send({ ok: false, error: 'no working Kaspa RPC node — retry shortly' });
      const { RpcClient, Encoding, Address } = await import('kaspa-wasm');
      const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: network });
      await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 4000))]);
      try { ({ entries: utxos } = await rpc.getUtxosByAddresses([new Address(payAddr)])); }
      finally { await rpc.disconnect().catch(() => {}); }
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `RPC UTXO query failed (${e.message}) — retry shortly` });
    }
    utxos = utxos || [];
    // consumed = payment txids already registered across this logical market's shards (idempotent dedup).
    const consumed = new Set(
      sqlite.prepare(`SELECT pbs.side_lock_tx t FROM pool_bettor_sides pbs JOIN market_shards ms ON pbs.market_id = ms.shard_market_id WHERE ms.logical_market_id = ?`)
        .all(logicalMarketId).map(r => r.t)
    );
    const amtOf = (u) => { try { return BigInt(u.amount); } catch { return null; } };
    const txidOf = (u) => { const op = u.outpoint || u.entry?.outpoint; return op && (op.transactionId || op.transaction_id); };
    // 🔴 no-strand #1 (J1): 一额一 UTXO 唯一才注册. 多个 unconsumed UTXO 撞同 exact 额 (碰撞/重复付) → 绝不盲取一个 attribute
    //    (误吞=strand) → 拒绝/挂起, 款留 relayAddr (relay 控·可退·非黑洞), 让付款方改额重押.
    const matches = utxos.filter(u => amtOf(u) === BigInt(payAmountSompi) && txidOf(u) && !consumed.has(txidOf(u)));
    if (matches.length > 1) {
      return reply.send({ ok: true, registered: false, ambiguous: true, side_p2sh: payAddr, pay_to_address: payAddr,
        matching_unconsumed: matches.length, exact_stake_sompi: payAmountSompi, exact_stake_kas: (payAmountSompi / 1e8).toFixed(8),
        note: `${matches.length} unconsumed payments of exactly ${(payAmountSompi / 1e8).toFixed(8)} KAS detected at side_p2sh — refusing to auto-attribute (no-strand). Pass a distinct bet_id (idempotency key) per bet and pay its unique amount; funds at side_p2sh are relay-held and recoverable.` });
    }
    const candidate = matches[0];
    if (!candidate) {
      // #task32 fix (2026-07-03, Owner 500KAS 卡死根因): 已注册判定改成只信 DB, 不再依赖 hasMatchingUtxo
      // (payAddr 当前是否还有匹配 UTXO) — 注册成功后 L1448 附近的 sweep_per_bet 会把该 UTXO 扫走, 任何
      // sweep 之后的重复 poll 都会看到"UTXO 不在了"从而误判 pending(即使这笔早已真实注册, 实证见
      // pool_bettor_sides.id=11913)。精确匹配 pay_amount_sompi(=这一笔押注的确定性唯一 exact 付款额,
      // 每次 confirm 用同一个 bet_id 重算必得同值) — 不再用"pk+direction+market 取最新一条"这种可能
      // 认错笔的模糊匹配。
      const mine = sqlite.prepare(`SELECT pbs.market_id shard_market_id, pbs.side_lock_tx, pbs.merkle_index, pbs.stake_amount
          FROM pool_bettor_sides pbs JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
          WHERE ms.logical_market_id = ? AND pbs.bettor_pk = ? AND pbs.direction = ? AND pbs.pay_amount_sompi = ?
          ORDER BY pbs.id DESC LIMIT 1`)
        .get(logicalMarketId, bettorPk, v.direction, payAmountSompi);
      if (mine) {
        return reply.send({ ok: true, registered: true, already_registered: true, shard_market_id: mine.shard_market_id, side_lock_tx: mine.side_lock_tx, merkle_index: mine.merkle_index, stake_sompi: mine.stake_amount });
      }
      // legacy fallback: rows registered before v177(pay_amount_sompi 列)落地, 该列为 NULL — 退回旧的
      // "pk+direction+market 取最新一条"模糊匹配(仍是纯 DB 判定, 不依赖 UTXO), 缩小窗口只咬 pre-fix 数据。
      const legacyMine = sqlite.prepare(`SELECT pbs.market_id shard_market_id, pbs.side_lock_tx, pbs.merkle_index, pbs.stake_amount
          FROM pool_bettor_sides pbs JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
          WHERE ms.logical_market_id = ? AND pbs.bettor_pk = ? AND pbs.direction = ? AND pbs.pay_amount_sompi IS NULL
          ORDER BY pbs.id DESC LIMIT 1`)
        .get(logicalMarketId, bettorPk, v.direction);
      if (legacyMine) {
        return reply.send({ ok: true, registered: true, already_registered: true, shard_market_id: legacyMine.shard_market_id, side_lock_tx: legacyMine.side_lock_tx, merkle_index: legacyMine.merkle_index, stake_sompi: legacyMine.stake_amount });
      }
      return reply.send({ ok: true, registered: false, pending: true, side_p2sh: payAddr, pay_to_address: payAddr, exact_stake_sompi: payAmountSompi, exact_stake_kas: (payAmountSompi / 1e8).toFixed(8), note: `no payment of exactly ${(payAmountSompi / 1e8).toFixed(8)} KAS detected at side_p2sh yet — pay the exact amount and retry confirm.` });
    }
    const paymentTxid = txidOf(candidate);
    if (!paymentTxid) return reply.code(500).send({ ok: false, error: 'payment UTXO outpoint.transactionId missing' });

    // ── registerBettorOnShard wiring (relay-assisted; gateway funds stake into the leaf from its own balance, which the
    //    bettor's payment to payAddr=relayAddr has just replenished → economics conserved). NO TX NO STATE: splice must land. ──
    try {
      const kaspa = await import('kaspa-wasm');
      const p2sh = (redeemHex) => kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), network).toString();
      const rc = (cmd) => sendCommandAsync(gatewayRelayId, cmd, 90000);
      // 事故硬化(2026-07-08, yxllc追踪): 这笔transfer的产物(fundTx)被喂进genesis-mint(ensurePayoutShardV2)
      // 当funding input, 最终落payout_shards表——同create-v07 spine那条纪律, 也升级深确认。
      const transfer = async (addr, sompi) => { const r = await transferAndConfirm(gatewayRelayId, addr, (Number(sompi) / 1e8).toFixed(8), { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 }); return r.txId; };
      // minDepth: 20 (J1 phantom-leaf 根治) — reorg-safe DAA-深度门: 浅确认 UTXO(被 reorg 退)不算 landed → register land-gate 不记 phantom leaf。poll 到 depth≥20 才 true; 超时返 false → caller throw(NO-TX-NO-STATE 不推进 leaf)。
    const landed = async (txid, addr, n = 25) => { for (let i = 0; i < n; i++) { const j = await sendCommandAsync(gatewayRelayId, { type: 'check_utxo_landed', address: addr, txid, minDepth: REORG_SAFE_MIN_DEPTH }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; };
      // 🔴 #28 (B) REGRESSION FIX (J1 2026-07-01): register_append funding 必用【gateway 主址】不是 payAddr。
      //   payAddr 现已改为 per-bet 独立 P2SH(只有 bettor 这一笔付款·无 gateway 运营余额)。registerBettorOnShard
      //   从 relayAddr 选币垫 stake 进 leaf → 若用 per-bet 址(余额=单笔付款)→ 选不出 funding/签名错"failed to verify
      //   signature script"(部署后全盘注册+结算挂的真因)。gateway 主址 = p.relayAddr(prelude 返回的 gw.address)。
      const relayAddr = p.relayAddr;

      // shard→pool_markets clone row (FK shard_market_id REFERENCES pool_markets(id)) — identical to monolithic register-v07.
      const pmCols = sqlite.prepare('PRAGMA table_info(pool_markets)').all().map(c => c.name);
      const shardP2sh_of = (smid) => (sqlite.prepare('SELECT shard_p2sh FROM market_shards WHERE shard_market_id = ?').get(smid)?.shard_p2sh) || '';
      const createShardMarketRow = async (shardIndex, shardP2sh) => {
        const shardMarketId = `${logicalMarketId}-s${shardIndex}`;
        const clone = { ...market, id: shardMarketId, spine_p2sh: shardP2sh, protocol_status: 'shard_internal', maker_stake_amount: 0 };
        try { sqlite.prepare(`INSERT OR IGNORE INTO pool_markets (${pmCols.join(',')}) VALUES (${pmCols.map(() => '?').join(',')})`).run(...pmCols.map(c => clone[c])); }
        catch (e) { console.warn(`[register-v07/confirm] shard pool_markets clone warn: ${e.message}`); }
        return shardMarketId;
      };
      // recordBettor: side_lock_tx = bettor's PAYMENT txid (= idempotent dedup key + audit anchor; mirrors v06 semantics),
      //   stake_amount = the bet stake (round, nonce excluded), side_p2sh = the shard's p2sh (shard-aware read parity).
      //   pay_amount_sompi = this bet's exact deterministic paid amount(v177, task#32) — the confirm-idempotency
      //   re-poll lookup above matches on this, not on whether the payment UTXO is still sitting at payAddr.
      const recordBettor = async ({ shardMarketId, shardIndex, bettorPk: pk, direction: dir, stakeSompi: st }) => {
        try {
          sqlite.prepare(`INSERT OR IGNORE INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, pay_amount_sompi)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(shardMarketId, pk, null, dir, st, shardP2sh_of(shardMarketId), paymentTxid, shardIndex, '', payAmountSompi);
        } catch (e) { console.warn(`[register-v07/confirm] recordBettor warn: ${e.message}`); }
      };

      // 命门①③④ genesis coherence: predicate_commit = computeMarketCommit({predicate, fee_recipients}) (单源, 与 enforce 同函数);
      //   predicate-less 市场 fallback market_metadata_hash (无 enforce). 同 monolithic register-v07.
      const { computeMarketCommit } = await import('../lib/pool-shard-settle.mjs');
      let _predicate = null;
      try { _predicate = JSON.parse(market.resolution_rule_spec || '{}')?.resolution_predicate || null; } catch {}
      const _feeRecipients = { brokerPk: market.broker_pk || null, introducerPk: market.introducer_pk || null };
      const predicateCommit = _predicate ? computeMarketCommit(_predicate, _feeRecipients) : market.market_metadata_hash;

      const { registerBettorOnShard, computeCloseZkTmplAnchor } = await import('../lib/pool-shard-register.mjs');
      // 事故硬化(2026-07-08 backlog 调查, Bettor④指令): 这两处曾各自独立声明危险默认(target/release/
      // silverc.exe，会随任意 cargo build 原地漂移，07-07 事故的确切病灶), 改跟 pool-bshard-artifacts.mjs
      // 已修的那行同一模式——固定 versioned-builds 下按族 pin 的已知良性文件, 不再吃 target/release 默认。
      const silverc = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';
      // 🔴 事故修复(2026-07-08, cswib 首证撞见): 本 endpoint(prep+confirm 两步流, #28)此前完全没有读
      // resolution_rule_spec.zk_native——registerBettorOnShard 的 zkNative 参数缺省 false, 导致任何标记
      // zk_native=true 的市场经这条路径首注 genesis-mint 时静默铸成 V1 PayoutShard(committee-sig), 不是
      // PayoutShardV2——市场从 genesis 起物理上没有 zk_handoff/zk_close/claim 三个 entry, ZK 彩排/结算走不通。
      // 老的单体 /register-v07 endpoint 一直有这段逻辑, 只是没人发现两条路径分叉了。Bettor 裁定(#bo75z6):
      // 不抄一段重复代码(今晚已两次撞"两套并行实现"同族病), 抽共享函数 _resolveZkNativeCtorExtras, 两处调用同一份。
      const { zkNative: _zkNative, closeZkTmplAnchor: _closeZkTmplAnchor } = _resolveZkNativeCtorExtras(market, silverc, computeCloseZkTmplAnchor);
      const result = await registerBettorOnShard({
        db: sqlite, rc, transfer, landed, p2sh, logicalMarketId,
        poolMerkleRoot: market.pool_merkle_root, predicateCommit,
        bettorPk, direction: v.direction, stakeSompi: v.stakeAmount, relayAddr, silverc, sealCount: 32, deadline: market.deadline,
        createShardMarketRow, recordBettor,
        zkNative: _zkNative, closeZkTmplAnchor: _closeZkTmplAnchor,   // 非 zkNative 市场: false/null，等价于不传，行为不变
      });
      // 🔴 #28 (B) wire-3/3 报销: bet 已注册 → sweep per-bet P2SH 付款回 gateway(补偿 gateway 垫的 stake)。
      //   **fire-and-forget·best-effort**: 不 await(不阻 success 返回)·sweep 失败【绝不 strand bet】(bet 已注册·gateway
      //   已垫·链上真相已成)·未 sweep 由 reconciliation daemon(J2 piece④)扫描重试防 gateway 失血。perBetRedeem 来自
      //   prelude(prep/confirm 同源派生·byte-identical)。per-bet 唯一址 → sweep 只扫这一笔付款·不碰别的。
      if (perBetRedeem) {
        sendCommandAsync(gatewayRelayId, { type: 'sweep_per_bet', per_bet_address: payAddr, redeem_hex: perBetRedeem }, 90000)
          .then((sr) => { if (!sr?.ok) console.warn(`[confirm] sweep_per_bet ${logicalMarketId} not-ok: ${JSON.stringify(sr).slice(0, 100)} (bet 已注册·daemon 重试报销)`); })
          .catch((e) => console.warn(`[confirm] sweep_per_bet ${logicalMarketId} fail: ${e.message} (bet 已注册·daemon 重试报销)`));
      }
      // #19: 注册成功 = 这笔已有归宿, 回写confirmed_at(区分'仍在途待恢复'vs'已完成', 恢复工具按confirmed_at IS NULL筛)。
      try { sqlite.prepare(`UPDATE pool_bet_preps SET confirmed_at = ? WHERE bet_id = ?`).run(Math.floor(Date.now() / 1000), String((request.body || {}).bet_id || '')); } catch {}
      return reply.send({
        ok: true, registered: true, protocol_version: 'v0.7', logical_market_id: logicalMarketId,
        bettor_pk: bettorPk, direction: v.direction,
        side_lock_tx: paymentTxid, stake_sompi: v.stakeAmount, stake_kas: (v.stakeAmount / 1e8).toFixed(8),
        custody: 'relay-assisted', ...result,
      });
    } catch (e) {
      console.error(`[pool/register-v07/confirm] ${logicalMarketId} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `register-v07/confirm failed: ${e.message}` });
    }
  });

  // POST /api/admin/pool/register-v07/confirm-by-address — betId 不可恢复时的登记逃生路(#19,
  // 2026-07-08 Martin 孤儿单事故, Bettor 七条件批准 #bqifty)。跳过 prep/confirm 的 nonce 唯一性密码学证明,
  // 改用运营方人工核实的 (txid, address, amount) 三元组直接登记——这是一次信任模型让步, 每笔都要 Bettor 批
  // txid + NWT 独立核三元组(流程纪律, 不在代码里强制, 由知道 ADMIN_SECRET 的人自律执行), 代码只负责:
  // ①txid:output 精确匹配(非地址扫描/非"够就行") ②内部 secret+IP allowlist 双闸 ③审计硬写 events 表
  // ④窄路由默认 OFF ⑤幂等 fail-closed。
  // ⚠ 已知的、接受的窄范围代码重复:下面 rc/transfer/landed/p2sh/createShardMarketRow/recordBettor 六个
  // closure 与 confirm endpoint(上面)里的同名 closure 逻辑一致——这条是罕用救急工具(不是常规业务路径),
  // 且每处改动都要过 NWT 审, 权衡后不为它抽共享 helper(避免过度设计一个几乎不会被调用第二次的路径)。
  fastify.post('/api/admin/pool/register-v07/confirm-by-address', async (request, reply) => {
    if (process.env.ADMIN_CONFIRM_BY_ADDRESS_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_CONFIRM_BY_ADDRESS_ENABLED != 1, 救单窗口外默认关, 条件⑥)' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_SECRET env 未设)' });
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ ok: false, error: 'admin auth fail (X-KANet-Admin-Secret 缺失/不匹配, 条件②)' });
    }
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `admin auth fail (source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST, 条件②)` });
    }

    const b = request.body || {};
    const { market_id, linked_addr, direction, stake_kas, pay_addr, payment_txid, approved_by, evidence_source } = b;
    if (!market_id || !linked_addr || direction === undefined || !stake_kas || !pay_addr || !payment_txid || !approved_by || !evidence_source) {
      return reply.code(400).send({ ok: false, error: 'market_id, linked_addr, direction, stake_kas, pay_addr, payment_txid, approved_by(谁批的txid), evidence_source(证据来源, 如"Owner转发Martin付款指引原文") 全部必需' });
    }
    const dir = parseInt(direction, 10);
    if (dir !== 0 && dir !== 1) return reply.code(400).send({ ok: false, error: 'direction must be 0|1' });
    const stakeSompi = Math.round(parseFloat(stake_kas) * 1e8);
    if (!Number.isFinite(stakeSompi) || stakeSompi <= 0) return reply.code(400).send({ ok: false, error: 'stake_kas must be positive finite' });

    let logicalMarketId = market_id;
    const shardParent = sqlite.prepare('SELECT logical_market_id FROM market_shards WHERE shard_market_id = ?').get(logicalMarketId);
    if (shardParent?.logical_market_id) logicalMarketId = shardParent.logical_market_id;
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(logicalMarketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (assertNotCommingled(market, reply, sqlite)) return;

    let bettorPk;
    try { bettorPk = await deriveXOnlyPubkey(linked_addr); }
    catch (e) { return reply.code(400).send({ ok: false, error: `linked_addr → pubkey failed: ${e.message}` }); }

    // 幂等 fail-closed(条件⑤): 同(logicalMarketId, bettorPk, dir)已注册则原样返回, 拒绝重复登记。
    const existing = sqlite.prepare(`
      SELECT pbs.market_id shard_market_id, pbs.side_lock_tx, pbs.stake_amount FROM pool_bettor_sides pbs
      JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
      WHERE ms.logical_market_id = ? AND pbs.bettor_pk = ? AND pbs.direction = ?
      ORDER BY pbs.id DESC LIMIT 1`).get(logicalMarketId, bettorPk, dir);
    if (existing) {
      return reply.send({ ok: true, already_registered: true, shard_market_id: existing.shard_market_id, side_lock_tx: existing.side_lock_tx, stake_sompi: existing.stake_amount });
    }

    // 条件①: txid:output 精确匹配(非地址扫描)——直连 RPC 查这个具体 txid 的 output 是否确实落在 pay_addr,
    // 金额是否落在 [stakeSompi+1000, stakeSompi+9999](= _v07PayNonce 的产出区间)内——不是宽松">=够就行"。
    let matchedAmount = null;
    try {
      const { url: rpcUrl } = await getWorkingRpc();
      if (!rpcUrl) return reply.code(503).send({ ok: false, error: 'no working Kaspa RPC node — retry shortly' });
      const kaspa = await import('kaspa-wasm');
      const network = pay_addr.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
      const rpc = new kaspa.RpcClient({ url: rpcUrl, encoding: kaspa.Encoding.Borsh, networkId: network });
      await rpc.connect({});
      try {
        const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(pay_addr)]);
        const hit = (entries || []).find(e => e.outpoint.transactionId === payment_txid);
        if (!hit) {
          return reply.code(404).send({ ok: false, error: `payment_txid ${payment_txid} 的 output 未在 pay_addr ${pay_addr} 当前 UTXO 集里找到(可能已被 spend, 或 txid/地址不匹配)` });
        }
        matchedAmount = BigInt(hit.amount);
      } finally { await rpc.disconnect().catch(() => {}); }
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `RPC 查询失败: ${e.message}` });
    }
    // 事故修复(2026-07-08, Martin救单实战撞到): NONCE_MAX原写9999是记错的——真实_v07PayNonce(pool.js:1345)
    // 公式是 nonce = 1000 + (h.readUInt32BE(0) % 89000), 真实区间是[1000, 89999], 不是[1000,9999]。
    // 常量单源: 直接从NONCE_MIN/MAX不再手写数字, 而是精确复刻公式本身的边界(1000 + 89000 - 1 = 89999)。
    const NONCE_MIN = 1000n, NONCE_MAX = 1000n + 89000n - 1n;
    const delta = matchedAmount - BigInt(stakeSompi);
    if (delta < NONCE_MIN || delta > NONCE_MAX) {
      return reply.code(400).send({ ok: false, error: `精确匹配失败: 观测金额${matchedAmount} - 期望注额${stakeSompi} = ${delta}, 不在合法 nonce 区间 [${NONCE_MIN},${NONCE_MAX}] 内(条件①), 拒绝登记` });
    }

    // 条件③: 审计硬写 events 表(登记动作发生前落笔, 无论后续成功与否都留痕)。
    sqlite.prepare(`INSERT INTO events (event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      'admin', 'admin_confirm_by_address', 'pool.js:admin-confirm-by-address', 'warn',
      `admin override: market=${logicalMarketId} bettor=${bettorPk.slice(0, 10)} dir=${dir} pay_addr=${pay_addr} txid=${payment_txid} approved_by=${approved_by}`,
      JSON.stringify({ market_id: logicalMarketId, bettorPk, direction: dir, pay_addr, payment_txid, stake_sompi: stakeSompi, matched_amount_sompi: matchedAmount.toString(), approved_by, evidence_source }),
      Math.floor(Date.now() / 1000),
    );

    try {
      const gatewayRelayId = market.maker_relay_id;
      if (!isRelayAlive(gatewayRelayId)) return reply.code(503).send({ ok: false, error: 'gateway (maker) relay not alive' });
      const gw = await sendCommandAsync(gatewayRelayId, { type: 'get_pubkey' });
      const relayAddr = gw.address;
      if (!relayAddr) return reply.code(503).send({ ok: false, error: 'gateway relay get_pubkey returned no address' });
      const network = relayAddr.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
      const kaspa = await import('kaspa-wasm');
      const p2sh = (redeemHex) => kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), network).toString();
      const rc = (cmd) => sendCommandAsync(gatewayRelayId, cmd, 90000);
      const transfer = async (addr, sompi) => { const r = await transferAndConfirm(gatewayRelayId, addr, (Number(sompi) / 1e8).toFixed(8), { minDepth: REORG_SAFE_MIN_DEPTH, maxWaitMs: 60000 }); return r.txId; };
      const landed = async (txid, addr, n = 25) => { for (let i = 0; i < n; i++) { const j = await sendCommandAsync(gatewayRelayId, { type: 'check_utxo_landed', address: addr, txid, minDepth: REORG_SAFE_MIN_DEPTH }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; };
      const pmCols = sqlite.prepare('PRAGMA table_info(pool_markets)').all().map(c => c.name);
      const shardP2sh_of = (smid) => (sqlite.prepare('SELECT shard_p2sh FROM market_shards WHERE shard_market_id = ?').get(smid)?.shard_p2sh) || '';
      const createShardMarketRow = async (shardIndex, shardP2sh) => {
        const shardMarketId = `${logicalMarketId}-s${shardIndex}`;
        const clone = { ...market, id: shardMarketId, spine_p2sh: shardP2sh, protocol_status: 'shard_internal', maker_stake_amount: 0 };
        try { sqlite.prepare(`INSERT OR IGNORE INTO pool_markets (${pmCols.join(',')}) VALUES (${pmCols.map(() => '?').join(',')})`).run(...pmCols.map(c => clone[c])); }
        catch (e) { console.warn(`[admin-confirm-by-address] shard pool_markets clone warn: ${e.message}`); }
        return shardMarketId;
      };
      const recordBettor = async ({ shardMarketId, shardIndex, bettorPk: pk, direction: rdir, stakeSompi: st }) => {
        try {
          sqlite.prepare(`INSERT OR IGNORE INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, pay_amount_sompi)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(shardMarketId, pk, null, rdir, st, shardP2sh_of(shardMarketId), payment_txid, shardIndex, '', matchedAmount.toString());
        } catch (e) { console.warn(`[admin-confirm-by-address] recordBettor warn: ${e.message}`); }
      };

      const { computeMarketCommit } = await import('../lib/pool-shard-settle.mjs');
      let _predicate = null;
      try { _predicate = JSON.parse(market.resolution_rule_spec || '{}')?.resolution_predicate || null; } catch {}
      const _feeRecipients = { brokerPk: market.broker_pk || null, introducerPk: market.introducer_pk || null };
      const predicateCommit = _predicate ? computeMarketCommit(_predicate, _feeRecipients) : market.market_metadata_hash;

      const { registerBettorOnShard, computeCloseZkTmplAnchor } = await import('../lib/pool-shard-register.mjs');
      const silverc = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';
      const { zkNative: _zkNative, closeZkTmplAnchor: _closeZkTmplAnchor } = _resolveZkNativeCtorExtras(market, silverc, computeCloseZkTmplAnchor);
      const result = await registerBettorOnShard({
        db: sqlite, rc, transfer, landed, p2sh, logicalMarketId,
        poolMerkleRoot: market.pool_merkle_root, predicateCommit,
        bettorPk, direction: dir, stakeSompi, relayAddr, silverc, sealCount: 32, deadline: market.deadline,
        createShardMarketRow, recordBettor,
        zkNative: _zkNative, closeZkTmplAnchor: _closeZkTmplAnchor,
      });
      return reply.send({
        ok: true, registered: true, protocol_version: 'v0.7', logical_market_id: logicalMarketId,
        bettor_pk: bettorPk, direction: dir,
        side_lock_tx: payment_txid, stake_sompi: stakeSompi, stake_kas: (stakeSompi / 1e8).toFixed(8),
        custody: 'relay-assisted-admin-override', ...result,
      });
    } catch (e) {
      console.error(`[admin-confirm-by-address] ${logicalMarketId} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `admin-confirm-by-address failed: ${e.message}` });
    }
  });

  // GET /api/pool/config — static defaults for UI pre-submit preview (D4 wallet浮窗 estimate fee)
  // POST /api/admin/pool/propose-close-v2 — buildProposeCloseRequestV2 的活进程调用入口(2026-07-08,
  // market5/pxvml 首次实战 propose)。只是执行位置的 wiring(standalone 脚本连不到 relay-manager.js 的
  // 活 relay 注册表), 不是新业务逻辑——buildProposeCloseRequestV2 本身已设计+落码(缺件② thin-shell),
  // 复用 adminConfirmByAddress 同款 secret+IP allowlist 认证(条件②⑤同款), 窄路由默认 OFF。
  fastify.post('/api/admin/pool/propose-close-v2', async (request, reply) => {
    if (process.env.ADMIN_PROPOSE_CLOSE_V2_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_PROPOSE_CLOSE_V2_ENABLED != 1)' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_SECRET env 未设)' });
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ ok: false, error: 'admin auth fail (X-KANet-Admin-Secret 缺失/不匹配)' });
    }
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `admin auth fail (source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST)` });
    }
    const { market_id, winning_direction, end_block_hash, settler_relay_id } = request.body || {};
    if (!market_id || (winning_direction !== 0 && winning_direction !== 1) || !end_block_hash || !settler_relay_id) {
      return reply.code(400).send({ ok: false, error: 'market_id, winning_direction(0|1), end_block_hash, settler_relay_id 全部必需' });
    }
    try {
      const { buildProposeCloseRequestV2 } = await import('../lib/bshard-close-transport.mjs');
      const result = await buildProposeCloseRequestV2(market_id, {
        winningDirection: winning_direction, endBlockHash: end_block_hash, settlerRelayId: settler_relay_id,
      });
      return reply.send({ ok: true, ...result });
    } catch (e) {
      console.error(`[admin/propose-close-v2] ${market_id} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `propose-close-v2 failed: ${e.message}` });
    }
  });

  // POST /api/admin/pool/zk-handoff-v2 — 门①(J1tn, 2026-07-08 市场5彩排): buildZkHandoffRequestV2 的
  // 活进程调用入口。同 propose-close-v2 同款理由(standalone 脚本连不到活 relay 注册表)+同款认证
  // (secret+IP allowlist)+窄路由默认 OFF。dryRun 默认 true(彩排门①纪律: 先 dry-run 核对再真广播,
  // caller 必须显式传 dry_run:false 才会真花钱广播——防止默认值意外真广播)。
  fastify.post('/api/admin/pool/zk-handoff-v2', async (request, reply) => {
    if (process.env.ADMIN_ZK_HANDOFF_V2_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_ZK_HANDOFF_V2_ENABLED != 1)' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_SECRET env 未设)' });
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ ok: false, error: 'admin auth fail (X-KANet-Admin-Secret 缺失/不匹配)' });
    }
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `admin auth fail (source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST)` });
    }
    const { market_id, settler_relay_id, dry_run } = request.body || {};
    if (!market_id || !settler_relay_id) {
      return reply.code(400).send({ ok: false, error: 'market_id, settler_relay_id 全部必需' });
    }
    try {
      const { buildZkHandoffRequestV2 } = await import('../lib/bshard-close-transport.mjs');
      const result = await buildZkHandoffRequestV2(market_id, {
        settlerRelayId: settler_relay_id, dryRun: dry_run !== false,
      });
      return reply.send({ ok: true, marketId: market_id, ...result });
    } catch (e) {
      console.error(`[admin/zk-handoff-v2] ${market_id} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `zk-handoff-v2 failed: ${e.message}` });
    }
  });

  // POST /api/admin/pool/zk-close-v2 — 门②真广播(J2, 2026-07-09 市场5R-2彩排): dispatchUnlockZkClose 的
  // 活进程调用入口。同 propose-close-v2/zk-handoff-v2 一字不差理由(standalone 脚本连不到活 relay 注册表,
  // 纯执行位置 wiring, 零新业务逻辑)+同款认证(secret+IP allowlist)+窄路由默认 OFF。ZK_CLOSE_TICK_ENABLED
  // 自治 daemon 分支仍留 OFF(确认令制)——本端点是 money-entry 广播前贴预期值→盲算比对→GO 纪律下的手动
  // 触发口, 不是自治 tick。ctx 复用 dispatchUnlockZkClose 既定契约(zk-close-dispatch.mjs:65-70): kaspaZk
  // 单一加载器(zk-prove-worker.mjs, #cb42af 纪律)+ relayCall 走 sendCommandAsync(活 relay 注册表)。
  // dry_run(Bettor 批文约束①要求, 镜像 zk-handoff-v2 契约): dispatchUnlockZkClose 本身/kasia-relay
  // unlockBshardZkClose 都没有原生 dryRun 分支(跟 unlockBshardZkHandoff 不同, 不碰更高风险的 covenant
  // 广播代码新增分支)——dry_run!==false(含未传, 安全默认同 zk-handoff-v2)时改走已审查过的
  // gateZkClose 彩排模拟路径(rehearsal-pre-broadcast-gate.mjs, 跟 zk-close-gate-debugger 端点同函数,
  // 零广播); 只有显式传 dry_run:false 才真调 dispatchUnlockZkClose 广播。
  fastify.post('/api/admin/pool/zk-close-v2', async (request, reply) => {
    if (process.env.ADMIN_ZK_CLOSE_V2_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_ZK_CLOSE_V2_ENABLED != 1)' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_SECRET env 未设)' });
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ ok: false, error: 'admin auth fail (X-KANet-Admin-Secret 缺失/不匹配)' });
    }
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `admin auth fail (source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST)` });
    }
    const { market_id, settler_relay_id, dry_run, gate_utxo_value_sompi } = request.body || {};
    if (!market_id || !settler_relay_id) {
      return reply.code(400).send({ ok: false, error: 'market_id, settler_relay_id 全部必需' });
    }
    try {
      const market = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(market_id);
      if (!market) return reply.code(404).send({ ok: false, error: `market ${market_id} not found` });
      const meta = JSON.parse(market.metadata || '{}');
      const zkCont = meta.zk_continuation;
      if (!zkCont) return reply.code(409).send({ ok: false, error: 'zk_continuation missing (zk_handoff 未完成)' });
      const { kaspaZk } = await import('../services/zk-prove-worker.mjs');
      if (dry_run !== false) {
        if (gate_utxo_value_sompi == null) return reply.code(400).send({ ok: false, error: 'dry_run 模式需 gate_utxo_value_sompi(同 zk-close-gate-debugger)' });
        // beforeState 来源与 zk-close-gate-debugger 端点(pool.js:1938-1942)一字不差: payout_shards 是
        // attest 落链后没被 handoff 动过的单一真值来源, 门①用它铸出了当前这个 CloseZkV2 genesis。
        const { gateZkClose } = await import('../lib/rehearsal-pre-broadcast-gate.mjs');
        const { readPayoutShardV2AttestedState } = await import('../lib/bshard-close-enforce.mjs');
        const ps = sqlite.prepare('SELECT payout_redeem_hex FROM payout_shards WHERE logical_market_id = ?').get(market_id);
        if (!ps) return reply.code(404).send({ ok: false, error: `no payout_shards row for ${market_id}` });
        const state = readPayoutShardV2AttestedState(ps.payout_redeem_hex);
        if (!process.env.ZK_GATE_TMPL_HASH) return reply.code(503).send({ ok: false, error: 'ZK_GATE_TMPL_HASH env 未设(不接受硬编码 fallback)' });
        const ZERO32 = '00'.repeat(32);
        const beforeState = {
          gateTmplHash: process.env.ZK_GATE_TMPL_HASH, betsRootBaked: state.betsRootHex, refundRootBaked: state.refundRootHex,
          attestedAtMs: state.attestedAtMs, attestedWinner: state.attestedWinner, closed: 1,
          payoutRootHex: ZERO32, consolidatedPool: state.consolidatedPool,
        };
        const ctx = { getMarket: (mid) => sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(mid), getDoneJob: (mid) => sqlite.prepare(`SELECT receipt_hex FROM zk_prove_jobs WHERE market_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1`).get(mid), kaspaZk: () => kaspaZk() };
        const result = gateZkClose(market_id, ctx, beforeState, { gateUtxoValueSompi: gate_utxo_value_sompi });
        return reply.send({ ok: true, marketId: market_id, broadcasted: false, ...result });
      }
      const { dispatchUnlockZkClose } = await import('../lib/zk-close-dispatch.mjs');
      const ctx = {
        getMarket: (mid) => sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(mid),
        getDoneJob: (mid) => sqlite.prepare(`SELECT receipt_hex FROM zk_prove_jobs WHERE market_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1`).get(mid),
        kaspaZk: () => kaspaZk(),
        relayCall: (cmd) => sendCommandAsync(settler_relay_id, cmd, 90000),
      };
      const result = await dispatchUnlockZkClose({ marketId: market_id, continuationOutpoint: zkCont.outpoint, attestedWinner: zkCont.attestedWinner }, ctx);
      if (!result.ok) return reply.code(500).send({ ok: false, error: result.error });
      return reply.send({ ok: true, marketId: market_id, broadcasted: true, txId: result.txid });
    } catch (e) {
      console.error(`[admin/zk-close-v2] ${market_id} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `zk-close-v2 failed: ${e.message}` });
    }
  });

  // POST /api/admin/pool/zk-close-gate-debugger — 门②(J1tn, 2026-07-08 市场5彩排 T1.5): 用生产共享函数
  // rebuildZkCloseGateWitness(zk-close-dispatch.mjs, 跟真广播 dispatchUnlockZkClose 完全同一条 witness
  // 构造代码路, §1.2 反vacuous 铁律)重建 gate witness, 拼 cli-debugger test-case 跑 --run-all, 只读不广播。
  // 同 propose-close-v2/zk-handoff-v2 款 secret+IP allowlist + 窄路由默认 OFF。
  fastify.post('/api/admin/pool/zk-close-gate-debugger', async (request, reply) => {
    if (process.env.ADMIN_ZK_CLOSE_GATE_DEBUGGER_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_ZK_CLOSE_GATE_DEBUGGER_ENABLED != 1)' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_SECRET env 未设)' });
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ ok: false, error: 'admin auth fail (X-KANet-Admin-Secret 缺失/不匹配)' });
    }
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `admin auth fail (source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST)` });
    }
    const { market_id, gate_utxo_value_sompi } = request.body || {};
    if (!market_id || gate_utxo_value_sompi == null) {
      return reply.code(400).send({ ok: false, error: 'market_id, gate_utxo_value_sompi 全部必需' });
    }
    try {
      const { gateZkClose } = await import('../lib/rehearsal-pre-broadcast-gate.mjs');
      const { readPayoutShardV2AttestedState } = await import('../lib/bshard-close-enforce.mjs');
      // 🔴 STOP修正(2026-07-08, KANet-UI实战撞出, Bettor #cb42af 顺手要求收拢单一加载器): ZkScriptBuilder
      //   不在常规 kaspa-wasm 包里, 是独立的 ZK-SDK isolated build——不在这里第二次声明 ZKSDK_WASM_PATH
      //   路径常量/require 调用, 直接复用 zk-prove-worker.mjs 已导出的 kaspaZk()(唯一加载器, 同一份缓存)。
      const { kaspaZk } = await import('../services/zk-prove-worker.mjs');
      const kaspa = kaspaZk();
      const ZERO32 = '00'.repeat(32);

      // beforeState: 跟门①(zk_handoff)读的同一份来源(payout_shards, 自 attest 落链后没被 handoff 动过,
      // 门①用它铸出了当前这个 CloseZkV2 genesis)——不新起一套 closed==1 状态解析器, 复用单一真值来源。
      const ps = sqlite.prepare('SELECT payout_redeem_hex FROM payout_shards WHERE logical_market_id = ?').get(market_id);
      if (!ps) return reply.code(404).send({ ok: false, error: `no payout_shards row for ${market_id}` });
      const state = readPayoutShardV2AttestedState(ps.payout_redeem_hex);
      // 🔴 STOP修正(2026-07-08, Bettor #cb42af 抓到同族雷): 不接受硬编码 fallback(会悄悄过期, 511b0ead
      // 是 repro4 时代旧值) —— 缺 env 直接 throw, 不留"看起来能跑但值可能不对"的窗口。
      if (!process.env.ZK_GATE_TMPL_HASH) return reply.code(503).send({ ok: false, error: 'ZK_GATE_TMPL_HASH env 未设(不接受硬编码 fallback)' });
      const gateTmplHash = process.env.ZK_GATE_TMPL_HASH;
      const beforeState = {
        gateTmplHash, betsRootBaked: state.betsRootHex, refundRootBaked: state.refundRootHex,
        attestedAtMs: state.attestedAtMs, attestedWinner: state.attestedWinner, closed: 1,
        payoutRootHex: ZERO32, consolidatedPool: state.consolidatedPool,
      };

      const ctx = {
        getMarket: (mid) => sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(mid),
        getDoneJob: (mid) => sqlite.prepare(`SELECT receipt_hex FROM zk_prove_jobs WHERE market_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1`).get(mid),
        kaspaZk: () => kaspa,
      };
      const result = gateZkClose(market_id, ctx, beforeState, { gateUtxoValueSompi: gate_utxo_value_sompi });
      return reply.send({ ok: true, ...result });
    } catch (e) {
      console.error(`[admin/zk-close-gate-debugger] ${market_id} fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `zk-close-gate-debugger failed: ${e.message}` });
    }
  });

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

  // GET /api/pool/fee-config — 价值分成 fee 协议常量 (单源 = pool-shard-settle FEE_CONFIG; UI 收口读此防硬编漂移).
  //   bps: 押注侧 winners 9700 / [broker 160 + oracle 100 + introducer 20 + node 20 = 300] = 3%. 协议常量非 maker 可调
  //   (determinism: 委员 deriveFeeLeaves re-derive byte-identical). node→signer-committee 均分, broker/introducer create-committed.
  fastify.get('/api/pool/fee-config', async (request, reply) => {
    const { FEE_CONFIG } = await import('../lib/pool-shard-settle.mjs');
    return reply.send({ ok: true, fee_config: FEE_CONFIG, note: '协议常量 (非 maker 可调); winners 97% / fee 3% = broker1.6%+oracle1%+introducer0.2%+node0.2%; node→5签名委员均分, broker/introducer create-committed pk' });
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

    // FINDING-2 ③ commingled-spine guard (单源 assertNotCommingled, 见 register-v07). dual-handle v0.6/v0.7.
    if (assertNotCommingled(market, reply, sqlite)) return;

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
    // FINDING-2 ③ commingled guard (单源). register-external 不强制 protocol_version → 防御性 wire (v0.5 no-op).
    if (assertNotCommingled(market, reply, sqlite)) return;
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
    // FINDING-2 ③ commingled guard (单源). register-external 不强制 protocol_version → 防御性 wire (v0.5 no-op).
    if (assertNotCommingled(market, reply, sqlite)) return;
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
    // FINDING-2 ③ commingled guard (单源). dual-handle v0.6/v0.7 — auto-bet + TG /bet 走这条 (commit1 漏的主路径).
    if (assertNotCommingled(market, reply, sqlite)) return;
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
    // FINDING-2 ③ commingled guard (单源). dual-handle v0.6/v0.7 — 真锁仓 confirm (INSERT pool_bettor_sides 下方).
    if (assertNotCommingled(market, reply, sqlite)) return;
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
  // GET /api/pool/broker-fee-dm?since=<ms> — Phase 1 broker DM 事件 feed (KANet-UI 2026-06-28).
  // 返 broker_fee_landed 事件 ∩ tg_custodial_wallets (broker 收款地址 = 托管/link 地址的 broker).
  // bot poller 每隔 pollMs 调; since=0 → 取最近 60s 兜底; 结果按 observed_at ASC 让 bot 按序 DM.
  // P1 fix (NWT): verifyIngestRequest 守 PII (tg_user_id↔地址映射); 同 chain-data.js L124 模式.
  fastify.get('/api/pool/broker-fee-dm', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;
    const sinceMs = parseInt(request.query?.since, 10) || (Date.now() - 60_000);
    const rows = sqlite.prepare(`
      SELECT ce.id, ce.to_address AS broker_address, ce.payload, ce.observed_at,
             w.tg_user_id
        FROM chain_events ce
        INNER JOIN tg_custodial_wallets w ON w.kaspa_address = ce.to_address
       WHERE ce.event_type = 'broker_fee_landed'
         AND ce.observed_at > datetime(?, 'unixepoch', 'subsec')
       ORDER BY ce.observed_at ASC
       LIMIT 50
    `).all(sinceMs / 1000);
    const events = rows.map(r => {
      let p = {};
      try { p = JSON.parse(r.payload || '{}'); } catch {}
      return {
        id: r.id,
        tg_user_id: r.tg_user_id,
        broker_address: r.broker_address,
        fee_sompi: p.fee_sompi || 0,
        market_id: p.market_id || null,
        market_title: p.market_title || p.market_id || null,
        settle_txid: p.settle_txid || null,
        observed_at: r.observed_at,
      };
    });
    return reply.send({ ok: true, count: events.length, events });
  });

  // GET /api/pool/markets/trending?limit=5 — T5 (Q4, J2 2026-06-27): 热门市场, activity+commitment 加权
  // (非裸 volume → 防 seeder 刷量). 排序分 = bettor_count(承诺/活跃, 重权) + total_pool_kas(总承诺值);
  // 裸 volume 易刷(seeder 自挂大池), bettor_count(不同押注人数) 才是真活跃. 过滤: status=pending_bettors(开放押注)
  // + deadline>now+1h(快截止的不上热榜) + created>1h ago(排极新, 防刚建的刷榜) + total_pool≥阈值(挡空/微市场)
  // + 排除 commingled spine(FINDING-2 单源 isCommingledSpine, J1 2026-06-28).
  // + 排除 AutoBetter relay 押注(NWT option A, KANet-UI 2026-06-28): bettor_count + 赔率只计真人押注.
  //   AutoBetter 识别: relay_nodes.name LIKE 'AutoBetter-%'. 只读端点, 不碰 settle.
  // ── 诚实显示计数 SQL · 单源 (Bettor 2026-06-29 审定·收敛单源·禁三处各写一套·= 不完整迁移的根治) ──
  //   两件套 (Bettor scope): ① AUTO_BET_EXCL 排 AutoBetter 假押注 ② shard-aware union (logical key + 各 shard key)。
  //   commingledSpine 排除【不在此】= trending 首页"选哪些盘上榜"的 filter·非单盘计数口径。
  //   消费方: trending / card_groups / markets-list / market-detail → 一个口径 (修 Owner '51人假数据' 抱怨)。
  //   honestCountSql/StakeSql 返回纯 SQL 表达式 (call-site 自加 AS <alias>)。mExpr = logical market id 的 SQL 表达式:
  //     'pool_markets.id' (相关子查询·list/trending/card_groups) 或 '?' (单盘 detail·该 expr 出现 2 次 → 须绑 2 次)。
  const AUTO_BET_EXCL = `AND (s.bettor_relay_id IS NULL OR s.bettor_relay_id NOT IN (SELECT id FROM relay_nodes WHERE name LIKE 'AutoBetter-%'))`;
  function honestCountSql(mExpr) {
    return `((SELECT COUNT(*) FROM pool_bettor_sides s WHERE s.market_id = ${mExpr} ${AUTO_BET_EXCL})`
      + ` + (SELECT COUNT(*) FROM pool_bettor_sides s WHERE s.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = ${mExpr}) ${AUTO_BET_EXCL}))`;
  }
  function honestStakeSql(mExpr, dir) {
    return `((SELECT COALESCE(SUM(stake_amount),0) FROM pool_bettor_sides s WHERE s.market_id = ${mExpr} AND s.direction = ${dir} ${AUTO_BET_EXCL})`
      + ` + (SELECT COALESCE(SUM(stake_amount),0) FROM pool_bettor_sides s WHERE s.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = ${mExpr}) AND s.direction = ${dir} ${AUTO_BET_EXCL}))`;
  }

  fastify.get('/api/pool/markets/trending', async (request, reply) => {
    const q = request.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 5, 1), 20);
    const minPoolSompi = parseInt(q.min_pool_sompi, 10) || 500_000_000;   // 默认 5 KAS 最小池, 防刷量空市场
    const BETTOR_WEIGHT = 10;   // 每个不同押注人 ≈ 10 KAS 等权 — 让"多人小注"胜过"单人刷大池"(防 volume gaming)
    const now = Math.floor(Date.now() / 1000);
    // created_at stored as local datetime (no TZ suffix). Use local format for comparison, not UTC ISO.
    const _cd = new Date((now - 3600) * 1000);
    const _p = n => String(n).padStart(2, '0');
    const createdCutoffIso = `${_cd.getFullYear()}-${_p(_cd.getMonth()+1)}-${_p(_cd.getDate())} ${_p(_cd.getHours())}:${_p(_cd.getMinutes())}:${_p(_cd.getSeconds())}`;   // 创建 >1h ago (local format)
    const { commingledSpineSet } = await import('../lib/pool-commingle-detect.mjs');
    const commingledSpines = commingledSpineSet(sqlite);
    // bettor_count/yes_sompi/no_sompi → honestCountSql/StakeSql 单源 (排 AutoBetter + shard-aware union)。
    const rows = sqlite.prepare(`
      SELECT pool_markets.id, pool_markets.resolution_rule_spec, pool_markets.category,
             pool_markets.outcome_side, pool_markets.deadline, pool_markets.maker_stake_amount,
             pool_markets.spine_p2sh,
             ${honestCountSql('pool_markets.id')} AS bettor_count,
             ${honestStakeSql('pool_markets.id', 0)} AS yes_sompi,
             ${honestStakeSql('pool_markets.id', 1)} AS no_sompi
      FROM pool_markets
      WHERE pool_markets.protocol_status = 'pending_bettors'
        AND pool_markets.protocol_status != 'shard_internal'
        AND pool_markets.deadline > ?
        AND pool_markets.created_at < ?
    `).all(now + 3600, createdCutoffIso);
    const scored = rows.map((r) => {
      const makerSompi = r.maker_stake_amount || 0;
      const makerOnYes = r.outcome_side === 'YES';
      const yesPool = Number(r.yes_sompi) + (makerOnYes ? makerSompi : 0);
      const noPool = Number(r.no_sompi) + (!makerOnYes ? makerSompi : 0);
      const totalPool = yesPool + noPool;
      const totalPoolKas = totalPool / 1e8;
      const trendingScore = r.bettor_count * BETTOR_WEIGHT + totalPoolKas;
      let card_group_id = null, leg_key = null;
      try {
        const spec = JSON.parse(r.resolution_rule_spec || '');
        if (spec && typeof spec === 'object') { card_group_id = spec.card_group_id || null; leg_key = spec.leg_key || null; }
      } catch {}
      return {
        id: r.id, title: r.resolution_rule_spec, category: r.category, deadline: r.deadline,
        bettor_count: r.bettor_count, total_pool_kas: totalPoolKas,
        yes_implied_prob: totalPool > 0 ? yesPool / totalPool : null,
        trending_score: Math.round(trendingScore * 100) / 100,
        card_group_id, leg_key,
        _totalPool: totalPool,
        _spineP2sh: r.spine_p2sh,
        _leafCount: getSidesByLogicalMarket(r.id, sqlite).length,   // #14 fix: shard-aware leaf count, 同 availableMarkets
      };
    }).filter((m) => m._totalPool >= minPoolSompi)   // 防刷量: 池太小不上热榜
      .filter((m) => !commingledSpines.has(m._spineP2sh))   // FINDING-2: 排除 commingled spine (J1 单源 helper)
      .filter((m) => isStructuredSpec(m.title))   // usability (Owner 2026-06-29 '首页一坨屎'): 只显配齐规则可押盘。
      //   m.title = raw resolution_rule_spec (L1990)。isStructuredSpec (lib/spec-validation.js·= bot specIsUsable
      //   三端单一源·Bettor r243) = JSON 含非空 title+resolution_criteria+data_source_canonical。镜像盘缺 title/criteria
      //   → false → 源头从热门藏掉。非裸 json_extract (非 JSON spec 会 throw malformed JSON 崩整 query + title 有 fallback 误过滤)。
      .filter((m) => m.bettor_count >= 3)   // Owner 2026-06-28: 0/少真人盘不上首页(bettor_count已排 AutoBetter)
      .filter((m) => m._leafCount < MARKET_MAX_LEAVES_G3 - 50)   // 排链上满盘(shard-aware, 409 同源)——之前用 raw COUNT(*) WHERE market_id=id 对 bshard 永远查不到东西
      .sort((a, b) => b.trending_score - a.trending_score)
      .slice(0, limit)
      .map(({ _totalPool, _spineP2sh, _rawBettorCount, ...m }) => m);
    return reply.send({ ok: true, count: scored.length, score_formula: `bettor_count*${BETTOR_WEIGHT} + total_pool_kas (activity+commitment 加权, 非裸 volume)`, filters: { status: 'pending_bettors', deadline_gt: '+1h', created_lt: '-1h', min_pool_kas: minPoolSompi / 1e8, exclude_commingled: true, exclude_auto_bet: true, min_bettors: 3 }, trending: scored });
  });

  // 查漏补缺(2026-07-05 晚, Owner 实测撞见"首页全巴西"): 从 title/resolution_rule_spec 提取球队名
  // 一类的专有名词, 当"事件主体"标识, 供跨数据源(ESPN 原生盘/Polymarket 镜像盘)选品多样化用。
  // 简单启发式: 抓 event_title(更规整, "TeamA vs TeamB" 格式)优先, 没有则退 title 本身; 抓大写开头
  // 连续字母的词, 排除掉常见非球队名的英文常用词(问句/连接词)。
  function _extractSubjectTokens(rawSpec) {
    let spec;
    try { spec = JSON.parse(rawSpec); } catch { return []; }
    const text = spec.event_title || spec.title || '';
    const stop = new Set(['Will', 'The', 'Team', 'To', 'Win', 'Advance', 'More', 'Markets', 'On', 'End', 'In', 'A', 'Draw', 'Reach']);
    return [...new Set((text.match(/[A-Z][a-zA-Z]+/g) || []).filter((w) => !stop.has(w)))];
  }

  // GET /api/pool/markets/available?limit=8 — 可押市场 (Bettor 2026-06-29): usable+raw<50+非commingled+deadline>+10min,
  // 按 total_pool_kas+recency 排, 无活跃人数门 (区别 trending 的 >=3 真人门)。只读展示端点·不碰钱。
  // raw<50 用 raw COUNT(*) 非 honestCount (J1/Bettor no-strand line: AutoBetter 的 bet 是真 covenant leaf).
  // 消费方: bot /start 首页 (替换 trending 作为"能押的盘"入口)。
  fastify.get('/api/pool/markets/available', async (request, reply) => {
    const q = request.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 8, 1), 100);
    // ?tag=champions (世界杯玩法UI, Bettor 2026-07-04): 冠军长线盘(polymarket "Will X win the 2026
    // FIFA World Cup?" futures, 118 行历史导入含重复快照)。不需要 G1 cron(静态盘, 已存在)。复用本
    // endpoint 的既有过滤(usable spec/非commingled/有空位/conditionId去重), 只加一层标题过滤缩到冠军盘。
    const championsFilter = q.tag === 'champions';
    const now = Math.floor(Date.now() / 1000);
    const _cd = new Date((now - 3600) * 1000);
    const _p = n => String(n).padStart(2, '0');
    const createdCutoffIso = `${_cd.getFullYear()}-${_p(_cd.getMonth()+1)}-${_p(_cd.getDate())} ${_p(_cd.getHours())}:${_p(_cd.getMinutes())}:${_p(_cd.getSeconds())}`;
    const { commingledSpineSet } = await import('../lib/pool-commingle-detect.mjs');
    const commingledSpines = commingledSpineSet(sqlite);
    const rows = sqlite.prepare(`
      SELECT pool_markets.id, pool_markets.resolution_rule_spec, pool_markets.category,
             pool_markets.outcome_side, pool_markets.deadline, pool_markets.maker_stake_amount,
             pool_markets.protocol_version,
             pool_markets.spine_p2sh, pool_markets.created_at AS market_created_at,
             pool_markets.outcome_condition_id,
             ${honestCountSql('pool_markets.id')} AS bettor_count,
             ${honestStakeSql('pool_markets.id', 0)} AS yes_sompi,
             ${honestStakeSql('pool_markets.id', 1)} AS no_sompi
      FROM pool_markets
      WHERE pool_markets.protocol_status = 'pending_bettors'
        AND pool_markets.protocol_status != 'shard_internal'
        AND pool_markets.deadline > ?
        AND pool_markets.created_at < ?
    `).all(now + 600, createdCutoffIso);   // deadline > +10min (用户还来得及押)
    const sorted = rows.map((r) => {
      const makerSompi = r.maker_stake_amount || 0;
      const makerOnYes = r.outcome_side === 'YES';
      const yesPool = Number(r.yes_sompi) + (makerOnYes ? makerSompi : 0);
      const noPool = Number(r.no_sompi) + (!makerOnYes ? makerSompi : 0);
      const totalPool = yesPool + noPool;
      // #14 fix (2026-07-05, Owner 实测撞见: dyljb 900 笔满盘仍被推荐, NWT/J2 查实根因):
      //   之前用 `SELECT COUNT(*) FROM pool_bettor_sides WHERE market_id = pool_markets.id` 算 raw_bettor_count——
      //   对 v0.7 bshard 市场这是永远查不到东西的 shard-blind 查询(下注实际存在各个 shard 的 market_id 下,
      //   不是 logical parent 的 id), 导致 900 笔满盘的市场也被算成 raw_bettor_count=0, filter<50 恒过。
      //   换成 getSidesByLogicalMarket(跨 shard 聚合的单源 helper, 跟 register-v07/prep 那个真正拒绝
      //   下注的 409 逻辑同源)算真实 leaf 数, 跟 MARKET_MAX_LEAVES_G3 留安全余量比较。
      const leafCount = getSidesByLogicalMarket(r.id, sqlite).length;
      return {
        id: r.id, title: r.resolution_rule_spec, resolution_rule_spec: r.resolution_rule_spec,
        protocol_version: r.protocol_version, category: r.category, deadline: r.deadline,
        bettor_count: r.bettor_count, total_pool_kas: totalPool / 1e8,
        yes_implied_prob: totalPool > 0 ? yesPool / totalPool : null,
        _totalPool: totalPool, _spineP2sh: r.spine_p2sh,
        _leafCount: leafCount, _createdAt: r.market_created_at,
        _conditionId: r.outcome_condition_id || null,
      };
    })
      .filter((m) => !commingledSpines.has(m._spineP2sh))
      .filter((m) => isStructuredSpec(m.title))
      .filter((m) => m._leafCount < MARKET_MAX_LEAVES_G3 - 50)   // has available slots — leaf-count(shard-aware, 409 同源), 留 50 笔安全余量
      .filter((m) => {
        if (!championsFilter) return true;
        try { return /win the 2026 fifa world cup/i.test(JSON.parse(m.title || '{}').title || ''); } catch { return false; }
      })
      // conditionId 去重 — 同一真实问题只保留流动性最高那条(Bettor #27·Owner "重复盘·母子盘 display-dedup")
      .reduce((acc, m) => {
        const cid = m._conditionId;
        if (!cid) { acc.push(m); return acc; }
        const i = acc.findIndex((x) => x._conditionId === cid);
        if (i < 0) { acc.push(m); return acc; }
        if (m._totalPool > acc[i]._totalPool || (m._totalPool === acc[i]._totalPool && m._createdAt < acc[i]._createdAt)) {
          acc[i] = m;
        }
        return acc;
      }, [])
      .sort((a, b) => (b._totalPool - a._totalPool) || (b._createdAt > a._createdAt ? 1 : -1));
    // 查漏补缺(2026-07-05 晚, Owner 实测撞见: 首页热榜 5 条 4 条巴西, 且 ESPN 原生盘("Will Brazil
    // advance?")跟 Polymarket 镜像盘("Brazil vs. Norway: Team to Advance")是同一场真实比赛却当成
    // 两条不同内容推荐)。上面那段 conditionId 去重只挡得住"同一 conditionId"的重复, 挡不住"同一真实
    // 事件、跨数据源、不同 conditionId"这种情况。加一层贪心多样性选择: 提取标题里的专有名词(球队名等)
    // 当"事件主体"标识, 优先选主体不重叠的市场, 主体不够多样才回填剩下热度最高的(不砍数量, 只调顺序)。
    const _selected = [];
    const _usedSubjects = new Set();
    const _backup = [];
    for (const m of sorted) {
      const tokens = _extractSubjectTokens(m.title);
      const overlaps = tokens.length > 0 && tokens.some((t) => _usedSubjects.has(t));
      if (!overlaps) {
        _selected.push(m);
        tokens.forEach((t) => _usedSubjects.add(t));
      } else {
        _backup.push(m);
      }
      if (_selected.length >= limit) break;
    }
    while (_selected.length < limit && _backup.length > 0) _selected.push(_backup.shift());
    const available = _selected
      .map(({ _totalPool, _spineP2sh, _leafCount, _createdAt, _conditionId, ...m }) => ({ ...m, condition_id: _conditionId }));
    return reply.send({ ok: true, count: available.length, markets: available });
  });

  // GET /api/pool/markets/card_groups?limit=8 — 赛事聚合卡 (Owner 钦定 UX 首页·J2 后端·2026-06-28).
  // 把 pending_bettors 的散盘按 spec.card_group_id 聚成【赛事卡】(一场赛 → winner/spread/total 多 leg 嵌一卡),
  // 喂 KANet-UI 首页 (前端只渲染, 不再 N round-trip / 不在前端 group)。card_group 由 sports-card-builder.mjs
  // 建市时折入 spec (card_group_id=espn-<league>-<event_id> + leg_key)。本端点是【读/聚合侧】, 不碰链不碰 settle。
  // 复用 trending 的 per-leg 池/人数算法 (correlated subquery + shard 汇总 + AutoBetter 排除 + commingled 排除),
  // 一致性单源同 trending。dedupe: 同 card_group 内同 leg_key 多盘 → 留活跃度最高那条 (重复建市数据洁癖)。
  // 每 leg 带 trust 字段 (data_source_canonical / resolution_criteria / spine_p2sh) 供 UI 信任卡。只读·additive。
  fastify.get('/api/pool/markets/card_groups', async (request, reply) => {
    const q = request.query || {};
    const { commingledSpineSet } = await import('../lib/pool-commingle-detect.mjs');
    const { aggregateCardGroups } = await import('../lib/pool-card-groups.mjs');
    const commingledSpines = commingledSpineSet(sqlite);
    // per-leg 池/人数: honestCountSql/StakeSql 单源 (排 AutoBetter + shard-aware union·一致性同 trending)。
    // #14 fix (2026-07-05, 同 availableMarkets 同源 shard-blind 坑): raw COUNT(*) WHERE market_id=pool_markets.id
    //   对 v0.7 bshard 永远查不到东西(下注存在各 shard 的 id 下), 换成 getSidesByLogicalMarket 跨 shard
    //   聚合真实 leaf 数, 跟 409 拒绝逻辑同源, 留安全余量。
    const rows = sqlite.prepare(`
      SELECT pool_markets.id, pool_markets.resolution_rule_spec, pool_markets.category,
             pool_markets.outcome_side, pool_markets.deadline, pool_markets.maker_stake_amount,
             pool_markets.spine_p2sh,
             ${honestCountSql('pool_markets.id')} AS bettor_count,
             ${honestStakeSql('pool_markets.id', 0)} AS yes_sompi,
             ${honestStakeSql('pool_markets.id', 1)} AS no_sompi
      FROM pool_markets
      WHERE pool_markets.protocol_status = 'pending_bettors'
    `).all().filter(r => getSidesByLogicalMarket(r.id, sqlite).length < MARKET_MAX_LEAVES_G3 - 50);  // 同 availableMarkets·排满盘·防 /start card_groups 按钮误导
    const out = aggregateCardGroups(rows, commingledSpines, { limit: q.limit });   // 聚合逻辑单源 (pool-card-groups.mjs)
    return reply.send({ ...out, filters: { status: 'pending_bettors', exclude_commingled: true, exclude_auto_bet: true, dedupe_leg_key: 'keep_most_active' } });
  });

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
    // clone-leak fix half-2 (Bettor/NWT): exclude (A)-model shard-clone pool_markets rows (protocol_status='shard_internal')
    //   from the discovery list — UI shows the LOGICAL market once (aggregated via market_shards.logical_market_id), never the
    //   per-shard clones. half-1 = oracle-pool status-IN scan exclusion (the 'shard_internal' status itself). Both halves收齐 before (c).
    if (q.status !== 'shard_internal') { where.push("pool_markets.protocol_status != 'shard_internal'"); }
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
             ${honestCountSql('pool_markets.id')} AS bettor_count,
             ${honestStakeSql('pool_markets.id', 0)} AS yes_bettor_stake_sompi,
             ${honestStakeSql('pool_markets.id', 1)} AS no_bettor_stake_sompi
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

  // GET /api/pool/logical-markets — KANet-UI 分片对用户透明 (bshard B + self-claim C, Owner 2026-06-15 #1 directive).
  // One LOGICAL market = N physical shards (market_shards registry, v171). Each shard is its own pool_markets
  // row (≤~32 bettors, settle_aggregate, no chunking). This endpoint hides the sharding: presents 1 market per
  // logical_market_id with CROSS-SHARD aggregated pari-mutuel odds (Σ pool_bettor_sides over all shard market_ids
  // + Σ maker stakes), shard_count, and the current open shard (status='open', max shard_index) for transparent
  // bet routing. Odds derive from existing pool_bettor_sides (NO new columns — same single source as /markets).
  // Read-only. Filters: ?logical_market_id= (single), ?limit/?offset.
  fastify.get('/api/pool/logical-markets', async (request, reply) => {
    const q = request.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const where = ["ms.status != 'refunded'"];  // J2 review minor-2: refunded shards' bets are refunded → exclude from live odds
    const params = [];
    if (q.logical_market_id) { where.push('ms.logical_market_id = ?'); params.push(String(q.logical_market_id)); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    // Inner: per-logical-market shard rollup (shard_count + Σ maker over shards — NO bettor JOIN here, so the
    // maker SUM is not multiplied by bettor rows). Metadata (spec/outcome/deadline/category) is identical across
    // a logical market's shards (same ctor outcome), so MAX() picks the representative.
    const rows = sqlite.prepare(`
      SELECT lm.logical_market_id, lm.shard_count, lm.maker_stake_sompi, lm.outcome_side,
             lm.resolution_rule_spec, lm.deadline, lm.category, lm.protocol_version, lm.created_at,
             (SELECT COALESCE(SUM(s.stake_amount),0) FROM pool_bettor_sides s
                WHERE s.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = lm.logical_market_id AND status != 'refunded')
                  AND s.direction = 0) AS yes_bettor_stake_sompi,
             (SELECT COALESCE(SUM(s.stake_amount),0) FROM pool_bettor_sides s
                WHERE s.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = lm.logical_market_id AND status != 'refunded')
                  AND s.direction = 1) AS no_bettor_stake_sompi,
             (SELECT COUNT(*) FROM pool_bettor_sides s
                WHERE s.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = lm.logical_market_id AND status != 'refunded')) AS bettor_count
      FROM (
        SELECT ms.logical_market_id,
               COUNT(DISTINCT ms.shard_market_id)           AS shard_count,
               COALESCE(MAX(pm_parent.maker_stake_amount), 0) AS maker_stake_sompi,
               MAX(pm.outcome_side)                         AS outcome_side,
               MAX(pm.resolution_rule_spec)                 AS resolution_rule_spec,
               MAX(pm.deadline)                             AS deadline,
               MAX(pm.category)                             AS category,
               MAX(pm.protocol_version)                     AS protocol_version,
               MIN(pm.created_at)                           AS created_at
        FROM market_shards ms
        LEFT JOIN pool_markets pm ON pm.id = ms.shard_market_id
        LEFT JOIN pool_markets pm_parent ON pm_parent.id = ms.logical_market_id
        ${whereSql}
        GROUP BY ms.logical_market_id
      ) lm
      ORDER BY lm.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = sqlite.prepare(`SELECT COUNT(*) c FROM (SELECT 1 FROM market_shards ms ${whereSql} GROUP BY ms.logical_market_id)`).get(...params).c;
    const markets = rows.map(r => {
      // pari-mutuel pools: maker is implicit bettor on outcome_side (same invariant as /markets, area-1).
      const makerSompi = Number(r.maker_stake_sompi) || 0;
      const makerOnYes = r.outcome_side === 'YES';
      const yesPoolSompi = Number(r.yes_bettor_stake_sompi) + (makerOnYes ? makerSompi : 0);
      const noPoolSompi = Number(r.no_bettor_stake_sompi) + (!makerOnYes ? makerSompi : 0);
      const totalPool = yesPoolSompi + noPoolSompi;
      // current open shard (transparent bet routing target). NULL if all shards sealed/settled.
      const openShard = sqlite.prepare(
        `SELECT shard_market_id, shard_index, bettor_count FROM market_shards
           WHERE logical_market_id = ? AND status = 'open' ORDER BY shard_index DESC LIMIT 1`
      ).get(r.logical_market_id) || null;
      return {
        logical_market_id: r.logical_market_id,
        shard_count: r.shard_count,
        bettor_count: r.bettor_count,
        resolution_rule_spec: r.resolution_rule_spec,
        outcome_side: r.outcome_side,
        category: r.category,
        protocol_version: r.protocol_version,
        deadline: r.deadline,
        created_at: r.created_at,
        // cross-shard aggregated pari-mutuel odds (the "1 market view")
        yes_pool_kas: yesPoolSompi / 1e8,
        no_pool_kas: noPoolSompi / 1e8,
        yes_implied_prob: totalPool > 0 ? yesPoolSompi / totalPool : null,
        no_implied_prob: totalPool > 0 ? noPoolSompi / totalPool : null,
        total_pool_kas: totalPool / 1e8,
        // transparent bet routing HINT (NULL → all shards closed). J2 review minor-1: this is a HINT not a
        // guarantee — register's allocateForRegister re-checks shardHasRoom (count<32 + mass<380k); a full
        // shard (race window) auto-opens the next shard, invisible to the user. register is authoritative;
        // the UI must NOT promise the bet lands in this exact shard (user only bets the logical market).
        open_shard_market_id: openShard ? openShard.shard_market_id : null,
        open_shard_index: openShard ? openShard.shard_index : null,
        open_shard_bettor_count: openShard ? openShard.bettor_count : null,
      };
    });
    return reply.send({ ok: true, total, count: markets.length, limit, offset, markets });
  });

  fastify.get('/api/pool/market/:id', async (request, reply) => {
    let marketId = request.params.id;
    let market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    // Auto-redirect shard clones → logical parent: shard_internal rows are not user-facing.
    // /mybets addmore button passes pool_bettor_sides.market_id = shard market ID (shard-blind bug);
    // transparently resolve to the logical parent so all callers get the correct market context.
    if (market.protocol_status === 'shard_internal') {
      const sr = sqlite.prepare('SELECT logical_market_id FROM market_shards WHERE shard_market_id = ?').get(marketId);
      if (sr?.logical_market_id) {
        const logicalMarket = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(sr.logical_market_id);
        if (logicalMarket) { market = logicalMarket; marketId = sr.logical_market_id; }
      }
    }
    // KANet-UI 2026-06-07 r308 maker 名显: LEFT JOIN relay_nodes 取 maker_name (跨节点 NULL, 前端兜底)
    const _makerRow = market.maker_relay_id
      ? sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(market.maker_relay_id)
      : null;
    market.maker_name = _makerRow?.name || null;
    let metaParsed = {};
    try { metaParsed = JSON.parse(market.metadata || '{}'); } catch {}
    // 详情计数 honestCountSql 单源: shard-aware (修 v07 logical-only 漏 shard 押注 bug) + 排 AutoBetter (= 与 list/trending 一口径)。
    const bettorCount = sqlite.prepare(`SELECT ${honestCountSql('?')} AS c`).get(marketId, marketId).c;
    const rawBettorCount = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;
    const sigsCollected = sqlite.prepare(`
      SELECT COUNT(*) c FROM chain_events
      WHERE event_type IN ('pool_oracle_tx_sig', 'pool_oracle_refund_disagreement_tx_sig')
        AND payload LIKE ?
    `).get(`%"market_id":"${marketId}"%`).c;
    // Bettor r70 A: pool distribution on detail too (same model as list). honestStakeSql 单源 (shard-aware + 排 AutoBetter)。
    const yesBettorSompi = sqlite.prepare(`SELECT ${honestStakeSql('?', 0)} AS s`).get(marketId, marketId).s;
    const noBettorSompi = sqlite.prepare(`SELECT ${honestStakeSql('?', 1)} AS s`).get(marketId, marketId).s;
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
      raw_bettor_count: rawBettorCount,
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
    // #48 shard-blind fix (NWT/J2 2026-07-04): bshard bettor 行 s.market_id 是 SHARD 的 market_id
    // (非 logical parent) — 裸 JOIN pool_markets m ON m.id=s.market_id 会拿到 shard_internal 状态的行
    // (settle_evidence 写在 logical 市场, 拿不到), 导致所有 bshard 盘赢输永远显不出。
    // 通过 market_shards 解析 shard→logical(v0.6 无 shard 行, COALESCE 落回 s.market_id 原逻辑不变)。
    const positions = sqlite.prepare(`
      SELECT s.market_id, s.direction, s.stake_amount, s.side_p2sh, s.side_lock_tx, s.claim_txid, s.merkle_index,
             s.created_at AS locked_at,
             m.resolution_rule_spec, m.outcome_side, m.protocol_status, m.deadline, m.category,
             m.maker_stake_amount, m.broker_fee_pct, m.oracle_bond_amount, m.miner_fee, m.settle_txid, m.refund_txid,
             m.metadata, m.protocol_version
      FROM pool_bettor_sides s
      LEFT JOIN market_shards ms ON ms.shard_market_id = s.market_id
      LEFT JOIN pool_markets m ON m.id = COALESCE(ms.logical_market_id, s.market_id)
      WHERE s.bettor_pk = ?
      ORDER BY s.created_at DESC
    `).all(bettorPk);

    // #27e (KANet-UI sprint): the settler pays an EXTERNAL bettor (bettor_relay_id NULL, = bot/DM-path)
    // to the P2PK address derived from x-only bettor_pk (pool-market-settler.js L1634) — which differs
    // from a non-P2PK linkedAddr (e.g. a relay's native address). Derive the SAME payout address so the
    // on-chain settle output (metadata.phase2_outputs) matches; relay-bound sides pay to the relay address
    // (= linkedAddr) so keep both as candidates.
    const _payoutAddrSet = new Set([linkedAddr]);
    try {
      const _kw = await import('kaspa-wasm');
      const _net = linkedAddr.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
      _payoutAddrSet.add(new _kw.XOnlyPublicKey(bettorPk).toAddress(_net).toString());
    } catch { /* derive fail → linkedAddr-only match (degrades to projection fallback) */ }

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
      let actualPayoutKas = null, actualPayoutChainVerified = false;
      try {
        const meta = JSON.parse(p.metadata || '{}');
        // #48 (NWT/J2 2026-07-04): bshard(v0.7) 盘从没写 phase2_winner(v0.6 专属字段) — 结算后所有
        // bshard/世界杯盘 /mybets 永远显不出输赢。改读 settle_evidence.winner_details(daemon writeback
        // 时存的 per-bettor 明细, 已链验 received===true, 比反查 kaspa_tx_log 更直接)。
        const ev = meta.settle_evidence;
        if (p.protocol_version === 'v0.7' && ev && Array.isArray(ev.winner_details)) {
          const myWin = ev.winner_details.find(w => String(w.pk).toLowerCase() === String(bettorPk).toLowerCase());
          if (myWin) {
            outcomeWinner = myDirection;   // 这个 bettor 在 winner_details 里 = 赢了(方向就是自己下的那个方向)
            didWin = true;
            actualPayoutKas = Number(myWin.amount) / 1e8;
            actualPayoutChainVerified = true;   // winner_details 只收 received===true 的条目(daemon writeback 过滤过)
          } else if (ev.win_direction === 0 || ev.win_direction === 1) {
            // NWT 审(2026-07-04, 部署前抓到): 不在 winner_details 里≠真输了——若 myDirection===win_direction
            // 但没进 winner_details, 是"赢了但 claim 失败没到账"(#21 settled_partial_claims 那种), 不是"你输了"。
            // 必须先比对方向, 真不同方向才是真输; 同方向缺席 = 赢了待发放(不误判成假阴性, 比模糊 pending 更危险)。
            outcomeWinner = ev.win_direction;
            if (myDirection === ev.win_direction) {
              didWin = true; actualPayoutKas = null; actualPayoutChainVerified = false;   // 赢了·claim 未到账·金额未知不瞎猜
            } else {
              didWin = false;
            }
          }
          // ev 存在但 win_direction 缺失(老结构/尚在写入中) → outcomeWinner/didWin 留 null(继续显示"待结算", 不误判)。
        } else if (meta.phase2_winner === 0 || meta.phase2_winner === 1) {
          outcomeWinner = meta.phase2_winner;
          didWin = (myDirection === outcomeWinner);
          if (didWin) {
            // #27e (KANet-UI sprint, NWT r1161/J2 r1080): read the ACTUAL on-chain payout from the
            // settler-recorded settle outputs (metadata.phase2_outputs = real settle TX outputs) matched by
            // this bettor's payout address — NOT the payoutIfWin projection, which omits the oracle fee
            // (L1861 upper-bound) + the committeeMode SS bond-floor (5×oracleBond paid from the pool) →
            // over-states (demo lwrcl: 148.1 projected vs 141.427 on-chain). data-three-role: settler
            // records actual, display reads. Robust to #28 (oracle_bond tuning): reads the real output,
            // no local formula to drift. Fallback to the projection only for legacy settles w/o outputs.
            // T6 (Q3, J2 2026-06-27): read ACTUAL payout from CHAIN (kaspa_tx_log.outputs_json of the
            // claim/settle TX) not DB meta.phase2_outputs — 链验铁律 (这程 DB status 骗 4 次). bshard winner
            // claims via claim_txid (merkle claim); v0.6 winner paid in settle_txid output. multi-output aware
            // (复用 broker earnings earnings-by-address L233 同源链验法). DB phase2_outputs = fallback 仅当 tx 未索引.
            let myOnChainSompi = 0;
            const _payoutTxid = p.claim_txid || p.settle_txid;
            if (_payoutTxid) {
              const _ptx = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(_payoutTxid);
              if (_ptx && _ptx.outputs_json) {
                try {
                  myOnChainSompi = JSON.parse(_ptx.outputs_json)
                    .filter(o => _payoutAddrSet.has(o.script_public_key_address || o.address))
                    .reduce((s, o) => s + (Number(o.amount ?? o.amount_sompi ?? o.value) || 0), 0);
                  if (myOnChainSompi > 0) actualPayoutChainVerified = true;
                } catch {}
              }
            }
            if (myOnChainSompi <= 0 && Array.isArray(meta.phase2_outputs)) {   // fallback: DB-recorded settle outputs (tx not yet indexed)
              myOnChainSompi = meta.phase2_outputs.filter(o => _payoutAddrSet.has(o.address)).reduce((s, o) => s + (Number(o.amountSompi) || 0), 0);
            }
            if (myOnChainSompi > 0) {
              // A bettor may hold multiple winning sides on one market → multiple outputs to one address.
              // Split this side's share by stake so the per-direction sum (formatMyBets) == on-chain total.
              const myWinStake = Number(sqlite.prepare(
                'SELECT COALESCE(SUM(stake_amount),0) s FROM pool_bettor_sides WHERE market_id=? AND bettor_pk=? AND direction=?'
              ).get(p.market_id, bettorPk, outcomeWinner).s) || stakeSompi;
              actualPayoutKas = (myOnChainSompi * stakeSompi / myWinStake) / 1e8;
            } else {
              actualPayoutKas = payoutIfWin / 1e8;  // legacy settles without phase2_outputs
            }
          }
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
        actual_payout_chain_verified: actualPayoutChainVerified,  // T6: true = 链上 claim/settle tx 核证; false = DB fallback/projection
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
    const market = sqlite.prepare('SELECT id, protocol_version, protocol_status, spine_p2sh, settle_txid, refund_txid, pool_merkle_root, maker_relay_id, broker_relay_id, broker_pk, outcome_side, outcome_market_source, resolution_rule_spec, maker_stake_amount, oracle_bond_amount, metadata FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });

    // KANet-UI 2026-06-22 值分成收口 chain-truth reconcile: v0.7 bshard markets settle via
    // driver-side close_attest + winner claim + value-split fee payout (NOT pool_markets.settle_txid).
    // Bettors live in shard state, so the v0.6/v0.7 settler can misread pool_bettor_sides as 0-bet
    // and refund the maker seed → protocol_status='refunded' even though the pool settled on chain.
    // metadata.settle_evidence (recorded from verified chain truth; Track B autonomous settler will
    // populate going forward) is the authoritative chain-settled signal. NO TX NO TRUTH.
    let settleEvidence = null;
    try {
      const meta = JSON.parse(market.metadata || '{}');
      if (meta.settle_evidence && meta.settle_evidence.chain_settled) settleEvidence = meta.settle_evidence;
    } catch {}

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
      // chain-truth reconcile: settled if legacy settle_txid OR v0.7 bshard chain settle evidence present.
      settled: !!market.settle_txid || !!settleEvidence,
      chain_settled: !!settleEvidence,
      settle_evidence: settleEvidence ? {
        ...settleEvidence,
        close_explorer_url: txUrl(settleEvidence.close_txid),
        winner_claim: settleEvidence.winner_claim ? {
          ...settleEvidence.winner_claim,
          explorer_url: txUrl(settleEvidence.winner_claim.txid),
        } : null,
        fee_payouts: (settleEvidence.fee_payouts || []).map(f => ({ ...f, explorer_url: txUrl(f.txid) })),
        maker_stake_refund: settleEvidence.maker_stake_refund ? {
          ...settleEvidence.maker_stake_refund,
          explorer_url: txUrl(settleEvidence.maker_stake_refund.txid),
        } : null,
      } : null,
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

  // GET /api/node/income/:pk — per-node (signing committee member) income, SPLIT from the combined
  // committee fee. T6 (Q3, J2 2026-06-27): node 收益现跟 oracle 捆绑 — committee 那笔 fee = oracleBps+nodeBps
  // 合并 (pool-shard-settle.mjs L84 commBps), node→5 签名委员均分 (FEE_CONFIG). node 份额 = committee_payout
  // × nodeBps/(oracleBps+nodeBps). 链验铁律 (不信 DB, 这程 DB 骗 4 次): 真值从 kaspa_tx_log.outputs_json parse
  // (v0.6 = settle_txid output[position+1]; v0.7 bshard = settle_evidence.fee_payouts[committee].txid),
  // 复用 oracle income (L2521) + broker earnings (earnings-by-address) 同源链验法。
  fastify.get('/api/node/income/:pk', async (request, reply) => {
    if (!_v06TablesExist()) return reply.code(503).send({ ok: false, error: 'v159 schema not yet migrated' });
    const nodePk = String(request.params.pk).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(nodePk)) return reply.code(400).send({ ok: false, error: 'pk must be 64-hex (32 bytes)' });
    const { FEE_CONFIG } = await import('../lib/pool-shard-settle.mjs');
    const commBps = (FEE_CONFIG.oracleBps || 0) + (FEE_CONFIG.nodeBps || 0);
    const nodeFrac = commBps > 0 ? (FEE_CONFIG.nodeBps || 0) / commBps : 0;  // = 20/120 with default config
    // derive node address (for v0.7 fee_payout to_address match)
    let nodeAddrs = [];
    try { const kw = await import('kaspa-wasm'); const xo = new kw.XOnlyPublicKey(nodePk); nodeAddrs = [xo.toAddress('testnet-12').toString(), xo.toAddress('mainnet').toString()]; } catch {}
    const txLog = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?');

    let totalNodeSompi = 0, pendingTxCount = 0;
    const perMarket = [];
    // (1) v0.6 committee-position path (mirrors oracle income): committee output = combined fee → node split.
    const v06 = sqlite.prepare(`
      SELECT pc.market_id, pc.committee_pks, pm.settle_txid, pm.protocol_status
      FROM pool_committee pc JOIN pool_markets pm ON pm.id = pc.market_id
      WHERE pm.protocol_version = 'v0.6' AND pm.settle_txid IS NOT NULL
    `).all();
    for (const r of v06) {
      let pks = []; try { pks = JSON.parse(r.committee_pks); } catch {}
      const position = pks.map((p) => String(p).toLowerCase()).indexOf(nodePk);
      if (position < 0) continue;
      const txRow = txLog.get(r.settle_txid);
      if (!txRow || !txRow.outputs_json) { pendingTxCount += 1; perMarket.push({ market_id: r.market_id, version: 'v0.6', position, settle_txid: r.settle_txid, node_income_sompi: null, status: 'tx_pending_index' }); continue; }
      let outputs = []; try { outputs = JSON.parse(txRow.outputs_json); } catch {}
      const myOut = outputs[position + 1];   // [0]=broker, [1..5]=committee
      const commSompi = myOut ? (parseInt(myOut.value ?? myOut.amount ?? myOut.amount_sompi, 10) || 0) : 0;
      const nodeSompi = Math.floor(commSompi * nodeFrac);
      totalNodeSompi += nodeSompi;
      perMarket.push({ market_id: r.market_id, version: 'v0.6', position, settle_txid: r.settle_txid, committee_payout_sompi: commSompi, node_income_sompi: nodeSompi, chain_verified: true, status: r.protocol_status });
    }
    // (2) v0.7 bshard path: settle_evidence.fee_payouts[committee] matched to node address, chain-verified by fee txid.
    if (nodeAddrs.length) {
      const v07 = sqlite.prepare("SELECT id, metadata FROM pool_markets WHERE protocol_version = 'v0.7' AND metadata LIKE '%fee_payouts%'").all();
      for (const m of v07) {
        let meta = {}; try { meta = JSON.parse(m.metadata || '{}'); } catch {}
        const cfees = (meta.settle_evidence?.fee_payouts || []).filter((p) => p && p.role === 'committee' && nodeAddrs.includes(p.to_address));
        for (const f of cfees) {
          const lg = f.txid ? txLog.get(f.txid) : null;   // 链验 fee txid landed + 取真额
          let commSompi = 0;
          if (lg && lg.outputs_json) { try { const o = JSON.parse(lg.outputs_json); commSompi = o.filter((x) => nodeAddrs.includes(x.script_public_key_address || x.address)).reduce((s, x) => s + Number(x.amount ?? x.amount_sompi ?? x.value ?? 0), 0); } catch {} }
          if (commSompi <= 0) { pendingTxCount += 1; perMarket.push({ market_id: m.id, version: 'v0.7', fee_txid: f.txid, node_income_sompi: null, status: 'fee_tx_pending_index' }); continue; }
          const nodeSompi = Math.floor(commSompi * nodeFrac);
          totalNodeSompi += nodeSompi;
          perMarket.push({ market_id: m.id, version: 'v0.7', fee_txid: f.txid, committee_payout_sompi: commSompi, node_income_sompi: nodeSompi, chain_verified: true, status: 'completed' });
        }
      }
    }
    return reply.send({
      ok: true, node_pk: nodePk,
      node_fraction_of_committee_fee: nodeFrac,
      fee_config: { oracleBps: FEE_CONFIG.oracleBps, nodeBps: FEE_CONFIG.nodeBps },
      total_settled_markets: perMarket.length,
      total_node_income_sompi: totalNodeSompi,
      total_node_income_kas: totalNodeSompi / 1e8,
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

    // 🚨 #33/#34 bshard-detect safety net (J1 红队 2026-06-25, §11 裁决 Bettor 认错+全员 co-verify,
    // ANTI-PATTERNS 规则 50). bshard (register-v07) bettors have NO standalone refundable PoolSide:
    // recordBettor (register-v07, ~L1157) writes side_p2sh = the SHARED shard pool P2SH, side_lock_tx =
    // the leaf TX, side_redeem_script_hex = '' — the stake lives in the aggregated fold pool, refundable
    // ONLY via the bshard path (PoolShard_fold refund_draw, lib/pool-refund-builder.mjs). THIS endpoint
    // runs the standalone PoolSide refund (entry 2/3) = the wrong contract for bshard. The historic
    // logical-404 / empty-redeem-409 were incidental fail-safes; this makes the rejection EXPLICIT so a
    // future "make it shard-aware" migration can't strip the safety and route a bshard bettor's refund at
    // the shared shard pool (= one bettor spending the aggregate). DO NOT shard-aware-migrate this query;
    // detect-and-reject is the ruling. (queried by logical id → market_shards.logical_market_id; by a
    // shard id → market_shards.shard_market_id; either match = bshard.)
    const isBshard = sqlite.prepare(
      'SELECT 1 FROM market_shards WHERE logical_market_id = ? OR shard_market_id = ? LIMIT 1'
    ).get(marketId, marketId);
    if (isBshard) {
      return reply.code(409).send({
        ok: false,
        error: 'bshard market: bettor refunds use the fold refund path (PoolShard_fold refund_draw, lib/pool-refund-builder.mjs), not the standalone PoolSide refund endpoint — stake is in the aggregated shard pool, not a per-bettor side UTXO.',
        refund_path: 'bshard_fold',
      });
    }

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

    // v0.5 hardcodes output == stake - 1000 (1000 sompi in-script constant); actual TX fee paid by
    // relay fee-input (separate relay-wallet UTXO, no-change). v06/v07 use dynamic KIP-9 fee.
    const isLegacy = !market.protocol_version || market.protocol_version === 'v0.5';
    const stakeSompi = BigInt(side.stake_amount);
    const outAmount = isLegacy ? stakeSompi - 1000n : stakeSompi - BigInt(fee);
    if (!isLegacy && outAmount <= 1000n) {
      return reply.code(409).send({ ok: false, error: `output ${outAmount} <= dust 1000 (= fee ${fee} too high for stake ${stakeSompi})` });
    }

    // J1 5dd590cd0 grace fix: SS L260/270 require(tx.time >= (deadline + REFUND_GRACE_SEC) * 1000) ms.
    // J1tn r303 (Bettor 03:19 v3 approve): de-dup hardcode → import from lib/pool-refund-grace.mjs.
    // J2-tn r391 (#28 Bettor ③ APPROVE v2 05:26): legacy v0.5 PoolSide locktime 无 grace (SS L121
    // 严守 tx.time >= deadline*1000 ms), v06/v07 + REFUND_GRACE_SEC (L260/270 grace require).
    // entry index: 3 for legacy (PoolSide.sil 4 entry refund=idx3), 2 for v06/v07 (PoolSide_v06/v07 3 entry refund=idx2).
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
        add_fee_input: isLegacy,
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
    // J2-tn #25 UMA L1 RELAX (NWT co-approve, frontier split): margin/让分 + total/大小球 + spread 等
    // 【终场比分算术】= L1 现可判 (#25 evidence 附客观 margin/total → deriveVote cross-sport 16/16 100%,
    // e65719e4). 故从 INFERENCE_RE 移除所有 win-by-N/margin/differential/spread/gap/difference/combined-total/
    // total-over-N/N-more-than 算术 clause (它们不再是"判不了的推理题", 拦它们 = FN on #25-judgeable 市场).
    // 仅保留【beyond-final-box】真推理 (L2/L3, extractor 只给终分判不了): ①score first / first-to-score
    // (temporal 首事件) ②halftime / lead-at-half / per-period(inning|quarter|period|half|frame|set) (非终分态)
    // ③both teams score (per-frame) ④how-many-more (标量非干净 binary). = 这些待 L2/L3 源, 仍 cap warn.
    const INFERENCE_RE = /how many .*\b(more|fewer|less)\b|\b(scores?|scoring)\s+first\b|\bfirst\s+to\s+score\b|\bat\s+(half[\s-]?time|the\s+half)\b|\bhalf[\s-]?time\b|\blead[^.]{0,18}\bhalf|\b(first|1st|second|2nd|third|3rd|fourth|4th)\s+(inning|quarter|period|half|frame|set)\b|\bboth\s+teams\s+score/i;
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
