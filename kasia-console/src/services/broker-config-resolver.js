// broker-config-resolver.js — KI 65 Block A.2 (NWT N19.196/197/198)
//
// 解耦 87 references hardcoded BROKER_RELAY_ID across broker-* files.
// Provides config-driven helpers:
//   - getBrokerRelay(scope?)         → relay_node row with roles=['broker',...]
//   - getMarketMakerRelay()          → relay_node row with roles=['marketmaker',...]
//   - getAllBrokers()                → array (multi-broker future)
//   - getBrokerFeeRate(relay_id)     → REAL (fee_rate_override OR system default 0.005)
//   - getBrokerFeeKas(relay_id, trade_size_kas)  → clamp(size × rate, 0.05, 10)
//
// Spec: NWT N19.198 fee 公式 = flat 0.5% with floor 0.05 cap 10, UI 可调.
// Block A.3 (87 ref → helper) 会用此 module 替换 BROKER_RELAY_ID hardcoded.

import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';

// System default fee rate (config_entries key 'broker_fee_rate_default').
// Fallback 0.005 (= 0.5%) if config not set.
const FEE_RATE_DEFAULT_KEY = 'broker_fee_rate_default';
const FEE_RATE_FALLBACK = 0.005;
const FEE_KAS_FLOOR = 0.05;
const FEE_KAS_CAP = 10;

/**
 * Get the primary broker relay (first relay with 'broker' role).
 *
 * @param {string|null} scope — optional scope filter ('exchange' / 'prediction'); reserved for future cross-product, NOT enforced in v1.
 * @returns {object|null} relay_nodes row or null
 */
export function getBrokerRelay(scope = null) {
  // v138 roles_json populated for all relays (A.1.2 backfill ensures no NULL).
  // Match relays with 'broker' role.
  // scope param reserved for future cross-product attribution; v1 ignores (single broker scope).
  const row = sqlite.prepare(`
    SELECT * FROM relay_nodes
    WHERE roles_json LIKE '%"broker"%'
    ORDER BY created_at ASC
    LIMIT 1
  `).get();
  return row || null;
}

/**
 * Get all broker relays (for multi-broker iteration).
 * @returns {object[]} array of relay_nodes rows
 */
export function getAllBrokers() {
  return sqlite.prepare(`
    SELECT * FROM relay_nodes
    WHERE roles_json LIKE '%"broker"%'
    ORDER BY created_at ASC
  `).all();
}

/**
 * Get the MarketMaker relay (separate role from broker per Block A.5 sweep).
 * For now (pre-A.5), broker + marketmaker often same relay (Trader-B has both).
 *
 * @returns {object|null} relay_nodes row or null
 */
export function getMarketMakerRelay() {
  // Prefer relay with 'marketmaker' role explicitly; fall back to broker for backward compat.
  let row = sqlite.prepare(`
    SELECT * FROM relay_nodes
    WHERE roles_json LIKE '%"marketmaker"%'
    ORDER BY created_at ASC
    LIMIT 1
  `).get();
  if (!row) {
    // Fallback: broker also acts as MarketMaker pre-A.5 sweep.
    row = getBrokerRelay();
  }
  return row || null;
}

/**
 * Get the fee rate for a specific broker.
 * Per-broker override (relay_nodes.fee_rate_override) wins, else system default.
 *
 * @param {string} relayId — relay_nodes.id
 * @returns {Promise<number>} fee rate (e.g. 0.005 = 0.5%)
 */
export async function getBrokerFeeRate(relayId) {
  const row = sqlite.prepare(`SELECT fee_rate_override FROM relay_nodes WHERE id = ?`).get(relayId);
  if (row && row.fee_rate_override !== null && row.fee_rate_override !== undefined) {
    return row.fee_rate_override;
  }
  // System default — config_entries key OR fallback 0.005
  const cfgVal = await getConfig(FEE_RATE_DEFAULT_KEY).catch(() => null);
  if (cfgVal !== null && cfgVal !== undefined) {
    const parsed = parseFloat(cfgVal);
    if (!isNaN(parsed) && parsed > 0 && parsed < 1) return parsed;
  }
  return FEE_RATE_FALLBACK;
}

/**
 * Compute broker fee KAS for a given trade size.
 * Owner 5/22 09:48 钦定 formula:
 *   fee_kas = clamp(trade_size_kas × rate, floor 0.05, cap 10)
 *
 * Examples (rate=0.005 default):
 *   1 KAS    → floor 0.05 (= 5% small-trade dust防)
 *   10 KAS   → 0.05 (= 0.5%)
 *   100 KAS  → 0.5 (= 0.5%)
 *   1000 KAS → 5 (= 0.5%)
 *   2000+    → cap 10 (= ≤0.5%)
 *
 * @param {string} relayId — relay_nodes.id
 * @param {number} tradeSizeKas — KAS amount being traded
 * @returns {Promise<number>} fee KAS (>= floor, <= cap)
 */
export async function getBrokerFeeKas(relayId, tradeSizeKas) {
  if (!tradeSizeKas || tradeSizeKas <= 0) return FEE_KAS_FLOOR;
  const rate = await getBrokerFeeRate(relayId);
  const raw = tradeSizeKas * rate;
  return Math.max(FEE_KAS_FLOOR, Math.min(FEE_KAS_CAP, raw));
}

// Constants exported for testing + lint rule visibility
export const _internals = {
  FEE_RATE_DEFAULT_KEY,
  FEE_RATE_FALLBACK,
  FEE_KAS_FLOOR,
  FEE_KAS_CAP,
};
