/**
 * Cross-Chain Token Payment Verification
 *
 * Extracted from trading.js (2026-04-06). Extended for multi-token (P2a, 2026-04-12).
 * Pure verification logic — no DB writes, no business state transitions.
 * Caller is responsible for recording chain_events, execution_states, etc.
 *
 * Supported chains: bnb, eth, polygon (EVM), sol (Solana), tron (TRC20)
 * Supported tokens: USDT, USDC, DAI (per chain)
 */

const REQUIRED_CONFIRMATIONS = { bnb: 15, eth: 12, polygon: 35, arbitrum: 12, optimism: 12, avalanche: 12, base: 12, sol: 32, tron: 19, kaspa: 1 };

const EVM_RPC = {
  bnb: 'https://bsc-dataseed1.binance.org',
  eth: 'https://eth.llamarpc.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  base: 'https://mainnet.base.org',
};

// ── Multi-token address table (5 chains) ─────────────────────
// P2a: replaces single EVM_USDT. All verified mainnet contract addresses.
// TRAP: BNB USDT/USDC are 18 decimals, NOT 6. DAI is 18 everywhere.

const EVM_TOKENS = {
  bnb: {
    usdt: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    usdc: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    dai:  { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
  },
  eth: {
    usdt: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    dai:  { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  },
  polygon: {
    usdt: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    usdc: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    dai:  { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
  },
  arbitrum: {
    usdt: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    dai:  { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
  },
  optimism: {
    usdt: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    usdc: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    dai:  { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
  },
  avalanche: {
    usdt: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    usdc: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    dai:  { address: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', decimals: 18 },
  },
  base: {
    usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    dai:  { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
    // Note: no official Tether USDT on Base
  },
};

const SOL_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_TOKENS = {
  usdt: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

const TRON_RPC = 'https://api.trongrid.io';
const TRON_TOKENS = {
  usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  usdc: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
};

// Backward compat aliases
const EVM_USDT = Object.fromEntries(Object.entries(EVM_TOKENS).map(([chain, tokens]) => [chain, tokens.usdt]));
const SOL_USDT_MINT = SOL_TOKENS.usdt;
const TRON_USDT_ADDR = TRON_TOKENS.usdt;

/**
 * Verify a cross-chain token payment TX.
 *
 * @param {object} params
 * @param {string} params.txHash        - TX hash on the target chain
 * @param {string} params.chain         - bnb/eth/polygon/sol/tron
 * @param {number} params.expectedAmount - Expected token amount
 * @param {string} [params.expectedTo]  - Expected recipient address
 * @param {string} [params.expectedFrom] - Expected sender address (optional)
 * @param {string} [params.paymentAsset='usdt'] - Token to verify: usdt/usdc/dai
 * @returns {Promise<{
 *   confirmed: boolean,
 *   confirmations: number,
 *   required: number,
 *   actualAmount: number,
 *   recipient: string,
 *   sender: string,
 *   error?: string,
 *   underpayment?: boolean
 * }>}
 */
export async function verifyCrossChainTx({ txHash, chain, expectedAmount, expectedTo, expectedFrom, paymentAsset = 'usdt' }) {
  const required = REQUIRED_CONFIRMATIONS[chain] || 15;
  const asset = (paymentAsset || 'usdt').toLowerCase();

  if (['bnb', 'eth', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base'].includes(chain)) {
    return _verifyEvm({ txHash, chain, expectedAmount, expectedTo, expectedFrom, required, asset });
  }
  if (chain === 'sol') {
    return _verifySolana({ txHash, expectedAmount, expectedTo, required, asset });
  }
  if (chain === 'tron') {
    return _verifyTron({ txHash, expectedAmount, expectedTo, required, asset });
  }

  if (chain === 'kaspa') {
    // Kaspa TX verification — uses embedded indexer (kaspa_tx_log) first,
    // RPC UTXO query as fallback. Previous version was a hardcoded "trust txId"
    // stub that bypassed all verification (and orphaned _verifyKaspa as dead code).
    // With the indexer in place (Relay block-added hook), real verification is
    // cheap and reliable — no reason to short-circuit.
    return _verifyKaspa({ txHash, expectedAmount, expectedTo, required: 1 });
  }

  return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: `Unsupported chain: ${chain}` };
}

// ── Native coin identifiers (not in EVM_TOKENS = native) ────
const NATIVE_COINS = new Set(['eth', 'bnb', 'matic', 'avax', 'native']);

function isNativeAsset(asset, chain) {
  if (NATIVE_COINS.has(asset)) return true;
  // If asset not in token table for this chain, treat as native
  return !EVM_TOKENS[chain]?.[asset];
}

// ── EVM (BNB / ETH) ──────────────────────────────────────────

async function _verifyEvm({ txHash, chain, expectedAmount, expectedTo, expectedFrom, required, asset = 'usdt' }) {
  const { ethers } = await import('ethers');
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(EVM_RPC[chain]);

    // P2b: Native coin verification — check TX value field, no Transfer event parsing
    if (isNativeAsset(asset, chain)) {
      return await _verifyEvmNative({ txHash, chain, expectedAmount, expectedTo, expectedFrom, required, provider, ethers });
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: 'TX not found or still pending' };
    }
    if (receipt.status !== 1) {
      return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: 'TX reverted (status=0)' };
    }

    const currentBlock = await provider.getBlockNumber();
    const confirmations = receipt.blockNumber ? (currentBlock - receipt.blockNumber) : 0;
    if (confirmations < required) {
      return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `Insufficient confirmations: ${confirmations}/${required}` };
    }

    // Resolve token contract from multi-token table
    const tokenInfo = EVM_TOKENS[chain]?.[asset] || EVM_TOKENS[chain]?.usdt;
    if (!tokenInfo) {
      return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `No token config for ${asset} on ${chain}` };
    }

    // Parse ERC20 Transfer log (works for USDT, USDC, DAI — all standard ERC20)
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const tokenLower = tokenInfo.address.toLowerCase();
    const transferLog = receipt.logs.find(l =>
      l.address.toLowerCase() === tokenLower && l.topics[0] === transferTopic
    );

    if (!transferLog) {
      return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `No ${asset.toUpperCase()} transfer found in TX` };
    }

    const actualAmount = parseFloat(ethers.formatUnits(transferLog.data, tokenInfo.decimals));
    const recipient = '0x' + transferLog.topics[2].slice(26);
    const sender = '0x' + transferLog.topics[1].slice(26);

    // Amount check (0.5% tolerance)
    const amountOk = actualAmount >= (expectedAmount || 0) * 0.995;
    const recipientOk = !expectedTo || recipient.toLowerCase() === expectedTo.toLowerCase();
    const senderOk = !expectedFrom || sender.toLowerCase() === expectedFrom.toLowerCase();

    if (!amountOk) {
      return { confirmed: false, confirmations, required, actualAmount, recipient, sender, underpayment: true, error: `Underpayment: expected ${expectedAmount}, got ${actualAmount.toFixed(2)}` };
    }
    if (!recipientOk) {
      return { confirmed: false, confirmations, required, actualAmount, recipient, sender, error: `Recipient mismatch: expected ${expectedTo}, got ${recipient}` };
    }

    return { confirmed: true, confirmations, required, actualAmount, recipient, sender, senderMismatch: !senderOk && !!expectedFrom };
  } finally {
    // Release ethers internal retry loop when provider URL is slow/dead.
    try { provider?.destroy?.(); } catch {}
  }
}

// ── P2b: EVM Native Coin Verification ───────────────────────
// Verifies native coin transfers (ETH/BNB/MATIC/AVAX) by checking TX value field.
// Simpler than ERC20 — no Transfer event log parsing needed.

async function _verifyEvmNative({ txHash, chain, expectedAmount, expectedTo, expectedFrom, required, provider, ethers }) {
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: 'TX not found or still pending' };
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: receipt ? 'TX reverted (status=0)' : 'Receipt not available' };
  }

  const currentBlock = await provider.getBlockNumber();
  const confirmations = receipt.blockNumber ? (currentBlock - receipt.blockNumber) : 0;
  if (confirmations < required) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `Insufficient confirmations: ${confirmations}/${required}` };
  }

  // Native coin: amount is in TX value field (wei), always 18 decimals
  const actualAmount = parseFloat(ethers.formatEther(tx.value));
  const recipient = tx.to || '';
  const sender = tx.from || '';

  const amountOk = actualAmount >= (expectedAmount || 0) * 0.995;
  const recipientOk = !expectedTo || recipient.toLowerCase() === expectedTo.toLowerCase();
  const senderOk = !expectedFrom || sender.toLowerCase() === expectedFrom.toLowerCase();

  if (!amountOk) {
    return { confirmed: false, confirmations, required, actualAmount, recipient, sender, underpayment: true, error: `Underpayment: expected ${expectedAmount}, got ${actualAmount.toFixed(6)}` };
  }
  if (!recipientOk) {
    return { confirmed: false, confirmations, required, actualAmount, recipient, sender, error: `Recipient mismatch: expected ${expectedTo}, got ${recipient}` };
  }

  return { confirmed: true, confirmations, required, actualAmount, recipient, sender, senderMismatch: !senderOk && !!expectedFrom };
}

