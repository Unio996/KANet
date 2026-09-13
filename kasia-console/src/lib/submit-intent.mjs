// submit-intent.mjs — (c) NO-TX-NO-STATE F2 · 广播前持久 submit-intent + 幂等键随 relay 走 + 两阶段 prepared/submitted + landed 门。
// 设计: docs/2026-09-13-j2-no-tx-no-state-two-violations-and-landed-reconciler-design-v0.1.md v0.3 (NWT PASS 29959d41 · Bettor 1044)。
//
// 谁用: bettor-prediction-settler.js(payout) · api/bettor.js 三处 escrow 锁仓(escrow_lock / maker_stake / taker_stake) —— 四个盲重试
// 循环(`for attempt 1..3 { transfer; txId 空 ⇒ 重发 }`)全部换成一个 transferWithIntent() 调用。
//
// 不变量(设计 §2):
//   I1 submit accepted ≠ chain landed —— 本模块只把"submitted"记成 submitted, landed 由 checkIntentLanded(minDepth) 单独判。
//   I5 重试不得双付 —— attempt ≥ 2 的唯一前置 = 查 relay 侧权威源(intent 表里的 txid → get_mempool_entry / check_utxo_landed / 同字节重播),
//      **永不读调用方自己的 metadata**。
//   F2-R 重启捡回 —— prepared 行只允许【同字节重播】(relay 断言 txid == prepared_txid); 重建(新 UTXO 选择)只在 relay 判定
//      "旧 txid 的某输入已被别的 txid 花掉"(code inputs_spent)时; 有 txid 无字节 ⇒ 不发不建 + 告警 intent_prepared_without_bytes。
//
// 🔴 M0a 门: 本文件【不】import relay-manager(裸 import 差分门硬拒新通道) —— 调用方把 sendCommandAsync 以 sendCmd 注入。
//   这同时让全部向量离线可测(假 sendCmd), 不需要 _xxxForTests 出口。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

export const INTENT_KINDS = Object.freeze(['payout', 'escrow_lock', 'maker_stake', 'taker_stake']);
export const INTENT_STATUS = Object.freeze({ PENDING: 'pending', PREPARED: 'prepared', SUBMITTED: 'submitted', LANDED: 'landed', ABANDONED: 'abandoned' });

const KIND_PREFIX = { payout: 'payout:', escrow_lock: 'escrow:', maker_stake: 'stake:maker:', taker_stake: 'stake:taker:' };

const nowIso = () => new Date().toISOString();

/** 幂等键: 'payout:<offer_id>' / 'escrow:<bet_id>' / 'stake:maker:<bet_id>' / 'stake:taker:<bet_id>'; attempt ≥ 2 加后缀 '#n'。 */
export function intentKeyFor(kind, offerId, attempt = 1) {
  const p = KIND_PREFIX[kind];
  if (!p) throw new Error(`intentKeyFor: unknown intent_kind ${kind}`);
  if (!offerId) throw new Error('intentKeyFor: offerId required');
  return attempt > 1 ? `${p}${offerId}#${attempt}` : `${p}${offerId}`;
}

export function getIntent(intentKey) {
  return sqlite.prepare('SELECT * FROM submit_intents WHERE intent_key = ?').get(intentKey) || null;
}

/** 同一 offer 同一 kind 的活跃行(非 abandoned), attempt 最大者。 */
export function activeIntentForOffer(offerId, kind) {
  return sqlite.prepare(`
    SELECT * FROM submit_intents WHERE offer_id = ? AND intent_kind = ? AND status != 'abandoned'
    ORDER BY attempt DESC LIMIT 1
  `).get(offerId, kind) || null;
}

