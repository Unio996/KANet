// bshard-settle-daemon — 自治结算 daemon (Owner 2026-06-30 钦定 A: 补 daemon → 无人值守公测)。
//
// 编排已证的 settleMarketLive (五源验·gp8hy 18 / 2ysnl 26 winner 多片 e2e) 成自治 tick:
//   扫到期 ripe 盘 → consolidate (多片折单 PS) → settleMarketLive (close+threaded claim) → writeback status。
//
// 铁律 (carry 全程):
//   - NO TX NO STATE: 全复用 settleMarketLive 内硬闸 (driver-enforce + verifyClosedLanded poll + claim received-gate)。
//   - 资金安全网 = 链上 covenant (nullifier require(bit==0)·close driver-enforce 锚)·非 DB lease (J1 钦定)。
//     ∴ lease = best-effort 防浪费 TX/竞态·非安全网。重入/双进程链上也只成一笔。
//   - canary: SETTLE_DAEMON_MAX_PER_TICK (默认 1) 小批·失败挂 settle_failed flag 跳过 (operator review)·不死循环重试。
//   - 默认 OFF (SETTLE_DAEMON_ENABLED=1 才跑)·deploy 不自动开·canary review 后启。
//   - ≤1024 winner (settleMarketLive payoutRoot depth-10)·>1024 抛错 fail-safe (rolling payout-shard task#18 根除)。
//
// 部署: index.js startSettleDaemonCron() (env-gated)。canary: 设 ENABLED=1 MAX=1 → 验 → ramp。

import { sqlite } from '../db/client.js';
import { getMarketBets } from '../lib/pool-bettor-sides-query.mjs';
import { computeSettlePlan, settleMarketLive } from './bshard-auto-settler.mjs';
import { consolidateAllShards } from '../lib/pool-shard-settle.mjs';
import { compilePayoutShardRedeem } from '../lib/pool-shard-register.mjs';
import { fetchEndBlockHashCanonical } from './pool-market-settler-v06.mjs';
import { judgeLine } from '../lib/judgeline.mjs';
import { extractStructuredFields } from '../lib/oracle-evidence-extractors.mjs';
import { makeCtfReader } from '../lib/uma-ctf-reader.mjs';   // #20 UMA: polymarket 盘读链上 CTF 判定 (P1 binding-verified 30/30·Bettor)
import { recordShadowJudgment, registerDomainJudge } from '../lib/oracle-shadow-ledger.mjs';   // #26 自我进化: 影子台账(我们 oracle vs 权威·纯记录·永不碰结算·Owner 2026-06-30)
import { espnSportsJudge } from '../lib/nwt-espn-sports-judge.mjs';   // NWT域判v1: polymarket体育盘ESPN独立判
import { classifyFailure, shouldKeepStatus } from '../lib/bshard-failure-classifier.mjs';   // #49 模块①
registerDomainJudge(espnSportsJudge);

