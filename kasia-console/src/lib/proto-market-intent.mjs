// proto-market-intent.mjs — 原型 v0 market_genesis(单步, ShardLeaf_direct genesis)的
// NO-TX-NO-STATE 状态机(J2, 账本1423批准落码计划+账本1425硬条件①)。
//
// market_genesis 不进 proto_bet_intents(该表 FK 是 bet_id, 市场创世没有 bet 行)——照抄
// proto-bet-intent.mjs 的哲学(pending→prepared→submitted→landed/ambiguous, F2-R 不重建不 abandon),
// 但状态机直接落在 proto_markets.status + genesis_* 六个回执列上, 不是独立表——因为这是单步动作
// (没有 A/B 两步链式依赖, 不需要 depends_on)。
//
// 不变量(同 proto-bet-intent.mjs §设计, 单步场景):
//   I1 submit accepted ≠ chain landed —— submitted 只是"relay 回报已提交", landed 由
//      checkMarketGenesisLanded(minDepth) 单独判。
//   I5 重试不得双铸 —— attempt ≥ 2 的唯一前置 = 查 relay 侧权威源(mempool/utxo-landed/同字节重播),
//      永不读调用方自己的 metadata。
//   F2-R 重启捡回 —— genesis_prepared 态只允许同字节重播; 有 txid 无字节 ⇒ 不发不建 + 告警。
//   (1102) F2-R 同一套规则: ambiguous(此处 = genesis_ambiguous)不 abandon、不重建, 终态只能人工清。
//
// 🔴 M0a 门: 本文件不 import relay-manager——调用方把 sendCommandAsync 以 sendCmd 注入,
//   全部向量离线可测。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { PROTO_COVENANT_BROADCAST_TYPE } from './proto-relay-guard.mjs';

export const MARKET_GENESIS_STATUS = Object.freeze({
  PENDING: 'genesis_pending', PREPARED: 'genesis_prepared', SUBMITTED: 'genesis_submitted',
  LANDED: 'betting', AMBIGUOUS: 'genesis_ambiguous',
});
const RANK = { genesis_pending: 0, genesis_prepared: 1, genesis_submitted: 2, betting: 3, genesis_ambiguous: 9 };

const nowIso = () => new Date().toISOString();

/** 幂等键: 'genesis:<market_id>'; attempt ≥ 2 加后缀 '#n'(同 betIntentKeyFor 手法)。 */
export function marketIntentKeyFor(marketId, attempt = 1) {
  if (!marketId) throw new Error('marketIntentKeyFor: marketId required');
  return attempt > 1 ? `genesis:${marketId}#${attempt}` : `genesis:${marketId}`;
}

