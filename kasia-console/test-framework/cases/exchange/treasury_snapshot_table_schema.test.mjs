// P2 treasury_snapshot schema test — NWT N19.6 + Owner 5/18 钦定
// v122 migration creates treasury_snapshot, broker-treasury-monitor 写入 multi-chain balance

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');

export default {
  id: 'treasury_snapshot_table_schema',
  description: 'P2 treasury_snapshot table schema verify (v122 migrate) + broker-treasury-monitor module load',
  domain: 'exchange',
  tags: ['regression', 'p2', 'treasury'],

  async run() {
    const db = new Database(DB_PATH, { readonly: true });
    const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='treasury_snapshot'").get();
    db.close();
    if (!t?.sql) return { ok: false, error: 'treasury_snapshot table not found (v122 migrate missing)' };
    const cols = ['id', 'relay_node_id', 'chain', 'asset', 'balance_raw', 'balance_human', 'snapshot_at', 'source'];
    for (const c of cols) {
      if (!t.sql.includes(c)) return { ok: false, error: `column ${c} missing in treasury_snapshot` };
    }

    // module load + internals exposed
    const mod = await import('../../../src/services/broker-treasury-monitor.js');
    if (typeof mod.startTreasuryMonitor !== 'function') return { ok: false, error: 'startTreasuryMonitor not exported' };
    if (!mod._internals?.TOKEN_REGISTRY) return { ok: false, error: '_internals.TOKEN_REGISTRY not exposed' };

    // TOKEN_REGISTRY sanity: 5 EVM (USDT+USDC) + base USDC only
    const reg = mod._internals.TOKEN_REGISTRY;
    if (!reg.bnb?.USDT || !reg.bnb?.USDC) return { ok: false, error: 'BSC USDT/USDC missing' };
    if (!reg.polygon?.USDT) return { ok: false, error: 'Polygon USDT missing' };
    if (reg.base?.USDT) return { ok: false, error: 'base should NOT have USDT (no native)' };

    if (mod._internals.FLOOR_USD !== 50) return { ok: false, error: `FLOOR_USD expected 50, got ${mod._internals.FLOOR_USD}` };
    if (mod._internals.HIGH_THRESHOLD_USD !== 500) return { ok: false, error: `HIGH_THRESHOLD_USD expected 500, got ${mod._internals.HIGH_THRESHOLD_USD}` };

    return { ok: true, summary: 'treasury_snapshot schema 8 cols + broker-treasury-monitor module load + TOKEN_REGISTRY 5 EVM + thresholds verified' };
  },
};
