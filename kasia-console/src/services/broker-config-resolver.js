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
  // A.2.1 hotfix (NWT N19.204): use json_each精确 match (LIKE substring 不 robust 防 future role 名 substring overlap).
  // scope param reserved for future cross-product attribution; v1 ignores (single broker scope).
  const row = sqlite.prepare(`
    SELECT rn.* FROM relay_nodes rn
    WHERE EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'broker')
    ORDER BY rn.created_at ASC
    LIMIT 1
  `).get();
  return row || null;
}

/**
 * Get primary broker relay ID — throws if not configured.
 * Use this in call sites that need broker_id 真 runtime resolved (no hardcoded fallback per A.3.1.1).
 *
 * @returns {string} relay_nodes.id
 * @throws {Error} if no broker relay registered
 */
export function getBrokerRelayIdOrThrow() {
  const r = getBrokerRelay();
  if (!r) throw new Error('No broker relay configured (roles_json includes "broker")');
  return r.id;
}

/**
 * Get all broker relays (for multi-broker iteration).
 * @returns {object[]} array of relay_nodes rows
 */
export function getAllBrokers() {
  return sqlite.prepare(`
    SELECT rn.* FROM relay_nodes rn
    WHERE EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'broker')
    ORDER BY rn.created_at ASC
  `).all();
}

/**
 * Block A.3 Wave 3 (NWT r248): broker/marketmaker org member names.
 * Used by cross-match-engine self-deal anti-spam check (= broker family 不该相互match).
 * @returns {string[]} array of relay_nodes.name strings
 */
export function getBrokerOrgNames() {
  return sqlite.prepare(`
    SELECT name FROM relay_nodes rn
    WHERE EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value IN ('broker', 'marketmaker'))
  `).all().map(r => r.name);
}

/**
 * Get MarketMaker relay ID — throws if not configured.
 * A.3.3 wave 3 (NWT N19.208): MarketMaker role files use this helper.
 * Pre-A.5 sweep: broker also acts as MarketMaker (Trader-B has both roles).
 *
 * @returns {string} relay_nodes.id
 * @throws {Error} if no MarketMaker relay registered (and no broker fallback either)
 */
export function getMarketMakerRelayIdOrThrow() {
  const r = getMarketMakerRelay();
  if (!r) throw new Error('No MarketMaker relay configured (roles_json includes "marketmaker" OR broker fallback)');
  return r.id;
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
    SELECT rn.* FROM relay_nodes rn
    WHERE EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'marketmaker')
    ORDER BY rn.created_at ASC
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
  // A.2.1 hotfix (NWT N19.204 push 2): 0 trade = 0 fee (not floor). illogical to charge 0.05 KAS on 0-size trade.
  if (!tradeSizeKas || tradeSizeKas <= 0) return 0;
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
