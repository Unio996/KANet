/**
 * UTXO Splitter — Console-side orchestrator.
 *
 * Delegates actual signing/RPC to Relay via IPC (split_utxo command).
 * Console never touches kaspa-wasm or private keys.
 */
import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';

// Round 1 真测 (2026-04-25) 显示 broker 高峰一分钟 7 笔, 3 个 UTXO 不够 → mempool 双花风暴.
// J2 raw log 03:09:34 累积 17 次 Trader-B Reply send failed. 调到 8 给高频 Agent 留余量.
const TARGET_UTXO_COUNT = 8;

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
