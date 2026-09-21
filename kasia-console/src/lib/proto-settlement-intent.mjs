// proto-settlement-intent.mjs — 原型 v0 结算六步(market_seal/close_commit/convert_to_claim/
// claim_draw/withdraw/输家ticket自我回收)的 NO-TX-NO-STATE 状态机。
// 设计: docs/2026-09-16-j2-proto-v0-settlement-design-v0.1.md §2、
// docs/2026-09-16-j2-proto-v0-settlement-implementation-plan-v0.1.md v0.2 §3（Owner D-022批准，
// 账本1491，Bettor五点裁定）。
//
// 照抄 proto-bet-intent.mjs 的哲学与结构(prepared→submitted→landed、同字节重播、"查不到证据≠可以
// 重建")，但主键从"bet_id+step"泛化成"subject_type+subject_id+step"——结算六步分属三种归属
// (market: seal/resolve; claim: convert_to_claim/claim_draw/withdraw; ticket: reclaim)，
// intent_key 统一 'settle:<subject_type>:<subject_id>:<step>' 格式，供
// /ingest/proto-bet-intent-phase 端点用前缀 'settle:' 分派到本模块的 recordSettlementIntentPhase
// (同既有 'genesis:' 前缀分支同一模式，不新开 ingest 端点、不新增 relay 命令——Bettor裁定⑤)。
//
// depends_on 在本表**真实使用**(不同 proto_bet_intents D-020后删列那样)：resolve 依赖 seal，
// claim_draw 依赖 convert_to_claim，withdraw 依赖 claim_draw；seal/convert_to_claim/reclaim 无
// 依赖。依赖是否已 landed 的判断由调用方(proto-driver.mjs)在推进前查询，本模块只提供
// isDependencyLanded 这个纯查询 helper，不在这里内嵌业务触发逻辑(职责单一，同 proto-bet-intent.mjs
// 不碰 proto_bets/proto_markets 的既有边界)。
//
// 🔴 M0a 门: 本文件不 import relay-manager(裸 import 差分门硬拒新通道)——调用方把 sendCommandAsync
//   以 sendCmd 注入, 全部向量离线可测。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { PROTO_COVENANT_BROADCAST_TYPE } from './proto-relay-guard.mjs';
import { isMarketFrozen } from './proto-settlement-freeze.mjs';

export const SETTLEMENT_SUBJECT_TYPES = Object.freeze(['market', 'claim', 'ticket']);
export const SETTLEMENT_STEPS = Object.freeze(['seal', 'resolve', 'convert_to_claim', 'claim_draw', 'withdraw', 'reclaim']);
export const SETTLEMENT_INTENT_STATUS = Object.freeze({ PENDING: 'pending', PREPARED: 'prepared', SUBMITTED: 'submitted', LANDED: 'landed', AMBIGUOUS: 'ambiguous' });

// step → subject_type 的既定归属(供 ensureSettlementIntent 校验调用方没传错组合，不是 CHECK 之外
// 再造一套规则——这条对应关系本身就是设计文档§2的固定业务事实，不会随市场配置变化)。
const STEP_SUBJECT_TYPE = Object.freeze({
  seal: 'market', resolve: 'market',
  convert_to_claim: 'claim', claim_draw: 'claim', withdraw: 'claim',
  reclaim: 'ticket',
});

// step → 依赖的前置 step(同 subject_type 内)；null = 无依赖。
const STEP_DEPENDS_ON = Object.freeze({
  seal: null, resolve: 'seal',
  convert_to_claim: null, claim_draw: 'convert_to_claim', withdraw: 'claim_draw',
  reclaim: null,
});

const nowIso = () => new Date().toISOString();

