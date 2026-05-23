/**
 * TRON TRC20 Transfer — USDT on TRON.
 *
 * Used by:
 *   - trade-protocol-filter.js (exchange autoPayExchange)
 *
 * Mirrors evm-transfer.js interface: transferTRC20() → { ok, txHash } | { ok, error }
 *
 * TRON private key format: same secp256k1 as EVM (0x... hex string).
 * TRON address format: base58check with 0x41 prefix.
 */

import { decrypt } from './crypto.js';

const TRON_RPC = 'https://api.trongrid.io';

const TRC20_TOKENS = {
  USDT: { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
  USDC: { address: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6 },
};

/**
 * Transfer TRC20 token (USDT/USDC) on TRON.
 *
 * @param {string} privkeyEncrypted — encrypted private key (hex, same as EVM) from agent_wallets
 * @param {string} toAddress — recipient TRON address (base58check, starts with T)
 * @param {number} amount — amount in human-readable units (e.g. 3.25)
 * @param {string} [asset='USDT'] — USDT or USDC
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferTRC20(privkeyEncrypted, toAddress, amount, asset = 'USDT') {
  const token = TRC20_TOKENS[asset.toUpperCase()];
  if (!token) {
    return { ok: false, error: `Unsupported TRC20 token: ${asset} (supported: ${Object.keys(TRC20_TOKENS).join(', ')})` };
  }

  try {
    // Decrypt private key
    let privateKey = decrypt(privkeyEncrypted);
    // Strip 0x prefix if present — TronWeb expects bare hex
    if (privateKey.startsWith('0x')) {
      privateKey = privateKey.slice(2);
    }

    // Initialize TronWeb with private key
    const TronWebModule = await import('tronweb');
    const TronWeb = TronWebModule.default || TronWebModule;
    const tronWeb = new TronWeb({
      fullHost: TRON_RPC,
      privateKey,
    });

    const senderAddress = tronWeb.defaultAddress.base58;
    if (!senderAddress) {
      return { ok: false, error: 'Failed to derive TRON address from private key' };
    }

    // Get TRC20 contract instance
    const contract = await tronWeb.contract().at(token.address);

    // Check balance
    const balanceRaw = await contract.methods.balanceOf(senderAddress).call();
    const balanceFloat = Number(balanceRaw) / (10 ** token.decimals);
    if (balanceFloat < amount) {
      return { ok: false, error: `${asset} insufficient: have ${balanceFloat.toFixed(2)}, need ${amount.toFixed(2)}` };
    }

    // Check TRX balance for energy/bandwidth fees
    const trxBalance = await tronWeb.trx.getBalance(senderAddress);
    const trxFloat = trxBalance / 1e6;
    if (trxFloat < 10) {
      // TRC20 transfers need ~10-30 TRX for energy; warn if low
      console.warn(`[tron-transfer] Low TRX balance: ${trxFloat.toFixed(2)} TRX (may not cover energy fees)`);
    }

    // Execute transfer
    const amountRaw = Math.round(amount * (10 ** token.decimals));
    const txResult = await contract.methods.transfer(toAddress, amountRaw).send({
      feeLimit: 100_000_000, // 100 TRX max fee
    });

    // txResult is the transaction hash string
    const txHash = typeof txResult === 'string' ? txResult : txResult?.txid || txResult?.transaction?.txID || '';
    if (!txHash) {
      return { ok: false, error: 'Transfer returned no transaction hash' };
    }

    console.log(`[tron-transfer] ${amount} ${asset} → ${toAddress.slice(0, 12)}... TX: ${txHash}`);
    return { ok: true, txHash };
  } catch (err) {
    console.error(`[tron-transfer] Failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Transfer native TRX.
 *
 * TRX is the gas/coin layer of TRON. Sending it uses the basic system contract,
 * not a TRC20 contract. Bandwidth/energy fees come from TRX itself, so the
 * sender needs slightly more TRX than `amount`.
 *
 * @param {string} privkeyEncrypted — encrypted hex private key (same as EVM)
 * @param {string} toAddress — recipient base58check address (starts with T)
 * @param {number} amount — amount in TRX
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferTronNative(privkeyEncrypted, toAddress, amount) {
  try {
    let privateKey = decrypt(privkeyEncrypted);
    if (privateKey.startsWith('0x')) privateKey = privateKey.slice(2);

    const TronWebModule = await import('tronweb');
    const TronWeb = TronWebModule.default || TronWebModule;
    const tronWeb = new TronWeb({ fullHost: TRON_RPC, privateKey });

    const senderAddress = tronWeb.defaultAddress.base58;
    if (!senderAddress) {
      return { ok: false, error: 'Failed to derive TRON address from private key' };
    }

    // Check balance (TRX is in sun: 1 TRX = 1_000_000 sun)
    const balanceSun = await tronWeb.trx.getBalance(senderAddress);
    const balanceTrx = balanceSun / 1e6;
    // Native TRX transfer needs ~280 bandwidth which is free if account has TRX,
    // or ~0.28 TRX burned. Reserve 1 TRX for safety.
    const FEE_RESERVE = 1;
    if (balanceTrx < amount + FEE_RESERVE) {
      return { ok: false, error: `TRX insufficient: have ${balanceTrx.toFixed(4)}, need ${(amount + FEE_RESERVE).toFixed(4)} (incl fee reserve)` };
    }

    const amountSun = Math.round(amount * 1e6);
    const tx = await tronWeb.trx.sendTransaction(toAddress, amountSun);

    const txHash = tx?.txid || tx?.transaction?.txID || '';
    if (!txHash) {
      return { ok: false, error: 'sendTransaction returned no txid' };
    }
    if (tx?.result === false) {
      return { ok: false, error: tx?.message || 'TRON sendTransaction returned result=false' };
    }

    console.log(`[tron-transfer] ${amount} TRX → ${toAddress.slice(0, 12)}... TX: ${txHash}`);
    return { ok: true, txHash };
  } catch (err) {
    console.error(`[tron-transfer] Native TRX transfer failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Check if TRON chain is supported for TRC20 transfer.
 */
export function isTronChainSupported(chain) {
  return chain === 'tron';
}
