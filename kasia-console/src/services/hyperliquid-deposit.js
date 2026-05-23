/**
 * Hyperliquid Deposit — Arbitrum USDC → Hyperliquid bridge contract
 *
 * Hyperliquid account is funded via an ERC20 transfer of USDC on Arbitrum
 * to the bridge contract. After ~1 minute the funds appear in the
 * clearinghouse state and become available for trading.
 *
 * Bridge contract: 0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7 (Arbitrum)
 * USDC:            0xaf88d065e77c8cC2239327C5EDb3A432268e5831 (Arbitrum native)
 */

import { ethers } from 'ethers';
import { withProvider } from './chains.js';

const ARB_RPC    = 'https://arb1.arbitrum.io/rpc';
const USDC_ARB   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const HL_BRIDGE  = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';
const MIN_DEPOSIT = 5; // Hyperliquid enforces a minimum

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
];

/**
 * Query Arbitrum wallet balances (ETH for gas + USDC for deposit).
 */
export async function getArbBalances(address) {
  return withProvider(ARB_RPC, async (provider) => {
    const usdc = new ethers.Contract(USDC_ARB, ERC20_ABI, provider);
    const [ethWei, usdcRaw] = await Promise.all([
      provider.getBalance(address),
      usdc.balanceOf(address),
    ]);
    return {
      eth: parseFloat(ethers.formatEther(ethWei)),
      usdc: parseFloat(ethers.formatUnits(usdcRaw, 6)),
    };
  });
}

/**
 * Deposit USDC from Arbitrum wallet to Hyperliquid bridge.
 * Returns { ok, txHash, blockNumber, amount, explorer }.
 * Throws on insufficient balance, gas, or minimum violation.
 */
export async function depositUsdc(privateKey, amount) {
  if (!amount || amount <= 0) throw new Error('Amount must be > 0');
  if (amount < MIN_DEPOSIT) throw new Error(`Hyperliquid minimum deposit is ${MIN_DEPOSIT} USDC`);

  return withProvider(ARB_RPC, async (provider) => {
    const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
    const wallet = new ethers.Wallet(pk, provider);
    const usdc = new ethers.Contract(USDC_ARB, ERC20_ABI, wallet);

    // Pre-flight: check balances before sending
    const [usdcRaw, ethWei] = await Promise.all([
      usdc.balanceOf(wallet.address),
      provider.getBalance(wallet.address),
    ]);
    const usdcFloat = parseFloat(ethers.formatUnits(usdcRaw, 6));
    const ethFloat = parseFloat(ethers.formatEther(ethWei));

    if (usdcFloat < amount) {
      throw new Error(`Insufficient USDC: have ${usdcFloat.toFixed(2)}, need ${amount}`);
    }
    if (ethFloat < 0.0003) {
      throw new Error(`Insufficient ETH for gas: have ${ethFloat.toFixed(6)}, need ~0.0003`);
    }

    // Send the transfer — NO TX NO STATE CHANGE: we only report ok=true
    // after the receipt confirms inclusion.
    const amountRaw = ethers.parseUnits(String(amount), 6);
    const tx = await usdc.transfer(HL_BRIDGE, amountRaw);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Deposit TX failed: ${tx.hash}`);
    }

    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      amount,
      explorer: `https://arbiscan.io/tx/${tx.hash}`,
      note: 'Funds will appear in Hyperliquid account in ~1 minute',
    };
  });
}