// ── Solana ────────────────────────────────────────────────────

async function _verifySolana({ txHash, expectedAmount, expectedTo, required, asset = 'usdt' }) {
  const { Connection } = await import('@solana/web3.js');
  const connection = new Connection(SOL_RPC, 'finalized');

  const tx = await connection.getTransaction(txHash, { maxSupportedTransactionVersion: 0 });
  if (!tx) {
    return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: 'TX not found or still pending' };
  }
  if (tx.meta?.err) {
    return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: `TX failed: ${JSON.stringify(tx.meta.err)}` };
  }

  const currentSlot = await connection.getSlot('finalized');
  const confirmations = currentSlot - tx.slot;
  if (confirmations < required) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `Insufficient confirmations: ${confirmations}/${required}` };
  }

  // P2b: SOL native transfer — check lamport balance delta
  if (asset === 'sol' || asset === 'native' || !SOL_TOKENS[asset]) {
    const accountKeys = tx.transaction?.message?.accountKeys || tx.transaction?.message?.staticAccountKeys || [];
    const pre = tx.meta?.preBalances || [];
    const post = tx.meta?.postBalances || [];
    let maxDelta = 0, recipientAddr = '';
    for (let i = 0; i < post.length; i++) {
      const delta = (post[i] - pre[i]) / 1e9; // lamports → SOL
      if (delta > maxDelta) { maxDelta = delta; recipientAddr = accountKeys[i]?.toString() || ''; }
    }
    const sender = accountKeys[0]?.toString() || '';
    const amountOk = maxDelta >= (expectedAmount || 0) * 0.995;
    const recipientOk = !expectedTo || recipientAddr === expectedTo;
    if (maxDelta === 0) return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender, error: 'No SOL transfer detected' };
    if (!amountOk) return { confirmed: false, confirmations, required, actualAmount: maxDelta, recipient: recipientAddr, sender, underpayment: true, error: `Underpayment: expected ${expectedAmount}, got ${maxDelta.toFixed(6)}` };
    if (!recipientOk) return { confirmed: false, confirmations, required, actualAmount: maxDelta, recipient: recipientAddr, sender, error: `Recipient mismatch: expected ${expectedTo}, got ${recipientAddr}` };
    return { confirmed: true, confirmations, required, actualAmount: maxDelta, recipient: recipientAddr, sender };
  }

  // Resolve SPL token mint from multi-token table
  const tokenMint = SOL_TOKENS[asset] || SOL_TOKENS.usdt;

  // Find token transfer in token balance changes
  const postBalances = tx.meta?.postTokenBalances || [];
  const preBalances = tx.meta?.preTokenBalances || [];
  let actualAmount = 0;
  let recipient = null;

  for (const post of postBalances) {
    if (post.mint !== tokenMint) continue;
    const pre = preBalances.find(p => p.accountIndex === post.accountIndex && p.mint === tokenMint);
    const postAmt = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
    const preAmt = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || '0') : 0;
    const delta = postAmt - preAmt;
    if (delta > 0 && delta > actualAmount) {
      actualAmount = delta;
      recipient = post.owner || null;
    }
  }

  if (actualAmount === 0 || !recipient) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `No ${asset.toUpperCase()} transfer detected` };
  }

  const amountOk = actualAmount >= (expectedAmount || 0) * 0.995;
  const recipientOk = !expectedTo || recipient === expectedTo;

  if (!amountOk) {
    return { confirmed: false, confirmations, required, actualAmount, recipient, sender: '', underpayment: true, error: `Underpayment: expected ${expectedAmount}, got ${actualAmount.toFixed(2)}` };
  }
  if (!recipientOk) {
    return { confirmed: false, confirmations, required, actualAmount, recipient, sender: '', error: `Recipient mismatch: expected ${expectedTo}, got ${recipient}` };
  }

  return { confirmed: true, confirmations, required, actualAmount, recipient, sender: '' };
}

