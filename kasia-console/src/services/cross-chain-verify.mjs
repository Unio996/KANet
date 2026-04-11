/**
 * Cross-Chain USDT Payment Verification
 *
 * Extracted from trading.js (2026-04-06).
 * Pure verification logic — no DB writes, no business state transitions.
 * Caller is responsible for recording chain_events, execution_states, etc.
 *
 * Supported chains: bnb, eth (EVM), sol (Solana), tron (TRC20)
 */

const REQUIRED_CONFIRMATIONS = { bnb: 15, eth: 12, sol: 32, tron: 19, kaspa: 1 };

const EVM_RPC = {
  bnb: 'https://bsc-dataseed1.binance.org',
  eth: 'https://eth.llamarpc.com',
};

const EVM_USDT = {
  bnb: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  eth: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
};

const SOL_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenEPs';

const TRON_RPC = 'https://api.trongrid.io';
const TRON_USDT_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * Verify a cross-chain USDT payment TX.
 *
 * @param {object} params
 * @param {string} params.txHash        - TX hash on the target chain
 * @param {string} params.chain         - bnb/eth/sol/tron
 * @param {number} params.expectedAmount - Expected USDT amount
 * @param {string} [params.expectedTo]  - Expected recipient address
 * @param {string} [params.expectedFrom] - Expected sender address (optional)
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
export async function verifyCrossChainTx({ txHash, chain, expectedAmount, expectedTo, expectedFrom }) {
  const required = REQUIRED_CONFIRMATIONS[chain] || 15;

  if (['bnb', 'eth'].includes(chain)) {
    return _verifyEvm({ txHash, chain, expectedAmount, expectedTo, expectedFrom, required });
  }
  if (chain === 'sol') {
    return _verifySolana({ txHash, expectedAmount, expectedTo, required });
  }
  if (chain === 'tron') {
    return _verifyTron({ txHash, expectedAmount, expectedTo, required });
  }

  if (chain === 'kaspa') {
    return _verifyKaspa({ txHash, expectedAmount, expectedTo, required });
  }

  return { confirmed: false, confirmations: 0, required, actualAmount: 0, recipient: '', sender: '', error: `Unsupported chain: ${chain}` };
}

// ── EVM (BNB / ETH) ──────────────────────────────────────────

async function _verifyEvm({ txHash, chain, expectedAmount, expectedTo, expectedFrom, required }) {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(EVM_RPC[chain]);

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

  // Parse USDT Transfer log
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const usdtLower = EVM_USDT[chain].address.toLowerCase();
  const transferLog = receipt.logs.find(l =>
    l.address.toLowerCase() === usdtLower && l.topics[0] === transferTopic
  );

  if (!transferLog) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: 'No USDT transfer found in TX' };
  }

  const actualAmount = parseFloat(ethers.formatUnits(transferLog.data, EVM_USDT[chain].decimals));
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
}

// ── Solana ────────────────────────────────────────────────────

async function _verifySolana({ txHash, expectedAmount, expectedTo, required }) {
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

  // Find USDT transfer in token balance changes
  const postBalances = tx.meta?.postTokenBalances || [];
  const preBalances = tx.meta?.preTokenBalances || [];
  let actualAmount = 0;
  let recipient = null;

  for (const post of postBalances) {
    if (post.mint !== SOL_USDT_MINT) continue;
    const pre = preBalances.find(p => p.accountIndex === post.accountIndex && p.mint === SOL_USDT_MINT);
    const postAmt = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
    const preAmt = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || '0') : 0;
    const delta = postAmt - preAmt;
    if (delta > 0 && delta > actualAmount) {
      actualAmount = delta;
      recipient = post.owner || null;
    }
  }

  if (actualAmount === 0 || !recipient) {
    return { confirmed: false, confirmations, required, actualAmount: 0, recipient: '', sender: '', error: 'No USDT transfer detected' };
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

async function _verifyTron({ txHash, expectedAmount, expectedTo, required }) {
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

  // Parse TRC20 Transfer log
  const transferTopic = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  let actualAmount = 0;
  let recipientHex = null;
  let senderHex = null;

  for (const log of (txInfo.log || [])) {
    const addr = log.address || '';
    if (addr.toLowerCase() !== tronWeb.address.toHex(TRON_USDT_ADDR).replace(/^41/, '').toLowerCase()) continue;
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
  // Kaspa TX verification via public REST API
  // Kaspa is 10 BPS — once a TX is in a block, it's effectively final within seconds
  try {
    const res = await fetch(`https://api.kaspa.org/transactions/${txHash}`);
    if (!res.ok) {
      return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: `TX not found (HTTP ${res.status})` };
    }
    const tx = await res.json();

    if (!tx || !tx.transaction_id) {
      return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: 'TX not found or still pending' };
    }

    // TX exists in a block = confirmed (Kaspa has no reorgs in practice at 10 BPS)
    const isAccepted = tx.is_accepted !== false; // api.kaspa.org returns is_accepted
    if (!isAccepted) {
      return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: 'TX not yet accepted' };
    }

    // Parse outputs to find recipient and amount
    const outputs = tx.outputs || [];
    let actualAmount = 0;
    let recipient = '';
    let sender = '';

    // Sender = first input address
    if (tx.inputs?.length > 0 && tx.inputs[0].previous_outpoint_address) {
      sender = tx.inputs[0].previous_outpoint_address;
    }

    // Find the output matching expectedTo (if provided), or the largest non-change output
    for (const out of outputs) {
      const addr = out.script_public_key_address || '';
      const sompi = parseInt(out.amount || '0', 10);
      const kas = sompi / 1e8; // 1 KAS = 1e8 sompi

      if (expectedTo && addr === expectedTo) {
        actualAmount = kas;
        recipient = addr;
        break;
      }
      // If no expectedTo, take the largest output that isn't sender (change)
      if (!expectedTo && addr !== sender && kas > actualAmount) {
        actualAmount = kas;
        recipient = addr;
      }
    }

    if (actualAmount === 0) {
      return { confirmed: false, confirmations: 1, required: 1, actualAmount: 0, recipient: '', sender, error: 'No matching KAS transfer found in TX outputs' };
    }

    // Amount check (0.5% tolerance)
    const amountOk = !expectedAmount || actualAmount >= expectedAmount * 0.995;
    if (!amountOk) {
      return { confirmed: false, confirmations: 1, required: 1, actualAmount, recipient, sender, underpayment: true, error: `Underpayment: expected ${expectedAmount} KAS, got ${actualAmount.toFixed(2)}` };
    }

    return { confirmed: true, confirmations: 1, required: 1, actualAmount, recipient, sender };
  } catch (err) {
    return { confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: `Kaspa API error: ${err.message}` };
  }
}
