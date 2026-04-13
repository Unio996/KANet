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

/**
 * Get all available markets with current stats.
 */
export async function getMarkets(limit = 20) {
  const data = await infoPost({ type: 'metaAndAssetCtxs' });
  const meta = data?.[0];
  const ctxs = data?.[1] || [];

  return (meta?.universe || []).slice(0, limit).map((u, i) => {
    const ctx = ctxs[i] || {};
    return {
      asset: u.name,
      maxLeverage: u.maxLeverage,
      markPrice: parseFloat(ctx.markPx || 0),
      fundingRate: parseFloat(ctx.funding || 0),
      openInterest: parseFloat(ctx.openInterest || 0),
      volume24h: parseFloat(ctx.dayNtlVlm || 0),
      change24h: ctx.prevDayPx ? ((parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) * 100) : 0,
    };
  });
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
 * Place an order (requires SDK for EIP-712 signing).
 */
export async function placeOrder(privateKey, params) {
  const sdk = await getSdk(privateKey);
  const { asset, side, size, price, type = 'market', leverage, stopLoss } = params;

  if (leverage) {
    try { await sdk.exchange.updateLeverage({ asset, leverage, isCross: true }); } catch (e) {
      console.error(`[hyperliquid] leverage update failed: ${e.message}`);
    }
  }

  const isBuy = side.toLowerCase() === 'buy' || side.toLowerCase() === 'long';
  const orderParams = {
    coin: asset,
    is_buy: isBuy,
    sz: size,
    order_type: type === 'market' ? { market: {} } : { limit: { tif: 'GTC' } },
    reduce_only: false,
  };
  if (type === 'limit' && price) orderParams.limit_px = price;

  const result = await sdk.exchange.placeOrder(orderParams);

  // Stop-loss trigger
  if (stopLoss && result?.response?.data?.statuses?.[0]?.filled) {
    try {
      await sdk.exchange.placeOrder({
        coin: asset,
        is_buy: !isBuy,
        sz: size,
        order_type: { trigger: { triggerPx: String(stopLoss), isMarket: true, tpsl: 'sl' } },
        reduce_only: true,
      });
    } catch (e) {
      console.error(`[hyperliquid] stop-loss placement failed: ${e.message}`);
    }
  }

  return {
    ok: true,
    orderId: result?.response?.data?.statuses?.[0]?.resting?.oid || null,
    filled: result?.response?.data?.statuses?.[0]?.filled || null,
    asset, side, size,
  };
}

/**
 * Close a position (market order, reduce-only).
 */
export async function closePosition(privateKey, asset) {
  const positions = await getPositions(privateKey);
  const pos = positions.find(p => p.asset === asset);
  if (!pos) return { ok: false, error: 'No open position for ' + asset };

  const sdk = await getSdk(privateKey);
  const isBuy = pos.side === 'short'; // close short = buy

  await sdk.exchange.placeOrder({
    coin: asset,
    is_buy: isBuy,
    sz: pos.size,
    order_type: { market: {} },
    reduce_only: true,
  });

  return { ok: true, asset, closedSize: pos.size };
}

/**
 * Cancel an open order.
 */
export async function cancelOrder(privateKey, asset, orderId) {
  const sdk = await getSdk(privateKey);
  await sdk.exchange.cancelOrder({ coin: asset, oid: orderId });
  return { ok: true, asset, orderId };
}
