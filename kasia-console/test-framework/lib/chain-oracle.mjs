// chain-oracle.mjs — KANet test framework chain-state snapshot + reconcile utility
//
// J1 ship Phase 2 (i) — turn manual 5-cycle chain reconcile (BSC USDT/USDC + Kasia KAS)
// into deterministic API. Used by adversarial probes + regression suite + e2e PASS verify.
//
// Owner 钦定 '一旦发现问题就迭代改进' — 真 chain reconcile 真 oracle 真 always exposed,
// failure 真 expected_flows mismatch 真 immediate detect.
//
// Standalone: 真 framework-independent, 真 callable from any test or smoke script.
// 真 no new dependencies (uses fetch + better-sqlite3, both already in console).
//
// Usage:
//   import { snapshotAllWallets, reconcile, diff } from './chain-oracle.mjs';
//
//   const before = await snapshotAllWallets({ peers: ['Sophie', 'Eric', 'Martin'], broker: true });
//   // ... run test ...
//   const after = await snapshotAllWallets({ peers: [...], broker: true });
//   const result = reconcile(before, after, [
//     { peer: 'Eric', asset: 'USDT', chain: 'bnb', delta: -1.01 },
//     { peer: 'Eric', asset: 'USDC', chain: 'bnb', delta: +1 },
//     { peer: 'broker', asset: 'USDT', chain: 'bnb', delta: +1.01 },
//     { peer: 'broker', asset: 'USDC', chain: 'bnb', delta: -1 },
//   ]);
//   if (!result.ok) throw new Error(`reconcile fail: ${result.errors.join(', ')}`);

import Database from 'better-sqlite3';

// ── EVM RPC + ERC20 token map (mirror cross-chain-verify.mjs registry) ──
const EVM_RPC = {
  bnb: 'https://bsc-dataseed.binance.org',
  eth: 'https://eth.llamarpc.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  base: 'https://mainnet.base.org',
};

const EVM_TOKENS = {
  bnb: {
    USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  },
  eth: {
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  },
  polygon: {
    USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  },
};

const KASPA_RPC = 'https://api.kaspa.org';
const BROKER_NAMES = ['Trader-A', 'Trader-B', 'broker', 'qrxw'];  // multiple aliases
const BROKER_KASIA_FALLBACK = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const BROKER_BSC_FALLBACK = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';

// ── EVM helpers ──
async function evmBalance(chain, tokenAddr, holderAddr, decimals) {
  const data = '0x70a08231' + holderAddr.slice(2).padStart(64, '0');
  const r = await fetch(EVM_RPC[chain], {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: tokenAddr, data }, 'latest'] }),
  }).then(r => r.json()).catch(() => ({ result: '0x0' }));
  return Number(BigInt(r.result || '0x0')) / Math.pow(10, decimals);
}

async function evmNative(chain, holderAddr) {
  const r = await fetch(EVM_RPC[chain], {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [holderAddr, 'latest'] }),
  }).then(r => r.json()).catch(() => ({ result: '0x0' }));
  return Number(BigInt(r.result || '0x0')) / 1e18;
}

async function kaspaBalance(addr) {
  const r = await fetch(`${KASPA_RPC}/addresses/${encodeURIComponent(addr)}/balance`)
    .then(r => r.json()).catch(() => ({ balance: 0 }));
  return (r.balance || 0) / 1e8;
}

// ── Address resolver — lookup peer name → kasia + EVM addresses ──
function resolveAddresses({ name, dbPath = './data/console.db' }) {
  const db = new Database(dbPath, { readonly: true });
  try {
    if (BROKER_NAMES.includes(name) || name === 'broker') {
      // broker addresses (cross-machine: may not be in J1 console.db, use fallback)
      const row = db.prepare(`SELECT rn.address as kasia FROM relay_nodes rn WHERE rn.name = ? OR rn.name LIKE 'Trader%' LIMIT 1`).get(name);
      return {
        kasia: row?.kasia || BROKER_KASIA_FALLBACK,
        bsc: BROKER_BSC_FALLBACK,
      };
    }
    const relay = db.prepare(`SELECT id, address as kasia FROM relay_nodes WHERE name = ?`).get(name);
    if (!relay) return null;
    const wallets = db.prepare(`SELECT chain, address FROM agent_wallets WHERE relay_node_id = ? AND is_default = 1`).all(relay.id);
    const result = { kasia: relay.kasia };
    for (const w of wallets) result[w.chain] = w.address;
    return result;
  } finally { db.close(); }
}

