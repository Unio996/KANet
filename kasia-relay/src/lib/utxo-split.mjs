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

const { Generator, RpcClient, Resolver, Encoding, Address, sompiToKaspaString } = kaspa;

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
  const networkId = wallet.getNetworkId();

  const directUrl = await resolveRpcUrl();
  const rpcOpts = directUrl
    ? { url: directUrl, encoding: Encoding.Borsh, networkId }
    : { resolver: new Resolver(), encoding: Encoding.Borsh, networkId };

  const rpc = new RpcClient(rpcOpts);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RPC timeout')), 15_000);
      rpc.connect({}).then(() => { clearTimeout(timer); resolve(); }, (err) => { clearTimeout(timer); reject(err); });
    });

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

    const feeReserve = 5000n;
    const perOutput = (totalBalance - feeReserve) / BigInt(splitCount);
    const outputs = [];
    for (let i = 0; i < splitCount - 1; i++) {
      outputs.push({ address, amount: perOutput });
    }

    const generator = new Generator({
      entries,
      outputs,
      priorityFee: 0n,
      changeAddress: address,
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
    try { await rpc.disconnect(); } catch {}
  }
}
