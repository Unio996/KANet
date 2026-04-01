/**
 * Broker API — 券商统一接口
 *
 * 管理券商账户连接 + 持仓 + 交易
 * 支持：IBKR / Alpaca / Tradier / Tiger
 */
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../services/crypto.js';
import { createIbkrAdapter } from '../services/broker-ibkr.js';
import { downloadFile, runInstaller, checkProcess, getSystemInfo, getAvailableDownloads, checkInstalled } from '../services/system-actions.js';
import { createAlpacaAdapter } from '../services/broker-alpaca.js';
import { createTradierAdapter } from '../services/broker-tradier.js';
import { createTigerAdapter } from '../services/broker-tiger.js';

// 券商注册表 — 每种券商的元数据
export const BROKER_REGISTRY = {
  ibkr: {
    name: 'Interactive Brokers',
    description: '全球 150+ 市场，美股/港股/欧股/期货/期权',
    auth: 'gateway',       // 需要本地 Gateway
    fields: ['gateway_url', 'account_id'],
    markets: ['美股', '港股', '欧股', '期货', '期权', '外汇'],
    registerUrl: 'https://www.interactivebrokers.com',
    guide: '需要下载 IB Gateway 客户端并保持运行',
  },
  alpaca: {
    name: 'Alpaca',
    description: '美股零佣金，API 友好，最简单的接入',
    auth: 'api_key',       // API Key + Secret
    fields: ['api_key', 'api_secret'],
    markets: ['美股'],
    registerUrl: 'https://app.alpaca.markets/signup',
    guide: '注册后在 Dashboard → API Keys 创建 Key',
  },
  tradier: {
    name: 'Tradier',
    description: '美股 + 期权，有 Sandbox 模拟环境',
    auth: 'token',         // Bearer Token
    fields: ['access_token'],
    markets: ['美股', '期权'],
    registerUrl: 'https://developer.tradier.com/user/sign_up',
    guide: '注册后在 Dashboard → API Access 获取 Token',
  },
  tiger: {
    name: 'Tiger Brokers (老虎证券)',
    description: '美股/港股/A股(沪港通)，中文界面',
    auth: 'rsa',           // Tiger ID + RSA Private Key
    fields: ['tiger_id', 'private_key'],
    markets: ['美股', '港股', 'A股'],
    registerUrl: 'https://quant.itigerup.com/',
    guide: '注册开发者账户，获取 Tiger ID 和 RSA Private Key',
  },
};

// 活跃的 adapter 实例缓存
const _adapters = {};

function _getAdapter(accountId) {
  if (_adapters[accountId]) return _adapters[accountId];
  const row = sqlite.prepare('SELECT * FROM broker_accounts WHERE id = ?').get(accountId);
  if (!row) return null;

  // 解密凭证
  let creds = {};
  if (row.credentials_encrypted) {
    try { creds = JSON.parse(decrypt(row.credentials_encrypted)); } catch {}
  }
  let gatewayUrl = 'https://localhost:5000';
  if (row.gateway_url_encrypted) {
    try { gatewayUrl = decrypt(row.gateway_url_encrypted); } catch {}
  }

  const paper = row.paper_trading === 1;
  let adapter;

  switch (row.broker_type) {
    case 'alpaca':
      adapter = createAlpacaAdapter({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, paper });
      break;
    case 'tradier':
      adapter = createTradierAdapter({ accessToken: creds.accessToken, paper });
      break;
    case 'tiger':
      adapter = createTigerAdapter({ tigerId: creds.tigerId, privateKeyPem: creds.privateKey, paper });
      break;
    case 'ibkr':
    default:
      adapter = createIbkrAdapter({ gatewayUrl, accountId: row.account_id });
      break;
  }

  _adapters[accountId] = adapter;
  return adapter;
}

