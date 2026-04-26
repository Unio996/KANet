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

export const ASSETS = {
  KAS_kaspa: {
    symbol: 'KAS', chain: 'kaspa', decimals: 8, contract: null,
    settler: 'kasia', priceOracle: 'cmc:KAS', minQty: 1.0, displayName: 'KAS',
  },
  USDT_bnb: {
    symbol: 'USDT', chain: 'bnb', decimals: 18, contract: '0x55d398326f99059fF775485246999027B3197955',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (BSC)',
  },
  USDT_eth: {
    symbol: 'USDT', chain: 'eth', decimals: 6, contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    settler: 'evm', priceOracle: 'fixed:1.0', minQty: 0.1, displayName: 'USDT (Ethereum)',
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
