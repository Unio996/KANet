/**
 * Tradier — REST API 适配器
 *
 * Bearer Token 认证，美股 + 期权。
 * Sandbox (paper) 和 Production (live) 用不同 base URL。
 *
 * 注册：https://developer.tradier.com/user/sign_up
 * API Token：Dashboard → API Access → Create Token
 *
 * 文档：https://documentation.tradier.com/
 */

const TIMEOUT = 8000;

export function createTradierAdapter(config) {
  const { accessToken, paper } = config;
  const baseUrl = paper !== false
    ? 'https://sandbox.tradier.com'
    : 'https://api.tradier.com';

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  async function _fetch(path, opts = {}) {
    try {
      // lint-allow-fetch: PZ-ALPACA-T1 broker-tradier → agent-broker-adapter refactor (phase Y+1, 同 broker-alpaca)
      const res = await fetch(`${baseUrl}${path}`, {
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
      const result = await _fetch('/v1/user/profile');
      if (result.ok && result.data?.profile) {
        const acct = result.data.profile.account;
        const accountId = Array.isArray(acct) ? acct[0]?.account_number : acct?.account_number;
        return { ok: true, accountId, authenticated: true };
      }
      return { ok: false, error: result.error || 'Authentication failed. Check Access Token.' };
    },

    startKeepAlive() { /* Token 不过期 */ },
    stopKeepAlive() {},
    isAuthenticated() { return true; },

    async getAccount() {
      const result = await _fetch('/v1/user/profile');
      if (!result.ok) return { ok: false, error: result.error };
      const acct = result.data?.profile?.account;
      const account = Array.isArray(acct) ? acct[0] : acct;
      if (!account) return { ok: false, error: 'No account found' };

      // 获取余额
      const balResult = await _fetch(`/v1/accounts/${account.account_number}/balances`);
      const bal = balResult.data?.balances;
      return {
        ok: true,
        accountId: account.account_number,
        balance: bal?.total_cash,
        buyingPower: bal?.option_buying_power || bal?.stock_buying_power,
        netLiquidation: bal?.total_equity,
        currency: 'USD',
      };
    },

    async getPositions() {
      // 先拿账户号
      const profile = await _fetch('/v1/user/profile');
      const acct = profile.data?.profile?.account;
      const accountNum = Array.isArray(acct) ? acct[0]?.account_number : acct?.account_number;
      if (!accountNum) return [];

      const result = await _fetch(`/v1/accounts/${accountNum}/positions`);
      if (!result.ok) return [];
      const pos = result.data?.positions?.position;
      if (!pos) return [];
      const list = Array.isArray(pos) ? pos : [pos];
      return list.map(p => ({
        symbol: p.symbol,
        conid: p.id,
        qty: p.quantity,
        avgCost: p.cost_basis / p.quantity,
        marketValue: p.quantity * (p.last_price || 0),
        pnl: (p.quantity * (p.last_price || 0)) - p.cost_basis,
        pnlPct: p.cost_basis > 0 ? ((p.quantity * (p.last_price || 0)) / p.cost_basis - 1) * 100 : null,
        currency: 'USD',
      }));
    },

    async getQuote(symbol) {
      const result = await _fetch(`/v1/markets/quotes?symbols=${symbol}`);
      if (!result.ok) return null;
      const q = result.data?.quotes?.quote;
      if (!q) return null;
      const quote = Array.isArray(q) ? q[0] : q;
      return {
        symbol: quote.symbol,
        price: quote.last,
        bid: quote.bid,
        ask: quote.ask,
        volume: quote.volume,
        change: quote.change,
        changePct: quote.change_percentage,
      };
    },

    async searchSymbol(query) {
      const result = await _fetch(`/v1/markets/lookup?q=${encodeURIComponent(query)}`);
      if (!result.ok) return [];
      const securities = result.data?.securities?.security;
      if (!securities) return [];
      const list = Array.isArray(securities) ? securities : [securities];
      return list.slice(0, 20).map(s => ({
        conid: s.symbol,
        symbol: s.symbol,
        name: s.description,
        exchange: s.exchange,
        type: s.type,
      }));
    },

    async placeOrder(order) {
      const profile = await _fetch('/v1/user/profile');
      const acct = profile.data?.profile?.account;
      const accountNum = Array.isArray(acct) ? acct[0]?.account_number : acct?.account_number;
      if (!accountNum) return { ok: false, error: 'No account' };

      const params = new URLSearchParams({
        class: 'equity',
        symbol: order.symbol || order.conid,
        side: order.side.toLowerCase(),
        quantity: order.qty.toString(),
        type: order.type === 'limit' ? 'limit' : 'market',
        duration: order.tif === 'GTC' ? 'gtc' : 'day',
      });
      if (order.type === 'limit' && order.price) params.set('price', order.price.toString());

      const result = await _fetch(`/v1/accounts/${accountNum}/orders`, {
        method: 'POST',
        body: params.toString(),
      });
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        orderId: result.data?.order?.id,
        status: result.data?.order?.status || 'submitted',
      };
    },

    async cancelOrder(orderId) {
      const profile = await _fetch('/v1/user/profile');
      const acct = profile.data?.profile?.account;
      const accountNum = Array.isArray(acct) ? acct[0]?.account_number : acct?.account_number;
      if (!accountNum) return { ok: false, error: 'No account' };

      const result = await _fetch(`/v1/accounts/${accountNum}/orders/${orderId}`, { method: 'DELETE' });
      return { ok: result.ok, error: result.error };
    },

    async getOrders() {
      const profile = await _fetch('/v1/user/profile');
      const acct = profile.data?.profile?.account;
      const accountNum = Array.isArray(acct) ? acct[0]?.account_number : acct?.account_number;
      if (!accountNum) return [];

      const result = await _fetch(`/v1/accounts/${accountNum}/orders`);
      if (!result.ok) return [];
      const orders = result.data?.orders?.order;
      if (!orders) return [];
      const list = Array.isArray(orders) ? orders : [orders];
      return list.filter(o => o.status === 'pending' || o.status === 'open').map(o => ({
        orderId: o.id,
        symbol: o.symbol,
        side: (o.side || '').toUpperCase(),
        qty: o.quantity,
        price: o.price,
        status: o.status,
        filledQty: o.exec_quantity || 0,
        avgPrice: o.avg_fill_price,
        orderType: o.type,
      }));
    },

    destroy() {},
  };
}
