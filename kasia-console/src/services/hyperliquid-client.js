/**
 * Hyperliquid Perpetual Futures Client
 *
 * Direct REST API for queries (info endpoint, no auth).
 * SDK only used for order signing (EIP-712).
 *
 * Info API: POST https://api.hyperliquid.xyz/info { type, user }
 * Exchange API: POST https://api.hyperliquid.xyz/exchange (signed)
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs
 */

import { ethers } from 'ethers';
import { getConfig } from '../data/settings/configs.js';

// ── Constants ────────────────────────────────────────────────

const MAINNET_API = 'https://api.hyperliquid.xyz';
const TESTNET_API = 'https://api.hyperliquid-testnet.xyz';

async function getApiBase() {
  const testnet = (await getConfig('hyper_testnet')) === 'true';
  return testnet ? TESTNET_API : MAINNET_API;
}

// Derive wallet address from private key (no SDK needed)
function deriveAddress(privateKey) {
  const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  const wallet = new ethers.Wallet(pk);
  return wallet.address;
}

// ── Info API (no auth) ───────────────────────────────────────

async function infoPost(body) {
  const base = await getApiBase();
  const res = await fetch(`${base}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Hyperliquid info ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ── Query Operations ────────────────────────────────────────

/**
 * Get user's clearinghouse state (account + positions).
 */
export async function getAccountInfo(privateKey) {
  const address = deriveAddress(privateKey);
  const state = await infoPost({ type: 'clearinghouseState', user: address });

  const cs = state?.marginSummary || state?.crossMarginSummary || {};
  const unrealizedPnl = (state?.assetPositions || []).reduce((sum, p) => {
    return sum + parseFloat(p.position?.unrealizedPnl || 0);
  }, 0);

  return {
    address,
    accountValue: parseFloat(cs.accountValue || 0),
    totalMarginUsed: parseFloat(cs.totalMarginUsed || 0),
    totalNtlPos: parseFloat(cs.totalNtlPos || 0),
    withdrawable: parseFloat(state?.withdrawable || 0),
    unrealizedPnl,
    marginUsedPct: cs.accountValue > 0
      ? (parseFloat(cs.totalMarginUsed || 0) / parseFloat(cs.accountValue)) * 100
      : 0,
    available: parseFloat(state?.withdrawable || 0),
  };
}

/**
 * Get all open positions.
 */
export async function getPositions(privateKey) {
  const address = deriveAddress(privateKey);
  const state = await infoPost({ type: 'clearinghouseState', user: address });

  return (state?.assetPositions || [])
    .filter(p => parseFloat(p.position?.szi) !== 0)
    .map(p => {
      const szi = parseFloat(p.position.szi);
      return {
        asset: p.position.coin,
        side: szi > 0 ? 'long' : 'short',
        size: Math.abs(szi),
        entryPrice: parseFloat(p.position.entryPx || 0),
        markPrice: Math.abs(parseFloat(p.position.positionValue) / szi) || 0,
        pnl: parseFloat(p.position.unrealizedPnl || 0),
        leverage: p.position.leverage?.value || 1,
        liqPrice: parseFloat(p.position.liquidationPx) || null,
        marginUsed: parseFloat(p.position.marginUsed || 0),
      };
    });
}

/**
 * Get funding rates for assets.
 * Uses metaAndAssetCtxs to get current funding.
 */
export async function getFundingRates(privateKey, assets = ['BTC', 'ETH', 'SOL']) {
  const data = await infoPost({ type: 'metaAndAssetCtxs' });
  // data = [meta, assetCtxs]
  const meta = data?.[0];
  const ctxs = data?.[1] || [];

  return assets.map(asset => {
    const idx = meta?.universe?.findIndex(u => u.name === asset);
    const ctx = idx >= 0 ? ctxs[idx] : null;
    return {
      asset,
      markPrice: parseFloat(ctx?.markPx || 0),
      oraclePrice: parseFloat(ctx?.oraclePx || 0),
      fundingRate: parseFloat(ctx?.funding || 0),
      openInterest: parseFloat(ctx?.openInterest || 0),
      volume24h: parseFloat(ctx?.dayNtlVlm || 0),
      change24h: ctx?.prevDayPx ? ((parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) * 100) : 0,
    };
  });
}

// Manual category table — Hyperliquid core perps grouped by theme.
// Uncategorized assets fall into 'others'.
const HL_CATEGORIES = {
  majors: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX'],
  l1s: ['ATOM', 'AVAX', 'DOT', 'NEAR', 'ADA', 'APT', 'SUI', 'SEI', 'TIA', 'INJ', 'KAS', 'FTM', 'ALGO', 'HBAR', 'ICP', 'FLOW', 'ETC', 'LTC', 'BCH', 'FIL', 'TON'],
  defi: ['AAVE', 'UNI', 'DYDX', 'CRV', 'COMP', 'MKR', 'SNX', 'LDO', 'PENDLE', 'GMX', 'SUSHI', '1INCH', 'BAL', 'RDNT', 'JUP', 'CAKE', 'ENA', 'ETHFI', 'FXS', 'YFI'],
  ai: ['FET', 'TAO', 'RNDR', 'AGIX', 'WLD', 'OCEAN', 'AI', 'VIRTUAL', 'AIXBT', 'GRIFFAIN', 'ARKM', 'NMR', 'PAAL'],
  memes: ['PEPE', 'WIF', 'BONK', 'POPCAT', 'FARTCOIN', 'MOODENG', 'CHILLGUY', 'PNUT', 'GOAT', 'ACT', 'NEIRO', 'SHIB', 'FLOKI', 'MEW', 'BRETT', 'TRUMP', 'MELANIA'],
  hl: ['HYPE', 'PURR', 'JELLY', 'FRIEND'],
};

function categorize(asset) {
  const upper = asset.toUpperCase();
  for (const [cat, list] of Object.entries(HL_CATEGORIES)) {
    if (list.includes(upper)) return cat;
  }
  return 'others';
}

export function getCategories() {
  return Object.keys(HL_CATEGORIES).concat(['others']);
}

/**
 * Get available markets with current stats.
 * Pass limit = 0 to get ALL markets (default), otherwise slice to first N.
 */
export async function getMarkets(limit = 0) {
  const data = await infoPost({ type: 'metaAndAssetCtxs' });
  const meta = data?.[0];
  const ctxs = data?.[1] || [];

  const all = (meta?.universe || []).map((u, i) => {
    const ctx = ctxs[i] || {};
    return {
      asset: u.name,
      category: categorize(u.name),
      maxLeverage: u.maxLeverage,
      markPrice: parseFloat(ctx.markPx || 0),
      fundingRate: parseFloat(ctx.funding || 0),
      openInterest: parseFloat(ctx.openInterest || 0),
      volume24h: parseFloat(ctx.dayNtlVlm || 0),
      change24h: ctx.prevDayPx ? ((parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) * 100) : 0,
    };
  });
  return limit > 0 ? all.slice(0, limit) : all;
}

/**
 * Get top traders from Hyperliquid stats-data leaderboard.
 * Public endpoint, no auth. Returns top N by chosen window PnL.
 * window: 'day' | 'week' | 'month' | 'allTime'
 */
export async function getLeaderboard(limit = 10, window = 'week') {
  try {
    const testnet = (await getConfig('hyper_testnet')) === 'true';
    const net = testnet ? 'Testnet' : 'Mainnet';
    const res = await fetch(`https://stats-data.hyperliquid.xyz/${net}/leaderboard`);
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    const data = await res.json();
    const rows = data?.leaderboardRows || [];
    const keyMap = { day: 'dayPnl', week: 'weekPnl', month: 'monthPnl', allTime: 'allTimePnl' };
    const pnlKey = keyMap[window] || 'weekPnl';
    const volKey = { day: 'dayVlm', week: 'weekVlm', month: 'monthVlm', allTime: 'allTimeVlm' }[window] || 'weekVlm';
    return rows
      .map(r => {
        const perf = (r.windowPerformances || []).find(([w]) => w === window)?.[1] || {};
        return {
          address: r.ethAddress,
          accountValue: parseFloat(r.accountValue || 0),
          pnl: parseFloat(perf.pnl || r[pnlKey] || 0),
          volume: parseFloat(perf.vlm || r[volKey] || 0),
          roi: parseFloat(perf.roi || 0) * 100,
          displayName: r.displayName || null,
        };
      })
      .filter(r => r.pnl > 0)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, limit);
  } catch (e) {
    console.error(`[hyperliquid] leaderboard fetch failed: ${e.message}`);
    return [];
  }
}

