/**
 * UTXO Splitter — Console-side orchestrator.
 *
 * Delegates actual signing/RPC to Relay via IPC (split_utxo command).
 * Console never touches kaspa-wasm or private keys.
 */
import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';

const TARGET_UTXO_COUNT = 3;

/**
 * Split UTXOs for a single relay account via Relay IPC.
 */
export async function splitUtxos(relayNodeId, targetCount = TARGET_UTXO_COUNT) {
  try {
    const result = await sendCommandAsync(relayNodeId, { type: 'split_utxo', targetCount }, 20_000);
    return result || { ok: false, reason: 'no_response' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Auto-split all relay accounts. Called after relays are started.
 */
export async function autoSplitAll() {
  const accounts = sqlite.prepare(
    `SELECT id, name FROM relay_nodes WHERE address IS NOT NULL AND mnemonic_encrypted IS NOT NULL`
  ).all();

  let splitCount = 0;
  for (const a of accounts) {
    try {
      const result = await splitUtxos(a.id);
      if (result.split) {
        splitCount++;
        console.log(`[utxo-splitter] ${a.name}: ${result.utxosBefore} → ${result.utxosAfter} UTXOs (fee: ${result.fee} KAS)`);
      }
    } catch (err) {
      console.log(`[utxo-splitter] ${a.name}: skip (${err.message})`);
    }
  }

  console.log(`[utxo-splitter] ${splitCount}/${accounts.length} accounts split`);
}
