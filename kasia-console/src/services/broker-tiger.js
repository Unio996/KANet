/**
 * Tiger Brokers — Open API 适配器
 *
 * RSA 签名认证，支持美股/港股/A股（沪港通）。
 *
 * 注册开发者：https://quant.itigerup.com/
 * API：Tiger ID + Private Key（RSA PEM）
 *
 * 文档：https://quant.itigerup.com/openapi/zh/python/overview/introduction.html
 *
 * 注意：Tiger Open API 用 HTTP + RSA 签名，不是简单 API Key。
 * 每个请求需要：tiger_id + timestamp + sign(RSA, payload)
 */

import crypto from 'crypto';

const TIMEOUT = 10000;
const TIGER_BASE = 'https://openapi.itigerup.com/gateway';

export function createTigerAdapter(config) {
  const { tigerId, privateKeyPem, paper } = config;

  function _sign(params) {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(sorted);
    return sign.sign(privateKeyPem, 'base64');
  }

  async function _request(method, bizContent = {}) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const params = {
      tiger_id: tigerId,
      method,
      charset: 'UTF-8',
      sign_type: 'RSA',
      timestamp,
      version: '2.0',
      biz_content: JSON.stringify(bizContent),
    };
    params.sign = _sign(params);

    try {
      // lint-allow-fetch: PZ-ALPACA-T1 broker-tiger → agent-broker-adapter refactor (phase Y+1, 同 broker-alpaca)
      const res = await fetch(TIGER_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      if (data.code !== 0) return { ok: false, error: data.message || `code ${data.code}` };
      return { ok: true, data: data.data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return {
    async authenticate() {
      const result = await _request('assets', { account: paper ? 'PAPER' : 'REAL' });
      if (result.ok) return { ok: true, accountId: tigerId, authenticated: true };
      return { ok: false, error: result.error || 'Authentication failed. Check Tiger ID and Private Key.' };
    },

    startKeepAlive() {},
    stopKeepAlive() {},
    isAuthenticated() { return true; },

    async getAccount() {
      const result = await _request('assets', { account: paper ? 'PAPER' : 'REAL' });
      if (!result.ok) return { ok: false, error: result.error };
      const d = result.data;
      return {
        ok: true,
        balance: d?.cashBalance,
        buyingPower: d?.buyingPower,
        netLiquidation: d?.netLiquidation,
        currency: d?.currency || 'USD',
      };
    },

    async getPositions() {
      const result = await _request('positions', { account: paper ? 'PAPER' : 'REAL' });
      if (!result.ok) return [];
      const items = Array.isArray(result.data) ? result.data : (result.data?.items || []);
      return items.map(p => ({
        symbol: p.symbol,
        conid: p.contractId || p.symbol,
        qty: p.position,
        avgCost: p.averageCost,
        marketValue: p.marketValue,
        pnl: p.unrealizedPnl,
        pnlPct: p.averageCost && p.position ? ((p.marketValue / (p.averageCost * p.position) - 1) * 100) : null,
        currency: p.currency || 'USD',
        market: p.market,
      }));
    },

    async getQuote(symbol) {
      const result = await _request('quote_real_time', { symbols: symbol });
      if (!result.ok || !result.data) return null;
      const items = Array.isArray(result.data) ? result.data : [result.data];
      const q = items[0];
      if (!q) return null;
      return {
        symbol: q.symbol,
        price: q.latestPrice,
        bid: q.bidPrice,
        ask: q.askPrice,
        volume: q.volume,
        change: q.change,
        changePct: q.changePercent,
      };
    },

    async searchSymbol(query) {
      const result = await _request('stock_search', { keyword: query, limit: 20 });
      if (!result.ok) return [];
      const items = Array.isArray(result.data) ? result.data : [];
      return items.map(s => ({
        conid: s.symbol,
        symbol: s.symbol,
        name: s.name || s.nameCN || '',
        exchange: s.exchange || s.market || '',
        type: s.secType || 'STK',
        market: s.market,
      }));
    },

    async placeOrder(order) {
      const result = await _request('place_order', {
        account: paper ? 'PAPER' : 'REAL',
        symbol: order.symbol || order.conid,
        action: order.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
        orderType: order.type === 'limit' ? 'LMT' : 'MKT',
        totalQuantity: order.qty,
        ...(order.type === 'limit' ? { limitPrice: order.price } : {}),
        timeInForce: order.tif || 'DAY',
        outsideRth: false,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        orderId: result.data?.orderId || result.data?.id,
        status: result.data?.status || 'submitted',
      };
    },

    async cancelOrder(orderId) {
      const result = await _request('cancel_order', {
        account: paper ? 'PAPER' : 'REAL',
        orderId: parseInt(orderId),
      });
      return { ok: result.ok, error: result.error };
    },

    async getOrders() {
      const result = await _request('orders', {
        account: paper ? 'PAPER' : 'REAL',
        status: 'Active',
      });
      if (!result.ok) return [];
      const items = Array.isArray(result.data) ? result.data : (result.data?.items || []);
      return items.map(o => ({
        orderId: o.orderId?.toString(),
        symbol: o.symbol,
        side: o.action,
        qty: o.totalQuantity,
        price: o.limitPrice,
        status: o.status,
        filledQty: o.filledQuantity,
        avgPrice: o.avgFillPrice,
        orderType: o.orderType,
      }));
    },

    destroy() {},
  };
}
