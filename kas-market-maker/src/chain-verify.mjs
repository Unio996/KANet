/**
 * chain-verify.mjs — Verify cross-chain USDT payments
 * Supports BNB, ETH, SOL, TRON via their respective explorer APIs.
 */

export class ChainVerifier {
  constructor(chainsConfig) {
    this.chains = chainsConfig;
  }

  /**
   * Verify a USDT payment on an external chain.
   * @param {string} chain — 'bnb' | 'eth' | 'sol' | 'tron'
   * @param {string} fromAddress — sender address
   * @param {number} expectedAmount — expected USDT amount
   * @param {string} toAddress — MM's receive address on that chain
   * @returns {{ verified, txHash, actualAmount, confirmations }}
   */
  async verifyPayment(chain, fromAddress, expectedAmount, toAddress) {
    const config = this.chains[chain];
    if (!config) throw new Error(`Unsupported chain: ${chain}`);

    switch (chain) {
      case 'bnb': return this._verifyEvm(config, fromAddress, expectedAmount, toAddress, 'bsc');
      case 'eth': return this._verifyEvm(config, fromAddress, expectedAmount, toAddress, 'eth');
      case 'sol': return this._verifySolana(config, fromAddress, expectedAmount, toAddress);
      case 'tron': return this._verifyTron(config, fromAddress, expectedAmount, toAddress);
      default: throw new Error(`Chain ${chain} not implemented`);
    }
  }

  /** Verify EVM-compatible chain (BNB, ETH) token transfer */
  async _verifyEvm(config, from, expectedAmount, to, network) {
    const params = new URLSearchParams({
      module: 'account',
      action: 'tokentx',
      contractaddress: config.usdtContract,
      address: to,
      page: '1',
      offset: '10',
      sort: 'desc',
    });
    if (config.apiKey) params.set('apikey', config.apiKey);

    const res = await fetch(`${config.explorerApi}?${params}`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();

    if (data.status !== '1' || !Array.isArray(data.result)) {
      return { verified: false, reason: 'API error or no transactions' };
    }

    // Find matching transfer: from → to, amount matches (within 1% tolerance)
    const decimals = 18; // USDT on BSC/ETH uses 18/6 decimals — check contract
    for (const tx of data.result) {
      if (tx.from?.toLowerCase() !== from.toLowerCase()) continue;
      if (tx.to?.toLowerCase() !== to.toLowerCase()) continue;

      const tokenDecimals = parseInt(tx.tokenDecimal || '18');
      const amount = parseFloat(tx.value) / Math.pow(10, tokenDecimals);
      const tolerance = expectedAmount * 0.01; // 1% tolerance

      if (Math.abs(amount - expectedAmount) <= tolerance) {
        return {
          verified: true,
          txHash: tx.hash,
          actualAmount: amount,
          confirmations: parseInt(tx.confirmations || '0'),
          blockNumber: tx.blockNumber,
        };
      }
    }

    return { verified: false, reason: 'No matching transfer found' };
  }

  /** Verify Solana SPL token transfer */
  async _verifySolana(config, from, expectedAmount, to) {
    const res = await fetch(`${config.explorerApi}/account/splTransfers?account=${to}&limit=10`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();

    if (!data.data?.length) return { verified: false, reason: 'No transfers found' };

    for (const tx of data.data) {
      if (tx.tokenAddress !== config.usdtMint) continue;
      if (tx.source !== from) continue;

      const amount = parseFloat(tx.amount) / 1e6; // USDT on SOL = 6 decimals
      const tolerance = expectedAmount * 0.01;

      if (Math.abs(amount - expectedAmount) <= tolerance) {
        return {
          verified: true,
          txHash: tx.signature || tx.txHash,
          actualAmount: amount,
          confirmations: tx.slot ? 1 : 0,
        };
      }
    }

    return { verified: false, reason: 'No matching transfer found' };
  }

  /** Verify TRON TRC-20 token transfer */
  async _verifyTron(config, from, expectedAmount, to) {
    const res = await fetch(
      `${config.explorerApi}/v1/accounts/${to}/transactions/trc20?contract_address=${config.usdtContract}&limit=10`,
      { signal: AbortSignal.timeout(10000) },
    );
    const data = await res.json();

    if (!data.data?.length) return { verified: false, reason: 'No transfers found' };

    for (const tx of data.data) {
      if (tx.from?.toLowerCase() !== from.toLowerCase()) continue;

      const amount = parseFloat(tx.value) / 1e6; // USDT on TRON = 6 decimals
      const tolerance = expectedAmount * 0.01;

      if (Math.abs(amount - expectedAmount) <= tolerance) {
        return {
          verified: true,
          txHash: tx.transaction_id,
          actualAmount: amount,
          confirmations: 1,
        };
      }
    }

    return { verified: false, reason: 'No matching transfer found' };
  }
}