// ── TRON ──────────────────────────────────────────────────────

async function _verifyTron({ txHash, expectedAmount, expectedTo, required, asset = 'usdt' }) {
  const TronWebModule = await import('tronweb');
  const TronWeb = TronWebModule.default || TronWebModule;
  const tronWeb = new TronWeb({ fullHost: TRON_RPC });

  const txInfo = await tronWeb.trx.getTransactionInfo(txHash);
  if (!txInfo || !txInfo.id) {
    return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: 'TX not found or still pending' };
  }
  if (txInfo.receipt?.result && txInfo.receipt.result !== 'SUCCESS') {
    return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: `TX failed: ${txInfo.receipt.result}` };
  }

  const txBlock = txInfo.blockNumber;
  const currentBlock = await tronWeb.trx.getCurrentBlock();
  const currentBlockNum = currentBlock?.block_header?.raw_data?.number || 0;
  const confirmations = currentBlockNum - txBlock;
  if (confirmations < required) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: `Insufficient confirmations: ${confirmations}/${required}` };
  }

  // P2b: TRX native transfer — check raw TX contract value
  if (asset === 'trx' || asset === 'native' || !TRON_TOKENS[asset]) {
    const rawTx = await tronWeb.trx.getTransaction(txHash);
    const contract = rawTx?.raw_data?.contract?.[0];
    if (contract?.type === 'TransferContract') {
      const val = contract.parameter?.value;
      const actualAmount = (val?.amount || 0) / 1e6; // sun → TRX
      const recipient = tronWeb.address.fromHex(val?.to_address || '');
      const sender = tronWeb.address.fromHex(val?.owner_address || '');
      const amountOk = actualAmount >= (expectedAmount || 0) * 0.995;
      const recipientOk = !expectedTo || recipient === expectedTo;
      if (!amountOk) return { confirmed: false, confirmations, required, actualAmount, recipient, sender, underpayment: true, error: `Underpayment: expected ${expectedAmount}, got ${actualAmount.toFixed(2)}` };
      if (!recipientOk) return { confirmed: false, confirmations, required, actualAmount, recipient, sender, error: `Recipient mismatch: expected ${expectedTo}, got ${recipient}` };
      return { confirmed: true, confirmations, required, actualAmount, recipient, sender };
    }
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: 'Not a TRX transfer TX' };
  }

  // Resolve TRC20 contract from multi-token table
  const tokenAddr = TRON_TOKENS[asset] || TRON_TOKENS.usdt;

  // Parse TRC20 Transfer log
  const transferTopic = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  let actualAmount = 0;
  let recipientHex = null;
  let senderHex = null;

  for (const log of (txInfo.log || [])) {
    const addr = log.address || '';
    if (addr.toLowerCase() !== tronWeb.address.toHex(tokenAddr).replace(/^41/, '').toLowerCase()) continue;
    if (!log.topics || log.topics[0] !== transferTopic) continue;

    senderHex = '41' + log.topics[1].slice(-40);
    recipientHex = '41' + log.topics[2].slice(-40);
    actualAmount = parseInt(log.data, 16) / 1e6; // USDT decimals = 6
    break;
  }

  if (actualAmount === 0 || !recipientHex) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: 'No USDT transfer detected' };
  }

  const recipient = tronWeb.address.fromHex(recipientHex);
  const sender = senderHex ? tronWeb.address.fromHex(senderHex) : '';

  const amountOk = actualAmount >= (expectedAmount || 0) * 0.995;
  const recipientOk = !expectedTo || recipient === expectedTo;

  if (!amountOk) {
    return { confirmed: false, confirmations, required, actualAmount, recipient, sender, underpayment: true, error: `Underpayment: expected ${expectedAmount}, got ${actualAmount.toFixed(2)}` };
  }
  if (!recipientOk) {
    return { confirmed: false, confirmations, required, actualAmount, recipient, sender, error: `Recipient mismatch: expected ${expectedTo}, got ${recipient}` };
  }

  return { confirmed: true, confirmations, required, actualAmount, recipient, sender };
}