const CONSOLE = process.env.SETTLE_DAEMON_CONSOLE_BASE || 'http://127.0.0.1:3200';
const RPC_URL = process.env.SETTLE_DAEMON_RPC_URL || 'ws://127.0.0.1:17210';
const NETWORK = process.env.KASPA_NETWORK || 'testnet-12';
const FEE_RELAY_ID = process.env.SETTLE_DAEMON_FEE_RELAY_ID || '8f104e2d-646d-47cd-81f6-97a16b4f6c01';   // J2test
const PS_SEED_SOMPI = 20000000;
const FINALITY_BUFFER = 60;   // deadline_daa + buffer 才 ripe (endBlockHash finality depth 50·留余量)
const TICK_MS = parseInt(process.env.SETTLE_DAEMON_TICK_MS, 10) || 60000;
const MAX_PER_TICK = parseInt(process.env.SETTLE_DAEMON_MAX_PER_TICK, 10) || 1;   // canary 默认 1
const ENABLED = process.env.SETTLE_DAEMON_ENABLED === '1';
// #20 UMA judge: polymarket 盘 winDir 读链上 Polymarket CTF (payoutNumerators/payoutDenominator by conditionId).
// multi-RPC cross-check (RPC-trust·≥2 源同值才认)·finality (payoutDenominator>0 才 resolved·否则 ABSTAIN fail-closed)。
const UMA_POLYGON_RPCS = (process.env.UMA_POLYGON_RPCS || 'https://polygon-bor-rpc.publicnode.com,https://polygon.drpc.org,https://1rpc.io/matic').split(',').map((s) => s.trim()).filter(Boolean);
let _ctfReader = null;
function ctfReader() { if (!_ctfReader) _ctfReader = makeCtfReader({ rpcs: UMA_POLYGON_RPCS }); return _ctfReader; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[settle-daemon]', new Date().toISOString().slice(11, 19), ...a);

const _leases = new Set();   // in-memory best-effort lease (J1: covenant 是真安全网)
let _timer = null;
let _running = false;

// ── ctx (复用已证 driver·HTTP relayPost :3200 + own RpcClient) ──
let _kaspa = null, _rpc = null;
async function kaspa() { if (!_kaspa) _kaspa = await import('kaspa-wasm'); return _kaspa; }
async function rpcConnect() { const k = await kaspa(); const r = new k.RpcClient({ url: RPC_URL, encoding: k.Encoding.Borsh, networkId: NETWORK }); await r.connect({}); _rpc = r; return r; }
async function rpcEnsure() { if (!_rpc) await rpcConnect(); return _rpc; }
const withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms))]);
async function getUtxos(addr) {
  const k = await kaspa();
  for (let i = 0; i < 3; i++) {
    try { await rpcEnsure(); const { entries } = await withTimeout(_rpc.getUtxosByAddresses([new k.Address(addr)]), 12000, 'getUtxos'); return entries || []; }
    catch { try { await _rpc?.disconnect().catch(() => {}); } catch {} _rpc = null; }
  }
  throw new Error('getUtxos failed 3x');
}
const norm = (e) => JSON.parse(JSON.stringify(e, (kk, v) => typeof v === 'bigint' ? v.toString() : v));
async function relayPost(relayId, cmd) {
  const r = await fetch(`${CONSOLE}/api/relay/${relayId}/send-command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(180000) });
  return r.json();
}
async function apiTransfer(toAddr, kas) {
  const amt = Number(kas).toFixed(8);   // KI-30: Kaspa wallet 8-decimal max·防 JS 浮点 17-dec reject
  const r = await fetch(`${CONSOLE}/api/relay/${FEE_RELAY_ID}/transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: toAddr, amount: amt }), signal: AbortSignal.timeout(180000) });
  return r.json();
}
async function p2shAddr(redeemHex) { const k = await kaspa(); return k.addressFromScriptPublicKey(k.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), NETWORK).toString(); }
async function p2pkAddr(pkHex) { const k = await kaspa(); return new k.PublicKey(pkHex).toAddress(k.NetworkType.Testnet).toString(); }
async function p2pkSpk(addr) { const k = await kaspa(); const s = k.payToAddressScript(new k.Address(addr)); return (s.script ?? s).toString(); }
function feeRelayAddr() { return sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(FEE_RELAY_ID)?.address; }
async function mintFeeUtxo() {
  const addr = feeRelayAddr();
  const tr = await apiTransfer(addr, 0.3);
  const txId = tr.txId || tr.tx_id; if (!txId) throw new Error(`mintFeeUtxo fail: ${JSON.stringify(tr).slice(0, 120)}`);
  for (let i = 0; i < 30; i++) { const es = await getUtxos(addr); if (es.some(e => (norm(e).entry?.outpoint || norm(e).outpoint)?.transactionId === txId)) break; await sleep(2000); }
  return { address: addr, outpointTxid: txId, index: 0 };
}
let _pkMap = null;
async function buildPkMap() {
  _pkMap = {};
  const oracles = sqlite.prepare("SELECT id FROM relay_nodes WHERE is_oracle = 1").all();
  for (const o of oracles) { try { const r = await relayPost(o.id, { type: 'get_pubkey' }); const pk = (r.x_only_pubkey || r.xOnlyPubkey || r.pubkey || '').toLowerCase(); if (/^[0-9a-f]{64}$/.test(pk)) _pkMap[pk] = o.id; } catch {} }
  return _pkMap;
}
async function judgeWinDir(market) {
  // #20 UMA path: polymarket 盘判定走链上 Polymarket CTF (非 HTTP data source·非 gamma price·bonded on-chain truth)。
  //   conditionId = outcome_condition_id (66-char 0x bytes32·三源 verify-value-source·329/329 pending polymarket 实证)。
  //   readResolution multi-RPC cross-check + finality(payoutDenominator>0)·未 resolved/异常/不一致 → ABSTAIN → throw skip。
  if (market.outcome_market_source === 'polymarket') {
    const conditionId = market.outcome_condition_id;
    const res = await ctfReader().readResolution(conditionId);
    if (res.final !== 'YES' && res.final !== 'NO') throw new Error(`UMA judge ABSTAIN: ${res.final} (conditionId ${String(conditionId).slice(0, 12)})`);
    return res.final === 'YES' ? 0 : 1;   // YES→winDir0 / NO→winDir1 (value-mapping 与 ESPN 一致)
  }
  // ESPN/HTTP path (原路·不变): resolution_rule_spec.data_source_canonical = HTTP URL → extract + judgeLine。
  const spec = JSON.parse(market.resolution_rule_spec);
  const raw = await (await fetch(spec.data_source_canonical, { signal: AbortSignal.timeout(30000) })).text();
  const ev = extractStructuredFields(spec.data_source_canonical, raw);
  const v = judgeLine(spec.resolution_predicate, ev.fields);
  if (v !== 'YES' && v !== 'NO') throw new Error(`judge ABSTAIN: ${v}`);
  return v === 'YES' ? 0 : 1;
}
function poolMembers(root) {
  const snap = sqlite.prepare('SELECT leaves_json FROM oracle_pool_chain_view WHERE merkle_root = ? ORDER BY snapshot_daa DESC LIMIT 1').get(root);
  if (!snap) throw new Error(`no snapshot for root ${root.slice(0, 12)}`);
  return JSON.parse(snap.leaves_json).map(l => ({ pk_hex: String(l.pk_x).toLowerCase(), stake_sompi: String(l.stake_sompi) }));
}
const chainReader = {
  async getCurrentDaaScore() { const r = await relayPost(FEE_RELAY_ID, { type: 'chain_get_current_daa_score' }); return Number(r.daa_score); },
  async getBlockAtDaa(minDaa) { const r = await relayPost(FEE_RELAY_ID, { type: 'chain_get_block_at_daa', min_daa_score: minDaa }); if (!r?.hash) throw new Error(`getBlockAtDaa fail: ${JSON.stringify(r).slice(0, 120)}`); return { hash: String(r.hash), daaScore: Number(r.daaScore) }; },
};
async function endBlockHash(daa) { return (await fetchEndBlockHashCanonical(chainReader, daa)).hash; }

