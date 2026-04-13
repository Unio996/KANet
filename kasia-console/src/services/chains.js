/**
 * Chains Registry — single source of truth for EVM chain metadata.
 *
 * Why: EVM_RPC_URLS, STABLECOINS, explorer URLs and native symbols used to be
 * duplicated across relay.js, evm-transfer.js, cross-chain-verify, kanet-ui.js,
 * portfolio.eta etc. Adding a new chain meant editing 5 files. Adding USDC.e on
 * a new chain meant editing 3 and hoping nothing was missed.
 *
 * This module centralizes all of it. Adding a new chain = one entry in CHAIN_META.
 *
 * Each chain entry contains:
 *   - chainId         — EIP-155 numeric chain ID (null for non-EVM)
 *   - isEvm           — true if EVM-compatible
 *   - nativeSymbol    — e.g. 'MATIC' for Polygon, 'ETH' for L2s
 *   - rpcPool         — ordered array of public RPC URLs, tried in order with fallback
 *   - explorer        — { address: fn(addr) => url, tx: fn(hash) => url }
 *   - stables         — { usdt?, usdc?, usdcExtras? }
 */

import { ethers } from 'ethers';

// ── Registry ──────────────────────────────────────────────────────────────

export const CHAIN_META = {
  kaspa: {
    chainId: null,
    isEvm: false,
    nativeSymbol: 'KAS',
    rpcPool: [], // Kaspa uses its own RPC resolver in shared/lib/rpc-utils.mjs
    explorer: {
      address: (a) => `https://explorer.kaspa.org/addresses/${a}`,
      tx: (h) => `https://explorer.kaspa.org/txs/${h}`,
    },
    stables: {},
  },

  bnb: {
    chainId: 56,
    isEvm: true,
    nativeSymbol: 'BNB',
    rpcPool: [
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc.publicnode.com',
      'https://rpc.ankr.com/bsc',
    ],
    explorer: {
      address: (a) => `https://bscscan.com/address/${a}`,
      tx: (h) => `https://bscscan.com/tx/${h}`,
    },
    stables: {
      usdt: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      usdc: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    },
  },

  eth: {
    chainId: 1,
    isEvm: true,
    nativeSymbol: 'ETH',
    rpcPool: [
      'https://eth.llamarpc.com',
      'https://ethereum.publicnode.com',
      'https://rpc.ankr.com/eth',
      'https://cloudflare-eth.com',
    ],
    explorer: {
      address: (a) => `https://etherscan.io/address/${a}`,
      tx: (h) => `https://etherscan.io/tx/${h}`,
    },
    stables: {
      usdt: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },

  polygon: {
    chainId: 137,
    isEvm: true,
    nativeSymbol: 'MATIC',
    rpcPool: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon.llamarpc.com',
    ],
    explorer: {
      address: (a) => `https://polygonscan.com/address/${a}`,
      tx: (h) => `https://polygonscan.com/tx/${h}`,
    },
    stables: {
      usdt: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      usdc: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      usdcExtras: [
        { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6, label: 'USDC.e' },
      ],
    },
  },

  arbitrum: {
    chainId: 42161,
    isEvm: true,
    nativeSymbol: 'ETH',
    rpcPool: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum.publicnode.com',
      'https://rpc.ankr.com/arbitrum',
      'https://arbitrum.llamarpc.com',
    ],
    explorer: {
      address: (a) => `https://arbiscan.io/address/${a}`,
      tx: (h) => `https://arbiscan.io/tx/${h}`,
    },
    stables: {
      usdt: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
      usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      usdcExtras: [
        { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6, label: 'USDC.e' },
      ],
    },
  },

  optimism: {
    chainId: 10,
    isEvm: true,
    nativeSymbol: 'ETH',
    rpcPool: [
      'https://mainnet.optimism.io',
      'https://optimism.publicnode.com',
      'https://rpc.ankr.com/optimism',
      'https://optimism.llamarpc.com',
    ],
    explorer: {
      address: (a) => `https://optimistic.etherscan.io/address/${a}`,
      tx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    },
    stables: {
      usdt: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
      usdc: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      usdcExtras: [
        { address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6, label: 'USDC.e' },
      ],
    },
  },

  avalanche: {
    chainId: 43114,
    isEvm: true,
    nativeSymbol: 'AVAX',
    rpcPool: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche.publicnode.com',
      'https://rpc.ankr.com/avalanche',
    ],
    explorer: {
      address: (a) => `https://snowtrace.io/address/${a}`,
      tx: (h) => `https://snowtrace.io/tx/${h}`,
    },
    stables: {
      usdt: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
      usdc: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
      usdcExtras: [
        { address: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', decimals: 6, label: 'USDC.e' },
      ],
    },
  },

  base: {
    chainId: 8453,
    isEvm: true,
    nativeSymbol: 'ETH',
    rpcPool: [
      'https://mainnet.base.org',
      'https://base.publicnode.com',
      'https://rpc.ankr.com/base',
      'https://base.llamarpc.com',
    ],
    explorer: {
      address: (a) => `https://basescan.org/address/${a}`,
      tx: (h) => `https://basescan.org/tx/${h}`,
    },
    stables: {
      usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      usdcExtras: [
        { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6, label: 'USDbC' },
      ],
    },
  },

  sol: {
    chainId: null,
    isEvm: false,
    nativeSymbol: 'SOL',
    rpcPool: [],
    explorer: {
      address: (a) => `https://solscan.io/account/${a}`,
      tx: (h) => `https://solscan.io/tx/${h}`,
    },
    stables: {},
  },

  tron: {
    chainId: null,
    isEvm: false,
    nativeSymbol: 'TRX',
    rpcPool: [],
    explorer: {
      address: (a) => `https://tronscan.org/#/address/${a}`,
      tx: (h) => `https://tronscan.org/#/transaction/${h}`,
    },
    stables: {},
  },
};