// ── Public API ──

/**
 * Snapshot all relevant wallet balances.
 *
 * @param {Object} opts
 * @param {string[]} opts.peers — list of agent names ('Sophie', 'Eric', 'Martin', 'broker')
 * @param {string[]} [opts.assets=['USDT','USDC','KAS']] — assets to snapshot
 * @param {string[]} [opts.evmChains=['bnb']] — EVM chains for stable assets
 * @param {string} [opts.dbPath='./data/console.db'] — console DB path for address lookup
 * @returns {Object} snapshot — { peer: { asset_chain: balance, addr_chain: address } }
 */
export async function snapshotAllWallets({ peers, assets = ['USDT', 'USDC', 'KAS'], evmChains = ['bnb'], dbPath = './data/console.db' } = {}) {
  const snap = { _ts: new Date().toISOString(), _peers: peers, _assets: assets, _chains: evmChains };

  for (const peer of peers) {
    const addrs = resolveAddresses({ name: peer, dbPath });
    if (!addrs) {
      snap[peer] = { _error: 'address_resolution_failed' };
      continue;
    }
    snap[peer] = { _addrs: addrs };

    // KAS Kasia balance
    if (assets.includes('KAS') && addrs.kasia) {
      snap[peer]['KAS_kaspa'] = await kaspaBalance(addrs.kasia);
    }

    // EVM stable balances
    for (const chain of evmChains) {
      const evmAddr = addrs[chain] || addrs.bsc;
      if (!evmAddr) continue;
      for (const asset of assets) {
        if (asset === 'KAS') continue;
        const tokMeta = EVM_TOKENS[chain]?.[asset];
        if (!tokMeta) continue;
        snap[peer][`${asset}_${chain}`] = await evmBalance(chain, tokMeta.address, evmAddr, tokMeta.decimals);
      }
      // gas (native)
      snap[peer][`gas_${chain}`] = await evmNative(chain, evmAddr);
    }
  }

  return snap;
}

/**
 * Reconcile two snapshots against expected flows.
 *
 * @param {Object} before — pre-test snapshot
 * @param {Object} after — post-test snapshot
 * @param {Array} expectedFlows — [{ peer, asset, chain, delta }] expected deltas
 * @param {number} [tolerance=0.001] — absolute tolerance for floating-point comparison
 * @returns {Object} { ok, errors, diffs }
 */
export function reconcile(before, after, expectedFlows, tolerance = 0.001) {
  const errors = [];
  const diffs = [];

  for (const flow of expectedFlows) {
    const key = flow.asset === 'KAS' ? `KAS_kaspa` : `${flow.asset}_${flow.chain}`;
    const beforeVal = before[flow.peer]?.[key];
    const afterVal = after[flow.peer]?.[key];
    if (beforeVal === undefined || afterVal === undefined) {
      errors.push(`${flow.peer}.${key}: missing in snapshot`);
      continue;
    }
    const actualDelta = afterVal - beforeVal;
    const matches = Math.abs(actualDelta - flow.delta) < tolerance;
    diffs.push({ ...flow, actualDelta, beforeVal, afterVal, matches });
    if (!matches) {
      errors.push(`${flow.peer}.${key}: expected ${flow.delta >= 0 ? '+' : ''}${flow.delta}, got ${actualDelta >= 0 ? '+' : ''}${actualDelta.toFixed(6)}`);
    }
  }

  return { ok: errors.length === 0, errors, diffs };
}

/**
 * Compute raw diff between two snapshots (no expected flow checking).
 * Returns all changed peer × asset × chain triples.
 */
export function diff(before, after) {
  const changes = [];
  const peers = new Set([...Object.keys(before), ...Object.keys(after)].filter(k => !k.startsWith('_')));
  for (const peer of peers) {
    const b = before[peer] || {};
    const a = after[peer] || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)].filter(k => !k.startsWith('_')));
    for (const key of keys) {
      const bv = b[key];
      const av = a[key];
      if (typeof bv !== 'number' || typeof av !== 'number') continue;
      const d = av - bv;
      if (Math.abs(d) > 0.0001) changes.push({ peer, key, before: bv, after: av, delta: d });
    }
  }
  return changes;
}

// CLI: snapshot + dump
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const peers = process.argv[2]?.split(',') || ['Sophie', 'Eric', 'Martin', 'broker'];
  const snap = await snapshotAllWallets({ peers });
  console.log(JSON.stringify(snap, null, 2));
}