/**
 * Get recent fills for any address (public via info API).
 * Used for following smart wallets — see what they're trading.
 */
export async function getUserFills(address, limit = 20) {
  const fills = await infoPost({ type: 'userFills', user: address });
  return (fills || []).slice(0, limit).map(f => ({
    time: f.time,
    asset: f.coin,
    side: f.side === 'B' ? 'long' : 'short',
    price: parseFloat(f.px || 0),
    size: parseFloat(f.sz || 0),
    pnl: parseFloat(f.closedPnl || 0),
    dir: f.dir,
  }));
}

/**
 * Full intel on any trader (public, no auth).
 * Returns current positions + recent fills in a single round trip.
 * For vault/staker addresses fills will be empty — positions is what matters.
 */
export async function getTraderIntel(address, fillLimit = 20) {
  const [state, fillsRaw] = await Promise.all([
    infoPost({ type: 'clearinghouseState', user: address }),
    infoPost({ type: 'userFills', user: address }),
  ]);

  const cs = state?.marginSummary || state?.crossMarginSummary || {};
  const accountValue = parseFloat(cs.accountValue || 0);

  const positions = (state?.assetPositions || [])
    .filter(p => parseFloat(p.position?.szi) !== 0)
    .map(p => {
      const szi = parseFloat(p.position.szi);
      const entry = parseFloat(p.position.entryPx || 0);
      const value = Math.abs(parseFloat(p.position.positionValue || 0));
      return {
        asset: p.position.coin,
        side: szi > 0 ? 'long' : 'short',
        size: Math.abs(szi),
        entryPrice: entry,
        value,
        pnl: parseFloat(p.position.unrealizedPnl || 0),
        pnlPct: entry > 0 ? (parseFloat(p.position.unrealizedPnl || 0) / (Math.abs(szi) * entry)) * 100 : 0,
        leverage: p.position.leverage?.value || 1,
      };
    })
    .sort((a, b) => b.value - a.value);

  const fills = (fillsRaw || []).slice(0, fillLimit).map(f => ({
    time: f.time,
    asset: f.coin,
    side: f.side === 'B' ? 'long' : 'short',
    price: parseFloat(f.px || 0),
    size: parseFloat(f.sz || 0),
    pnl: parseFloat(f.closedPnl || 0),
    dir: f.dir,
  }));

  return {
    accountValue,
    positions,
    fills,
    isVaultLike: positions.length === 0 && fills.length === 0,
  };
}