export async function registerBrokerRoutes(fastify) {

  // ── 账户管理 ──

  // GET /api/broker/accounts — 已连接的券商列表
  fastify.get('/api/broker/accounts', async (request, reply) => {
    const list = sqlite.prepare(
      'SELECT id, name, broker_type, account_id, paper_trading, status, last_sync_at, created_at FROM broker_accounts ORDER BY created_at'
    ).all();
    return reply.send(list);
  });

  // GET /api/broker/registry — 支持的券商列表
  fastify.get('/api/broker/registry', async (request, reply) => {
    return reply.send(BROKER_REGISTRY);
  });

  // POST /api/broker/accounts — 添加券商连接
  fastify.post('/api/broker/accounts', async (request, reply) => {
    const { name, broker_type, account_id, gateway_url, paper_trading,
            api_key, api_secret, access_token, tiger_id, private_key } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ error: 'name 必填' });

    const type = broker_type || 'ibkr';
    const registry = BROKER_REGISTRY[type];
    if (!registry) return reply.code(400).send({ error: `不支持的券商类型: ${type}` });

    // 按类型组装凭证
    let creds = {};
    switch (type) {
      case 'alpaca':
        if (!api_key || !api_secret) return reply.code(400).send({ error: 'Alpaca 需要 api_key 和 api_secret' });
        creds = { apiKey: api_key, apiSecret: api_secret };
        break;
      case 'tradier':
        if (!access_token) return reply.code(400).send({ error: 'Tradier 需要 access_token' });
        creds = { accessToken: access_token };
        break;
      case 'tiger':
        if (!tiger_id || !private_key) return reply.code(400).send({ error: 'Tiger 需要 tiger_id 和 private_key' });
        creds = { tigerId: tiger_id, privateKey: private_key };
        break;
      case 'ibkr':
        if (!account_id?.trim()) return reply.code(400).send({ error: 'IBKR 需要 account_id' });
        break;
    }

    const id = randomUUID();
    const gwEncrypted = gateway_url ? encrypt(gateway_url) : null;
    const credsEncrypted = Object.keys(creds).length > 0 ? encrypt(JSON.stringify(creds)) : null;

    sqlite.prepare(
      'INSERT INTO broker_accounts (id, name, broker_type, account_id, gateway_url_encrypted, credentials_encrypted, paper_trading, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).run(id, name.trim(), type, (account_id || '').trim() || null, gwEncrypted, credsEncrypted, paper_trading ?? 1, 'pending');

    return reply.send({ ok: true, id });
  });

  // POST /api/broker/accounts/:id/test — 测试连接
  fastify.post('/api/broker/accounts/:id/test', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });

    const result = await adapter.authenticate();
    const newStatus = result.ok ? 'connected' : 'error';
    sqlite.prepare('UPDATE broker_accounts SET status = ?, last_sync_at = datetime(\'now\') WHERE id = ?')
      .run(newStatus, request.params.id);

    if (result.ok) {
      adapter.startKeepAlive(() => {
        sqlite.prepare("UPDATE broker_accounts SET status = 'disconnected' WHERE id = ?").run(request.params.id);
        console.log(`[broker] IBKR session expired for ${request.params.id}`);
      });
    }

    return reply.send({ ok: result.ok, status: newStatus, error: result.error });
  });

  // DELETE /api/broker/accounts/:id — 删除
  fastify.delete('/api/broker/accounts/:id', async (request, reply) => {
    const adapter = _adapters[request.params.id];
    if (adapter) { adapter.destroy(); delete _adapters[request.params.id]; }
    const result = sqlite.prepare('DELETE FROM broker_accounts WHERE id = ?').run(request.params.id);
    return reply.send({ ok: result.changes > 0 });
  });

  // ── 交易操作 ──

  // GET /api/broker/:id/account — 账户摘要
  fastify.get('/api/broker/:id/account', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });
    const result = await adapter.getAccount();
    return reply.send(result);
  });

  // GET /api/broker/:id/positions — 持仓
  fastify.get('/api/broker/:id/positions', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });
    const positions = await adapter.getPositions();
    return reply.send({ positions });
  });

  // GET /api/broker/:id/orders — 订单
  fastify.get('/api/broker/:id/orders', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });
    const orders = await adapter.getOrders();
    return reply.send({ orders });
  });

  // POST /api/broker/:id/order — 下单
  fastify.post('/api/broker/:id/order', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });

    const { conid, symbol, side, qty, type, price, tif } = request.body || {};
    if (!conid || !side || !qty) {
      return reply.code(400).send({ error: 'conid, side (buy/sell), qty 必填' });
    }

    // 搜索 conid（如果传的是 symbol）
    let targetConid = conid;
    if (!targetConid && symbol) {
      const results = await adapter.searchSymbol(symbol);
      if (results.length > 0) targetConid = results[0].conid;
      else return reply.code(400).send({ error: `找不到标的: ${symbol}` });
    }

    const result = await adapter.placeOrder({
      conid: targetConid,
      side,
      qty: parseInt(qty),
      type: type || 'market',
      price: price ? parseFloat(price) : undefined,
      tif: tif || 'DAY',
    });
    return reply.send(result);
  });

  // DELETE /api/broker/:id/order/:orderId — 撤单
  fastify.delete('/api/broker/:id/order/:orderId', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });
    const result = await adapter.cancelOrder(request.params.orderId);
    return reply.send(result);
  });

  // GET /api/broker/:id/search — 搜索标的
  fastify.get('/api/broker/:id/search', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });
    const { q } = request.query;
    if (!q?.trim()) return reply.send([]);
    const results = await adapter.searchSymbol(q.trim());
    return reply.send(results);
  });

  // GET /api/broker/:id/quote/:conid — 报价
  fastify.get('/api/broker/:id/quote/:conid', async (request, reply) => {
    const adapter = _getAdapter(request.params.id);
    if (!adapter) return reply.code(404).send({ error: '账户不存在' });
    const quote = await adapter.getQuote(request.params.conid);
    return reply.send(quote || { error: 'no data' });
  });

  // ── 系统操作（白名单制） ──

  // GET /api/system/info — 当前系统信息
  fastify.get('/api/system/info', async (request, reply) => {
    return reply.send(getSystemInfo());
  });

  // GET /api/system/downloads — 可用的下载列表
  fastify.get('/api/system/downloads', async (request, reply) => {
    return reply.send(getAvailableDownloads());
  });

  // POST /api/system/download — 下载白名单文件
  fastify.post('/api/system/download', async (request, reply) => {
    const { actionId } = request.body || {};
    if (!actionId) return reply.code(400).send({ error: 'actionId required' });
    const result = await downloadFile(actionId);
    return reply.send(result);
  });

  // POST /api/system/run — 运行白名单安装程序
  fastify.post('/api/system/run', async (request, reply) => {
    const { filePath } = request.body || {};
    if (!filePath) return reply.code(400).send({ error: 'filePath required' });
    const result = runInstaller(filePath);
    return reply.send(result);
  });

  // GET /api/system/check-installed — 检查软件是否已安装
  fastify.get('/api/system/check-installed', async (request, reply) => {
    const { name } = request.query;
    if (!name) return reply.code(400).send({ error: 'name required' });
    return reply.send(checkInstalled(name));
  });

  // GET /api/system/check-process — 检查进程是否运行
  fastify.get('/api/system/check-process', async (request, reply) => {
    const { name } = request.query;
    if (!name) return reply.code(400).send({ error: 'name required' });
    const result = await checkProcess(name);
    return reply.send(result);
  });

  // ── 启动时自动重连已 connected 的券商 ──
  setTimeout(async () => {
    const accounts = sqlite.prepare("SELECT id, name, broker_type FROM broker_accounts WHERE status = 'connected'").all();
    for (const acct of accounts) {
      try {
        const adapter = _getAdapter(acct.id);
        if (adapter) {
          const result = await adapter.authenticate();
          if (result.ok) {
            console.log(`[broker] Auto-reconnected: ${acct.name} (${acct.broker_type})`);
            adapter.startKeepAlive?.(() => {
              sqlite.prepare("UPDATE broker_accounts SET status = 'disconnected' WHERE id = ?").run(acct.id);
            });
          } else {
            console.log(`[broker] Auto-reconnect failed: ${acct.name} — ${result.error}`);
            sqlite.prepare("UPDATE broker_accounts SET status = 'disconnected' WHERE id = ?").run(acct.id);
          }
        }
      } catch (e) {
        console.log(`[broker] Auto-reconnect error: ${acct.name} — ${e.message}`);
      }
    }
  }, 5000); // 5 秒后自动重连（等其他服务就绪）
}