/** 幂等键: 'settle:<subject_type>:<subject_id>:<step>'; attempt ≥ 2 加后缀 '#n'。 */
export function settlementIntentKeyFor(subjectType, subjectId, step, attempt = 1) {
  if (!SETTLEMENT_STEPS.includes(step)) throw new Error(`settlementIntentKeyFor: unknown step ${step}`);
  if (!SETTLEMENT_SUBJECT_TYPES.includes(subjectType)) throw new Error(`settlementIntentKeyFor: unknown subject_type ${subjectType}`);
  if (STEP_SUBJECT_TYPE[step] !== subjectType) throw new Error(`settlementIntentKeyFor: step ${step} belongs to subject_type ${STEP_SUBJECT_TYPE[step]}, not ${subjectType}`);
  if (!subjectId) throw new Error('settlementIntentKeyFor: subjectId required');
  return attempt > 1 ? `settle:${subjectType}:${subjectId}:${step}#${attempt}` : `settle:${subjectType}:${subjectId}:${step}`;
}

export function getSettlementIntent(intentKey) {
  return sqlite.prepare('SELECT * FROM proto_settlement_intents WHERE intent_key = ?').get(intentKey) || null;
}

/** 同一 subject 同一 step 的活跃行(非 ambiguous), 取最后写入的(rowid DESC)。 */
export function activeSettlementIntent(subjectType, subjectId, step) {
  return sqlite.prepare(`
    SELECT * FROM proto_settlement_intents WHERE subject_type = ? AND subject_id = ? AND step = ? AND status != 'ambiguous'
    ORDER BY rowid DESC LIMIT 1
  `).get(subjectType, subjectId, step) || null;
}

