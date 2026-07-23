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
  const row = sqlite.prepare(
    'SELECT * FROM exchange_accounts WHERE is_default = 1 LIMIT 1'
  ).get() || sqlite.prepare(
    'SELECT * FROM exchange_accounts LIMIT 1'
  ).get();

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

export async function registerTradingRoutes(fastify) {

  // GET /api/trade/kas-price — current KAS/USDT price (backend proxy, no CORS)
  fastify.get('/api/trade/kas-price', async (request, reply) => {
    try {
      const res = await fetch('https://api.mexc.com/api/v3/ticker/price?symbol=KASUSDT', { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      return reply.send({ price: parseFloat(data.price), source: 'mexc' });
    } catch {
      return reply.send({ price: 0, source: 'unavailable' });
    }
  });

  // GET /trading — render trading page (legacy, preserved)
  fastify.get('/trading', async (request, reply) => {
    const relays = sqlite.prepare('SELECT id, name, address FROM relay_nodes').all();
    const creds = getCredentials();
    return reply.viewAsync('trading.eta', {
      title: 'Trading',
      relays,
      configured: !!creds,
      mode: await getTradeMode(),
      exchangeRegistry: JSON.stringify(EXCHANGE_REGISTRY),
    });
  });

  // GET /trading-v2 — retired (Gap 3 dedup, Bettor r36 GO).
  // /trading-v2 (stub 151L) → 302 /trading (canonical 2914L). trading-v2.eta fossil retained.
  fastify.get('/trading-v2', async (request, reply) => {
    return reply.redirect(302, '/trading');
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

  // GET /market-v2 — retired (Gap 3 dedup, Bettor r36 GO).
  // /market-v2 (442L) → 302 /market (canonical 1045L). market-v2.eta fossil retained.
  fastify.get('/market-v2', async (request, reply) => {
    return reply.redirect(302, '/market');
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
      const row = sqlite.prepare(
        'SELECT * FROM exchange_accounts WHERE exchange = ? ORDER BY is_default DESC LIMIT 1'
      ).get(exchangeParam);
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
      const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ? ORDER BY is_default DESC LIMIT 1').get(exchangeParam);
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
      const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ? ORDER BY is_default DESC LIMIT 1').get(exchangeParam);
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
      // 🔴 修复(2026-07-12, NWT 红队 G1, 用户反馈通道设计审出): 非交易 type(如 user_feedback)不该出现在
      //   Owner 的"待批交易"审批视图——裸查询漏 type 过滤会让反馈工单跟真实交易审批行混在一起, Owner 若
      //   误点批准会把反馈工单强推进 money-flow 状态机(approved/executing, 反馈工单不该有这两态)。
      //   排除表 = 已知非交易类 type 的白名单反面(新增非交易 type 需同步加入, 同 R-FEE-LEAVES-BYPASS 类
      //   手工配对家族——本卡先堵住已知的一个, 若未来再加别的非交易 type 复发同坑再补规则)。
      const NON_TRADE_TYPES = ['user_feedback'];
      const placeholders = NON_TRADE_TYPES.map(() => '?').join(',');
      const rows = sqlite.prepare(
        `SELECT * FROM execution_states WHERE status = 'pending' AND type NOT IN (${placeholders}) ORDER BY created_at DESC`
      ).all(...NON_TRADE_TYPES);
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

    // 审批通过后实际执行操作（异步，不阻塞返回）
    if (exec.order_id && exec.type) {
      const port = process.env.PORT || 3100;
      setTimeout(async () => {
        try {
          const res = await fetch(`http://localhost:${port}/api/trade/mm-orders/${exec.order_id}/action`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: exec.type }),
          });
          const data = await res.json();
          const { completeExecution: ce, failExecution: fe } = await import('../services/execution-state.js');
          if (data.ok) {
            ce(exec.id, { outputTxid: data.txHash || data.txId || null });
            console.log(`[approve] ${exec.type} executed OK`);
          } else {
            fe(exec.id, data.error || 'execution failed');
            console.log(`[approve] ${exec.type} failed: ${data.error}`);
          }
        } catch (err) {
          const { failExecution: fe } = await import('../services/execution-state.js');
          fe(exec.id, err.message);
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

  // GET /api/trade/mm-orders — query MM orders (supports status/relay_node_id filter)
  fastify.get('/api/trade/mm-orders', async (request, reply) => {
    const { status, relay_node_id, limit = 50, offset = 0, broadcast_txid } = request.query;

    // Quick lookup by chain anchor
    if (broadcast_txid) {
      const order = sqlite.prepare('SELECT * FROM mm_orders WHERE broadcast_txid = ?').get(broadcast_txid);
      return reply.send(order ? [order] : []);
    }

    let sql = 'SELECT * FROM mm_orders WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM mm_orders WHERE 1=1';
    const params = [];
    const countParams = [];

    if (status) {
      if (status === 'active') {
        sql += " AND status NOT IN ('completed','cancelled','expired','resolved')";
        countSql += " AND status NOT IN ('completed','cancelled','expired','resolved')";
      } else {
        sql += ' AND status = ?'; params.push(status);
        countSql += ' AND status = ?'; countParams.push(status);
      }
    }
    if (relay_node_id) {
      sql += ' AND relay_node_id = ?'; params.push(relay_node_id);
      countSql += ' AND relay_node_id = ?'; countParams.push(relay_node_id);
    }

    const total = sqlite.prepare(countSql).get(...countParams)?.total || 0;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(limit), 200), parseInt(offset));

    const rows = sqlite.prepare(sql).all(...params);
    // 附带对手方的 EVM 钱包地址（买方需要知道卖方的 USDT 收款地址）
    for (const row of rows) {
      if (row.counterparty_order_id && !row.mm_receive_address) {
        const counter = sqlite.prepare('SELECT mm_receive_address, agent_address FROM mm_orders WHERE id = ?').get(row.counterparty_order_id);
        if (counter?.mm_receive_address) row.counterparty_wallet = counter.mm_receive_address;
      }
    }
    // 向后兼容：旧版 trading.eta 期望数组，新版 market.eta 用 page 参数获取分页元数据
    if (request.query.page) {
      return reply.send({ orders: rows, total, limit: parseInt(limit), offset: parseInt(offset), hasMore: parseInt(offset) + rows.length < total });
    }
    return reply.send(rows);
  });

  // POST /api/trade/mm-orders/publish — create MM order from UI (no ingest auth)
  // Auto-fills: agent's wallet address, current KAS price (if not provided), agent_address, KAS address
  fastify.post('/api/trade/mm-orders/publish', async (request, reply) => {
    const { createOrder } = await import('../services/order-machine.js');
    const { relay_node_id, side, kas_amount, price: clientPrice, chain: rawChain, peer_address, counterparty_order_id, broadcast_txid, mode } = request.body || {};
    if (!relay_node_id || !side || !kas_amount) {
      return reply.code(400).send({ error: 'relay_node_id, side, kas_amount required' });
    }
    const chain = rawChain || 'bnb';

    // Resolve agent KAS address
    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    if (!relay?.address) return reply.code(400).send({ error: 'Agent has no Kaspa address' });

    // Auto-fill agent's cross-chain wallet address for this chain
    const wallet = sqlite.prepare(
      'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
    ).get(relay_node_id, chain);

    // Price: use client-provided price if valid, otherwise fetch market price
    let price = parseFloat(clientPrice) || 0;
    if (price <= 0) {
      try {
        const priceRes = await fetch('http://localhost:3100/api/trade/kas-price');
        const priceData = await priceRes.json();
        price = priceData?.price || 0;
      } catch {}
    }
    if (price <= 0) return reply.code(400).send({ error: 'Could not determine price — provide price or check market connection' });

    // 限额检查
    const kasAmt = parseFloat(kas_amount);
    const usdtEst = kasAmt * price;
    const limitCheck = checkLimits(relay.address, kasAmt, usdtEst, mode || 'manual');
    if (!limitCheck.ok) return reply.code(400).send({ error: limitCheck.error, detail: limitCheck.detail });

    // Create via order-machine
    const result = createOrder({
      relayNodeId: relay_node_id,
      agentAddress: relay.address,
      side,
      kasAmount: kasAmt,
      price,
      chain,
      peerAddress: peer_address || null,
      counterpartyOrderId: counterparty_order_id || null,
      broadcastTxid: broadcast_txid || null,
      mode: mode || '',  // 空 → fallback 到全局 agent_trade_mode
    });

    // Auto-fill addresses on the order:
    // - mm_receive_address: SELL orders only — where seller wants to receive USDT
    // - customer_pay_address: agent's KAS address (so counterparty knows where to send/receive KAS)
    const updates = [];
    const vals = [];
    if (wallet?.address && side === 'sell') {
      // Only sellers need a USDT receive address
      updates.push('mm_receive_address = ?'); vals.push(wallet.address);
    }
    updates.push('customer_pay_address = ?'); vals.push(relay.address);  // agent's KAS address for counterparty
    if (updates.length) {
      vals.push(result.id);
      sqlite.prepare(`UPDATE mm_orders SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    }

    const usdtAmount = Math.round(kasAmt * price * 100) / 100;
    return reply.send({
      ok: true, id: result.id, price, usdtAmount,
      walletAddress: wallet?.address || null,
      kasAddress: relay.address,
      created_at: result.created_at,
    });
  });

  // POST /api/trade/mm-orders — create MM order (requires ingest auth)
  fastify.post('/api/trade/mm-orders', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;

    const {
      relay_node_id, side, kas_amount, usdt_amount, price, chain,
      customer_address, customer_pay_address, mm_receive_address,
      status, batch_index, batch_total,
    } = request.body || {};

    if (!relay_node_id || !side || !kas_amount || !usdt_amount || !price || !chain) {
      return reply.code(400).send({ error: 'relay_node_id, side, kas_amount, usdt_amount, price, chain required' });
    }

    const { createOrder } = await import('../services/order-machine.js');
    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relay_node_id);
    const result = createOrder({
      relayNodeId: relay_node_id,
      agentAddress: relay?.address || null,
      side, kasAmount: parseFloat(kas_amount), price: parseFloat(price), chain,
      peerAddress: customer_address || null,
    });
    const id = result.id;
    const now = result.created_at;

    // 补充字段（createOrder 不设的旧字段）
    if (customer_pay_address || mm_receive_address) {
      sqlite.prepare('UPDATE mm_orders SET customer_pay_address = ?, mm_receive_address = ? WHERE id = ?')
        .run(customer_pay_address || null, mm_receive_address || null, id);
    }

    return reply.send({ ok: true, id, created_at: now });
  });

  // PUT /api/trade/mm-orders/:id — update MM order status (requires ingest auth)
  fastify.put('/api/trade/mm-orders/:id', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;

    const { id } = request.params;
    const existing = sqlite.prepare('SELECT id FROM mm_orders WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'MM order not found' });

    const body = request.body || {};
    const updates = [];
    const values = [];

    for (const col of ['status', 'payment_txhash', 'kas_txhash', 'customer_address', 'customer_pay_address', 'mm_receive_address']) {
      if (body[col] !== undefined) { updates.push(`${col} = ?`); values.push(body[col]); }
    }

    // Auto-set completed_at when status transitions to a terminal state
    if (body.status && ['completed', 'failed', 'cancelled', 'expired'].includes(body.status)) {
      updates.push('completed_at = ?');
      values.push(nowIso());
    }

    if (updates.length === 0) return reply.send({ ok: true, noChanges: true });

    values.push(id);
    sqlite.prepare(`UPDATE mm_orders SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return reply.send({ ok: true });
  });

  // POST /api/trade/mm-orders/:id/action — local UI actions (no ingest auth needed)
  // Actions: accept, pay_usdt, verify_payment, send_kas, cancel
  // Source is ALWAYS 'owner' — this endpoint is for human UI operations only.
  // Agent/peer/system trade actions go through Mind callback → gateTradeAction with their own source.
  fastify.post('/api/trade/mm-orders/:id/action', async (request, reply) => {
    const { transition, linkOrders, getOrder } = await import('../services/order-machine.js');
    const { gateTradeAction } = await import('../services/trade-action.js');
    const { id } = request.params;
    const order = sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    const { action, payment_txhash, customer_address, counterparty_order_id } = request.body || {};

    // ── 权限闸门：source='owner' 由服务端硬编码，不接受客户端声称 ──
    const gate = gateTradeAction(id, action, 'owner', order.agent_address);
    if (gate.denied) {
      return reply.code(403).send({ error: gate.reason });
    }
    // owner source → gate.allowed 总是 true，但保留检查以防将来变更

    // ── Accept: published → accepted ──
    if (action === 'accept') {
      // 限额检查
      const limitCheck = checkLimits(order.agent_address, order.kas_amount, order.usdt_amount || order.kas_amount * order.price, order.mode || 'manual');
      if (!limitCheck.ok) return reply.code(400).send({ error: limitCheck.error, detail: limitCheck.detail });

      // 资金锁定（卖方锁 KAS，买方锁 USDT）
      const lockAsset = order.side === 'sell' ? 'kas' : 'usdt_' + (order.chain || 'bnb');
      const lockAmount = order.side === 'sell' ? order.kas_amount : (order.usdt_amount || order.kas_amount * order.price);

      // 设计底线 2：资金先锁后用 — 查真实余额
      let currentBalance = 0;
      try {
        const port = process.env.PORT || 3100;
        if (order.side === 'sell') {
          // 卖方锁 KAS — 查 Relay 余额（用 HTTP 更可靠，不依赖 IPC）
          const balRes = await fetch(`http://localhost:${port}/api/relay/${order.relay_node_id}/balance`).then(r => r.json());
          currentBalance = parseFloat(balRes?.balance || '0');
        } else {
          // 买方锁 USDT — 查链上 USDT 余额
          const chain = order.chain || 'bnb';
          const wallet = sqlite.prepare(
            'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
          ).get(order.relay_node_id, chain);
          if (wallet?.address) {
            const balRes = await fetch(`http://localhost:${port}/api/trade/wallet-balance?chain=${chain}&address=${wallet.address}`).then(r => r.json());
            currentBalance = balRes?.usdt || 0;
          }
        }
      } catch (err) {
        console.log(`[trade] Balance check warning (non-blocking): ${err.message}`);
        currentBalance = lockAmount; // 余额查询失败 → 至少够这一单
      }

      const lock = lockFunds(order.agent_address, id, lockAsset, lockAmount, currentBalance);
      if (!lock.ok) return reply.code(400).send({ error: lock.error });

      const execId = quickStart({ orderId: id, type: 'accept_order', source: 'owner', agentAddress: order.agent_address,
        amount: order.kas_amount, asset: order.side === 'sell' ? 'kas' : 'usdt_' + (order.chain || 'bnb'),
        displaySummary: `接受${order.side === 'buy' ? '买入' : '卖出'} ${order.kas_amount} KAS @ $${order.price}（${(order.chain || 'bnb').toUpperCase()} 链），资金已锁定` });

      const result = transition(id, 'accepted');
      if (!result.ok) return reply.code(400).send({ error: result.error });

      completeExecution(execId, { summary: `订单已接受 — ${order.side === 'buy' ? '买入' : '卖出'} ${order.kas_amount} KAS @ $${order.price}，${(order.chain||'bnb').toUpperCase()} 链，资金已锁定，等待下一步` });

      if (counterparty_order_id) linkOrders(id, counterparty_order_id);
      if (customer_address) {
        sqlite.prepare('UPDATE mm_orders SET peer_address = ? WHERE id = ?').run(customer_address, id);
      }

      // 自动互填双方地址（KAS 地址 + EVM 钱包地址）
      if (counterparty_order_id) {
        const counterOrder = sqlite.prepare('SELECT agent_address, peer_address, mm_receive_address FROM mm_orders WHERE id = ?').get(counterparty_order_id);
        if (counterOrder) {
          // 互填 KAS 地址（peer_address）
          if (order.agent_address && !counterOrder.peer_address) {
            sqlite.prepare('UPDATE mm_orders SET peer_address = ? WHERE id = ?').run(order.agent_address, counterparty_order_id);
            console.log(`[trade] Auto-fill: peer_address on counterparty ${counterparty_order_id.slice(0, 8)} → ${order.agent_address.slice(-12)}`);
          }
          if (counterOrder.agent_address && !order.peer_address) {
            sqlite.prepare('UPDATE mm_orders SET peer_address = ? WHERE id = ?').run(counterOrder.agent_address, id);
            console.log(`[trade] Auto-fill: peer_address on order ${id.slice(0, 8)} → ${counterOrder.agent_address.slice(-12)}`);
          }
          // 互填 EVM 钱包地址（mm_receive_address）— 买方需要知道卖方的 USDT 收款地址
          if (counterOrder.mm_receive_address && !order.mm_receive_address && order.side === 'buy') {
            // 买方的 mm_receive_address 不需要（买方不收 USDT），但 pay_usdt 读对手方的
            // 不做额外写入 — pay_usdt 已经从 counterparty 读 mm_receive_address
          }
          if (order.mm_receive_address && !counterOrder.mm_receive_address && counterOrder.side === 'buy') {
            // 不做额外写入 — 同上
          }
          console.log(`[trade] Address fill complete: order ${id.slice(0,8)} ↔ counter ${counterparty_order_id.slice(0,8)}`);
        }
      }

      // ── 握手保障：Accept 后确保双方可通信（Kasia 协议要求）──
      // 查对手方地址，检查是否已握手，未握手则立即发起
      // 握手是异步的，不阻塞交易流程（链上转账不需要握手，comm 消息需要）
      const freshOrder = sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(id);
      const peerAddr = freshOrder.peer_address;
      const myAddr = freshOrder.agent_address;
      if (peerAddr && myAddr && peerAddr !== myAddr) {
        try {
          const { getRelation } = await import('../services/relation-state.js');
          const rel = getRelation(myAddr, peerAddr);
          const connected = rel && ['active', 'confirmed', 'accepted'].includes(rel.status);
          if (!connected) {
            // 未握手 — 发起握手（异步，不阻塞交易）
            const { sendCommandAsync } = await import('../services/relay-manager.js');
            console.log(`[trade] Handshake needed: ${myAddr.slice(-12)} → ${peerAddr.slice(-12)} (status: ${rel?.status || 'none'})`);
            // origin=legacy-unmigrated: 收敛类迁移债(C 分阶段 arm 8282dd61), 迁 app 信封/operator 专道后撤此标
            sendCommandAsync(freshOrder.relay_node_id, { type: 'handshake', target: peerAddr }, 15000, 'legacy-unmigrated')
              .then(res => {
                if (res?.txId) console.log(`[trade] Handshake sent: TX ${res.txId.slice(0, 16)}`);
                else if (res?.error) console.log(`[trade] Handshake warning: ${res.error}`);
              })
              .catch(err => console.log(`[trade] Handshake failed (non-blocking): ${err?.message || err}`));
          } else {
            console.log(`[trade] Already connected: ${myAddr.slice(-12)} → ${peerAddr.slice(-12)} (${rel.status})`);
          }
        } catch (err) {
          console.log(`[trade] Handshake check error (non-blocking): ${err?.message || err}`);
        }
      }

      // Accept 后触发下一步（买方自动付款 / approval 等待确认）
      const { triggerNextStep } = await import('../services/trade-action.js');
      triggerNextStep(freshOrder, 'owner');

      return reply.send({ ok: true, status: 'accepted', order: result.order });
    }

    // ── Verify payment: paid → verified ──
    if (action === 'verify_payment') {
      const txHash = payment_txhash || order.payment_txhash;
      if (!txHash || txHash === 'confirmed') {
        return reply.code(400).send({ error: 'Valid payment_txhash required — cannot verify without TX hash' });
      }

      // ── Anti-replay: TX hash must not be used by another order ──
      const existingUse = sqlite.prepare(
        'SELECT id, status FROM mm_orders WHERE payment_txhash = ? AND id != ?'
      ).get(txHash, id);
      if (existingUse) {
        return reply.code(409).send({
          error: `TX ${txHash.slice(0, 16)}... already bound to order ${existingUse.id.slice(0, 8)} (status: ${existingUse.status}). Possible replay.`,
        });
      }

      const chain = order.chain || 'bnb';
      const expectedAmount = order.usdt_amount || order.kas_amount * (order.price || 0);
      const receiveAddr = order.mm_receive_address;

      // ── Cross-chain verification via shared module (extracted 2026-04-06) ──
      const SUPPORTED_AUTO = ['bnb', 'eth', 'sol', 'tron'];
      let verifyResult = null;

      // Resolve expected sender for EVM chains (buyer wallet address matching)
      let expectedFrom = null;
      if (['bnb', 'eth'].includes(chain) && order.side === 'sell' && order.counterparty_order_id) {
        const buyerOrder = sqlite.prepare('SELECT relay_node_id FROM mm_orders WHERE id = ?').get(order.counterparty_order_id);
        const buyerWallet = buyerOrder
          ? sqlite.prepare('SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ?').get(buyerOrder.relay_node_id, chain)
          : null;
        if (buyerWallet) expectedFrom = buyerWallet.address;
      }

      if (SUPPORTED_AUTO.includes(chain)) {
        const execId = quickStart({ orderId: id, type: 'verify_payment', source: 'owner', agentAddress: order.agent_address, inputTxid: txHash,
          displaySummary: `验证到账 ${expectedAmount.toFixed(2)} USDT（${chain.toUpperCase()} 链）` });

        try {
          const vr = await verifyCrossChainTx({ txHash, chain, expectedAmount, expectedTo: receiveAddr, expectedFrom });

          if (!vr.confirmed) {
            // Underpayment → disputed
            if (vr.underpayment) {
              failExecution(execId, `Underpayment: expected ${expectedAmount.toFixed(2)}, got ${vr.actualAmount.toFixed(2)}`);
              recordChainEvent({ txid: txHash, eventType: 'payment_underpayment',
                fromAddress: vr.recipient, toAddress: receiveAddr || order.agent_address, observedBy: 'system',
                payload: { orderId: id, expected: expectedAmount, actual: vr.actualAmount, chain } });
              transition(id, 'disputed', { reason: `underpayment: expected ${expectedAmount.toFixed(2)} USDT, received ${vr.actualAmount.toFixed(2)} USDT` });
              return reply.code(400).send({ error: 'Underpayment — order moved to disputed', expected: expectedAmount, actual: vr.actualAmount, status: 'disputed' });
            }
            failExecution(execId, vr.error);
            return reply.code(400).send({ error: vr.error, confirmations: vr.confirmations, required: vr.required });
          }

          // Sender mismatch warning (non-blocking)
          if (vr.senderMismatch && expectedFrom) {
            console.log(`[trade] verify_payment WARN: sender ${vr.sender.slice(0,10)} != expected ${expectedFrom.slice(0,10)}`);
            recordChainEvent({ txid: txHash, eventType: 'payment_verified',
              fromAddress: vr.sender, toAddress: vr.recipient, observedBy: 'system',
              payload: { orderId: id, warning: 'sender_mismatch', expectedSender: expectedFrom, actualSender: vr.sender, chain } });
            const { insertEvent } = await import('../data/state/events.js');
            insertEvent({ eventType: 'payment_sender_mismatch', source: 'trade', level: 'warning',
              agentAddress: order.agent_address,
              summary: `⚠ Payment sender mismatch on order ${id.slice(0,8)}: expected ${expectedFrom.slice(0,10)}..., got ${vr.sender.slice(0,10)}... (${chain.toUpperCase()})`,
              payloadJson: { orderId: id, expectedSender: expectedFrom, actualSender: vr.sender, chain, amount: vr.actualAmount } });
          }

          verifyResult = { actualAmount: vr.actualAmount, recipient: vr.recipient, confirmations: vr.confirmations, required: vr.required };
          completeExecution(execId, { outputTxid: txHash, summary: `✅ 到账确认 — ${vr.actualAmount.toFixed(2)} USDT 已验证（${chain.toUpperCase()} 链，${vr.confirmations}/${vr.required} 确认）` });
          recordChainEvent({ txid: txHash, eventType: 'payment_verified',
            fromAddress: vr.sender || vr.recipient, toAddress: receiveAddr || order.agent_address, observedBy: 'system',
            payload: { orderId: id, actualAmount: vr.actualAmount, confirmations: vr.confirmations, required: vr.required, chain } });
          console.log(`[trade] verify_payment OK: ${vr.actualAmount.toFixed(2)} USDT → ${vr.recipient} on ${chain}`);
        } catch (err) {
          failExecution(execId, err.message);
          recordChainEvent({ txid: `failed_verify_${chain}_${id.slice(0, 8)}_${Date.now()}`, eventType: 'verify_failed', fromAddress: order.agent_address, observedBy: 'system',
            payload: { orderId: id, error: err.message, chain } });
          return reply.code(500).send({ error: 'Chain verification failed: ' + err.message });
        }
      } else {
        // Unknown chain — manual fallback
        const execId = quickStart({ orderId: id, type: 'verify_payment', source: 'owner', agentAddress: order.agent_address, inputTxid: txHash,
          displaySummary: `[MANUAL] Owner verified ${expectedAmount.toFixed(2)} USDT on ${chain.toUpperCase()} — no auto-verify for this chain` });
        completeExecution(execId, { outputTxid: txHash });
        verifyResult = { manual: true, chain, note: 'Auto-verification not available for this chain' };
        console.log(`[trade] verify_payment MANUAL: ${chain} TX ${txHash.slice(0, 16)}... — no auto-verify`);
      }

      // Transition to verified
      const result = transition(id, 'verified', { txHash });
      if (!result.ok) transition(id, 'verified', { txHash, force: true });

      // Update payment_txhash on order if not set
      if (txHash && txHash !== order.payment_txhash) {
        sqlite.prepare('UPDATE mm_orders SET payment_txhash = ? WHERE id = ?').run(txHash, id);
      }
      if (customer_address) sqlite.prepare('UPDATE mm_orders SET peer_address = ? WHERE id = ?').run(customer_address, id);

      return reply.send({ ok: true, status: 'verified', verification: verifyResult });
    }

    // ── Send KAS: verified → delivering → completed ──
    if (action === 'send_kas') {
      const targetAddr = customer_address || order.customer_address || order.peer_address;
      if (!targetAddr) return reply.code(400).send({ error: 'No customer address — set it first' });

      if (order.status !== 'verified') {
        return reply.code(400).send({ error: `Cannot send KAS from status "${order.status}"` });
      }

      const execId = quickStart({
        orderId: id, type: 'send_kas', source: 'owner', agentAddress: order.agent_address,
        amount: order.kas_amount, asset: 'kas',
        displaySummary: `发送 ${order.kas_amount} KAS → ${targetAddr.slice(0, 20)}...`,
      });

      transition(id, 'delivering', { force: true });

      try {
        const { sendCommandAsync } = await import('../services/relay-manager.js');
        // origin=legacy-unmigrated: 收敛类迁移债(C 分阶段 arm 8282dd61), 迁 app 信封/operator 专道后撤此标
        const result = await sendCommandAsync(order.relay_node_id, {
          type: 'transfer', target: targetAddr, amount: String(order.kas_amount),
        }, 30000, 'legacy-unmigrated');

        if (!result?.txId) {
          const errMsg = result?.error || 'Relay returned no txId — KAS was NOT sent';
          console.error(`[trade] send_kas FAILED for order ${id.slice(0, 8)}: ${errMsg}`);
          failExecution(execId, errMsg);
          transition(id, 'verified', { reason: errMsg, force: true });
          return reply.code(500).send({ error: errMsg });
        }

        completeExecution(execId, { outputTxid: result.txId, summary: `✅ ${order.kas_amount} KAS 已发送 — 交割完成，交易圆满` });
        transition(id, 'completed', { txHash: result.txId });

        // ── Broadcast delivery proof to order's chain channel (via Relay IPC) ──
        try {
          const { sendCommandAsync: sendCmd } = await import('../services/relay-manager.js');
          // Trade channel = the original published order's ID (earliest created)
          const _delCh = (() => {
            if (!order.counterparty_order_id) return order.id;
            const ctr = sqlite.prepare('SELECT created_at FROM mm_orders WHERE id = ?').get(order.counterparty_order_id);
            return (ctr && ctr.created_at < order.created_at) ? order.counterparty_order_id : order.id;
          })();
          const deliveredPayload = JSON.stringify({
            t: 'kanet_delivered_v1', v: 1, id: _delCh,
            tx: result.txId, amt: order.kas_amount, to: targetAddr,
          });
          // Delay 5s: wait for send_kas UTXO to settle before broadcasting
          setTimeout(() => {
            // sendCmd=sendCommandAsync 别名; NWT 完整清单复核(24da7ea9)定类: 请求触发通信 → origin=app
            sendCmd(order.relay_node_id, { type: 'send_broadcast', channel: _delCh, message: deliveredPayload }, undefined, 'app').then(r => {
              console.log(`[trade] Broadcast kanet_delivered_v1 to channel ${_delCh.slice(0, 8)} TX=${r?.txId?.slice(0, 16) || '?'}`);
            }).catch(err => {
              console.error(`[trade] Failed to broadcast kanet_delivered_v1: ${err?.message || err}`);
            });
          }, 5000);
        } catch (err) {
          console.error(`[trade] kanet_delivered_v1 broadcast error: ${err.message}`);
        }

        return reply.send({ ok: true, status: 'completed', txId: result.txId });
      } catch (err) {
        failExecution(execId, err.message);
        // 设计底线 7：每笔 TX 入 chain_events，不管成功失败
        recordChainEvent({
          txid: `failed_kas_${id.slice(0, 8)}_${Date.now()}`,
          eventType: 'kas_delivery_failed',
          fromAddress: order.agent_address,
          toAddress: targetAddr,
          observedBy: 'system',
          payload: { orderId: id, action: 'send_kas', error: err.message, amount: order.kas_amount },
        });
        transition(id, 'verified', { reason: 'KAS send failed: ' + err.message, force: true });
        return reply.code(500).send({ error: 'KAS send failed: ' + err.message });
      }
    }

    // ── Pay USDT: accepted/published → paying → paid ──
    if (action === 'pay_usdt') {
      // 收款地址：从对手方（卖方）订单读取，不是从自己的订单读
      let sellerAddr = null;
      if (order.counterparty_order_id) {
        const counterOrder = sqlite.prepare('SELECT mm_receive_address FROM mm_orders WHERE id = ?').get(order.counterparty_order_id);
        sellerAddr = counterOrder?.mm_receive_address;
      }
      // 回退：如果没有对手方，用订单自身的地址（兼容旧单）
      if (!sellerAddr) sellerAddr = order.mm_receive_address;
      if (!sellerAddr) return reply.code(400).send({ error: 'Seller wallet address not found — counterparty order may not have a wallet configured' });

      const chain = order.chain || 'bnb';
      const usdtAmount = order.usdt_amount || order.kas_amount * (order.price || 0);
      if (usdtAmount <= 0) return reply.code(400).send({ error: 'Cannot calculate USDT amount (price=0)' });

      const wallet = sqlite.prepare(
        'SELECT id, address, privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ?'
      ).get(order.relay_node_id, chain);
      if (!wallet?.privkey_encrypted) return reply.code(400).send({ error: 'No ' + chain + ' wallet with private key for this agent' });

      const execId = quickStart({
        orderId: id, type: 'pay_usdt', source: 'owner', agentAddress: order.agent_address,
        amount: usdtAmount, asset: 'usdt_' + chain,
        displaySummary: `支付 ${usdtAmount.toFixed(2)} USDT → ${sellerAddr.slice(0, 12)}...（${chain.toUpperCase()} 链）`,
      });

      // Transition to paying (mark intent before slow network call)
      transition(id, 'paying', { force: true });

      try {
        const { transferERC20 } = await import('../services/evm-transfer.js');
        const txResult = await transferERC20(chain, wallet.privkey_encrypted, sellerAddr, usdtAmount);
        if (!txResult.ok) {
          failExecution(execId, txResult.error);
          transition(id, 'accepted', { reason: txResult.error, force: true });
          return reply.code(400).send({ error: txResult.error });
        }
        const tx = { hash: txResult.txHash };
        console.log(`[trade] USDT payment: ${usdtAmount} USDT → ${sellerAddr} on ${chain} TX: ${tx.hash}`);

        completeExecution(execId, { outputTxid: tx.hash, summary: `💰 已付款 ${usdtAmount.toFixed(2)} USDT → ${sellerAddr.slice(0,8)}...（${chain.toUpperCase()} 链），等待到账确认` });
        transition(id, 'paid', { txHash: tx.hash });

        // ── Broadcast payment proof to order's chain channel (via Relay IPC) ──
        try {
          const { sendCommandAsync: sendCmd } = await import('../services/relay-manager.js');
          // Trade channel = the original published order's ID (earliest created)
          const _paidCh = (() => {
            if (!order.counterparty_order_id) return order.id;
            const ctr = sqlite.prepare('SELECT created_at FROM mm_orders WHERE id = ?').get(order.counterparty_order_id);
            return (ctr && ctr.created_at < order.created_at) ? order.counterparty_order_id : order.id;
          })();
          const paidPayload = JSON.stringify({
            t: 'kanet_paid_v1', v: 1, id: _paidCh,
            chain, tx: tx.hash, amt: usdtAmount, to: sellerAddr,
          });
          // sendCmd=sendCommandAsync 别名; NWT 完整清单复核(24da7ea9)定类: 请求触发通信 → origin=app
          sendCmd(order.relay_node_id, { type: 'send_broadcast', channel: _paidCh, message: paidPayload }, undefined, 'app').then(r => {
              console.log(`[trade] Broadcast kanet_paid_v1 to channel ${_paidCh.slice(0, 8)} TX=${r?.txId?.slice(0, 16) || '?'}`);
            }).catch(err => {
              console.error(`[trade] Failed to broadcast kanet_paid_v1: ${err?.message || err}`);
            });
        } catch (err) {
          console.error(`[trade] kanet_paid_v1 broadcast error: ${err.message}`);
        }

        // ── Auto-verify: 60s 后自动对卖方订单验证到账 ──
        // 不阻塞当前请求，后台执行
        const counterpartyId = order.counterparty_order_id;
        if (counterpartyId && tx.hash) {
          const VERIFY_DELAY_MS = 60_000; // 60s, enough for 15 BNB blocks
          const MAX_RETRIES = 3;
          const scheduleVerify = (attempt) => {
            setTimeout(async () => {
              try {
                const cOrder = sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(counterpartyId);
                if (!cOrder || !['paid'].includes(cOrder.status)) {
                  console.log(`[auto-verify] Skip: counterparty ${counterpartyId.slice(0, 8)} status=${cOrder?.status}`);
                  return;
                }
                console.log(`[auto-verify] Attempt ${attempt}/${MAX_RETRIES} for ${counterpartyId.slice(0, 8)} TX=${tx.hash.slice(0, 16)}...`);

                // Reuse the verify_payment logic inline
                const autoVerifyPort = process.env.PORT || 3100;
                const vRes = await fetch(`http://localhost:${autoVerifyPort}/api/trade/mm-orders/${counterpartyId}/action`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'verify_payment', payment_txhash: tx.hash }),
                });
                const vData = await vRes.json();

                if (vData.ok) {
                  console.log(`[auto-verify] ✓ Counterparty ${counterpartyId.slice(0, 8)} auto-verified`);
                } else if (attempt < MAX_RETRIES) {
                  console.log(`[auto-verify] Retry ${attempt}: ${vData.error}`);
                  scheduleVerify(attempt + 1);
                } else {
                  console.log(`[auto-verify] Failed after ${MAX_RETRIES} attempts: ${vData.error}`);
                }
              } catch (err) {
                console.log(`[auto-verify] Error: ${err.message}`);
                if (attempt < MAX_RETRIES) scheduleVerify(attempt + 1);
              }
            }, VERIFY_DELAY_MS);
          };
          scheduleVerify(1);
          console.log(`[trade] Auto-verify scheduled for counterparty ${counterpartyId.slice(0, 8)} in ${VERIFY_DELAY_MS / 1000}s`);
        }

        return reply.send({ ok: true, status: 'paid', txHash: tx.hash, amount: usdtAmount, chain });
      } catch (err) {
        console.error(`[trade] USDT payment failed:`, err.message);
        failExecution(execId, err.message);
        // 设计底线 7：每笔 TX 入 chain_events，不管成功失败
        recordChainEvent({
          txid: `failed_pay_${id.slice(0, 8)}_${Date.now()}`,
          eventType: 'payment_failed',
          fromAddress: order.agent_address,
          toAddress: sellerAddr,
          observedBy: 'system',
          payload: { orderId: id, action: 'pay_usdt', error: err.message, chain, amount: usdtAmount },
        });
        transition(id, 'accepted', { reason: 'USDT payment failed: ' + err.message, force: true });
        return reply.code(500).send({ error: 'USDT payment failed: ' + err.message });
      }
    }

    // ── Cancel: any → cancelled ──
    if (action === 'cancel') {
      const execId = quickStart({ orderId: id, type: 'cancel_order', source: 'owner', agentAddress: order.agent_address,
        displaySummary: `Cancel ${order.side} ${order.kas_amount} KAS order` });

      const result = transition(id, 'cancelled', { reason: 'User cancelled' });
      if (!result.ok) {
        sqlite.prepare(`UPDATE mm_orders SET status = 'cancelled', completed_at = ?, cancel_reason = 'User cancelled' WHERE id = ?`)
          .run(nowIso(), id);
      }

      completeExecution(execId, { summary: `订单已取消 — ${order.kas_amount} KAS 订单关闭，锁定资金已释放` });
      return reply.send({ ok: true, status: 'cancelled' });
    }

    return reply.code(400).send({ error: 'Unknown action: ' + action });
  });

  // GET /api/trade/mm-quotes — query quote history (supports relay_node_id filter)
  fastify.get('/api/trade/mm-quotes', async (request, reply) => {
    const { relay_node_id, limit = 100 } = request.query;
    let sql = 'SELECT * FROM mm_quotes';
    const params = [];

    if (relay_node_id) { sql += ' WHERE relay_node_id = ?'; params.push(relay_node_id); }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const rows = sqlite.prepare(sql).all(...params);
    return reply.send(rows);
  });

  // POST /api/trade/mm-quotes — record new quote snapshot (requires ingest auth)
  fastify.post('/api/trade/mm-quotes', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;

    const { relay_node_id, buy_price, sell_price, kas_stock, usdt_stock, mexc_price } = request.body || {};

    if (!relay_node_id) {
      return reply.code(400).send({ error: 'relay_node_id required' });
    }

    const id = randomUUID();
    const now = nowIso();

    sqlite.prepare(`
      INSERT INTO mm_quotes (id, relay_node_id, buy_price, sell_price, kas_stock, usdt_stock, mexc_price, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, relay_node_id, buy_price ?? null, sell_price ?? null, kas_stock ?? null, usdt_stock ?? null, mexc_price ?? null, now);

    return reply.send({ ok: true, id, created_at: now });
  });

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