/** INSERT OR IGNORE 一行 pending(必须在任何 IPC 之前); 已有则原样返回(幂等)。 */
export function ensureIntent({ intentKind, offerId, relayId, targetAddress, amountKas, attempt = 1, parentIntentKey = null }) {
  if (!INTENT_KINDS.includes(intentKind)) throw new Error(`ensureIntent: unknown intent_kind ${intentKind}`);
  if (!targetAddress) throw new Error('ensureIntent: targetAddress required');
  if (!amountKas) throw new Error('ensureIntent: amountKas required');
  const intentKey = intentKeyFor(intentKind, offerId, attempt);
  const ts = nowIso();
  sqlite.prepare(`
    INSERT OR IGNORE INTO submit_intents
      (intent_key, intent_kind, offer_id, relay_id, target_address, amount_kas, status, attempt, parent_intent_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(intentKey, intentKind, offerId, relayId || null, targetAddress, String(amountKas), attempt, parentIntentKey, ts, ts);
  return getIntent(intentKey);
}

/** 只改给定列; status 单调: 不允许从 submitted/landed 退回 prepared/pending(relay 侧迟到的 prepared 回执不能覆盖)。 */
export function markIntent(intentKey, patch) {
  const cur = getIntent(intentKey);
  if (!cur) throw new Error(`markIntent: intent ${intentKey} not found`);
  const RANK = { pending: 0, prepared: 1, submitted: 2, landed: 3, abandoned: 9 };
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'status' && RANK[v] < RANK[cur.status] && cur.status !== 'abandoned') continue;   // 单调
    if (k === 'status' && cur.status === 'abandoned') continue;                                   // 终态
    cols.push(`${k} = ?`); vals.push(v === undefined ? null : v);
  }
  if (!cols.length) return cur;
  cols.push('updated_at = ?'); vals.push(nowIso());
  vals.push(intentKey);
  sqlite.prepare(`UPDATE submit_intents SET ${cols.join(', ')} WHERE intent_key = ?`).run(...vals);
  return getIntent(intentKey);
}

/**
 * relay 侧 HTTP 回执落表(/ingest/submit-intent): phase 'prepared'{txid, txJson} 在 relay 广播【之前】写; 'submitted'{txid} 在广播后写。
 * 未知 intent_key(console 没先 INSERT) ⇒ 拒(relay 只对 console 派出的 intent 回执)。
 */
export function recordIntentPhase({ intentKey, phase, txid, txJson = null }) {
  const cur = getIntent(intentKey);
  if (!cur) return { ok: false, error: `unknown intent_key ${intentKey}` };
  if (!txid) return { ok: false, error: 'txid required' };
  if (phase === 'prepared') {
    // prepared 只在 pending/prepared 时有意义; 已 submitted 的行只补字节(重启捡回要用), 不动 status。
    const patch = { prepared_txid: txid };
    if (txJson) patch.prepared_tx_json = typeof txJson === 'string' ? txJson : JSON.stringify(txJson);
    if (cur.status === 'pending') patch.status = 'prepared';
    return { ok: true, intent: markIntent(intentKey, patch) };
  }
  if (phase === 'submitted') {
    const patch = { status: 'submitted', submitted_txid: txid };
    if (!cur.prepared_txid) patch.prepared_txid = txid;
    return { ok: true, intent: markIntent(intentKey, patch) };
  }
  return { ok: false, error: `unknown phase ${phase}` };
}

export function listIntents({ status, olderThanMs = 0, limit = 50, kinds = null } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const kindClause = kinds && kinds.length ? ` AND intent_kind IN (${kinds.map(() => '?').join(',')})` : '';
  return sqlite.prepare(`
    SELECT * FROM submit_intents WHERE status = ? AND julianday(updated_at) < julianday(?)${kindClause}
    ORDER BY updated_at ASC LIMIT ?
  `).all(status, cutoff, ...(kinds || []), limit);
}

/** 告警进 events 表(同 broker-state-reconciler 形); 不 throw。 */
export function alertIntent(eventType, summary, payload = {}, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'submit-intent', ?, ?, ?, ?)
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload), nowIso());
  } catch (e) {
    console.warn(`[submit-intent] events INSERT err: ${e.message}`);
  }
}

class IntentHoldError extends Error {
  constructor(msg, code) { super(msg); this.code = code; this.hold = true; }
}

/**
 * prepared 行的唯一处理路径(设计 F2(c) + F2-R):
 *   ① get_mempool_entry(prepared_txid) 有 ⇒ submitted, 不重发
 *   ② check_utxo_landed(target, prepared_txid, 0) 落了 ⇒ submitted, 不重发
 *   ③ 无字节 ⇒ 不发不建, 告警 intent_prepared_without_bytes, hold
 *   ④ 同字节重播 transfer{replay_tx_json, prepared_txid}: relay 断言 txid == prepared_txid
 *        ok ⇒ submitted; code inputs_spent ⇒ 旧行 abandoned + 新 attempt 行(pending, 由调用方重发); 其他 ⇒ throw(下 attempt 再来)
 *   查询失败 = 未知 ⇒ throw, 【绝不】按"没查到"当"没发过"重发。
 */
async function resolvePrepared({ sendCmd, relayId, row, origin, log }) {
  const key = row.intent_key, txid = row.prepared_txid;
  let mem;
  try { mem = await sendCmd(relayId, { type: 'get_mempool_entry', txid }, 10000, origin); }
  catch (e) { throw new Error(`intent ${key}: mempool query failed (${e.message}) — unknown state, not resending`); }
  if (mem?.found) {
    log.log(`[submit-intent] ${key} prepared txid ${txid.slice(0, 12)} already in mempool → submitted (no resend)`);
    return { txId: txid, intent: markIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  let landed;
  try { landed = await sendCmd(relayId, { type: 'check_utxo_landed', address: row.target_address, txid, minDepth: 0 }, 10000, origin); }
  catch (e) { throw new Error(`intent ${key}: landed query failed (${e.message}) — unknown state, not resending`); }
  if (landed?.landed) {
    log.log(`[submit-intent] ${key} prepared txid ${txid.slice(0, 12)} already landed → submitted (no resend)`);
    return { txId: txid, intent: markIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  if (!row.prepared_tx_json) {
    alertIntent('intent_prepared_without_bytes', `intent ${key} prepared txid ${txid.slice(0, 12)} has no signed bytes — manual review`, { intent_key: key, prepared_txid: txid });
    throw new IntentHoldError(`intent ${key}: prepared without bytes — hold (no resend, no rebuild)`, 'prepared_without_bytes');
  }
  let rep;
  try {
    rep = await sendCmd(relayId, {
      type: 'transfer', target: row.target_address, amount: row.amount_kas,
      intent_key: key, replay_tx_json: row.prepared_tx_json, prepared_txid: txid,
    }, undefined, origin);
  } catch (e) { throw new Error(`intent ${key}: replay IPC failed (${e.message})`); }
  if (rep?.txId) {
    if (rep.txId !== txid) {
      alertIntent('intent_replay_txid_mismatch', `intent ${key} replay returned ${String(rep.txId).slice(0, 12)} ≠ prepared ${txid.slice(0, 12)}`, { intent_key: key, prepared_txid: txid, returned: rep.txId });
      throw new IntentHoldError(`intent ${key}: replay txid mismatch — hold`, 'replay_txid_mismatch');
    }
    log.log(`[submit-intent] ${key} replayed same bytes txid ${txid.slice(0, 12)} → submitted`);
    return { txId: txid, replayed: true, intent: markIntent(key, { status: 'submitted', submitted_txid: txid }) };
  }
  if (rep?.code === 'inputs_spent') {
    markIntent(key, { status: 'abandoned', last_error: rep.error || 'inputs_spent' });
    const next = ensureIntent({
      intentKind: row.intent_kind, offerId: row.offer_id, relayId: row.relay_id, targetAddress: row.target_address,
      amountKas: row.amount_kas, attempt: (row.attempt || 1) + 1, parentIntentKey: key,
    });
    alertIntent('intent_rebuilt_after_inputs_spent', `intent ${key} abandoned (inputs spent by another tx) → ${next.intent_key}`, { old: key, new: next.intent_key, prepared_txid: txid }, 'info');
    return { rebuilt: true, intent: next };
  }
  if (rep?.code === 'replay_txid_mismatch') {
    alertIntent('intent_replay_txid_mismatch', `intent ${key} relay rejected replay: ${rep.error}`, { intent_key: key, prepared_txid: txid });
    throw new IntentHoldError(`intent ${key}: ${rep.error}`, 'replay_txid_mismatch');
  }
  if (rep?.code === 'replay_bad_json') {
    // Codex 8118732e (A): 往返失败(字节反序列化/finalize 失败) ⇒ fail-closed 手工恢复 —— hold, 不重试不重建。
    alertIntent('intent_replay_unrecoverable', `intent ${key} prepared bytes cannot be deserialized/finalized: ${rep.error} — manual recovery`, { intent_key: key, prepared_txid: txid });
    throw new IntentHoldError(`intent ${key}: ${rep.error}`, 'replay_bad_json');
  }
  throw new Error(`intent ${key}: replay failed: ${rep?.error || 'no txId'}`);
}

/**
 * 四个调用点的唯一入口。返回 { txId, intent, reused?, replayed? } 或 throw(attempt 用尽 / hold)。
 * 🔴 txId 回来只表示 submitted(进 mempool), 不表示 landed —— 推进"完成"态前必须 checkIntentLanded(minDepth=REORG_SAFE_MIN_DEPTH)。
 */
export async function transferWithIntent({
  sendCmd, relayId, intentKind, offerId, targetAddress, amountKas, origin,
  maxAttempts = 3, sleepMs = (attempt) => attempt * 5000, log = console,
}) {
  if (typeof sendCmd !== 'function') throw new Error('transferWithIntent: sendCmd required (inject relay-manager.sendCommandAsync)');
  if (!relayId) throw new Error('transferWithIntent: relayId required');
  let row = activeIntentForOffer(offerId, intentKind)
    || ensureIntent({ intentKind, offerId, relayId, targetAddress, amountKas });
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    row = getIntent(row.intent_key);
    if (row.status === 'submitted' || row.status === 'landed') {
      return { txId: row.submitted_txid, intent: row, reused: true };
    }
    if (row.status === 'prepared') {
      const r = await resolvePrepared({ sendCmd, relayId, row, origin, log });   // hold ⇒ throws out of the loop
      if (r.txId) return { txId: r.txId, intent: r.intent, replayed: !!r.replayed };
      row = r.intent;   // rebuilt: fresh send with the new attempt row
    }
    // pending ⇒ fresh send; relay writes prepared(+bytes) via /ingest/submit-intent before it broadcasts.
    try {
      const res = await sendCmd(relayId, { type: 'transfer', target: row.target_address, amount: row.amount_kas, intent_key: row.intent_key }, undefined, origin);
      if (res?.txId) {
        const intent = markIntent(row.intent_key, { status: 'submitted', submitted_txid: res.txId, prepared_txid: row.prepared_txid || res.txId, last_error: null });
        return { txId: res.txId, intent };
      }
      lastError = res?.error || 'transfer returned no txId';
    } catch (e) {
      lastError = e.message;
    }
    markIntent(row.intent_key, { last_error: String(lastError).slice(0, 500) });
    log.log(`[submit-intent] ${row.intent_key} attempt ${attempt}/${maxAttempts} fail: ${lastError}`);
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, sleepMs(attempt)));
  }
  throw new Error(`transfer intent ${row.intent_key} exhausted ${maxAttempts} attempts: ${lastError}`);
}

/** landed 门: check_utxo_landed(target, submitted_txid, minDepth). landed ⇒ 行转 landed + depth。返回 { landed, depth }。 */
export async function checkIntentLanded({ sendCmd, relayId, intent, minDepth, origin }) {
  if (!intent?.submitted_txid) return { landed: false, depth: null, reason: 'not submitted' };
  if (!(Number(minDepth) > 0)) throw new Error('checkIntentLanded: minDepth > 0 required (pass REORG_SAFE_MIN_DEPTH)');
  const r = await sendCmd(relayId, { type: 'check_utxo_landed', address: intent.target_address, txid: intent.submitted_txid, minDepth }, 15000, origin);
  if (r?.landed) {
    markIntent(intent.intent_key, { status: 'landed', landed_depth: r.depth ?? null, landed_at: nowIso() });
    return { landed: true, depth: r.depth ?? null };
  }
  return { landed: false, depth: r?.depth ?? null };
}

/**
 * 重启捡回(F2-R, 由持有 relay 通道的 daemon 每 tick 调, 目前 = prediction-settler): prepared 且 updated_at 早于 olderThanMs 的行 →
 * resolvePrepared(mempool/landed/同字节重播)。非 payout 类(HTTP 处理器起的 escrow 意图, 客户端已走)只【解决】不【重建】:
 * inputs_spent ⇒ 旧行 abandoned + 新行 pending, 但没有人去发它 —— 新行留 pending 并告警 intent_orphan_pending(人工/上游处理器决定)。
 */
export async function resumeStaleIntents({ sendCmd, olderThanMs = 2 * 60 * 1000, limit = 20, origin = 'internal', log = console, relayIdFor = (row) => row.relay_id }) {
  const rows = listIntents({ status: 'prepared', olderThanMs, limit });
  const out = { scanned: rows.length, resolved: 0, held: 0, rebuilt: 0, errored: 0 };
  for (const row of rows) {
    const relayId = relayIdFor(row);
    if (!relayId) { out.errored++; continue; }
    try {
      const r = await resolvePrepared({ sendCmd, relayId, row, origin, log });
      if (r.rebuilt) {
        out.rebuilt++;
        if (row.intent_kind !== 'payout') alertIntent('intent_orphan_pending', `rebuilt ${r.intent.intent_key} has no live caller — manual/upstream decision`, { intent_key: r.intent.intent_key, kind: row.intent_kind });
      } else out.resolved++;
    } catch (e) {
      if (e.hold) out.held++; else out.errored++;
      log.log(`[submit-intent] resume ${row.intent_key}: ${e.message}`);
    }
  }
  return out;
}
