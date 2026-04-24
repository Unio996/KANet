/**
 * Across V3 Cross-Chain Bridge — ERC20 (USDC) 跨链结算
 *
 * 用 Across V3 SpokePool depositV3 在 EVM 链间搬运 USDC。
 * 小额最快（10-30s fill）、fee 最低（~0.1-0.5%）。
 */

import { ethers } from 'ethers';
import { quoteBridge, loadConfig, CHAIN_META, USDC_DECIMALS } from './across-bridge-config.js';
import { withFallbackRpc, withProvider } from './chains.js';

const SPOKE_ABI = [
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, '
    + 'uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, '
    + 'address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, '
    + 'uint32 exclusivityDeadline, bytes calldata message) external payable',
];
const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const L2_CHAINS = ['arbitrum', 'optimism', 'base'];

/**
 * Race eth_blockNumber across rpcPool — return the first responding URL.
 *
 * Used for stateful TX submission (approve/deposit) where fallback mid-flight
 * causes nonce conflicts (RPC A broadcasts approve, 4s timeout, RPC B re-broadcasts
 * approve with same nonce → replace-or-fail). Lock one healthy URL for the whole flow.
 */
async function pickHealthyRpc(rpcPool, { timeoutMs = 2000 } = {}) {
  const probes = rpcPool.map(url =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    })
      .then(r => r.json())
      .then(j => j.result ? url : Promise.reject(new Error(`invalid response from ${url}`)))
  );
  try {
    return await Promise.any(probes);
  } catch {
    throw new Error(`No healthy RPC in pool: ${rpcPool.join(', ')}`);
  }
}

/**
 * Approve SpokePool to spend USDC — exact amount, not unlimited.
 *
 * @returns {string|null} approval TX hash, null if already approved
 */
async function approveIfNeeded(usdc, spokePool, signer, amount) {
  const current = await usdc.allowance(signer.address, spokePool);
  if (current >= amount) return null;
  // Let ethers v6 populate gas automatically — Arbitrum L2 priority fee ≈ 0,
  // hardcoded multipliers (× 3 × 30 gwei fallback) violated EIP-1559 (priority > max).
  const tx = await usdc.approve(spokePool, amount);
  await tx.wait();
  return tx.hash;
}

/**
 * Execute an Across V3 bridge deposit.
 *
 * @param {string} privateKey
 * @param {string} fromChain - source chain name
 * @param {string} toChain - destination chain name
 * @param {string|number} amountHuman - human USDC amount
 * @param {string} [recipient] - recipient on toChain (defaults to same address)
 * @returns {Promise<BridgeResult>}
 */
export async function executeBridge(privateKey, fromChain, toChain, amountHuman, recipient) {
  const config = loadConfig();
  const quote = await quoteBridge(fromChain, toChain, amountHuman, config);
  // outputAmount from Across API is ALREADY net of fee — do NOT subtract again
  const outputAmount = BigInt(quote.outputAmount);
  const decimals = USDC_DECIMALS[fromChain] || 6;

  if (outputAmount <= 0n) {
    throw new Error(
      `Fee exceeds amount: input=${quote.inputAmount} fee=${quote.totalRelayFee} output=${outputAmount}`
    );
  }

  const meta = CHAIN_META[fromChain];
  if (!meta) throw new Error(`Chain meta missing: ${fromChain}`);
  if (!meta?.rpcPool?.length) throw new Error(`No RPC configured for ${fromChain}`);

  // Gas check for L2s — must have native token for gas
  if (L2_CHAINS.includes(fromChain)) {
    const bal = await withFallbackRpc(fromChain, async (p) => {
      return p.getBalance(new ethers.Wallet(privateKey).address);
    });
    if (bal < ethers.parseEther('0.0001')) {
      throw new Error(
        `Insufficient ${meta.nativeSymbol} for gas on ${fromChain}. Need >0.0001 ${meta.nativeSymbol}.`
      );
    }
  }
  const spoke = config.SPOKE_POOLS[fromChain];
  const usdc = config.USDC[fromChain];
  const toChainId = config.CHAIN_IDS[toChain];

  // Stateful TX path: pick one healthy RPC upfront, lock it for approve+deposit+wait.
  // Do NOT use withFallbackRpc here — its 4s default per-RPC timeout and mid-flight
  // switching causes nonce conflicts across TXs (see pickHealthyRpc doc above).
  const healthyUrl = await pickHealthyRpc(meta.rpcPool);
  console.log(`[across] TX path locked to RPC: ${healthyUrl}`);

  return withProvider(healthyUrl, async (provider) => {
    const signer = new ethers.Wallet(privateKey, provider);
    const usdcContract = new ethers.Contract(usdc, ERC20_ABI, signer);
    const spokeContract = new ethers.Contract(spoke, SPOKE_ABI, signer);

    const approvalTx = await approveIfNeeded(usdcContract, spoke, signer, BigInt(quote.inputAmount));
    if (approvalTx) console.log(`[across] Approval TX: ${approvalTx}`);

    const tx = await spokeContract.depositV3(
      signer.address,
      recipient || signer.address,
      usdc,
      config.USDC[toChain],
      quote.inputAmount,
      quote.outputAmount,
      toChainId,
      ethers.ZeroAddress,
      Number(quote.timestamp),
      Number(quote.fillDeadline),
      0,
      '0x',
    );

    console.log(`[across] Deposit TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[across] Confirmed block ${receipt.blockNumber}`);

    return {
      ok: true,
      txHash: tx.hash,
      block: receipt.blockNumber,
      inputAmount: ethers.formatUnits(BigInt(quote.inputAmount), decimals),
      outputAmount: ethers.formatUnits(outputAmount, decimals),
      fee: ethers.formatUnits(BigInt(quote.totalRelayFee), decimals),
      fromChain,
      toChain,
      destinationChainId: toChainId,
    };
  }, { timeoutMs: 60000 });
}
