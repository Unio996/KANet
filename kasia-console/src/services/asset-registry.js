/**
 * asset-registry.js — Phase B v1.1 (J1, Owner 22:23 钦定 'KAS 参数化 = X↔Y 市场')
 *
 * 真 prior art (J1 part 3 实证): exchange_offers schema 已 asset-generic
 * (give_asset/want_asset/give_chain/want_chain). broker handler 上层 hardcode 'KAS'
 * 是 v1.0 MVP 简化, 真 v1.1 generic 化只需把 hardcode 替换查 registry.
 *
 * 单一真相源: 支持的 asset × chain 元数据.
 * - Phase A (NWT) 用 ASSETS lookup 替 fetchKasPrice / MIN_QTY_KAS 等 hardcode.
 * - Phase B (J1, 本文件 + settler-router.js) 抽 send 接口.
 *
 * 不重发明轮子 (Owner 22:25 钦定): evm-transfer 已 multi-chain, sol-transfer / tron-transfer
 * 已存在. registry 只是 索引 + 路由配置, 不重写 settler 实施.
 */

/**
 * 支持的 asset × chain 元数据.
 * key 格式: `{symbol}_{chain}` (KAS_kaspa, USDT_bnb, USDT_eth, ...).
 *
 * @typedef {Object} AssetMeta
 * @property {string} symbol — 交易符号 (KAS / USDT / USDC)
 * @property {string} chain — 链 (kaspa / bnb / eth / polygon / sol / tron)
 * @property {number} decimals — 链上 unit decimals (KAS=8, USDT-bnb=18, USDT-eth=6)
 * @property {string|null} contract — EVM contract address (null for native)
 * @property {string} settler — settler-router 路由 id ('kasia' / 'evm' / 'sol' / 'tron')
 * @property {string} priceOracle — 'cmc:KAS' / 'fixed:1.0' / 'oracle:USDT'
 * @property {number} minQty — broker 接最小数量 (qty < minQty → reject dust)
 * @property {string} displayName — DM/UI 显示名 ('KAS' / 'USDT (BSC)' / 'USDT (Ethereum)')
 */

// T-J1-2026-04-27 v1.1 真 generic (Owner 23:14 钦定 'kanet 钱包支持多少条链? 方向不是非常明确吗?'):
// chains.js CHAIN_META 才是真 source of truth (services/chains.js register 10 chain × multi-stable).
// J2 #3 23:14 真 grep 实证, J1 23:11 投 (a) 错估 → 撤回. 真扩 EVM stables 全 chains 真覆盖.
//
// 不 auto-derive (避 backward compat 真 break + dynamic import circular risk), 手动 mirror
// chains.js stables block (~14 entries). 加新 chain × stable 时 chains.js + 此 file 双 update.
export const ASSETS = {
  KAS_kaspa: {
    symbol: 'KAS', chain: 'kaspa', decimals: 8, contract: null,
    settler: 'kasia', priceOracle: 'cmc:KAS', minQty: 1.0, displayName: 'KAS',
  },
  // ── BSC (bnb): USDT + USDC, decimals 18 ──
  USDT_bnb: {
    symbol: 'USDT', chain: 'bnb', decimals: 18, contract: '0x55d398326f99059fF775485246999027B3197955',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (BSC)',
  },
  USDC_bnb: {
    symbol: 'USDC', chain: 'bnb', decimals: 18, contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (BSC)',
  },
  // ── Ethereum (eth): USDT (6) + USDC (6) ──
  USDT_eth: {
    symbol: 'USDT', chain: 'eth', decimals: 6, contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (Ethereum)',
  },
  USDC_eth: {
    symbol: 'USDC', chain: 'eth', decimals: 6, contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (Ethereum)',
  },
  // ── Polygon: USDT + USDC ──
  USDT_polygon: {
    symbol: 'USDT', chain: 'polygon', decimals: 6, contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (Polygon)',
  },
  USDC_polygon: {
    symbol: 'USDC', chain: 'polygon', decimals: 6, contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (Polygon)',
  },
  // ── Arbitrum ──
  USDT_arbitrum: {
    symbol: 'USDT', chain: 'arbitrum', decimals: 6, contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (Arbitrum)',
  },
  USDC_arbitrum: {
    symbol: 'USDC', chain: 'arbitrum', decimals: 6, contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (Arbitrum)',
  },
  // ── Optimism ──
  USDT_optimism: {
    symbol: 'USDT', chain: 'optimism', decimals: 6, contract: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (Optimism)',
  },
  USDC_optimism: {
    symbol: 'USDC', chain: 'optimism', decimals: 6, contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (Optimism)',
  },
  // ── Avalanche ──
  USDT_avalanche: {
    symbol: 'USDT', chain: 'avalanche', decimals: 6, contract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (Avalanche)',
  },
  USDC_avalanche: {
    symbol: 'USDC', chain: 'avalanche', decimals: 6, contract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (Avalanche)',
  },
  // ── Base (no USDT, USDC only) ──
  USDC_base: {
    symbol: 'USDC', chain: 'base', decimals: 6, contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    settler: 'evm', priceOracle: 'peg:1.0', minQty: 0.1, displayName: 'USDC (Base)',
  },
};

/**
 * Lookup asset by symbol + chain.
 *
 * T-J1-2026-04-27 v1.1 Phase A 真测撞 (NWT 22:57 _probe-step3-generic-asset.mjs):
 * 现 broker handler 真调 getAsset(symbol) 单参时撞 null. v1.1 修: chain optional,
 * 单参 lookup 返 first matching ASSETS entry (default chain for that symbol).
 *
 * @param {string} symbol — base symbol (KAS / USDT / USDC)
 * @param {string} [chain] — chain key (optional). 若缺则返 default chain entry.
 * @returns {AssetMeta | null}
 */
export function getAsset(symbol, chain) {
  if (!symbol) return null;
  const upperSymbol = symbol.toUpperCase();
  if (chain) {
    return ASSETS[`${upperSymbol}_${chain.toLowerCase()}`] || null;
  }
  // chain optional — return first matching entry (default chain for symbol)
  for (const key in ASSETS) {
    if (ASSETS[key].symbol === upperSymbol) return ASSETS[key];
  }
  return null;
}

/**
 * List all asset symbols (e.g. for LLM SYSTEM_PROMPT supported assets table).
 * @returns {string[]}
 */
export function listAssets() {
  return [...new Set(Object.values(ASSETS).map(a => a.symbol))];
}

/**
 * List all chains supported for given asset symbol.
 * @param {string} symbol
 * @returns {string[]}
 */
export function listChainsFor(symbol) {
  return Object.values(ASSETS).filter(a => a.symbol === symbol.toUpperCase()).map(a => a.chain);
}

/**
 * Check if asset × chain combo is supported.
 * @param {string} symbol
 * @param {string} [chain] — optional, 若缺则查 symbol 是否有任何 chain entry
 * @returns {boolean}
 */
export function isSupported(symbol, chain) {
  return !!getAsset(symbol, chain);
}
