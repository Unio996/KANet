/**
 * EVM ERC20 Transfer — shared USDT/USDC transfer logic.
 *
 * Used by:
 *   - trading.js (OTC pay_usdt)
 *   - trade-protocol-filter.js (exchange autoPayExchange)
 *
 * Phase 1: BNB + ETH only. SOL/TRON not supported (caller should skip).
 */

import { ethers } from 'ethers';
import { decrypt } from './crypto.js';

const EVM_RPC = {
  bnb: 'https://bsc-dataseed1.binance.org',
  eth: 'https://eth.llamarpc.com',
};

const USDT_CONTRACTS = {
  bnb:  { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  eth:  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
};

/**
 * Transfer ERC20 (USDT) on an EVM chain.
 *
 * @param {string} chain — 'bnb' or 'eth'
 * @param {string} privkeyEncrypted — encrypted private key from agent_wallets
 * @param {string} toAddress — recipient EVM address
 * @param {number} amount — amount in human-readable units (e.g. 3.25)
 * @param {string} [asset='USDT'] — reserved for future multi-asset support
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferERC20(chain, privkeyEncrypted, toAddress, amount, asset = 'USDT') {
  const rpcUrl = EVM_RPC[chain];
  const token = USDT_CONTRACTS[chain];

  if (!rpcUrl || !token) {
    return { ok: false, error: `Chain ${chain} not supported for ERC20 transfer (supported: ${Object.keys(EVM_RPC).join(', ')})` };
  }

  try {
    const privateKey = decrypt(privkeyEncrypted);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(token.address, [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ], signer);

    // Check balance
    const balance = await contract.balanceOf(signer.address);
    const balanceFloat = parseFloat(ethers.formatUnits(balance, token.decimals));
    if (balanceFloat < amount) {
      return { ok: false, error: `${asset} insufficient: have ${balanceFloat.toFixed(2)}, need ${amount.toFixed(2)}` };
    }

    // Transfer
    const precision = Math.min(token.decimals, 6);
    const amountWei = ethers.parseUnits(String(amount.toFixed(precision)), token.decimals);
    const tx = await contract.transfer(toAddress, amountWei);
    console.log(`[evm-transfer] ${amount} ${asset} → ${toAddress.slice(0, 12)}... on ${chain} TX: ${tx.hash}`);

    return { ok: true, txHash: tx.hash };
  } catch (err) {
    console.error(`[evm-transfer] Failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Check if a chain is supported for ERC20 transfer.
 */
export function isEvmChainSupported(chain) {
  return !!EVM_RPC[chain];
}
