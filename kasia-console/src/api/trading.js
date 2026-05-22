/**
 * Trading API — portfolio, market data, exchange accounts, and agent trading advice
 */

import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { sqlite } from '../db/client.js';
import { encrypt, decrypt, makeTokenHint } from '../services/crypto.js';
import { getConfig, setConfig } from '../data/settings/configs.js';
import { getReply, getTriggerStatus, updateTriggerSettings, triggerProactive, triggerReflection } from '../services/mind-manager.js';
import { placeOrder as placeExchangeOrder, cancelOrders as cancelExchangeOrders, getOpenOrders as getExchangeOpenOrders, getBalance as getExchangeBalance, getOrderbook as getExchangeOrderbook, getOrder as getExchangeOrder, cancelOrder as cancelExchangeOrder } from '../services/exchange-orders.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { nowIso } from '../lib/time.js';
import { quickStart, completeExecution, failExecution } from '../services/execution-state.js';
import { lockFunds } from '../services/fund-lock.js';
import { checkLimits } from '../services/trade-limits.js';
import { recordChainEvent } from '../services/chain-event.js';
import { verifyCrossChainTx } from '../services/cross-chain-verify.mjs';
import { analyzeMarket } from '../services/signal-engine.js';
import { generateProposal } from '../services/strategy-engine.js';
import { fetchAllMarkets, fetchCryptoData, fetchStockData, fetchPredictionData, fetchCommodityData, cachedFunding, cachedSentiment, cachedCryptoGlobal, cachedCalendar } from '../services/market-data.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { EXCHANGE_REGISTRY } from '../lib/exchange-registry.js';
import { getMarketMakerRelayIdOrThrow } from '../services/broker-config-resolver.js';

