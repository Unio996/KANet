/**
 * Relation State Service — 协议状态层核心
 *
 * 唯一的关系状态管理器。所有 UI、Mind、catch-up 只读这张表。
 *
 * 状态机：
 *   observed → accepted → confirmed → active
 *   任何状态 → blocked
 *   active → stale
 *
 * 推进规则：
 *   Scout → observed（链上事实）
 *   Relay → accepted / confirmed（本地动作）
 *   Console → active / stale / blocked（业务逻辑）
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const VALID_STATUS = ['observed', 'accepted', 'confirmed', 'active', 'blocked', 'stale'];

const VALID_TRANSITIONS = {
  observed:  ['accepted', 'blocked'],
  accepted:  ['confirmed', 'blocked'],
  confirmed: ['active', 'blocked'],
  active:    ['blocked', 'stale'],
  blocked:   ['observed'],  // unblock = reset to observed
  stale:     ['observed', 'active', 'blocked'],
};

/**
 * Scout 报告链上握手事实 → observed
 */
export function observeHandshake(localAddress, peerAddress, txid, observedAt) {
  const now = new Date().toISOString();
  const existing = sqlite.prepare(
    'SELECT id, status FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(localAddress, peerAddress);

  if (existing) {
    // Don't downgrade: if already accepted/active, don't reset to observed
    if (existing.status !== 'observed' && existing.status !== 'stale') return existing;
    sqlite.prepare(
      'UPDATE relation_states SET first_seen_tx = COALESCE(first_seen_tx, ?), handshake_observed_at = COALESCE(handshake_observed_at, ?), status = ?, updated_at = ? WHERE id = ?'
    ).run(txid, observedAt || now, 'observed', now, existing.id);
    return { ...existing, status: 'observed' };
  }

  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO relation_states (id, local_address, peer_address, first_seen_tx, handshake_observed_at, status, updated_at)
    VALUES (?, ?, ?, ?, ?, 'observed', ?)
  `).run(id, localAddress, peerAddress, txid, observedAt || now, now);

  console.log(`[relation-state] ${localAddress.slice(-8)} ← ${peerAddress.slice(-8)}: observed (tx: ${txid?.slice(0, 12)})`);
  return { id, status: 'observed' };
}

/**
 * Relay 接受握手 → accepted
 *
 * 只在 scout/discovery.js 观察到真实链上 handshake TX 时调用,
 * 所以可以合法地先 observe 再 accept (即使行不存在).
 * 区别于 confirmSession/activateRelation — 那两个只能在已有行上推进.
 */
export function acceptHandshake(localAddress, peerAddress) {
  let result = _advance(localAddress, peerAddress, 'accepted', { handshake_accepted_at: new Date().toISOString() });
  if (!result) {
    // 没有现存行 → 这是真实链上 handshake, 先 observe 再 advance
    observeHandshake(localAddress, peerAddress, null, new Date().toISOString());
    result = _advance(localAddress, peerAddress, 'accepted', { handshake_accepted_at: new Date().toISOString() });
  }
  // 握手完成 → 升级 classification（只升不降）
  sqlite.prepare(`
    UPDATE relation_states SET classification = 'responsive_agent'
    WHERE local_address = ? AND peer_address = ?
      AND classification IN ('seen_candidate', 'declared_candidate')
  `).run(localAddress, peerAddress);
  return result;
}

/**
 * 会话建立 → confirmed
 */
export function confirmSession(localAddress, peerAddress) {
  return _advance(localAddress, peerAddress, 'confirmed', { session_confirmed_at: new Date().toISOString() });
}

/**
 * 有实际交互 → active
 */
export function activateRelation(localAddress, peerAddress) {
  return _advance(localAddress, peerAddress, 'active', {});
}

/**
 * 屏蔽
 */
export function blockRelation(localAddress, peerAddress) {
  return _advance(localAddress, peerAddress, 'blocked', {}, true); // force
}

/**
 * 解除屏蔽 → reset to observed
 */
export function unblockRelation(localAddress, peerAddress) {
  return _advance(localAddress, peerAddress, 'observed', {}, true); // force
}

/**
 * 查询单个关系
 */
export function getRelation(localAddress, peerAddress) {
  return sqlite.prepare(
    'SELECT * FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(localAddress, peerAddress) || null;
}

/**
 * 查询一个 Agent 的所有关系
 */
export function listRelations(localAddress, { status = null, limit = 100 } = {}) {
  if (status) {
    return sqlite.prepare(
      'SELECT * FROM relation_states WHERE local_address = ? AND status = ? ORDER BY updated_at DESC LIMIT ?'
    ).all(localAddress, status, limit);
  }
  return sqlite.prepare(
    'SELECT * FROM relation_states WHERE local_address = ? ORDER BY updated_at DESC LIMIT ?'
  ).all(localAddress, limit);
}

/**
 * 统计
 */
export function getRelationStats(localAddress) {
  const rows = sqlite.prepare(
    'SELECT status, COUNT(*) as cnt FROM relation_states WHERE local_address = ? GROUP BY status'
  ).all(localAddress);
  const stats = {};
  for (const r of rows) stats[r.status] = r.cnt;
  return stats;
}

// ── 内部 ──

function _advance(localAddress, peerAddress, newStatus, extraFields = {}, force = false) {
  const now = new Date().toISOString();
  const existing = sqlite.prepare(
    'SELECT id, status FROM relation_states WHERE local_address = ? AND peer_address = ?'
  ).get(localAddress, peerAddress);

  if (!existing) {
    // 2026-04-14 bug fix: 不再自动调用 observeHandshake 创建伪造时间戳.
    // 没有握手记录就不应该推进 relation_state — 静默跳过, 不污染数据.
    // 旧逻辑会把 text 消息的 timestamp 填入 handshake_observed_at, 让
    // 冷 DM 的 peer 看起来像"握过手", 坏掉 reputation / classification 推进.
    console.log(`[relation-state] _advance skipped: no existing relation_state for ${localAddress.slice(-8)} → ${peerAddress.slice(-8)} (would require real handshake first)`);
    return null;
  }

  // Validate transition
  if (!force) {
    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(newStatus)) {
      console.log(`[relation-state] BLOCKED: ${existing.status} → ${newStatus} for ${localAddress.slice(-8)} ← ${peerAddress.slice(-8)}`);
      return existing;
    }
  }

  const updates = ['status = ?', 'updated_at = ?'];
  const values = [newStatus, now];

  for (const [key, val] of Object.entries(extraFields)) {
    if (val !== undefined) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }

  values.push(existing.id);
  sqlite.prepare(`UPDATE relation_states SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  console.log(`[relation-state] ${localAddress.slice(-8)} ← ${peerAddress.slice(-8)}: ${existing.status} → ${newStatus}`);
  return { ...existing, status: newStatus };
}
