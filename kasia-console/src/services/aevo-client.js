/**
 * Aevo Options Client — REST API + EIP-712 order signing
 *
 * Pure functions. No DB, no Mind, no business logic.
 * Caller handles error recording, UI display, etc.
 *
 * API Base: https://api.aevo.xyz (mainnet)
 * Auth: API Key + API Secret headers, EIP-712 signing for orders
 * Docs: https://docs.aevo.xyz
 */

import { ethers } from 'ethers';
import { sqlite } from '../db/client.js';
import { decrypt } from './crypto.js';
import { getConfig } from '../data/settings/configs.js';

// ── Constants ────────────────────────────────────────────────

const API_BASE = 'https://api.aevo.xyz';
const DEFAULT_MAX_MARGIN_PCT = 80;

// EIP-712 domain for Aevo order signing
const EIP712_DOMAIN = {
  name: 'Aevo Mainnet',
  version: '1',
  chainId: 1,
};

const ORDER_TYPES = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'isBuy', type: 'bool' },
    { name: 'limitPrice', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'salt', type: 'uint256' },
    { name: 'instrument', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

// ── Helpers ──────────────────────────────────────────────────

/**
 * Load Aevo credentials from agent_connections (auth_mode=api_key, provider=aevo).
 * @param {string} agentId
 * @returns {{ apiKey: string, apiSecret: string, signingKey: string }}
 */
export function loadCredentials(agentId) {
  const conn = sqlite.prepare(
    `SELECT api_key_enc, gateway_token_enc, signing_key_enc
     FROM agent_connections
     WHERE adapter_node_id = ? AND provider = 'aevo' AND status = 'connected'
     ORDER BY updated_at DESC LIMIT 1`
  ).get(agentId);
  if (!conn) throw new Error(`No Aevo credentials found for agent ${agentId}`);

  const apiKey = conn.api_key_enc ? decrypt(conn.api_key_enc) : null;
  const apiSecret = conn.gateway_token_enc ? decrypt(conn.gateway_token_enc) : null;
  const signingKey = conn.signing_key_enc ? decrypt(conn.signing_key_enc) : null;

  if (!apiKey || !apiSecret) throw new Error('Aevo API Key or Secret missing');
  return { apiKey, apiSecret, signingKey };
}

/**
 * Get EVM signing key from agent_wallets (for EIP-712 order signing).
 * @param {string} walletId
 * @returns {string} decrypted private key
 */
export function getSigningKeyFromWallet(walletId) {
  const wallet = sqlite.prepare(
    'SELECT privkey_encrypted FROM agent_wallets WHERE id = ?'
  ).get(walletId);
  if (!wallet || !wallet.privkey_encrypted) {
    throw new Error(`No private key for wallet ${walletId}`);
  }
  return decrypt(wallet.privkey_encrypted);
}

/**
 * Authenticated REST call to Aevo API.
 */
async function aevoFetch(method, path, { apiKey, apiSecret, body = null } = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'AEVO-KEY': apiKey,
    'AEVO-SECRET': apiSecret,
  };

  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === 'object' ? (data.error || data.message || JSON.stringify(data)) : text;
    throw new Error(`Aevo API ${method} ${path} ${res.status}: ${msg}`);
  }

  return data;
}

/**
 * Sign an order using EIP-712 typed data.
 * @param {object} orderData - { maker, isBuy, limitPrice, amount, salt, instrument, timestamp }
 * @param {string} privateKey - hex private key for signing
 * @returns {string} signature
 */
async function signOrder(orderData, privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderData);
  return signature;
}

// ── Public (unauthenticated) data ────────────────────────────

/**
 * Fetch Aevo markets without authentication (public endpoint).
 * Returns PERPs + OPTION instruments for the given underlying.
 * @param {string} asset - e.g. 'ETH' | 'BTC' | undefined (all)
 * @returns {Array} list of market instruments
 */