// consolidate(如需要) + psState 构造 — settle 路径和 ABSTAIN 退款路径共用(两者都需要"折片进 PayoutShard 之后
// 的 closed=0 redeem 起点", 只是之后一个走 close_attest 一个走 cancel_attest)。抽出自 _settleOneMarketAttempt
// 原 inline 逻辑(J2 2026-07-04 抽取, 逻辑一字不动, 见 git blame 迁移前版本)。
async function consolidateAndBuildPsState(marketId, ps, ctx) {
  const shards = sqlite.prepare('SELECT shard_index, status FROM market_shards WHERE logical_market_id = ?').all(marketId);
  const needConsolidate = shards.some(s => s.status === 'sealed' || s.status === 'open');
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);

  let psOutpointTxid, psIdx, consolidatedPool;
  if (needConsolidate) {
    const res = await consolidateAllShards({
      db: sqlite, rc: (cmd) => relayPost(FEE_RELAY_ID, cmd),
      landed: async (txid, addr) => { for (let i = 0; i < 30; i++) { if ((await getUtxos(addr)).some(e => (norm(e).entry?.outpoint || norm(e).outpoint)?.transactionId === txid)) return true; await sleep(3000); } return false; },
      p2sh: _p2shCache, logicalMarketId: marketId,
      payoutShard: { payout_redeem_hex: ps.payout_redeem_hex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
      relayAddr: feeRelayAddr(),
      transfer: async (addr, sompi) => { const t = await apiTransfer(addr, (sompi / 1e8).toFixed(8)); const tx = t.txId || t.tx_id; if (!tx) throw new Error('fee transfer fail'); await sleep(3000); return tx; },
      deadline: Number(market.deadline),
    });
    [psOutpointTxid, psIdx] = res.psOutpoint.split(':'); psIdx = Number(psIdx);
    consolidatedPool = res.consolidatedPool;
    try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ? WHERE logical_market_id = ?').run(res.psOutpoint, marketId); } catch {}
    log(`${marketId.slice(-8)} consolidated ${res.consolidatedShards} shard(s) → ${res.psOutpoint} pool=${consolidatedPool}`);
  } else {
    [psOutpointTxid, psIdx] = String(ps.payout_ps_outpoint).split(':'); psIdx = Number(psIdx);
    const { poolSompi } = getMarketBets(marketId, sqlite);
    consolidatedPool = (BigInt(poolSompi) + BigInt(PS_SEED_SOMPI)).toString();
    log(`${marketId.slice(-8)} already consolidated → ${ps.payout_ps_outpoint} pool=${consolidatedPool}`);
  }

  const redeem0 = compilePayoutShardRedeem({ poolMerkleRoot: ps.pool_merkle_root, predicateCommit: ps.predicate_commit, consolidatedPool, closed: 0 });
  return { outpointTxid: psOutpointTxid, index: psIdx, redeem_hex: redeem0, consolidatedPool, poolMerkleRoot: ps.pool_merkle_root, predicateCommit: ps.predicate_commit };
}

function buildCtx() {
  return {
    db: sqlite, psSeedSompi: PS_SEED_SOMPI,
    judgeWinDir, endBlockHash, poolMembers,
    p2shAddr: (r) => _p2shCache(r), p2pkAddr: (p) => _p2pkAddrSync(p), p2pkSpk: (a) => _p2pkSpkSync(a),
    getUtxos: async (addr) => (await getUtxos(addr)).map(norm),
    relayPost,
    feeRelay: { id: FEE_RELAY_ID, address: feeRelayAddr() },
    feeUtxo: mintFeeUtxo,
    pkToRelay: (pk) => _pkMap?.[pk.toLowerCase()] || null,
    alert: (mid, reason) => log(`🔴 ALERT [${String(mid).slice(-8)}]: ${reason}`),
  };
}
// kaspa-wasm p2sh/p2pk are sync after module load; pre-warm in tick. computeSettlePlan/settleMarketLive call them sync.
let _k = null;
function _p2shCache(redeemHex) { return _k.addressFromScriptPublicKey(_k.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), NETWORK).toString(); }
function _p2pkAddrSync(pkHex) { return new _k.PublicKey(pkHex).toAddress(_k.NetworkType.Testnet).toString(); }
function _p2pkSpkSync(addr) { const s = _k.payToAddressScript(new _k.Address(addr)); return (s.script ?? s).toString(); }

// #49 模块② (2026-07-04, docs/2026-07-04-daemon-error-handling-modular-design.md v2 §3.2):
// UMA re-judge 退避表——数字来自真实查证的 UMA/Polymarket 协议参数(2h 常规 dispute window,
// 最长 96h DVM 投票升级), 不是拍脑袋。Owner 钦定方向"充分嫁接 UMA"(耐心等它 finalize, 不是
// 绕过它用别的数据源抢跑)。
const UMA_REJUDGE_BACKOFF_TABLE = [
  { maxAgeHours: 2, intervalMinutes: 15 },   // 常规无 dispute 路径, 2h 内应该 finalize
  { maxAgeHours: 6, intervalMinutes: 30 },   // 可能刚好卡在 propose 边缘或短暂 dispute
  { maxAgeHours: 96, intervalMinutes: 120 }, // DVM 投票升级场景, 最长约 4 天
];
const UMA_GENUINE_TIMEOUT_HOURS = 96; // 超过这个还 ABSTAIN = 真正长期无解, 转 settle_failed 走 #47

