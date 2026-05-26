// Oracle v0.3 sub 1 schema lock regression — v143 oracle_registry + oracle_history
//
// scope: schema lock invariant 守 (= 跟 docs/spec/oracle-v03-schema-lock-2026-05-26.md 一致)
// spec: Bettor-tn r26 R7 CLOSE + Owner 5/26 "全力推动" 钦定 + Bettor r19 R5 schema lock 机制
// migration: D drive kasia-console/src/db/migrate.js v143
//
// 真测维度:
//   I1: oracle_registry table exists + 10 columns 完整 + 3 indexes
//   I2: oracle_history table exists + 12 columns 完整 + 3 indexes
//   I3: tier CHECK constraint 守 (= 只接受 1/2/3, 其他 reject)
//   I4: bond_amount NULL 合法 (= tier 1/3 行)
//   I5: audit_mode NOT NULL constraint (= oracle_history 行必含)
//   I6: epoch DEFAULT 1 (= 跟 J1 #4 C3/C4 IS NULL/NOT NULL 分流 align)
//   I7: 索引 query plan 合理 (= sub 2 抽样 / sub 5 信誉 query 用)
//
// host: D drive console DB (= kasia-console/data/console.db, 测 DB 不影响 production)

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');

export default {
  id: 'oracle_schema_v143_lock',
  description: 'Oracle v0.3 sub 1 schema lock — oracle_registry + oracle_history v143 invariant',
  domain: 'oracle',
  tags: ['regression', 'p0', 'oracle-v0.3', 'sub-1', 'schema-lock'],

  async run() {
    const failures = [];
    const db = new Database(DB_PATH, { readonly: true });
    try {
      // I1: oracle_registry table + columns + indexes
      const regCols = db.prepare(`PRAGMA table_info(oracle_registry)`).all().map(c => c.name);
      const regExpected = ['relay_node_id', 'pubkey', 'tier', 'capabilities', 'announced_at',
        'expires_at', 'bond_amount', 'status', 'epoch', 'updated_at'];
      for (const col of regExpected) {
        if (!regCols.includes(col)) failures.push(`I1: oracle_registry missing column ${col}`);
      }
      if (regCols.length !== regExpected.length) {
        failures.push(`I1: oracle_registry col count ${regCols.length} != expected ${regExpected.length} (drift?)`);
      }

      const regIdx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='oracle_registry' AND name LIKE 'idx_%'`).all().map(r => r.name);
      const regIdxExpected = ['idx_oracle_registry_tier_status', 'idx_oracle_registry_expires', 'idx_oracle_registry_epoch'];
      for (const idx of regIdxExpected) {
        if (!regIdx.includes(idx)) failures.push(`I1: oracle_registry missing index ${idx}`);
      }

      // I2: oracle_history table + columns + indexes
      const histCols = db.prepare(`PRAGMA table_info(oracle_history)`).all().map(c => c.name);
      const histExpected = ['id', 'oracle_relay_id', 'market_id', 'vote', 'consensus_outcome',
        'reward_amount', 'slashed_amount', 'audit_mode', 'audited_at', 'settled_at', 'epoch', 'created_at'];
      for (const col of histExpected) {
        if (!histCols.includes(col)) failures.push(`I2: oracle_history missing column ${col}`);
      }
      if (histCols.length !== histExpected.length) {
        failures.push(`I2: oracle_history col count ${histCols.length} != expected ${histExpected.length} (drift?)`);
      }

      const histIdx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='oracle_history' AND name LIKE 'idx_%'`).all().map(r => r.name);
      const histIdxExpected = ['idx_oracle_history_oracle_settled', 'idx_oracle_history_market', 'idx_oracle_history_epoch'];
      for (const idx of histIdxExpected) {
        if (!histIdx.includes(idx)) failures.push(`I2: oracle_history missing index ${idx}`);
      }

      // I3-I7: 用 write DB conn 验 CHECK / NOT NULL / DEFAULT
      db.close();
      const dbw = new Database(DB_PATH);
      try {
        // I3: tier CHECK reject invalid
        try {
          dbw.prepare(`INSERT INTO oracle_registry (relay_node_id, pubkey, tier, status, epoch) VALUES ('test-i3', 'pk-test', 99, 'active', 1)`).run();
          failures.push('I3: tier=99 should fail CHECK constraint but inserted');
          dbw.prepare(`DELETE FROM oracle_registry WHERE relay_node_id='test-i3'`).run();
        } catch (e) {
          if (!/CHECK constraint failed/i.test(e.message)) {
            failures.push(`I3: tier=99 wrong error ${e.message.slice(0, 80)}`);
          }
        }

        // I4: bond_amount NULL OK for tier 1/3
        try {
          dbw.prepare(`INSERT INTO oracle_registry (relay_node_id, pubkey, tier, bond_amount, status, epoch) VALUES ('test-i4', 'pk-test', 1, NULL, 'active', 1)`).run();
          dbw.prepare(`DELETE FROM oracle_registry WHERE relay_node_id='test-i4'`).run();
        } catch (e) {
          failures.push(`I4: tier=1 + bond_amount=NULL rejected (should accept): ${e.message.slice(0, 80)}`);
        }

        // I5: oracle_history audit_mode NOT NULL
        try {
          dbw.prepare(`INSERT INTO oracle_history (id, oracle_relay_id, market_id, audit_mode) VALUES ('test-i5', 'r1', 'm1', NULL)`).run();
          failures.push('I5: audit_mode=NULL should fail NOT NULL but inserted');
          dbw.prepare(`DELETE FROM oracle_history WHERE id='test-i5'`).run();
        } catch (e) {
          if (!/NOT NULL constraint failed/i.test(e.message)) {
            failures.push(`I5: audit_mode=NULL wrong error ${e.message.slice(0, 80)}`);
          }
        }

        // I6: epoch DEFAULT 1
        try {
          dbw.prepare(`INSERT INTO oracle_registry (relay_node_id, pubkey, tier, status) VALUES ('test-i6', 'pk-test', 2, 'active')`).run();
          const row = dbw.prepare(`SELECT epoch FROM oracle_registry WHERE relay_node_id='test-i6'`).get();
          if (row?.epoch !== 1) failures.push(`I6: epoch DEFAULT 1 not applied, got ${row?.epoch}`);
          dbw.prepare(`DELETE FROM oracle_registry WHERE relay_node_id='test-i6'`).run();
        } catch (e) {
          failures.push(`I6: insert fail ${e.message.slice(0, 80)}`);
        }

        // I7: index query plan 用 (= sample query EXPLAIN)
        const plan = dbw.prepare(`EXPLAIN QUERY PLAN SELECT * FROM oracle_registry WHERE tier=2 AND status='active'`).all();
        const usesIdx = plan.some(p => /idx_oracle_registry_tier_status/.test(p.detail || ''));
        if (!usesIdx) {
          failures.push(`I7: tier+status query 不 use idx_oracle_registry_tier_status (plan: ${JSON.stringify(plan).slice(0,200)})`);
        }
      } finally {
        dbw.close();
      }

      if (failures.length > 0) {
        return { ok: false, error: failures.join('; '), failures };
      }
      return { ok: true, summary: `Oracle v0.3 sub 1 schema lock — 7 invariant PASS (oracle_registry 10 col + 3 idx + oracle_history 12 col + 3 idx + tier CHECK + bond NULL + audit_mode NOT NULL + epoch DEFAULT 1 + idx query plan)` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
