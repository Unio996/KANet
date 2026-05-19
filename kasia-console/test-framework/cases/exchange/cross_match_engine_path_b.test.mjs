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

    // L5: tickCrossMatchOnce callable
    const result = mod.tickCrossMatchOnce(0.034);  // mock marketPrice
    if (typeof result?.scanCount !== 'number') return { ok: false, error: 'tickCrossMatchOnce 返 unexpected shape' };
    if (typeof result?.matchCount !== 'number') return { ok: false, error: 'matchCount 字段缺' };

    // ── NWT N19.20 hotfix behavioral tests ──

    // L6 (Issue 4): marketPrice null fail-closed (Risk gate 1 不 bypass)
    const nullResult = mod.tickCrossMatchOnce(null);
    if (nullResult.skipReason !== 'marketPrice_null') {
      return { ok: false, error: 'Issue 4: marketPrice null 应 fail-closed + skipReason=marketPrice_null' };
    }
    if (nullResult.matches?.length !== 0) {
      return { ok: false, error: 'Issue 4: marketPrice null tick 不应有 matches' };
    }

    // L7 (Issue 1): heartbeat 必 emit 即使 0 match (DB query verify)
    const beforeCount = db.open ? null : (() => {
      const db2 = new Database(DB_PATH, { readonly: true });
      const c = db2.prepare("SELECT COUNT(*) AS c FROM chain_events WHERE event_type = 'kanet_cross_match_tick_v1'").get();
      db2.close();
      return c.c;
    })();
    mod.tickCrossMatchOnce(0.034);  // run 1 tick (有 marketPrice, 应 emit heartbeat)
    const db3 = new Database(DB_PATH, { readonly: true });
    const afterCount = db3.prepare("SELECT COUNT(*) AS c FROM chain_events WHERE event_type = 'kanet_cross_match_tick_v1'").get().c;
    db3.close();
    if (beforeCount !== null && afterCount <= beforeCount) {
      return { ok: false, error: `Issue 1: heartbeat 未 emit (before=${beforeCount} after=${afterCount})` };
    }

    // L8 (Issue 2): txid scanCount suffix (避 UNIQUE collision)
    // 静态 read src — 现 _internals 没 expose txid pattern, grep src 检
    const { readFileSync } = await import('node:fs');
    const enginePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/cross-match-engine.js');
    const src = readFileSync(enginePath, 'utf8');
    if (!src.includes('_t${_scanCount}')) {
      return { ok: false, error: 'Issue 2: txid 缺 _t${_scanCount} suffix (KI 14 collision 风险)' };
    }

    // L9 (Issue 3): chain align strict (Phase 1 fail-closed)
    if (!src.includes('if (!buyUsdtChain || !sellUsdtChain || buyUsdtChain !== sellUsdtChain) continue')) {
      return { ok: false, error: 'Issue 3: chain align 未 fail-closed (NULL wildcard 真链 settle 撞)' };
    }

    return { ok: true, summary: 'Path B 9 layer 全 PASS (5 structural + 4 behavioral hotfix Issue 1-4 NWT N19.20)' };
  },
};
