/**
 * UTXO Splitter — Relay-side implementation.
 *
 * Pre-splits UTXOs so an Agent can send several messages concurrently.
 * Reuses Relay's wallet (private key) and RPC connection.
 *
 * KIP-9 safe split count: N_max = floor(sqrt(1 + balance_sompi / 10^7)) - 1
 */

import * as kaspa from 'kaspa-wasm';
import { getWallet } from './wallet.mjs';
import { waitForRpc } from '../rpc-listener.mjs';

const { Generator, Encoding, Address, sompiToKaspaString, PaymentOutput } = kaspa;
const Resolver = kaspa.Resolver || null;

const MIN_BALANCE_FOR_SPLIT = 20_000_000n; // 0.2 KAS

async function resolveRpcUrl() {
  if (process.env.KASPA_RPC_URL) return process.env.KASPA_RPC_URL;
  if (process.env.RPC_URL) return process.env.RPC_URL;
  return null;
}

function maxSafeOutputs(balanceSompi) {
  const v = Number(balanceSompi);
  return Math.max(1, Math.floor(Math.sqrt(1 + v / 1e7)) - 1);
}

/**
 * Split UTXOs using Relay's own wallet.
 * @param {number} targetCount - Desired number of UTXOs (default 3)
 * @returns {{ ok, split, utxosBefore, utxosAfter, txId?, fee?, reason? }}
 */
export async function splitUtxosRelay(targetCount = 3) {
  const wallet = getWallet();
  const address = wallet.getAddress();
  // KANet-UI r55 Layer 4: testnet-12 → testnet-10 for Generator (vendored wasm string match).
  const networkId = wallet.getGeneratorNetworkId();

  const rpc = await waitForRpc();
  try {
    const { entries } = await rpc.getUtxosByAddresses([new Address(address)]);
    if (!entries || entries.length === 0) return { ok: false, reason: 'no_utxos' };

    const utxosBefore = entries.length;
    if (utxosBefore >= targetCount) {
      return { ok: true, split: false, utxosBefore, utxosAfter: utxosBefore, reason: 'sufficient' };
    }

    const totalBalance = entries.reduce((sum, e) => sum + BigInt(e.amount), 0n);
    if (totalBalance < MIN_BALANCE_FOR_SPLIT) {
      return { ok: false, reason: 'balance_too_low', balance: sompiToKaspaString(totalBalance).toString() };
    }

    const maxN = maxSafeOutputs(totalBalance);
    const splitCount = Math.min(targetCount, maxN);
    if (splitCount <= 1) {
      return { ok: false, reason: 'balance_too_low_for_split', maxSafe: maxN };
    }

    // 5/29 NWT iter 5 (UI r85 BUG2 catch): pre-Toccata feeReserve=5000n + priorityFee=0n
    // 撞 kaspad v1.2.0 post-Toccata 100 sompi/mass standardness floor. split TX 1→N outputs mass ≈ N×~1500
    // → 3-split TX mass ~4500 → required fee ~450000 sompi. Hardcoded 5000n way under floor → "not standard" reject.
    // Fix: feeReserve floor = max(500k, N × 200k) covers structural overhead + per-output mass.
    // priorityFee floor 500_000n same pattern as transaction.mjs iter 4 (= bce1916).
    const feeReserve = BigInt(Math.max(500_000, splitCount * 200_000));
    const perOutput = (totalBalance - feeReserve) / BigInt(splitCount);
    const outputs = [];
    for (let i = 0; i < splitCount - 1; i++) {
      outputs.push(new PaymentOutput(new Address(address), perOutput));
    }

    const generator = new Generator({
      entries,
      outputs,
      priorityFee: 500_000n,
      changeAddress: new Address(address),
      networkId,
    });

    let pending, lastTxId = '';
    while ((pending = await generator.next())) {
      await pending.sign([wallet.getPrivateKey()]);
      lastTxId = await pending.submit(rpc);
    }

    if (!lastTxId) return { ok: false, reason: 'no_tx_produced' };
    const fee = sompiToKaspaString(generator.summary().fees).toString();

    return { ok: true, split: true, utxosBefore, utxosAfter: splitCount, txId: lastTxId, fee };
  } finally {
    // shared RpcClient managed by rpc-listener — do NOT disconnect from transaction layer
  }
}