// 该市场是不是 UMA-pending(metadata.uma_pending_since 已设, 上次尝试距今是否已经过了退避表
// 对应档位的间隔)。true = 这次 tick 可以重新尝试判定; false = 还没到该重试的时候, 跳过(省 RPC)。
// 非 UMA-pending 的市场(没有这个 metadata 字段)一律放行(不受此函数影响, 保持原有 ripe 行为)。
function _umaBackoffAllowsRetryNow(marketRow) {
  let meta = {}; try { meta = JSON.parse(marketRow.metadata || '{}'); } catch {}
  const pendingSince = meta.uma_pending_since;
  if (!pendingSince) return true; // 不是 UMA-pending 市场, 不受退避表限制
  const nowMs = Date.now();
  const ageHours = (nowMs - new Date(pendingSince).getTime()) / 3_600_000;
  const lastAttemptMs = meta.uma_last_attempt_at ? new Date(meta.uma_last_attempt_at).getTime() : new Date(pendingSince).getTime();
  const sinceLastAttemptMinutes = (nowMs - lastAttemptMs) / 60_000;
  const tier = UMA_REJUDGE_BACKOFF_TABLE.find((t) => ageHours <= t.maxAgeHours) || UMA_REJUDGE_BACKOFF_TABLE[UMA_REJUDGE_BACKOFF_TABLE.length - 1];
  return sinceLastAttemptMinutes >= tier.intervalMinutes;
}

// scheduleUmaRejudge — BUSINESS_PENDING(UMA ABSTAIN)分类命中时调用。首次调用写
// metadata.uma_pending_since(标记进入 UMA-pending 状态); 每次调用更新 uma_last_attempt_at
// (供 _umaBackoffAllowsRetryNow 计算退避间隔) + 重试计数。超过 genuine-timeout 门槛则返回
// timeout_exceeded, 调用方(settleDaemonTick)据此转 settle_failed(#47 人工评估退款路的入口)。
function scheduleUmaRejudge(marketId, market) {
  let meta = {}; try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  const nowIso = new Date().toISOString();
  const isFirst = !meta.uma_pending_since;
  if (isFirst) meta.uma_pending_since = nowIso;
  meta.uma_last_attempt_at = nowIso;
  meta.uma_retry_count = (meta.uma_retry_count || 0) + 1;
  const ageHours = (Date.now() - new Date(meta.uma_pending_since).getTime()) / 3_600_000;
  const timedOut = ageHours > UMA_GENUINE_TIMEOUT_HOURS;
  try {
    if (timedOut) {
      // 真超时: metadata + protocol_status 一次写, 别只更新 metadata 漏了状态转换(#48 那种
      // "新逻辑写了一半没接通"的坑, 这里两个字段一起原子写, 不留中间态)。
      sqlite.prepare("UPDATE pool_markets SET metadata = ?, protocol_status = 'settle_failed' WHERE id = ?").run(JSON.stringify(meta), marketId);
    } else {
      sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), marketId);
    }
  } catch (e) { log(`${marketId.slice(-8)} scheduleUmaRejudge writeback warn: ${e.message}`); }
  if (timedOut) {
    log(`${marketId.slice(-8)} UMA-pending 超过 genuine-timeout(${UMA_GENUINE_TIMEOUT_HOURS}h, 实际 ${ageHours.toFixed(1)}h) — 转 settle_failed, 走 #47 人工评估退款`);
    return { ok: false, action: 'timeout_exceeded', keepStatus: false };
  }
  log(`${marketId.slice(-8)} UMA-pending${isFirst ? '(首次)' : ''}, 第 ${meta.uma_retry_count} 次尝试, 年龄 ${ageHours.toFixed(2)}h — 保留 verifying, 等下次退避窗口`);
  return { ok: false, action: 'scheduled', keepStatus: true };
}