/** 从 intent_key 反解 marketId(去掉 'genesis:' 前缀与可能的 '#n' 重试后缀)。 */
export function marketIdFromIntentKey(intentKey) {
  const m = /^genesis:(.+?)(?:#\d+)?$/.exec(intentKey || '');
  return m ? m[1] : null;
}

export function getMarketRow(marketId) {
  return sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(marketId) || null;
}

/**
 * INSERT 一行 genesis_pending(必须在任何 IPC 之前, 硬条件①)。已有则原样返回(幂等, INSERT OR IGNORE
 * 语义靠调用方保证 marketId 唯一/由 randomUUID 生成——proto_markets.id 是 PRIMARY KEY, 重复 INSERT
 * 会因主键冲突失败, 这里改用"先查后建"避免主键冲突异常, 效果等价 INSERT OR IGNORE)。
 * @param {object} o 除 id/status/created_at/updated_at 外的全部 proto_markets 列
 * @returns {object} 落表后的行
 */
export function ensureMarketPending(o) {
  const existing = getMarketRow(o.id);
  if (existing) return existing;
  const ts = nowIso();
  sqlite.prepare(`
    INSERT INTO proto_markets
      (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json,
       committee_privkey_enc, rootclose_tmpl_hash, shardleaf_own_redeem_len, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'genesis_pending', ?, ?)
  `).run(o.id, o.token_def_id, o.question ?? null, o.deadline_ms, o.min_bet, o.seal_count ?? 2,
    o.committee_pubkeys_json, o.committee_privkey_enc, o.rootclose_tmpl_hash, o.shardleaf_own_redeem_len ?? null, ts, ts);
  return getMarketRow(o.id);
}

/** 只改给定列; status 单调(不允许从 submitted/landed(betting) 退回更早态), genesis_ambiguous 是终态只能人工清。 */
export function markMarketStatus(marketId, patch) {
  const cur = getMarketRow(marketId);
  if (!cur) throw new Error(`markMarketStatus: market ${marketId} not found`);
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'status') {
      if (cur.status === 'genesis_ambiguous') continue;                 // 终态, 只能人工清
      if (RANK[v] === undefined || RANK[cur.status] === undefined) { cols.push('status = ?'); vals.push(v); continue; }
      if (RANK[v] < RANK[cur.status]) continue;                          // 单调
    }
    cols.push(`${k} = ?`); vals.push(v === undefined ? null : v);
  }
  if (!cols.length) return cur;
  cols.push('updated_at = ?'); vals.push(nowIso());
  vals.push(marketId);
  sqlite.prepare(`UPDATE proto_markets SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  return getMarketRow(marketId);
}

/**
 * relay 侧 HTTP 回执落表(同 recordBetIntentPhase 语义): prepared 在广播前写, submitted 在广播后写。
 * @param {string} [o.shardLeafCovId]  仅 phase='prepared' 时用——genesis 交易 input[0] outpoint 决定的
 *   covenant_id(账本1429/1431批准, 与 genesis_prepared_txid 同一时点写入)。一次性事实, 写入后不再变
 *   (F2-R 规则: genesis 进 ambiguous 后不重建; 若未来任何路径真的重建了 genesis 交易, 必须同时重写
 *   这一列, 否则 checkMarketGenesisLanded 的落链校验会永远比对失败)。
 */
export function recordMarketIntentPhase({ intentKey, phase, txid, txJson = null, shardLeafCovId = null }) {
  const marketId = marketIdFromIntentKey(intentKey);
  if (!marketId) return { ok: false, error: `not a market_genesis intent_key: ${intentKey}` };
  const cur = getMarketRow(marketId);
  if (!cur) return { ok: false, error: `unknown market ${marketId}` };
  if (!txid) return { ok: false, error: 'txid required' };
  if (phase === 'prepared') {
    const patch = { genesis_prepared_txid: txid };
    if (txJson) patch.genesis_prepared_tx_json = typeof txJson === 'string' ? txJson : JSON.stringify(txJson);
    if (shardLeafCovId) patch.shardleaf_cov_id = shardLeafCovId;
    if (cur.status === 'genesis_pending') patch.status = 'genesis_prepared';
    return { ok: true, market: markMarketStatus(marketId, patch) };
  }
  if (phase === 'submitted') {
    const patch = { status: 'genesis_submitted', genesis_submitted_txid: txid };
    if (!cur.genesis_prepared_txid) patch.genesis_prepared_txid = txid;
    return { ok: true, market: markMarketStatus(marketId, patch) };
  }
  return { ok: false, error: `unknown phase ${phase}` };
}

export function alertMarketIntent(eventType, summary, payload = {}, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'proto-market-intent', ?, ?, ?, ?)
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload), nowIso());
  } catch (e) {
    console.warn(`[proto-market-intent] events INSERT err: ${e.message}`);
  }
}

class MarketIntentHoldError extends Error {
  constructor(msg, code) { super(msg); this.code = code; this.hold = true; }
}

/**
 * genesis_prepared 行的唯一处理路径(同 proto-bet-intent.mjs resolvePrepared, 移植去掉链式依赖部分):
 *   ① get_mempool_entry(prepared_txid) 有 ⇒ submitted, 不重发
 *   ② check_utxo_landed(target, prepared_txid, 0) 落了 ⇒ submitted, 不重发
 *   ③ 无字节 ⇒ 不发不建, 告警, hold
 *   ④ 同字节重播: relay 断言 txid == prepared_txid
 *        ok ⇒ submitted; code inputs_spent ⇒ 查 kaspa_tx_log 正向证据, 有则 submitted, 无则
 *        genesis_ambiguous/hold; 其他 ⇒ throw
 */
async function resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log }) {
  const marketId = row.id, txid = row.genesis_prepared_txid;
  let mem;
  try { mem = await sendCmd(relayId, { type: 'get_mempool_entry', txid }, 10000, origin); }
  catch (e) { throw new Error(`market genesis ${marketId}: mempool query failed (${e.message}) — unknown state, not resending`); }
  if (mem?.found) {
    log.log(`[proto-market-intent] genesis:${marketId} prepared txid ${txid.slice(0, 12)} already in mempool → submitted (no resend)`);
    return { txId: txid, market: markMarketStatus(marketId, { status: 'genesis_submitted', genesis_submitted_txid: txid }) };
  }
  let landed;
  try { landed = await sendCmd(relayId, { type: 'check_utxo_landed', address: targetAddress, txid, minDepth: 0 }, 10000, origin); }
  catch (e) { throw new Error(`market genesis ${marketId}: landed query failed (${e.message}) — unknown state, not resending`); }
  if (landed?.landed) {
    log.log(`[proto-market-intent] genesis:${marketId} prepared txid ${txid.slice(0, 12)} already landed → submitted (no resend)`);
    return { txId: txid, market: markMarketStatus(marketId, { status: 'genesis_submitted', genesis_submitted_txid: txid }) };
  }
  if (!row.genesis_prepared_tx_json) {
    alertMarketIntent('market_genesis_prepared_without_bytes', `market genesis ${marketId} prepared txid ${txid.slice(0, 12)} has no signed bytes — manual review`, { market_id: marketId, prepared_txid: txid });
    throw new MarketIntentHoldError(`market genesis ${marketId}: prepared without bytes — hold (no resend, no rebuild)`, 'prepared_without_bytes');
  }
  let rep;
  try {
    rep = await sendCmd(relayId, {
      type: PROTO_COVENANT_BROADCAST_TYPE, intent_key: marketIntentKeyFor(marketId), replay_tx_json: row.genesis_prepared_tx_json, prepared_txid: txid,
    }, undefined, origin);
  } catch (e) { throw new Error(`market genesis ${marketId}: replay IPC failed (${e.message})`); }
  if (rep?.txId) {
    if (rep.txId !== txid) {
      alertMarketIntent('market_genesis_replay_txid_mismatch', `market genesis ${marketId} replay returned ${String(rep.txId).slice(0, 12)} != prepared ${txid.slice(0, 12)}`, { market_id: marketId, prepared_txid: txid, returned: rep.txId });
      throw new MarketIntentHoldError(`market genesis ${marketId}: replay txid mismatch — hold`, 'replay_txid_mismatch');
    }
    log.log(`[proto-market-intent] genesis:${marketId} replayed same bytes txid ${txid.slice(0, 12)} → submitted`);
    return { txId: txid, replayed: true, market: markMarketStatus(marketId, { status: 'genesis_submitted', genesis_submitted_txid: txid }) };
  }
  if (rep?.code === 'inputs_spent') {
    let positiveLanded = false;
    try {
      positiveLanded = !!sqlite.prepare('SELECT 1 FROM kaspa_tx_log WHERE tx_id = ?').get(txid);
    } catch (e) { log.log(`[proto-market-intent] genesis:${marketId} kaspa_tx_log positive-evidence lookup err: ${e.message}`); }
    if (positiveLanded) {
      log.log(`[proto-market-intent] genesis:${marketId} inputs_spent but kaspa_tx_log has positive landing evidence for ${txid.slice(0, 12)} → submitted (no rebuild)`);
      return { txId: txid, market: markMarketStatus(marketId, { status: 'genesis_submitted', genesis_submitted_txid: txid }) };
    }
    markMarketStatus(marketId, { status: 'genesis_ambiguous', genesis_last_error: rep.error || 'inputs_spent (no positive evidence either way)' });
    alertMarketIntent('market_genesis_ambiguous_inputs_spent', `market genesis ${marketId} inputs spent, no positive evidence of conflicting spender — HOLD, no rebuild, no abandon`, { market_id: marketId, prepared_txid: txid }, 'error');
    throw new MarketIntentHoldError(`market genesis ${marketId}: inputs spent, ambiguous — HOLD (manual review)`, 'ambiguous_inputs_spent');
  }
  throw new Error(`market genesis ${marketId}: replay failed: ${rep?.error || 'no txId'}`);
}

/**
 * 唯一入口。调用方负责真正构造+签名交易字节(ShardLeaf_direct genesis P2SH 输出), 通过
 * buildAndBroadcast({attempt}) 回调提供——本函数只管状态机, 不碰 kaspa-wasm。
 * @param {object} o
 * @param {Function} o.sendCmd  注入 relay-manager.sendCommandAsync(relayId, cmd, timeout, origin)
 * @param {string} o.relayId
 * @param {string} o.marketId
 * @param {string} o.targetAddress  landed 判据用的地址(genesis ShardLeaf_direct 输出的 P2SH bech32 地址)
 * @param {Function} o.buildAndBroadcast  async ({attempt}) => {txId} | throws
 * @param {number} [o.maxAttempts]
 * @returns {Promise<{txId, market, reused?, replayed?}>}
 */
export async function driveMarketGenesis({
  sendCmd, relayId, marketId, targetAddress, buildAndBroadcast, origin,
  maxAttempts = 3, sleepMs = (attempt) => attempt * 5000, log = console,
}) {
  if (typeof sendCmd !== 'function') throw new Error('driveMarketGenesis: sendCmd required');
  if (!relayId) throw new Error('driveMarketGenesis: relayId required');
  if (typeof buildAndBroadcast !== 'function') throw new Error('driveMarketGenesis: buildAndBroadcast required');
  let row = getMarketRow(marketId);
  if (!row) throw new Error(`driveMarketGenesis: market ${marketId} not found — ensureMarketPending must be called before driving (硬条件①: pending 行必须先于任何 IPC 存在)`);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    row = getMarketRow(marketId);
    if (row.status === 'genesis_submitted' || row.status === 'betting') {
      return { txId: row.genesis_submitted_txid, market: row, reused: true };
    }
    if (row.status === 'genesis_ambiguous') {
      throw new MarketIntentHoldError(`market genesis ${marketId}: ambiguous — HOLD, manual review required, will not auto-retry`, 'ambiguous_inputs_spent');
    }
    if (row.status === 'genesis_prepared') {
      const r = await resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log });
      if (r.txId) return { txId: r.txId, market: r.market, replayed: !!r.replayed };
      row = r.market;
      continue;
    }
    // genesis_pending ⇒ fresh build+broadcast; buildAndBroadcast 内部应当在广播前调 recordMarketIntentPhase(prepared)。
    try {
      const res = await buildAndBroadcast({ attempt });
      if (res?.txId) {
        const market = markMarketStatus(marketId, { status: 'genesis_submitted', genesis_submitted_txid: res.txId, genesis_prepared_txid: row.genesis_prepared_txid || res.txId, genesis_last_error: null });
        return { txId: res.txId, market };
      }
      lastError = res?.error || 'buildAndBroadcast returned no txId';
    } catch (e) {
      lastError = e.message;
    }
    markMarketStatus(marketId, { genesis_last_error: String(lastError).slice(0, 500) });
    log.log(`[proto-market-intent] genesis:${marketId} attempt ${attempt}/${maxAttempts} fail: ${lastError}`);
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, sleepMs(attempt)));
  }
  throw new Error(`market genesis ${marketId} exhausted ${maxAttempts} attempts: ${lastError}`);
}

/**
 * landed 门: check_utxo_landed(target, submitted_txid, minDepth). landed ⇒ 先做 fail-closed 落链
 * 校验(账本1429/1431): 从**实际落链交易**重算 shardleaf_cov_id, 与 prepared 阶段存的值比对, 不一致
 * ⇒ genesis_ambiguous + 告警, 不推进到可下注状态(同 (1102) F2-R 规则: ambiguous 终态只能人工清,
 * 不自动重建)。
 * @param {object} o
 * @param {*} [o.kaspa]  kaspa-wasm 模块(校验 shardleaf_cov_id 用; 不传则跳过校验——过渡期兼容, 见下)
 * @param {Function} [o.fetchLandedGenesisTx]  async (txid) => {fundingOutpoint, genesisOutput} | null
 *   ——真正从链上取"落链交易的 input[0] outpoint + genesis 输出"这一步的注入点(同 M0a 门既有手法,
 *   离线可测)。不传时退化为只做 check_utxo_landed 那一步, 不做 covenant_id 校验。
 * 🔴 状态注记(账本1444, NWT 复核 Stage 1 时撤销上面这条"待办"定性, 不是新增待办): 生产接线
 * (services/proto-driver.mjs)确实不传 kaspa/fetchLandedGenesisTx, 但原因不是"缺一个 relay IPC
 * 命令"——check_utxo_landed 核的是"与 prepared 阶段记录的同一个 txid 已落链", txid 本身就是对该笔
 * 交易全部输入(含 authorizing input 的 outpoint)的密码学承诺, 同一个 txid 落链 ⇒ 输入完全相同 ⇒
 * covenant_id(纯函数) 必然相同, 重算比对是同义反复。本函数的 kaspa/fetchLandedGenesisTx 参数仍然
 * 保留、可用(供未来若需要更强的独立校验), 只是生产路径不需要接线调用它。
 */
export async function checkMarketGenesisLanded({ sendCmd, relayId, market, targetAddress, minDepth, origin, shardleafVout = 0, kaspa = null, fetchLandedGenesisTx = null }) {
  if (!market?.genesis_submitted_txid) return { landed: false, depth: null, reason: 'not submitted' };
  if (!(Number(minDepth) > 0)) throw new Error('checkMarketGenesisLanded: minDepth > 0 required (pass REORG_SAFE_MIN_DEPTH)');
  const r = await sendCmd(relayId, { type: 'check_utxo_landed', address: targetAddress, txid: market.genesis_submitted_txid, minDepth }, 15000, origin);
  if (r?.landed) {
    if (kaspa && fetchLandedGenesisTx) {
      const landedTx = await fetchLandedGenesisTx(market.genesis_submitted_txid);
      if (!landedTx) {
        markMarketStatus(market.id, { status: 'genesis_ambiguous', genesis_last_error: 'landed but fetchLandedGenesisTx returned null — cannot verify shardleaf_cov_id' });
        alertMarketIntent('market_genesis_covid_verify_fetch_failed', `market ${market.id} genesis landed but could not fetch tx to verify shardleaf_cov_id — HOLD`, { market_id: market.id, txid: market.genesis_submitted_txid }, 'error');
        throw new MarketIntentHoldError(`market genesis ${market.id}: landed but shardleaf_cov_id verification fetch failed — HOLD`, 'covid_verify_fetch_failed');
      }
      const { verifyShardLeafCovIdAgainstLandedTx } = await import('./proto-tx-assembly.mjs');
      const v = verifyShardLeafCovIdAgainstLandedTx({
        kaspa, expectedCovId: market.shardleaf_cov_id, landedFundingOutpoint: landedTx.fundingOutpoint,
        landedGenesisOutput: landedTx.genesisOutput, genesisOutputIndex: shardleafVout,
      });
      if (!v.ok) {
        markMarketStatus(market.id, { status: 'genesis_ambiguous', genesis_last_error: v.reason });
        alertMarketIntent('market_genesis_covid_mismatch', `market ${market.id} genesis landed but recomputed covenant_id doesn't match stored shardleaf_cov_id — HOLD, no auto-advance to betting`, { market_id: market.id, txid: market.genesis_submitted_txid, expected: market.shardleaf_cov_id, actual: v.actualCovId }, 'error');
        throw new MarketIntentHoldError(`market genesis ${market.id}: shardleaf_cov_id mismatch on landed tx — HOLD (manual review)`, 'covid_mismatch');
      }
    }
    const updated = markMarketStatus(market.id, {
      status: 'betting', genesis_landed_depth: r.depth ?? null, genesis_landed_at: nowIso(),
      shardleaf_txid: market.genesis_submitted_txid, shardleaf_vout: shardleafVout,
    });
    return { landed: true, depth: r.depth ?? null, market: updated };
  }
  return { landed: false, depth: r?.depth ?? null };
}

/**
 * 重启捡回(F2-R, 同 resumeStaleBetIntents 移植): genesis_prepared 且 updated_at 早于 olderThanMs
 * 的行 → resolvePrepared。
 */
export async function resumeStaleMarketIntents({ sendCmd, targetAddressFor, relayIdFor, olderThanMs = 2 * 60 * 1000, limit = 20, origin = 'internal', log = console }) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = sqlite.prepare(`
    SELECT * FROM proto_markets WHERE status = 'genesis_prepared' AND julianday(updated_at) < julianday(?)
    ORDER BY updated_at ASC LIMIT ?
  `).all(cutoff, limit);
  const out = { scanned: rows.length, resolved: 0, held: 0, errored: 0 };
  for (const row of rows) {
    const relayId = relayIdFor(row);
    const targetAddress = targetAddressFor(row);
    if (!relayId || !targetAddress) { out.errored++; continue; }
    try {
      await resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log });
      out.resolved++;
    } catch (e) {
      if (e.hold) out.held++; else out.errored++;
      log.log(`[proto-market-intent] resume genesis:${row.id}: ${e.message}`);
    }
  }
  return out;
}
