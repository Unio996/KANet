/**
 * Hyperliquid Perpetual Futures Client — Arbitrum settlement
 *
 * Pure SDK calls. No DB, no Mind, no business logic.
 * Caller handles error recording, UI display, etc.
 *
 * SDK: npm hyperliquid (EIP-712 signing, WebSocket internally)
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs
 */

import { Hyperliquid } from 'hyperliquid';
import { getConfig } from '../data/settings/configs.js';

// ── Singleton SDK instance ─────────────────────────────────

let _sdk = null;
let _sdkKey = null; // track which key initialized the SDK

async function getSdk(privateKey) {
  // Reuse if same key
  if (_sdk && _sdkKey === privateKey) return _sdk;

  const testnet = (await getConfig('hyper_testnet')) === 'true';
  _sdk = new Hyperliquid({ privateKey, testnet });
  await _sdk.connect();
  _sdkKey = privateKey;
  return _sdk;
}

// ── Core Operations ────────────────────────────────────────

/**
 * Place an order (open/add position).
 * @param {string} privateKey
 * @param {object} params - { asset, side: 'buy'|'sell', size, price?, type: 'limit'|'market', leverage?, stopLoss? }
 * @returns {{ ok, orderId, status }}
 */
export async function placeOrder(privateKey, params) {
  const sdk = await getSdk(privateKey);
  const { asset, side, size, price, type = 'market', leverage, stopLoss } = params;

  // Set leverage if specified
  if (leverage) {
    await sdk.exchange.updateLeverage({ asset, leverage, isCross: true });
  }

  // Place main order
  const isBuy = side.toLowerCase() === 'buy';
  const orderParams = {
    coin: asset,
    is_buy: isBuy,
    sz: size,
    order_type: type === 'market'
      ? { market: {} }
      : { limit: { tif: 'GTC' } },
    reduce_only: false,
  };
  if (type === 'limit' && price) {
    orderParams.limit_px = price;
  }

  const result = await sdk.exchange.placeOrder(orderParams);

  // Place stop-loss trigger if specified
  if (stopLoss && result?.response?.data?.statuses?.[0]?.filled) {
    try {
      await sdk.exchange.placeOrder({
        coin: asset,
        is_buy: !isBuy, // opposite direction
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
    asset,
    side,
    size,
  };
}

/**
 * Close a position (market order, reduce-only).
 * @param {string} privateKey
 * @param {string} asset - e.g. 'ETH'
 * @returns {{ ok, asset }}
 */
export async function closePosition(privateKey, asset) {
  const sdk = await getSdk(privateKey);

  // Get current position size
  const state = await sdk.info.perpetuals.getClearinghouseState(sdk.wallet.address);
  const pos = state?.assetPositions?.find(p => p.position?.coin === asset);
  if (!pos || parseFloat(pos.position.szi) === 0) {
    return { ok: false, error: 'No open position for ' + asset };
  }

  const szi = parseFloat(pos.position.szi);
  const isBuy = szi < 0; // close short = buy, close long = sell

  await sdk.exchange.placeOrder({
    coin: asset,
    is_buy: isBuy,
    sz: Math.abs(szi),
    order_type: { market: {} },
    reduce_only: true,
  });

  return { ok: true, asset, closedSize: Math.abs(szi) };
}

/**
 * Get all open positions.
 * @param {string} privateKey - needed to derive wallet address
 * @returns {Array<{ asset, size, entryPrice, markPrice, pnl, leverage, liquidationPrice, funding }>}
 */
export async function getPositions(privateKey) {
  const sdk = await getSdk(privateKey);
  const state = await sdk.info.perpetuals.getClearinghouseState(sdk.wallet.address);

  return (state?.assetPositions || [])
    .filter(p => parseFloat(p.position?.szi) !== 0)
    .map(p => ({
      asset: p.position.coin,
      size: parseFloat(p.position.szi),
      entryPrice: parseFloat(p.position.entryPx),
      markPrice: parseFloat(p.position.positionValue) / Math.abs(parseFloat(p.position.szi)),
      pnl: parseFloat(p.position.unrealizedPnl),
      leverage: p.position.leverage?.value || 1,
      leverageType: p.position.leverage?.type || 'cross',
      liquidationPrice: parseFloat(p.position.liquidationPx) || null,
      marginUsed: parseFloat(p.position.marginUsed),
      funding: p.position.cumFunding,
    }));
}

/**
 * Get account info (balance, margin, PnL).
 * @param {string} privateKey
 * @returns {{ accountValue, totalMarginUsed, totalPnl, withdrawable }}
 */
export async function getAccountInfo(privateKey) {
  const sdk = await getSdk(privateKey);
  const state = await sdk.info.perpetuals.getClearinghouseState(sdk.wallet.address);

  const cs = state?.crossMarginSummary || {};
  return {
    accountValue: parseFloat(cs.accountValue || 0),
    totalMarginUsed: parseFloat(cs.totalMarginUsed || 0),
    totalNtlPos: parseFloat(cs.totalNtlPos || 0),
    withdrawable: parseFloat(state?.withdrawable || 0),
  };
}

/**
 * Get funding rates for assets.
 * @param {string} privateKey
 * @param {string[]} assets - e.g. ['BTC', 'ETH', 'KAS']
 * @returns {Array<{ asset, fundingRate, nextFunding }>}
 */
export async function getFundingRates(privateKey, assets = ['BTC', 'ETH']) {
  const sdk = await getSdk(privateKey);
  const meta = await sdk.info.perpetuals.getMeta();
  const rates = await sdk.info.perpetuals.getAllMids();

  return assets.map(asset => {
    const info = meta?.universe?.find(u => u.name === asset);
    return {
      asset,
      fundingRate: info?.funding ? parseFloat(info.funding) : null,
      maxLeverage: info?.maxLeverage || null,
    };
  });
}

/**
 * Cancel an open order.
 * @param {string} privateKey
 * @param {string} asset
 * @param {string} orderId
 */
export async function cancelOrder(privateKey, asset, orderId) {
  const sdk = await getSdk(privateKey);
  await sdk.exchange.cancelOrder({ coin: asset, oid: orderId });
  return { ok: true, asset, orderId };
}

/**
 * Get open orders.
 * @param {string} privateKey
 */
export async function getOpenOrders(privateKey) {
  const sdk = await getSdk(privateKey);
  return await sdk.info.perpetuals.getOpenOrders(sdk.wallet.address);
}