// ripe = v0.7 + deadline_daa+buffer passed + 未结算 + 非 settle_failed + betCount>0 + 非 commingled。
function selectRipeMarkets(currentDaa, pmt, limit) {
  // 只结 active-未结 (pending_bettors/verifying)·排终态 (cancelled/completed/refunded/refunding/settle_failed)。
  const rows = sqlite.prepare(`
    SELECT * FROM pool_markets
    WHERE protocol_version = 'v0.7'
      AND settle_txid IS NULL
      AND deadline_daa IS NOT NULL
      AND deadline_daa + ? <= ?
      AND protocol_status IN ('pending_bettors', 'verifying')
    ORDER BY deadline_daa ASC
  `).all(FINALITY_BUFFER, currentDaa);
  const ripe = [];
  for (const m of rows) {
    if (_leases.has(m.id)) continue;
    // 🔴 consolidate lockTime gate (partial-shard ShardLeaf 件1: tx.time>=deadline*1000): MTP(pastMedianTime)
    //   滞后实时 ~2-3min·过早 settle → consolidate TX "input not finalized" rejected (live daemon A/u6ry7 实撞)。
    //   只在 MTP >= deadline*1000 才 settle (consolidate 才 final)。sealed-only 盘其实不需·但统一 gate 无害(稍延)。
    if (Number(m.deadline) * 1000 > pmt) continue;
    try {
      const { betCount, multiShard, isBshard } = getMarketBets(m.id, sqlite);
      if (!isBshard || betCount === 0) continue;
      const logicalBets = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(m.id).c;
      if (logicalBets > 0) continue;   // commingled → skip (cleanliness 闸·settleMarketLive 也会拦)
      // #49 模块② (2026-07-04): UMA-pending 市场(metadata.uma_pending_since 已设)按退避表判断
      // 该不该这次 tick 就重新尝试——不改这里的话, daemon 会对每个 UMA-pending 盘每 60 秒 tick 都
      // 重新尝试判定, 意图"0-2h 每 15 分钟"变成"每 60 秒", 浪费 UMA RPC 调用(NWT review 指出)。
      if (!_umaBackoffAllowsRetryNow(m)) continue;
      ripe.push({ market: m, betCount, multiShard });
      if (ripe.length >= limit) break;
    } catch (e) { log(`ripe-scan skip ${m.id.slice(-8)}: ${e.message}`); }
  }
  return ripe;
}

// #G5-5a (2026-07-04, task#33 §2.2 找到的原始证据基础): 瞬态 RPC/consolidate 查询有界重试。
//   #33 全量重放 ALERT 日志分类过这类失败: "plan threw (fetch failed)"(3例) + "build fail: UTXO
//   not found"(5例, 3例仍卡 settle_failed) —— 都是 RPC/网络层瞬时问题, 不是业务/安全判定, 重试大概率
//   自愈(节点还没索引到刚广播的 UTXO / 一次性网络抖动)。白名单严格: 只匹配这几类瞬态错误签名, 不匹配
//   ABSTAIN(oracle 判定拿不到, 重试无意义, 走 re-judge 通道 G7)/climb-fail/round-trip-fail(数据问题非
//   时序问题)/needs_rolling(架构上限)/enforce mismatch(安全判定, 绝不重试掩盖)。
const TRANSIENT_RE = /UTXO not found|fetch failed|ECONNREFUSED|RPC connect timeout|not synced|no working Kaspa RPC|ETIMEDOUT|network.*(timeout|error)|no land\b|not landed/i;
// ⚠ 已知权衡(非阻塞,记录不隐藏): "not landed" 类重试有极小窗口——若第1次的 close_attest 实际已上链
// 只是 verifyClosedLanded 假阴性(见 #33 NWT 发现的 verifyClaimLanded 32s 窗口同类问题), 重试会再发一笔
// close_attest。covenant 自身 require(closed==0) 是真安全网(第2笔在链上被拒·非双花/双付), 只是浪费一笔
// fee + alert 噪音。可接受: fail-safe 优于 fail-open, 且此重试跟 §4.2 resume 引擎(读链上 tip 而非盲重试)
// 是互补关系, 不是替代——真正的幂等重试属于 resume 引擎范畴(排 #21-5b, 见 task33 设计文档)。
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;
const _sleepRetry = (ms) => new Promise((r) => setTimeout(r, ms));

async function settleOneMarket(marketId) {
  // #49 模块① (2026-07-04, docs/2026-07-04-daemon-error-handling-modular-design.md v2):
  // 分类需要 market 行(BUSINESS_PENDING 判定要看 outcome_market_source)——读一次, 便宜(单行 PK 查询),
  // 供本函数末尾分类使用。注意: 这是"读取失败原因用的辅助信息", 不是结算逻辑本身, 读不到也不阻断。
  const marketRow = sqlite.prepare('SELECT outcome_market_source FROM pool_markets WHERE id = ?').get(marketId);
  let lastResult = null;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    // consolidateAllShards 内部可能直接 throw(非 {ok:false} 返回形态)——统一收口成同形状, 否则瞬态异常
    // (如 landed() polling 超时/transfer RPC 失败)会绕过下面的白名单分类直接冒泡崩掉整个 tick。
    try { lastResult = await _settleOneMarketAttempt(marketId); }
    catch (e) { lastResult = { ok: false, reason: e.message || String(e), _rawError: e }; }
    if (lastResult.ok) return lastResult;
    const reason = String(lastResult.reason || '');
    if (!TRANSIENT_RE.test(reason)) break;   // non-transient (business/security/code-bug) → fail fast, classify below, no more retry
    if (attempt === RETRY_MAX_ATTEMPTS) break;
    const delay = RETRY_BASE_DELAY_MS * attempt;   // 2s, 4s (linear backoff, bounded — this is a settle daemon tick, not a hot loop)
    log(`${marketId.slice(-8)} 瞬态失败(${attempt}/${RETRY_MAX_ATTEMPTS}): ${reason.slice(0, 80)} — 退避 ${delay}ms 重试`);
    await _sleepRetry(delay);
  }
  // #49 模块①: 分类最终失败原因, 附在返回值里供 settleDaemonTick 决定要不要覆盖 protocol_status。
  //   注意: lastResult.reason 是字符串(经过 `plan throw: ${e.message}` 这类包装), classifyFailure
  //   的 instanceof 检查用 lastResult._rawError(若有, 未被包装过的原始异常对象); 若 _settleOneMarketAttempt
  //   走的是正常 return {ok:false, reason} 路径(非 throw), 没有原始异常对象, classifyFailure 退化成
  //   只靠字符串正则判断(仍然安全, 只是 instanceof 那层结构化判定用不上)。
  const classification = classifyFailure(lastResult._rawError || new Error(String(lastResult.reason || '')), marketRow, TRANSIENT_RE);
  if (String(lastResult.reason || '').match(TRANSIENT_RE)) {
    log(`${marketId.slice(-8)} 瞬态重试耗尽(${RETRY_MAX_ATTEMPTS}次): ${String(lastResult.reason || '').slice(0, 80)} — 分类=${classification.type}`);
  }
  return { ...lastResult, classification };
}

