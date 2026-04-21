import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const CONFIG_KEY = 'daily_budget_kas';

/**
 * Get the daily KAS budget for a relay node.
 * Uses config key `budget:<relayId>` with category 'budget'.
 * @param {string} relayId
 * @returns {Promise<number>} budget in KAS (0 = unlimited)
 */
export async function getRelayBudget(relayId) {
  const row = sqlite.prepare(
    'SELECT value_encrypted FROM config_entries WHERE key = ? AND category = ?'
  ).get(`budget:${relayId}`, 'budget');
  if (!row) return 0;
  const val = parseFloat(row.value_encrypted);
  return isNaN(val) ? 0 : val;
}

/**
 * Set the daily budget for a specific relay node.
 * @param {string} relayId
 * @param {number} budgetKas - budget in KAS (0 = unlimited)
 */
export async function setRelayBudget(relayId, budgetKas) {
  const val = parseFloat(budgetKas);
  if (isNaN(val) || val < 0) throw new Error('Invalid budget value');
  const key = `budget:${relayId}`;
  const now = new Date().toISOString();
  // config_entries.id 是 PRIMARY KEY 需非空 + ON CONFLICT 需 UNIQUE(key) 索引 (未知),
  // 故分 SELECT → UPDATE/INSERT 两步, 幂等安全.
  const existing = sqlite.prepare('SELECT id FROM config_entries WHERE key = ?').get(key);
  if (existing) {
    sqlite.prepare(
      'UPDATE config_entries SET value_encrypted = ?, value_plain_hint = ?, updated_at = ? WHERE id = ?'
    ).run(String(val), String(val), now, existing.id);
  } else {
    sqlite.prepare(
      'INSERT INTO config_entries (id, key, category, value_encrypted, value_plain_hint, is_sensitive, created_at, updated_at) VALUES (?, ?, \'budget\', ?, ?, 0, ?, ?)'
    ).run(randomUUID(), key, String(val), String(val), now, now);
  }
}

/**
 * Remove the budget config for a relay node (reset to unlimited).
 * @param {string} relayId
 */
export function clearRelayBudget(relayId) {
  sqlite.prepare('DELETE FROM config_entries WHERE key = ?').run(`budget:${relayId}`);
}

/**
 * Resolve relayId → agent_address (relay address).
 * @param {string} relayId
 * @returns {string|null}
 */
function getAgentAddress(relayId) {
  const row = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayId);
  return row?.address || null;
}

/**
 * Get today's total spending for a relay node (UTC day).
 * @param {string} relayId
 * @returns {Promise<{total: number, count: number, lastTx: string|null}>}
 */
export async function getTodaySpend(relayId) {
  const agentAddress = getAgentAddress(relayId);
  if (!agentAddress) return { total: 0, count: 0, lastTx: null };

  const utcToday = new Date().toISOString().slice(0, 10);
  const row = sqlite.prepare(`
    SELECT COALESCE(SUM(amount_kas), 0) as total, COUNT(*) as count, MAX(created_at) as lastTx
    FROM social_spend_log
    WHERE agent_address = ?
      AND DATE(created_at) = ?
      AND category = 'social'
  `).get(agentAddress, utcToday);
  return {
    total: row?.total || 0,
    count: row?.count || 0,
    lastTx: row?.lastTx || null,
  };
}

/**
 * Record a broadcast fee in the social_spend_log.
 * @param {object} params
 * @param {string} params.relayId
 * @param {string} params.txId
 * @param {number} params.fee
 * @param {string} [params.channel]
 * @param {string} [params.content]
 */
export function recordSpend({ relayId, txId, fee, channel, content }) {
  const agentAddress = getAgentAddress(relayId);
  if (!agentAddress) return;

  sqlite.prepare(`
    INSERT OR IGNORE INTO social_spend_log (id, agent_address, category, amount_kas, tx_hash, created_at)
    VALUES (?, ?, 'social', ?, ?, datetime('now'))
  `).run(randomUUID(), agentAddress, parseFloat(fee), txId);
}

/**
 * Check if a relay has budget remaining for a given fee amount.
 * Returns { allowed: true } or { allowed: false, reason, spent, budget, remaining }.
 * @param {string} relayId
 * @param {number} feeKas
 * @returns {{ allowed: boolean, spent?: number, budget?: number, remaining?: number, reason?: string }}
 */
export async function checkBudget(relayId, feeKas) {
  const budget = await getRelayBudget(relayId);
  if (budget <= 0) return { allowed: true }; // unlimited

  const { total: spent } = await getTodaySpend(relayId);
  const remaining = budget - spent;

  if (remaining <= 0) {
    return { allowed: false, spent, budget, remaining: 0, reason: `今日预算已用完 (已花费 ${spent.toFixed(4)} / ${budget.toFixed(4)} KAS)` };
  }

  if (feeKas > remaining) {
    return { allowed: false, spent, budget, remaining, reason: `本次广播费用 ${feeKas.toFixed(4)} KAS 超出剩余预算 (${remaining.toFixed(4)} KAS)` };
  }

  return { allowed: true, spent, budget, remaining };
}

/**
 * Get budget info for a relay (for UI display).
 * @param {string} relayId
 * @returns {Promise<{ budget: number, spent: number, remaining: number, count: number, lastTx: string|null, isUnlimited: boolean }>}
 */
export async function getBudgetInfo(relayId) {
  const budget = await getRelayBudget(relayId);
  const isUnlimited = budget <= 0;
  const { total: spent, count, lastTx } = await getTodaySpend(relayId);
  const remaining = isUnlimited ? 0 : Math.max(0, budget - spent);
  return { budget: isUnlimited ? 0 : budget, spent, remaining, count, lastTx, isUnlimited };
}

/**
 * Get all agents' budget summaries.
 * @returns {Promise<Array<{ relayId: string, name: string, address: string, budget, spent, remaining, isUnlimited, count }>}
 */
export async function getAllBudgetSummaries() {
  const relays = sqlite.prepare(`
    SELECT r.id, r.name, r.address
    FROM relay_nodes r
    WHERE r.id IS NOT NULL
  `).all();

  const results = [];
  for (const relay of relays) {
    const info = await getBudgetInfo(relay.id);
    results.push({
      relayId: relay.id,
      name: relay.name,
      address: relay.address,
      ...info,
    });
  }
  return results;
}