/** Trade mode: DB → default DRY-RUN */
async function getTradeMode() {
  const db = await getConfig('trade_mode');
  if (db === 'LIVE' || db === 'DRY-RUN') return db;
  return 'DRY-RUN';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hmacSign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

/** Binance-like signed fetch (MEXC, Binance) */
async function binanceLikeFetch(path, baseUrl, headerName, apiKey, apiSecret) {
  const params = `timestamp=${Date.now()}`;
  const signature = hmacSign(params, apiSecret);
  const res = await fetch(`${baseUrl}${path}?${params}&signature=${signature}`, {
    headers: { [headerName]: apiKey },
  });
  return res.json();
}

/** Resolve active exchange account — returns { apiKey, apiSecret, extra, exchange, baseUrl, def } or null */
function getDefaultExchangeAccount() {
  // KI 65 A.5.2: runtime trade credentials filter per MarketMaker-A (库存层 = inventory CEX accounts).
  // Admin /api/exchange-accounts CRUD endpoints remain org-wide (no filter).
  const mmaId = getMarketMakerRelayIdOrThrow();
  const row = sqlite.prepare(
    'SELECT * FROM exchange_accounts WHERE relay_node_id = ? AND is_default = 1 LIMIT 1'
  ).get(mmaId) || sqlite.prepare(
    'SELECT * FROM exchange_accounts WHERE relay_node_id = ? LIMIT 1'
  ).get(mmaId);

  if (!row) return null;

  try {
    const apiKey = row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null;
    const apiSecret = row.api_secret_encrypted ? decrypt(row.api_secret_encrypted) : null;
    const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
    const def = EXCHANGE_REGISTRY.find(e => e.id === row.exchange);
    return { apiKey, apiSecret, extra, exchange: row.exchange, baseUrl: row.base_url || def?.baseUrl, def, label: row.label, row };
  } catch { return null; }
}

/** Get credentials from DB */
function getCredentials() {
  return getDefaultExchangeAccount();
}


/** Parse action_details JSON in execution_state row */
function _parseExecutionRow(row) {
  if (!row) return row;
  if (row.action_details && typeof row.action_details === 'string') {
    try { row.action_details = JSON.parse(row.action_details); } catch {}
  }
  return row;
}

// NWT N14.5 Phase β Step 2 sub#3a (5/18): _otcDeprecated410 helper 删 (routes 一并删, helper dead).

// NWT N19.4 P1.5 5/18: in-memory KAS price cache (10min stale tolerance, multi-source fallback survival).
// 单 oracle 429 时 autoTaker / market-seeder 不再 marketPrice_null silent exit.
let _kasPriceCache = null; // { price, ts, source }

export async function registerTradingRoutes(fastify) {

  // GET /api/trade/kas-price — KAS/USDT mid price (multi-source fallback + stale cache).
  // NWT N19.4 P1.5 5/18: 单 MEXC source 撞 429 → autoTaker marketPrice_null silent exit.
  // 修法: 3 source fallback chain + 10min stale cache (last successful price 不丢).
  // sources: MEXC → KuCoin → Binance → cache (≤10min stale).
  fastify.get('/api/trade/kas-price', async (request, reply) => {
    const SOURCES = [
      { name: 'mexc',    url: 'https://api.mexc.com/api/v3/ticker/price?symbol=KASUSDT', parse: d => parseFloat(d.price) },
      { name: 'kucoin',  url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=KAS-USDT', parse: d => parseFloat(d.data?.price) },
      { name: 'binance', url: 'https://api.binance.com/api/v3/ticker/price?symbol=KASUSDT', parse: d => parseFloat(d.price) },
    ];
    for (const src of SOURCES) {
      try {
        const res = await fetch(src.url, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        const data = await res.json();
        const price = src.parse(data);
        if (price && price > 0 && Number.isFinite(price)) {
          _kasPriceCache = { price, ts: Date.now(), source: src.name };
          return reply.send({ price, source: src.name });
        }
      } catch { /* try next source */ }
    }
    // All sources fail → use stale cache if within 10min
    const STALE_TTL_MS = 10 * 60_000;
    if (_kasPriceCache && (Date.now() - _kasPriceCache.ts) < STALE_TTL_MS) {
      const ageS = Math.round((Date.now() - _kasPriceCache.ts) / 1000);
      return reply.send({ price: _kasPriceCache.price, source: `cache:${_kasPriceCache.source} (${ageS}s stale)`, stale: true });
    }
    return reply.send({ price: 0, source: 'unavailable' });
  });

  // GET /trading — 5/21 fix: legacy OTC page deprecated 5/18 (mm_orders absorb 进 exchange).
  // /trading.eta 多 null deref JS error + 400/404 fetches (regression sweep N19.164 catch).
  // Redirect → /exchange (新接 OTC flow + broker-v3 settlement). Users 老 bookmark 自动 forward.
  fastify.get('/trading', async (request, reply) => reply.redirect('/exchange'));

  // GET /trading-v2 — new design system trading page
  fastify.get('/trading-v2', async (request, reply) => {
    const relayNodes = sqlite.prepare('SELECT id, name, address FROM relay_nodes').all();
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    return reply.viewAsync('trading-v2.eta', {
      title: 'Trading — KANet',
      relayNodes,
      t, lang, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES,
      _page: 'trading',
    });
  });

  // GET /api/trade/wallet-balance — 实时查链上余额（USDT + 原生币）
  fastify.get('/api/trade/wallet-balance', async (request, reply) => {
    const { chain, address } = request.query;
    if (!chain || !address) return reply.code(400).send({ error: 'chain and address required' });

    let provider;
    try {
      const EVM_CHAINS = ['bnb', 'eth'];
      if (EVM_CHAINS.includes(chain)) {
        const { ethers } = await import('ethers');
        const RPC = { bnb: 'https://bsc-dataseed1.binance.org', eth: 'https://eth.llamarpc.com' };
        const USDT = {
          bnb: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
          eth: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
        };
        if (!RPC[chain]) return reply.code(400).send({ error: 'unsupported chain' });

        provider = new ethers.JsonRpcProvider(RPC[chain]);
        const [nativeBal, usdtBal] = await Promise.all([
          provider.getBalance(address),
          new ethers.Contract(USDT[chain].address, ['function balanceOf(address) view returns (uint256)'], provider).balanceOf(address),
        ]);

        return reply.send({
          chain, address,
          native: parseFloat(ethers.formatEther(nativeBal)),
          usdt: parseFloat(ethers.formatUnits(usdtBal, USDT[chain].decimals)),
        });
      }

      // SOL / TRON — 简化返回（后续可加）
      return reply.send({ chain, address, native: 0, usdt: 0, note: 'real-time balance not yet implemented for ' + chain });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    } finally {
      try { provider?.destroy?.(); } catch {}
    }
  });

  // POST /api/trade/withdraw — 提现（USDT 或原生币）
  fastify.post('/api/trade/withdraw', async (request, reply) => {
    const { walletId, chain, to, amount, asset = 'usdt' } = request.body || {};
    if (!walletId || !chain || !to || !amount) return reply.code(400).send({ error: 'walletId, chain, to, amount required' });

    const wallet = sqlite.prepare('SELECT * FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet?.privkey_encrypted) return reply.code(400).send({ error: 'Wallet not found or no private key' });

    let provider;
    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const EVM_CHAINS = ['bnb', 'eth'];

      if (EVM_CHAINS.includes(chain)) {
        const { ethers } = await import('ethers');
        const RPC = { bnb: 'https://bsc-dataseed1.binance.org', eth: 'https://eth.llamarpc.com' };
        const USDT = {
          bnb: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
          eth: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
        };
        provider = new ethers.JsonRpcProvider(RPC[chain]);
        const signer = new ethers.Wallet(privateKey, provider);

        if (asset === 'usdt') {
          const contract = new ethers.Contract(USDT[chain].address, [
            'function transfer(address to, uint256 amount) returns (bool)',
            'function balanceOf(address) view returns (uint256)',
          ], signer);

          const bal = await contract.balanceOf(wallet.address);
          const balFloat = parseFloat(ethers.formatUnits(bal, USDT[chain].decimals));
          if (balFloat < amount) return reply.code(400).send({ error: `余额不足: ${balFloat.toFixed(2)} USDT, 需要 ${amount}` });

          const amountWei = ethers.parseUnits(String(amount.toFixed(USDT[chain].decimals > 6 ? 6 : USDT[chain].decimals)), USDT[chain].decimals);
          const tx = await contract.transfer(to, amountWei);
          console.log(`[withdraw] ${amount} USDT → ${to} on ${chain} TX: ${tx.hash}`);

          recordChainEvent({
            txid: tx.hash, eventType: 'withdraw', fromAddress: wallet.address, toAddress: to,
            observedBy: 'system', payload: { amount, asset: 'usdt', chain },
          });

          return reply.send({ ok: true, txHash: tx.hash, amount, chain });
        } else if (asset === 'native') {
          const tx = await signer.sendTransaction({ to, value: ethers.parseEther(String(amount)) });
          console.log(`[withdraw] ${amount} ${chain.toUpperCase()} → ${to} TX: ${tx.hash}`);
          return reply.send({ ok: true, txHash: tx.hash, amount, chain });
        }
      }

      return reply.code(400).send({ error: `提现暂不支持 ${chain} 链` });
    } catch (err) {
      console.error(`[withdraw] failed:`, err.message);
      return reply.code(500).send({ error: '提现失败: ' + err.message });
    } finally {
      try { provider?.destroy?.(); } catch {}
    }
  });

  // GET /market — 自由市场（旧版，preserved）
  fastify.get('/market', async (request, reply) => {
    const relays = sqlite.prepare('SELECT id, name, address FROM relay_nodes').all();
    return reply.viewAsync('market.eta', {
      title: '自由市场',
      relays,
      mode: await getTradeMode(),
    });
  });

  // GET /market-v2 — 自由市场（新设计系统）
  fastify.get('/market-v2', async (request, reply) => {
    const relayNodes = sqlite.prepare('SELECT id, name, address FROM relay_nodes').all();
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    return reply.viewAsync('market-v2.eta', {
      title: '自由市场 — KANet',
      relayNodes,
      t, lang, dir: isRtl(lang) ? 'rtl' : 'ltr', langs: LANG_NAMES,
      _page: 'market',
    });
  });

  // GET /api/trade/mode — get current trade mode
  fastify.get('/api/trade/mode', async (request, reply) => {
    return reply.send({ mode: await getTradeMode() });
  });

  // PUT /api/trade/mode — toggle LIVE / DRY-RUN
  fastify.put('/api/trade/mode', async (request, reply) => {
    const { mode } = request.body || {};
    const value = mode === 'LIVE' ? 'LIVE' : 'DRY-RUN';
    await setConfig('trade_mode', value, { category: 'trading' });
    return reply.send({ ok: true, mode: value });
  });

  // GET /api/trade/agent-mode — Agent 自主权模式（per-agent or global fallback）
  // ?relay_node_id=xxx → per-agent mode; omit → global default
  fastify.get('/api/trade/agent-mode', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (relay_node_id) {
      const perAgent = await getConfig(`agent_trade_mode:${relay_node_id}`);
      if (perAgent && ['auto', 'approval', 'manual', 'disabled'].includes(perAgent)) {
        return reply.send({ mode: perAgent, source: 'per-agent' });
      }
    }
    const val = await getConfig('agent_trade_mode');
    const mode = ['auto', 'approval', 'manual', 'disabled'].includes(val) ? val : 'manual';
    return reply.send({ mode, source: 'global' });
  });

  // PUT /api/trade/agent-mode — 切换 Agent 自主权模式（per-agent）
  fastify.put('/api/trade/agent-mode', async (request, reply) => {
    const { mode, relayNodeId } = request.body || {};
    if (!['auto', 'approval', 'manual', 'disabled'].includes(mode)) {
      return reply.code(400).send({ error: 'mode must be auto, approval, manual, or disabled' });
    }
    if (relayNodeId) {
      // Per-agent setting
      await setConfig(`agent_trade_mode:${relayNodeId}`, mode, { category: 'trade_limits' });
      console.log(`[trading] Agent ${relayNodeId.slice(0, 8)} trade mode → ${mode}`);
    } else {
      // Global fallback
      await setConfig('agent_trade_mode', mode, { category: 'trade_limits' });
      console.log(`[trading] Global trade mode → ${mode}`);
    }
    return reply.send({ ok: true, mode });
  });

  // GET /api/trade/agent-modes — all agents with their modes
  fastify.get('/api/trade/agent-modes', async (request, reply) => {
    const relays = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all();
    const globalMode = await getConfig('agent_trade_mode') || 'manual';
    const anchor = await getConfig('trade_anchor') || 'usd';

    const agents = [];
    for (const r of relays) {
      const perAgent = await getConfig(`agent_trade_mode:${r.id}`);
      agents.push({
        id: r.id,
        name: r.name,
        address: r.address,
        mode: perAgent && ['auto', 'approval', 'manual', 'disabled'].includes(perAgent) ? perAgent : globalMode,
        isPerAgent: !!perAgent,
      });
    }
    return reply.send({ agents, globalMode, anchor });
  });

  // ── Exchange Account CRUD ─────────────────────────────────────────────────

  // GET /api/trade/exchanges — list supported exchanges
  fastify.get('/api/trade/exchanges', async (request, reply) => {
    return reply.send(EXCHANGE_REGISTRY);
  });

  // GET /api/trade/accounts — list configured exchange accounts (masked)
  fastify.get('/api/trade/accounts', async (request, reply) => {
    const rows = sqlite.prepare('SELECT * FROM exchange_accounts ORDER BY is_default DESC, created_at').all();
    const accounts = rows.map(r => {
      const def = EXCHANGE_REGISTRY.find(e => e.id === r.exchange);
      return {
        id: r.id,
        exchange: r.exchange,
        exchangeName: def?.name || r.label || r.exchange,
        label: r.label,
        apiKeyHint: r.api_key_hint,
        apiSecretHint: r.api_secret_hint,
        extraHint: r.extra_hint,
        baseUrl: r.base_url,
        isDefault: !!r.is_default,
        fields: def?.fields || ['apiKey', 'apiSecret'],
        createdAt: r.created_at,
      };
    });
    return reply.send(accounts);
  });

  // POST /api/trade/accounts — create exchange account
  fastify.post('/api/trade/accounts', async (request, reply) => {
    const { exchange, label, apiKey, apiSecret, passphrase, baseUrl } = request.body || {};
    if (!exchange || !apiKey?.trim() || !apiSecret?.trim()) {
      return reply.code(400).send({ error: 'exchange, apiKey, and apiSecret required' });
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    // If this is the first account, make it default
    const existingCount = sqlite.prepare('SELECT count(*) as cnt FROM exchange_accounts').get().cnt;
    const isDefault = existingCount === 0 ? 1 : 0;

    const extra = {};
    if (passphrase) extra.passphrase = passphrase;
    const extraStr = Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;

    sqlite.prepare(`
      INSERT INTO exchange_accounts (id, exchange, label, api_key_encrypted, api_key_hint, api_secret_encrypted, api_secret_hint, extra_encrypted, extra_hint, base_url, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      exchange.trim(),
      label || null,
      encrypt(apiKey.trim()),
      makeTokenHint(apiKey.trim()),
      encrypt(apiSecret.trim()),
      makeTokenHint(apiSecret.trim()),
      extraStr ? encrypt(extraStr) : null,
      passphrase ? 'passphrase set' : null,
      baseUrl || null,
      isDefault,
      now, now,
    );

    return reply.send({ ok: true, id, isDefault: !!isDefault });
  });

  // PUT /api/trade/accounts/:id — update exchange account
  fastify.put('/api/trade/accounts/:id', async (request, reply) => {
    const { id } = request.params;
    const { label, apiKey, apiSecret, passphrase, baseUrl } = request.body || {};
    const existing = sqlite.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'Account not found' });

    const now = new Date().toISOString();
    const updates = [];
    const values = [];

    if (label !== undefined) { updates.push('label=?'); values.push(label || null); }
    if (baseUrl !== undefined) { updates.push('base_url=?'); values.push(baseUrl || null); }

    if (apiKey?.trim()) {
      updates.push('api_key_encrypted=?', 'api_key_hint=?');
      values.push(encrypt(apiKey.trim()), makeTokenHint(apiKey.trim()));
    }
    if (apiSecret?.trim()) {
      updates.push('api_secret_encrypted=?', 'api_secret_hint=?');
      values.push(encrypt(apiSecret.trim()), makeTokenHint(apiSecret.trim()));
    }
    if (passphrase !== undefined) {
      const extra = passphrase ? JSON.stringify({ passphrase }) : null;
      updates.push('extra_encrypted=?', 'extra_hint=?');
      values.push(extra ? encrypt(extra) : null, passphrase ? 'passphrase set' : null);
    }

    if (updates.length === 0) return reply.send({ ok: true, noChanges: true });

    updates.push('updated_at=?');
    values.push(now, id);
    sqlite.prepare(`UPDATE exchange_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return reply.send({ ok: true });
  });

  // DELETE /api/trade/accounts/:id — delete exchange account
  fastify.delete('/api/trade/accounts/:id', async (request, reply) => {
    const { id } = request.params;
    const row = sqlite.prepare('SELECT is_default FROM exchange_accounts WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'Account not found' });

    sqlite.prepare('DELETE FROM exchange_accounts WHERE id = ?').run(id);

    // If deleted account was default, promote the next one
    if (row.is_default) {
      const next = sqlite.prepare('SELECT id FROM exchange_accounts LIMIT 1').get();
      if (next) sqlite.prepare('UPDATE exchange_accounts SET is_default = 1 WHERE id = ?').run(next.id);
    }

    return reply.send({ ok: true });
  });

  // POST /api/trade/accounts/:id/default — set as default
  fastify.post('/api/trade/accounts/:id/default', async (request, reply) => {
    const { id } = request.params;
    sqlite.prepare('UPDATE exchange_accounts SET is_default = 0').run();
    sqlite.prepare('UPDATE exchange_accounts SET is_default = 1 WHERE id = ?').run(id);
    return reply.send({ ok: true });
  });

  // POST /api/trade/accounts/:id/test — test connection
  fastify.post('/api/trade/accounts/:id/test', async (request, reply) => {
    const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(request.params.id);
    if (!row) return reply.code(404).send({ error: 'Account not found' });

    let apiKey, apiSecret;
    try {
      apiKey = decrypt(row.api_key_encrypted);
      apiSecret = decrypt(row.api_secret_encrypted);
    } catch {
      return reply.send({ ok: false, error: 'Failed to decrypt credentials' });
    }

    const def = EXCHANGE_REGISTRY.find(e => e.id === row.exchange);
    const baseUrl = row.base_url || def?.baseUrl;
    const authStyle = def?.authStyle || 'unknown';

    try {
      if (authStyle === 'binance-like' && baseUrl && def?.headerName) {
        const data = await binanceLikeFetch('/account', baseUrl, def.headerName, apiKey, apiSecret);
        if (data?.code && data.code !== 200) {
          return reply.send({ ok: false, error: data.msg || `API error ${data.code}` });
        }
        const balanceCount = (data.balances || []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0).length;
        return reply.send({ ok: true, message: `Connected — ${balanceCount} assets with balance` });
      }
      // Gate.io: HMAC-SHA512
      if (authStyle === 'gateio' && baseUrl) {
        const path = '/spot/accounts';
        const ts = Math.floor(Date.now() / 1000).toString();
        const bodyHash = crypto.createHash('sha512').update('').digest('hex');
        const signStr = `GET\n/api/v4${path}\n\n${bodyHash}\n${ts}`;
        const sign = crypto.createHmac('sha512', apiSecret).update(signStr).digest('hex');
        const res = await fetch(`${baseUrl}${path}`, {
          headers: { 'KEY': apiKey, 'SIGN': sign, 'Timestamp': ts, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (!res.ok) return reply.send({ ok: false, error: data?.message || data?.label || `HTTP ${res.status}` });
        const withBalance = (Array.isArray(data) ? data : []).filter(a => parseFloat(a.available) > 0 || parseFloat(a.locked) > 0).length;
        return reply.send({ ok: true, message: `Connected — ${withBalance} assets with balance` });
      }

      // OKX: HMAC-SHA256 + Base64 + passphrase
      if (authStyle === 'okx' && baseUrl) {
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        const passphrase = extra.passphrase || '';
        const ts = new Date().toISOString();
        const preSign = ts + 'GET' + '/api/v5/account/balance';
        const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
        const res = await fetch(`${baseUrl}/api/v5/account/balance`, {
          headers: { 'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': sign, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.code !== '0') return reply.send({ ok: false, error: data.msg || `Code ${data.code}` });
        return reply.send({ ok: true, message: `Connected — OKX account verified` });
      }

      // Bybit: HMAC-SHA256 + timestamp + recv_window
      if (authStyle === 'bybit' && baseUrl) {
        const ts = Date.now().toString();
        const recvWindow = '5000';
        const qs = 'accountType=UNIFIED';
        const preSign = ts + apiKey + recvWindow + qs;
        const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex');
        const res = await fetch(`${baseUrl}/v5/account/wallet-balance?${qs}`, {
          headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sign, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recvWindow, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.retCode !== 0) return reply.send({ ok: false, error: data.retMsg || `Code ${data.retCode}` });
        return reply.send({ ok: true, message: `Connected — Bybit account verified` });
      }

      // KuCoin: HMAC-SHA256 + Base64 + passphrase
      if (authStyle === 'kucoin' && baseUrl) {
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        const passphrase = extra.passphrase || '';
        const ts = Date.now().toString();
        const preSign = ts + 'GET' + '/api/v1/accounts';
        const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
        const signedPassphrase = crypto.createHmac('sha256', apiSecret).update(passphrase).digest('base64');
        const res = await fetch(`${baseUrl}/api/v1/accounts`, {
          headers: { 'KC-API-KEY': apiKey, 'KC-API-SIGN': sign, 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': signedPassphrase, 'KC-API-KEY-VERSION': '2', 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.code !== '200000') return reply.send({ ok: false, error: data.msg || `Code ${data.code}` });
        const withBalance = (data.data || []).filter(a => parseFloat(a.balance) > 0).length;
        return reply.send({ ok: true, message: `Connected — ${withBalance} accounts with balance` });
      }

      // Bitget: HMAC-SHA256 + Base64 + passphrase
      if (authStyle === 'bitget' && baseUrl) {
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        const passphrase = extra.passphrase || '';
        const ts = Date.now().toString();
        const preSign = ts + 'GET' + '/api/v2/spot/account/assets';
        const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
        const res = await fetch(`${baseUrl}/api/v2/spot/account/assets`, {
          headers: { 'ACCESS-KEY': apiKey, 'ACCESS-SIGN': sign, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json', 'locale': 'en-US' },
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.code !== '00000') return reply.send({ ok: false, error: data.msg || `Code ${data.code}` });
        const withBalance = (data.data || []).filter(a => parseFloat(a.available) > 0).length;
        return reply.send({ ok: true, message: `Connected — ${withBalance} assets with balance` });
      }

      // HTX (Huobi): HMAC-SHA256 + URL-encoded params
      if (authStyle === 'htx' && baseUrl) {
        const ts = new Date().toISOString().replace(/\.\d{3}Z/, '');
        const params = new URLSearchParams({
          AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256', SignatureVersion: '2', Timestamp: ts,
        });
        params.sort();
        const preSign = `GET\napi.huobi.pro\n/v1/account/accounts\n${params.toString()}`;
        const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
        params.append('Signature', sign);
        const res = await fetch(`${baseUrl}/v1/account/accounts?${params.toString()}`, {
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.status !== 'ok') return reply.send({ ok: false, error: data['err-msg'] || `Status: ${data.status}` });
        return reply.send({ ok: true, message: `Connected — ${(data.data || []).length} accounts` });
      }

      // Unknown exchange: try public endpoint
      if (baseUrl) {
        const testRes = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
        return reply.send({ ok: testRes.ok, message: testRes.ok ? 'Endpoint reachable (auth not implemented)' : `HTTP ${testRes.status}` });
      }
      return reply.send({ ok: false, error: 'No base URL configured' });
    } catch (err) {
      return reply.send({ ok: false, error: err.message });
    }
  });

  // ── CEX Balance Queries ──────────────────────────────────────────────────

  // GET /api/trade/accounts/:id/balance — single account real-time balance
  fastify.get('/api/trade/accounts/:id/balance', async (request, reply) => {
    const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(request.params.id);
    if (!row) return reply.code(404).send({ error: 'Account not found' });

    let apiKey, apiSecret, passphrase;
    try {
      apiKey = row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null;
      apiSecret = row.api_secret_encrypted ? decrypt(row.api_secret_encrypted) : null;
      const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
      passphrase = extra.passphrase || null;
    } catch {
      return reply.send({ exchange: row.exchange, kas: null, usdt: null, timestamp: new Date().toISOString(), error: 'Failed to decrypt credentials' });
    }

    const result = await getExchangeBalance({
      exchange: row.exchange, apiKey, apiSecret, passphrase,
      baseUrl: row.base_url || undefined,
    });
    return reply.send(result);
  });

  // GET /api/trade/balances — all accounts balance summary (30s cache)
  const _balanceCache = { data: null, cachedAt: null };
  fastify.get('/api/trade/balances', async (request, reply) => {
    // Return cache if fresh (within 30s)
    if (_balanceCache.data && _balanceCache.cachedAt && (Date.now() - new Date(_balanceCache.cachedAt).getTime()) < 30_000) {
      return reply.send({ balances: _balanceCache.data, cachedAt: _balanceCache.cachedAt });
    }

    const rows = sqlite.prepare('SELECT * FROM exchange_accounts ORDER BY is_default DESC, created_at').all();
    if (!rows.length) {
      return reply.send({ balances: [], cachedAt: new Date().toISOString() });
    }

    const results = await Promise.allSettled(rows.map(async (row) => {
      let apiKey, apiSecret, passphrase;
      try {
        apiKey = row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null;
        apiSecret = row.api_secret_encrypted ? decrypt(row.api_secret_encrypted) : null;
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        passphrase = extra.passphrase || null;
      } catch {
        return { accountId: row.id, label: row.label, exchange: row.exchange, kas: null, usdt: null, timestamp: new Date().toISOString(), error: 'decrypt failed' };
      }

      const bal = await getExchangeBalance({
        exchange: row.exchange, apiKey, apiSecret, passphrase,
        baseUrl: row.base_url || undefined,
      });
      return { accountId: row.id, label: row.label, ...bal };
    }));

    const balances = results.map(r => r.status === 'fulfilled' ? r.value : { kas: null, usdt: null, error: r.reason?.message || 'unknown error' });
    const cachedAt = new Date().toISOString();
    _balanceCache.data = balances;
    _balanceCache.cachedAt = cachedAt;
    return reply.send({ balances, cachedAt });
  });

  // ── Spread Matrix ──────────────────────────────────────────────────────────

  const _spreadsCache = { data: null, cachedAt: null };

  const SPREAD_TICKERS = [
    { exchange: 'mexc',   url: 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol=KASUSDT',          parse: d => ({ ask: parseFloat(d.askPrice), bid: parseFloat(d.bidPrice) }) },
    { exchange: 'gateio', url: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=KAS_USDT',      parse: d => { const t = Array.isArray(d) ? d[0] : d; return { ask: parseFloat(t.lowest_ask), bid: parseFloat(t.highest_bid) }; } },
    { exchange: 'bybit',  url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=KASUSDT',   parse: d => ({ ask: parseFloat(d.result.list[0].ask1Price), bid: parseFloat(d.result.list[0].bid1Price) }) },
    { exchange: 'kucoin', url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=KAS-USDT',  parse: d => ({ ask: parseFloat(d.data.bestAsk), bid: parseFloat(d.data.bestBid) }) },
    { exchange: 'bitget', url: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=KASUSDT',       parse: d => ({ ask: parseFloat(d.data[0].askPr), bid: parseFloat(d.data[0].bidPr) }) },
    { exchange: 'htx',    url: 'https://api.huobi.pro/market/detail/merged?symbol=kasusdt',              parse: d => ({ ask: parseFloat(d.tick.ask[0]), bid: parseFloat(d.tick.bid[0]) }) },
  ];

  // GET /api/trade/orderbook — realtime orderbook (no cache)
  fastify.get('/api/trade/orderbook', async (request, reply) => {
    const { exchange, exchanges, limit } = request.query;
    const depthLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 20);

    // Multi-exchange parallel query
    if (exchanges) {
      const ids = exchanges.split(',').map(s => s.trim()).filter(Boolean);
      const results = await Promise.allSettled(ids.map(id => getExchangeOrderbook(id, depthLimit)));
      const orderbooks = results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { exchange: ids[i], error: r.reason?.message || 'failed' }
      );
      return reply.send({ orderbooks });
    }

    // Single exchange query
    if (!exchange) return reply.code(400).send({ error: 'exchange or exchanges parameter required' });
    const orderbook = await getExchangeOrderbook(exchange, depthLimit);
    return reply.send({ orderbook });
  });

  fastify.get('/api/trade/spreads', async (request, reply) => {
    // Check cache (30s)
    if (_spreadsCache.data && _spreadsCache.cachedAt && (Date.now() - new Date(_spreadsCache.cachedAt).getTime()) < 30_000) {
      return reply.send(_spreadsCache.data);
    }

    // Parallel fetch all tickers
    const results = await Promise.allSettled(SPREAD_TICKERS.map(async (t) => {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      const { ask, bid } = t.parse(data);
      return { exchange: t.exchange, ask, bid, mid: parseFloat(((ask + bid) / 2).toFixed(6)), error: null };
    }));

    const tickers = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { exchange: SPREAD_TICKERS[i].exchange, ask: null, bid: null, mid: null, error: r.reason?.message || 'fetch failed' }
    );

    // Determine which exchanges the user has funded accounts on
    const accountRows = sqlite.prepare('SELECT * FROM exchange_accounts ORDER BY is_default DESC').all();
    const fundedExchanges = new Set();
    if (accountRows.length) {
      const balResults = await Promise.allSettled(accountRows.map(async (row) => {
        let apiKey, apiSecret, passphrase;
        try {
          apiKey = row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null;
          apiSecret = row.api_secret_encrypted ? decrypt(row.api_secret_encrypted) : null;
          const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
          passphrase = extra.passphrase || null;
        } catch { return null; }
        return getExchangeBalance({ exchange: row.exchange, apiKey, apiSecret, passphrase, baseUrl: row.base_url || undefined });
      }));
      for (const r of balResults) {
        if (r.status === 'fulfilled' && r.value && !r.value.error) {
          if ((r.value.kas && r.value.kas > 0) || (r.value.usdt && r.value.usdt > 0)) {
            fundedExchanges.add(r.value.exchange);
          }
        }
      }
    }

    // Compute spread matrix (all valid pairs)
    const threshold_pct = 0.3;
    const spreads = [];
    const valid = tickers.filter(t => t.ask !== null && t.bid !== null);
    for (const buy of valid) {
      for (const sell of valid) {
        if (buy.exchange === sell.exchange) continue;
        const spread_pct = parseFloat((((sell.bid - buy.ask) / buy.ask) * 100).toFixed(4));
        spreads.push({
          buy_from: buy.exchange,
          sell_to: sell.exchange,
          spread_pct,
          opportunity: spread_pct >= threshold_pct,
          actionable: fundedExchanges.has(buy.exchange) && fundedExchanges.has(sell.exchange),
        });
      }
    }

    // Sort: opportunities first, then by spread descending
    spreads.sort((a, b) => (b.opportunity - a.opportunity) || (b.spread_pct - a.spread_pct));

    const cachedAt = new Date().toISOString();
    const funded_exchanges = [...fundedExchanges];
    const payload = { tickers, spreads, threshold_pct, funded_exchanges, cachedAt };
    _spreadsCache.data = payload;
    _spreadsCache.cachedAt = cachedAt;
    return reply.send(payload);
  });

  // ── Portfolio (uses DB creds → env fallback) ──────────────────────────────

  // GET /api/trade/portfolio — account balances + market data
  fastify.get('/api/trade/portfolio', async (request, reply) => {
    try {
      // Market data — always from MEXC public endpoints (no auth needed)
      const marketBase = 'https://api.mexc.com/api/v3';
      const [ticker, klines] = await Promise.all([
        fetch(`${marketBase}/ticker/24hr?symbol=KASUSDT`).then(r => r.json()).catch(() => null),
        fetch(`${marketBase}/klines?symbol=KASUSDT&interval=60m&limit=72`).then(r => r.json()).catch(() => null),
      ]);

      // Account balances — supports all exchange auth styles
      let balances = [];
      const creds = getCredentials();
      if (creds) {
        const { apiKey, apiSecret, baseUrl, def, row } = creds;
        try {
          if (def?.authStyle === 'binance-like') {
            const account = await binanceLikeFetch('/account', baseUrl, def.headerName, apiKey, apiSecret);
            balances = (account?.balances || [])
              .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
              .map(b => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }));
          } else if (def?.authStyle === 'gateio') {
            const path = '/spot/accounts';
            const ts = Math.floor(Date.now() / 1000).toString();
            const bodyHash = crypto.createHash('sha512').update('').digest('hex');
            const signStr = `GET\n/api/v4${path}\n\n${bodyHash}\n${ts}`;
            const sign = crypto.createHmac('sha512', apiSecret).update(signStr).digest('hex');
            const res = await fetch(`${baseUrl}${path}`, {
              headers: { 'KEY': apiKey, 'SIGN': sign, 'Timestamp': ts, 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(8000),
            });
            const data = await res.json();
            balances = (Array.isArray(data) ? data : [])
              .filter(a => parseFloat(a.available) > 0 || parseFloat(a.locked) > 0)
              .map(a => ({ asset: a.currency?.toUpperCase(), free: parseFloat(a.available), locked: parseFloat(a.locked) }));
          } else if (def?.authStyle === 'okx') {
            const extra = row?.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
            const ts = new Date().toISOString();
            const preSign = ts + 'GET' + '/api/v5/account/balance';
            const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
            const res = await fetch(`${baseUrl}/api/v5/account/balance`, {
              headers: { 'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': sign, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': extra.passphrase || '', 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(8000),
            });
            const data = await res.json();
            if (data.code === '0' && data.data?.[0]?.details) {
              balances = data.data[0].details
                .filter(d => parseFloat(d.availBal) > 0 || parseFloat(d.frozenBal) > 0)
                .map(d => ({ asset: d.ccy, free: parseFloat(d.availBal), locked: parseFloat(d.frozenBal) }));
            }
          } else if (def?.authStyle === 'bybit') {
            const ts = Date.now().toString();
            const recvWindow = '5000';
            const preSign = ts + apiKey + recvWindow;
            const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex');
            const res = await fetch(`${baseUrl}/v5/account/wallet-balance?accountType=UNIFIED`, {
              headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': sign, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recvWindow },
              signal: AbortSignal.timeout(8000),
            });
            const data = await res.json();
            if (data.retCode === 0 && data.result?.list?.[0]?.coin) {
              balances = data.result.list[0].coin
                .filter(c => parseFloat(c.walletBalance) > 0)
                .map(c => ({ asset: c.coin, free: parseFloat(c.availableToWithdraw), locked: parseFloat(c.walletBalance) - parseFloat(c.availableToWithdraw) }));
            }
          } else if (def?.authStyle === 'kucoin') {
            const extra = row?.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
            const ts = Date.now().toString();
            const preSign = ts + 'GET' + '/api/v1/accounts';
            const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
            const signedPass = crypto.createHmac('sha256', apiSecret).update(extra.passphrase || '').digest('base64');
            const res = await fetch(`${baseUrl}/api/v1/accounts`, {
              headers: { 'KC-API-KEY': apiKey, 'KC-API-SIGN': sign, 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': signedPass, 'KC-API-KEY-VERSION': '2' },
              signal: AbortSignal.timeout(8000),
            });
            const data = await res.json();
            if (data.code === '200000' && Array.isArray(data.data)) {
              // KuCoin has multiple account types, aggregate by currency
              const agg = {};
              data.data.forEach(a => {
                if (!agg[a.currency]) agg[a.currency] = { free: 0, locked: 0 };
                agg[a.currency].free += parseFloat(a.available);
                agg[a.currency].locked += parseFloat(a.holds);
              });
              balances = Object.entries(agg).filter(([, v]) => v.free > 0 || v.locked > 0).map(([k, v]) => ({ asset: k, free: v.free, locked: v.locked }));
            }
          } else if (def?.authStyle === 'bitget') {
            const extra = row?.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
            const ts = Date.now().toString();
            const preSign = ts + 'GET' + '/api/v2/spot/account/assets';
            const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
            const res = await fetch(`${baseUrl}/api/v2/spot/account/assets`, {
              headers: { 'ACCESS-KEY': apiKey, 'ACCESS-SIGN': sign, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': extra.passphrase || '', 'Content-Type': 'application/json', 'locale': 'en-US' },
              signal: AbortSignal.timeout(8000),
            });
            const data = await res.json();
            if (data.code === '00000' && Array.isArray(data.data)) {
              balances = data.data.filter(a => parseFloat(a.available) > 0 || parseFloat(a.frozen) > 0)
                .map(a => ({ asset: a.coin, free: parseFloat(a.available), locked: parseFloat(a.frozen) }));
            }
          } else if (def?.authStyle === 'htx') {
            const ts = new Date().toISOString().replace(/\.\d{3}Z/, '');
            const params = new URLSearchParams({ AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256', SignatureVersion: '2', Timestamp: ts });
            params.sort();
            const preSign = `GET\napi.huobi.pro\n/v1/account/accounts\n${params.toString()}`;
            const sign = crypto.createHmac('sha256', apiSecret).update(preSign).digest('base64');
            params.append('Signature', sign);
            const acctRes = await fetch(`${baseUrl}/v1/account/accounts?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
            const acctData = await acctRes.json();
            if (acctData.status === 'ok' && acctData.data?.[0]?.id) {
              const acctId = acctData.data[0].id;
              const ts2 = new Date().toISOString().replace(/\.\d{3}Z/, '');
              const params2 = new URLSearchParams({ AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256', SignatureVersion: '2', Timestamp: ts2 });
              params2.sort();
              const preSign2 = `GET\napi.huobi.pro\n/v1/account/accounts/${acctId}/balance\n${params2.toString()}`;
              const sign2 = crypto.createHmac('sha256', apiSecret).update(preSign2).digest('base64');
              params2.append('Signature', sign2);
              const balRes = await fetch(`${baseUrl}/v1/account/accounts/${acctId}/balance?${params2.toString()}`, { signal: AbortSignal.timeout(8000) });
              const balData = await balRes.json();
              if (balData.status === 'ok') {
                const agg = {};
                (balData.data?.list || []).forEach(b => {
                  if (!agg[b.currency]) agg[b.currency] = { free: 0, locked: 0 };
                  if (b.type === 'trade') agg[b.currency].free += parseFloat(b.balance);
                  if (b.type === 'frozen') agg[b.currency].locked += parseFloat(b.balance);
                });
                balances = Object.entries(agg).filter(([, v]) => v.free > 0 || v.locked > 0).map(([k, v]) => ({ asset: k.toUpperCase(), free: v.free, locked: v.locked }));
              }
            }
          }
        } catch (err) {
          console.log(`[trade] Portfolio fetch failed (${def?.id || '?'}): ${err.message}`);
        }
      }

      // KAS position value
      const kasBalance = balances.find(b => b.asset === 'KAS');
      const kasPrice = ticker ? parseFloat(ticker.lastPrice) : 0;
      const kasValue = kasBalance ? kasBalance.free * kasPrice : 0;

      // Market data
      // MEXC priceChangePercent is already a percentage when > 1, but sometimes returns decimal (e.g. -0.0615 meaning -6.15%)
      // Detect: if |value| < 1 and openPrice exists, calculate ourselves
      let change24h = parseFloat(ticker.priceChangePercent) || 0;
      if (Math.abs(change24h) < 1 && ticker.openPrice && parseFloat(ticker.openPrice) > 0) {
        change24h = ((parseFloat(ticker.lastPrice) - parseFloat(ticker.openPrice)) / parseFloat(ticker.openPrice)) * 100;
      }
      const market = ticker ? {
        price: parseFloat(ticker.lastPrice),
        change24h: parseFloat(change24h.toFixed(2)),
        high24h: parseFloat(ticker.highPrice),
        low24h: parseFloat(ticker.lowPrice),
        volume24h: parseFloat(ticker.quoteVolume),
      } : null;

      // Kline data for chart
      const chartData = (klines || []).map(k => ({
        t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]),
        l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]),
      }));

      return reply.send({
        exchange: creds?.def?.name || creds?.exchange || 'No exchange',
        balances,
        kasValue: Math.round(kasValue * 100) / 100,
        totalUsd: Math.round((kasValue + (balances.find(b => b.asset === 'USDT')?.free || 0)) * 100) / 100,
        market,
        chart: chartData,
        mode: await getTradeMode(),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/trade/orderbook — replaced by unified version above (near /api/trade/spreads)

  // ── Agent Trading Config ──────────────────────────────────────────────────

  // ── Trade Anchor (usd / kas) ─────────────────────────────────────────────

  fastify.get('/api/trade/anchor', async (request, reply) => {
    const anchor = await getConfig('trade_anchor') || 'usd';
    return reply.send({ anchor });
  });

  fastify.put('/api/trade/set-anchor', async (request, reply) => {
    const { anchor } = request.body || {};
    if (anchor !== 'usd' && anchor !== 'kas') {
      return reply.code(400).send({ error: 'anchor must be "usd" or "kas"' });
    }
    await setConfig('trade_anchor', anchor, { category: 'trade_limits' });
    console.log(`[trading] Anchor set to: ${anchor}`);
    return reply.send({ ok: true, anchor });
  });

  // ── Market Data Aggregation ──────────────────────────────────────────────

  // GET /api/market/all — all market data sources in one call
  fastify.get('/api/market/all', async (request, reply) => {
    const data = await fetchAllMarkets();
    return reply.send(data);
  });

  // GET /api/market/crypto — crypto only
  fastify.get('/api/market/crypto', async (request, reply) => reply.send(await fetchCryptoData()));

  // GET /api/market/stocks — stock indices + tech stocks
  fastify.get('/api/market/stocks', async (request, reply) => reply.send(await fetchStockData()));

  // GET /api/market/prediction — prediction markets (Polymarket)
  fastify.get('/api/market/prediction', async (request, reply) => reply.send(await fetchPredictionData()));

  // GET /api/market/commodities — gold, oil, silver
  fastify.get('/api/market/commodities', async (request, reply) => reply.send(await fetchCommodityData()));

  // GET /api/market/funding — futures funding rates
  fastify.get('/api/market/funding', async (request, reply) => reply.send(await cachedFunding()));

  // GET /api/market/sentiment — fear & greed index
  fastify.get('/api/market/sentiment', async (request, reply) => reply.send(await cachedSentiment()));

  // GET /api/market/crypto-global — CoinGecko total market cap, BTC dominance, volume
  fastify.get('/api/market/crypto-global', async (request, reply) => reply.send(await cachedCryptoGlobal()));

  // GET /api/market/calendar — Forex Factory economic calendar (today + this week)
  fastify.get('/api/market/calendar', async (request, reply) => reply.send(await cachedCalendar()));

  // ── Signal & Strategy API (for Mind consumption) ─────────────────────────

  // GET /api/trade/signals — compute market signals from exchange data
  fastify.get('/api/trade/signals', async (request, reply) => {
    try {
      // Use MEXC public API for signals (no auth needed, standardized format)
      // Other exchanges have different kline/depth formats — MEXC is the reference
      const mexcDef = EXCHANGE_REGISTRY.find(e => e.id === 'mexc');
      const baseUrl = mexcDef?.baseUrl || 'https://api.mexc.com/api/v3';
      const kasPair = 'KASUSDT';

      // Fetch klines (48 × 1h candles) from exchange public API
      let candles = [];
      try {
        const klineUrl = `${baseUrl}/klines?symbol=${kasPair}&interval=60m&limit=48`;
        const res = await fetch(klineUrl, { signal: AbortSignal.timeout(8000) });
        const raw = await res.json();
        if (Array.isArray(raw)) {
          candles = raw.map(k => ({
            time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
            low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
          }));
        }
      } catch (e) {
        console.log(`[signals] kline fetch failed: ${e.message}`);
      }

      // Fetch orderbook
      let orderBook = { bids: [], asks: [] };
      try {
        const obUrl = `${baseUrl}/depth?symbol=${kasPair}&limit=20`;
        const res = await fetch(obUrl, { signal: AbortSignal.timeout(5000) });
        const raw = await res.json();
        orderBook = {
          bids: (raw.bids || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]),
          asks: (raw.asks || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]),
        };
      } catch (e) {
        console.log(`[signals] orderbook fetch failed: ${e.message}`);
      }

      // Fetch whale signal
      let whaleData = { score: 0, direction: 'neutral' };
      try {
        const { computeWhaleSignal } = await import('../services/whale-signal.js');
        whaleData = computeWhaleSignal();
      } catch {}

      const analysis = analyzeMarket(candles, orderBook, whaleData);
      return reply.send(analysis);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/trade/proposal — generate trade proposal based on current signals
  fastify.get('/api/trade/proposal', async (request, reply) => {
    try {
      // Get signals — call analyzeMarket directly (same data as /api/trade/signals)
      const mexcBase = 'https://api.mexc.com/api/v3';
      let candles = [], orderBook = { bids: [], asks: [] }, whaleData = { score: 0, direction: 'neutral' };

      const [klineRes, obRes] = await Promise.all([
        fetch(`${mexcBase}/klines?symbol=KASUSDT&interval=60m&limit=48`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => []),
        fetch(`${mexcBase}/depth?symbol=KASUSDT&limit=20`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => ({})),
      ]);

      if (Array.isArray(klineRes)) {
        candles = klineRes.map(k => ({ high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
      }
      if (obRes.bids) {
        orderBook = {
          bids: obRes.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
          asks: (obRes.asks || []).map(([p, q]) => [parseFloat(p), parseFloat(q)]),
        };
      }

      try { const { computeWhaleSignal } = await import('../services/whale-signal.js'); whaleData = computeWhaleSignal(); } catch {}

      const analysis = analyzeMarket(candles, orderBook, whaleData);
      if (!analysis.actionable) {
        return reply.send({ proposal: null, analysis });
      }

      // Current price from last candle
      const price = candles.length > 0 ? candles[candles.length - 1].close : 0;
      if (!price) return reply.send({ proposal: null, analysis, error: 'price unavailable' });

      // Account state
      const anchor = await getConfig('trade_anchor') || 'usd';
      const dailyLimit = parseFloat(await getConfig('daily_total_max_kas') || '5000');
      const autoMax = parseFloat(await getConfig('auto_mode_max_kas') || '200');
      const autoMaxUsdt = parseFloat(await getConfig('auto_mode_max_usdt') || '20');

      const account = {
        kasBalance: 0, usdtBalance: 0, totalValueKas: 0,
        dailyLimit, dailyUsed: 0, autoModeMax: autoMax, autoModeMaxUsdt: autoMaxUsdt,
      };

      // Try to get real balances from portfolio endpoint
      try {
        const port = process.env.PORT || 3100;
        const balRes = await fetch(`http://localhost:${port}/api/trade/portfolio`, { signal: AbortSignal.timeout(3000) });
        const bal = await balRes.json();
        account.kasBalance = bal.kasBalance || 0;
        account.usdtBalance = bal.usdtBalance || 0;
        account.totalValueKas = account.kasBalance + (account.usdtBalance / price);
      } catch {}

      const proposal = generateProposal(analysis, price, account, { anchor });
      return reply.send({ proposal, analysis, anchor, price });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/trade/config — get trading config for all agents
  fastify.get('/api/trade/config', async (request, reply) => {
    const relays = sqlite.prepare('SELECT id, name, trading_config_json FROM relay_nodes').all();
    const configs = relays.map(r => {
      const defaults = {
        enabled: false,
        baseCurrency: 'USDT',
        capital: 100,
        maxPerTrade: 20,
        maxPositionPct: 30,
        dailyLossLimit: 10,
        strategy: '',
      };
      const saved = r.trading_config_json ? JSON.parse(r.trading_config_json) : {};
      return { id: r.id, name: r.name, ...defaults, ...saved };
    });
    return reply.send(configs);
  });

  // PUT /api/trade/config/:id — save trading config for one agent
  fastify.put('/api/trade/config/:id', async (request, reply) => {
    const { id } = request.params;
    const config = request.body || {};
    const safe = {
      enabled: !!config.enabled,
      baseCurrency: config.baseCurrency === 'KAS' ? 'KAS' : 'USDT',
      capital: Math.max(0, parseFloat(config.capital) || 0),
      maxPerTrade: Math.max(0, parseFloat(config.maxPerTrade) || 0),
      maxPositionPct: Math.min(100, Math.max(0, parseFloat(config.maxPositionPct) || 0)),
      dailyLossLimit: Math.max(0, parseFloat(config.dailyLossLimit) || 0),
      strategy: (config.strategy || '').slice(0, 500),
    };
    sqlite.prepare('UPDATE relay_nodes SET trading_config_json = ? WHERE id = ?')
      .run(JSON.stringify(safe), id);
    return reply.send({ ok: true, ...safe });
  });

  // ── Triggers ──────────────────────────────────────────────────────────────

  fastify.get('/api/trade/triggers', async (request, reply) => {
    return reply.send(getTriggerStatus());
  });

  fastify.put('/api/trade/triggers', async (request, reply) => {
    const result = updateTriggerSettings(request.body || {});
    return reply.send(result);
  });

  fastify.post('/api/trade/trigger/proactive', async (request, reply) => {
    const { agent } = request.body || {};
    const results = await triggerProactive(agent || null);
    return reply.send({ ok: true, results });
  });

  fastify.post('/api/trade/trigger/reflection', async (request, reply) => {
    const { agent } = request.body || {};
    const results = await triggerReflection(agent || null);
    return reply.send({ ok: true, results });
  });

  // ── Agent Advice ──────────────────────────────────────────────────────────

  fastify.post('/api/trade/ask', async (request, reply) => {
    const { relayId, question } = request.body || {};
    if (!relayId || !question?.trim()) {
      return reply.code(400).send({ error: 'relayId and question required' });
    }

    try {
      const aiReply = await getReply(relayId, 'owner:' + relayId, question.trim(), 'trading');
      return reply.send({ ok: true, reply: aiReply || 'No response' });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── Preview Split (smart parameters based on market) ─────────────────────

  // POST /api/trade/preview-split — compute split plan with dynamic parameters
  fastify.post('/api/trade/preview-split', async (request, reply) => {
    const { side, qty, symbol = 'KASUSDT' } = request.body || {};
    if (!side || !qty || !['BUY', 'SELL'].includes(side)) {
      return reply.code(400).send({ error: 'side (BUY/SELL) and qty required' });
    }

    try {
      // Fetch orderbook + 24h ticker in parallel
      const marketBase = 'https://api.mexc.com/api/v3';
      const [depthRes, tickerRes] = await Promise.all([
        fetch(`${marketBase}/depth?symbol=${symbol}&limit=50`).then(r => r.json()),
        fetch(`${marketBase}/ticker/24hr?symbol=${symbol}`).then(r => r.json()).catch(() => null),
      ]);

      const orderbook = {
        bids: (depthRes.bids || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
        asks: (depthRes.asks || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
      };

      // Dynamic parameters based on market conditions
      const changePct = tickerRes ? Math.abs(parseFloat(tickerRes.priceChangePercent || 0)) : 0;
      const levels = side === 'BUY' ? orderbook.asks : orderbook.bids;
      const totalDepth = levels.reduce((s, l) => s + l.qty, 0);
      const depthRatio = totalDepth > 0 ? qty / totalDepth : 1;

      // Aggressive if calm + deep, conservative if volatile + thin
      let maxPctPerLevel, maxSlippagePct, intervalMs;
      if (changePct < 2 && depthRatio < 0.3) {
        // Calm market, deep book → aggressive
        maxPctPerLevel = 0.5; maxSlippagePct = 1.5; intervalMs = 300;
      } else if (changePct > 5 || depthRatio > 0.8) {
        // Volatile or thin book → conservative
        maxPctPerLevel = 0.25; maxSlippagePct = 0.5; intervalMs = 800;
      } else {
        // Balanced
        maxPctPerLevel = 0.4; maxSlippagePct = 1.0; intervalMs = 500;
      }

      // Plan split
      const bestPrice = levels[0]?.price;
      if (!bestPrice) return reply.send({ ok: false, error: 'Empty orderbook' });

      let remaining = qty;
      const orders = [];
      for (const level of levels) {
        if (remaining <= 0) break;
        const slippage = Math.abs(level.price - bestPrice) / bestPrice * 100;
        if (slippage > maxSlippagePct) break;
        let fillQty = Math.min(remaining, level.qty * maxPctPerLevel);
        if (fillQty < 100 && remaining >= 100) fillQty = Math.min(100, remaining);
        else if (fillQty < 100) {
          if (orders.length > 0) { orders[orders.length - 1].qty += remaining; remaining = 0; break; }
          break;
        }
        orders.push({ price: level.price, qty: Math.round(fillQty * 100) / 100 });
        remaining -= fillQty;
      }

      const totalPlanned = orders.reduce((s, o) => s + o.qty, 0);
      const avgPrice = totalPlanned > 0 ? orders.reduce((s, o) => s + o.price * o.qty, 0) / totalPlanned : 0;
      const totalUsdt = orders.reduce((s, o) => s + o.price * o.qty, 0);

      return reply.send({
        ok: true, side, symbol, mode: await getTradeMode(),
        params: { maxPctPerLevel, maxSlippagePct, intervalMs,
          reason: changePct < 2 && depthRatio < 0.3 ? 'calm+deep → aggressive'
            : changePct > 5 || depthRatio > 0.8 ? 'volatile/thin → conservative' : 'balanced',
        },
        market: { changePct: Math.round(changePct * 100) / 100, depthRatio: Math.round(depthRatio * 1000) / 1000, totalDepth: Math.round(totalDepth) },
        summary: {
          orderCount: orders.length,
          totalPlanned: Math.round(totalPlanned * 100) / 100,
          remaining: Math.round(remaining * 100) / 100,
          avgPrice: Math.round(avgPrice * 1e6) / 1e6,
          bestPrice,
          worstPrice: orders.at(-1)?.price || bestPrice,
          totalUsdt: Math.round(totalUsdt * 100) / 100,
        },
        orders,
      });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // ── Order Execution (the "hand") ──────────────────────────────────────────

  // POST /api/trade/order — place a single signed order (all exchanges)
  // Enforces trading limits from agent config (hard gate, not just advice)
  fastify.post('/api/trade/order', async (request, reply) => {
    const { symbol, side, price, qty, relayNodeId, exchange: exchangeParam } = request.body || {};
    if (!symbol || !side || !qty) {
      return reply.code(400).send({ error: 'symbol, side, and qty required' });
    }
    if (!['BUY', 'SELL'].includes(side)) {
      return reply.code(400).send({ error: 'side must be BUY or SELL' });
    }

    // ── Enforce trading limits (only for agent-initiated trades, not owner) ──
    if (relayNodeId) {
      const relay = sqlite.prepare('SELECT name, trading_config_json FROM relay_nodes WHERE id = ?').get(relayNodeId);
      const cfg = relay?.trading_config_json ? JSON.parse(relay.trading_config_json) : {};
      if (cfg.maxPerTrade && qty > cfg.maxPerTrade) {
        return reply.code(400).send({ ok: false, error: `${relay.name}: exceeds maxPerTrade (${qty} > ${cfg.maxPerTrade} KAS)` });
      }
      // Check daily quota
      const today = new Date().toISOString().slice(0, 10);
      const todayVol = sqlite.prepare(
        "SELECT SUM(qty) as vol FROM trade_log WHERE relay_node_id = ? AND source = 'agent' AND created_at > ?"
      ).get(relayNodeId, today + 'T00:00:00.000Z');
      if (cfg.capital && (todayVol.vol || 0) + qty > cfg.capital) {
        return reply.code(400).send({ ok: false, error: `${relay.name}: exceeds daily capital (used ${todayVol.vol || 0} + ${qty} > ${cfg.capital} KAS)` });
      }
    }

    const mode = await getTradeMode();
    if (mode !== 'LIVE') {
      return reply.send({ ok: true, dryRun: true, message: `DRY-RUN: would ${side} ${qty} ${symbol} @ ${price || 'MARKET'}` });
    }

    // 按 exchange 查账户（可选），或用默认账户
    let creds;
    if (exchangeParam) {
      // KI 65 A.5.2: runtime trade filter per MarketMaker-A (库存层).
      const mmaId = getMarketMakerRelayIdOrThrow();
      const row = sqlite.prepare(
        'SELECT * FROM exchange_accounts WHERE exchange = ? AND relay_node_id = ? ORDER BY is_default DESC LIMIT 1'
      ).get(exchangeParam, mmaId);
      if (!row) return reply.code(400).send({ error: `No account configured for exchange: ${exchangeParam}` });
      try {
        const apiKey = decrypt(row.api_key_encrypted);
        const apiSecret = decrypt(row.api_secret_encrypted);
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        const def = EXCHANGE_REGISTRY.find(e => e.id === row.exchange);
        creds = { apiKey, apiSecret, extra, exchange: row.exchange, baseUrl: row.base_url || def?.baseUrl, def, label: row.label, row };
      } catch {
        return reply.code(500).send({ error: `Failed to decrypt credentials for ${exchangeParam}` });
      }
    } else {
      creds = getCredentials();
    }
    if (!creds) return reply.code(400).send({ error: 'No exchange account configured' });

    const result = await placeExchangeOrder({
      authStyle: creds.def?.authStyle, baseUrl: creds.baseUrl || creds.def?.baseUrl,
      headerName: creds.def?.headerName, kasPair: creds.def?.kasPair || symbol,
      apiKey: creds.apiKey, apiSecret: creds.apiSecret, extra: creds.extra,
      symbol, side, price, qty,
    });

    // Record in trade log
    if (result.ok) {
      const source = relayNodeId ? 'agent' : 'owner';
      const agentName = relayNodeId
        ? (sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(relayNodeId)?.name || 'unknown')
        : 'owner';
      sqlite.prepare(`
        INSERT INTO trade_log (id, relay_node_id, agent_name, source, side, symbol, qty, price, cost_usdt, order_id, status, exchange, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), relayNodeId || null, agentName, source,
        side, symbol, qty, price || 0, (qty * (price || 0)),
        result.orderId || null, 'placed', creds.exchange || exchangeParam || null,
        new Date().toISOString()
      );
      // Record chain_event for daily limit tracking
      if (side === 'SELL') {
        recordChainEvent({
          txid: result.orderId || randomUUID(),
          eventType: 'cex_sell_placed',
          observedBy: 'system',
          payload: { exchange: creds.exchange || exchangeParam, qty, price: price || 0, orderId: result.orderId, source, agentName },
        });
      }
    }

    return reply.send({ ...result, dryRun: false });
  });

  // GET /api/trade/open-orders — list current open orders
  fastify.get('/api/trade/open-orders', async (request, reply) => {
    const symbol = request.query.symbol || 'KASUSDT';
    const creds = getCredentials();
    if (!creds) return reply.send([]);

    const data = await getExchangeOpenOrders({
      authStyle: creds.def?.authStyle, baseUrl: creds.baseUrl || creds.def?.baseUrl,
      headerName: creds.def?.headerName, kasPair: creds.def?.kasPair || symbol,
      apiKey: creds.apiKey, apiSecret: creds.apiSecret, extra: creds.extra, symbol,
    });
    return reply.send(Array.isArray(data) ? data : []);
  });

  // DELETE /api/trade/open-orders — cancel all open orders
  fastify.delete('/api/trade/open-orders', async (request, reply) => {
    const symbol = request.query.symbol || 'KASUSDT';
    const creds = getCredentials();
    if (!creds) return reply.code(400).send({ error: 'No exchange account' });

    const result = await cancelExchangeOrders({
      authStyle: creds.def?.authStyle, baseUrl: creds.baseUrl || creds.def?.baseUrl,
      headerName: creds.def?.headerName, kasPair: creds.def?.kasPair || symbol,
      apiKey: creds.apiKey, apiSecret: creds.apiSecret, extra: creds.extra, symbol,
    });
    return reply.send(result);
  });

  // ── Smart Split Execution (server-side, survives page refresh) ──────────

  // POST /api/trade/execute-split — start execution, return execution ID
  fastify.post('/api/trade/execute-split', async (request, reply) => {
    const { side, qty, symbol = 'KASUSDT', maxPctPerLevel = 0.4, maxSlippagePct = 1.0, intervalMs = 500 } = request.body || {};

    if (!side || !qty || !['BUY', 'SELL'].includes(side)) {
      return reply.code(400).send({ error: 'side (BUY/SELL) and qty required' });
    }

    // Owner-initiated execute-split has no limits (owner decides)

    const mode = await getTradeMode();
    const creds = getCredentials();

    if (mode === 'LIVE' && !creds) {
      return reply.code(400).send({ error: 'No exchange account configured' });
    }

    // 1. Fetch fresh orderbook
    let orderbook;
    try {
      const depthRes = await fetch(`https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=50`);
      const depthData = await depthRes.json();
      orderbook = {
        bids: (depthData.bids || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
        asks: (depthData.asks || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
      };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to fetch orderbook: ' + err.message });
    }

    // 2. Plan split
    const levels = side === 'BUY' ? orderbook.asks : orderbook.bids;
    if (!levels?.length) return reply.send({ ok: false, error: 'Empty orderbook' });

    const bestPrice = levels[0].price;
    let remaining = qty;
    const planned = [];
    for (const level of levels) {
      if (remaining <= 0) break;
      const slippage = Math.abs(level.price - bestPrice) / bestPrice * 100;
      if (slippage > maxSlippagePct) break;
      let fillQty = Math.min(remaining, level.qty * maxPctPerLevel);
      if (fillQty < 100 && remaining >= 100) fillQty = Math.min(100, remaining);
      else if (fillQty < 100) {
        if (planned.length > 0) { planned[planned.length - 1].qty += remaining; remaining = 0; break; }
        break;
      }
      planned.push({ price: level.price, qty: Math.round(fillQty * 100) / 100 });
      remaining -= fillQty;
    }
    if (!planned.length) return reply.send({ ok: false, error: 'Cannot plan: insufficient depth' });

    // 3. Create execution record in DB
    const execId = randomUUID();
    const now = new Date().toISOString();
    const params = { maxPctPerLevel, maxSlippagePct, intervalMs };

    sqlite.prepare(`
      INSERT INTO trade_executions (id, side, symbol, total_qty, status, mode, params_json, plan_json, results_json, started_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?, '[]', ?)
    `).run(execId, side, symbol, qty, mode, JSON.stringify(params), JSON.stringify(planned), now);

    // 4. Reply immediately with execution ID
    reply.send({ ok: true, execId, status: 'running', planned: planned.length, mode });

    // 5. Execute in background (server-side, survives page refresh)
    const results = [];
    const t0 = Date.now();
    const credParams = creds ? {
      authStyle: creds.def?.authStyle, baseUrl: creds.baseUrl || creds.def?.baseUrl,
      headerName: creds.def?.headerName, kasPair: creds.def?.kasPair || symbol,
      apiKey: creds.apiKey, apiSecret: creds.apiSecret, extra: creds.extra,
    } : null;

    {
      // ── Place all orders in one pass — Console is the hand, not the brain ──
      for (let i = 0; i < planned.length; i++) {
        const o = planned[i];
        if (mode !== 'LIVE') {
          results.push({ index: i + 1, price: o.price, qty: o.qty, status: 'DRY-RUN', ok: true });
        } else {
          const result = await placeExchangeOrder({ ...credParams, symbol, side, price: o.price, qty: o.qty });
          results.push({ index: i + 1, price: o.price, qty: o.qty, ...result });
          if (!result.ok) {
            sqlite.prepare('UPDATE trade_executions SET status=?, results_json=?, error=?, finished_at=? WHERE id=?')
              .run('failed', JSON.stringify(results), result.error, new Date().toISOString(), execId);
            break;
          }
        }
        sqlite.prepare('UPDATE trade_executions SET results_json=? WHERE id=?').run(JSON.stringify(results), execId);
        if (i < planned.length - 1) await new Promise(r => setTimeout(r, intervalMs + Math.floor(Math.random() * 300)));
      }
    }

    // 6. Finalize
    const succeeded = results.filter(r => r.ok && r.price);
    const totalExecuted = succeeded.reduce((s, r) => s + r.qty, 0);
    const totalCost = succeeded.reduce((s, r) => s + r.price * r.qty, 0);
    const summary = {
      planned: planned.length, executed: succeeded.length,
      failed: results.filter(r => r.ok === false).length,
      totalQty: Math.round(totalExecuted * 100) / 100,
      avgPrice: totalExecuted > 0 ? Math.round(totalCost / totalExecuted * 1e6) / 1e6 : 0,
      totalUsdt: Math.round(totalCost * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      elapsedMs: Date.now() - t0,
    };

    const finalStatus = results.every(r => r.ok !== false) ? 'done' : 'failed';
    sqlite.prepare('UPDATE trade_executions SET status=?, results_json=?, summary_json=?, finished_at=? WHERE id=?')
      .run(finalStatus, JSON.stringify(results), JSON.stringify(summary), new Date().toISOString(), execId);
  });

  // GET /api/trade/execution/:id — poll execution status
  fastify.get('/api/trade/execution/:id', async (request, reply) => {
    const row = sqlite.prepare('SELECT * FROM trade_executions WHERE id = ?').get(request.params.id);
    if (!row) return reply.code(404).send({ error: 'Execution not found' });

    return reply.send({
      id: row.id, side: row.side, symbol: row.symbol, totalQty: row.total_qty,
      status: row.status, mode: row.mode,
      params: row.params_json ? JSON.parse(row.params_json) : null,
      plan: row.plan_json ? JSON.parse(row.plan_json) : [],
      results: row.results_json ? JSON.parse(row.results_json) : [],
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      startedAt: row.started_at, finishedAt: row.finished_at, error: row.error,
    });
  });

  // GET /api/trade/executions — recent execution history
  fastify.get('/api/trade/executions', async (request, reply) => {
    const rows = sqlite.prepare('SELECT id, side, symbol, total_qty, status, mode, summary_json, started_at, finished_at, error FROM trade_executions ORDER BY started_at DESC LIMIT 20').all();
    return reply.send(rows.map(r => ({
      id: r.id, side: r.side, symbol: r.symbol, totalQty: r.total_qty,
      status: r.status, mode: r.mode,
      summary: r.summary_json ? JSON.parse(r.summary_json) : null,
      startedAt: r.started_at, finishedAt: r.finished_at, error: r.error,
    })));
  });

  // ── Atomic operations for Agent (query single order, cancel single order) ──

  // GET /api/trade/order/:orderId — check single order status (all exchanges)
  fastify.get('/api/trade/order/:orderId', async (request, reply) => {
    const { orderId } = request.params;
    const { exchange: exchangeParam } = request.query;

    let creds;
    if (exchangeParam) {
      // KI 65 A.5.2: runtime trade filter per MarketMaker-A (库存层).
      const mmaId = getMarketMakerRelayIdOrThrow();
      const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ? AND relay_node_id = ? ORDER BY is_default DESC LIMIT 1').get(exchangeParam, mmaId);
      if (!row) return reply.code(400).send({ error: `No account for exchange: ${exchangeParam}` });
      try {
        const apiKey = decrypt(row.api_key_encrypted);
        const apiSecret = decrypt(row.api_secret_encrypted);
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        creds = { exchange: row.exchange, apiKey, apiSecret, passphrase: extra.passphrase, baseUrl: row.base_url };
      } catch { return reply.code(500).send({ error: 'Decrypt failed' }); }
    } else {
      const def = getCredentials();
      if (!def) return reply.code(400).send({ error: 'No exchange account' });
      creds = { exchange: def.exchange, apiKey: def.apiKey, apiSecret: def.apiSecret, passphrase: def.extra?.passphrase, baseUrl: def.baseUrl || def.def?.baseUrl };
    }

    const result = await getExchangeOrder(creds, orderId);
    return reply.send(result);
  });

  // DELETE /api/trade/order/:orderId — cancel single order (all exchanges)
  fastify.delete('/api/trade/order/:orderId', async (request, reply) => {
    const { orderId } = request.params;
    const { exchange: exchangeParam, symbol: symbolParam } = request.query;

    let creds;
    if (exchangeParam) {
      // KI 65 A.5.2: runtime trade filter per MarketMaker-A (库存层).
      const mmaId = getMarketMakerRelayIdOrThrow();
      const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ? AND relay_node_id = ? ORDER BY is_default DESC LIMIT 1').get(exchangeParam, mmaId);
      if (!row) return reply.code(400).send({ error: `No account for exchange: ${exchangeParam}` });
      try {
        const apiKey = decrypt(row.api_key_encrypted);
        const apiSecret = decrypt(row.api_secret_encrypted);
        const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
        creds = { exchange: row.exchange, apiKey, apiSecret, passphrase: extra.passphrase, baseUrl: row.base_url };
      } catch { return reply.code(500).send({ error: 'Decrypt failed' }); }
    } else {
      const def = getCredentials();
      if (!def) return reply.code(400).send({ error: 'No exchange account' });
      creds = { exchange: def.exchange, apiKey: def.apiKey, apiSecret: def.apiSecret, passphrase: def.extra?.passphrase, baseUrl: def.baseUrl || def.def?.baseUrl };
    }

    const result = await cancelExchangeOrder(creds, orderId, symbolParam || 'KAS/USDT');
    return reply.send(result);
  });

  // ── Daily Usage & Limits ────────────────────────────────────────────────

  // Initialize default daily limit if not set
  getConfig('daily_kas_sell_limit').then(v => {
    if (!v) setConfig('daily_kas_sell_limit', '10000', 'trade_limits');
  });

  // GET /api/trade/daily-usage — total daily sell volume vs single limit
  fastify.get('/api/trade/daily-usage', async (request, reply) => {
    const date = request.query.date || new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const limitKas = parseInt(await getConfig('daily_kas_sell_limit') || '10000');

    // Primary source: cex_sell_placed chain_events (written by POST /api/trade/order)
    const rows = sqlite.prepare(`
      SELECT json_extract(payload, '$.exchange') as exchange,
             CAST(json_extract(payload, '$.qty') AS REAL) as qty
      FROM chain_events
      WHERE event_type = 'cex_sell_placed'
        AND observed_at >= ? AND observed_at < ?
    `).all(dayStart, dayEnd);

    // Supplement: hedge_placed SELL (may bypass /api/trade/order)
    const hedgeRows = sqlite.prepare(`
      SELECT json_extract(payload, '$.exchange') as exchange,
             CAST(json_extract(payload, '$.qty') AS REAL) as qty
      FROM chain_events
      WHERE event_type = 'hedge_placed'
        AND json_extract(payload, '$.side') = 'SELL'
        AND observed_at >= ? AND observed_at < ?
    `).all(dayStart, dayEnd);

    // Aggregate by exchange
    const byExchange = {};
    for (const r of [...rows, ...hedgeRows]) {
      if (r.exchange) byExchange[r.exchange] = (byExchange[r.exchange] || 0) + (r.qty || 0);
    }

    // Per-exchange breakdown (diagnostic, not control)
    const accounts = sqlite.prepare(
      'SELECT exchange, label FROM exchange_accounts ORDER BY is_default DESC'
    ).all();
    const exchanges = accounts.map(a => {
      const sold = Math.round(byExchange[a.exchange] || 0);
      const def = EXCHANGE_REGISTRY.find(e => e.id === a.exchange);
      return {
        exchange: a.exchange,
        label: a.label || def?.name || a.exchange.toUpperCase(),
        sold_kas: sold,
      };
    });

    const totalSold = exchanges.reduce((s, e) => s + e.sold_kas, 0);
    const pctUsed = limitKas > 0 ? Math.min(100, Math.round((totalSold / limitKas) * 100)) : 0;

    // Per-exchange pct (relative to total limit, for UI bar sizing)
    for (const e of exchanges) {
      e.pct_used = limitKas > 0 ? Math.min(100, Math.round((e.sold_kas / limitKas) * 100)) : 0;
    }

    return reply.send({
      date,
      exchanges,
      total: {
        sold_kas: totalSold,
        limit_kas: limitKas,
        remaining_kas: Math.max(0, limitKas - totalSold),
        pct_used: pctUsed,
      },
    });
  });

  // PUT /api/trade/daily-limit — edit daily sell limit
  fastify.put('/api/trade/daily-limit', async (request, reply) => {
    const { limit_kas } = request.body || {};
    if (!limit_kas || isNaN(limit_kas) || limit_kas < 100) {
      return reply.code(400).send({ error: 'limit_kas must be a number >= 100' });
    }
    await setConfig('daily_kas_sell_limit', String(Math.floor(limit_kas)), 'trade_limits');
    return reply.send({ ok: true, limit_kas: Math.floor(limit_kas) });
  });

  // ── Trade Log & Performance ───────────────────────────────────────────────

  // GET /api/trade/log — trade history (all agents or specific)
  fastify.get('/api/trade/log', async (request, reply) => {
    const { agent, days = 7, limit = 100 } = request.query;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let rows;
    if (agent) {
      rows = sqlite.prepare('SELECT * FROM trade_log WHERE agent_name = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?')
        .all(agent, since, parseInt(limit));
    } else {
      rows = sqlite.prepare('SELECT * FROM trade_log WHERE created_at > ? ORDER BY created_at DESC LIMIT ?')
        .all(since, parseInt(limit));
    }
    return reply.send(rows);
  });

  // GET /api/trade/performance — P&L summary per agent
  fastify.get('/api/trade/performance', async (request, reply) => {
    const { days = 1 } = request.query;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const agents = sqlite.prepare('SELECT DISTINCT agent_name FROM trade_log WHERE created_at > ?').all(since);
    const results = [];

    for (const { agent_name } of agents) {
      const buys = sqlite.prepare(
        'SELECT SUM(qty) as totalQty, SUM(cost_usdt) as totalCost FROM trade_log WHERE agent_name = ? AND side = ? AND created_at > ?'
      ).get(agent_name, 'BUY', since);
      const sells = sqlite.prepare(
        'SELECT SUM(qty) as totalQty, SUM(cost_usdt) as totalCost FROM trade_log WHERE agent_name = ? AND side = ? AND created_at > ?'
      ).get(agent_name, 'SELL', since);

      const buyQty = buys.totalQty || 0;
      const buyCost = buys.totalCost || 0;
      const sellQty = sells.totalQty || 0;
      const sellRevenue = sells.totalCost || 0;
      const avgBuyPrice = buyQty > 0 ? buyCost / buyQty : 0;
      const avgSellPrice = sellQty > 0 ? sellRevenue / sellQty : 0;

      // Net KAS change (bought - sold)
      const netKas = buyQty - sellQty;
      // Net USDT change (sold revenue - buy cost)
      const netUsdt = sellRevenue - buyCost;
      // Trade count
      const tradeCount = sqlite.prepare(
        'SELECT count(*) as cnt FROM trade_log WHERE agent_name = ? AND created_at > ?'
      ).get(agent_name, since).cnt;

      results.push({
        agent: agent_name,
        period: `${days}d`,
        trades: tradeCount,
        bought: { qty: Math.round(buyQty * 100) / 100, usdt: Math.round(buyCost * 100) / 100, avgPrice: Math.round(avgBuyPrice * 1e6) / 1e6 },
        sold: { qty: Math.round(sellQty * 100) / 100, usdt: Math.round(sellRevenue * 100) / 100, avgPrice: Math.round(avgSellPrice * 1e6) / 1e6 },
        net: { kas: Math.round(netKas * 100) / 100, usdt: Math.round(netUsdt * 100) / 100 },
      });
    }

    return reply.send(results);
  });

  // GET /api/trade/quota/:relayNodeId — remaining daily quota for an agent
  fastify.get('/api/trade/quota/:relayNodeId', async (request, reply) => {
    const { relayNodeId } = request.params;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const relay = sqlite.prepare('SELECT name, trading_config_json FROM relay_nodes WHERE id = ?').get(relayNodeId);
    if (!relay) return reply.code(404).send({ error: 'Agent not found' });

    const cfg = relay.trading_config_json ? JSON.parse(relay.trading_config_json) : {};

    // Today's trading volume
    const todayTrades = sqlite.prepare(
      "SELECT SUM(qty) as totalQty, SUM(cost_usdt) as totalCost, count(*) as cnt FROM trade_log WHERE relay_node_id = ? AND source = 'agent' AND created_at > ?"
    ).get(relayNodeId, today + 'T00:00:00.000Z');

    const usedQty = todayTrades.totalQty || 0;
    const usedUsdt = todayTrades.totalCost || 0;
    const tradeCount = todayTrades.cnt || 0;

    // Calculate remaining
    const capitalLimit = cfg.capital || Infinity;
    const dailyLossLimit = cfg.dailyLossLimit || Infinity;
    const maxPerTrade = cfg.maxPerTrade || Infinity;

    // P&L today (simplified: sell revenue - buy cost)
    const todayBuys = sqlite.prepare(
      "SELECT SUM(cost_usdt) as cost FROM trade_log WHERE relay_node_id = ? AND source = 'agent' AND side = 'BUY' AND created_at > ?"
    ).get(relayNodeId, today + 'T00:00:00.000Z');
    const todaySells = sqlite.prepare(
      "SELECT SUM(cost_usdt) as revenue FROM trade_log WHERE relay_node_id = ? AND source = 'agent' AND side = 'SELL' AND created_at > ?"
    ).get(relayNodeId, today + 'T00:00:00.000Z');
    const dailyPnl = (todaySells.revenue || 0) - (todayBuys.cost || 0);

    return reply.send({
      agent: relay.name,
      relayNodeId,
      today: {
        trades: tradeCount,
        volumeKas: Math.round(usedQty * 100) / 100,
        volumeUsdt: Math.round(usedUsdt * 100) / 100,
        pnlUsdt: Math.round(dailyPnl * 100) / 100,
      },
      limits: {
        capital: capitalLimit === Infinity ? null : capitalLimit,
        maxPerTrade: maxPerTrade === Infinity ? null : maxPerTrade,
        dailyLossLimit: dailyLossLimit === Infinity ? null : dailyLossLimit,
      },
      remaining: {
        capitalLeft: capitalLimit === Infinity ? null : Math.max(0, capitalLimit - usedQty),
        canTrade: dailyLossLimit === Infinity || Math.abs(dailyPnl) < dailyLossLimit,
        reason: Math.abs(dailyPnl) >= dailyLossLimit ? 'Daily loss limit reached' : null,
      },
      enabled: !!cfg.enabled,
    });
  });

  // ── Baseline Tracking & Risk Control ──────────────────────────────────────

  /** Fetch current KAS price from MEXC */
  async function getCurrentKasPrice() {
    try {
      const res = await fetch('https://api.mexc.com/api/v3/ticker/price?symbol=KASUSDT');
      const data = await res.json();
      return parseFloat(data.price);
    } catch { return null; }
  }

  /** Calculate equivalent KAS for given holdings at given price */
  function calcEquivalentKas(kas, usdt, kasPrice) {
    return kas + (kasPrice > 0 ? usdt / kasPrice : 0);
  }

  // POST /api/trade/baseline — create a new baseline
  fastify.post('/api/trade/baseline', async (request, reply) => {
    const { relayNodeId, initialKas = 0, initialUsdt = 0, lossLimitPct = 10, hardStopPct = 20, note } = request.body || {};

    const kasPrice = await getCurrentKasPrice();
    if (!kasPrice) return reply.code(500).send({ error: 'Cannot fetch KAS price' });

    // If no relayNodeId, create for all agents
    const relays = relayNodeId
      ? [sqlite.prepare('SELECT id, name FROM relay_nodes WHERE id = ?').get(relayNodeId)].filter(Boolean)
      : sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address IS NOT NULL').all();

    if (!relays.length) return reply.code(404).send({ error: 'No agents found' });

    const now = new Date().toISOString();
    const results = [];

    for (const relay of relays) {
      // Use agent's allocated capital from trading config, not whole account
      const cfg = sqlite.prepare('SELECT trading_config_json FROM relay_nodes WHERE id = ?').get(relay.id);
      const tradingCfg = cfg?.trading_config_json ? JSON.parse(cfg.trading_config_json) : {};
      const agentCapital = tradingCfg.capital || 0;
      const baseCurrency = tradingCfg.baseCurrency || 'KAS';

      // Agent's allocated portion
      let kas = initialKas, usdt = initialUsdt;
      if (kas === 0 && usdt === 0) {
        // Auto-fill: convert agent's capital to current holdings
        // If baseCurrency is KAS, capital is in KAS units → convert to equivalent USDT at current price
        if (baseCurrency === 'KAS') {
          kas = 0;  // agents start with 0 KAS (reality: all sold)
          usdt = agentCapital * kasPrice;  // their budget in USDT
        } else {
          kas = 0;
          usdt = agentCapital;
        }
      }

      const equivalentKas = calcEquivalentKas(kas, usdt, kasPrice);

      const id = randomUUID();
      // Deactivate previous active baseline for this agent
      sqlite.prepare("UPDATE trade_baselines SET status = 'superseded' WHERE relay_node_id = ? AND status = 'active'")
        .run(relay.id);

      sqlite.prepare(`
        INSERT INTO trade_baselines (id, relay_node_id, agent_name, initial_kas, initial_usdt, initial_kas_price, equivalent_kas, loss_limit_pct, hard_stop_pct, created_at, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, relay.id, relay.name, kas, usdt, kasPrice, equivalentKas, lossLimitPct, hardStopPct, now, note || null);

      results.push({ id, agent: relay.name, capital: agentCapital, baseCurrency, equivalentKas: Math.round(equivalentKas), kasPrice });
    }

    return reply.send({ ok: true, baselines: results });
  });

  // GET /api/trade/baseline — get active baselines with real-time evaluation
  fastify.get('/api/trade/baseline', async (request, reply) => {
    const baselines = sqlite.prepare("SELECT * FROM trade_baselines WHERE status = 'active' ORDER BY created_at DESC").all();
    if (!baselines.length) return reply.send([]);

    const kasPrice = await getCurrentKasPrice();

    const results = baselines.map(b => {
      // Calculate agent's current holdings from trade_log since baseline
      const buys = sqlite.prepare(
        "SELECT SUM(qty) as kas, SUM(cost_usdt) as usdt FROM trade_log WHERE relay_node_id = ? AND side = 'BUY' AND created_at >= ?"
      ).get(b.relay_node_id, b.created_at);
      const sells = sqlite.prepare(
        "SELECT SUM(qty) as kas, SUM(cost_usdt) as usdt FROM trade_log WHERE relay_node_id = ? AND side = 'SELL' AND created_at >= ?"
      ).get(b.relay_node_id, b.created_at);

      // Current = initial + bought - sold (KAS), initial - bought_cost + sold_revenue (USDT)
      const currentKas = b.initial_kas + (buys.kas || 0) - (sells.kas || 0);
      const currentUsdt = b.initial_usdt - (buys.usdt || 0) + (sells.usdt || 0);
      const currentEquivalent = kasPrice ? calcEquivalentKas(currentKas, currentUsdt, kasPrice) : null;

      const pnlKas = currentEquivalent !== null ? currentEquivalent - b.equivalent_kas : null;
      const pnlPct = b.equivalent_kas > 0 && pnlKas !== null ? (pnlKas / b.equivalent_kas * 100) : null;
      const lossAlert = pnlPct !== null && pnlPct < -b.loss_limit_pct;
      const hardStop = pnlPct !== null && pnlPct < -b.hard_stop_pct;

      return {
        id: b.id,
        agent: b.agent_name,
        relayNodeId: b.relay_node_id,
        baseline: {
          kas: b.initial_kas, usdt: b.initial_usdt,
          kasPrice: b.initial_kas_price,
          equivalentKas: Math.round(b.equivalent_kas),
          createdAt: b.created_at, note: b.note,
        },
        current: {
          kas: Math.round(currentKas * 100) / 100,
          usdt: Math.round(currentUsdt * 100) / 100,
          kasPrice,
          equivalentKas: currentEquivalent !== null ? Math.round(currentEquivalent) : null,
        },
        pnl: {
          kas: pnlKas !== null ? Math.round(pnlKas) : null,
          pct: pnlPct !== null ? Math.round(pnlPct * 100) / 100 : null,
        },
        risk: {
          lossLimitPct: b.loss_limit_pct, hardStopPct: b.hard_stop_pct,
          lossAlert, hardStop,
          status: hardStop ? 'STOP' : lossAlert ? 'WARNING' : 'OK',
        },
      };
    });

    return reply.send(results);
  });

  // POST /api/trade/baseline/:id/settle — settle (close) a baseline
  fastify.post('/api/trade/baseline/:id/settle', async (request, reply) => {
    const b = sqlite.prepare("SELECT * FROM trade_baselines WHERE id = ? AND status = 'active'").get(request.params.id);
    if (!b) return reply.code(404).send({ error: 'Active baseline not found' });

    const kasPrice = await getCurrentKasPrice();
    let currentKas = 0, currentUsdt = 0;
    const creds = getCredentials();
    if (creds?.def?.authStyle === 'binance-like') {
      try {
        const params = `timestamp=${Date.now()}`;
        const signature = hmacSign(params, creds.apiSecret);
        const res = await fetch(`${creds.baseUrl || creds.def.baseUrl}/account?${params}&signature=${signature}`, {
          headers: { [creds.def.headerName]: creds.apiKey },
        });
        const account = await res.json();
        const balances = account.balances || [];
        currentKas = parseFloat(balances.find(b => b.asset === 'KAS')?.free || 0);
        currentUsdt = parseFloat(balances.find(b => b.asset === 'USDT')?.free || 0);
      } catch {}
    }

    const settledEquivalent = kasPrice ? calcEquivalentKas(currentKas, currentUsdt, kasPrice) : b.equivalent_kas;
    const pnl = settledEquivalent - b.equivalent_kas;

    sqlite.prepare("UPDATE trade_baselines SET status = 'settled', settled_at = ?, settled_equivalent = ?, settled_pnl_kas = ? WHERE id = ?")
      .run(new Date().toISOString(), settledEquivalent, pnl, b.id);

    return reply.send({
      ok: true, agent: b.agent_name,
      baseline: Math.round(b.equivalent_kas),
      settled: Math.round(settledEquivalent),
      pnlKas: Math.round(pnl),
      pnlPct: Math.round(pnl / b.equivalent_kas * 10000) / 100,
    });
  });

  // ── Market Maker Orders & Quotes ────────────────────────────────────────

  // GET /api/trade/wallet-address — get agent wallet address for a chain
  fastify.get('/api/trade/wallet-address', async (request, reply) => {
    const { relay_node_id, chain } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const wallet = sqlite.prepare(
      'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
    ).get(relay_node_id, chain || 'bnb');
    return reply.send({ address: wallet?.address || null });
  });

  // GET /api/trade/fund-locks — query locked balances for an agent
  fastify.get('/api/trade/fund-locks', async (request, reply) => {
    const { relay_node_id } = request.query;
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay) return reply.send({ locks: [], totals: {} });

    const { getActiveLocks, getLockedTotal } = await import('../services/fund-lock.js');
    const locks = getActiveLocks(relay.address);
    // Aggregate by asset
    const totals = {};
    for (const l of locks) {
      totals[l.asset] = (totals[l.asset] || 0) + l.amount;
    }
    return reply.send({ locks, totals });
  });

  // GET /api/trade/order-executions — execution_states log for an order
  fastify.get('/api/trade/order-executions', async (request, reply) => {
    const orderId = request.query.order_id || request.query.orderId; // 兼容两种参数名
    if (!orderId) return reply.code(400).send({ error: 'order_id required' });
    const { getOrderExecutions } = await import('../services/execution-state.js');
    return reply.send(getOrderExecutions(orderId));
  });

  // GET /api/trade/pending-approvals — pending execution_states for owner to review
  fastify.get('/api/trade/pending-approvals', async (request, reply) => {
    const { agent_address } = request.query;
    const { getPendingExecutions } = await import('../services/execution-state.js');
    if (!agent_address) {
      // Return all pending
      const rows = sqlite.prepare(
        "SELECT * FROM execution_states WHERE status = 'pending' ORDER BY created_at DESC"
      ).all();
      return reply.send(rows.map(_parseExecutionRow));
    }
    return reply.send(getPendingExecutions(agent_address).map(_parseExecutionRow));
  });

  // POST /api/trade/approve-execution/:id — owner approves a pending execution
  fastify.post('/api/trade/approve-execution/:id', async (request, reply) => {
    const { approveExecution, startExecution, getExecution } = await import('../services/execution-state.js');
    const exec = getExecution(request.params.id);
    if (!exec) return reply.code(404).send({ error: 'Execution not found' });
    if (exec.status !== 'pending') return reply.code(400).send({ error: `Cannot approve: status is ${exec.status}` });

    approveExecution(exec.id);
    startExecution(exec.id);

    // NWT N14.5 Phase β Step 2 sub#3a (5/18): /api/trade/mm-orders/* 真删, OTC execution 审批后无 execute path.
    // execution_states 是 OTC-only state, Phase α 后 0 production caller. 历史 pending exec 走 fail-close.
    if (exec.order_id && exec.type) {
      setTimeout(async () => {
        try {
          const { failExecution: fe } = await import('../services/execution-state.js');
          fe(exec.id, 'OTC deprecated 2026-05-18 — execution path removed (Phase β Step 2 sub#3a)');
          console.log(`[approve] ${exec.type} fail-close (OTC deprecated)`);
        } catch (err) {
          console.warn(`[approve] fail-close err: ${err.message}`);
        }
      }, 500);
    }

    return reply.send({ ok: true, status: 'executing', executionId: exec.id });
  });

  // POST /api/trade/reject-execution/:id — owner rejects a pending execution
  fastify.post('/api/trade/reject-execution/:id', async (request, reply) => {
    const { rejectExecution, getExecution } = await import('../services/execution-state.js');
    const exec = getExecution(request.params.id);
    if (!exec) return reply.code(404).send({ error: 'Execution not found' });
    if (exec.status !== 'pending') return reply.code(400).send({ error: `Cannot reject: status is ${exec.status}` });

    const { reason } = request.body || {};
    rejectExecution(exec.id, reason || 'Owner rejected');
    return reply.send({ ok: true, status: 'rejected' });
  });

  // NWT N14.5 Phase β Step 2 sub#3a (5/18 Owner 钦定 "OTC 融入 Exchange 不要停"):
  // /api/trade/mm-orders/* (5 routes) + /api/trade/mm-quotes (2 routes) 真删 (Phase α 410 兜底 0 production caller, chain_event protocol_deprecated_use audit 5h 仅 NWT 测试 1 row).
  // mm_orders/mm_quotes table 仍存 (v120 DROP 排 Step 4 ship 后). 7 route 撤完, mm-orders/* path 全 404.

  // ── Preflight check for proactive trade actions ──
  // Called by Mind before executing PLACE_ORDER / SEND_KAS in proactive mode.
  // Three layers: mode → limits → cooldown.
  fastify.post('/api/trade/preflight', async (request, reply) => {
    const { agentId, action, amount, side, market } = request.body || {};
    if (!agentId || !action) return reply.code(400).send({ denied: true, reason: 'missing_params' });

    const kasAmount = parseFloat(amount) || 0;

    // ── Layer 1: Mode check ──
    const modeRow = sqlite.prepare("SELECT value_encrypted FROM config_entries WHERE key = 'agent_trade_mode'").get();
    const mode = modeRow?.value_encrypted || 'manual';

    if (mode === 'manual') {
      return reply.send({ denied: true, reason: 'manual_mode' });
    }

    // ── Layer 2: Limit check (reuse existing checkLimits) ──
    const agent = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(agentId);
    if (!agent) return reply.send({ denied: true, reason: 'agent_not_found' });

    // Also check per-agent trading_config limits
    const agentConfig = sqlite.prepare('SELECT trading_config_json FROM relay_nodes WHERE id = ?').get(agentId);
    let perAgentLimits = null;
    try { perAgentLimits = JSON.parse(agentConfig?.trading_config_json || 'null'); } catch {}

    if (perAgentLimits) {
      if (!perAgentLimits.enabled) return reply.send({ denied: true, reason: 'trading_disabled_for_agent' });
      if (kasAmount > (perAgentLimits.maxPerTrade || Infinity)) {
        return reply.send({ denied: true, reason: 'single_limit', detail: { max: perAgentLimits.maxPerTrade, requested: kasAmount } });
      }
    }

    // Global limits (from trade-limits.js, imported at top)
    const { checkLimits: checkGlobalLimits } = await import('../services/trade-limits.js');
    const limitResult = checkGlobalLimits(agent.address, kasAmount, 0, mode);
    if (!limitResult.ok) {
      return reply.send({ denied: true, reason: limitResult.error, detail: limitResult.detail });
    }

    // ── Layer 3: Cooldown (30 min between proactive trades) ──
    const lastExec = sqlite.prepare(`
      SELECT created_at FROM execution_states
      WHERE agent_address = ? AND type IN ('PLACE_ORDER', 'publish_order', 'SEND_KAS', 'send_kas')
      ORDER BY created_at DESC LIMIT 1
    `).get(agent.address);

    if (lastExec) {
      const elapsed = Date.now() - new Date(lastExec.created_at).getTime();
      const cooldownMs = 30 * 60 * 1000; // 30 minutes
      if (elapsed < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        return reply.send({ denied: true, reason: 'cooldown', detail: { remainingSec } });
      }
    }

    // ── Approval mode: create pending execution ──
    // NOTE: status 'pending' (not 'pending_approval') — 与 createExecution 统一.
    // API 查询 + approve/reject endpoint 全部按 'pending' 检查, 之前写
    // 'pending_approval' 产生 31 条孤岛 10-24 天无人处理 (opencode 发现).
    if (mode === 'approval') {
      const execId = randomUUID();
      const now = nowIso();
      sqlite.prepare(`
        INSERT INTO execution_states (id, agent_address, type, source, status, display_summary, action_details, created_at, updated_at)
        VALUES (?, ?, ?, 'agent', 'pending', ?, ?, ?, ?)
      `).run(execId, agent.address, action, `${action} ${kasAmount} KAS ${side || ''} → ${market || 'exchange'}`, JSON.stringify({ amount: kasAmount, side, market }), now, now);
      return reply.send({ pending: true, executionId: execId, summary: `${action} ${kasAmount} KAS ${side || ''} → ${market || 'exchange'}` });
    }

    // ── Auto mode: all checks passed ──
    return reply.send({ allowed: true });
  });

}