/** INSERT OR IGNORE 一行 pending(必须在任何 IPC 之前); 已有则原样返回(幂等)。 */
export function ensureSettlementIntent({ subjectType, subjectId, step, attempt = 1 }) {
  const intentKey = settlementIntentKeyFor(subjectType, subjectId, step, attempt);
  const dependsOnStep = STEP_DEPENDS_ON[step];
  const dependsOn = dependsOnStep ? settlementIntentKeyFor(subjectType, subjectId, dependsOnStep) : null;
  const ts = nowIso();
  sqlite.prepare(`
    INSERT OR IGNORE INTO proto_settlement_intents
      (intent_key, subject_type, subject_id, step, depends_on, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(intentKey, subjectType, subjectId, step, dependsOn, ts, ts);
  return getSettlementIntent(intentKey);
}

/** 只改给定列; status 单调: 不允许从 submitted/landed 退回 prepared/pending。ambiguous 是终态, 只能人工清。 */
export function markSettlementIntent(intentKey, patch) {
  const cur = getSettlementIntent(intentKey);
  if (!cur) throw new Error(`markSettlementIntent: intent ${intentKey} not found`);
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
  sqlite.prepare(`UPDATE proto_settlement_intents SET ${cols.join(', ')} WHERE intent_key = ?`).run(...vals);
  return getSettlementIntent(intentKey);
}

/** 依赖是否已 landed；无依赖(dependsOnStep=null)视为"已满足"。供 proto-driver.mjs 推进前查询。 */
export function isDependencyLanded(subjectType, subjectId, step) {
  const dependsOnStep = STEP_DEPENDS_ON[step];
  if (!dependsOnStep) return true;
  const dep = activeSettlementIntent(subjectType, subjectId, dependsOnStep);
  return dep?.status === 'landed';
}

/** relay 侧 HTTP 回执落表(同 recordBetIntentPhase 语义): prepared 在广播前写, submitted 在广播后写。 */
export function recordSettlementIntentPhase({ intentKey, phase, txid, txJson = null }) {
  const cur = getSettlementIntent(intentKey);
  if (!cur) return { ok: false, error: `unknown intent_key ${intentKey}` };
  if (!txid) return { ok: false, error: 'txid required' };
  if (phase === 'prepared') {
    // F1b(Bettor GO 1617 / Codex "最终 send 边界"的 first-send 一半): relay 在广播【之前】把 prepared 回执打到这里, 且 relay 侧"prepared 落库失败即不广播"
    //   (covenant-broadcast-relay.mjs prepared_ingest_failed; relay ingest 遇非 2xx 会 throw; ingest.js 把 !ok 映成 409)——所以这里是首发前唯一的、最靠近广播的 console 侧否决点。
    //   driver-core 在构造之前读的那次冻结与这里之间有 build + IPC 的窗口, 冻结可能恰好落在窗口里: 此处再读一次, 冻结 ⇒ 不落 prepared(行保持 pending、无字节)⇒ 409 ⇒ relay 不广播。
    //   只否决 prepared; submitted 回执永不否决(已广播的事实必须记, NO TX NO STATE)。范围同 F1: 只 close_commit(market:resolve); 只在行 pending/prepared 时(已 submitted/landed 的行是既成事实, 不动)。
    if (cur.subject_type === 'market' && cur.step === 'resolve' && (cur.status === 'pending' || cur.status === 'prepared')) {
      let frozen;
      try { frozen = isMarketFrozen(sqlite, cur.subject_id); }
      catch (e) { frozen = true; console.warn(`[proto-settlement-intent] ${intentKey} 冻结列读取失败(按冻结处理, fail-closed): ${e && e.message}`); }
      if (frozen !== false) {
        alertSettlementIntent('settlement_intent_frozen_prepared_hold', `settlement intent ${intentKey}: prepared receipt REFUSED on a FROZEN market (freeze landed between driver gate and relay persist) — relay must not broadcast`, { intent_key: intentKey, prepared_txid: txid, market_id: cur.subject_id, stage: 'prepared_receipt_refused' }, 'error');
        return { ok: false, code: 'settlement_frozen', error: `market ${cur.subject_id} is frozen — prepared close_commit not recorded, do not broadcast` };
      }
    }
    const patch = { prepared_txid: txid };
    if (txJson) patch.prepared_tx_json = typeof txJson === 'string' ? txJson : JSON.stringify(txJson);
    if (cur.status === 'pending') patch.status = 'prepared';
    return { ok: true, intent: markSettlementIntent(intentKey, patch) };
  }
  if (phase === 'submitted') {
    const patch = { status: 'submitted', submitted_txid: txid };
    if (!cur.prepared_txid) patch.prepared_txid = txid;
    return { ok: true, intent: markSettlementIntent(intentKey, patch) };
  }
  return { ok: false, error: `unknown phase ${phase}` };
}

export function alertSettlementIntent(eventType, summary, payload = {}, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'proto-settlement-intent', ?, ?, ?, ?)
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload), nowIso());
  } catch (e) {
    console.warn(`[proto-settlement-intent] events INSERT err: ${e.message}`);
  }
}

const FROZEN_HOLD_MARK = 'settlement_frozen_prepared_hold';

class SettlementIntentHoldError extends Error {
  constructor(msg, code) { super(msg); this.code = code; this.hold = true; }
}

/**
 * prepared 行的唯一处理路径(同 proto-bet-intent.mjs resolvePrepared 移植, 语义完全一致):
 *   ① get_mempool_entry(prepared_txid) 有 ⇒ submitted, 不重发
 *   ② check_utxo_landed(target, prepared_txid, 0) 落了 ⇒ submitted, 不重发
 *   ③ 【F1·Codex MUST① / Bettor 1614】close_commit(market:resolve)行: 重读冻结列, 冻结(或读不到)⇒ hold, 不重播不重建不弃行
 *      (位置 = ①② 之后: 已在池/已落链是事实, 冻结否定不了, 照常记 submitted; 在 ④ 重播之前: 重播是最终 send 边界)
 *   ④ 无字节 ⇒ 不发不建, 告警, hold
 *   ⑤ 同字节重播: relay 断言 txid == prepared_txid
 *        ok ⇒ submitted; code inputs_spent ⇒ 查 kaspa_tx_log 正向证据, 有则 submitted, 无则 ambiguous/hold; 其他 ⇒ throw
 */
async function resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log }) {
  const key = row.intent_key, txid = row.prepared_txid;
  let mem;
  try { mem = await sendCmd(relayId, { type: 'get_mempool_entry', txid }, 10000, origin); }
  catch (e) { throw new Error(`settlement intent ${key}: mempool query failed (${e.message}) — unknown state, not resending`); }
  if (mem?.found) {
    log.log(`[proto-settlement-intent] ${key} prepared txid ${txid.slice(0, 12)} already in mempool → submitted (no resend)`);
    return { txId: txid, intent: markSettlementIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  let landed;
  try { landed = await sendCmd(relayId, { type: 'check_utxo_landed', address: targetAddress, txid, minDepth: 0 }, 10000, origin); }
  catch (e) { throw new Error(`settlement intent ${key}: landed query failed (${e.message}) — unknown state, not resending`); }
  if (landed?.landed) {
    log.log(`[proto-settlement-intent] ${key} prepared txid ${txid.slice(0, 12)} already landed → submitted (no resend)`);
    return { txId: txid, intent: markSettlementIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  // F1: 唯一路径——driveSettlementIntent(prepared 分支 / driver 每 tick 的 preparedRows)与 resumeStaleSettlementIntents 都经本函数, 所以闸放这里而不是各调用方
  //   (2026-09-20 simnet 红证: 冻结后 prepared close_commit 仍被 driver 同字节重播并落地; 冻结重读原先只在 driver-core 的 buildAndBroadcast 闭包 = 仅 pending 路径)。
  //   范围只限 close_commit: 冻结语义 = "close_commit 三入口 fail-closed"(见 proto-settlement-freeze.mjs 头注), seal/claim 类不在冻结范围。
  //   严格 fail-closed(同 driver-core 入口③): 只有 isMarketFrozen 明确返回 false 才放行; true / 抛错(市场不存在等)一律按冻结。
  if (row.subject_type === 'market' && row.step === 'resolve') {
    let frozen;
    try { frozen = isMarketFrozen(sqlite, row.subject_id); }
    catch (e) { frozen = true; log.log(`[proto-settlement-intent] ${key} 冻结列读取失败(按冻结处理, fail-closed): ${e && e.message}`); }
    if (frozen !== false) {
      // 每 tick 都会回到这里(行永远停在 prepared): 只在首次(last_error 还不是这个标记)落标记 + 报警, 之后静默 hold, 不刷 events、不刷 updated_at(否则 prepared_stale 的去重键会被反复重置)。
      if (row.last_error !== FROZEN_HOLD_MARK) {
        markSettlementIntent(key, { last_error: FROZEN_HOLD_MARK });
        alertSettlementIntent('settlement_intent_frozen_prepared_hold', `settlement intent ${key} prepared txid ${txid.slice(0, 12)} on a FROZEN market — replay refused, HOLD (no replay, no rebuild, no abandon)`, { intent_key: key, prepared_txid: txid, market_id: row.subject_id }, 'error');
      }
      throw new SettlementIntentHoldError(`settlement intent ${key}: market frozen — prepared close_commit not replayed (hold; exit = natural refund_flip)`, 'settlement_frozen');
    }
  }
  if (!row.prepared_tx_json) {
    alertSettlementIntent('settlement_intent_prepared_without_bytes', `settlement intent ${key} prepared txid ${txid.slice(0, 12)} has no signed bytes — manual review`, { intent_key: key, prepared_txid: txid });
    throw new SettlementIntentHoldError(`settlement intent ${key}: prepared without bytes — hold (no resend, no rebuild)`, 'prepared_without_bytes');
  }
  let rep;
  try {
    rep = await sendCmd(relayId, {
      type: PROTO_COVENANT_BROADCAST_TYPE, intent_key: key, replay_tx_json: row.prepared_tx_json, prepared_txid: txid,
    }, undefined, origin);
  } catch (e) { throw new Error(`settlement intent ${key}: replay IPC failed (${e.message})`); }
  if (rep?.txId) {
    if (rep.txId !== txid) {
      alertSettlementIntent('settlement_intent_replay_txid_mismatch', `settlement intent ${key} replay returned ${String(rep.txId).slice(0, 12)} != prepared ${txid.slice(0, 12)}`, { intent_key: key, prepared_txid: txid, returned: rep.txId });
      throw new SettlementIntentHoldError(`settlement intent ${key}: replay txid mismatch — hold`, 'replay_txid_mismatch');
    }
    log.log(`[proto-settlement-intent] ${key} replayed same bytes txid ${txid.slice(0, 12)} → submitted`);
    return { txId: txid, replayed: true, intent: markSettlementIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  if (rep?.code === 'inputs_spent') {
    let positiveLanded = false;
    try {
      positiveLanded = !!sqlite.prepare('SELECT 1 FROM kaspa_tx_log WHERE tx_id = ?').get(txid);
    } catch (e) { log.log(`[proto-settlement-intent] ${key} kaspa_tx_log positive-evidence lookup err: ${e.message}`); }
    if (positiveLanded) {
      log.log(`[proto-settlement-intent] ${key} inputs_spent but kaspa_tx_log has positive landing evidence for ${txid.slice(0, 12)} → submitted (no rebuild)`);
      return { txId: txid, intent: markSettlementIntent(key, { status: 'submitted', submitted_txid: txid }) };
    }
    markSettlementIntent(key, { status: 'ambiguous', last_error: rep.error || 'inputs_spent (no positive evidence either way)' });
    alertSettlementIntent('settlement_intent_ambiguous_inputs_spent', `settlement intent ${key} inputs spent, no positive evidence of conflicting spender — HOLD, no rebuild, no abandon`, { intent_key: key, prepared_txid: txid }, 'error');
    throw new SettlementIntentHoldError(`settlement intent ${key}: inputs spent, ambiguous — HOLD (manual review)`, 'ambiguous_inputs_spent');
  }
  throw new Error(`settlement intent ${key}: replay failed: ${rep?.error || 'no txId'}`);
}

/**
 * 六步的唯一驱动入口(同 proto-bet-intent.mjs driveBetIntent 移植, 泛化 subject_type/subject_id)。
 * 调用方负责真正构造+签名交易字节, 通过 buildAndBroadcast({attempt}) 回调提供——本函数只管状态机,
 * 不碰 kaspa-wasm。**调用前必须自己确认 isDependencyLanded 为 true**(本函数不重复这个检查——依赖
 * 判断需要读 proto_markets/proto_claims 等本模块不碰的表, 职责边界同 proto-bet-intent.mjs)。
 * @param {object} o
 * @param {Function} o.sendCmd  注入 relay-manager.sendCommandAsync(relayId, cmd, timeout, origin)
 * @param {string} o.relayId
 * @param {'market'|'claim'|'ticket'} o.subjectType
 * @param {string} o.subjectId
 * @param {string} o.step
 * @param {string} o.targetAddress  landed 判据用的地址(该步骤产出的 covenant P2SH 地址)
 * @param {Function} o.buildAndBroadcast  async ({attempt}) => {txId, txJson} | throws
 * @param {number} [o.maxAttempts]
 * @returns {Promise<{txId, intent, reused?, replayed?}>}
 */
export async function driveSettlementIntent({
  sendCmd, relayId, subjectType, subjectId, step, targetAddress, buildAndBroadcast, origin,
  maxAttempts = 3, sleepMs = (attempt) => attempt * 5000, log = console,
}) {
  if (typeof sendCmd !== 'function') throw new Error('driveSettlementIntent: sendCmd required');
  if (!relayId) throw new Error('driveSettlementIntent: relayId required');
  if (typeof buildAndBroadcast !== 'function') throw new Error('driveSettlementIntent: buildAndBroadcast required');
  let row = activeSettlementIntent(subjectType, subjectId, step) || ensureSettlementIntent({ subjectType, subjectId, step });
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    row = getSettlementIntent(row.intent_key);
    if (row.status === 'submitted' || row.status === 'landed') {
      return { txId: row.submitted_txid, intent: row, reused: true };
    }
    if (row.status === 'ambiguous') {
      throw new SettlementIntentHoldError(`settlement intent ${row.intent_key}: ambiguous — HOLD, manual review required, will not auto-retry`, 'ambiguous_inputs_spent');
    }
    if (row.status === 'prepared') {
      const r = await resolvePrepared({ sendCmd, relayId, row, targetAddress, origin, log });
      if (r.txId) return { txId: r.txId, intent: r.intent, replayed: !!r.replayed };
      row = r.intent;
      continue;
    }
    // pending ⇒ fresh build+broadcast; buildAndBroadcast 内部应当在广播前调 recordSettlementIntentPhase(prepared)。
    try {
      const res = await buildAndBroadcast({ attempt, intentKey: row.intent_key });
      if (res?.txId) {
        const intent = markSettlementIntent(row.intent_key, { status: 'submitted', submitted_txid: res.txId, prepared_txid: row.prepared_txid || res.txId, last_error: null });
        return { txId: res.txId, intent };
      }
      lastError = res?.error || 'buildAndBroadcast returned no txId';
    } catch (e) {
      lastError = e.message;
    }
    markSettlementIntent(row.intent_key, { last_error: String(lastError).slice(0, 500) });
    log.log(`[proto-settlement-intent] ${row.intent_key} attempt ${attempt}/${maxAttempts} fail: ${lastError}`);
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, sleepMs(attempt)));
  }
  throw new Error(`settlement intent ${row.intent_key} exhausted ${maxAttempts} attempts: ${lastError}`);
}

/** landed 门: check_utxo_landed(target, submitted_txid, minDepth). landed ⇒ 行转 landed + depth。 */
export async function checkSettlementIntentLanded({ sendCmd, relayId, intent, targetAddress, minDepth, origin }) {
  if (!intent?.submitted_txid) return { landed: false, depth: null, reason: 'not submitted' };
  if (!(Number(minDepth) > 0)) throw new Error('checkSettlementIntentLanded: minDepth > 0 required (pass REORG_SAFE_MIN_DEPTH)');
  const r = await sendCmd(relayId, { type: 'check_utxo_landed', address: targetAddress, txid: intent.submitted_txid, minDepth }, 15000, origin);
  if (r?.landed) {
    markSettlementIntent(intent.intent_key, { status: 'landed', landed_depth: r.depth ?? null, landed_at: nowIso() });
    return { landed: true, depth: r.depth ?? null };
  }
  return { landed: false, depth: r?.depth ?? null };
}

/**
 * 重启捡回(F2-R, 同 proto-bet-intent.mjs resumeStaleBetIntents 移植): prepared 且 updated_at 早于
 * olderThanMs 的行 → resolvePrepared。调用方需提供 targetAddressFor(row) 把 intent_key 映回该步骤
 * 的 landed 判据地址(本模块不碰 proto_markets/proto_claims, 保持职责单一)。
 */
export async function resumeStaleSettlementIntents({ sendCmd, targetAddressFor, relayIdFor, olderThanMs = 2 * 60 * 1000, limit = 20, origin = 'internal', log = console }) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = sqlite.prepare(`
    SELECT * FROM proto_settlement_intents WHERE status = 'prepared' AND julianday(updated_at) < julianday(?)
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
      log.log(`[proto-settlement-intent] resume ${row.intent_key}: ${e.message}`);
    }
  }
  return out;
}
