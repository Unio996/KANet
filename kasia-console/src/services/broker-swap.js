// broker-swap.js — broker USDT→USDC PancakeSwap V2 swap (J2 #3 v1.1 USDC funding)
// 三方共识 vote (a) — 不烧 Owner 钱, broker 自吃 ~$1.50 真测 cost
// spec: docs/spec/2026-04-27-broker-swap-pancakeswap.md
// 真 contract: PancakeSwap V2 Router 0x10ED43...6024E (BSC mainnet)

import { ethers } from 'ethers';
import { decrypt } from './crypto.js';

const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const PCS_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
// USDT-BSC and USDC-BSC are both 18 decimals
const TOKEN_DECIMALS = 18;

const PCS_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] memory)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] memory)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/**
 * Quote USDT→USDC swap (read-only, no gas). Verify router + path before real swap.
 *
 * @param {number} amountUsdt — input USDT (human-readable)
 * @returns {Promise<{ ok, expectedUsdc, slippageEstimatePct } | { ok: false, error }>}
 */
export async function quoteUsdtToUsdc(amountUsdt) {
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(BSC_RPC);
    const router = new ethers.Contract(PCS_V2_ROUTER, PCS_ABI, provider);
    const amountIn = ethers.parseUnits(amountUsdt.toFixed(6), TOKEN_DECIMALS);
    const amounts = await router.getAmountsOut(amountIn, [USDT_BSC, USDC_BSC]);
    const usdcOut = parseFloat(ethers.formatUnits(amounts[1], TOKEN_DECIMALS));
    const slippagePct = ((amountUsdt - usdcOut) / amountUsdt) * 100;
    return { ok: true, expectedUsdc: usdcOut, slippageEstimatePct: slippagePct };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { provider?.destroy?.(); } catch {}
  }
}

/**
 * Swap N USDT → ~N USDC on BSC PancakeSwap V2 (real on-chain, costs gas + USDT).
 * Caller: broker handler when USDC inventory < threshold (J2 #3 inventory pre-flight).
 *
 * @param {string} privkeyEncrypted — encrypted broker BSC privkey from agent_wallets
 * @param {number} amountUsdt — input USDT (human-readable, e.g. 1.0)
 * @param {number} [slippagePct=0.5] — max slippage 0.5% (USDC/USDT real peg <0.1%)
 * @returns {Promise<{ ok, txHash, gasUsed, usdcReceived } | { ok: false, error }>}
 */
export async function swapUsdtToUsdc(privkeyEncrypted, amountUsdt, slippagePct = 0.5) {
  let provider;
  try {
    const privateKey = decrypt(privkeyEncrypted);
    provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    const usdt = new ethers.Contract(USDT_BSC, ERC20_ABI, wallet);
    const router = new ethers.Contract(PCS_V2_ROUTER, PCS_ABI, wallet);

    const amountIn = ethers.parseUnits(amountUsdt.toFixed(6), TOKEN_DECIMALS);

    // 1. Balance check
    const bal = await usdt.balanceOf(wallet.address);
    if (bal < amountIn) {
      return { ok: false, error: `USDT insufficient: have ${ethers.formatUnits(bal, TOKEN_DECIMALS)}, need ${amountUsdt}` };
    }

    // 2. Idempotent approve (MaxUint256 if allowance < amount)
    const allowance = await usdt.allowance(wallet.address, PCS_V2_ROUTER);
    if (allowance < amountIn) {
      const approveTx = await usdt.approve(PCS_V2_ROUTER, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`[broker-swap] approved router (one-time, MaxUint256): ${approveTx.hash}`);
    }

    // 3. Quote + slippage min
    const quote = await router.getAmountsOut(amountIn, [USDT_BSC, USDC_BSC]);
    const amountOutMin = (quote[1] * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n;

    // 4. Swap
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min
    const tx = await router.swapExactTokensForTokens(
      amountIn, amountOutMin,
      [USDT_BSC, USDC_BSC],
      wallet.address,
      deadline,
    );
    const receipt = await tx.wait();
    const usdcReceived = parseFloat(ethers.formatUnits(quote[1], TOKEN_DECIMALS));
    console.log(`[broker-swap] ${amountUsdt} USDT → ${usdcReceived.toFixed(6)} USDC tx=${receipt.hash}`);
    return {
      ok: true,
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      usdcReceived,
    };
  } catch (err) {
    console.error(`[broker-swap] Failed: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    try { provider?.destroy?.(); } catch {}
  }
}