// ── Derived lists ─────────────────────────────────────────────────────────

export const EVM_CHAINS = Object.entries(CHAIN_META)
  .filter(([, m]) => m.isEvm)
  .map(([k]) => k);

export const SUPPORTED_CHAINS = Object.keys(CHAIN_META).filter(k => k !== 'kaspa');

// Back-compat shim for the legacy `STABLECOINS[chain]` shape used in relay.js
export const STABLECOINS = Object.fromEntries(
  Object.entries(CHAIN_META)
    .filter(([, m]) => m.isEvm && (m.stables.usdt || m.stables.usdc))
    .map(([k, m]) => [k, m.stables])
);

export const EVM_RPC_URLS = Object.fromEntries(
  Object.entries(CHAIN_META)
    .filter(([, m]) => m.isEvm)
    .map(([k, m]) => [k, m.rpcPool[0]])
);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Try each RPC in the chain's pool until one succeeds.
 * Per-RPC timeout is short (default 4s) so fallback is fast.
 *
 * Usage:
 *   const balance = await withFallbackRpc('eth', async (provider) => {
 *     return provider.getBalance(addr);
 *   });
 */
export async function withFallbackRpc(chain, fn, { timeoutMs = 4000 } = {}) {
  const meta = CHAIN_META[chain];
  if (!meta?.isEvm) throw new Error(`withFallbackRpc: ${chain} is not EVM`);
  const pool = meta.rpcPool || [];
  if (pool.length === 0) throw new Error(`withFallbackRpc: no RPC pool for ${chain}`);

  let lastErr;
  for (const url of pool) {
    let provider;
    try {
      provider = new ethers.JsonRpcProvider(url);
      const result = await Promise.race([
        Promise.resolve(fn(provider)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`rpc-timeout ${url}`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (e) {
      lastErr = e;
    } finally {
      // Critical: ethers v6 JsonRpcProvider kicks off an internal network-detection
      // retry loop that keeps running even after the outer Promise settles. If we
      // don't destroy() it, dead URLs leak providers that flood the log with
      // "JsonRpcProvider failed to detect network; retry in 1s" forever.
      try { provider?.destroy?.(); } catch {}
    }
  }
  throw lastErr || new Error(`All RPCs failed for ${chain}`);
}

/**
 * Run fn with a freshly-constructed JsonRpcProvider for the given URL, and
 * guarantee the provider is destroyed afterward (even on error / timeout).
 *
 * This is critical: ethers.js v6 JsonRpcProvider starts an internal
 * network-detection retry loop in its constructor. If the URL is dead, that
 * loop runs forever (emitting "JsonRpcProvider failed to detect network; retry
 * in 1s" every second) until provider.destroy() is called or the object is
 * garbage-collected. Without destroy(), dead RPCs cause a log flood and
 * memory leak. Always wrap provider use in withProvider().
 *
 * @param {string} rpcUrl — RPC URL
 * @param {(provider: ethers.JsonRpcProvider) => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] — optional outer timeout in ms (default: no timeout)
 * @returns {Promise<T>}
 */
export async function withProvider(rpcUrl, fn, { timeoutMs } = {}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    if (timeoutMs && timeoutMs > 0) {
      return await Promise.race([
        Promise.resolve(fn(provider)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`rpc-timeout ${rpcUrl}`)), timeoutMs)),
      ]);
    }
    return await fn(provider);
  } finally {
    try { provider?.destroy?.(); } catch {}
  }
}

export function getExplorerAddressUrl(chain, address) {
  return CHAIN_META[chain]?.explorer?.address?.(address) || null;
}

export function getExplorerTxUrl(chain, hash) {
  return CHAIN_META[chain]?.explorer?.tx?.(hash) || null;
}

export function getNativeSymbol(chain) {
  return CHAIN_META[chain]?.nativeSymbol || chain?.toUpperCase() || '';
}

export function isEvmChain(chain) {
  return !!CHAIN_META[chain]?.isEvm;
}

/**
 * Return a compact meta object safe to expose to the frontend.
 * Used by GET /api/chains/meta — the portfolio page fetches this once on load.
 */
export function getPublicMeta() {
  const out = {};
  for (const [chain, m] of Object.entries(CHAIN_META)) {
    out[chain] = {
      chainId: m.chainId,
      isEvm: m.isEvm,
      nativeSymbol: m.nativeSymbol,
      explorer: {
        // Store as template strings the frontend can interpolate
        addressTemplate: m.explorer.address('__ADDR__'),
        txTemplate: m.explorer.tx('__HASH__'),
      },
      stables: {
        usdt: m.stables.usdt ? { address: m.stables.usdt.address } : null,
        usdc: m.stables.usdc ? { address: m.stables.usdc.address } : null,
        usdcExtras: (m.stables.usdcExtras || []).map(e => ({ address: e.address, label: e.label })),
      },
    };
  }
  return out;
}
