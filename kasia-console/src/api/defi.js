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
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
