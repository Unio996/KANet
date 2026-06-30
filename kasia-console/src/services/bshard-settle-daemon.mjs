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
      ripe.push({ market: m, betCount, multiShard });
      if (ripe.length >= limit) break;
    } catch (e) { log(`ripe-scan skip ${m.id.slice(-8)}: ${e.message}`); }
  }
  return ripe;
}

// per-market: consolidate (if needed) → settle → writeback。failure → settle_failed flag。
async function settleOneMarket(marketId) {
  _k = await kaspa();   // ensure kaspa-wasm loaded before sync p2sh/p2pk helpers (direct-call + tick safety)
  if (!_pkMap) await buildPkMap();   // ensure committee pk→relay map (direct-call safety; tick also builds it)
  const ctx = buildCtx();
  const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);
  if (!ps) { ctx.alert(marketId, 'no payout_shards row'); return { ok: false, reason: 'no PS' }; }

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

  // 1. consolidate 状态判定: shards 任一 sealed/open = 未 consolidate。
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
    // 持久化 consolidated outpoint (resume·writeback)
    try { sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ? WHERE logical_market_id = ?').run(res.psOutpoint, marketId); } catch {}
    log(`${marketId.slice(-8)} consolidated ${res.consolidatedShards} shard(s) → ${res.psOutpoint} pool=${consolidatedPool}`);
  } else {
    // 已 consolidate (resume): payout_ps_outpoint = folded·pool = poolSompi + seed
    [psOutpointTxid, psIdx] = String(ps.payout_ps_outpoint).split(':'); psIdx = Number(psIdx);
    const { poolSompi } = getMarketBets(marketId, sqlite);
    consolidatedPool = (BigInt(poolSompi) + BigInt(PS_SEED_SOMPI)).toString();
    log(`${marketId.slice(-8)} already consolidated → ${ps.payout_ps_outpoint} pool=${consolidatedPool}`);
  }

  // 2. psState (closed=0 redeem) for settleMarketLive
  const redeem0 = compilePayoutShardRedeem({ poolMerkleRoot: ps.pool_merkle_root, predicateCommit: ps.predicate_commit, consolidatedPool, closed: 0 });
  const psState = { outpointTxid: psOutpointTxid, index: psIdx, redeem_hex: redeem0, consolidatedPool, poolMerkleRoot: ps.pool_merkle_root, predicateCommit: ps.predicate_commit };

  // 3. settle (close + threaded claim·已证)
  const ctx2 = { ...ctx, psState: () => psState };
  const r = await settleMarketLive(marketId, ctx2);
  if (!r.ok || !r.closeTxid) { ctx.alert(marketId, `settle fail: ${r.reason || 'no closeTxid'}`); return { ok: false, reason: r.reason, closeTxid: r.closeTxid }; }

  // 4. writeback (task#17·status + settle_txid + settle_evidence)
  try {
    const claims = (r.claims || []).filter(c => c.txId);
    const evidence = { settled_by: 'bshard-settle-daemon', close_txid: r.closeTxid, payout_root: r.plan?.payoutRoot, winners: claims.length, claim_txids: claims.map(c => c.txId), chain_settled: true, settled_at: new Date().toISOString() };
    let meta = {}; try { meta = JSON.parse(market.metadata || '{}'); } catch {}
    meta.settle_evidence = evidence;
    sqlite.transaction(() => {
      sqlite.prepare("UPDATE pool_markets SET protocol_status = 'completed', settle_txid = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(r.closeTxid, JSON.stringify(meta), marketId);
      sqlite.prepare("UPDATE market_shards SET status = 'settled' WHERE logical_market_id = ?").run(marketId);
    })();
  } catch (e) { log(`${marketId.slice(-8)} writeback warn: ${e.message} (on-chain settle is truth)`); }
  log(`✅ ${marketId.slice(-8)} SETTLED close=${r.closeTxid.slice(0, 12)} winners=${(r.claims || []).filter(c => c.txId).length}`);

  // 📒 影子台账 (#26 自我进化·J1·Owner 2026-06-30): 记"我们 oracle 独立判定 vs 权威判定(plan.winDir·已结钱)"。
  //   🔴 BETTOR 守门铁律1: **纯记录·永不碰结算**——settle 已完成(上方 writeback)·本块吞所有错·绝不阻断 return。
  //   plan.winDir = computeSettlePlan 实际用于结算的权威判定(polymarket→UMA / ESPN→judgeLine)·复用不重判。
  //   our_oracle 当前多为 NULL(领域判 registry 空=路线图)·NWT 滚动 registerDomainJudge 后真对比 materialize。
  //   🟡 J2 forward-looking 守门: **fire-and-forget·不在 settle 路 await**——即便 NWT 域判做慢/挂的网络调用,
  //   也零拖延结算(record 内部 per-judge timeout 8s 兜底)。把"shadow 永不碰结算"延伸到"永不拖时延"。
  if (plan.winDir === 0 || plan.winDir === 1) {
    recordShadowJudgment(sqlite, { market, authorityWinDir: plan.winDir, settleTxid: r.closeTxid })
      .then((s) => { if (s.recorded) log(`📒 shadow ${marketId.slice(-8)}: ${s.agree == null ? '∅无独立源(路线图)' : s.agree ? '✓我方一致' : '✗我方分歧'}${s.reason ? ' · ' + s.reason : ''}`); })
      .catch((e) => log(`📒 shadow ${marketId.slice(-8)} skip (不影响结算): ${String(e?.message || e).slice(0, 80)}`));   // 内部已永不throw·belt-and-suspenders
  }

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
          const flag = r.needsRolling ? 'needs_rolling' : 'settle_failed';   // needs_rolling=>1024·待 task#18·非错
          try { sqlite.prepare('UPDATE pool_markets SET protocol_status = ? WHERE id = ?').run(flag, market.id); } catch {}
          log(`🔴 ${market.id.slice(-8)} → ${flag} (operator review): ${r.reason}`);
        }
      } catch (e) {
        log(`🔴 ${market.id.slice(-8)} settle threw: ${e.message}`);
        try { sqlite.prepare("UPDATE pool_markets SET protocol_status = 'settle_failed' WHERE id = ?").run(market.id); } catch {}
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
export { selectRipeMarkets, settleOneMarket };