export async function getPublicMarkets(asset = null) {
  const url = asset
    ? `${API_BASE}/markets?asset=${encodeURIComponent(asset)}`
    : `${API_BASE}/markets`;
  const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Aevo public markets ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : [];
  return rows.map(m => ({
    instrumentId: m.instrument_id,
    instrumentName: m.instrument_name,
    type: m.instrument_type,           // 'PERPETUAL' | 'OPTION'
    underlying: m.underlying_asset,
    markPrice: parseFloat(m.mark_price || 0),
    indexPrice: parseFloat(m.index_price || 0),
    isActive: !!m.is_active,
    maxLeverage: parseFloat(m.max_leverage || 0),
    // Option-specific fields (if present)
    strike: m.strike ? parseFloat(m.strike) : null,
    optionType: m.option_type || null,  // 'call' | 'put'
    expiry: m.expiry || null,            // raw nanosecond timestamp
    expiryDate: m.expiry ? new Date(Math.floor(Number(m.expiry) / 1e6)).toISOString().slice(0, 10) : null,
    iv: m.greeks?.iv ? parseFloat(m.greeks.iv) : null,
    delta: m.greeks?.delta ? parseFloat(m.greeks.delta) : null,
    gamma: m.greeks?.gamma ? parseFloat(m.greeks.gamma) : null,
    theta: m.greeks?.theta ? parseFloat(m.greeks.theta) : null,
    vega: m.greeks?.vega ? parseFloat(m.greeks.vega) : null,
  }));
}

// ── Margin Safety ────────────────────────────────────────────

/**
 * Check margin usage. Rejects if over configured limit.
 * @param {{ apiKey, apiSecret }} creds
 * @returns {{ equity, available, marginUsed, marginPct }}
 */
async function checkMargin(creds) {
  const account = await getAccount(creds);
  const maxPct = parseFloat(await getConfig('aevo_max_margin_used_pct') || DEFAULT_MAX_MARGIN_PCT);
  if (account.marginPct >= maxPct) {
    throw new Error(
      `Margin usage ${account.marginPct.toFixed(1)}% >= limit ${maxPct}%. ` +
      `Reduce positions before opening new ones.`
    );
  }
  return account;
}

// ── Core Operations ─────────────────────────────────────────

/**
 * Create a new order on Aevo.
 * @param {{ apiKey, apiSecret }} creds - API credentials
 * @param {string} signingKey - private key for EIP-712 signing
 * @param {object} params
 * @param {string} params.instrument - e.g. 'ETH-20260501-4000-C'
 * @param {string} params.side - 'buy' | 'sell'
 * @param {number} params.amount - quantity
 * @param {number} params.price - limit price in USDC
 * @param {string} [params.orderType='limit'] - 'limit' | 'market'
 * @returns {{ ok, orderId, instrument, side, amount, price }}
 */
export async function createOrder(creds, signingKey, params) {
  const { instrument, side, amount, price, orderType = 'limit' } = params;

  if (!instrument || !side || !amount) {
    throw new Error('instrument, side, and amount are required');
  }

  // Margin safety check before placing order
  await checkMargin(creds);

  // Build order for EIP-712 signing
  const isBuy = side.toLowerCase() === 'buy';
  const salt = Math.floor(Math.random() * 1e18);
  const timestamp = Math.floor(Date.now() / 1000);

  // Aevo uses 6-decimal precision for prices and amounts
  const limitPrice = Math.round(parseFloat(price) * 1e6);
  const orderAmount = Math.round(parseFloat(amount) * 1e6);

  // Resolve instrument ID (Aevo uses numeric instrument IDs in signatures)
  // The REST API accepts string instrument names for order submission
  const orderData = {
    maker: new ethers.Wallet(signingKey).address,
    isBuy,
    limitPrice,
    amount: orderAmount,
    salt,
    instrument: 0, // placeholder; Aevo API resolves from instrument name
    timestamp,
  };

  const signature = await signOrder(orderData, signingKey);

  const body = {
    instrument: parseFloat(instrument) || instrument, // numeric ID or string name
    maker: orderData.maker,
    is_buy: isBuy,
    limit_price: String(parseFloat(price)),
    amount: String(parseFloat(amount)),
    salt,
    timestamp,
    signature,
    order_type: orderType,
  };

  // Max order size check
  const maxUsdc = parseFloat(await getConfig('aevo_max_order_usdc') || '100');
  const orderCost = parseFloat(price) * parseFloat(amount);
  if (orderCost > maxUsdc) {
    throw new Error(
      `Order cost $${orderCost.toFixed(2)} exceeds limit $${maxUsdc}. ` +
      `Set aevo_max_order_usdc in config to increase.`
    );
  }

  const data = await aevoFetch('POST', '/orders', { ...creds, body });

  return {
    ok: true,
    orderId: data.order_id,
    instrument,
    side,
    amount: parseFloat(amount),
    price: parseFloat(price),
  };
}

