// Path B — C2 cross-match engine regression (J2 #519/523 / NWT N19.11/N19.17 / Owner 钦定 "C 骨架")
// 30s cron 扫 BUY+SELL pair, 4 risk gate (oracle ±3% / chain align / same-org / qty ±5%) → emit chain_event.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');

export default {
  id: 'cross_match_engine_path_b',
  description: 'Path B cross-match engine 4 risk gate + emit chain_event regression',
  domain: 'exchange',
  tags: ['regression', 'p1', 'cross-match', 'path-b'],

  async run() {
    // L1: module load + exports
    const mod = await import('../../../src/services/cross-match-engine.js');
    if (typeof mod.startCrossMatchEngine !== 'function') return { ok: false, error: 'startCrossMatchEngine not exported' };
    if (typeof mod.tickCrossMatchOnce !== 'function') return { ok: false, error: 'tickCrossMatchOnce not exported' };
    if (!mod._internals) return { ok: false, error: '_internals 未 expose' };

    // L2: 4 risk gate constants
    if (mod._internals.PRICE_TOLERANCE !== 0.03) return { ok: false, error: `PRICE_TOLERANCE expect 0.03 got ${mod._internals.PRICE_TOLERANCE}` };
    if (mod._internals.QTY_TOLERANCE !== 0.05) return { ok: false, error: `QTY_TOLERANCE expect 0.05 got ${mod._internals.QTY_TOLERANCE}` };
    if (mod._internals.TICK_MS !== 30000) return { ok: false, error: `TICK_MS expect 30000 got ${mod._internals.TICK_MS}` };
    if (!Array.isArray(mod._internals.BROKER_ORG_NAMES) || mod._internals.BROKER_ORG_NAMES.length !== 3) {
      return { ok: false, error: 'BROKER_ORG_NAMES expect [Trader-A, Trader-B, Trader-M]' };
    }

    // L3: same-org skip 包含 3 broker relay
    const expected = ['Trader-A', 'Trader-B', 'Trader-M'];
    for (const n of expected) {
      if (!mod._internals.BROKER_ORG_NAMES.includes(n)) return { ok: false, error: `BROKER_ORG_NAMES 缺 ${n}` };
    }

    // L4: 真生产 broker org relay 查得到 (DB)
    const db = new Database(DB_PATH, { readonly: true });
    const placeholders = expected.map(() => '?').join(',');
    const rows = db.prepare(`SELECT address FROM relay_nodes WHERE name IN (${placeholders})`).all(...expected);
    db.close();
    if (rows.length !== 3) return { ok: false, error: `broker relay 实际 ${rows.length}/3 (Trader-A/B/M)` };

    // L5: tickCrossMatchOnce can run synchronously without market price (audit-only)
    const result = mod.tickCrossMatchOnce(null);  // null price = skip oracle gate
    if (typeof result?.scanCount !== 'number') return { ok: false, error: 'tickCrossMatchOnce 返 unexpected shape' };
    if (typeof result?.matchCount !== 'number') return { ok: false, error: 'matchCount 字段缺' };

    return { ok: true, summary: 'Path B cross-match engine 5 layer (exports + 4 risk const + broker org DB + tick callable) PASS' };
  },
};
