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
import { decrypt } from '../services/crypto.js';
import { recordChainEvent } from '../services/chain-event.js';

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
      const [account, usdcBal] = await Promise.all([
        getAccountData(wallet.address),
        getTokenBalance(wallet.address, 'usdc'),
      ]);

      return reply.send({
        ok: true,
        address: wallet.address,
        account,
        walletBalance: { usdc: usdcBal },
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

  // GET /api/defi/hyperliquid/status — account + positions
  fastify.get('/api/defi/hyperliquid/status', async (request, reply) => {
    const { walletId } = request.query;
    if (!walletId) return reply.code(400).send({ error: 'walletId required' });
    const { wallet, error, code } = getArbitrumWallet(walletId);
    if (error) return reply.code(code).send({ error });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const { getAccountInfo, getPositions, getFundingRates } = await import('../services/hyperliquid-client.js');
      const [account, positions, funding] = await Promise.all([
        getAccountInfo(privateKey),
        getPositions(privateKey),
        getFundingRates(privateKey, ['BTC', 'ETH']),
      ]);
      return reply.send({ ok: true, account, positions, funding });
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
}
