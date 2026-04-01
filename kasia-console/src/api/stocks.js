/**
 * Stocks & Predictions API + Page Routes
 *
 * 股票自选股 CRUD + 实时行情 + 预测市场
 * 页面路由：/stocks, /predictions
 */
import { sqlite } from '../db/client.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import crypto, { randomUUID } from 'crypto';
import { fetchStockData, fetchYahooQuote, cachedPredictions, cachedCommodities, cachedFunding, cachedSentiment, fetchAllMarkets, cachedCrypto, cachedFundamentals, cachedIndustryPeers, DIVERGENCE_WARN_THRESHOLD } from '../services/market-data.js';
import { getPolygonWallet, getUsdcBalance, createApiKey, getOrderBook, getPositions, placeOrder, cancelOrder, getOpenOrders, checkAllowance, approveUsdc, checkTxStatus } from '../services/polymarket.js';
import { decrypt } from '../services/crypto.js';

// Agent 综述缓存（15 分钟）
let _briefCache = { text: null, agent: null, ts: 0 };
const BRIEF_TTL = 15 * 60 * 1000;

export async function registerStockRoutes(fastify) {

  // ── Page routes ──

  fastify.get('/market-overview', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    return reply.view('market-overview', { title: '市场概览', t, lang, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES, _page: 'market-overview' });
  });

  fastify.get('/stocks', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = sqlite.prepare('SELECT id, name FROM relay_nodes ORDER BY name').all();
    return reply.view('stocks', { title: '股票市场', t, lang, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES, _page: 'stocks', relayNodes });
  });

  fastify.get('/predictions', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const relayNodes = sqlite.prepare('SELECT id, name FROM relay_nodes ORDER BY name').all();
    return reply.view('predictions', { title: '预测市场', t, lang, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES, _page: 'predictions', relayNodes });
  });

  // ── Watchlist CRUD ──

  // GET /api/stocks/watchlist — 自选股列表
  fastify.get('/api/stocks/watchlist', async (request, reply) => {
    const list = sqlite.prepare('SELECT * FROM stock_watchlist ORDER BY created_at').all();
    return reply.send(list);
  });

  // POST /api/stocks/watchlist — 添加自选股
  fastify.post('/api/stocks/watchlist', async (request, reply) => {
    const { symbol, name, market, sector, notes } = request.body || {};
    if (!symbol?.trim()) return reply.code(400).send({ error: 'symbol required' });

    const sym = symbol.trim().toUpperCase();

    // 检查重复
    const exists = sqlite.prepare('SELECT id FROM stock_watchlist WHERE symbol = ?').get(sym);
    if (exists) return reply.code(409).send({ error: 'already in watchlist' });

    // 如果没提供名称，尝试从 Yahoo Finance 获取
    let resolvedName = name?.trim() || null;
    if (!resolvedName) {
      try {
        const quote = await fetchYahooQuote(sym);
        resolvedName = quote?.name || sym;
      } catch {}
    }

    const id = randomUUID();
    sqlite.prepare(
      'INSERT INTO stock_watchlist (id, symbol, name, market, sector, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, sym, resolvedName, market || 'us', sector || null, notes || null, new Date().toISOString());

    return reply.send({ ok: true, id, symbol: sym, name: resolvedName });
  });

  // DELETE /api/stocks/watchlist/:id — 删除自选股
  fastify.delete('/api/stocks/watchlist/:id', async (request, reply) => {
    const result = sqlite.prepare('DELETE FROM stock_watchlist WHERE id = ?').run(request.params.id);
    return reply.send({ ok: result.changes > 0 });
  });

  // ── Real-time data ──

  // GET /api/stocks/quotes — 自选股实时行情
  fastify.get('/api/stocks/quotes', async (request, reply) => {
    const watchlist = sqlite.prepare('SELECT symbol FROM stock_watchlist ORDER BY created_at').all();
    const symbols = watchlist.map(w => w.symbol);
    if (symbols.length === 0) return reply.send({ source: 'stocks', ok: true, data: {} });
    const data = await fetchStockData(symbols);
    return reply.send(data);
  });

  // GET /api/stocks/quote/:symbol — 单个股票详情
  fastify.get('/api/stocks/quote/:symbol', async (request, reply) => {
    const quote = await fetchYahooQuote(request.params.symbol.toUpperCase());
    if (!quote) return reply.code(404).send({ error: 'symbol not found' });
    return reply.send(quote);
  });

  // GET /api/stocks/overview — 股票页面全量数据（自选股 + 指数 + 宏观）
  fastify.get('/api/stocks/overview', async (request, reply) => {
    const watchlist = sqlite.prepare('SELECT * FROM stock_watchlist ORDER BY created_at').all();
    const symbols = watchlist.map(w => w.symbol);

    const [quotes, commodities, funding, sentiment] = await Promise.all([
      symbols.length > 0 ? fetchStockData(symbols) : { source: 'stocks', ok: true, data: {} },
      cachedCommodities(),
      cachedFunding(),
      cachedSentiment(),
    ]);

    return reply.send({ watchlist, quotes, commodities, funding, sentiment });
  });

  // GET /api/stocks/fundamentals?extra=TSLA,QS — 基本面 + 竞争对手 + 健康度
  // extra: 额外 symbol（如 broker 持仓），和 watchlist 合并后去重
  fastify.get('/api/stocks/fundamentals', async (request, reply) => {
    const watchlist = sqlite.prepare('SELECT symbol FROM stock_watchlist ORDER BY created_at').all();
    const watchSymbols = watchlist.map(w => w.symbol);
    const extra = (request.query.extra || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const symbols = [...new Set([...watchSymbols, ...extra])];
    if (symbols.length === 0) {
      return reply.send({ stocks: {}, peers: {}, health: {}, threshold: DIVERGENCE_WARN_THRESHOLD });
    }

    // Fetch fundamentals for watchlist stocks
    const fundamentals = await cachedFundamentals(symbols);
    const stockData = fundamentals.ok ? fundamentals.data : {};

    // Collect unique industries and discover peers
    const industries = {};
    for (const [sym, info] of Object.entries(stockData)) {
      if (info.industry) {
        if (!industries[info.industry]) industries[info.industry] = [];
        industries[info.industry].push(sym);
      }
    }

    const peers = {};
    await Promise.all(
      Object.entries(industries).map(async ([industry, syms]) => {
        const result = await cachedIndustryPeers(industry, syms);
        // cachedIndustryPeers returns { source, ok, data } wrapper or raw array depending on cache
        peers[industry] = Array.isArray(result) ? result : (result?.data || result || []);
      })
    );

    // Compute portfolio health
    const betas = [];
    const sectorCounts = {};
    const analystSummary = { buy: 0, hold: 0, sell: 0, other: 0 };

    for (const info of Object.values(stockData)) {
      if (info.beta != null) betas.push(info.beta);
      if (info.sector) sectorCounts[info.sector] = (sectorCounts[info.sector] || 0) + 1;
      const rec = (info.recommendationKey || '').toLowerCase();
      if (rec.includes('buy') || rec === 'strong_buy') analystSummary.buy++;
      else if (rec.includes('hold') || rec === 'neutral') analystSummary.hold++;
      else if (rec.includes('sell') || rec === 'underperform') analystSummary.sell++;
      else if (rec) analystSummary.other++;
    }

    const total = Object.values(sectorCounts).reduce((a, b) => a + b, 0) || 1;
    const sectorConcentration = {};
    let maxSectorPct = 0;
    for (const [sector, count] of Object.entries(sectorCounts)) {
      const pct = +(count / total).toFixed(2);
      sectorConcentration[sector] = pct;
      if (pct > maxSectorPct) maxSectorPct = pct;
    }

    const avgBeta = betas.length > 0 ? +(betas.reduce((a, b) => a + b, 0) / betas.length).toFixed(2) : null;

    return reply.send({
      stocks: stockData,
      peers,
      health: { avgBeta, sectorConcentration, maxSectorPct, analystSummary },
      threshold: DIVERGENCE_WARN_THRESHOLD,
    });
  });

  // ── Predictions ──

  // GET /api/predictions/markets — 预测市场热门事件
  fastify.get('/api/predictions/markets', async (request, reply) => {
    return reply.send(await cachedPredictions());
  });

  // ── Polymarket Trading ──

  // GET /api/predictions/wallet — Agent 的 Polygon 钱包 + USDC 余额
  fastify.get('/api/predictions/wallet', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const wallet = getPolygonWallet(relay_node_id);
    if (!wallet) return reply.send({ hasWallet: false });
    const usdc = await getUsdcBalance(wallet.address);
    return reply.send({ hasWallet: true, address: wallet.address, usdc, chain: 'polygon' });
  });

  // POST /api/predictions/setup — 为 Agent 创建 Polymarket API Key
  fastify.post('/api/predictions/setup', async (request, reply) => {
    const { relay_node_id } = request.body || {};
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });

    const wallet = sqlite.prepare(
      "SELECT id, chain FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
    ).get(relay_node_id);
    if (!wallet) return reply.code(400).send({ error: 'No Polygon wallet. Create one first via Agent → 钱包 → polygon.' });

    // Get private key
    const row = sqlite.prepare('SELECT privkey_encrypted FROM agent_wallets WHERE id = ?').get(wallet.id);
    if (!row?.privkey_encrypted) return reply.code(400).send({ error: 'Wallet has no private key' });
    const privateKey = decrypt(row.privkey_encrypted);

    const result = await createApiKey(privateKey);
    if (!result.ok) return reply.send({ ok: false, error: result.error });

    // 存 API key 到 config_entries（加密）
    const { encrypt } = await import('../services/crypto.js');
    const keyData = JSON.stringify({ apiKey: result.apiKey, secret: result.secret, passphrase: result.passphrase });
    sqlite.prepare(
      "INSERT OR REPLACE INTO config_entries (id, key, category, value_encrypted, is_sensitive, updated_at, created_at) VALUES (?, ?, 'polymarket', ?, 1, datetime('now'), datetime('now'))"
    ).run(crypto.randomUUID(), `polymarket_api_${relay_node_id}`, encrypt(keyData));

    return reply.send({ ok: true, message: 'Polymarket API key created' });
  });

  // 复用：创建 SDK client
  async function _makeClobClient(relay_node_id) {
    const creds = _getPolymarketCreds(relay_node_id);
    if (!creds) return null;
    const { ClobClient } = await import('@polymarket/clob-client');
    const { ethers } = await import('ethers');
    const walletRow = sqlite.prepare(
      "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
    ).get(relay_node_id);
    if (!walletRow?.privkey_encrypted) return null;
    const pk = decrypt(walletRow.privkey_encrypted);
    const provider = new ethers.JsonRpcProvider('https://polygon.drpc.org');
    const wallet = new ethers.Wallet(pk, provider);
    if (!wallet._signTypedData) wallet._signTypedData = wallet.signTypedData.bind(wallet);
    const sdkCreds = { key: creds.key || creds.apiKey, secret: creds.secret, passphrase: creds.passphrase };
    return new ClobClient('https://clob.polymarket.com', 137, wallet, sdkCreds);
  }

  // Market question cache — markets don't change, cache indefinitely
  const _marketQuestionCache = {};

  async function _resolveMarketQuestion(conditionId) {
    if (_marketQuestionCache[conditionId]) return _marketQuestionCache[conditionId];
    try {
      const res = await fetch(`https://clob.polymarket.com/markets/${conditionId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const info = { question: data.question || conditionId, closed: !!data.closed, endDate: data.end_date_iso || null };
        _marketQuestionCache[conditionId] = info;
        return info;
      }
    } catch {}
    return { question: conditionId, closed: false, endDate: null };
  }

  // GET /api/predictions/positions — 通过 SDK getTrades 查成交（SDK 无 getPositions）
  fastify.get('/api/predictions/positions', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const client = await _makeClobClient(relay_node_id);
    if (!client) return reply.send({ positions: [], error: 'Not set up' });
    try {
      const trades = await client.getTrades();
      // 聚合成持仓：按 market+outcome 分组
      const posMap = {};
      for (const t of trades) {
        const key = t.market + ':' + t.outcome;
        if (!posMap[key]) posMap[key] = { market: t.market, outcome: t.outcome, side: t.side, size: 0, totalCost: 0, asset: t.asset_id };
        const sz = parseFloat(t.size);
        const cost = sz * parseFloat(t.price);
        if (t.side === 'BUY') { posMap[key].size += sz; posMap[key].totalCost += cost; }
        else { posMap[key].size -= sz; posMap[key].totalCost -= cost; }
      }
      const positions = Object.values(posMap).filter(p => p.size > 0).map(p => ({
        ...p, avgPrice: p.totalCost / p.size, title: p.market?.slice(0, 16) + '...',
      }));
      // Resolve market questions in parallel
      await Promise.all(positions.map(async (p) => {
        const info = await _resolveMarketQuestion(p.market);
        p.question = info.question;
        p.closed = info.closed;
        p.endDate = info.endDate;
      }));
      return reply.send({ positions, trades });
    } catch (e) { return reply.send({ positions: [], error: e.message }); }
  });

  // GET /api/predictions/orders — 通过 SDK getOpenOrders
  fastify.get('/api/predictions/orders', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const client = await _makeClobClient(relay_node_id);
    if (!client) return reply.send({ orders: [], error: 'Not set up' });
    try {
      const orders = await client.getOpenOrders();
      return reply.send({ orders: Array.isArray(orders) ? orders : [] });
    } catch (e) { return reply.send({ orders: [], error: e.message }); }
  });

  // GET /api/predictions/book/:tokenId — 订单簿
  fastify.get('/api/predictions/book/:tokenId', async (request, reply) => {
    const book = await getOrderBook(request.params.tokenId);
    return reply.send(book || { bids: [], asks: [] });
  });

  // POST /api/predictions/order — 下单（通过 SDK）
  fastify.post('/api/predictions/order', async (request, reply) => {
    const { relay_node_id, tokenId, side, price, size } = request.body || {};
    if (!relay_node_id || !tokenId || !side || !price || !size) {
      return reply.code(400).send({ error: 'relay_node_id, tokenId, side (BUY/SELL), price, size required' });
    }
    const creds = _getPolymarketCreds(relay_node_id);
    if (!creds) return reply.code(400).send({ error: 'Not set up' });

    try {
      const client = await _makeClobClient(relay_node_id);
      if (!client) return reply.code(400).send({ error: 'Wallet or API key missing' });
      const order = await client.createOrder({
        tokenID: tokenId,
        price: parseFloat(price),
        size: parseFloat(size),
        side: side.toUpperCase(),
      });
      const result = await client.postOrder(order);
      return reply.send({ ok: result.success || !result.error, ...result });
    } catch (e) {
      return reply.send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/predictions/order/:orderId — 撤单（SDK）
  fastify.delete('/api/predictions/order/:orderId', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const client = await _makeClobClient(relay_node_id);
    if (!client) return reply.code(400).send({ error: 'Not set up' });
    try {
      const result = await client.cancelOrder({ orderID: request.params.orderId });
      return reply.send({ ok: true, ...result });
    } catch (e) { return reply.send({ ok: false, error: e.message }); }
  });

  // ── Polymarket Approval ──

  // GET /api/polymarket/:relay_node_id/status — 钱包 + 余额 + Approval + CLOB 状态
  // 复用成熟的 /api/relay/:id/wallets 体系查余额，不重复造轮子
  fastify.get('/api/polymarket/:relay_node_id/status', async (request, reply) => {
    const { relay_node_id } = request.params;
    const wallet = getPolygonWallet(relay_node_id);
    if (!wallet) return reply.send({ hasWallet: false, approved: false, hasClobKey: false });

    // Polymarket 用 USDC.e（0x2791...），getUsdcBalance 查的就是这个
    // relay.js wallets API 查的是原生 USDC（0x3c49...），不适用
    const usdce = await getUsdcBalance(wallet.address) || 0;
    let matic = 0;
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider('https://polygon.drpc.org');
      const bal = await provider.getBalance(wallet.address);
      matic = parseFloat(ethers.formatEther(bal));
    } catch {}

    const [allowanceResult] = await Promise.all([checkAllowance(wallet.address)]);
    const hasClobKey = !!_getPolymarketCreds(relay_node_id);

    return reply.send({
      hasWallet: true,
      address: wallet.address,
      usdc: usdce,
      matic,
      approved: allowanceResult.approved,
      allowance: allowanceResult.allowance,
      hasClobKey,
    });
  });

  // POST /api/polymarket/:relay_node_id/approve — Approve USDC 给 CTF Exchange
  fastify.post('/api/polymarket/:relay_node_id/approve', async (request, reply) => {
    const { relay_node_id } = request.params;
    const wallet = sqlite.prepare(
      "SELECT id FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
    ).get(relay_node_id);
    if (!wallet) return reply.code(400).send({ error: '没有 Polygon 钱包' });

    const row = sqlite.prepare('SELECT privkey_encrypted FROM agent_wallets WHERE id = ?').get(wallet.id);
    if (!row?.privkey_encrypted) return reply.code(400).send({ error: '钱包无私钥' });
    const privateKey = decrypt(row.privkey_encrypted);

    const result = await approveUsdc(privateKey);
    return reply.send(result);
  });

  // GET /api/polymarket/:relay_node_id/approve-status — 查询 Approve TX 状态
  fastify.get('/api/polymarket/:relay_node_id/approve-status', async (request, reply) => {
    const { txHash } = request.query;
    if (!txHash) return reply.code(400).send({ error: 'txHash required' });
    const result = await checkTxStatus(txHash);
    return reply.send(result);
  });

  // Helper: 获取 Agent 的 Polymarket 凭证
  function _getPolymarketCreds(relayNodeId) {
    const row = sqlite.prepare("SELECT value_encrypted FROM config_entries WHERE key = ?").get(`polymarket_api_${relayNodeId}`);
    if (!row?.value_encrypted) return null;
    try {
      return JSON.parse(decrypt(row.value_encrypted));
    } catch { return null; }
  }

  // ── Market Overview ──

  // GET /api/market/overview — 全市场聚合数据
  fastify.get('/api/market/overview', async (request, reply) => {
    const watchlist = sqlite.prepare('SELECT symbol FROM stock_watchlist ORDER BY created_at').all();
    const symbols = watchlist.map(w => w.symbol);
    const allData = await fetchAllMarkets(symbols.length > 0 ? symbols : undefined);
    return reply.send(allData);
  });

  // GET /api/market/brief — Agent 生成的市场综述（缓存15分钟）
  fastify.get('/api/market/brief', async (request, reply) => {
    // 命中缓存
    if (_briefCache.text && (Date.now() - _briefCache.ts) < BRIEF_TTL) {
      return reply.send({ text: _briefCache.text, agent: _briefCache.agent, cached: true, ts: _briefCache.ts });
    }

    // 聚合数据
    const watchlist = sqlite.prepare('SELECT symbol FROM stock_watchlist ORDER BY created_at').all();
    const allData = await fetchAllMarkets(watchlist.map(w => w.symbol));

    // 构建 prompt
    const parts = [];
    if (allData.crypto?.ok) {
      const c = allData.crypto.data;
      if (c.KAS) parts.push(`KAS $${c.KAS.price} (${c.KAS.change24h > 0 ? '+' : ''}${c.KAS.change24h?.toFixed(1)}%)`);
      if (c.BTC) parts.push(`BTC $${Math.round(c.BTC.price).toLocaleString()} (${c.BTC.change24h?.toFixed(1)}%)`);
    }
    if (allData.stocks?.ok) {
      for (const [sym, v] of Object.entries(allData.stocks.data)) {
        parts.push(`${sym} $${v.price?.toFixed(2)} (${v.change24h?.toFixed(1)}%)`);
      }
    }
    if (allData.commodities?.ok) {
      for (const [name, v] of Object.entries(allData.commodities.data)) {
        parts.push(`${name} $${v.price?.toFixed(0)}`);
      }
    }
    if (allData.sentiment?.ok) {
      const fng = allData.sentiment.data.fearGreed;
      if (fng) parts.push(`Fear&Greed: ${fng.value} (${fng.label})`);
    }
    if (allData.funding?.ok && allData.funding.data.BTC) {
      parts.push(`BTC Funding: ${(allData.funding.data.BTC.rate * 100).toFixed(4)}%`);
    }
    if (allData.prediction?.ok && allData.prediction.data?.length > 0) {
      parts.push(`Top prediction: "${allData.prediction.data[0].question}" ${allData.prediction.data[0].outcome || ''}`);
    }

    const dataStr = parts.join('\n');
    const prompt = `你是 KANet 市场分析师。以下是全球多市场实时数据：\n${dataStr}\n\n请用 2-3 句话中文写一段市场综述，包含：当前市场情绪、关键风险信号、对 KAS 交易的建议。简洁有力，不要废话。`;

    // 调 Adapter 生成
    const relay = sqlite.prepare(
      `SELECT r.name, a.http_port FROM relay_nodes r JOIN adapter_nodes a ON a.id = r.adapter_node_id WHERE a.http_port IS NOT NULL LIMIT 1`
    ).get();

    if (!relay?.http_port) {
      return reply.send({ text: '暂无可用 AI 引擎生成综述', agent: null, cached: false });
    }

    try {
      const res = await fetch(`http://localhost:${relay.http_port}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peer: 'system',
          mindSystem: 'You are a concise market analyst for KANet. Reply in Chinese. Keep it under 3 sentences.',
          mindUser: prompt,
          mindTask: true,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      const text = data?.reply || data?.content || data?.text || '';
      if (text) {
        _briefCache = { text, agent: relay.name, ts: Date.now() };
      }
      return reply.send({ text: text || '综述生成失败', agent: relay.name, cached: false, ts: Date.now() });
    } catch (e) {
      return reply.send({ text: '综述生成超时', agent: relay.name, cached: false, error: e.message });
    }
  });
}