// ── Signed Operations (use SDK for EIP-712) ─────────────────

let _sdk = null;
let _sdkKey = null;

async function getSdk(privateKey) {
  if (_sdk && _sdkKey === privateKey) return _sdk;
  const { Hyperliquid } = await import('hyperliquid');
  const testnet = (await getConfig('hyper_testnet')) === 'true';
  _sdk = new Hyperliquid({ privateKey, testnet });
  await _sdk.connect();
  _sdkKey = privateKey;
  return _sdk;
}

/**
 * Place an order. Uses SDK helpers that internally handle symbol conversion.
 *
 * For market orders: uses sdk.exchange.marketOpen() which:
 *   - Takes the plain asset name (no -PERP suffix)
 *   - Internally fetches reference mark price and applies slippage
 *   - Sends as IoC limit (Hyperliquid has no true "market" type)
 *
 * For limit orders: uses raw placeOrder with -PERP suffixed coin field.
 */
export async function placeOrder(privateKey, params) {
  const sdk = await getSdk(privateKey);
  const { asset, side, size, price, type = 'market', leverage, stopLoss } = params;

  // 1) Leverage update first (best-effort — if it fails, order still goes through)
  if (leverage) {
    try {
      await sdk.exchange.updateLeverage(asset, 'cross', leverage);
    } catch (e) {
      console.error(`[hyperliquid] leverage update failed: ${e.message}`);
    }
  }

  const isBuy = side.toLowerCase() === 'buy' || side.toLowerCase() === 'long';
  let result;

  if (type === 'market') {
    // marketOpen(coin, is_buy, sz, price?, slippage=0.05, cloid?)
    // Pass plain asset name — SDK handles -PERP conversion and slippage pricing.
    result = await sdk.custom.marketOpen(asset, isBuy, size, undefined, 0.02);
  } else {
    if (!price) throw new Error('Limit order requires price');
    result = await sdk.exchange.placeOrder({
      coin: `${asset}-PERP`,
      is_buy: isBuy,
      sz: size,
      limit_px: price,
      order_type: { limit: { tif: 'Gtc' } },
      reduce_only: false,
    });
  }

  // 2) Extract fill info
  const statuses = result?.response?.data?.statuses || [];
  const firstStatus = statuses[0] || {};
  const filled = firstStatus.filled || null;
  const resting = firstStatus.resting || null;
  const errorMsg = firstStatus.error || null;

  if (errorMsg) {
    throw new Error(`Hyperliquid rejected: ${errorMsg}`);
  }

  // 3) Stop-loss trigger (only if main order actually filled/rests)
  if (stopLoss && (filled || resting)) {
    try {
      await sdk.exchange.placeOrder({
        coin: `${asset}-PERP`,
        is_buy: !isBuy,
        sz: size,
        limit_px: String(stopLoss), // trigger orders still need a limit_px field per HL schema
        order_type: { trigger: { triggerPx: String(stopLoss), isMarket: true, tpsl: 'sl' } },
        reduce_only: true,
      });
    } catch (e) {
      console.error(`[hyperliquid] stop-loss placement failed: ${e.message}`);
    }
  }

  return {
    ok: true,
    orderId: resting?.oid || filled?.oid || null,
    filled,
    resting,
    avgPx: filled?.avgPx ? parseFloat(filled.avgPx) : null,
    totalSz: filled?.totalSz ? parseFloat(filled.totalSz) : null,
    asset, side, size,
  };
}

