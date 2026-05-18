/**
 * Across V3 Bridge Config — canonical SpokePool + USDC + RPC mapping.
 *
 * SpokePool 地址来自 Across API 实时返回，确保 checksum。
 * USDC 地址经 polymarket.js 验证。
 * 新增链只需在此添加，无需改业务代码。
 */

import { ethers } from 'ethers';
import { EVM_RPC_URLS, CHAIN_META } from './chains.js';

// All addresses verified checksummed via ethers.getAddress() at startup.
// Source: Across API (app.across.to/api/suggested-fees) live queries.
export const SPOKE_POOLS = /** @type {const} */ ({
  arbitrum: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
  polygon: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
  bnb: '0x4e8E101924eDE233C13e2D8622DC8aED2872d505',
  eth: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  base: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
  optimism: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
});

// Sanity: checksum all at module load
for (const [k, v] of Object.entries(SPOKE_POOLS)) {
  ethers.getAddress(v); // throws immediately if bad
}

export const CHAIN_IDS = /** @type {const} */ ({
  arbitrum: 42161, polygon: 137, bnb: 56, eth: 1, base: 8453, optimism: 10,
});

export const USDC = /** @type {const} */ ({
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // 原生 USDC（Polymarket 用这个）
  bnb: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  eth: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
});

// NWT N18 Owner A 钦定 5/18: USDT addr 5 chain (base 没原生 USDT, skip).
// Across V3 API real-curl-verify USDT support: BSC↔ETH ✓ Polygon↔Arbitrum ✓
// 比 Stargate 便宜 5-10 倍 (L2-L2 0.1-0.5% fee, ~2-30s fill).
export const USDT = /** @type {const} */ ({
  arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  bnb: '0x55d398326f99059fF775485246999027B3197955',
  eth: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  optimism: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  // base: no native USDT — Across rejects, caller must use USDC for base path
});

// Sanity: checksum USDT addr at module load (mirror USDC pattern L24-26)
for (const [k, v] of Object.entries(USDT)) {
  ethers.getAddress(v);
}

/** USDC decimals per chain — BSC 是 18 位，其余都是 6 位 */
export const USDC_DECIMALS = /** @type {const} */({ bnb: 18 });

/** USDT decimals per chain — BSC 是 18 位 (UPVR-DECIMALS-MIGRATION), 其余 6 位 */
export const USDT_DECIMALS = /** @type {const} */({ bnb: 18 });

/** Chains where decimals mismatch (18→6 or 6→18) requires allowUnmatchedDecimals */
export const BNB_CHAINS = new Set(['bnb']);

export function loadConfig() {
  return { SPOKE_POOLS, CHAIN_IDS, USDC, USDT };
}

/** Asset-aware token addr + decimal lookup. NWT N18 5/18: backward compat default 'USDC'. */
function _tokenAddr(cfg, chain, asset) {
  if (asset === 'USDT') {
    if (!cfg.USDT[chain]) throw new Error(`Across USDT not supported on chain=${chain} (base has no native USDT)`);
    return cfg.USDT[chain];
  }
  if (!cfg.USDC[chain]) throw new Error(`Across USDC not supported on chain=${chain}`);
  return cfg.USDC[chain];
}

function _decimals(chain, asset) {
  if (asset === 'USDT') return USDT_DECIMALS[chain] || 6;
  return USDC_DECIMALS[chain] || 6;
}

export async function quoteBridge(fromChain, toChain, amountHuman, config, asset = 'USDC') {
  const cfg = config || loadConfig();
  const decimals = _decimals(fromChain, asset);
  const amount = ethers.parseUnits(String(amountHuman), decimals).toString();
  const params = new URLSearchParams({
    inputToken: _tokenAddr(cfg, fromChain, asset),
    outputToken: _tokenAddr(cfg, toChain, asset),
    originChainId: String(cfg.CHAIN_IDS[fromChain]),
    destinationChainId: String(cfg.CHAIN_IDS[toChain]),
    amount,
  });
  // BNB↔any has 18↔6 decimal mismatch (both USDC and USDT)
  if (BNB_CHAINS.has(fromChain) || BNB_CHAINS.has(toChain)) {
    params.set('allowUnmatchedDecimals', 'true');
  }

  const url = 'https://app.across.to/api/suggested-fees?' + params.toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  // NWT N18.3 P0 5/18: paren-wrap await before .slice. JS `await x.y().z()` parses as
  // `await (x.y().z())` so `.slice` was called on Promise<string> not string → TypeError.
  // Pre-existing 4/24 bug (commit 8e894462b2), N18 USDT path triggered surface (T6b real chain).
  if (!res.ok) throw new Error(`Across quote HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();

  // Live API response shape (2026-04):
  // { timestamp, totalRelayFee: { total }, outputAmount, spokePoolAddress, ... }
  // NO "output" wrapper, NO "inputAmount" field.
  if (!data.outputAmount) throw new Error(`Across quote malformed: ${JSON.stringify(data)}`);

  return {
    inputAmount: amount,
    outputAmount: data.outputAmount,
    totalRelayFee: data.totalRelayFee?.total || '0',
    timestamp: data.timestamp,
    toSpokePool: data.destinationSpokePoolAddress,
    fillDeadline: data.fillDeadline,
    asset, // NWT N18: surface asset for caller (executeBridge needs it)
  };
}

export { EVM_RPC_URLS, CHAIN_META };
