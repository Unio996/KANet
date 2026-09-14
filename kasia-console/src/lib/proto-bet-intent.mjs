// proto-bet-intent.mjs — 原型 v0 下注复合动作(铸筹码/register_append 两步)的 NO-TX-NO-STATE 状态机。
// 设计: docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §2.3.1(NWT MUST-FIX, ledger 1336)。
//
// 照抄 lib/submit-intent.mjs 的哲学(prepared→submitted→landed 状态机、同字节重播、"查不到证据≠可以
// 重建"), 但**不复用 submit_intents 表**——proto_bet_intents(v206)多一个 `depends_on` 字段做两步链式
// 依赖(B 只能在 A 落地后才能从 pending 转 prepared), 且面向"任意签名交易"(target_address+txid, 同
// submit-intent 的 landed 判据——P2SH covenant 输出照样有 bech32 地址表示, check_utxo_landed 不区分
// 脚本类型), 不是围绕 relay `transfer` plain-address 语义硬编的形状。
//
// 不变量(同 submit-intent.mjs 设计 §2, 移植到两步链场景):
//   I1 submit accepted ≠ chain landed —— 只把"submitted"记成 submitted, landed 由 checkIntentLanded(minDepth) 单独判。
//   I5 重试不得双付/双铸 —— attempt ≥ 2 的唯一前置 = 查 relay 侧权威源(mempool/utxo-landed/同字节重播), 永不读调用方自己的 metadata。
//   F2-R 重启捡回 —— prepared 行只允许同字节重播; 有 txid 无字节 ⇒ 不发不建 + 告警。
//   🔴 两步链新增: B(append)行只能在 A(mint)行状态为 landed 时才允许从 pending 转 prepared——
//      在 A 未确认前构造/广播 B 是对着一个可能还不存在的 UTXO 花钱, 必然失败或双花风险, 直接拒绝。
//
// 🔴 M0a 门: 本文件不 import relay-manager(裸 import 差分门硬拒新通道)——调用方把 sendCommandAsync
//   以 sendCmd 注入, 全部向量离线可测。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

export const BET_INTENT_STEPS = Object.freeze(['mint', 'append']);
export const BET_INTENT_STATUS = Object.freeze({ PENDING: 'pending', PREPARED: 'prepared', SUBMITTED: 'submitted', LANDED: 'landed', AMBIGUOUS: 'ambiguous' });

const nowIso = () => new Date().toISOString();

/** 幂等键: 'proto-bet:<bet_id>:<step>'; attempt ≥ 2 加后缀 '#n'。 */
export function betIntentKeyFor(betId, step, attempt = 1) {
  if (!BET_INTENT_STEPS.includes(step)) throw new Error(`betIntentKeyFor: unknown step ${step}`);
  if (!betId) throw new Error('betIntentKeyFor: betId required');
  return attempt > 1 ? `proto-bet:${betId}:${step}#${attempt}` : `proto-bet:${betId}:${step}`;
}

export function getBetIntent(intentKey) {
  return sqlite.prepare('SELECT * FROM proto_bet_intents WHERE intent_key = ?').get(intentKey) || null;
}

/** 同一 bet 同一 step 的活跃行(非 ambiguous), attempt 最大者(按 intent_key 排序, #n 后缀天然字典序次于无后缀不可靠——改用 rowid 取最后写入的)。 */
export function activeBetIntent(betId, step) {
  return sqlite.prepare(`
    SELECT * FROM proto_bet_intents WHERE bet_id = ? AND step = ? AND status != 'ambiguous'
    ORDER BY rowid DESC LIMIT 1
  `).get(betId, step) || null;
}

/**
 * INSERT OR IGNORE 一行 pending(必须在任何 IPC 之前); 已有则原样返回(幂等)。
 * step='append' 时**必须**给 dependsOn(A 行的 intent_key)——这是链式依赖存在的唯一记录点。
 */
