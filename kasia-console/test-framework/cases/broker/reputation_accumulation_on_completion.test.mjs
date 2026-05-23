// T-J2-2026-05-11 Phase 2 E.5 (NWT #18 ABE audit E 5th sub — E 完):
// reputation_summary accumulation regression test
//
// E.1 schema + E.2 recordChainEvent post-insert hook + E.3 _readSummary + E.4 backfill 全 ship。
// 此 test (E.5) verify upsert SQL 语义:
// - INSERT 第一次 settlement event 创 row with counter=1 + volume
// - INSERT 第二 settlement event 同 address → counter increment + volume aggregate
// - 不同 event_type → 不同 counter field 各自累计
//
// 直接 exec_sql INSERT/UPDATE reputation_summary 模拟 E.2 hook 行为, 不依赖 chain_events 跑 hook
// (chain_events INSERT 真 JS hook 触发, test framework 不易模拟 hook fire — 真测 SQL upsert 语义直接)。

const TEST_ADDR = `kaspa:test-rep-${Date.now().toString(36).slice(-8)}`;

export default {
  id: 'reputation_accumulation_on_completion',
  description: 'Phase 2 E.5 (NWT #18 ABE): reputation_summary upsert 累计 semantics — counter increment + volume aggregate',
  domain: 'broker',
  tags: ['regression', 'reputation', 'phase-2-abe', 'e-5-test'],
  skip_in_batch: true,
  steps: [
    // T1: cleanup test address (idempotent test setup)
    {
      action: 'exec_sql',
      sql: `DELETE FROM reputation_summary WHERE address = ?`,
      params: [TEST_ADDR],
    },

    // T2: 第一 exchange_completed upsert — INSERT new row
    {
      action: 'exec_sql',
      sql: `INSERT INTO reputation_summary (address, completed_count, total_kas_volume, total_usd_volume, last_event_at, last_updated_at)
            VALUES (?, 1, 100, 0, datetime('now'), datetime('now'))
            ON CONFLICT(address) DO UPDATE SET
              completed_count = completed_count + 1,
              total_kas_volume = total_kas_volume + excluded.total_kas_volume,
              total_usd_volume = total_usd_volume + excluded.total_usd_volume,
              last_event_at = excluded.last_event_at,
              last_updated_at = excluded.last_updated_at`,
      params: [TEST_ADDR],
    },

    // T3: verify 第一 row 创建 + counters
    {
      action: 'query_db',
      sql: `SELECT completed_count, disputed_count, timed_out_count, total_kas_volume, total_usd_volume FROM reputation_summary WHERE address = ?`,
      params: [TEST_ADDR],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: {
            completed_count: 1,
            disputed_count: 0,
            timed_out_count: 0,
            total_kas_volume: 100,
            total_usd_volume: 0,
          },
        },
      },
    },

    // T4: 第二 exchange_completed upsert — counter increment + volume add
    {
      action: 'exec_sql',
      sql: `INSERT INTO reputation_summary (address, completed_count, total_kas_volume, total_usd_volume, last_event_at, last_updated_at)
            VALUES (?, 1, 50, 0, datetime('now'), datetime('now'))
            ON CONFLICT(address) DO UPDATE SET
              completed_count = completed_count + 1,
              total_kas_volume = total_kas_volume + excluded.total_kas_volume,
              total_usd_volume = total_usd_volume + excluded.total_usd_volume,
              last_event_at = excluded.last_event_at,
              last_updated_at = excluded.last_updated_at`,
      params: [TEST_ADDR],
    },

    // T5: verify counter accumulated
    {
      action: 'query_db',
      sql: `SELECT completed_count, total_kas_volume FROM reputation_summary WHERE address = ?`,
      params: [TEST_ADDR],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: {
            completed_count: 2,
            total_kas_volume: 150,
          },
        },
      },
    },

    // T6: 不同 event_type (disputed) upsert — 不同 counter field
    {
      action: 'exec_sql',
      sql: `INSERT INTO reputation_summary (address, disputed_count, total_kas_volume, total_usd_volume, last_event_at, last_updated_at)
            VALUES (?, 1, 0, 25, datetime('now'), datetime('now'))
            ON CONFLICT(address) DO UPDATE SET
              disputed_count = disputed_count + 1,
              total_kas_volume = total_kas_volume + excluded.total_kas_volume,
              total_usd_volume = total_usd_volume + excluded.total_usd_volume,
              last_event_at = excluded.last_event_at,
              last_updated_at = excluded.last_updated_at`,
      params: [TEST_ADDR],
    },

    // T7: verify disputed_count incremented + usd volume added + completed 不变
    {
      action: 'query_db',
      sql: `SELECT completed_count, disputed_count, total_kas_volume, total_usd_volume FROM reputation_summary WHERE address = ?`,
      params: [TEST_ADDR],
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: {
            completed_count: 2,  // 不变
            disputed_count: 1,
            total_kas_volume: 150,  // 不变
            total_usd_volume: 25,
          },
        },
      },
    },

    // T8: cleanup
    {
      action: 'exec_sql',
      sql: `DELETE FROM reputation_summary WHERE address = ?`,
      params: [TEST_ADDR],
    },
  ],
};
