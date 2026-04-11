/**
 * Solana SPL Token Transfer — USDT on Solana.
 *
 * Used by:
 *   - trade-protocol-filter.js (exchange autoPayExchange)
 *
 * Mirrors evm-transfer.js interface: transferSPL() → { ok, txHash } | { ok, error }
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { decrypt } from './crypto.js';

const SOL_RPC = 'https://api.mainnet-beta.solana.com';

const SPL_TOKENS = {
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
};

/**
 * Transfer SPL token (USDT/USDC) on Solana.
 *
 * @param {string} privkeyEncrypted — encrypted private key (bs58 secretKey) from agent_wallets
 * @param {string} toAddress — recipient Solana address (base58)
 * @param {number} amount — amount in human-readable units (e.g. 3.25)
 * @param {string} [asset='USDT'] — USDT or USDC
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function transferSPL(privkeyEncrypted, toAddress, amount, asset = 'USDT') {
  const token = SPL_TOKENS[asset.toUpperCase()];
  if (!token) {
    return { ok: false, error: `Unsupported SPL token: ${asset} (supported: ${Object.keys(SPL_TOKENS).join(', ')})` };
  }

  try {
    // Decrypt private key and build keypair
    const privkeyStr = decrypt(privkeyEncrypted);
    const bs58 = (await import('bs58')).default;
    const secretKey = bs58.decode(privkeyStr);
    const payer = Keypair.fromSecretKey(secretKey);

    const connection = new Connection(SOL_RPC, 'confirmed');
    const mintPubkey = new PublicKey(token.mint);
    const recipientPubkey = new PublicKey(toAddress);

    // Get sender's Associated Token Account
    const senderATA = await getAssociatedTokenAddress(mintPubkey, payer.publicKey);
    let senderAccount;
    try {
      senderAccount = await getAccount(connection, senderATA);
    } catch {
      return { ok: false, error: `No ${asset} token account found for sender ${payer.publicKey.toBase58().slice(0, 12)}...` };
    }

    // Check balance
    const balanceLamports = Number(senderAccount.amount);
    const balanceFloat = balanceLamports / (10 ** token.decimals);
    if (balanceFloat < amount) {
      return { ok: false, error: `${asset} insufficient: have ${balanceFloat.toFixed(2)}, need ${amount.toFixed(2)}` };
    }

    // Get or create recipient's Associated Token Account
    const recipientATA = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
    const tx = new Transaction();

    let recipientAccountExists = true;
    try {
      await getAccount(connection, recipientATA);
    } catch {
      recipientAccountExists = false;
    }

    if (!recipientAccountExists) {
      // Create ATA for recipient (payer pays rent)
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,          // payer
          recipientATA,             // associatedToken
          recipientPubkey,          // owner
          mintPubkey,               // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        )
      );
    }

    // Transfer instruction
    const amountLamports = Math.round(amount * (10 ** token.decimals));
    tx.add(
      createTransferInstruction(
        senderATA,        // source
        recipientATA,     // destination
        payer.publicKey,  // owner
        amountLamports,
        [],
        TOKEN_PROGRAM_ID,
      )
    );

    // Send and confirm
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: 'confirmed',
      maxRetries: 3,
    });

    console.log(`[sol-transfer] ${amount} ${asset} → ${toAddress.slice(0, 12)}... TX: ${signature}`);
    return { ok: true, txHash: signature };
  } catch (err) {
    console.error(`[sol-transfer] Failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Check if Solana chain is supported for SPL transfer.
 */
export function isSolChainSupported(chain) {
  return chain === 'sol';
}