// ── Kaspa ────────────────────────────────────────────────────

async function _verifyKaspa({ txHash, expectedAmount, expectedTo, required }) {
  // ── Kaspa TX verification — embedded indexer first, RPC UTXO fallback ──
  //
  // PRIMARY: query local kaspa_tx_log (populated by Relay block-added hook)
  //   - Immune to UTXO being spent after receipt
  //   - Zero RPC round-trip latency
  //   - Includes historical TXs seen by Relay
  //
  // FALLBACK: RPC getUtxosByAddresses (legacy path, kept for transition period)
  //   - Fires only if indexer has no record (e.g., TX predates indexer install)
  //
  // See Phase 1 stress test S10B — "TX output not found in recipient UTXOs" bug.
  if (!expectedTo) {
    return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: 'expectedTo required for Kaspa verification' };
  }

  // ── PRIMARY: local indexer lookup ──
  try {
    const { sqlite } = await import('../db/client.js');
    const row = sqlite.prepare(
      `SELECT tx_id, to_address, amount, from_address, block_time, observed_at
       FROM kaspa_tx_log
       WHERE tx_id = ? AND to_address = ?`
    ).get(txHash, expectedTo);

    if (row) {
      const actualAmount = parseFloat(row.amount) || 0;
      const amountOk = !expectedAmount || actualAmount >= expectedAmount * 0.995;
      if (!amountOk) {
        return {
          confirmed: false, confirmations: 1, required: 1, actualAmount,
          recipient: expectedTo, sender: row.from_address || '',
          underpayment: true,
          error: `Underpayment: expected ${expectedAmount} KAS, got ${actualAmount.toFixed(2)}`,
          source: 'local_indexer',
        };
      }
      return {
        confirmed: true, confirmations: 1, required: 1, actualAmount,
        recipient: expectedTo, sender: row.from_address || '',
        source: 'local_indexer',
      };
    }
    // Not found in indexer → fall through to RPC fallback
  } catch (err) {
    console.error(`[verify-kaspa] indexer lookup error: ${err.message} — falling back to RPC`);
  }

  // ── FALLBACK: RPC UTXO query (legacy path) ──
  try {
    const { getWorkingRpc } = await import('./rpc-health.js');
    const { url: rpcUrl } = await getWorkingRpc();
    if (!rpcUrl) {
      return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: 'No RPC node available and TX not in local indexer' };
    }

    const kaspa = await import('kaspa-wasm');
    const { RpcClient, Encoding, Address } = kaspa;
    const networkId = process.env.KASPA_NETWORK || 'mainnet';
    const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId });
    await Promise.race([
      rpc.connect({}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 5000)),
    ]);

    const { entries } = await Promise.race([
      rpc.getUtxosByAddresses([new Address(expectedTo)]),
      new Promise((_, rej) => setTimeout(() => rej(new Error('UTXO query timeout')), 5000)),
    ]);

    let actualAmount = 0;
    for (const entry of (entries || [])) {
      const outTxId = entry?.outpoint?.transactionId || entry?.entry?.outpoint?.transactionId;
      if (outTxId === txHash) {
        const sompi = Number(entry?.utxoEntry?.amount || entry?.entry?.utxoEntry?.amount || 0);
        actualAmount += sompi / 1e8;
      }
    }

    await rpc.disconnect();

    if (actualAmount > 0) {
      const amountOk = !expectedAmount || actualAmount >= expectedAmount * 0.995;
      if (!amountOk) {
        return { confirmed: false, confirmations: 1, required: 1, actualAmount, recipient: expectedTo, sender: '', underpayment: true, error: `Underpayment: expected ${expectedAmount} KAS, got ${actualAmount.toFixed(2)}`, source: 'rpc_fallback' };
      }
      return { confirmed: true, confirmations: 1, required: 1, actualAmount, recipient: expectedTo, sender: '', source: 'rpc_fallback' };
    }

    return {
      confirmed: false, confirmations: 0, required: 1, actualAmount: 0,
      recipient: expectedTo, sender: '',
      error: 'TX output not found in recipient UTXOs (and not in local indexer)',
      source: 'rpc_fallback',
    };
  } catch (err) {
    return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: `Kaspa RPC error: ${err.message}` };
  }
}
