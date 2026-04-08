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
    insertStmt().run(
      randomUUID(),
      txid,
      fromAddress,
      toAddress,
      eventType,
      payloadStr,
      observedBy,
      observedAt || new Date().toISOString()
    );
  } catch (err) {
    // UNIQUE constraint violation = duplicate, that's fine
    if (!err.message.includes('UNIQUE')) {
      console.log(`[chain-event] write failed: ${err.message}`);
    }
  }
}
