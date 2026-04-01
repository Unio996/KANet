/**
 * Alpaca Markets — REST API 适配器
 *
 * 最简单的券商接入：纯 API Key + Secret，REST 调用，无需 Gateway。
 * 支持 Paper Trading (paper-api) 和 Live (api)。
 *
 * 注册：https://app.alpaca.markets/signup
 * API Key：Dashboard → API Keys → Generate
 *
 * 文档：https://docs.alpaca.markets/reference
 */

const TIMEOUT = 8000;

export function createAlpacaAdapter(config) {
  const { apiKey, apiSecret, paper } = config;
  const baseUrl = paper !== false
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';
  const dataUrl = 'https://data.alpaca.markets';

  const headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
    'Content-Type': 'application/json',
  };

  async function _fetch(url, opts = {}) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { ...headers, ...opts.headers },
        signal: AbortSignal.timeout(opts.timeout || TIMEOUT),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return {
    async authenticate() {
      const result = await _fetch(`${baseUrl}/v2/account`);
      if (result.ok) {
        return { ok: true, accountId: result.data.account_number, authenticated: true };
      }
      return { ok: false, error: result.error || 'Authentication failed. Check API Key and Secret.' };
    },

    startKeepAlive() { /* Alpaca 无需保活，API Key 不过期 */ },
    stopKeepAlive() {},
    isAuthenticated() { return true; },

    async getAccount() {
      const result = await _fetch(`${baseUrl}/v2/account`);
      if (!result.ok) return { ok: false, error: result.error };
      const d = result.data;
      return {
        ok: true,
        balance: parseFloat(d.cash),
        buyingPower: parseFloat(d.buying_power),
        netLiquidation: parseFloat(d.equity),
        currency: 'USD',
        dayTradeCount: d.daytrade_count,
        patternDayTrader: d.pattern_day_trader,
      };
    },

    async getPositions() {
      const result = await _fetch(`${baseUrl}/v2/positions`);
      if (!result.ok) return [];
      return (result.data || []).map(p => ({
        symbol: p.symbol,
        conid: p.asset_id,
        qty: parseFloat(p.qty),
        avgCost: parseFloat(p.avg_entry_price),
        marketValue: parseFloat(p.market_value),
        pnl: parseFloat(p.unrealized_pl),
        pnlPct: parseFloat(p.unrealized_plpc) * 100,
        side: p.side,
        currency: 'USD',
      }));
    },

    async getQuote(symbol) {
      const result = await _fetch(`${dataUrl}/v2/stocks/${symbol}/quotes/latest`);
      if (!result.ok) return null;
      const q = result.data?.quote;
      if (!q) return null;
      return {
        symbol,
        bid: q.bp,
        ask: q.ap,
        price: (q.bp + q.ap) / 2,
        bidSize: q.bs,
        askSize: q.as,
      };
    },

    async searchSymbol(query) {
      // Alpaca 用 assets endpoint 搜索
      const result = await _fetch(`${baseUrl}/v2/assets?status=active&asset_class=us_equity`);
      if (!result.ok) return [];
      const q = query.toLowerCase();
      return (result.data || [])
        .filter(a => a.symbol.toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
        .slice(0, 20)
        .map(a => ({
          conid: a.id,
          symbol: a.symbol,
          name: a.name,
          exchange: a.exchange,
          type: a.asset_class,
          tradable: a.tradable,
          fractionable: a.fractionable,
        }));
    },

    async placeOrder(order) {
      const body = {
        symbol: order.symbol || order.conid,
        qty: order.qty.toString(),
        side: order.side.toLowerCase(),
        type: order.type === 'limit' ? 'limit' : 'market',
        time_in_force: order.tif === 'GTC' ? 'gtc' : 'day',
      };
      if (order.type === 'limit' && order.price) body.limit_price = order.price.toString();

      const result = await _fetch(`${baseUrl}/v2/orders`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        orderId: result.data.id,
        status: result.data.status,
        symbol: result.data.symbol,
      };
    },

    async cancelOrder(orderId) {
      const result = await _fetch(`${baseUrl}/v2/orders/${orderId}`, { method: 'DELETE' });
      return { ok: result.ok || result.status === 204, error: result.error };
    },

    async getOrders() {
      const result = await _fetch(`${baseUrl}/v2/orders?status=open&limit=50`);
      if (!result.ok) return [];
      return (result.data || []).map(o => ({
        orderId: o.id,
        symbol: o.symbol,
        side: o.side.toUpperCase(),
        qty: parseFloat(o.qty),
        price: o.limit_price ? parseFloat(o.limit_price) : null,
        status: o.status,
        filledQty: parseFloat(o.filled_qty),
        avgPrice: o.filled_avg_price ? parseFloat(o.filled_avg_price) : null,
        orderType: o.type,
        createdAt: o.created_at,
      }));
    },

    destroy() {},
  };
}