// per-market: consolidate (if needed) → settle → writeback。failure → settle_failed flag。
async function _settleOneMarketAttempt(marketId) {
  _k = await kaspa();   // ensure kaspa-wasm loaded before sync p2sh/p2pk helpers (direct-call + tick safety)
  if (!_pkMap) await buildPkMap();   // ensure committee pk→relay map (direct-call safety; tick also builds it)
  const ctx = buildCtx();
  const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  if (!ps) { ctx.alert(marketId, 'no payout_shards row'); return { ok: false, reason: 'no PS' }; }
  // #48 regression fix (J2 2026-07-04 co-verify 抓到, 真实撞过一次): consolidateAndBuildPsState 抽取时
  // 把 market 变量的声明也一起搬进了那个 helper 的局部作用域——但下方 writeback(market.metadata)和
  // shadow ledger(收窄 { market, ... })两处仍在【本函数】里用 market, 抽取后变成 ReferenceError。危险处:
  // 这个错发生在 settleMarketLive 成功 + writeback 成功【之后】(shadow ledger 那行), 被外层 G5-5a 重试
  // 包装器当作整体失败, 把刚写对的 protocol_status 覆盖成 settle_failed——DB 状态跟链上真相(已结算成功)
  // 完全对不上, 比"没结算"更危险(会让 operator 误以为要重新结算一个其实已经结完的盘)。
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);

  // 0. 🔴 pre-flight plan (J1 covenant gate): winners≤1024 + plan.ok 验在【动钱前】。
  //   >1024 → buildPayoutRoot 抛 → 这里 catch → skip·**不 consolidate 不动钱**(避免半结·钱留 ShardLeaf 安全)。
  let plan;
  try { plan = await computeSettlePlan(marketId, ctx); }
  catch (e) {
    const rolling = /1024|rolling/i.test(e.message);
    ctx.alert(marketId, `plan threw (${rolling ? '>1024 winner·待 rolling payout-shard task#18' : e.message}) — skip·不动钱`);
    return { ok: false, reason: rolling ? 'needs_rolling' : `plan throw: ${e.message}`, needsRolling: rolling };
  }
  if (!plan.ok) { ctx.alert(marketId, `plan not ok: ${plan.reason} — skip·不动钱`); return { ok: false, reason: plan.reason }; }
  if (plan.winners && plan.winners.length > 1024) { ctx.alert(marketId, `${plan.winners.length} winners >1024 — skip·待 rolling`); return { ok: false, reason: 'needs_rolling', needsRolling: true }; }

  // 1-2. consolidate(如需要) + psState 构造 — 抽成可复用 helper (J2 2026-07-04, ABSTAIN 退款路复用同一步骤,
  //   见 cancelMarketLive caller: consolidate 判断/psState 形状跟结算路径完全一致, 只是之后走 cancel_attest 非 close_attest)。
  const psState = await consolidateAndBuildPsState(marketId, ps, ctx);

  // 3. settle (close + threaded claim·已证)
  const ctx2 = { ...ctx, psState: () => psState };
  const r = await settleMarketLive(marketId, ctx2);
  if (!r.ok || !r.closeTxid) { ctx.alert(marketId, `settle fail: ${r.reason || 'no closeTxid'}`); return { ok: false, reason: r.reason, closeTxid: r.closeTxid }; }

  // 4. writeback (task#17·status + settle_txid + settle_evidence)
  //    #task33 (2026-07-03·NWT GREEN): completed 不变量 = 每个 winner 都有链上确认(received===true 且无 error)的
  //    claim TX。r.complete 由 settleMarketLive 精确计算(claims.length===plan.winners.length 且全部 received && !error)。
  //    不完整 → settled_partial_claims(可重入重试队列, 见 §4.2)；其中若含 climb-fail/round-trip-fail(数据/编码问题
  //    非时序问题) → needs_manual_attribution(独立终态, 不进自动重试, 见 §4.2.1 🟡风险-1)。
  //    evidence.winners/claim_txids 只认真到账(txId && received===true && !error)——旧字段把失败-但-带-txId 的条目
  //    也计入是本 bug 产物, 不再重蹈(Bettor co-verify 指正)。
  const newStatus = r.complete ? 'completed' : (r.needsManualAttribution ? 'needs_manual_attribution' : 'settled_partial_claims');
  try {
    const allClaims = r.claims || [];
    const landedClaims = allClaims.filter(c => c.txId && c.received === true && !c.error);
    const evidence = {
      settled_by: 'bshard-settle-daemon', close_txid: r.closeTxid, payout_root: r.plan?.payoutRoot,
      winners: landedClaims.length, claim_txids: landedClaims.map(c => c.txId),
      // #DM-UI-gap (NWT 2026-07-04 抓: my-positions 靠 v0.6 metadata.phase2_winner 判赢输, bshard 从没写过
      // 这字段·所有 bshard/世界杯盘结算后用户 /mybets 看不到"你赢了/输了"): 补 per-bettor 明细(pk→{amount,
      // txId}), 供 my-positions 直接按 bettorPk 匹配判赢(landedClaims 已链验 received===true, 不用再反查
      // kaspa_tx_log)。winDir 一并存(哪个方向赢了, 没赢的 bettor 靠这个判"你输了"非"待结算")。
      winner_details: landedClaims.map(c => ({ pk: c.pk, amount: c.amount, txId: c.txId })),
      win_direction: r.plan?.winDir ?? null,
      expected_winners: r.plan?.winners?.length ?? null, attempted: allClaims.length, complete: !!r.complete,
      chain_settled: true, settled_at: new Date().toISOString(),
    };
    let meta = {}; try { meta = JSON.parse(market.metadata || '{}'); } catch {}
    meta.settle_evidence = evidence;
    sqlite.transaction(() => {
      sqlite.prepare("UPDATE pool_markets SET protocol_status = ?, settle_txid = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newStatus, r.closeTxid, JSON.stringify(meta), marketId);
      if (r.complete) sqlite.prepare("UPDATE market_shards SET status = 'settled' WHERE logical_market_id = ?").run(marketId);
    })();
  } catch (e) {
    // #daemon-audit-② (NWT 2026-07-04 红队审计抓到): 原来这里只 log warning 就吞掉, 函数照样往下走到
    // 最后 return{ok:true}——如果 writeback 这个 DB UPDATE 本身失败(比如 DB 锁), daemon 会**误报成功**,
    // 但 DB 里 protocol_status 其实还停在 verifying(既不是 completed 也不是 settle_failed, 没人会去查
    // 的诡异中间态)。链上钱是安全的(settleMarketLive 已经成功), 但这个"看起来没事但其实卡住"的假信号
    // 比明确的 settle_failed 更危险(后者至少有 KANet-UI 的告警 monitor 能发现)。改成: 返回失败, 让外层
    // G5-5a 重试(retry 时 settleMarketLive 会因为链上已 closed 而快速/安全地再失败一次, 最终落地 settle_
    // failed——可见、可告警, 好过静默卡死)。
    log(`${marketId.slice(-8)} 🔴 writeback FAIL: ${e.message} (on-chain settle 已成功但 DB 没写进去, close=${r.closeTxid.slice(0, 12)} — 不再静默吞, 走失败路径让外层能看见/重试)`);
    return { ok: false, reason: `writeback fail: ${e.message}`, closeTxid: r.closeTxid };
  }
  log(`${r.complete ? '✅' : '🟠'} ${marketId.slice(-8)} ${newStatus} close=${r.closeTxid.slice(0, 12)} winners=${(r.claims || []).filter(c => c.txId && c.received === true && !c.error).length}/${r.plan?.winners?.length ?? '?'}`);

  // 📒 影子台账 (#26 自我进化·J1·Owner 2026-06-30): 记"我们 oracle 独立判定 vs 权威判定(plan.winDir·已结钱)"。
  //   🔴 BETTOR 守门铁律1: **纯记录·永不碰结算**——settle 已完成(上方 writeback)·本块吞所有错·绝不阻断 return。
  //   plan.winDir = computeSettlePlan 实际用于结算的权威判定(polymarket→UMA / ESPN→judgeLine)·复用不重判。
  //   our_oracle 当前多为 NULL(领域判 registry 空=路线图)·NWT 滚动 registerDomainJudge 后真对比 materialize。
  //   🟡 J2 forward-looking 守门: **fire-and-forget·不在 settle 路 await**——即便 NWT 域判做慢/挂的网络调用,
  //   也零拖延结算(record 内部 per-judge timeout 8s 兜底)。把"shadow 永不碰结算"延伸到"永不拖时延"。
  // #daemon-audit-① (NWT 2026-07-04 红队审计抓到): 原来这行裸调用完全靠 recordShadowJudgment 内部"永不
  // throw"的注释承诺(belt-and-suspenders 是信任假设, 不是结构性保证)——万一以后有人改内部逻辑不小心引入
  // 同步 throw(比如访问了 market 或其它变量的属性但那个变量是 undefined, 正是 #48 撞过的那种坑), 这行本身
  // 没有独立 try/catch 兜底, 会重演#48"结算成功之后的收尾代码抛错·被外层当整体失败"那一幕。这里加一层不
  // 依赖被调函数承诺的独立防护。
  try {
    if (plan.winDir === 0 || plan.winDir === 1) {
      recordShadowJudgment(sqlite, { market, authorityWinDir: plan.winDir, settleTxid: r.closeTxid })
        .then((s) => { if (s.recorded) log(`📒 shadow ${marketId.slice(-8)}: ${s.agree == null ? '∅无独立源(路线图)' : s.agree ? '✓我方一致' : '✗我方分歧'}${s.reason ? ' · ' + s.reason : ''}`); })
        .catch((e) => log(`📒 shadow ${marketId.slice(-8)} skip (不影响结算): ${String(e?.message || e).slice(0, 80)}`));   // 内部已永不throw·belt-and-suspenders
    }
  } catch (e) { log(`📒 shadow ${marketId.slice(-8)} sync throw caught (不影响结算, 独立防护生效): ${String(e?.message || e).slice(0, 80)}`); }

  return { ok: true, closeTxid: r.closeTxid, claims: r.claims };
}

