/**
 * Chain Event Service — 链上事实的唯一归档
 *
 * 每笔链上交易一条记录，UNIQUE(txid, event_type) 自动去重。
 * Scout 和 Relay 都可以写，先到先写，后到跳过。
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

let _insertStmt;
function insertStmt() {
  return _insertStmt ??= sqlite.prepare(`
    INSERT OR IGNORE INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
}

/**
 * 记录一条链上事实。重复 txid+event_type 自动跳过。
 *
 * @param {Object} params
 * @param {string} params.txid — 链上交易 ID（必须）
 * @param {string} params.eventType — handshake / comm / payment / broadcast / card / whale_alert
 * @param {string} [params.fromAddress] — 发起方地址
 * @param {string} [params.toAddress] — 接收方地址
 * @param {string} [params.observedBy] — 'scout' 或 'relay'
 * @param {Object|string} [params.payload] — 额外数据（JSON 序列化）
 * @param {string} [params.observedAt] — 观测时间
 */
export function recordChainEvent({ txid, eventType, fromAddress = null, toAddress = null, observedBy = 'system', payload = null, observedAt = null }) {
  if (!txid || !eventType) return;

  const payloadStr = payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null;

  try {
    const r = insertStmt().run(
      randomUUID(),
      txid,
      fromAddress,
      toAddress,
      eventType,
      payloadStr,
      observedBy,
      observedAt || new Date().toISOString()
    );
    // T-J2-2026-05-11 Phase 2 E.2 (NWT #18 ABE audit E): post-insert reputation_summary upsert hook
    // 仅 INSERT 真发生 (r.changes > 0, UNIQUE OR IGNORE 真 ignore 时 changes=0) + 仅 settlement event types
    // 真触发 — exchange_completed / exchange_disputed / exchange_timed_out (排除 cancelled 因 cancel-from-open
    // 无 partner interaction 不算 reputation event)。
    if (r.changes > 0) {
      _maybeUpdateReputationSummary({ eventType, fromAddress, toAddress, payloadStr, observedAt });
    }
  } catch (err) {
    // UNIQUE constraint violation = duplicate, that's fine
    if (!err.message.includes('UNIQUE')) {
      console.log(`[chain-event] write failed: ${err.message}`);
    }
  }
}

// T-J2-2026-05-11 Phase 2 E.2: reputation_summary upsert helper
// 仅 settlement event types 触发 — completed/disputed/timed_out。volume 从 payload.amount/usd 解。
// 双向 upsert (from + to addresses 各 update) — counterparty 都受影响。
const _SETTLEMENT_EVENTS = new Set(['exchange_completed', 'exchange_disputed', 'exchange_timed_out']);
function _maybeUpdateReputationSummary({ eventType, fromAddress, toAddress, payloadStr, observedAt }) {
  if (!_SETTLEMENT_EVENTS.has(eventType)) return;
  // counter 字段映射
  const counterField = eventType === 'exchange_completed' ? 'completed_count'
    : eventType === 'exchange_disputed' ? 'disputed_count'
    : 'timed_out_count';
  // volume 解 payload (give_amount + give_asset)
  let kasVol = 0, usdVol = 0;
  try {
    const p = payloadStr ? JSON.parse(payloadStr) : {};
    const amt = parseFloat(p.give_amount || p.amount || 0) || 0;
    const asset = (p.give_asset || p.asset || '').toUpperCase();
    if (asset === 'KAS') kasVol = amt;
    else if (['USDT', 'USDC', 'USD'].includes(asset)) usdVol = amt;
  } catch { /* payload parse 失败 0 volume OK */ }
  const ts = observedAt || new Date().toISOString();
  // upsert (from + to 双向)
  const upsertStmt = sqlite.prepare(`
    INSERT INTO reputation_summary (address, ${counterField}, total_kas_volume, total_usd_volume, last_event_at, last_updated_at)
    VALUES (?, 1, ?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      ${counterField} = ${counterField} + 1,
      total_kas_volume = total_kas_volume + excluded.total_kas_volume,
      total_usd_volume = total_usd_volume + excluded.total_usd_volume,
      last_event_at = excluded.last_event_at,
      last_updated_at = excluded.last_updated_at
  `);
  try {
    if (fromAddress) upsertStmt.run(fromAddress, kasVol, usdVol, ts, ts);
    if (toAddress) upsertStmt.run(toAddress, kasVol, usdVol, ts, ts);
  } catch (err) {
    // reputation_summary 表未存在 (migrate v97 还没跑) — silent skip, lazy fallback (E.3) 兜底
    if (!err.message.includes('no such table')) {
      console.warn(`[chain-event E.2] reputation upsert failed: ${err.message}`);
    }
  }
}