export function ensureBetIntent({ betId, step, dependsOn = null, attempt = 1 }) {
  if (!BET_INTENT_STEPS.includes(step)) throw new Error(`ensureBetIntent: unknown step ${step}`);
  if (!betId) throw new Error('ensureBetIntent: betId required');
  if (step === 'append' && !dependsOn) throw new Error('ensureBetIntent: append step requires dependsOn (the mint step intent_key)');
  const intentKey = betIntentKeyFor(betId, step, attempt);
  const ts = nowIso();
  sqlite.prepare(`
    INSERT OR IGNORE INTO proto_bet_intents
      (intent_key, bet_id, step, depends_on, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(intentKey, betId, step, dependsOn, ts, ts);
  return getBetIntent(intentKey);
}

/** 只改给定列; status 单调: 不允许从 submitted/landed 退回 prepared/pending。ambiguous 是终态, 只能人工清。 */
export function markBetIntent(intentKey, patch) {
  const cur = getBetIntent(intentKey);
  if (!cur) throw new Error(`markBetIntent: intent ${intentKey} not found`);
  const RANK = { pending: 0, prepared: 1, submitted: 2, landed: 3, ambiguous: 9 };
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'status') {
      if (cur.status === 'ambiguous') continue;              // 终态, 只能人工清
      if (RANK[v] < RANK[cur.status]) continue;               // 单调
    }
    cols.push(`${k} = ?`); vals.push(v === undefined ? null : v);
  }
  if (!cols.length) return cur;
  cols.push('updated_at = ?'); vals.push(nowIso());
  vals.push(intentKey);
  sqlite.prepare(`UPDATE proto_bet_intents SET ${cols.join(', ')} WHERE intent_key = ?`).run(...vals);
  return getBetIntent(intentKey);
}

/** relay 侧 HTTP 回执落表(同 submit-intent.mjs 的 recordIntentPhase 语义): prepared 在广播前写, submitted 在广播后写。 */
export function recordBetIntentPhase({ intentKey, phase, txid, txJson = null }) {
  const cur = getBetIntent(intentKey);
  if (!cur) return { ok: false, error: `unknown intent_key ${intentKey}` };
  if (!txid) return { ok: false, error: 'txid required' };
  if (phase === 'prepared') {
    const patch = { prepared_txid: txid };
    if (txJson) patch.prepared_tx_json = typeof txJson === 'string' ? txJson : JSON.stringify(txJson);
    if (cur.status === 'pending') patch.status = 'prepared';
    return { ok: true, intent: markBetIntent(intentKey, patch) };
  }
  if (phase === 'submitted') {
    const patch = { status: 'submitted', submitted_txid: txid };
    if (!cur.prepared_txid) patch.prepared_txid = txid;
    return { ok: true, intent: markBetIntent(intentKey, patch) };
  }
  return { ok: false, error: `unknown phase ${phase}` };
}

export function alertBetIntent(eventType, summary, payload = {}, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'proto-bet-intent', ?, ?, ?, ?)
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload), nowIso());
  } catch (e) {
    console.warn(`[proto-bet-intent] events INSERT err: ${e.message}`);
  }
}

class BetIntentHoldError extends Error {
  constructor(msg, code) { super(msg); this.code = code; this.hold = true; }
}

/**
 * 🔴 链式依赖闸: step='append' 的 intent 若还 pending, 必须先确认 dependsOn(mint 行) 已 landed 才允许
 * 真正发起(转 prepared/submitted)——在 mint 未确认前构造 append 就是对着可能不存在的 UTXO 花钱。
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
export function checkDependencyLanded(intent) {
  if (intent.step !== 'append') return { ok: true };
  if (!intent.depends_on) return { ok: false, reason: 'append intent missing depends_on (data integrity bug, should be impossible per ensureBetIntent guard)' };
  const dep = getBetIntent(intent.depends_on);
  if (!dep) return { ok: false, reason: `depends_on intent ${intent.depends_on} not found` };
  if (dep.status !== 'landed') return { ok: false, reason: `depends_on intent ${intent.depends_on} not landed yet (status=${dep.status})` };
  return { ok: true };
}

/**
 * prepared 行的唯一处理路径(同 submit-intent.mjs resolvePrepared 设计 F2(c)+F2-R, 移植):
 *   ① get_mempool_entry(prepared_txid) 有 ⇒ submitted, 不重发
 *   ② check_utxo_landed(target, prepared_txid, 0) 落了 ⇒ submitted, 不重发
 *   ③ 无字节 ⇒ 不发不建, 告警, hold
 *   ④ 同字节重播: relay 断言 txid == prepared_txid
 *        ok ⇒ submitted; code inputs_spent ⇒ 查 kaspa_tx_log 正向证据, 有则 submitted, 无则 ambiguous/hold; 其他 ⇒ throw
 */
async function resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log }) {
  const key = row.intent_key, txid = row.prepared_txid;
  let mem;
  try { mem = await sendCmd(relayId, { type: 'get_mempool_entry', txid }, 10000, origin); }
  catch (e) { throw new Error(`bet intent ${key}: mempool query failed (${e.message}) — unknown state, not resending`); }
  if (mem?.found) {
    log.log(`[proto-bet-intent] ${key} prepared txid ${txid.slice(0, 12)} already in mempool → submitted (no resend)`);
    return { txId: txid, intent: markBetIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  let landed;
  try { landed = await sendCmd(relayId, { type: 'check_utxo_landed', address: targetAddress, txid, minDepth: 0 }, 10000, origin); }
  catch (e) { throw new Error(`bet intent ${key}: landed query failed (${e.message}) — unknown state, not resending`); }
  if (landed?.landed) {
    log.log(`[proto-bet-intent] ${key} prepared txid ${txid.slice(0, 12)} already landed → submitted (no resend)`);
    return { txId: txid, intent: markBetIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  if (!row.prepared_tx_json) {
    alertBetIntent('bet_intent_prepared_without_bytes', `bet intent ${key} prepared txid ${txid.slice(0, 12)} has no signed bytes — manual review`, { intent_key: key, prepared_txid: txid });
    throw new BetIntentHoldError(`bet intent ${key}: prepared without bytes — hold (no resend, no rebuild)`, 'prepared_without_bytes');
  }
  // 🔴 待定(阻塞项, 见文件头 TODO): `type` 目前写的 'broadcast_raw_tx' 是占位符——kasia-relay 的
  // COMMAND_FIELD_TYPES(kasia-relay/src/lib/commands.mjs:199)里 replay_tx_json/prepared_txid/intent_key
  // 三个字段目前只挂在既有 TRANSFER 命令类型上(语义="从某地址转账"), 没有一个通用的"广播这笔我已经构造好
  // 的任意签名交易"命令类型——covenant genesis/entry-spend 交易不是 address→amount 转账, 不能直接塞进
  // TRANSFER。这是一个真正的新 relay 命令类型, 需要单独设计+NWT审+落码(kasia-relay 侧), 且与 §6 KAS
  // 资金来源(B'/(B)/(C) 三选一未决)高度耦合——两者应该一起定, 不要各自抢跑。在那笔完成前, driveBetIntent
  // 的 resolvePrepared 分支实际不可用(pending→fresh build 分支不受影响, 因为 buildAndBroadcast 由调用方
  // 注入, 调用方可以先走别的机制; 只有"prepared 态同字节重播"这条恢复路径依赖这个还不存在的命令)。
  let rep;
  try {
    rep = await sendCmd(relayId, {
      type: 'broadcast_raw_tx', intent_key: key, replay_tx_json: row.prepared_tx_json, prepared_txid: txid,
    }, undefined, origin);
  } catch (e) { throw new Error(`bet intent ${key}: replay IPC failed (${e.message})`); }
  if (rep?.txId) {
    if (rep.txId !== txid) {
      alertBetIntent('bet_intent_replay_txid_mismatch', `bet intent ${key} replay returned ${String(rep.txId).slice(0, 12)} != prepared ${txid.slice(0, 12)}`, { intent_key: key, prepared_txid: txid, returned: rep.txId });
      throw new BetIntentHoldError(`bet intent ${key}: replay txid mismatch — hold`, 'replay_txid_mismatch');
    }
    log.log(`[proto-bet-intent] ${key} replayed same bytes txid ${txid.slice(0, 12)} → submitted`);
    return { txId: txid, replayed: true, intent: markBetIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  if (rep?.code === 'inputs_spent') {
    let positiveLanded = false;
    try {
      positiveLanded = !!sqlite.prepare('SELECT 1 FROM kaspa_tx_log WHERE tx_id = ?').get(txid);
    } catch (e) { log.log(`[proto-bet-intent] ${key} kaspa_tx_log positive-evidence lookup err: ${e.message}`); }
    if (positiveLanded) {
      log.log(`[proto-bet-intent] ${key} inputs_spent but kaspa_tx_log has positive landing evidence for ${txid.slice(0, 12)} → submitted (no rebuild)`);
      return { txId: txid, intent: markBetIntent(key, { status: 'submitted', submitted_txid: txid }) };
    }
    markBetIntent(key, { status: 'ambiguous', last_error: rep.error || 'inputs_spent (no positive evidence either way)' });
    alertBetIntent('bet_intent_ambiguous_inputs_spent', `bet intent ${key} inputs spent, no positive evidence of conflicting spender — HOLD, no rebuild, no abandon`, { intent_key: key, prepared_txid: txid }, 'error');
    throw new BetIntentHoldError(`bet intent ${key}: inputs spent, ambiguous — HOLD (manual review)`, 'ambiguous_inputs_spent');
  }
  throw new Error(`bet intent ${key}: replay failed: ${rep?.error || 'no txId'}`);
}

/**
 * 两步的唯一入口(mint 与 append 各调一次)。调用方负责真正构造+签名交易字节(genesis P2SH 输出 /
 * register_append entry-spend), 通过 buildTx({attempt}) 回调提供——本函数只管状态机, 不碰 kaspa-wasm。
 * @param {object} o
 * @param {Function} o.sendCmd  注入 relay-manager.sendCommandAsync(relayId, cmd, timeout, origin)
 * @param {string} o.relayId
 * @param {string} o.betId
 * @param {'mint'|'append'} o.step
 * @param {string} [o.dependsOn]  step='append' 时必填(mint 行的 intent_key)
 * @param {string} o.targetAddress  landed 判据用的地址(genesis 输出的 P2SH bech32 地址)
 * @param {Function} o.buildAndBroadcast  async ({attempt}) => {txId, txJson} | throws —— 真正构造+签名+广播
 *   一笔新交易(pending 态才会被调用; prepared 态走同字节重播, 不再调这个)
 * @param {number} [o.maxAttempts]
 * @returns {Promise<{txId, intent, reused?, replayed?}>}
 */
export async function driveBetIntent({
  sendCmd, relayId, betId, step, dependsOn = null, targetAddress, buildAndBroadcast, origin,
  maxAttempts = 3, sleepMs = (attempt) => attempt * 5000, log = console,
}) {
  if (typeof sendCmd !== 'function') throw new Error('driveBetIntent: sendCmd required');
  if (!relayId) throw new Error('driveBetIntent: relayId required');
  if (typeof buildAndBroadcast !== 'function') throw new Error('driveBetIntent: buildAndBroadcast required');
  let row = activeBetIntent(betId, step) || ensureBetIntent({ betId, step, dependsOn });
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    row = getBetIntent(row.intent_key);
    if (row.status === 'submitted' || row.status === 'landed') {
      return { txId: row.submitted_txid, intent: row, reused: true };
    }
    if (row.status === 'ambiguous') {
      throw new BetIntentHoldError(`bet intent ${row.intent_key}: ambiguous — HOLD, manual review required, will not auto-retry`, 'ambiguous_inputs_spent');
    }
    if (row.status === 'prepared') {
      const r = await resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log });
      if (r.txId) return { txId: r.txId, intent: r.intent, replayed: !!r.replayed };
      row = r.intent;
      continue;
    }
    // pending ⇒ 链式依赖闸: append 必须等 mint landed。
    const dep = checkDependencyLanded(row);
    if (!dep.ok) {
      log.log(`[proto-bet-intent] ${row.intent_key} blocked: ${dep.reason}`);
      throw new BetIntentHoldError(`bet intent ${row.intent_key}: dependency not satisfied — ${dep.reason}`, 'dependency_not_landed');
    }
    // pending ⇒ fresh build+broadcast; buildAndBroadcast 内部应当在广播前调 recordBetIntentPhase(prepared)。
    try {
      const res = await buildAndBroadcast({ attempt, intentKey: row.intent_key });
      if (res?.txId) {
        const intent = markBetIntent(row.intent_key, { status: 'submitted', submitted_txid: res.txId, prepared_txid: row.prepared_txid || res.txId, last_error: null });
        return { txId: res.txId, intent };
      }
      lastError = res?.error || 'buildAndBroadcast returned no txId';
    } catch (e) {
      lastError = e.message;
    }
    markBetIntent(row.intent_key, { last_error: String(lastError).slice(0, 500) });
    log.log(`[proto-bet-intent] ${row.intent_key} attempt ${attempt}/${maxAttempts} fail: ${lastError}`);
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, sleepMs(attempt)));
  }
  throw new Error(`bet intent ${row.intent_key} exhausted ${maxAttempts} attempts: ${lastError}`);
}

/** landed 门: check_utxo_landed(target, submitted_txid, minDepth). landed ⇒ 行转 landed + depth。 */
export async function checkBetIntentLanded({ sendCmd, relayId, intent, targetAddress, minDepth, origin }) {
  if (!intent?.submitted_txid) return { landed: false, depth: null, reason: 'not submitted' };
  if (!(Number(minDepth) > 0)) throw new Error('checkBetIntentLanded: minDepth > 0 required (pass REORG_SAFE_MIN_DEPTH)');
  const r = await sendCmd(relayId, { type: 'check_utxo_landed', address: targetAddress, txid: intent.submitted_txid, minDepth }, 15000, origin);
  if (r?.landed) {
    markBetIntent(intent.intent_key, { status: 'landed', landed_depth: r.depth ?? null, landed_at: nowIso() });
    return { landed: true, depth: r.depth ?? null };
  }
  return { landed: false, depth: r?.depth ?? null };
}

/**
 * 重启捡回(F2-R, 同 submit-intent.mjs resumeStaleIntents 移植): prepared 且 updated_at 早于 olderThanMs
 * 的行 → resolvePrepared。调用方需提供 targetAddressFor(row) 把 intent_key 映回该步骤的 landed 判据地址
 * (mint 行 = 代币 genesis P2SH 地址; append 行 = 市场 leaf 续约 P2SH 地址——两者都是查 proto_bets/proto_markets
 * 得到, 本模块不碰这些表, 保持职责单一)。
 */
export async function resumeStaleBetIntents({ sendCmd, targetAddressFor, relayIdFor, olderThanMs = 2 * 60 * 1000, limit = 20, origin = 'internal', log = console }) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = sqlite.prepare(`
    SELECT * FROM proto_bet_intents WHERE status = 'prepared' AND julianday(updated_at) < julianday(?)
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
      log.log(`[proto-bet-intent] resume ${row.intent_key}: ${e.message}`);
    }
  }
  return out;
}
