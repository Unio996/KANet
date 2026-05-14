/**
 * Stocks & Predictions API + Page Routes
 *
 * 股票自选股 CRUD + 实时行情 + 预测市场
 * 页面路由：/stocks, /predictions
 */
import { sqlite } from '../db/client.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import crypto, { randomUUID } from 'crypto';
import { fetchStockData, fetchYahooQuote, cachedPredictions, cachedCommodities, cachedFunding, cachedSentiment, fetchAllMarkets, cachedCrypto, cachedFundamentals, cachedIndustryPeers, cachedStockKlines, DIVERGENCE_WARN_THRESHOLD } from '../services/market-data.js';
import { getPolygonWallet, getUsdcBalance, getPusdBalance, createApiKey, getOrderBook, checkAllowance, approveUsdc, checkTxStatus, redeemPositions, checkRedeemStatus, sweepUsdc, fetchUserActivity, fetchAccountValue, getMarketWinner, migrateToV2, ensureCtfApprovedForV2 } from '../services/polymarket.js';
import { predictDepositWallet, deployDepositWallet, transferPusdToDepositWallet, setupDepositWalletAllowances } from '../services/polymarket-deposit-wallet.js';
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

  // GET /api/stocks/klines — 自选股日 K 线（1 个月）
  fastify.get('/api/stocks/klines', async (request, reply) => {
    const watchlist = sqlite.prepare('SELECT symbol FROM stock_watchlist ORDER BY created_at').all();
    const symbols = watchlist.map(w => w.symbol);
    if (symbols.length === 0) return reply.send({ ok: true, data: {} });
    const result = await cachedStockKlines(symbols);
    return reply.send(result);
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

  // Phase 3g Sub 9.14 — Polymarket V2 deposit wallet setup (POLY_1271 mode).
  // POST /api/predictions/deposit-wallet/setup { relay_node_id, transferAllPusd?: true } 一键 setup:
  //   1. predictDepositWallet — CREATE2 counterfactual (factory + impl + bytes32(uint160(EOA)))
  //   2. deployDepositWallet — factory.deploy() if not on-chain (auto-init owner)
  //   3. transferPusdToDepositWallet — ERC20.transfer EOA → DW (optional, only if transferAllPusd)
  //   4. setupDepositWalletAllowances — DW.execute(Batch[approve pUSD V2×3 + setApprovalForAll V2×3], EIP-712 sig)
  //   5. UPDATE agent_wallets SET polymarket_funder_address = DW
  // Idempotent. Each step records TX hash. Failure at any step returns partial result for retry.
  fastify.post('/api/predictions/deposit-wallet/setup', async (request, reply) => {
    const { relay_node_id, transferAllPusd } = request.body || {};
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const wallet = sqlite.prepare(
      "SELECT id, address, privkey_encrypted, polymarket_funder_address FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
    ).get(relay_node_id);
    if (!wallet?.privkey_encrypted) return reply.code(400).send({ error: 'No Polygon wallet w/ privkey' });
    const privateKey = decrypt(wallet.privkey_encrypted);
    const out = { eoa: wallet.address, steps: {} };

    // Step 1: predict
    try {
      const { depositWallet } = await predictDepositWallet(wallet.address);
      out.depositWallet = depositWallet;
      out.steps.predict = { ok: true, depositWallet };
    } catch (e) { out.steps.predict = { ok: false, error: e.message }; return reply.send({ ok: false, ...out }); }

    // Step 2: deploy (idempotent)
    const dep = await deployDepositWallet(privateKey);
    out.steps.deploy = dep;
    if (!dep.ok) return reply.send({ ok: false, ...out });

    // Step 3: optional pUSD transfer
    if (transferAllPusd) {
      const tr = await transferPusdToDepositWallet(privateKey, out.depositWallet, 0n);
      out.steps.transferPusd = tr;
      if (!tr.ok) return reply.send({ ok: false, ...out });
    } else {
      out.steps.transferPusd = { skipped: true, note: 'pass transferAllPusd:true to move EOA pUSD → DW' };
    }

    // Step 4: setup allowances via execute(Batch, sig)
    const al = await setupDepositWalletAllowances(privateKey, out.depositWallet);
    out.steps.setupAllowances = al;
    if (!al.ok) return reply.send({ ok: false, ...out });

    // Step 5: persist opt-in (funder_address column)
    sqlite.prepare(
      'UPDATE agent_wallets SET polymarket_funder_address = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(out.depositWallet, wallet.id);
    out.steps.persistOptIn = { ok: true, funder_address: out.depositWallet };

    return reply.send({ ok: true, ...out });
  });

  // CLOB SDK client (V2 since 2026-04-28). The returned client holds a
  // JsonRpcProvider via the Wallet signer; callers MUST pass it through
  // _releaseClob() in a finally block to destroy the provider and stop
  // ethers v6's internal retry loop.
  async function _makeClobClient(relay_node_id) {
    const creds = _getPolymarketCreds(relay_node_id);
    if (!creds) return null;
    const v2 = await import('@polymarket/clob-client-v2');
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
    const client = new v2.ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: wallet,
      creds: sdkCreds,
    });
    client.__provider = provider; // for _releaseClob cleanup
    return client;
  }

  function _releaseClob(client) {
    try { client?.__provider?.destroy?.(); } catch {}
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
      // Collect all asset_ids traded per market (Yes and No outcomes). CLOB's
      // asset_id is the authoritative ERC-1155 token id — any redeem check
      // must use this, not a self-computed positionId.
      const assetIdsByMarket = {};
      for (const t of trades) {
        const key = t.market + ':' + t.outcome;
        if (!posMap[key]) posMap[key] = { market: t.market, outcome: t.outcome, side: t.side, size: 0, totalCost: 0, asset: t.asset_id };
        const sz = parseFloat(t.size);
        const cost = sz * parseFloat(t.price);
        if (t.side === 'BUY') { posMap[key].size += sz; posMap[key].totalCost += cost; }
        else { posMap[key].size -= sz; posMap[key].totalCost -= cost; }
        if (t.market && t.asset_id) {
          if (!assetIdsByMarket[t.market]) assetIdsByMarket[t.market] = new Set();
          assetIdsByMarket[t.market].add(t.asset_id);
        }
      }
      const allPositions = Object.values(posMap).filter(p => p.size > 0).map(p => ({
        ...p, avgPrice: p.totalCost / p.size, title: p.market?.slice(0, 16) + '...',
      }));
      // Resolve market questions in parallel
      await Promise.all(allPositions.map(async (p) => {
        const info = await _resolveMarketQuestion(p.market);
        p.question = info.question;
        p.closed = info.closed;
        p.endDate = info.endDate;
        if (info.closed) {
          p.settled = true;
          p.status = 'settled';
        } else if (info.endDate && new Date(info.endDate) < new Date()) {
          p.settled = false;
          p.status = 'expired_pending'; // expired but Polymarket hasn't resolved yet
        } else {
          p.settled = false;
          p.status = 'active';
        }
      }));

      // T-J1-2026-04-28 (Owner UI bug fix): overlay data-api positions on getTrades aggregation.
      // getTrades aggregation has known issues — NegRisk markets show wrong outcome+3x size
      // (memory note), and binary markets where Owner traded both directions can show stale
      // outcome too. data-api /positions is the authoritative truth source (matches Polymarket
      // UI exactly), so override outcome/size/cost/redeemable from there when available.
      try {
        const polyAddrEarly = getPolygonWallet(relay_node_id)?.address;
        if (polyAddrEarly) {
          const dapiRes = await fetch(
            `https://data-api.polymarket.com/positions?user=${polyAddrEarly.toLowerCase()}&limit=200`,
            { signal: AbortSignal.timeout(10_000) }
          );
          if (dapiRes.ok) {
            const dapi = await dapiRes.json();
            const dapiByCid = {};
            for (const dp of (dapi || [])) if (dp?.conditionId) dapiByCid[dp.conditionId] = dp;
            for (const p of allPositions) {
              const dp = dapiByCid[p.market];
              if (!dp) continue;
              p.outcome = dp.outcome;
              p.size = dp.size;
              p.totalCost = dp.initialValue;
              p.avgPrice = dp.avgPrice;
              p.asset = dp.asset;
              p.currentValue = dp.currentValue;
              p.curPrice = dp.curPrice;
              p.negativeRisk = dp.negativeRisk;
              if (dp.redeemable) p.redeemable = true;
              // curPrice ∈ {0,1} → market resolved → flip to settled even if local CLOB lag
              if (dp.curPrice === 0 || dp.curPrice === 1) {
                p.settled = true;
                p.closed = true;
                p.status = 'settled';
              }
              delete dapiByCid[p.market];
            }
            // Append positions data-api shows but local trades missed (e.g. transferred-in)
            for (const dp of Object.values(dapiByCid)) {
              if (!(dp.size > 0)) continue;
              const settled = dp.curPrice === 0 || dp.curPrice === 1;
              allPositions.push({
                market: dp.conditionId, outcome: dp.outcome, side: 'BUY',
                size: dp.size, totalCost: dp.initialValue, avgPrice: dp.avgPrice,
                asset: dp.asset, currentValue: dp.currentValue, curPrice: dp.curPrice,
                negativeRisk: dp.negativeRisk, redeemable: !!dp.redeemable,
                title: dp.title, question: dp.title,
                endDate: dp.endDate ? `${dp.endDate}T00:00:00Z` : null,
                closed: settled, settled, status: settled ? 'settled' : 'active',
              });
            }
          }
        }
      } catch (e) {
        console.warn('[predictions] data-api overlay failed:', e.message);
      }

      // For settled positions: query real on-chain balance.
      // NOTE: we no longer infer `redeemed=true` from balance=0. That was a
      // false-positive that hid recoverable winnings (Sophie BTC>72k 58 shares
      // left unredeemed). "balance=0" can also mean sold, transferred, or on
      // a NegRisk adapter — we don't know, so we don't guess. The UI should
      // only show "Already Redeemed" for actions taken in the current session.
      const settledPositions = allPositions.filter(p => p.settled);
      if (settledPositions.length > 0) {
        const polyWallet = getPolygonWallet(relay_node_id);
        if (polyWallet?.address) {
          await Promise.all(settledPositions.map(async (p) => {
            try {
              const assetIds = Array.from(assetIdsByMarket[p.market] || []);
              const rs = await checkRedeemStatus(polyWallet.address, p.market, assetIds);
              // T-J1-2026-04-28 Owner UI bug fix: data-api redeemable=true takes precedence —
              // tokens may be in proxy/NegRisk adapter (CTF balance=0) but Polymarket认为 redeemable.
              p.redeemable = p.redeemable || rs.redeemable;
              p.onChainBalance = rs.balance;
              p.redeemed = false;
            } catch {
              p.redeemable = false;
              p.redeemed = false;
            }
          }));
        }
      }

      const positions = allPositions.filter(p => !p.settled);
      const settled = allPositions.filter(p => p.settled);

      // ── Summary: cash-flow reconstruction from Polymarket data-api activity ──
      // Single source of truth: Polymarket's activity log gives exact USDC in/out
      // per market. Capital is derived by account-balance identity, not guessed.
      const polyWallet = getPolygonWallet(relay_node_id);
      const summary = {
        capital: null, totalStaked: 0, realizedPnl: 0, unrealizedPnl: 0,
        currentUsdc: 0, currentTokenValue: 0, currentTotal: 0,
        roiRealized: null, roiTotal: null, turnover: null,
        wins: 0, losses: 0, pending: 0, winRate: null,
        source: 'none',
      };
      // Per-market cash-flow index: conditionId → { cost, received }
      const perMarket = {};
      if (polyWallet?.address) {
        try {
          const [activity, tokenValue, usdcBal, pusdBal] = await Promise.all([
            fetchUserActivity(polyWallet.address),
            fetchAccountValue(polyWallet.address),
            getUsdcBalance(polyWallet.address),
            getPusdBalance(polyWallet.address),
          ]);
          // currentUsdc 含 pUSD (Polymarket V2 卖出钱在 pUSD, Owner unwrap 前算 USDC 等价)
          summary.currentUsdc = (Number(usdcBal) || 0) + (Number(pusdBal) || 0);
          summary.currentTokenValue = tokenValue;
          summary.currentTotal = summary.currentUsdc + summary.currentTokenValue;

          if (activity.length > 0) {
            let buySpent = 0, cashIn = 0;
            for (const a of activity) {
              const cid = a.conditionId;
              if (cid && !perMarket[cid]) perMarket[cid] = { cost: 0, received: 0, byAsset: {} };
              if (a.type === 'TRADE' && a.side === 'BUY') {
                buySpent += a.usdcSize || 0;
                if (cid) {
                  perMarket[cid].cost += a.usdcSize || 0;
                  // Track per-outcome buy aggregates so settled positions can
                  // reconstruct true outcome/size/avgPrice (getTrades aggregation
                  // shows mirrored maker-side view on NegRisk markets).
                  const ak = a.asset || a.outcome || 'unknown';
                  const ag = perMarket[cid].byAsset[ak] = perMarket[cid].byAsset[ak] || {
                    outcome: a.outcome, asset: a.asset, buyShares: 0, buyCost: 0,
                  };
                  ag.buyShares += Number(a.size) || 0;
                  ag.buyCost += Number(a.usdcSize) || 0;
                }
              } else if (a.type === 'TRADE' && a.side === 'SELL') {
                cashIn += a.usdcSize || 0;
                if (cid) perMarket[cid].received += a.usdcSize || 0;
              } else if (a.type === 'REDEEM') {
                cashIn += a.usdcSize || 0;
                if (cid) perMarket[cid].received += a.usdcSize || 0;
              }
            }
            // Account-balance identity: currentUsdc = capital + cashIn - buySpent
            // 即 capital = currentUsdc + buySpent - cashIn (current = USDC + pUSD)
            // Sweep 走资产后 currentUsdc 偏低 → capital 可能负. fallback: capital ≤ 0 时
            // 用 totalStaked (累积投入) 替代避免战绩统计整段被 UI gate 掉.
            summary.totalStaked = buySpent;
            const computedCapital = summary.currentUsdc + buySpent - cashIn;
            summary.capital = computedCapital > 0 ? computedCapital : buySpent;
            summary.capitalNote = computedCapital > 0 ? null : 'swept'; // UI 可显示标记
            summary.source = 'data-api';
          }
        } catch (e) {
          console.warn('[predictions] summary build failed:', e.message);
        }
      }

      // ── Resolve winners for settled positions via on-chain payoutNumerators ──
      await Promise.all(settled.map(async (p) => {
        const r = await getMarketWinner(p.market);
        const mk = perMarket[p.market];
        if (mk) {
          p.realizedPnl = mk.received - mk.cost;
          p.actualReceived = mk.received;
          // Reconstruct true position from activity-log BUY records. getTrades
          // aggregation shows mirrored maker-side view on NegRisk markets, and
          // the data-api overlay only covers open positions — settled markets
          // (already redeemed) need this reconstruction to display correct
          // outcome / size / avgPrice / cost.
          if (mk.byAsset) {
            let best = null;
            for (const ag of Object.values(mk.byAsset)) {
              if (!best || ag.buyShares > best.buyShares) best = ag;
            }
            if (best && best.buyShares > 0) {
              if (best.outcome) p.outcome = best.outcome;
              if (best.asset) p.asset = best.asset;
              p.size = best.buyShares;
              p.avgPrice = best.buyCost / best.buyShares;
              p.totalCost = best.buyCost;
            }
          }
        } else {
          p.actualReceived = null;
        }
        if (r.resolved && r.winner) {
          p.winner = r.winner;
          // Cash-flow is the truth source for verdict. p.outcome from getTrades
          // is mirrored on NegRisk markets (sell-Yes-low ≡ buy-No-high), and
          // the data-api overlay can miss fully-redeemed positions, leaving
          // outcome stale. perMarket cash-flow comes from Polymarket activity
          // log and reflects real USDC in/out. Fall back to outcome match only
          // when activity is unavailable.
          if (mk) {
            p.verdict = p.realizedPnl > 0 ? 'WIN' : 'LOSE';
          } else {
            p.verdict = (r.winner === p.outcome) ? 'WIN' : 'LOSE';
            p.realizedPnl = (p.verdict === 'WIN') ? (p.size - p.totalCost) : (-p.totalCost);
          }
          if (p.verdict === 'WIN') summary.wins++; else summary.losses++;
        } else {
          p.winner = null; p.verdict = 'PENDING';
          summary.pending++;
        }
      }));

      // Sold-out markets — fully closed via SELL (not REDEEM), market may not be on-chain resolved.
      // getTrades 聚合 net size=0 被 filter 掉 (line 317), data-api positions 也不返已清仓.
      // Cashflow-only reconstruction: perMarket.cost > 0 + received > 0 + net size 0 + 不在 allPositions.
      // Owner 5/12 US-Iran sell-out 撞此漏洞 (140 NO @ $0.85 → $119 cost / $137.48 received → +$18.48 WIN 没显示).
      const knownMarkets = new Set(allPositions.map(p => p.market));
      const soldOutCids = Object.entries(perMarket).filter(([cid, mk]) =>
        !knownMarkets.has(cid) && mk.cost > 0 && mk.received > 0
      );
      if (soldOutCids.length > 0) {
        await Promise.all(soldOutCids.map(async ([cid, mk]) => {
          const info = await _resolveMarketQuestion(cid);
          const byAssetSorted = Object.values(mk.byAsset || {}).filter(ag => ag.buyShares > 0).sort((a,b) => b.buyShares - a.buyShares);
          const best = byAssetSorted[0];
          if (!best) return;
          const realizedPnl = mk.received - mk.cost;
          const verdict = realizedPnl > 0 ? 'WIN' : 'LOSE';
          const synth = {
            market: cid, outcome: best.outcome, asset: best.asset, side: 'BUY',
            size: best.buyShares, totalCost: mk.cost, avgPrice: mk.cost / best.buyShares,
            title: info.question || cid.slice(0,16)+'...', question: info.question,
            endDate: info.endDate, closed: true, settled: true, status: 'sold_out',
            actualReceived: mk.received, realizedPnl, verdict,
            winner: null, redeemable: false, redeemed: false, onChainBalance: '0',
          };
          settled.push(synth);
          if (verdict === 'WIN') summary.wins++; else summary.losses++;
        }));
      }

      // Add open-position per-market cash-flow numbers + unrealized P&L so UI
      // can show the Hormuz row with same shape as settled rows.
      for (const p of positions) {
        const mk = perMarket[p.market];
        if (mk) { p.actualReceived = mk.received; } // usually 0 for open
        // Unrealized P&L for this single position — Polymarket doesn't split
        // tokenValue per market cheaply; use current price × size if available.
        // Left null here; UI shows "pending" and uses summary.unrealizedPnl as total.
      }

      // Active position unrealized = total token value minus sum(active cost)
      const activeCost = positions.reduce((s, p) => s + (p.totalCost || 0), 0);
      summary.unrealizedPnl = summary.currentTokenValue - activeCost;

      // Realized P&L = sum over settled positions (precise via cash-flow match)
      summary.realizedPnl = settled.reduce((s, p) => s + (p.realizedPnl || 0), 0);

      // expired_pending (past endDate, on-chain not yet resolved) counted as pending
      summary.pending += positions.filter(p => p.status === 'expired_pending').length;

      const totalSettled = summary.wins + summary.losses;
      summary.winRate = totalSettled > 0 ? (summary.wins / totalSettled) : null;
      if (summary.capital && summary.capital > 0) {
        summary.roiRealized = summary.realizedPnl / summary.capital;
        summary.roiTotal = (summary.realizedPnl + summary.unrealizedPnl) / summary.capital;
        summary.turnover = summary.totalStaked / summary.capital;
      }

      // ── Timeline: chronological event series with running USDC balance ──
      // Polymarket logs multiple REDEEM attempts per market (incl. $0 reconfirms
      // after the real redeem). Keep only the one REDEEM that actually moved USDC
      // per (conditionId); for losing markets keep the first $0 REDEEM as the
      // settlement marker. Winner comes from on-chain cache.
      try {
        if (summary.source === 'data-api' && summary.capital != null) {
          const actRes = await fetchUserActivity(polyWallet.address);
          const marketWinner = {};
          for (const p of settled) {
            if (p.winner) marketWinner[p.market] = { winner: p.winner, side: p.outcome };
          }
          const hasPayRedeem = new Set();
          for (const a of actRes) {
            if (a.type === 'REDEEM' && (a.usdcSize || 0) > 0) hasPayRedeem.add(a.conditionId);
          }
          const seenZeroForLoser = new Set();
          const filtered = [];
          for (const a of actRes) {
            if (a.type === 'REDEEM') {
              const usd = a.usdcSize || 0;
              if (usd === 0) {
                // Skip $0 if this market already had a real redeem (reconfirm noise)
                if (hasPayRedeem.has(a.conditionId)) continue;
                // Otherwise keep only the first $0 as the losing-settlement marker
                if (seenZeroForLoser.has(a.conditionId)) continue;
                seenZeroForLoser.add(a.conditionId);
              }
            }
            filtered.push(a);
          }
          let running = summary.capital;
          summary.timeline = filtered.map(a => {
            let amount = 0, action = 'NEUTRAL';
            if (a.type === 'TRADE' && a.side === 'BUY') { amount = -(a.usdcSize || 0); action = 'BUY'; }
            else if (a.type === 'TRADE' && a.side === 'SELL') { amount = (a.usdcSize || 0); action = 'SELL'; }
            else if (a.type === 'REDEEM') {
              amount = (a.usdcSize || 0);
              action = amount > 0 ? 'WIN' : 'LOSE';
            }
            running += amount;
            return {
              ts: a.timestamp,
              date: new Date((a.timestamp || 0) * 1000).toISOString(),
              type: a.type, action, amount,
              marketTitle: a.title || '',
              conditionId: a.conditionId,
              side: a.side || null,
              size: a.size || null,
              price: a.price || null,
              runningUsdc: running,
            };
          });
        }
      } catch (e) {
        console.warn('[predictions] timeline build failed:', e.message);
      }

      return reply.send({ positions, settled, trades, summary });
    } catch (e) {
      return reply.send({ positions: [], error: e.message });
    } finally {
      _releaseClob(client);
    }
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
    } catch (e) {
      return reply.send({ orders: [], error: e.message });
    } finally {
      _releaseClob(client);
    }
  });

  // GET /api/predictions/book/:tokenId — 订单簿
  fastify.get('/api/predictions/book/:tokenId', async (request, reply) => {
    const book = await getOrderBook(request.params.tokenId);
    return reply.send(book || { bids: [], asks: [] });
  });

  // POST /api/predictions/order — 下单（通过 SDK）
  // Phase B 持仓自动保护 Phase 3 (Owner 5/16 钦定 + Bettor r139 spec):
  //   X-Owner-Ack header optional but if present → HMAC verify against position_protect_rules
  //   token + check max_price/max_size bounds. If header present + invalid → reject. If header
  //   absent → traditional Owner UI ACCEPT path (per stage explicit Owner trigger).
  fastify.post('/api/predictions/order', async (request, reply) => {
    const { relay_node_id, tokenId, side, price, size } = request.body || {};
    if (!relay_node_id || !tokenId || !side || !price || !size) {
      return reply.code(400).send({ error: 'relay_node_id, tokenId, side (BUY/SELL), price, size required' });
    }

    // Phase 3 HMAC token verify (X-Owner-Ack header) — applied when daemon fires
    const ackHeader = request.headers['x-owner-ack'];
    if (ackHeader) {
      try {
        const crypto = await import('node:crypto');
        const [b64, sig] = String(ackHeader).split('.');
        if (!b64 || !sig) return reply.code(401).send({ error: 'X-Owner-Ack malformed (expected base64.signature)' });
        const tokenJson = Buffer.from(b64, 'base64').toString('utf8');
        const expected = crypto.createHmac('sha256', process.env.CONSOLE_ENCRYPTION_KEY || 'fallback-no-env-warn').update(tokenJson).digest('hex');
        if (sig !== expected) return reply.code(401).send({ error: 'X-Owner-Ack signature mismatch' });
        const payload = JSON.parse(tokenJson);
        if (payload.relay_node_id !== relay_node_id) return reply.code(401).send({ error: 'X-Owner-Ack relay_node_id mismatch' });
        if (payload.token_id !== tokenId) return reply.code(401).send({ error: 'X-Owner-Ack token_id mismatch' });
        if (parseFloat(price) > payload.max_price + 0.001) return reply.code(401).send({ error: `X-Owner-Ack price ${price} exceeds max ${payload.max_price}` });
        if (parseFloat(size) > payload.max_size + 0.001) return reply.code(401).send({ error: `X-Owner-Ack size ${size} exceeds max ${payload.max_size}` });
        console.log(`[predictions] X-Owner-Ack verified for rule ${payload.rule_id?.slice(0,8)}`);
      } catch (e) {
        return reply.code(401).send({ error: `X-Owner-Ack verify fail: ${e.message}` });
      }
    }

    const creds = _getPolymarketCreds(relay_node_id);
    if (!creds) return reply.code(400).send({ error: 'Not set up' });

    let client;
    try {
      client = await _makeClobClient(relay_node_id);
      if (!client) return reply.code(400).send({ error: 'Wallet or API key missing' });
      // V2 SDK auto-fetches tickSize/negRisk; V2 UserOrder dropped feeRateBps/nonce
      // from the signed message (handled by the V2 contract instead).
      const result = await client.createAndPostOrder({
        tokenID: tokenId,
        price: parseFloat(price),
        size: parseFloat(size),
        side: side.toUpperCase(),
      });
      console.log(`[predictions] V2 order result: ${JSON.stringify(result).slice(0,300)}`);
      return reply.send({ ok: result?.success === true || (!!result && !result.error), ...result });
    } catch (e) {
      console.log(`[predictions] V2 order ERROR: ${e.message}`);
      return reply.send({ ok: false, error: e.message });
    } finally {
      _releaseClob(client);
    }
  });

  // POST /api/predictions/positions/:asset/close — 一键出清 active position (sell at market bid)
  // Bettor r46 (B) Step 1: alpha 期速度优先, market bid - $0.01 slippage, immediate fill
  fastify.post('/api/predictions/positions/:asset/close', async (request, reply) => {
    const { relay_node_id, size } = request.body || {};
    const { asset } = request.params;
    if (!relay_node_id || !asset) return reply.code(400).send({ error: 'relay_node_id + asset required' });
    let client;
    try {
      // Step 0: auto-ensure CTF→V2 operator approve (合二为一, Owner UX 不该懂 1155 operator 原理)
      // getPolygonWallet 只返 id/address/chain, 必须单独 query privkey_encrypted (v1 sediment)
      const wallet = getPolygonWallet(relay_node_id);
      if (!wallet) return reply.code(400).send({ error: 'No polygon wallet' });
      const pkRow = sqlite.prepare('SELECT privkey_encrypted FROM agent_wallets WHERE id = ?').get(wallet.id);
      if (!pkRow?.privkey_encrypted) return reply.code(400).send({ error: 'Wallet has no private key' });
      const approveResult = await ensureCtfApprovedForV2(decrypt(pkRow.privkey_encrypted));
      if (approveResult.newlyApproved > 0) {
        console.log(`[predictions/close] auto-approved ${approveResult.newlyApproved} CTF→V2 spender(s), TX: ${JSON.stringify(approveResult.txHashes)}`);
      } else {
        console.log(`[predictions/close] CTF→V2 already approved (skip: ${Object.keys(approveResult.skipped).join(',')})`);
      }

      client = await _makeClobClient(relay_node_id);
      if (!client) return reply.code(400).send({ error: 'Wallet or API key missing' });
      const book = await client.getOrderBook(asset);
      const bids = (book?.bids || []).map(b => ({ price: parseFloat(b.price), size: parseFloat(b.size) })).filter(b => b.price > 0);
      if (bids.length === 0) return reply.code(400).send({ error: 'no bids in book' });
      const bestBid = Math.max(...bids.map(b => b.price));
      const sellPrice = Math.max(0.01, bestBid - 0.01);
      const sellSize = size ? parseFloat(size) : 0;
      if (!sellSize || sellSize <= 0) return reply.code(400).send({ error: 'size required' });
      console.log(`[predictions/close] asset=${asset.slice(0,16)} size=${sellSize} bestBid=$${bestBid.toFixed(3)} sellPrice=$${sellPrice.toFixed(3)}`);
      const result = await client.createAndPostOrder({
        tokenID: asset, price: sellPrice, size: sellSize, side: 'SELL',
      });
      const proceedsUsdc = sellPrice * sellSize;
      console.log(`[predictions/close] result: ${JSON.stringify(result).slice(0,200)} proceeds=$${proceedsUsdc.toFixed(2)}`);
      return reply.send({
        ok: result?.success === true || (!!result && !result.error),
        sell_price: sellPrice, size: sellSize, best_bid: bestBid,
        slippage_pct: bestBid > 0 ? ((bestBid - sellPrice) / bestBid * 100) : 0,
        proceeds_usdc: proceedsUsdc, order_result: result,
        auto_approved: approveResult.newlyApproved > 0 ? approveResult : undefined,
      });
    } catch (e) {
      console.log(`[predictions/close] ERROR: ${e.message}`);
      return reply.send({ ok: false, error: e.message });
    } finally {
      _releaseClob(client);
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
    } catch (e) {
      return reply.send({ ok: false, error: e.message });
    } finally {
      _releaseClob(client);
    }
  });

  // ── Polymarket Approval ──

  // GET /api/polymarket/:relay_node_id/status — 钱包 + 余额 + Approval + CLOB 状态
  // 复用成熟的 /api/relay/:id/wallets 体系查余额，不重复造轮子
  fastify.get('/api/polymarket/:relay_node_id/status', async (request, reply) => {
    const { relay_node_id } = request.params;
    const wallet = getPolygonWallet(relay_node_id);
    if (!wallet) return reply.send({ hasWallet: false, approved: false, hasClobKey: false });

    // 并行三个 RPC call + clob creds 本地查 (之前串行 14s, 改并行 ~2-3s)
    const { ethers } = await import('ethers');
    const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('rpc timeout')), ms))]);
    const maticPromise = (async () => {
      let provider;
      try {
        provider = new ethers.JsonRpcProvider('https://polygon.drpc.org');
        const bal = await timeout(provider.getBalance(wallet.address), 5000);
        return parseFloat(ethers.formatEther(bal));
      } catch { return 0; } finally {
        try { provider?.destroy?.(); } catch {}
      }
    })();
    // V2 collateral (pUSD) + allowance to V2 spenders. Polymarket migrated CLOB
    // to V2 on 2026-04-28; trades now require pUSD (USDC wrapped 1:1) approved
    // to CTF Exchange V2 / NegRisk V2 / NegRisk Adapter.
    const PUSD_ADDR = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
    const V2_SPENDERS = [
      '0xE111180000d2663C0091e4f400237545B87B996B', // CTF Exchange V2
      '0xe2222d279d744050d28e00520010520000310F59', // NegRisk Exchange V2
      '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296', // NegRisk Adapter
    ];
    const pusdPromise = (async () => {
      let provider;
      try {
        provider = new ethers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com');
        const c = new ethers.Contract(PUSD_ADDR, [
          'function balanceOf(address) view returns (uint256)',
          'function allowance(address,address) view returns (uint256)',
        ], provider);
        const bal = await timeout(c.balanceOf(wallet.address), 5000);
        const allows = await Promise.all(V2_SPENDERS.map(s => timeout(c.allowance(wallet.address, s), 5000).catch(() => 0n)));
        const minAllow = allows.reduce((m, a) => a < m ? a : m, allows[0] ?? 0n);
        return {
          pusd: parseFloat(ethers.formatUnits(bal, 6)),
          v2Approved: minAllow > 0n,
        };
      } catch { return { pusd: 0, v2Approved: false }; } finally {
        try { provider?.destroy?.(); } catch {}
      }
    })();
    const [usdce, matic, allowanceResult, pusdInfo] = await Promise.all([
      timeout(getUsdcBalance(wallet.address), 5000).catch(() => 0),
      maticPromise,
      checkAllowance(wallet.address),
      pusdPromise,
    ]);
    const hasClobKey = !!_getPolymarketCreds(relay_node_id);
    // Migrated to V2 = pUSD already approved to V2 spenders. (pusd balance can
    // legitimately be 0 if user spent all of it on positions.)
    const v2Migrated = pusdInfo.v2Approved;

    return reply.send({
      hasWallet: true,
      address: wallet.address,
      usdc: usdce,
      pusd: pusdInfo.pusd,
      matic,
      approved: allowanceResult.approved,
      allowance: allowanceResult.allowance,
      v2Approved: pusdInfo.v2Approved,
      v2Migrated,
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

  // POST /api/polymarket/:relay_node_id/migrate-v2 — 一次性 V2 迁移：
  // approve USDC→Onramp + wrap 全部 USDC 到 pUSD + approve pUSD→V2 exchanges.
  // Polymarket 2026-04-28 把 CLOB 切到 V2，新 collateral 是 pUSD（USDC 1:1 wrap，
  // 无费），不迁移就下不了单（old USDC approve 对 V2 exchange 无效）.
  fastify.post('/api/polymarket/:relay_node_id/migrate-v2', async (request, reply) => {
    const { relay_node_id } = request.params;
    const w = sqlite.prepare("SELECT id FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1").get(relay_node_id);
    if (!w) return reply.code(400).send({ error: '没有 Polygon 钱包' });
    const row = sqlite.prepare('SELECT privkey_encrypted FROM agent_wallets WHERE id = ?').get(w.id);
    if (!row?.privkey_encrypted) return reply.code(400).send({ error: '钱包无私钥' });
    const result = await migrateToV2(decrypt(row.privkey_encrypted));
    return reply.send(result);
  });

  // GET /api/polymarket/:relay_node_id/approve-status — 查询 Approve TX 状态
  fastify.get('/api/polymarket/:relay_node_id/approve-status', async (request, reply) => {
    const { txHash } = request.query;
    if (!txHash) return reply.code(400).send({ error: 'txHash required' });
    const result = await checkTxStatus(txHash);
    return reply.send(result);
  });

  // POST /api/polymarket/:relay_node_id/redeem — 赎回已结算市场持仓
  fastify.post('/api/polymarket/:relay_node_id/redeem', async (request, reply) => {
    const relayNodeId = request.params.relay_node_id;
    const { conditionId } = request.body || {};
    if (!conditionId) return reply.code(400).send({ error: 'conditionId required' });

    const wallet = sqlite.prepare(
      "SELECT address, privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
    ).get(relayNodeId);
    if (!wallet?.privkey_encrypted) return reply.code(400).send({ error: 'No Polygon wallet with private key' });

    const privateKey = decrypt(wallet.privkey_encrypted);
    const result = await redeemPositions(privateKey, conditionId);
    return reply.send(result);
  });

  // POST /api/polymarket/:relay_node_id/exit — 彻底退出 Polymarket
  // 1. 取消所有挂单  2. 扫 USDC 到用户地址  3. 删 CLOB API Key  4. 删 Polygon 钱包行(含私钥)
  // Body: { destinationAddress: '0x...', deleteWallet?: true }
  // 旧 UI 调的 /api/settings/config 端点根本不存在,点退出什么都没做——这个端点是真的退出。
  fastify.post('/api/polymarket/:relay_node_id/exit', async (request, reply) => {
    const relayNodeId = request.params.relay_node_id;
    const { destinationAddress, deleteWallet = true } = request.body || {};
    if (!destinationAddress) return reply.code(400).send({ error: 'destinationAddress required' });

    const wallet = sqlite.prepare(
      "SELECT id, address, privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
    ).get(relayNodeId);
    if (!wallet?.privkey_encrypted) return reply.code(400).send({ error: 'No Polygon wallet with private key' });

    const steps = { cancelledOrders: 0, sweep: null, configDeleted: false, walletDeleted: false };

    // Step 1: cancel any open CLOB orders (best-effort, non-blocking)
    {
      let client;
      try {
        client = await _makeClobClient(relayNodeId);
        if (client) {
          const open = await client.getOpenOrders().catch(() => []);
          for (const o of (open || [])) {
            try { await client.cancelOrder({ orderID: o.id }); steps.cancelledOrders++; } catch {}
          }
        }
      } catch { /* no credentials is fine */ } finally {
        _releaseClob(client);
      }
    }

    // Step 2: sweep USDC to destination — this is the load-bearing step.
    // If sweep fails, DO NOT delete credentials/wallet. User still has value.
    const privateKey = decrypt(wallet.privkey_encrypted);
    const sweep = await sweepUsdc(privateKey, destinationAddress);
    steps.sweep = sweep;
    if (!sweep.ok) {
      return reply.code(500).send({ ok: false, step: 'sweep', steps, error: sweep.error });
    }

    // Step 3: delete CLOB API credentials from config_entries
    try {
      sqlite.prepare("DELETE FROM config_entries WHERE key = ?").run(`polymarket_api_${relayNodeId}`);
      steps.configDeleted = true;
    } catch (e) {
      console.error(`[polymarket exit] config delete failed: ${e.message}`);
    }

    // Step 4: delete the polygon wallet row (includes private key).
    // Only after sweep succeeded.
    if (deleteWallet) {
      try {
        sqlite.prepare('DELETE FROM agent_wallets WHERE id = ?').run(wallet.id);
        steps.walletDeleted = true;
      } catch (e) {
        console.error(`[polymarket exit] wallet delete failed: ${e.message}`);
      }
    }

    return reply.send({ ok: true, steps });
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

  // AI 规则解析 — on-demand, cache 7d
  fastify.post('/api/predictions/market/:conditionId/parse-rules', async (request, reply) => {
    const { parseRules } = await import('../services/market-rules-parser.js');
    const body = request.body || {};
    const r = await parseRules(request.params.conditionId, body);
    return reply.send(r);
  });

  // 读 cache rules (无 LLM 调用)
  fastify.get('/api/predictions/market/:conditionId/rules', async (request, reply) => {
    const { getCached } = await import('../services/market-rules-parser.js');
    const row = getCached(request.params.conditionId);
    if (!row) return reply.code(404).send({ cached: false });
    return reply.send({ cached: true, ...row });
  });

  // ── Position Watcher rules (Owner 5/17 mode 1+2 UI 可设置) ──
  fastify.get('/api/predictions/watch-rules', async (request, reply) => {
    const { relay_node_id } = request.query;
    const where = relay_node_id ? 'WHERE relay_node_id = ?' : '';
    const params = relay_node_id ? [relay_node_id] : [];
    const rows = sqlite.prepare(`SELECT * FROM position_watch_rules ${where} ORDER BY created_at DESC`).all(...params);
    return reply.send({ ok: true, rules: rows.map(r => ({ ...r, thresholds: safeParseJSON(r.thresholds_json) })) });
  });

  fastify.post('/api/predictions/watch-rules', async (request, reply) => {
    const b = request.body || {};
    const required = ['relay_node_id', 'token_id', 'market_title', 'outcome', 'current_size', 'entry_avg_price', 'thresholds'];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || b[k] === '') return reply.code(400).send({ error: `missing field: ${k}` });
    }
    if (!Array.isArray(b.thresholds) || b.thresholds.length === 0) return reply.code(400).send({ error: 'thresholds must be non-empty array' });
    for (const t of b.thresholds) {
      if (!t.label || !t.op || typeof t.price !== 'number') return reply.code(400).send({ error: 'each threshold needs {label, op:"gte"|"lte", price, sell_pct?, action?}' });
      if (t.op !== 'gte' && t.op !== 'lte') return reply.code(400).send({ error: `threshold op must be gte or lte, got ${t.op}` });
    }
    const id = (await import('node:crypto')).randomUUID();
    try {
      sqlite.prepare(`INSERT INTO position_watch_rules (id, relay_node_id, market_slug, market_title, condition_id, token_id, outcome, current_size, entry_avg_price, thresholds_json, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, b.relay_node_id, b.market_slug || null, b.market_title, b.condition_id || null, b.token_id, b.outcome, b.current_size, b.entry_avg_price, JSON.stringify(b.thresholds), b.status || 'active', b.notes || null);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return reply.code(409).send({ error: 'rule for this relay+token already exists' });
      return reply.code(500).send({ error: e.message });
    }
    return reply.send({ ok: true, id });
  });

  fastify.patch('/api/predictions/watch-rules/:id', async (request, reply) => {
    const id = request.params.id;
    const b = request.body || {};
    const allowed = ['current_size', 'entry_avg_price', 'thresholds', 'status', 'notes'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (b[k] === undefined) continue;
      if (k === 'thresholds') {
        if (!Array.isArray(b.thresholds)) return reply.code(400).send({ error: 'thresholds must be array' });
        sets.push('thresholds_json = ?');
        params.push(JSON.stringify(b.thresholds));
      } else {
        sets.push(`${k} = ?`);
        params.push(b[k]);
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'no fields to update' });
    params.push(id);
    const r = sqlite.prepare(`UPDATE position_watch_rules SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (r.changes === 0) return reply.code(404).send({ error: 'rule not found' });
    return reply.send({ ok: true });
  });

  fastify.delete('/api/predictions/watch-rules/:id', async (request, reply) => {
    const r = sqlite.prepare('DELETE FROM position_watch_rules WHERE id = ?').run(request.params.id);
    if (r.changes === 0) return reply.code(404).send({ error: 'rule not found' });
    return reply.send({ ok: true });
  });

  // GET last 20 audit rows for a rule (debug + UI history)
  fastify.get('/api/predictions/watch-rules/:id/audit', async (request, reply) => {
    const rows = sqlite.prepare('SELECT * FROM position_watch_audit WHERE rule_id = ? ORDER BY check_at DESC LIMIT 20').all(request.params.id);
    return reply.send({ ok: true, audit: rows });
  });

  // Manual tick (debug — useful for "fire now without waiting 30 min")
  fastify.post('/api/predictions/watch-rules/tick', async (request, reply) => {
    const { tick } = await import('../services/bettor-position-watcher.js');
    const r = await tick();
    return reply.send(r);
  });
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}