/**
 * Cancel an existing order.
 * @param {{ apiKey, apiSecret }} creds
 * @param {string} orderId
 * @returns {{ ok, orderId }}
 */
export async function cancelOrder(creds, orderId) {
  if (!orderId) throw new Error('orderId is required');

  await aevoFetch('DELETE', `/orders/${orderId}`, creds);

  return { ok: true, orderId };
}

/**
 * Get current positions with Greeks.
 * @param {{ apiKey, apiSecret }} creds
 * @returns {Array<{ instrument, side, amount, avgPrice, markPrice, pnl, greeks }>}
 */
export async function getPositions(creds) {
  const data = await aevoFetch('GET', '/positions', creds);

  const positions = (Array.isArray(data) ? data : data.positions || []);
  return positions.map(p => ({
    instrument: p.instrument_name || p.instrument,
    side: p.side || (parseFloat(p.amount) > 0 ? 'buy' : 'sell'),
    amount: parseFloat(p.amount || 0),
    avgPrice: parseFloat(p.avg_entry_price || p.average_price || 0),
    markPrice: parseFloat(p.mark_price || 0),
    pnl: parseFloat(p.unrealized_pnl || p.pnl || 0),
    greeks: {
      delta: parseFloat(p.delta || 0),
      gamma: parseFloat(p.gamma || 0),
      theta: parseFloat(p.theta || 0),
      vega: parseFloat(p.vega || 0),
      iv: parseFloat(p.iv || 0),
    },
  }));
}

/**
 * Get account overview (equity, margin, portfolio Greeks).
 * @param {{ apiKey, apiSecret }} creds
 * @returns {{ equity, available, marginUsed, marginPct, portfolioGreeks }}
 */
export async function getAccount(creds) {
  const data = await aevoFetch('GET', '/account', creds);

  const equity = parseFloat(data.equity || 0);
  const available = parseFloat(data.available_balance || data.available || 0);
  const marginUsed = parseFloat(data.initial_margin || data.margin_used || 0);
  const marginPct = equity > 0 ? (marginUsed / equity) * 100 : 0;

  return {
    equity,
    available,
    marginUsed,
    marginPct,
    portfolioGreeks: {
      delta: parseFloat(data.portfolio_delta || data.delta || 0),
      gamma: parseFloat(data.portfolio_gamma || data.gamma || 0),
      theta: parseFloat(data.portfolio_theta || data.theta || 0),
      vega: parseFloat(data.portfolio_vega || data.vega || 0),
    },
  };
}

/**
 * Get orderbook for an instrument.
 * @param {{ apiKey, apiSecret }} creds
 * @param {string} instrument - e.g. 'ETH-20260501-4000-C'
 * @returns {{ bids: Array<[price, amount]>, asks: Array<[price, amount]> }}
 */
export async function getOrderbook(creds, instrument) {
  if (!instrument) throw new Error('instrument is required');

  const data = await aevoFetch('GET', `/orderbook?instrument_name=${encodeURIComponent(instrument)}`, creds);

  return {
    bids: (data.bids || []).map(b => [parseFloat(b[0]), parseFloat(b[1])]),
    asks: (data.asks || []).map(a => [parseFloat(a[0]), parseFloat(a[1])]),
  };
}

// ── Greeks Query ─────────────────────────────────────────────

/**
 * Get Greeks for a specific instrument (from market data / ticker).
 * @param {{ apiKey, apiSecret }} creds
 * @param {string} instrument
 * @returns {{ delta, gamma, theta, vega, iv }}
 */
export async function getInstrumentGreeks(creds, instrument) {
  if (!instrument) throw new Error('instrument is required');

  const data = await aevoFetch('GET', `/markets?instrument_name=${encodeURIComponent(instrument)}`, creds);

  const market = Array.isArray(data) ? data[0] : data;
  return {
    delta: parseFloat(market?.greeks?.delta || 0),
    gamma: parseFloat(market?.greeks?.gamma || 0),
    theta: parseFloat(market?.greeks?.theta || 0),
    vega: parseFloat(market?.greeks?.vega || 0),
    iv: parseFloat(market?.greeks?.iv || market?.iv || 0),
  };
}