/**
 * Close a position via SDK's marketClose helper.
 */
export async function closePosition(privateKey, asset) {
  const sdk = await getSdk(privateKey);
  // marketClose(coin, sz?, px?, slippage=0.05, cloid?) — sz omitted closes full position
  const result = await sdk.custom.marketClose(asset, undefined, undefined, 0.02);
  const status = result?.response?.data?.statuses?.[0];
  if (status?.error) throw new Error(`Hyperliquid close rejected: ${status.error}`);
  return { ok: true, asset, filled: status?.filled || null };
}

/**
 * Withdraw USDC from Hyperliquid account back to Arbitrum.
 *
 * HL minimum withdrawal is 2 USDC and there's a fixed $1 withdrawal fee.
 * The funds arrive on Arbitrum at the `destination` address within ~1 minute.
 *
 * SDK signature: sdk.exchange.initiateWithdrawal(destination, amount)
 * Internally builds withdraw3 action, signs EIP-712, sends to HL exchange API.
 *
 * @param {string} privateKey — wallet private key
 * @param {number} amount — USDC amount to withdraw (includes fee, so user receives amount - 1)
 * @param {string} [destination] — optional; defaults to the wallet's own Arbitrum address
 * @returns {{ ok, amount, destination, response }}
 */
export async function withdrawUsdc(privateKey, amount, destination) {
  if (!amount || amount <= 0) throw new Error('Amount must be > 0');
  if (amount < 2) throw new Error('Hyperliquid minimum withdrawal is 2 USDC');

  const sdk = await getSdk(privateKey);
  const dest = destination || deriveAddress(privateKey);

  const result = await sdk.exchange.initiateWithdrawal(dest, amount);

  // HL response shape: { status: 'ok', response: {...} } on success
  if (result?.status && result.status !== 'ok') {
    throw new Error(`Hyperliquid withdrawal rejected: ${JSON.stringify(result)}`);
  }

  return {
    ok: true,
    amount,
    destination: dest,
    response: result,
    note: `Withdrawal initiated. Funds will arrive at ${dest.slice(0, 10)}... on Arbitrum in ~1 minute. A $1 fee is deducted (you will receive ${(amount - 1).toFixed(2)} USDC).`,
  };
}

/**
 * Cancel an open order.
 */
export async function cancelOrder(privateKey, asset, orderId) {
  const sdk = await getSdk(privateKey);
  await sdk.exchange.cancelOrder({ coin: `${asset}-PERP`, oid: orderId });
  return { ok: true, asset, orderId };
}
