// test-framework/lib/chain-wallets.mjs — per-chain agent wallet address lookup.
//
// Sub #2 (NWT β path multichain e2e) needs broker/taker chain addresses for accepted_chains[]
// in publish body and validating balance pre/post. Derive from agent_wallets DB so tests
// don't hardcode 7 chain × 2 trader = 14 addresses (5/13 sediment: 全派生不硬编码).

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relayId } from './peers.mjs';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/console.db');

/**
 * Look up the default chain wallet address for a relay alias.
 * @param {string} alias — 'trader-a' / 'trader-b' / 'nwt' / 'j2' / etc.
 * @param {string} chain — 'bnb' / 'eth' / 'polygon' / 'arbitrum' / 'optimism' / 'avalanche' / 'base' / 'sol' / 'tron'
 * @returns {string|null} address (0x... for EVM, base58 for SOL, T-prefix for TRON), or null if not configured.
 */
export function chainWalletAddr(alias, chain) {
  const rid = relayId(alias);
  if (!rid) throw new Error(`chainWalletAddr: unknown alias '${alias}'`);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.prepare(
      "SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
    ).get(rid, chain);
    return row?.address || null;
  } finally {
    db.close();
  }
}
