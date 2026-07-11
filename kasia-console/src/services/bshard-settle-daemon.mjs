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
import { computeSettlePlan, settleMarketLive, deriveResumePlanFromEvidence } from './bshard-auto-settler.mjs';
import { consolidateAllShards } from '../lib/pool-shard-settle.mjs';
import { _shard9PhantomExcludeFor } from './bshard-close-voter.js';
import { compilePayoutShardRedeem } from '../lib/pool-shard-register.mjs';
import { fetchEndBlockHashCanonical } from './pool-market-settler-v06.mjs';
import { judgeLine } from '../lib/judgeline.mjs';
import { extractStructuredFields } from '../lib/oracle-evidence-extractors.mjs';
import { makeCtfReader } from '../lib/uma-ctf-reader.mjs';   // #20 UMA: polymarket 盘读链上 CTF 判定 (P1 binding-verified 30/30·Bettor)
import { recordShadowJudgment, registerDomainJudge } from '../lib/oracle-shadow-ledger.mjs';   // #26 自我进化: 影子台账(我们 oracle vs 权威·纯记录·永不碰结算·Owner 2026-06-30)
import { espnSportsJudge } from '../lib/nwt-espn-sports-judge.mjs';   // NWT域判v1: polymarket体育盘ESPN独立判
import { classifyFailure, shouldKeepStatus } from '../lib/bshard-failure-classifier.mjs';   // #49 模块①
import { zkCloseTick } from '../lib/zk-close-builder.mjs';   // 2026-07-06 J2: ZK settle 生产装配, 见 docs/2026-07-06-zk-close-tick-production-wiring-design.md
import { dispatchUnlockZkClose as _dispatchUnlockZkCloseImpl } from '../lib/zk-close-dispatch.mjs';   // 缺件③(J1tn 2026-07-08)
import { zkCloseTickV2, claimAutonomousTick } from '../lib/zk-autonomy-ticks.mjs';   // (b)(c) 2026-07-09 J2: 见 docs/2026-07-09-zk-autonomy-three-parts-design.md, 独立于上面旧 zkCloseTick 骨架, 各自 kill switch
import { randomUUID } from 'crypto';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
// 同 zk-prove-worker.mjs 完全一致的 isolated zk-sdk WASM 路径(D-005 隔离铁律: ZK 工具链绝不碰 live kaspa-wasm,
// 独立 clone 出的 zk-sdk 构建)——gate witness 重建需要跟铸 gate 时同一份 ZkScriptBuilder API。
const ZKSDK_WASM_PATH = process.env.ZKSDK_WASM_PATH || 'D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js';
let _kaspaZkMod = null;
function kaspaZk() { if (!_kaspaZkMod) _kaspaZkMod = _require(ZKSDK_WASM_PATH); return _kaspaZkMod; }
// 跟 zk-prove-worker.mjs buildAndFundGate 用的同一个 relay 身份(铸+注资 gate 的那个 relay, 花它自己铸的
// gate UTXO 天然该用同一身份广播——不用 SETTLE_DAEMON_FEE_RELAY_ID, 那是 committee-sig 老路径的身份)。
const ZK_SETTLER_RELAY_ID = process.env.BSHARD_SETTLER_RELAY_ID || null;
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
// 2026-07-06 J2: ZK settle 生产装配 kill switch — 默认 OFF, 出意外行为可立刻关(照搬 SETTLE_DAEMON_ENABLED 模式)。
const ZK_CLOSE_TICK_ENABLED = process.env.ZK_CLOSE_TICK_ENABLED === '1';
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
  // ZK-native 首证 demo(2026-07-07，纯新增分支，不改动 polymarket/ESPN 判定路径一个字符)：
  // 区块哈希奇偶——目标 DAA score 的真实链上区块哈希最后一字节奇偶，纯链上可验证，verify-value-source
  // 最干净路径(委员直接读自家链拿哈希，零外部 API 信任面)。复用既有 chainReader.getBlockAtDaa(同
  // bshard deadline_daa 链锚机制，非新发明)。resolution_rule_spec = {target_daa: number}。
  if (market.outcome_market_source === 'blockhash_parity') {
    const spec = JSON.parse(market.resolution_rule_spec);
    const targetDaa = Number(spec.target_daa);
    if (!Number.isFinite(targetDaa) || targetDaa <= 0) throw new Error(`blockhash_parity: invalid target_daa in resolution_rule_spec`);
    const cur = await chainReader.getCurrentDaaScore();
    if (cur < targetDaa) throw new Error(`blockhash_parity judge ABSTAIN: target DAA ${targetDaa} 未到(当前 ${cur})`);
    const { hash } = await chainReader.getBlockAtDaa(targetDaa);
    const lastByte = parseInt(String(hash).slice(-2), 16);
    if (!Number.isFinite(lastByte)) throw new Error(`blockhash_parity: cannot parse last byte of hash ${String(hash).slice(0, 12)}`);
    return lastByte % 2 === 0 ? 0 : 1;   // 偶→YES(winDir0) / 奇→NO(winDir1)，跟 ESPN/polymarket 同一 value-mapping
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
    // #DB-lag自愈(2026-07-06, lv3rz/dyljb 手动马拉松式恢复后收编): getUtxos 探测每个 entry 归一成
    // {outpoint,amount} 供 autoDetectConsolidateResume 直接用(跟 landed() 的 norm 模式一致, 单源不重写).
    const probeUtxos = async (addr) => (await getUtxos(addr)).map(e => { const n = norm(e); return { outpoint: n.entry?.outpoint || n.outpoint, amount: n.entry?.amount || n.amount }; });
    const res = await consolidateAllShards({
      db: sqlite, rc: (cmd) => relayPost(FEE_RELAY_ID, cmd),
      // 🔴 修复(2026-07-10, Bettor GO·NWT+J1 低风险评估: 复用6/30已验证的D=20深度门到这条consolidate
      // 专属 landed 检查——之前是纯存在性检查(getUtxos查到就算数, 零确认深度), 对 reorg/race 没有防护。
      // 改走跟其余 landed-gated 路径(见(a)/zk-autonomy-ticks.mjs)同款 relay `check_utxo_landed` 命令,
      // minDepth=20——不是发明新机制, 是把已证有效的深度门搬进这条之前漏掉的路径。参数注意(J1 提醒):
      // 本函数签名是 landed(txid, addr)(consolidateAllShards 既有调用约定, 不改), relay 命令字段是
      // {address, txid, minDepth} ——显式映射, 不能位置直传。
      landed: async (txid, addr) => {
        for (let i = 0; i < 30; i++) {
          const j = await relayPost(FEE_RELAY_ID, { type: 'check_utxo_landed', address: addr, txid, minDepth: 20 }).catch(() => ({}));
          if (j.landed || j.found) return true;
          await sleep(3000);
        }
        return false;
      },
      p2sh: _p2shCache, logicalMarketId: marketId,
      payoutShard: { payout_redeem_hex: ps.payout_redeem_hex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
      relayAddr: feeRelayAddr(),
      transfer: async (addr, sompi) => { const t = await apiTransfer(addr, (sompi / 1e8).toFixed(8)); const tx = t.txId || t.tx_id; if (!tx) throw new Error('fee transfer fail'); await sleep(3000); return tx; },
      deadline: Number(market.deadline),
      getUtxos: probeUtxos,
    });
    [psOutpointTxid, psIdx] = res.psOutpoint.split(':'); psIdx = Number(psIdx);
    consolidatedPool = res.consolidatedPool;
    try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ? WHERE logical_market_id = ?').run(res.psOutpoint, marketId); } catch {}
    log(`${marketId.slice(-8)} consolidated ${res.consolidatedShards} shard(s) → ${res.psOutpoint} pool=${consolidatedPool}`);
  } else {
    [psOutpointTxid, psIdx] = String(ps.payout_ps_outpoint).split(':'); psIdx = Number(psIdx);
    // excludeSideLockTx(2026-07-11, Bettor #g3x7lm.2 抓漏同族点): 不接会预测出含phantom份额的假
    // consolidatedPool, 跟真实链上(已排除shard9/10)值不符。
    const { poolSompi } = getMarketBets(marketId, sqlite, _shard9PhantomExcludeFor(marketId));
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
  // 优先级排序 (J2 2026-07-05, 世界杯首场 7rztt 被 130+ polymarket 镜像盘积压堵住的案例·Bettor 拍):
  // outcome_market_source='kanet_v07'(KANet 自有盘, 如世界杯) 排最前, 同优先级内再按 deadline_daa ASC。
  // 之前纯 deadline ASC 排序会让"最老的积压盘"永远排最前——如果那些老盘本身卡在慢速 MAX_WALK 路径
  // (每个 27-30s) 或长期 UMA-pending, 新的自有盘(如世界杯)会被无限期挤到后面, 即使 MAX_PER_TICK
  // 调大也救不了(它们仍排在慢盘后面, 而 tick 内是串行处理)。KANet 自有盘数量少(个位数到几十)、
  // 用户可见、demo/展示价值高, 理应优先; polymarket 镜像盘数量大(百+)、UMA-pending 本身有自己的
  // 退避机制保护(不会被无限重试消耗每个 tick 的处理量), 排后面不影响其正确性只影响相对速度。
  // #33-③ (2026-07-06, lv3rz/k3cnf/dyljb 手动救场后收编·Bettor/NWT co-review): settled_partial_claims
  // (close_attest 已成功, settle_txid 已非空, 但 claim 循环中途因 landed()假阴性/mempool竞争/僵尸盘等
  // 原因未跑完)之前完全不在这条 WHERE 里(原来的 settle_txid IS NULL 天然把它排除了)——导致这类盘一旦
  // 卡住就永远躺在 settled_partial_claims, 需要人工重新调 settleOneMarket() 才会继续(今晚 lv3rz/k3cnf
  // 都是这样手动接力结完的, 现存 25 个盘卡在这个状态)。settleOneMarket() 内部本来就支持从这个状态正确
  // resume(见 settleMarketLive() 的 priorWinnerDetails 回放, 复用已有 close_txid 不会重跑 consolidate/
  // close_attest)——缺的只是让它被 selectRipeMarkets 选中。加一个 OR 分支, 不动原逻辑(未结盘走原路径)。
  // 🔴 反向结构隔离(2026-07-06 Bettor 推演抓出，开盘前必堵): resolution_rule_spec.zk_native===true
  // 的市场只该被 ZK 管线(scanReadyZkMarkets/zkCloseTick)处理——老 committee-sig settle 路径不认识
  // zk_native 字段，若不排除会照常把它捡进来，用 V1 attest 工具(22参 close_attest witness)去打
  // 一个实际是 PayoutShardV2(26参 close_attest)的 covenant，fail-closed 会反复失败重试(污染
  // events/浪费 tick，还可能撞 #33 类僵尸状态)。
  // ⚠ J2 实测(scratch 隔离 DB，非假设): 这条数据库里 resolution_rule_spec 不保证永远是合法 JSON——
  // 直接用 json_extract(...) IS NOT 1 在遇到畸形 JSON 的行时会让 sqlite 整条 SELECT 抛异常(不是
  // 该行返回 NULL 那么温和)，会让 selectRipeMarkets() 整体报错、结算 tick 彻底停摆——比不排除
  // zk_native 市场这个原洞严重得多。改用 json_valid() 先短路判断，非法 JSON 视为"未标记"(不排除，
  // 走原逻辑，行为不变)，只有合法 JSON 且 zk_native 字段确实是 true 时才排除。
  const rows = sqlite.prepare(`
    SELECT * FROM pool_markets
    WHERE protocol_version = 'v0.7'
      AND deadline_daa IS NOT NULL
      AND deadline_daa + ? <= ?
      AND (
        (settle_txid IS NULL AND protocol_status IN ('pending_bettors', 'verifying'))
        OR protocol_status = 'settled_partial_claims'
      )
      AND (json_valid(resolution_rule_spec) = 0 OR json_extract(resolution_rule_spec, '$.zk_native') IS NOT 1)
    ORDER BY (CASE WHEN outcome_market_source = 'kanet_v07' THEN 0 ELSE 1 END) ASC, deadline_daa ASC
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

// 2026-07-06 J2: ZK-eligible 市场选择 — 全新专属 protocol_status='zk_ready' 值, 跟上面
// selectRipeMarkets() 的选择条件(pending_bettors/verifying/settled_partial_claims)字符串层面
// 互斥, 结构性隔离(非逻辑判断)。见 docs/2026-07-06-zk-close-tick-production-wiring-design.md §1。
// 市场要进这条路径必须被显式标记 zk_ready(不自动推断/不继承其他状态) — 标记动作是独立的、
// 后续才做的运维/判定步骤, 不在本次范围内。
async function scanReadyZkMarkets() {
  return sqlite.prepare("SELECT * FROM pool_markets WHERE protocol_status = 'zk_ready'").all();
}

// 2026-07-06 J2: zkCloseTick ctx — B1/B2/C1 命门 hook(见 zk-close-builder.mjs 顶部注释)。
// ⚠ 范围(2026-07-06 J2, NWT/Bettor 二次确认 GREEN, 见频道 15:47-15:49 讨论): 今晚发现 phase1
// (oracle_attest_verdict 委员 attest 机制) 在代码库里完全不存在(只有设计注释) —— fetchCloseZkContinuation
// 因此不可能有"真实 phase1 产出"可 fetch, 只能读 market.metadata.zk_continuation 这个**手动模拟**字段
// (跟今晚一路的手法一致: 手动构造 covenant/gate, 不是走真实committee attest流程)。同样, CloseZk covenant
// (_j2_closezk_repro3.sil) 只有 zk_close 一个 entrypoint, 没有退款路径 —— escapeRefund 需要新设计一个
// ZK 版退款 entrypoint(独立于现有 committee-sig 的 cancel_attest, 两个 covenant 不同 entrypoint 集合),
// 今晚仍是 stub。dispatchUnlockZkClose 是 J1 域的 relay handler(未落码, 真实碰钱 broadcast, 留给下个
// clean session)。checkLanded/reconcile 是纯读写(查 UTXO / 写 DB), 今晚真实实现。
const _zkCloseCtx = {
  scanReadyZkMarkets,
  // 手动模拟(非真实 phase1): 读 market.metadata.zk_continuation(测试时手动写入该字段模拟"phase1 已产出"),
  // 格式 { outpoint: {txid, index}, redeemHex, valueSompi }。真实市场没这个字段 → 返回 null(zkClosePhase2
  // 会 skip, 不会往下走)。
  fetchCloseZkContinuation: async (market) => {
    let meta = {}; try { meta = JSON.parse(market.metadata || '{}'); } catch {}
    return meta.zk_continuation || null;
  },
  // 缺件③落地(J1tn 2026-07-08): 真实实现搬进 zk-close-dispatch.mjs(独立可单测, mock ctx 覆盖全部
  // fail-closed 分支), 这里只做 ctx 绑定(getMarket/getDoneJob 用真实 sqlite, kaspaZk 用同 zk-prove-worker.mjs
  // 一致的 isolated zk-sdk WASM, relayCall 走本文件既有 relayPost 惯例)。
  dispatchUnlockZkClose: async (args) => {
    if (!ZK_SETTLER_RELAY_ID) return { ok: false, error: 'BSHARD_SETTLER_RELAY_ID unset — 无法广播 zk_close' };
    return _dispatchUnlockZkCloseImpl(args, {
      getMarket: (marketId) => sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId),
      getDoneJob: (marketId) => sqlite.prepare("SELECT receipt_hex FROM zk_prove_jobs WHERE market_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1").get(marketId),
      kaspaZk,
      relayCall: (cmd) => relayPost(ZK_SETTLER_RELAY_ID, cmd),
    });
  },
  // 真实实现: 查目标 UTXO 是否存在(landed = 有对应 UTXO, 复用今晚反复验证过的 rpc.getUtxosByAddresses 模式)。
  checkLanded: async (txid) => {
    try {
      await rpcEnsure();
      const k = await kaspa();
      // txid 本身不是地址, 无法直接按地址查 —— 用 kaspa_tx_log(今晚一路验证落链的标准做法, 见
      // reference-chain-verify-via-relay-check-utxo-landed) 判定这笔 tx 是否已被节点索引确认。
      const row = sqlite.prepare('SELECT tx_id FROM kaspa_tx_log WHERE tx_id = ?').get(txid);
      return !!row;
    } catch (e) { log(`checkLanded(${String(txid).slice(0,12)}) error: ${e.message}`); return false; }
  },
  escapeRefund: async () => { throw new Error('TODO: escapeRefund 未实现(ZK covenant 退款 entrypoint 未设计, 下一步独立工作)'); },
  // 真实实现: LAND 后才调(zkClosePhase2 保证), 写 closed=2 状态语义 + settle_evidence, 复用现有
  // writeback 惯例(见上面 settleOneMarket 里同款模式), 用独立的 protocol_status 值(zk_settled)
  // 保持跟 committee-sig 路径的 completed/settled_partial_claims 语义区分, 不冲突。
  reconcile: async (market, { txid, winner, betsRoot }) => {
    let meta = {}; try { meta = JSON.parse(market.metadata || '{}'); } catch {}
    meta.zk_settle_evidence = { settled_by: 'zkCloseTick', close_txid: txid, attested_winner: winner, bets_root: betsRoot, chain_settled: true, settled_at: new Date().toISOString() };
    sqlite.prepare("UPDATE pool_markets SET protocol_status = 'zk_settled', settle_txid = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(txid, JSON.stringify(meta), market.id);
  },
};

function _writeZkCloseTickErrorEvent(message) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'zk_close_tick_error', 'bshard-settle-daemon', 'warn', ?, ?, datetime('now'))
    `).run(randomUUID(), `zkCloseTick error (不影响 committee-sig 结算路径): ${message}`, JSON.stringify({ message }));
  } catch (e) { log(`events insert fail for zkCloseTick error (non-fatal): ${e.message}`); }
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
  // resume-fix (2026-07-11, docs/2026-07-11-backlog-markets-resume-fix-and-cleanup-design.md §1):
  // 已 attest 过的市场(metadata.settle_evidence.close_txid 存在)优先用 deriveResumePlanFromEvidence
  // (零 judgeWinDir/committee VRF/getBlockAtDaa)——这个 pre-flight 只是为了 winners≤1024 gate, 不需要
  // computeSettlePlan 完整重新 judge+选委员那一套(settleMarketLive 自己下游也会走同一份 resume-aware
  // 逻辑)。fail-closed: derive 不 ok 就回退 computeSettlePlan, 原样撞 MAX_WALK 是可见失败, 不是"将就用"。
  let plan;
  try {
    let priorMeta = {}; try { priorMeta = JSON.parse(market.metadata || '{}'); } catch {}
    plan = priorMeta.settle_evidence?.close_txid ? deriveResumePlanFromEvidence(marketId, ctx) : { ok: false };
    if (!plan.ok) plan = await computeSettlePlan(marketId, ctx);
  } catch (e) {
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

    // 2026-07-06 J2: ZK settle tick — 独立于下面的 committee-sig ripe 处理, 必须放在
    // "if (ripe.length === 0) return" 早退**之前**(否则 committee-sig 市场为 0 时这条新路径永远
    // 跑不到, 见 docs/2026-07-06-zk-close-tick-production-wiring-design.md §4.1 隔离性验证)。
    // 独立 try-catch: ZK 路径出错既不静默吞掉(写 events 表, Bettor 要求①)也不影响下面
    // committee-sig 的 ripe 处理循环。kill switch(ZK_CLOSE_TICK_ENABLED, Bettor 要求②)默认 OFF。
    if (ZK_CLOSE_TICK_ENABLED) {
      try { await zkCloseTick(_zkCloseCtx); }
      catch (e) { log(`zkCloseTick error(不影响 committee-sig 路径): ${e.message}`); _writeZkCloseTickErrorEvent(e.message); }
    }

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

// ── (b)(c) 2026-07-09 J2: zkCloseTickV2 / claimAutonomousTick cron 装配 ──
// docs/2026-07-09-zk-autonomy-three-parts-design.md — 各自独立 kill switch(默认 OFF, Bettor 注4: 开关=配置
// 变更, 走重启窗+ledger记账+Bettor/NWT双签, 不是普通代码合并)、独立 timer(跟 T2b 卡2 bshardCloseSubmitV2Tick
// 同款风格, 不塞进 settleDaemonTick——两条新 tick 跟 committee-sig ripe 处理/旧 zkCloseTick 骨架完全独立)。
const ZK_CLOSE_TICK_V2_ENABLED = process.env.ZK_CLOSE_TICK_V2_ENABLED === '1';
const ZK_CLAIM_TICK_ENABLED = process.env.ZK_CLAIM_TICK_ENABLED === '1';
const ZK_CLOSE_TICK_V2_MS = parseInt(process.env.ZK_CLOSE_TICK_V2_MS, 10) || 30000;
const ZK_CLAIM_TICK_MS = parseInt(process.env.ZK_CLAIM_TICK_MS, 10) || 30000;

async function _checkLandedViaRelay(address, txid, minDepth = 20) {
  if (!address || !txid) return false;
  for (let i = 0; i < 30; i++) {
    try {
      const j = await relayPost(ZK_SETTLER_RELAY_ID, { type: 'check_utxo_landed', address, txid, minDepth });
      if (j.landed || j.found) return true;
    } catch { /* transient, retry */ }
    await sleep(3000);
  }
  return false;
}

function _zkCloseTickV2Ctx() {
  return {
    dispatchUnlockZkClose: async (args) => {
      if (!ZK_SETTLER_RELAY_ID) return { ok: false, error: 'BSHARD_SETTLER_RELAY_ID unset — 无法广播 zk_close' };
      return _dispatchUnlockZkCloseImpl(args, {
        getMarket: (marketId) => sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId),
        getDoneJob: (marketId) => sqlite.prepare("SELECT receipt_hex FROM zk_prove_jobs WHERE market_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1").get(marketId),
        kaspaZk,
        relayCall: (cmd) => relayPost(ZK_SETTLER_RELAY_ID, cmd),
      });
    },
    checkLanded: _checkLandedViaRelay,
  };
}

function _claimAutonomousCtx() {
  return {
    relayCall: (cmd) => relayPost(ZK_SETTLER_RELAY_ID, cmd),
    checkLanded: _checkLandedViaRelay,
    mintFeeUtxo,
    p2shAddr,
    p2pkAddr,
  };
}

let _zkCloseV2Timer = null;
export function startZkCloseTickV2Cron() {
  if (!ZK_CLOSE_TICK_V2_ENABLED) { log('zkCloseTickV2 disabled (ZK_CLOSE_TICK_V2_ENABLED!=1)·not starting'); return; }
  if (_zkCloseV2Timer) return;
  if (!ZK_SETTLER_RELAY_ID) { log('zkCloseTickV2 NOT starting — BSHARD_SETTLER_RELAY_ID unset'); return; }
  log(`zkCloseTickV2 starting·tick=${ZK_CLOSE_TICK_V2_MS}ms`);
  _zkCloseV2Timer = setInterval(() => { zkCloseTickV2(_zkCloseTickV2Ctx()).catch(e => log(`zkCloseTickV2 uncaught: ${e.message}`)); }, ZK_CLOSE_TICK_V2_MS);
}
export function stopZkCloseTickV2Cron() { if (_zkCloseV2Timer) { clearInterval(_zkCloseV2Timer); _zkCloseV2Timer = null; } }

let _claimTickTimer = null;
export function startClaimAutonomousTickCron() {
  if (!ZK_CLAIM_TICK_ENABLED) { log('claimAutonomousTick disabled (ZK_CLAIM_TICK_ENABLED!=1)·not starting'); return; }
  if (_claimTickTimer) return;
  if (!ZK_SETTLER_RELAY_ID) { log('claimAutonomousTick NOT starting — BSHARD_SETTLER_RELAY_ID unset'); return; }
  log(`claimAutonomousTick starting·tick=${ZK_CLAIM_TICK_MS}ms`);
  _claimTickTimer = setInterval(() => { claimAutonomousTick(_claimAutonomousCtx()).catch(e => log(`claimAutonomousTick uncaught: ${e.message}`)); }, ZK_CLAIM_TICK_MS);
}
export function stopClaimAutonomousTickCron() { if (_claimTickTimer) { clearInterval(_claimTickTimer); _claimTickTimer = null; } }

export { selectRipeMarkets, settleOneMarket, judgeWinDir, buildCtx, consolidateAndBuildPsState, ensureReady, TRANSIENT_RE, _umaBackoffAllowsRetryNow, scheduleUmaRejudge, UMA_REJUDGE_BACKOFF_TABLE, UMA_GENUINE_TIMEOUT_HOURS };
