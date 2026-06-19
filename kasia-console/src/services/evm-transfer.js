/**
 * Multi-chain USDT Transfer — shared payment logic for EVM, Solana, TRON.
 *
 * Used by:
 *   - trading.js (OTC pay_usdt)
 *   - trade-protocol-filter.js (exchange autoPayExchange)
 *
 * Supported: BNB, ETH (EVM), SOL (Solana SPL), TRON (TRC20).
 */

import { ethers } from 'ethers';
import { decrypt } from './crypto.js';
import { STABLECOINS, EVM_RPC_URLS } from './chains.js';

/**
 * Transfer ERC20 stablecoin (USDT/USDC) on an EVM chain.
 *
 * T-NWT-2026-04-27 v1.1 (Owner 23:14 钦定 KANet 真 10 chain × multi-stable, J2 #3 a58158f37a):
 * 真 source of truth = chains.js CHAIN_META (STABLECOINS + EVM_RPC_URLS exports).
 * 老 hardcoded EVM_RPC / USDT_CONTRACTS 撤 — 真 generic from chains.js, 不 hardcode.
 * 真支持: 7 EVM chain (bnb/eth/polygon/arbitrum/optimism/avalanche/base) × USDT/USDC/USDC.e.
 *
 * @param {string} chain — 'bnb' / 'eth' / 'polygon' / 'arbitrum' / 'optimism' / 'avalanche' / 'base'
 * @param {string} privkeyEncrypted — encrypted private key from agent_wallets
 * @param {string} toAddress — recipient EVM address
 * @param {number} amount — amount in human-readable units (e.g. 3.25)
 * @param {string} [asset='USDT'] — 'USDT' / 'USDC' / 'USDCe' (lowercased to lookup STABLECOINS)
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferERC20(chain, privkeyEncrypted, toAddress, amount, asset = 'USDT') {
  const rpcUrl = EVM_RPC_URLS[chain];
  const stables = STABLECOINS[chain];
  const assetKey = String(asset).toLowerCase();
  const token = stables?.[assetKey];

  if (!rpcUrl) {
    return { ok: false, error: `Chain ${chain} not EVM or no RPC (supported: ${Object.keys(EVM_RPC_URLS).join(', ')})` };
  }
  if (!token) {
    return { ok: false, error: `Asset ${asset} not registered on ${chain} (chains.js stables: ${Object.keys(stables || {}).join(', ') || 'none'})` };
  }

  let provider;
  try {
    const privateKey = decrypt(privkeyEncrypted);
    provider = new ethers.JsonRpcProvider(rpcUrl);
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
  } finally {
    try { provider?.destroy?.(); } catch {}
  }
}

// ── Solana SPL Transfer ───────────────────────────────────────

const SOL_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenEPs';

/**
 * Transfer SPL token (USDT) on Solana.
 *
 * @param {string} privkeyEncrypted — encrypted base58 private key from agent_wallets
 * @param {string} toAddress — recipient Solana address (public key)
 * @param {number} amount — amount in human-readable units (e.g. 3.25)
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferSolUsdt(privkeyEncrypted, toAddress, amount) {
  try {
    const { Connection, Keypair, PublicKey } = await import('@solana/web3.js');
    const { getOrCreateAssociatedTokenAccount, transfer, getMint } = await import('@solana/spl-token');

    const privateKey = decrypt(privkeyEncrypted);
    // Support both base58 and JSON array formats
    let keypair;
    if (privateKey.startsWith('[')) {
      keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKey)));
    } else {
      const bs58 = (await import('bs58')).default;
      keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    }

    const connection = new Connection(SOL_RPC, 'confirmed');
    const mintPubkey = new PublicKey(SOL_USDT_MINT);
    const toPubkey = new PublicKey(toAddress);

    // Get mint info for decimals
    const mintInfo = await getMint(connection, mintPubkey);
    const decimals = mintInfo.decimals; // USDT = 6

    // Get or create sender's ATA
    const senderAta = await getOrCreateAssociatedTokenAccount(connection, keypair, mintPubkey, keypair.publicKey);

    // Check balance
    const balance = Number(senderAta.amount) / (10 ** decimals);
    if (balance < amount) {
      return { ok: false, error: `USDT insufficient on SOL: have ${balance.toFixed(2)}, need ${amount.toFixed(2)}` };
    }

    // Get or create recipient's ATA
    const recipientAta = await getOrCreateAssociatedTokenAccount(connection, keypair, mintPubkey, toPubkey);

    // Transfer
    const amountRaw = BigInt(Math.round(amount * (10 ** decimals)));
    const sig = await transfer(connection, keypair, senderAta.address, recipientAta.address, keypair, amountRaw);
    console.log(`[sol-transfer] ${amount} USDT → ${toAddress.slice(0, 12)}... TX: ${sig}`);

    return { ok: true, txHash: sig };
  } catch (err) {
    console.error(`[sol-transfer] Failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── TRON TRC20 Transfer ──────────────────────────────────────

const TRON_RPC = 'https://api.trongrid.io';
const TRON_USDT_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * Transfer TRC20 token (USDT) on TRON.
 *
 * @param {string} privkeyEncrypted — encrypted hex private key from agent_wallets
 * @param {string} toAddress — recipient TRON address (T-prefix)
 * @param {number} amount — amount in human-readable units (e.g. 3.25)
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferTronUsdt(privkeyEncrypted, toAddress, amount) {
  try {
    const TronWebModule = await import('tronweb');
    const TronWeb = TronWebModule.default || TronWebModule;
    const privateKey = decrypt(privkeyEncrypted);

    const tronWeb = new TronWeb({ fullHost: TRON_RPC, privateKey });

    // Check balance first
    const contract = await tronWeb.contract().at(TRON_USDT_ADDR);
    const balanceRaw = await contract.balanceOf(tronWeb.defaultAddress.base58).call();
    const balance = Number(balanceRaw) / 1e6; // USDT = 6 decimals
    if (balance < amount) {
      return { ok: false, error: `USDT insufficient on TRON: have ${balance.toFixed(2)}, need ${amount.toFixed(2)}` };
    }

    // Transfer
    const amountRaw = Math.round(amount * 1e6);
    const txResult = await contract.transfer(toAddress, amountRaw).send();
    const txHash = typeof txResult === 'string' ? txResult : txResult?.txid || txResult?.transaction?.txID || '';

    console.log(`[tron-transfer] ${amount} USDT → ${toAddress.slice(0, 12)}... TX: ${txHash}`);
    return { ok: true, txHash };
  } catch (err) {
    console.error(`[tron-transfer] Failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Unified interface ────────────────────────────────────────

const ALL_SUPPORTED_CHAINS = new Set(['bnb', 'eth', 'sol', 'tron']);

/**
 * Check if a chain is supported for auto-pay transfer.
 */
export function isChainSupported(chain) {
  return ALL_SUPPORTED_CHAINS.has(chain);
}

/**
 * @deprecated Use isChainSupported instead.
 */
export function isEvmChainSupported(chain) {
  return !!EVM_RPC_URLS[chain];  // J2-tn ESLint no-undef fix: 重构撤 hardcoded EVM_RPC 改 EVM_RPC_URLS (L13 import), L192 残留旧名 = dangling-ref
}

/**
 * Transfer USDT on any supported chain.
 *
 * @param {string} chain — 'bnb', 'eth', 'sol', 'tron'
 * @param {string} privkeyEncrypted — encrypted private key
 * @param {string} toAddress — recipient address
 * @param {number} amount — human-readable amount
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferUsdt(chain, privkeyEncrypted, toAddress, amount) {
  if (['bnb', 'eth'].includes(chain)) return transferERC20(chain, privkeyEncrypted, toAddress, amount);
  if (chain === 'sol') return transferSolUsdt(privkeyEncrypted, toAddress, amount);
  if (chain === 'tron') return transferTronUsdt(privkeyEncrypted, toAddress, amount);
  return { ok: false, error: `Unsupported chain: ${chain}` };
}
