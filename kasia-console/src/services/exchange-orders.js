/**
 * Exchange Order Service — unified order placement across 8 exchanges
 *
 * Each exchange has its own signing scheme:
 *   - binance-like (MEXC, Binance): HMAC-SHA256 query string
 *   - gateio: HMAC-SHA512 with body hash
 *   - okx: HMAC-SHA256 base64 with timestamp+method+path+body
 *   - bybit: HMAC-SHA256 with timestamp+apiKey+recvWindow+body
 *   - kucoin: HMAC-SHA256 base64, passphrase also signed
 *   - bitget: HMAC-SHA256 base64, similar to OKX
 *   - htx: HMAC-SHA256 base64, sorted query params
 */

import crypto from 'node:crypto';

function hmac256(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
function hmac256Base64(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64');
}
function hmac512Hex(secret, data) {
  return crypto.createHmac('sha512', secret).update(data).digest('hex');
}
function sha512Hex(data) {
  return crypto.createHash('sha512').update(data).digest('hex');
}

/**
 * Place a limit order on any supported exchange.
 *
 * @param {object} params
 * @param {string} params.authStyle - exchange auth type
 * @param {string} params.baseUrl
 * @param {string} params.headerName - for binance-like
 * @param {string} params.apiKey
 * @param {string} params.apiSecret
 * @param {object} [params.extra] - { passphrase } for OKX/KuCoin/Bitget
 * @param {string} params.symbol - e.g. KASUSDT
 * @param {string} params.kasPair - exchange-specific pair format
 * @param {'BUY'|'SELL'} params.side
 * @param {number} params.price
 * @param {number} params.qty
 * @returns {Promise<object>} { ok, orderId, status, executedQty, error, raw }
 */
export async function placeOrder(params) {
  const { authStyle } = params;

  try {
    switch (authStyle) {
      case 'binance-like': return await placeBinanceLike(params);
      case 'gateio':       return await placeGateio(params);
      case 'okx':          return await placeOkx(params);
      case 'bybit':        return await placeBybit(params);
      case 'kucoin':       return await placeKucoin(params);
      case 'bitget':       return await placeBitget(params);
      case 'htx':          return await placeHtx(params);
      default:
        return { ok: false, error: `Unsupported auth style: ${authStyle}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Cancel all open orders for a symbol.
 */
export async function cancelOrders(params) {
  const { authStyle } = params;
  try {
    switch (authStyle) {
      case 'binance-like': return await cancelBinanceLike(params);
      case 'gateio':       return await cancelGateio(params);
      case 'okx':          return await cancelOkx(params);
      case 'bybit':        return await cancelBybit(params);
      case 'kucoin':       return await cancelKucoin(params);
      case 'bitget':       return await cancelBitget(params);
      case 'htx':          return await cancelHtx(params);
      default:
        return { ok: false, error: `Unsupported auth style: ${authStyle}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get open orders for a symbol.
 */
export async function getOpenOrders(params) {
  const { authStyle } = params;
  try {
    switch (authStyle) {
      case 'binance-like': return await openOrdersBinanceLike(params);
      case 'gateio':       return await openOrdersGateio(params);
      default:
        // For exchanges without specific implementation, return empty
        return [];
    }
  } catch {
    return [];
  }
}

// ── Binance-like (MEXC, Binance) ────────────────────────────────────────────

async function placeBinanceLike({ baseUrl, headerName, apiKey, apiSecret, symbol, side, price, qty }) {
  const qs = `symbol=${symbol}&side=${side}&type=LIMIT&quantity=${qty}&price=${price}&timestamp=${Date.now()}`;
  const sig = hmac256(apiSecret, qs);
  const res = await fetch(`${baseUrl}/order?${qs}&signature=${sig}`, {
    method: 'POST', headers: { [headerName]: apiKey },
  });
  const data = await res.json();
  if (data.code && data.code !== 200 && data.code !== 0) {
    return { ok: false, error: data.msg || `API error ${data.code}`, raw: data };
  }
  return { ok: true, orderId: data.orderId, status: data.status, executedQty: parseFloat(data.executedQty || 0), raw: data };
}

async function cancelBinanceLike({ baseUrl, headerName, apiKey, apiSecret, symbol }) {
  const qs = `symbol=${symbol}&timestamp=${Date.now()}`;
  const sig = hmac256(apiSecret, qs);
  const res = await fetch(`${baseUrl}/openOrders?${qs}&signature=${sig}`, {
    method: 'DELETE', headers: { [headerName]: apiKey },
  });
  return { ok: true, cancelled: await res.json() };
}

async function openOrdersBinanceLike({ baseUrl, headerName, apiKey, apiSecret, symbol }) {
  const qs = `symbol=${symbol}&timestamp=${Date.now()}`;
  const sig = hmac256(apiSecret, qs);
  const res = await fetch(`${baseUrl}/openOrders?${qs}&signature=${sig}`, {
    headers: { [headerName]: apiKey },
  });
  return await res.json();
}

// ── Gate.io ─────────────────────────────────────────────────────────────────

async function placeGateio({ baseUrl, apiKey, apiSecret, kasPair, side, price, qty }) {
  const path = '/api/v4/spot/orders';
  const body = JSON.stringify({
    currency_pair: kasPair,
    side: side.toLowerCase(),
    amount: String(qty),
    price: String(price),
    type: 'limit',
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = sha512Hex(body);
  const signStr = `POST\n${path}\n\n${bodyHash}\n${ts}`;
  const sig = hmac512Hex(apiSecret, signStr);

  const res = await fetch(`${baseUrl.replace('/api/v4', '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'KEY': apiKey, 'SIGN': sig, 'Timestamp': ts,
    },
    body,
  });
  const data = await res.json();
  if (data.label) return { ok: false, error: data.message || data.label, raw: data };
  return { ok: true, orderId: data.id, status: data.status, executedQty: parseFloat(data.filled_total || 0), raw: data };
}

async function cancelGateio({ baseUrl, apiKey, apiSecret, kasPair }) {
  const path = `/api/v4/spot/orders?currency_pair=${kasPair}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = sha512Hex('');
  const signStr = `DELETE\n/api/v4/spot/orders\ncurrency_pair=${kasPair}\n${bodyHash}\n${ts}`;
  const sig = hmac512Hex(apiSecret, signStr);

  const res = await fetch(`${baseUrl.replace('/api/v4', '')}${path}`, {
    method: 'DELETE',
    headers: { 'KEY': apiKey, 'SIGN': sig, 'Timestamp': ts },
  });
  return { ok: true, cancelled: await res.json() };
}

async function openOrdersGateio({ baseUrl, apiKey, apiSecret, kasPair }) {
  const path = `/api/v4/spot/orders?currency_pair=${kasPair}&status=open`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = sha512Hex('');
  const signStr = `GET\n/api/v4/spot/orders\ncurrency_pair=${kasPair}&status=open\n${bodyHash}\n${ts}`;
  const sig = hmac512Hex(apiSecret, signStr);

  const res = await fetch(`${baseUrl.replace('/api/v4', '')}${path}`, {
    headers: { 'KEY': apiKey, 'SIGN': sig, 'Timestamp': ts },
  });
  return await res.json();
}

// ── OKX ─────────────────────────────────────────────────────────────────────

async function placeOkx({ baseUrl, apiKey, apiSecret, extra, kasPair, side, price, qty }) {
  const ts = new Date().toISOString();
  const path = '/api/v5/trade/order';
  const body = JSON.stringify({
    instId: kasPair, tdMode: 'cash', side: side.toLowerCase(),
    ordType: 'limit', sz: String(qty), px: String(price),
  });
  const sig = hmac256Base64(apiSecret, ts + 'POST' + path + body);

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': sig,
      'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': extra?.passphrase || '',
    },
    body,
  });
  const data = await res.json();
  const d = data.data?.[0];
  if (data.code !== '0') return { ok: false, error: data.msg || d?.sMsg || `code ${data.code}`, raw: data };
  return { ok: true, orderId: d?.ordId, status: 'NEW', executedQty: 0, raw: data };
}

async function cancelOkx({ baseUrl, apiKey, apiSecret, extra, kasPair }) {
  // OKX doesn't have cancel-all, need to get open orders first then cancel each
  const ts = new Date().toISOString();
  const path = `/api/v5/trade/orders-pending?instId=${kasPair}`;
  const sig = hmac256Base64(apiSecret, ts + 'GET' + path);
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': sig,
      'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': extra?.passphrase || '',
    },
  });
  const data = await res.json();
  const orders = data.data || [];
  const results = [];
  for (const o of orders) {
    const cancelPath = '/api/v5/trade/cancel-order';
    const cancelBody = JSON.stringify({ instId: kasPair, ordId: o.ordId });
    const cancelTs = new Date().toISOString();
    const cancelSig = hmac256Base64(apiSecret, cancelTs + 'POST' + cancelPath + cancelBody);
    const cancelRes = await fetch(`${baseUrl}${cancelPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': cancelSig,
        'OK-ACCESS-TIMESTAMP': cancelTs, 'OK-ACCESS-PASSPHRASE': extra?.passphrase || '',
      },
      body: cancelBody,
    });
    results.push(await cancelRes.json());
  }
  return { ok: true, cancelled: results };
}

// ── Bybit ───────────────────────────────────────────────────────────────────

async function placeBybit({ baseUrl, apiKey, apiSecret, kasPair, side, price, qty }) {
  const ts = Date.now().toString();
  const recvWindow = '5000';
  const path = '/v5/order/create';
  const body = JSON.stringify({
    category: 'spot', symbol: kasPair, side: side.charAt(0).toUpperCase() + side.slice(1).toLowerCase(),
    orderType: 'Limit', qty: String(qty), price: String(price),
  });
  const sig = hmac256(apiSecret, ts + apiKey + recvWindow + body);

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sig,
      'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recvWindow,
    },
    body,
  });
  const data = await res.json();
  if (data.retCode !== 0) return { ok: false, error: data.retMsg || `code ${data.retCode}`, raw: data };
  return { ok: true, orderId: data.result?.orderId, status: 'NEW', executedQty: 0, raw: data };
}

async function cancelBybit({ baseUrl, apiKey, apiSecret, kasPair }) {
  const ts = Date.now().toString();
  const recvWindow = '5000';
  const path = '/v5/order/cancel-all';
  const body = JSON.stringify({ category: 'spot', symbol: kasPair });
  const sig = hmac256(apiSecret, ts + apiKey + recvWindow + body);

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sig,
      'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recvWindow,
    },
    body,
  });
  return { ok: true, cancelled: await res.json() };
}

// ── KuCoin ──────────────────────────────────────────────────────────────────

async function placeKucoin({ baseUrl, apiKey, apiSecret, extra, kasPair, side, price, qty }) {
  const ts = Date.now().toString();
  const path = '/api/v1/orders';
  const body = JSON.stringify({
    clientOid: crypto.randomUUID(), side: side.toLowerCase(), symbol: kasPair,
    type: 'limit', price: String(price), size: String(qty),
  });
  const sig = hmac256Base64(apiSecret, ts + 'POST' + path + body);
  const passphraseSig = hmac256Base64(apiSecret, extra?.passphrase || '');

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'KC-API-KEY': apiKey, 'KC-API-SIGN': sig,
      'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': passphraseSig,
      'KC-API-KEY-VERSION': '2',
    },
    body,
  });
  const data = await res.json();
  if (data.code !== '200000') return { ok: false, error: data.msg || `code ${data.code}`, raw: data };
  return { ok: true, orderId: data.data?.orderId, status: 'NEW', executedQty: 0, raw: data };
}

async function cancelKucoin({ baseUrl, apiKey, apiSecret, extra, kasPair }) {
  const ts = Date.now().toString();
  const path = `/api/v1/orders?symbol=${kasPair}`;
  const sig = hmac256Base64(apiSecret, ts + 'DELETE' + path);
  const passphraseSig = hmac256Base64(apiSecret, extra?.passphrase || '');

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: {
      'KC-API-KEY': apiKey, 'KC-API-SIGN': sig,
      'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': passphraseSig,
      'KC-API-KEY-VERSION': '2',
    },
  });
  return { ok: true, cancelled: await res.json() };
}

// ── Bitget ──────────────────────────────────────────────────────────────────

async function placeBitget({ baseUrl, apiKey, apiSecret, extra, kasPair, side, price, qty }) {
  const ts = Date.now().toString();
  const path = '/api/v2/spot/trade/place-order';
  const body = JSON.stringify({
    symbol: kasPair, side: side.toLowerCase(), orderType: 'limit',
    force: 'gtc', price: String(price), size: String(qty),
  });
  const sig = hmac256Base64(apiSecret, ts + 'POST' + path + body);

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': apiKey, 'ACCESS-SIGN': sig,
      'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': extra?.passphrase || '',
    },
    body,
  });
  const data = await res.json();
  if (data.code !== '00000') return { ok: false, error: data.msg || `code ${data.code}`, raw: data };
  return { ok: true, orderId: data.data?.orderId, status: 'NEW', executedQty: 0, raw: data };
}

async function cancelBitget({ baseUrl, apiKey, apiSecret, extra, kasPair }) {
  const ts = Date.now().toString();
  const path = '/api/v2/spot/trade/cancel-symbol-order';
  const body = JSON.stringify({ symbol: kasPair });
  const sig = hmac256Base64(apiSecret, ts + 'POST' + path + body);

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': apiKey, 'ACCESS-SIGN': sig,
      'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': extra?.passphrase || '',
    },
    body,
  });
  return { ok: true, cancelled: await res.json() };
}

// ── HTX (Huobi) ─────────────────────────────────────────────────────────────

async function placeHtx({ baseUrl, apiKey, apiSecret, kasPair, side, price, qty }) {
  // HTX needs account-id first
  const acctParams = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: new Date().toISOString().split('.')[0],
  });
  acctParams.sort();
  const acctSignStr = `GET\napi.huobi.pro\n/v1/account/accounts\n${acctParams.toString()}`;
  const acctSig = hmac256Base64(apiSecret, acctSignStr);
  acctParams.set('Signature', acctSig);

  const acctRes = await fetch(`${baseUrl}/v1/account/accounts?${acctParams.toString()}`);
  const acctData = await acctRes.json();
  const accountId = acctData.data?.find(a => a.type === 'spot')?.id;
  if (!accountId) return { ok: false, error: 'Could not find HTX spot account' };

  // Place order
  const path = '/v1/order/orders/place';
  const ts = new Date().toISOString().split('.')[0];
  const orderParams = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: ts,
  });
  orderParams.sort();
  const signStr = `POST\napi.huobi.pro\n${path}\n${orderParams.toString()}`;
  const sig = hmac256Base64(apiSecret, signStr);
  orderParams.set('Signature', sig);

  const htxSide = side === 'BUY' ? 'buy-limit' : 'sell-limit';
  const body = JSON.stringify({
    'account-id': accountId, symbol: kasPair, type: htxSide,
    amount: String(qty), price: String(price),
  });

  const res = await fetch(`${baseUrl}${path}?${orderParams.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const data = await res.json();
  if (data.status !== 'ok') return { ok: false, error: data['err-msg'] || `status ${data.status}`, raw: data };
  return { ok: true, orderId: data.data, status: 'NEW', executedQty: 0, raw: data };
}

async function cancelHtx({ baseUrl, apiKey, apiSecret, kasPair }) {
  const path = '/v1/order/orders/batchCancelOpenOrders';
  const ts = new Date().toISOString().split('.')[0];
  const params = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: ts,
  });
  params.sort();
  const signStr = `POST\napi.huobi.pro\n${path}\n${params.toString()}`;
  const sig = hmac256Base64(apiSecret, signStr);
  params.set('Signature', sig);

  const res = await fetch(`${baseUrl}${path}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: kasPair }),
  });
  return { ok: true, cancelled: await res.json() };
}

// ── Balance Query ──────────────────────────────────────────────────────────

/**
 * Get KAS and USDT balance from any supported exchange.
 *
 * @param {object} account
 * @param {string} account.exchange - exchange id (mexc/gateio/bybit/kucoin/bitget/htx/binance)
 * @param {string} account.apiKey
 * @param {string} account.apiSecret
 * @param {string} [account.passphrase] - for OKX/KuCoin/Bitget
 * @param {string} [account.baseUrl] - override base URL
 * @returns {Promise<object>} { exchange, kas, usdt, timestamp, error }
 */
export async function getBalance(account) {
  const { exchange, apiKey, apiSecret, passphrase, baseUrl } = account;
  const ts = new Date().toISOString();

  try {
    switch (exchange) {
      case 'mexc':
      case 'binance': {
        const headerName = exchange === 'mexc' ? 'X-MEXC-APIKEY' : 'X-MBX-APIKEY';
        const url = exchange === 'mexc'
          ? (baseUrl || 'https://api.mexc.com/api/v3')
          : (baseUrl || 'https://api.binance.com/api/v3');
        const qs = `timestamp=${Date.now()}`;
        const sig = hmac256(apiSecret, qs);
        const res = await fetch(`${url}/account?${qs}&signature=${sig}`, {
          headers: { [headerName]: apiKey },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (data.code && data.code !== 200 && data.code !== 0) {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: data.msg || `API error ${data.code}` };
        }
        const balances = data.balances || [];
        const kasB = balances.find(b => b.asset === 'KAS');
        const usdtB = balances.find(b => b.asset === 'USDT');
        return {
          exchange,
          kas: kasB ? parseFloat(parseFloat(kasB.free).toFixed(4)) : 0,
          usdt: usdtB ? parseFloat(parseFloat(usdtB.free).toFixed(2)) : 0,
          timestamp: ts, error: null,
        };
      }

      case 'gateio': {
        const gateBase = baseUrl || 'https://api.gateio.ws/api/v4';
        const path = '/spot/accounts';
        const gateTs = Math.floor(Date.now() / 1000).toString();
        const bodyHash = sha512Hex('');
        const signStr = `GET\n/api/v4${path}\n\n${bodyHash}\n${gateTs}`;
        const sig = hmac512Hex(apiSecret, signStr);
        const res = await fetch(`${gateBase}${path}`, {
          headers: { 'KEY': apiKey, 'SIGN': sig, 'Timestamp': gateTs },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (!Array.isArray(data)) {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: data?.message || data?.label || 'unexpected response' };
        }
        const kasB = data.find(a => a.currency === 'KAS');
        const usdtB = data.find(a => a.currency === 'USDT');
        return {
          exchange,
          kas: kasB ? parseFloat(parseFloat(kasB.available).toFixed(4)) : 0,
          usdt: usdtB ? parseFloat(parseFloat(usdtB.available).toFixed(2)) : 0,
          timestamp: ts, error: null,
        };
      }

      case 'bybit': {
        const bybitBase = baseUrl || 'https://api.bybit.com';
        const bybitTs = Date.now().toString();
        const recvWindow = '5000';
        const preSign = bybitTs + apiKey + recvWindow;
        const sig = hmac256(apiSecret, preSign);
        const res = await fetch(`${bybitBase}/v5/account/wallet-balance?accountType=UNIFIED`, {
          headers: {
            'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sig,
            'X-BAPI-TIMESTAMP': bybitTs, 'X-BAPI-RECV-WINDOW': recvWindow,
          },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (data.retCode !== 0) {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: data.retMsg || `code ${data.retCode}` };
        }
        const coins = data.result?.list?.[0]?.coin || [];
        const kasC = coins.find(c => c.coin === 'KAS');
        const usdtC = coins.find(c => c.coin === 'USDT');
        return {
          exchange,
          kas: kasC ? parseFloat(parseFloat(kasC.availableToWithdraw).toFixed(4)) : 0,
          usdt: usdtC ? parseFloat(parseFloat(usdtC.availableToWithdraw).toFixed(2)) : 0,
          timestamp: ts, error: null,
        };
      }

      case 'kucoin': {
        const kcBase = baseUrl || 'https://api.kucoin.com';
        const kcTs = Date.now().toString();
        const kcPath = '/api/v1/accounts?type=trade';
        const sig = hmac256Base64(apiSecret, kcTs + 'GET' + kcPath);
        const passphraseSig = hmac256Base64(apiSecret, passphrase || '');
        const res = await fetch(`${kcBase}${kcPath}`, {
          headers: {
            'KC-API-KEY': apiKey, 'KC-API-SIGN': sig,
            'KC-API-TIMESTAMP': kcTs, 'KC-API-PASSPHRASE': passphraseSig,
            'KC-API-KEY-VERSION': '2',
          },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (data.code !== '200000') {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: data.msg || `code ${data.code}` };
        }
        const accounts = data.data || [];
        const kasA = accounts.find(a => a.currency === 'KAS');
        const usdtA = accounts.find(a => a.currency === 'USDT');
        return {
          exchange,
          kas: kasA ? parseFloat(parseFloat(kasA.balance).toFixed(4)) : 0,
          usdt: usdtA ? parseFloat(parseFloat(usdtA.balance).toFixed(2)) : 0,
          timestamp: ts, error: null,
        };
      }

      case 'bitget': {
        const bgBase = baseUrl || 'https://api.bitget.com';
        const bgTs = Date.now().toString();
        const bgPath = '/api/v2/spot/account/assets';
        const sig = hmac256Base64(apiSecret, bgTs + 'GET' + bgPath);
        const res = await fetch(`${bgBase}${bgPath}`, {
          headers: {
            'ACCESS-KEY': apiKey, 'ACCESS-SIGN': sig,
            'ACCESS-TIMESTAMP': bgTs, 'ACCESS-PASSPHRASE': passphrase || '',
          },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (data.code !== '00000') {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: data.msg || `code ${data.code}` };
        }
        const assets = data.data || [];
        const kasA = assets.find(a => a.coin === 'KAS');
        const usdtA = assets.find(a => a.coin === 'USDT');
        return {
          exchange,
          kas: kasA ? parseFloat(parseFloat(kasA.available).toFixed(4)) : 0,
          usdt: usdtA ? parseFloat(parseFloat(usdtA.available).toFixed(2)) : 0,
          timestamp: ts, error: null,
        };
      }

      case 'htx': {
        const htxBase = baseUrl || 'https://api.huobi.pro';
        // Step 1: get spot accountId
        const acctTs = new Date().toISOString().split('.')[0];
        const acctParams = new URLSearchParams({
          AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
          SignatureVersion: '2', Timestamp: acctTs,
        });
        acctParams.sort();
        const acctSignStr = `GET\napi.huobi.pro\n/v1/account/accounts\n${acctParams.toString()}`;
        const acctSig = hmac256Base64(apiSecret, acctSignStr);
        acctParams.set('Signature', acctSig);
        const acctRes = await fetch(`${htxBase}/v1/account/accounts?${acctParams.toString()}`, {
          signal: AbortSignal.timeout(5000),
        });
        const acctData = await acctRes.json();
        const accountId = acctData.data?.find(a => a.type === 'spot')?.id;
        if (!accountId) {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: 'Could not find HTX spot account' };
        }
        // Step 2: get balance
        const balPath = `/v1/account/accounts/${accountId}/balance`;
        const balTs = new Date().toISOString().split('.')[0];
        const balParams = new URLSearchParams({
          AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
          SignatureVersion: '2', Timestamp: balTs,
        });
        balParams.sort();
        const balSignStr = `GET\napi.huobi.pro\n${balPath}\n${balParams.toString()}`;
        const balSig = hmac256Base64(apiSecret, balSignStr);
        balParams.set('Signature', balSig);
        const balRes = await fetch(`${htxBase}${balPath}?${balParams.toString()}`, {
          signal: AbortSignal.timeout(5000),
        });
        const balData = await balRes.json();
        if (balData.status !== 'ok') {
          return { exchange, kas: null, usdt: null, timestamp: ts, error: balData['err-msg'] || `status ${balData.status}` };
        }
        const list = balData.data?.list || [];
        const kasT = list.find(i => i.currency === 'kas' && i.type === 'trade');
        const usdtT = list.find(i => i.currency === 'usdt' && i.type === 'trade');
        return {
          exchange,
          kas: kasT ? parseFloat(parseFloat(kasT.balance).toFixed(4)) : 0,
          usdt: usdtT ? parseFloat(parseFloat(usdtT.balance).toFixed(2)) : 0,
          timestamp: ts, error: null,
        };
      }

      default:
        return { exchange, kas: null, usdt: null, timestamp: ts, error: `unsupported exchange: ${exchange}` };
    }
  } catch (err) {
    return { exchange, kas: null, usdt: null, timestamp: ts, error: err.message };
  }
}
