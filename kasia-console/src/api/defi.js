/**
 * DeFi API routes — Aave V3 (Arbitrum)
 *
 * GET  /api/defi/aave/status   — account data + balances
 * POST /api/defi/aave/supply   — deposit asset
 * POST /api/defi/aave/withdraw — withdraw asset
 * POST /api/defi/aave/borrow   — borrow against collateral
 * POST /api/defi/aave/repay    — repay debt
 */

import { sqlite } from '../db/client.js';
import { decrypt, encrypt } from '../services/crypto.js';
import { recordChainEvent } from '../services/chain-event.js';
import { randomUUID } from 'crypto';

export async function registerDefiRoutes(fastify) {

  // ── GET /api/defi/aave/status — current lending position ──
  fastify.get('/api/defi/aave/status', async (request, reply) => {
    const { walletId } = request.query;
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });

    const wallet = sqlite.prepare('SELECT address, chain FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (wallet.chain !== 'arbitrum') return reply.code(400).send({ error: 'Aave only on Arbitrum wallets' });

    try {
      const { getAccountData, getTokenBalance } = await import('../services/aave-client.js');
      const [account, usdcBal, wethBal] = await Promise.all([
        getAccountData(wallet.address),
        getTokenBalance(wallet.address, 'usdc'),
        getTokenBalance(wallet.address, 'weth').catch(() => 0),
      ]);

      return reply.send({
        ok: true,
        address: wallet.address,
        account,
        walletBalance: { usdc: usdcBal, weth: wethBal },
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/defi/aave/supply ──
  fastify.post('/api/defi/aave/supply', async (request, reply) => {
    const { walletId, asset = 'usdc', amount } = request.body || {};
    if (!walletId || !amount) return reply.code(400).send({ error: 'walletId and amount required' });

    const wallet = sqlite.prepare('SELECT chain, privkey_encrypted FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (wallet.chain !== 'arbitrum') return reply.code(400).send({ error: 'Aave only on Arbitrum wallets' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { supply } = await import('../services/aave-client.js');
      const result = await supply(privateKey, asset, parseFloat(amount));
      if (result.ok) recordChainEvent({ txid: result.txHash, eventType: 'aave_supply', payload: JSON.stringify({ asset, amount, chain: 'arbitrum' }) });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/defi/aave/withdraw ──
  fastify.post('/api/defi/aave/withdraw', async (request, reply) => {
    const { walletId, asset = 'usdc', amount } = request.body || {};
    if (!walletId || !amount) return reply.code(400).send({ error: 'walletId and amount required' });

    const wallet = sqlite.prepare('SELECT chain, privkey_encrypted FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (wallet.chain !== 'arbitrum') return reply.code(400).send({ error: 'Aave only on Arbitrum wallets' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { withdraw } = await import('../services/aave-client.js');
      const result = await withdraw(privateKey, asset, parseFloat(amount));
      if (result.ok) recordChainEvent({ txid: result.txHash, eventType: 'aave_withdraw', payload: JSON.stringify({ asset, amount, chain: 'arbitrum' }) });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/defi/aave/borrow ──
  fastify.post('/api/defi/aave/borrow', async (request, reply) => {
    const { walletId, asset = 'usdc', amount } = request.body || {};
    if (!walletId || !amount) return reply.code(400).send({ error: 'walletId and amount required' });

    // Safety: check health factor before allowing borrow
    const wallet = sqlite.prepare('SELECT address, chain, privkey_encrypted FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (wallet.chain !== 'arbitrum') return reply.code(400).send({ error: 'Aave only on Arbitrum wallets' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });

    try {
      const { getAccountData, borrow } = await import('../services/aave-client.js');
      const account = await getAccountData(wallet.address);

      // Safety: must have collateral and health factor > 1.5
      if (account.totalCollateralUSD <= 0) {
        return reply.code(400).send({ error: 'No collateral deposited. Supply first.' });
      }
      if (account.healthFactor < 1.5 && account.healthFactor !== Infinity) {
        return reply.code(400).send({ error: `Health factor too low: ${account.healthFactor.toFixed(2)}. Must be > 1.5 to borrow.` });
      }

      const privateKey = decrypt(wallet.privkey_encrypted);
      const result = await borrow(privateKey, asset, parseFloat(amount));
      if (result.ok) recordChainEvent({ txid: result.txHash, eventType: 'aave_borrow', payload: JSON.stringify({ asset, amount, chain: 'arbitrum' }) });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/defi/aave/repay ──
  fastify.post('/api/defi/aave/repay', async (request, reply) => {
    const { walletId, asset = 'usdc', amount } = request.body || {};
    if (!walletId || !amount) return reply.code(400).send({ error: 'walletId and amount required' });

    const wallet = sqlite.prepare('SELECT chain, privkey_encrypted FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (wallet.chain !== 'arbitrum') return reply.code(400).send({ error: 'Aave only on Arbitrum wallets' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { repay } = await import('../services/aave-client.js');
      const result = await repay(privateKey, asset, parseFloat(amount));
      if (result.ok) recordChainEvent({ txid: result.txHash, eventType: 'aave_repay', payload: JSON.stringify({ asset, amount, chain: 'arbitrum' }) });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /api/defi/aave/analyze — AI advice on lending strategy ──
  //
  // Gathers: Aave position (collateral/debt/HF/available borrow)
  //        + Hyperliquid position (if any, for cross-market linkage)
  //        + Current supply/borrow rates
  // Calls local adapter for structured recommendation.
  fastify.post('/api/defi/aave/analyze', async (request, reply) => {
    const { walletId } = request.body || {};
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });

    const wallet = sqlite.prepare('SELECT address, chain, privkey_encrypted FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (wallet.chain !== 'arbitrum') return reply.code(400).send({ error: 'Aave only on Arbitrum wallets' });

    try {
      const { getAccountData, getTokenBalance } = await import('../services/aave-client.js');
      const [account, usdcBal, wethBal] = await Promise.all([
        getAccountData(wallet.address),
        getTokenBalance(wallet.address, 'usdc'),
        getTokenBalance(wallet.address, 'weth').catch(() => 0),
      ]);

      // Try to pull Hyperliquid state for cross-market context (same wallet = same Arb address)
      let hlState = null;
      if (wallet.privkey_encrypted) {
        try {
          const privateKey = decrypt(wallet.privkey_encrypted);
          const { getAccountInfo, getPositions } = await import('../services/hyperliquid-client.js');
          const [hlAcct, hlPos] = await Promise.all([getAccountInfo(privateKey), getPositions(privateKey)]);
          hlState = { accountValue: hlAcct.accountValue, available: hlAcct.available, marginPct: hlAcct.marginUsedPct, positions: hlPos };
        } catch {}
      }

      // HF classification
      const hf = account.healthFactor;
      const hfClass = hf === Infinity ? 'no_debt'
        : hf >= 2 ? 'safe'
        : hf >= 1.5 ? 'cautious'
        : hf >= 1.2 ? 'risky'
        : 'danger';

      // Build prompt
      const lines = [
        `Aave V3 状态 (Arbitrum):`,
        `- 地址: ${wallet.address}`,
        `- 总抵押: $${account.totalCollateralUSD.toFixed(2)}`,
        `- 总负债: $${account.totalDebtUSD.toFixed(2)}`,
        `- 可借额度: $${account.availableBorrowUSD.toFixed(2)}`,
        `- 健康因子 (HF): ${hf === Infinity ? '∞ (无债)' : hf.toFixed(2)} [${hfClass}]`,
        `- 清算阈值: ${account.liquidationThreshold.toFixed(0)}%`,
        ``,
        `Arb 钱包余额:`,
        `- USDC: ${usdcBal.toFixed(2)}`,
        `- WETH: ${wethBal.toFixed(4)}`,
      ];
      if (hlState) {
        lines.push(``, `Hyperliquid 同地址状态 (跨市场联动):`);
        lines.push(`- HL 账户值: $${hlState.accountValue.toFixed(2)}`);
        lines.push(`- HL 可用: $${hlState.available.toFixed(2)}`);
        lines.push(`- HL 保证金占用: ${hlState.marginPct.toFixed(0)}%`);
        if (hlState.positions.length > 0) {
          lines.push(`- HL 持仓: ${hlState.positions.map(p => `${p.side} ${p.asset} ${p.size}@$${p.entryPrice} PnL $${p.pnl.toFixed(2)}`).join(', ')}`);
        } else {
          lines.push(`- HL 持仓: 无`);
        }
      }

      const system = `你是 KANet 的 DeFi 资金分析师，分析用户在 Aave V3 (Arbitrum) 的借贷头寸和跨市场联动（Hyperliquid）。
你关心安全、资金效率、跨市场机会。健康因子 < 1.5 必须警告。
回复严格 JSON，无 markdown，无多余解释。schema:
{
  "assessment": "safe" | "cautious" | "risky" | "danger",
  "hfCommentary": "健康因子的一句话解读",
  "recommendation": "ACTION_TYPE",
  "action": {
    "type": "supply" | "withdraw" | "borrow" | "repay" | "hold" | "cross_market",
    "asset": "usdc" | "weth" | "usdt" | null,
    "amount": number | null,
    "reason": "一句话理由"
  },
  "crossMarketSuggestion": "跨 Aave-Hyperliquid 联动建议，一句话，若无则空字符串",
  "risks": ["风险 1", "风险 2"],
  "summary": "一句话总结"
}`;
      const userPrompt = lines.join('\n') + `\n\n给出分析。如果 HF 危险必须建议 repay。如果无债且有闲钱建议 supply。如果 HL 保证金紧张且 Aave 有可借额度，建议 borrow USDC 补充 HL。`;

      const relay = sqlite.prepare(
        `SELECT r.name, a.http_port FROM relay_nodes r JOIN adapter_nodes a ON a.id = r.adapter_node_id WHERE a.http_port IS NOT NULL LIMIT 1`
      ).get();
      if (!relay?.http_port) return reply.code(503).send({ error: 'No AI adapter available' });

      const res = await fetch(`http://localhost:${relay.http_port}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: 'system', mindSystem: system, mindUser: userPrompt, mindTask: true }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      const raw = data?.reply || data?.content || data?.text || '';
      let parsed = null;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {}

      return reply.send({
        ok: true,
        agent: relay.name,
        parsed,
        raw: parsed ? undefined : raw,
        intel: { aave: account, arbBalances: { usdc: usdcBal, weth: wethBal }, hl: hlState, hfClass },
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // ── Hyperliquid Perpetual Futures ────────────────────────
  // ══════════════════════════════════════════════════════════

  function getArbitrumWallet(walletId) {
    const wallet = sqlite.prepare('SELECT * FROM agent_wallets WHERE id = ?').get(walletId);
    if (!wallet) return { error: 'Wallet not found', code: 404 };
    if (wallet.chain !== 'arbitrum') return { error: 'Hyperliquid requires Arbitrum wallet', code: 400 };
    if (!wallet.privkey_encrypted) return { error: 'No private key', code: 400 };
    return { wallet };
  }

  // GET /api/defi/hyperliquid/status — account + positions + markets
  fastify.get('/api/defi/hyperliquid/status', async (request, reply) => {
    const { walletId } = request.query;
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { getAccountInfo, getPositions, getFundingRates, getMarkets } = await import('../services/hyperliquid-client.js');
      const [account, positions, funding, markets] = await Promise.all([
        getAccountInfo(privateKey),
        getPositions(privateKey),
        getFundingRates(privateKey, ['BTC', 'ETH', 'SOL']),
        getMarkets(0), // 0 = all markets
      ]);
      return reply.send({ ok: true, account, positions, funding, markets });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/markets — no auth needed for market list (all by default)
  fastify.get('/api/defi/hyperliquid/markets', async (request, reply) => {
    try {
      const { getMarkets, getCategories } = await import('../services/hyperliquid-client.js');
      const markets = await getMarkets(parseInt(request.query?.limit) || 0);
      return reply.send({ ok: true, markets, categories: getCategories() });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/hyperliquid/analyze — AI-driven trade thesis
  fastify.post('/api/defi/hyperliquid/analyze', async (request, reply) => {
    const { walletId, asset } = request.body || {};
    if (!walletId || !asset) return reply.code(400).send({ error: 'walletId and asset required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { getAccountInfo, getPositions, getMarkets, getLeaderboard, getTraderIntel } = await import('../services/hyperliquid-client.js');

      // 1) Gather intel in parallel
      const [account, positions, markets, leaders] = await Promise.all([
        getAccountInfo(privateKey),
        getPositions(privateKey),
        getMarkets(0),
        getLeaderboard(10, 'day'),
      ]);
      const market = markets.find(m => m.asset.toUpperCase() === asset.toUpperCase());
      if (!market) return reply.code(404).send({ error: `Market ${asset} not found` });

      // 2) Check top traders' positioning on this asset (parallel fetch)
      const traderIntels = await Promise.all(leaders.slice(0, 5).map(async l => {
        try { return { leader: l, intel: await getTraderIntel(l.address, 0) }; }
        catch { return null; }
      }));
      const leaderPositions = traderIntels
        .filter(x => x && !x.intel.isVaultLike)
        .map(x => {
          const pos = (x.intel.positions || []).find(p => p.asset.toUpperCase() === asset.toUpperCase());
          return pos ? { who: x.leader.displayName || x.leader.address.slice(0, 8), ...pos } : null;
        })
        .filter(Boolean);

      // 3) User's existing position on this asset (if any)
      const userPos = positions.find(p => p.asset.toUpperCase() === asset.toUpperCase());

      // 4) Build prompt
      const intelBlock = [
        `Market: ${market.asset}-PERP`,
        `Mark Price: $${market.markPrice}`,
        `24h Change: ${market.change24h.toFixed(2)}%`,
        `24h Volume: $${(market.volume24h / 1e6).toFixed(1)}M`,
        `Open Interest: $${(market.openInterest * market.markPrice / 1e6).toFixed(1)}M notional`,
        `Funding Rate: ${(market.fundingRate * 100).toFixed(4)}% per 8h (${market.fundingRate > 0 ? 'longs paying shorts — crowded long' : 'shorts paying longs — crowded short'})`,
        `Max Leverage: ${market.maxLeverage}x`,
        ``,
        `User Account:`,
        `- Available: $${account.available.toFixed(2)}`,
        `- Account Value: $${account.accountValue.toFixed(2)}`,
        `- Margin Used: ${account.marginUsedPct.toFixed(0)}%`,
        `- Existing position on ${asset}: ${userPos ? `${userPos.side} ${userPos.size} @ $${userPos.entryPrice}, PnL $${userPos.pnl.toFixed(2)}` : 'NONE'}`,
        ``,
        `Top Smart Wallets (24h leaderboard) positioning on ${asset}:`,
        leaderPositions.length > 0
          ? leaderPositions.map(p => `- ${p.who}: ${p.side.toUpperCase()} ${p.size} @ $${p.entryPrice} (value $${(p.value / 1000).toFixed(1)}k, ${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(0)} PnL, ${p.leverage}x)`).join('\n')
          : '- No top traders are currently holding this asset',
      ].join('\n');

      const system = `You are a disciplined crypto derivatives analyst for the KANet trading console. You analyze Hyperliquid perps using funding rates, open interest, whale positioning, and the user's account state. You are cautious, size-aware, and always specify a stop-loss. Reply in Chinese. Respond ONLY with valid JSON in this exact schema — no markdown, no prose outside JSON:
{
  "direction": "LONG" | "SHORT" | "SKIP",
  "confidence": 0-100,
  "sizeUsd": number (dollar notional, respects user's available balance and risk),
  "leverage": 1-5,
  "entryPrice": number,
  "stopLoss": number,
  "takeProfit": number,
  "reasoning": ["短理由1", "短理由2", "短理由3"],
  "risks": ["风险1", "风险2"],
  "summary": "一句话总结"
}`;

      const userPrompt = `Analyze ${asset}-PERP and give a trade recommendation.\n\n${intelBlock}\n\nProvide a disciplined recommendation. If conditions are unclear or risk is too high, return direction=SKIP. Size must not exceed 30% of user's available balance. Stop loss must be within 2-5% of entry.`;

      // 5) Call adapter
      const relay = sqlite.prepare(
        `SELECT r.name, a.http_port FROM relay_nodes r JOIN adapter_nodes a ON a.id = r.adapter_node_id WHERE a.http_port IS NOT NULL LIMIT 1`
      ).get();
      if (!relay?.http_port) return reply.code(503).send({ error: 'No AI adapter available' });

      const res = await fetch(`http://localhost:${relay.http_port}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: 'system', mindSystem: system, mindUser: userPrompt, mindTask: true }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      const raw = data?.reply || data?.content || data?.text || '';

      // 6) Parse JSON — tolerate fences/noise
      let parsed = null;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {}

      return reply.send({
        ok: true,
        market: { asset: market.asset, markPrice: market.markPrice, fundingRate: market.fundingRate },
        agent: relay.name,
        parsed,
        raw: parsed ? undefined : raw,
        intel: { userPos, leaderPositions, account: { available: account.available, accountValue: account.accountValue } },
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/positions
  fastify.get('/api/defi/hyperliquid/positions', async (request, reply) => {
    const { walletId } = request.query;
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { getPositions } = await import('../services/hyperliquid-client.js');
      return reply.send({ ok: true, positions: await getPositions(privateKey) });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/hyperliquid/order — place order (stop_loss mandatory)
  fastify.post('/api/defi/hyperliquid/order', async (request, reply) => {
    const { walletId, asset, side, size, price, type = 'market', leverage, stopLoss } = request.body || {};
    if (!walletId || !asset || !side || !size) return reply.code(400).send({ error: 'walletId, asset, side, size required' });
    if (!stopLoss) return reply.code(400).send({ error: 'stop_loss is mandatory for all positions' });

    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    // Safety: max leverage check
    const { getConfig } = await import('../data/settings/configs.js');
    const maxLev = parseInt(await getConfig('hyper_max_leverage') || '5');
    if (leverage && leverage > maxLev) return reply.code(400).send({ error: `Leverage ${leverage} exceeds max ${maxLev}` });

    // Safety: max position size
    const maxPos = parseFloat(await getConfig('hyper_max_position_usdc') || '50');
    const estimatedValue = parseFloat(size) * (parseFloat(price) || 1);
    if (estimatedValue > maxPos) return reply.code(400).send({ error: `Position ~$${estimatedValue.toFixed(0)} exceeds max $${maxPos}` });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { placeOrder } = await import('../services/hyperliquid-client.js');
      const result = await placeOrder(privateKey, { asset, side, size: parseFloat(size), price: price ? parseFloat(price) : undefined, type, leverage, stopLoss: parseFloat(stopLoss) });
      if (result.ok) recordChainEvent({ txid: result.orderId || asset, eventType: 'hyper_order', payload: JSON.stringify({ asset, side, size, leverage, stopLoss }) });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/hyperliquid/close — close position
  fastify.post('/api/defi/hyperliquid/close', async (request, reply) => {
    const { walletId, asset } = request.body || {};
    if (!walletId || !asset) return reply.code(400).send({ error: 'walletId, asset required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { closePosition } = await import('../services/hyperliquid-client.js');
      const result = await closePosition(privateKey, asset);
      if (result.ok) recordChainEvent({ txid: asset, eventType: 'hyper_close', payload: JSON.stringify({ asset, closedSize: result.closedSize }) });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/defi/hyperliquid/order/:id — cancel order
  fastify.delete('/api/defi/hyperliquid/order/:id', async (request, reply) => {
    const { walletId, asset } = request.query;
    if (!walletId || !asset) return reply.code(400).send({ error: 'walletId, asset required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { cancelOrder } = await import('../services/hyperliquid-client.js');
      const result = await cancelOrder(privateKey, asset, request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/funding
  fastify.get('/api/defi/hyperliquid/funding', async (request, reply) => {
    const { walletId, assets } = request.query;
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { getFundingRates } = await import('../services/hyperliquid-client.js');
      const assetList = assets ? assets.split(',') : ['BTC', 'ETH'];
      return reply.send({ ok: true, funding: await getFundingRates(privateKey, assetList) });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/balances — Arb wallet ETH/USDC balances
  fastify.get('/api/defi/hyperliquid/balances', async (request, reply) => {
    const { walletId } = request.query;
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });
    try {
      const { getArbBalances } = await import('../services/hyperliquid-deposit.js');
      const balances = await getArbBalances(wallet.address);
      return reply.send({ ok: true, address: wallet.address, ...balances });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/hyperliquid/withdraw — withdraw USDC from HL account back to Arbitrum
  //
  // HL minimum: 2 USDC. Fixed $1 withdrawal fee. Funds arrive on Arbitrum in ~1 minute.
  // Destination defaults to the wallet's own Arbitrum address (same derivation).
  fastify.post('/api/defi/hyperliquid/withdraw', async (request, reply) => {
    const { walletId, amount, destination } = request.body || {};
    if (!walletId || amount === undefined) return reply.code(400).send({ error: 'walletId and amount required' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 2) return reply.code(400).send({ error: 'Minimum withdrawal is 2 USDC' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);

      // Safety: check HL account has enough to withdraw
      const { getAccountInfo, withdrawUsdc } = await import('../services/hyperliquid-client.js');
      const account = await getAccountInfo(privateKey);
      if (account.available < amt) {
        return reply.code(400).send({
          error: `Insufficient HL available balance: have $${account.available.toFixed(2)}, requested $${amt}`,
          available: account.available,
          requested: amt,
        });
      }

      const result = await withdrawUsdc(privateKey, amt, destination || null);
      if (result.ok) {
        recordChainEvent({
          txid: 'hyper_withdraw_' + Date.now(),
          eventType: 'hyper_withdraw',
          payload: JSON.stringify({ amount: amt, destination: result.destination, chain: 'arbitrum' }),
        });
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/hyperliquid/deposit — transfer USDC from Arb wallet to HL bridge
  fastify.post('/api/defi/hyperliquid/deposit', async (request, reply) => {
    const { walletId, amount } = request.body || {};
    if (!walletId || amount === undefined) return reply.code(400).send({ error: 'walletId and amount required' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return reply.code(400).send({ error: 'invalid amount' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });
    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { depositUsdc } = await import('../services/hyperliquid-deposit.js');
      const result = await depositUsdc(privateKey, amt);
      if (result.ok) {
        recordChainEvent({
          txid: result.txHash,
          eventType: 'hyper_deposit',
          payload: JSON.stringify({ amount: amt, chain: 'arbitrum', block: result.blockNumber }),
        });
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/leaderboard — public smart wallets list
  fastify.get('/api/defi/hyperliquid/leaderboard', async (request, reply) => {
    try {
      const { getLeaderboard } = await import('../services/hyperliquid-client.js');
      const limit = parseInt(request.query?.limit) || 10;
      const window = request.query?.window || 'week';
      return reply.send({ ok: true, leaders: await getLeaderboard(limit, window) });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/fills — recent fills for any address (public)
  fastify.get('/api/defi/hyperliquid/fills', async (request, reply) => {
    const { address } = request.query;
    if (!address) return reply.code(400).send({ error: 'address required' });
    try {
      const { getUserFills } = await import('../services/hyperliquid-client.js');
      return reply.send({ ok: true, fills: await getUserFills(address, parseInt(request.query?.limit) || 20) });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/hyperliquid/trader — full intel: positions + fills in one call
  fastify.get('/api/defi/hyperliquid/trader', async (request, reply) => {
    const { address } = request.query;
    if (!address) return reply.code(400).send({ error: 'address required' });
    try {
      const { getTraderIntel } = await import('../services/hyperliquid-client.js');
      const intel = await getTraderIntel(address, parseInt(request.query?.limit) || 20);
      return reply.send({ ok: true, ...intel });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── Aevo Options ─────────────────────────────────────────────

  // GET /api/defi/aevo/connection-status — check if agent has Aevo credentials configured
  // Accepts adapterId (preferred) OR agentId (= relay id, we'll resolve adapter_node_id)
  fastify.get('/api/defi/aevo/connection-status', async (request, reply) => {
    const { adapterId: queryAdapterId, agentId } = request.query;
    let adapterId = queryAdapterId;
    if (!adapterId && agentId) {
      const relay = sqlite.prepare('SELECT adapter_node_id FROM relay_nodes WHERE id = ?').get(agentId);
      adapterId = relay?.adapter_node_id;
    }
    if (!adapterId) return reply.code(400).send({ error: 'adapterId or agentId required' });

    const row = sqlite.prepare(
      `SELECT id, api_key_enc, gateway_token_enc, signing_key_enc, status, updated_at
       FROM agent_connections
       WHERE adapter_node_id = ? AND provider = 'aevo'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(adapterId);

    if (!row || !row.api_key_enc) {
      return reply.send({ ok: true, connected: false });
    }

    // Try to decrypt API key for display (masked)
    let apiKeyMasked = null;
    try {
      const key = decrypt(row.api_key_enc);
      apiKeyMasked = key.length > 12 ? key.slice(0, 6) + '...' + key.slice(-4) : '***';
    } catch {}

    return reply.send({
      ok: true,
      connected: row.status === 'connected' && !!row.api_key_enc,
      apiKeyMasked,
      hasSigningKey: !!row.signing_key_enc,
      updatedAt: row.updated_at,
    });
  });

  // POST /api/defi/aevo/save-credentials — create or update Aevo credentials
  fastify.post('/api/defi/aevo/save-credentials', async (request, reply) => {
    const { adapterId, agentId, apiKey, apiSecret, signingKey } = request.body || {};
    if (!apiKey || !apiSecret) return reply.code(400).send({ error: 'apiKey and apiSecret required' });

    let resolvedAdapterId = adapterId;
    if (!resolvedAdapterId && agentId) {
      const relay = sqlite.prepare('SELECT adapter_node_id FROM relay_nodes WHERE id = ?').get(agentId);
      resolvedAdapterId = relay?.adapter_node_id;
    }
    if (!resolvedAdapterId) return reply.code(400).send({ error: 'adapterId or agentId required' });

    try {
      const apiKeyEnc = encrypt(apiKey);
      const apiSecretEnc = encrypt(apiSecret);
      const signingKeyEnc = signingKey ? encrypt(signingKey) : null;
      const now = new Date().toISOString();

      // Upsert: delete existing then insert
      const existing = sqlite.prepare(
        `SELECT id FROM agent_connections WHERE adapter_node_id = ? AND provider = 'aevo'`
      ).get(resolvedAdapterId);

      if (existing) {
        sqlite.prepare(
          `UPDATE agent_connections
           SET api_key_enc = ?, gateway_token_enc = ?, signing_key_enc = ?, status = 'connected', updated_at = ?
           WHERE id = ?`
        ).run(apiKeyEnc, apiSecretEnc, signingKeyEnc, now, existing.id);
      } else {
        sqlite.prepare(
          `INSERT INTO agent_connections
           (id, adapter_node_id, provider, auth_mode, status, api_key_enc, gateway_token_enc, signing_key_enc, credential_version, created_at, updated_at)
           VALUES (?, ?, 'aevo', 'api_key', 'connected', ?, ?, ?, 1, ?, ?)`
        ).run(randomUUID(), resolvedAdapterId, apiKeyEnc, apiSecretEnc, signingKeyEnc, now, now);
      }

      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/defi/aevo/credentials — disconnect (remove credentials)
  fastify.delete('/api/defi/aevo/credentials', async (request, reply) => {
    const { adapterId: queryAdapterId, agentId } = request.query;
    let adapterId = queryAdapterId;
    if (!adapterId && agentId) {
      const relay = sqlite.prepare('SELECT adapter_node_id FROM relay_nodes WHERE id = ?').get(agentId);
      adapterId = relay?.adapter_node_id;
    }
    if (!adapterId) return reply.code(400).send({ error: 'adapterId or agentId required' });

    try {
      sqlite.prepare(
        `DELETE FROM agent_connections WHERE adapter_node_id = ? AND provider = 'aevo'`
      ).run(adapterId);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/aevo/markets — public markets (no credentials needed)
  fastify.get('/api/defi/aevo/markets', async (request, reply) => {
    const { asset } = request.query;
    try {
      const { getPublicMarkets } = await import('../services/aevo-client.js');
      const markets = await getPublicMarkets(asset || null);
      return reply.send({ ok: true, markets, count: markets.length });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/aevo/analyze — AI advice on options strategy (no Aevo creds required)
  //
  // Gathers: requested asset's option chain (public)
  //        + Hyperliquid position on same asset (for directional context)
  //        + User's Arb wallet state
  // Calls local adapter for structured recommendation.
  // Accepts either walletId (specific wallet) or agentId (resolves first Arb wallet of that agent).
  fastify.post('/api/defi/aevo/analyze', async (request, reply) => {
    const { walletId, agentId, asset = 'ETH' } = request.body || {};
    if (!walletId && !agentId) return reply.code(400).send({ error: 'walletId or agentId required' });

    let wallet;
    if (walletId) {
      wallet = sqlite.prepare('SELECT address, chain, privkey_encrypted FROM agent_wallets WHERE id = ?').get(walletId);
    } else {
      // Resolve first Arbitrum wallet of the agent
      wallet = sqlite.prepare(
        `SELECT w.address, w.chain, w.privkey_encrypted
         FROM agent_wallets w
         WHERE w.relay_node_id = ? AND w.chain = 'arbitrum'
         LIMIT 1`
      ).get(agentId);
    }
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found (need an Arbitrum wallet)' });

    try {
      const { getPublicMarkets } = await import('../services/aevo-client.js');
      const markets = await getPublicMarkets(asset);

      // Find the perp (for spot-equivalent price reference)
      const perp = markets.find(m => m.type === 'PERPETUAL' && m.underlying === asset);
      const markPrice = perp?.markPrice || 0;

      // Pick nearest expiry options
      const options = markets.filter(m => m.type === 'OPTION' && m.isActive);
      const expirySet = [...new Set(options.map(o => o.expiry).filter(Boolean))].sort();
      const nearestExpiry = expirySet[0] || null;
      const atmOptions = options
        .filter(o => o.expiry === nearestExpiry)
        .sort((a, b) => Math.abs((a.strike || 0) - markPrice) - Math.abs((b.strike || 0) - markPrice))
        .slice(0, 10);

      // Try HL cross-market intel
      let hlState = null;
      if (wallet.chain === 'arbitrum' && wallet.privkey_encrypted) {
        try {
          const privateKey = decrypt(wallet.privkey_encrypted);
          const { getAccountInfo, getPositions } = await import('../services/hyperliquid-client.js');
          const [acct, pos] = await Promise.all([getAccountInfo(privateKey), getPositions(privateKey)]);
          const posOnAsset = pos.find(p => p.asset.toUpperCase() === asset.toUpperCase());
          hlState = { accountValue: acct.accountValue, available: acct.available, marginPct: acct.marginUsedPct, positionOnAsset: posOnAsset || null };
        } catch {}
      }

      // Build prompt
      const lines = [
        `标的: ${asset}`,
        `现货等价价 (PERP mark): $${markPrice.toFixed(2)}`,
        `最近到期日: ${nearestExpiry || '未找到'}`,
        ``,
        `可用行权价（按距现价排序，前 10）:`,
        ...atmOptions.map(o => `- ${o.instrumentName} | ${o.optionType?.toUpperCase() || '?'} @ $${o.strike} | IV ${o.iv ? (o.iv * 100).toFixed(0) + '%' : '—'} | Δ ${o.delta?.toFixed(2) || '—'}`),
        ``,
      ];
      if (hlState) {
        lines.push(`Hyperliquid 同 Agent 状态（跨市场联动依据）:`);
        lines.push(`- HL 账户值: $${hlState.accountValue.toFixed(2)}`);
        lines.push(`- HL 可用: $${hlState.available.toFixed(2)}`);
        lines.push(`- HL 保证金占用: ${hlState.marginPct.toFixed(0)}%`);
        if (hlState.positionOnAsset) {
          const p = hlState.positionOnAsset;
          lines.push(`- HL 在 ${asset} 上的仓位: ${p.side.toUpperCase()} ${p.size} @ $${p.entryPrice}, PnL $${p.pnl.toFixed(2)}`);
        } else {
          lines.push(`- HL 在 ${asset} 上无仓位`);
        }
      }

      const system = `你是 KANet 的期权策略分析师。你关心隐含波动率偏斜、Delta 对冲、Theta 损耗、跨市场对冲机会。
特别警惕：Aevo 有"裸卖期权"风险 — 不要推荐用户卖出无底仓的期权。
如果用户在 HL 有同资产的方向性持仓，分析是否可以用期权做保护（保护性 Put）或扩大收益（Covered Call）。
回复严格 JSON，无 markdown，schema:
{
  "assessment": "opportunity" | "neutral" | "avoid",
  "recommendation": "ACTION_NAME",
  "strategy": {
    "type": "buy_call" | "buy_put" | "sell_call_covered" | "hedge_put" | "collar" | "none",
    "instrument": "合约全名如 ETH-20260501-2200-C",
    "reasoning": "一句话理由"
  },
  "crossMarketSuggestion": "跨 HL 联动建议，若无则空",
  "greeks": "对关键 Greeks 的一句话解读",
  "risks": ["风险1", "风险2"],
  "summary": "一句话总结"
}`;
      const userPrompt = lines.join('\n') + `\n\n给出分析。小账户（<\$200）不要推荐裸卖。如果 HL 有 ${asset} LONG 仓位，考虑保护性 PUT 对冲。`;

      const relay = sqlite.prepare(
        `SELECT r.name, a.http_port FROM relay_nodes r JOIN adapter_nodes a ON a.id = r.adapter_node_id WHERE a.http_port IS NOT NULL LIMIT 1`
      ).get();
      if (!relay?.http_port) return reply.code(503).send({ error: 'No AI adapter available' });

      const res = await fetch(`http://localhost:${relay.http_port}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: 'system', mindSystem: system, mindUser: userPrompt, mindTask: true }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      const raw = data?.reply || data?.content || data?.text || '';
      let parsed = null;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {}

      return reply.send({
        ok: true,
        agent: relay.name,
        parsed,
        raw: parsed ? undefined : raw,
        intel: {
          asset,
          markPrice,
          nearestExpiry,
          optionsShown: atmOptions.length,
          hl: hlState,
        },
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/aevo/account — account status
  fastify.get('/api/defi/aevo/account', async (request, reply) => {
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    try {
      const { loadCredentials, getAccount } = await import('../services/aevo-client.js');
      const creds = await loadCredentials(agentId);
      if (!creds) return reply.code(404).send({ error: 'No Aevo credentials configured' });
      return reply.send(await getAccount(creds));
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/aevo/positions — current positions with Greeks
  fastify.get('/api/defi/aevo/positions', async (request, reply) => {
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    try {
      const { loadCredentials, getPositions } = await import('../services/aevo-client.js');
      const creds = await loadCredentials(agentId);
      if (!creds) return reply.code(404).send({ error: 'No Aevo credentials configured' });
      return reply.send({ ok: true, positions: await getPositions(creds) });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/defi/aevo/orderbook/:instrument — order book
  fastify.get('/api/defi/aevo/orderbook/:instrument', async (request, reply) => {
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    try {
      const { loadCredentials, getOrderbook } = await import('../services/aevo-client.js');
      const creds = await loadCredentials(agentId);
      if (!creds) return reply.code(404).send({ error: 'No Aevo credentials configured' });
      return reply.send(await getOrderbook(creds, request.params.instrument));
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/defi/aevo/order — place order (naked short check)
  fastify.post('/api/defi/aevo/order', async (request, reply) => {
    const { agentId, walletId, instrument, side, amount, price, orderType = 'limit' } = request.body || {};
    if (!agentId || !instrument || !side || !amount) return reply.code(400).send({ error: 'agentId, instrument, side, amount required' });

    // Naked short check: selling without existing position needs approval
    if (side.toLowerCase() === 'sell') {
      const { getConfig } = await import('../data/settings/configs.js');
      const nakedMode = await getConfig('aevo_naked_short_mode') || 'forbidden';
      if (nakedMode === 'forbidden') {
        return reply.code(403).send({ error: 'Selling options (naked short) is forbidden. Change aevo_naked_short_mode to approval or auto.' });
      }
      // approval mode: could create execution_states proposal here (future)
    }

    try {
      const { loadCredentials, getSigningKeyFromWallet, createOrder } = await import('../services/aevo-client.js');
      const creds = await loadCredentials(agentId);
      if (!creds) return reply.code(404).send({ error: 'No Aevo credentials configured' });

      let signingKey = null;
      if (walletId) {
        signingKey = await getSigningKeyFromWallet(walletId);
      }

      const result = await createOrder(creds, signingKey, { instrument, side, amount: parseFloat(amount), price: price ? parseFloat(price) : undefined, orderType });
      if (result.ok) {
        recordChainEvent({ txid: result.orderId || instrument, eventType: 'aevo_order', payload: JSON.stringify({ instrument, side, amount, price }) });
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/defi/aevo/order/:id — cancel order
  fastify.delete('/api/defi/aevo/order/:id', async (request, reply) => {
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId required' });
    try {
      const { loadCredentials, cancelOrder } = await import('../services/aevo-client.js');
      const creds = await loadCredentials(agentId);
      if (!creds) return reply.code(404).send({ error: 'No Aevo credentials configured' });
      const result = await cancelOrder(creds, request.params.id);
      if (result) recordChainEvent({ txid: request.params.id, eventType: 'aevo_cancel', payload: '{}' });
      return reply.send({ ok: result });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // ── Independent DeFi Pages ───────────────────────────────
  // ══════════════════════════════════════════════════════════

  fastify.get('/aave', async (request, reply) => {
    return reply.view('aave.eta', { _page: 'aave', pageTitle: 'Aave Lending — KANet' });
  });

  fastify.get('/hyperliquid', async (request, reply) => {
    return reply.view('hyperliquid.eta', { _page: 'hyperliquid', pageTitle: 'Hyperliquid Perps — KANet' });
  });

  fastify.get('/aevo', async (request, reply) => {
    return reply.view('aevo.eta', { _page: 'aevo', pageTitle: 'Aevo Options — KANet' });
  });
}
