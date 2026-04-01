/**
 * Interactive Brokers — TWS API 适配器
 *
 * 通过 @stoqey/ib 连接本地 IB Gateway（TWS API 模式，端口 4001/4002）。
 * 不是 Client Portal REST API — 是原生 TWS socket 协议。
 *
 * 端口：4001 = 实盘，4002 = 模拟盘
 */

import { IBApi, EventName, SecType, OrderAction, OrderType, TimeInForce } from '@stoqey/ib';

const TIMEOUT = 10000;

export function createIbkrAdapter(config) {
  const { gatewayUrl, accountId } = config;

  // 从 gatewayUrl 提取 host 和 port，或用默认值
  let host = '127.0.0.1';
  let port = 4001;
  if (gatewayUrl) {
    try {
      const url = new URL(gatewayUrl);
      host = url.hostname || '127.0.0.1';
      port = parseInt(url.port) || 4001;
    } catch {
      // 纯端口号
      const p = parseInt(gatewayUrl);
      if (p > 0) port = p;
    }
  }

  let _ib = null;
  let _connected = false;
  let _nextReqId = 1000;
  let _account = accountId || '';

  function _getIb() {
    if (_ib && _connected) return _ib;
    _ib = new IBApi({ host, port, clientId: Math.floor(Math.random() * 9000) + 1000 });
    return _ib;
  }

  function _reqId() { return _nextReqId++; }

  /** 等待特定事件，带超时 */
  function _waitEvent(ib, event, timeoutMs = TIMEOUT) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${event}`));
      }, timeoutMs);
      ib.once(event, (...args) => {
        clearTimeout(timer);
        resolve(args);
      });
    });
  }

  /** 收集多个回调直到 End 事件 */
  function _collectUntilEnd(ib, dataEvent, endEvent, reqId, timeoutMs = TIMEOUT) {
    return new Promise((resolve, reject) => {
      const items = [];
      const timer = setTimeout(() => {
        ib.removeAllListeners(dataEvent);
        ib.removeAllListeners(endEvent);
        resolve(items); // 超时也返回已收集的
      }, timeoutMs);

      const onData = (id, ...args) => {
        if (id === reqId) items.push(args);
      };
      const onEnd = (id) => {
        if (id === reqId) {
          clearTimeout(timer);
          ib.removeListener(dataEvent, onData);
          ib.removeListener(endEvent, onEnd);
          resolve(items);
        }
      };
      ib.on(dataEvent, onData);
      ib.on(endEvent, onEnd);
    });
  }

  return {
    async authenticate() {
      try {
        const ib = _getIb();
        ib.connect();
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Connection timeout')), 5000);
          ib.once(EventName.connected, () => { clearTimeout(t); resolve(); });
          ib.once(EventName.error, (err) => { clearTimeout(t); reject(err); });
        });
        _connected = true;

        // 获取管理的账户
        const accounts = await new Promise((resolve) => {
          const t = setTimeout(() => resolve([_account]), 3000);
          ib.once(EventName.managedAccounts, (accts) => {
            clearTimeout(t);
            resolve(typeof accts === 'string' ? accts.split(',') : [accts]);
          });
          ib.reqManagedAccts();
        });

        if (accounts.length > 0 && !_account) _account = accounts[0];
        console.log(`[ibkr] Connected to Gateway ${host}:${port}, account: ${_account}`);
        return { ok: true, accountId: _account, authenticated: true, accounts };
      } catch (e) {
        _connected = false;
        return { ok: false, error: e.message || 'Connection failed. Is IB Gateway running?' };
      }
    },

    startKeepAlive() { /* TWS 连接自带心跳 */ },
    stopKeepAlive() {},
    isAuthenticated() { return _connected; },

    async getAccount() {
      if (!_connected) return { ok: false, error: 'Not connected' };
      try {
        const ib = _getIb();
        const summary = {};
        const reqId = _reqId();

        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            ib.removeAllListeners(EventName.accountSummary);
            ib.removeAllListeners(EventName.accountSummaryEnd);
            ib.cancelAccountSummary(reqId);
            resolve({
              ok: true,
              balance: summary.TotalCashValue || null,
              buyingPower: summary.BuyingPower || null,
              netLiquidation: summary.NetLiquidation || null,
              grossPosition: summary.GrossPositionValue || null,
              currency: 'USD',
            });
          }, 5000);

          ib.on(EventName.accountSummary, (id, account, tag, value, currency) => {
            if (id === reqId && value) {
              summary[tag] = parseFloat(value);
            }
          });

          ib.once(EventName.accountSummaryEnd, (id) => {
            if (id === reqId) {
              clearTimeout(timer);
              ib.removeAllListeners(EventName.accountSummary);
              ib.cancelAccountSummary(reqId);
              resolve({
                ok: true,
                balance: summary.TotalCashValue || null,
                buyingPower: summary.BuyingPower || null,
                netLiquidation: summary.NetLiquidation || null,
                grossPosition: summary.GrossPositionValue || null,
                currency: 'USD',
              });
            }
          });

          // 先注册监听器，再发请求
          ib.reqAccountSummary(reqId, 'All', 'TotalCashValue,BuyingPower,NetLiquidation,GrossPositionValue');
        });
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async getPositions() {
      if (!_connected) return [];
      try {
        const ib = _getIb();
        const positions = [];

        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            ib.removeAllListeners(EventName.position);
            ib.removeAllListeners(EventName.positionEnd);
            resolve(positions);
          }, 5000);

          ib.on(EventName.position, (account, contract, pos, avgCost) => {
            if (pos !== 0) {
              positions.push({
                symbol: contract.symbol,
                conid: contract.conId,
                qty: pos,
                avgCost,
                currency: contract.currency,
                exchange: contract.exchange || contract.primaryExch,
                secType: contract.secType,
              });
            }
          });

          ib.once(EventName.positionEnd, () => {
            clearTimeout(timer);
            ib.removeAllListeners(EventName.position);
            resolve(positions);
          });

          ib.reqPositions();
        });
      } catch (e) {
        console.error('[ibkr] getPositions error:', e.message);
        return [];
      }
    },

    async getQuote(symbol) {
      // TWS API 的报价需要市场数据订阅，简化处理
      return { symbol, price: null, bid: null, ask: null, note: 'Use searchSymbol to get conId, then subscribe to market data' };
    },

    async searchSymbol(query) {
      if (!_connected) return [];
      try {
        const ib = _getIb();
        const reqId = _reqId();

        return new Promise((resolve) => {
          const results = [];
          const timer = setTimeout(() => resolve(results), 3000);

          ib.on(EventName.symbolSamples, (id, descriptions) => {
            if (id === reqId) {
              clearTimeout(timer);
              for (const d of descriptions || []) {
                results.push({
                  conid: d.conId,
                  symbol: d.symbol,
                  name: d.description || '',
                  exchange: d.primaryExch || '',
                  type: d.secType || 'STK',
                  currency: d.currency || 'USD',
                });
              }
              resolve(results);
            }
          });

          ib.reqMatchingSymbols(reqId, query);
        });
      } catch (e) {
        return [];
      }
    },

    async placeOrder(order) {
      if (!_connected) return { ok: false, error: 'Not connected' };
      try {
        const ib = _getIb();
        const orderId = _reqId();

        const contract = {
          symbol: order.symbol || '',
          secType: SecType.STK,
          exchange: 'SMART',
          currency: order.currency || 'USD',
        };
        if (order.conid) contract.conId = order.conid;

        const ibOrder = {
          action: order.side.toUpperCase() === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
          totalQuantity: order.qty,
          orderType: order.type === 'limit' ? OrderType.LMT : OrderType.MKT,
          tif: order.tif || TimeInForce.DAY,
          account: _account,
        };
        if (order.type === 'limit' && order.price) ibOrder.lmtPrice = order.price;

        ib.placeOrder(orderId, contract, ibOrder);
        console.log(`[ibkr] Order placed: ${order.side} ${order.qty} ${order.symbol} @ ${order.price || 'MKT'} (id=${orderId})`);

        return { ok: true, orderId, status: 'submitted' };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async cancelOrder(orderId) {
      if (!_connected) return { ok: false, error: 'Not connected' };
      try {
        _getIb().cancelOrder(parseInt(orderId));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async getOrders() {
      if (!_connected) return [];
      try {
        const ib = _getIb();
        const orders = [];

        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            ib.removeAllListeners(EventName.openOrder);
            ib.removeAllListeners(EventName.openOrderEnd);
            resolve(orders);
          }, 5000);

          ib.on(EventName.openOrder, (orderId, contract, order, orderState) => {
            orders.push({
              orderId,
              symbol: contract.symbol,
              side: order.action,
              qty: order.totalQuantity,
              price: order.lmtPrice,
              status: orderState.status,
              filledQty: order.filledQuantity || 0,
              orderType: order.orderType,
            });
          });

          ib.once(EventName.openOrderEnd, () => {
            clearTimeout(timer);
            ib.removeAllListeners(EventName.openOrder);
            resolve(orders);
          });

          ib.reqAllOpenOrders();
        });
      } catch (e) {
        return [];
      }
    },

    destroy() {
      if (_ib) {
        try { _ib.disconnect(); } catch {}
        _ib = null;
        _connected = false;
      }
    },
  };
}
