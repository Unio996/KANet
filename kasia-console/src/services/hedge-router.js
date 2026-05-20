// hedge-router.js — Phase 5-2.5 CEX capability-aware router (NWT N19.69 spec, J2 ship)
//
// Backward compat: hedge_router_enabled=false → behavior identical to pre-router picker
// (Phase 1a hedge_placed milestone 不破).
//
// Knob-driven routing decisions:
// 1. caller preferredCex 仍 honor (top priority)
// 2. router_enabled=false → default account (legacy path)
// 3. mode=auto_e2e → Gate.io (auto-withdraw 闭环, 重度压测/CI 路)
// 4. orderValueUsdt < small_order_threshold → KuCoin (min $0.10)
// 5. brokerKPool < kas_floor → Gate.io (low pool, fallback to auto-withdraw CEX)
// 6. default → Bybit (production, 高流动性)
//
// Failover chain: any place fail → tryNext in chain CSV.

import { getConfig } from '../data/settings/configs.js';
import { sqlite } from '../db/client.js';

const HEDGE_CEX_MAP = {
  bybit: 'bybit', gate: 'gateio', 'gate.io': 'gateio', gateio: 'gateio',
  kucoin: 'kucoin', bitget: 'bitget', mexc: 'mexc',
};

function getAccountByName(name) {
  if (!name) return null;
  const normalized = HEDGE_CEX_MAP[name.toLowerCase()] || name.toLowerCase();
  return sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ?').get(normalized);
}

function getDefaultAccount() {
  return sqlite.prepare('SELECT * FROM exchange_accounts WHERE is_default = 1 LIMIT 1').get()
    || sqlite.prepare('SELECT * FROM exchange_accounts LIMIT 1').get();
}

// Phase 5-2.5: broker K-pool query (treasury_snapshot 5min stale OK for routing).
// Returns null if no recent snapshot (treasury_monitor may not yet include KAS branch — Phase 5-2 Sub-1).
function getBrokerKPool() {
  try {
    // KI 42 fix: ORDER BY id DESC (auto-increment) — snapshot_at 同秒精度可能 tie, id 保证 strict order.
    const row = sqlite.prepare(`
      SELECT balance_human FROM treasury_snapshot
      WHERE chain='kaspa' AND asset='KAS'
      ORDER BY id DESC LIMIT 1
    `).get();
    return row ? Number(row.balance_human) : null;
  } catch { return null; }
}

export async function selectHedgeAccount({ preferredCex, orderValueUsdt, side, mode = 'production' }) {
  // 1. Caller override (test framework, manual hedge) — 永 honor
  if (preferredCex) {
    const acct = getAccountByName(preferredCex);
    if (acct) return { account: acct, route: 'caller_override' };
  }

  // 2. Router disabled (backward compat — Phase 1a 不破)
  const enabled = (await getConfig('hedge_router_enabled')) === 'true';
  if (!enabled) {
    return { account: getDefaultAccount(), route: 'router_disabled' };
  }

  // 3. Auto-e2e mode (CI / 重度压测) → Gate.io (auto-withdraw 完整闭环)
  if (mode === 'auto_e2e') {
    const cex = await getConfig('hedge_router_auto_e2e_cex') || 'gateio';
    return { account: getAccountByName(cex), route: 'auto_e2e' };
  }

  // 4. Small order (< small_order_threshold USD) → KuCoin ($0.10 min)
  const smallThreshold = parseFloat(await getConfig('hedge_router_small_order_threshold_usd') || '5');
  if (orderValueUsdt && orderValueUsdt < smallThreshold) {
    const cex = await getConfig('hedge_router_small_order_cex') || 'kucoin';
    return { account: getAccountByName(cex), route: 'small_order' };
  }

  // 5. Broker K-pool low → 转 auto-withdraw CEX (Gate.io)
  const kPool = getBrokerKPool();
  const kasFloor = parseFloat(await getConfig('hedge_router_kas_floor_for_default') || '5000');
  if (kPool !== null && kPool < kasFloor) {
    const cex = await getConfig('hedge_router_auto_e2e_cex') || 'gateio';
    return { account: getAccountByName(cex), route: 'k_pool_low' };
  }

  // 6. Default (production) → Bybit (high liquidity)
  const cex = await getConfig('hedge_router_default_cex') || 'bybit';
  return { account: getAccountByName(cex), route: 'default' };
}

// Failover chain (called by _executeHedge when primary placeOrder fails).
export async function getFailoverChain(failedCex) {
  const chainCsv = await getConfig('hedge_router_failover_chain') || 'bybit,gateio,kucoin';
  const chain = chainCsv.split(',').map(s => s.trim());
  const idx = chain.indexOf(failedCex);
  return idx >= 0 ? chain.slice(idx + 1) : chain;
}

export const _internals = { getAccountByName, getDefaultAccount, getBrokerKPool };
