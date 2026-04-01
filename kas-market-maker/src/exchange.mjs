/**
 * exchange.mjs — MEXC exchange operations for inventory rebalancing
 */

import { createHmac } from 'node:crypto';

export class Exchange {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.symbol = config.symbol || 'KASUSDT';
  }

  /** Get account balances */
  async getBalances() {
    const data = await this._signedGet('/account');
    const balances = {};
    for (const b of (data.balances || [])) {
      const free = parseFloat(b.free);
      if (free > 0) balances[b.asset] = free;
    }
    return balances;
  }

  /** Place a limit order */
  async placeOrder(side, quantity, price) {
    return this._signedPost('/order', {
      symbol: this.symbol,
      side: side.toUpperCase(),
      type: 'LIMIT',
      quantity: String(quantity),
      price: String(price),
    });
  }

  /** Place a market order — immediate execution for hedging */
  async marketOrder(side, quantity) {
    return this._signedPost('/order', {
      symbol: this.symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: String(quantity),
    });
  }

  /** Hedge: execute opposite trade on exchange to lock in spread profit */
  async hedge(side, kasAmount) {
    // If MM sold KAS on-chain → buy same amount on exchange to replenish
    // If MM bought KAS on-chain → sell same amount on exchange to lock profit
    const exchangeSide = side === 'sell' ? 'BUY' : 'SELL';
    const result = await this.marketOrder(exchangeSide, kasAmount);
    return {
      orderId: result?.orderId,
      side: exchangeSide,
      quantity: kasAmount,
      executedPrice: parseFloat(result?.price || result?.fills?.[0]?.price || '0'),
      raw: result,
    };
  }

  /** Get current ticker price */
  async getPrice() {
    const res = await fetch(`${this.baseUrl}/ticker/price?symbol=${this.symbol}`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return parseFloat(data.price);
  }

  async _signedGet(path) {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = createHmac('sha256', this.apiSecret).update(query).digest('hex');
    const url = `${this.baseUrl}${path}?${query}&signature=${signature}`;
    const res = await fetch(url, {
      headers: { 'X-MEXC-APIKEY': this.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }

  async _signedPost(path, params) {
    const timestamp = Date.now();
    const query = Object.entries({ ...params, timestamp }).map(([k, v]) => `${k}=${v}`).join('&');
    const signature = createHmac('sha256', this.apiSecret).update(query).digest('hex');
    const url = `${this.baseUrl}${path}?${query}&signature=${signature}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-MEXC-APIKEY': this.apiKey },
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }
}