export async function settleDaemonTick() {
  if (_running) { log('prev tick still running·skip'); return; }
  _running = true;
  try {
    _k = await kaspa(); await buildPkMap();
    const currentDaa = await chainReader.getCurrentDaaScore();
    await rpcEnsure();
    const pmt = Number((await _rpc.getBlockDagInfo()).pastMedianTime);   // MTP·consolidate lockTime(deadline*1000) final gate
    const ripe = selectRipeMarkets(currentDaa, pmt, MAX_PER_TICK);
    if (ripe.length === 0) return;
    log(`tick: ${ripe.length} ripe market(s) (MAX_PER_TICK=${MAX_PER_TICK})`);
    for (const { market, betCount, multiShard } of ripe) {
      if (_leases.has(market.id)) continue;
      _leases.add(market.id);
      try {
        log(`settling ${market.id.slice(-8)} betCount=${betCount} shards=${multiShard || 1}`);
        const r = await settleOneMarket(market.id);
        if (!r.ok) {
          // #49 模块① (2026-07-04, NWT 抓到的关键接线缺口·实现清单第一个验证点): 原来这里
          // 无条件写 settle_failed, 完全不看 classifyFailure 算出的分类——分类器写了但没接通,
          // 等于没做(#25/KI-49 同源模式)。现在: CODE_BUG/UNCLASSIFIED/TRANSIENT(重试已耗尽)
          // 都 shouldKeepStatus===true, 跳过 UPDATE(不武断覆盖状态), 只走告警; 只有真正确认的
          // 失败(needsRolling 或分类结果不要求保留状态)才改 protocol_status。
          // #49 模块②: BUSINESS_PENDING(UMA ABSTAIN)不查 shouldKeepStatus(它总是走独立的
          // scheduleUmaRejudge 判断——退避未到/genuine-timeout 未到 = 保留, 真超时 = 转 settle_failed)。
          if (!r.needsRolling && r.classification?.type === 'BUSINESS_PENDING') {
            scheduleUmaRejudge(market.id, market); // 内部已 log + 决定是否 timeout, writeback metadata
            continue; // 跳过下面的 settle_failed 通用写入路径, 已由 scheduleUmaRejudge 处理完
          }
          const flag = r.needsRolling ? 'needs_rolling' : 'settle_failed';   // needs_rolling=>1024·待 task#18·非错
          const keep = !r.needsRolling && r.classification && shouldKeepStatus(r.classification);
          if (keep) {
            log(`🟡 ${market.id.slice(-8)} 失败但保留状态(分类=${r.classification.type}, 不误标 settle_failed): ${r.reason}`);
          } else {
            try { sqlite.prepare('UPDATE pool_markets SET protocol_status = ? WHERE id = ?').run(flag, market.id); } catch {}
            log(`🔴 ${market.id.slice(-8)} → ${flag} (operator review): ${r.reason}`);
          }
        }
      } catch (e) {
        // 同款分类(这里的 e 是 settleOneMarket 本身抛出的意外异常, 不是 _settleOneMarketAttempt 内部
        // 已经收口过的 {ok:false} 形态——理论上少见, 但同样不该无条件武断标 settle_failed)。
        const classification = classifyFailure(e, market, TRANSIENT_RE);
        if (shouldKeepStatus(classification)) {
          log(`🟡 ${market.id.slice(-8)} settle threw 但保留状态(分类=${classification.type}): ${e.message}`);
        } else {
          log(`🔴 ${market.id.slice(-8)} settle threw: ${e.message}`);
          try { sqlite.prepare("UPDATE pool_markets SET protocol_status = 'settle_failed' WHERE id = ?").run(market.id); } catch {}
        }
      } finally { _leases.delete(market.id); }
    }
  } catch (e) { log(`tick error: ${e.message}`); }
  finally { _running = false; }
}

export function startSettleDaemonCron() {
  if (!ENABLED) { log('disabled (SETTLE_DAEMON_ENABLED!=1)·not starting'); return; }
  if (_timer) return;
  log(`starting·tick=${TICK_MS}ms·MAX_PER_TICK=${MAX_PER_TICK}·feeRelay=${FEE_RELAY_ID.slice(0, 8)}`);
  _timer = setInterval(() => { settleDaemonTick().catch(e => log(`tick uncaught: ${e.message}`)); }, TICK_MS);
  settleDaemonTick().catch(e => log(`startup tick: ${e.message}`));   // immediate first tick
}
export function stopSettleDaemonCron() { if (_timer) { clearInterval(_timer); _timer = null; } }
async function ensureReady() { _k = await kaspa(); if (!_pkMap) await buildPkMap(); }
export { selectRipeMarkets, settleOneMarket, judgeWinDir, buildCtx, consolidateAndBuildPsState, ensureReady, TRANSIENT_RE, _umaBackoffAllowsRetryNow, scheduleUmaRejudge, UMA_REJUDGE_BACKOFF_TABLE, UMA_GENUINE_TIMEOUT_HOURS };
