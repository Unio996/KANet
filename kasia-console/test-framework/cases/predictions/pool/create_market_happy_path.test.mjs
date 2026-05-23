// Happy path: A.1 maker create market — V2 极简 5 fields → spine P2SH lock TX
//
// scope: per Bettor r446 "ship 必加 1 happy + 5 adversarial" (= adversarial 后续 iteration)
// spec: docs/b2-pool-ui-spec-v0.1.md Section 1 A.1, KANet-UI ship d629103
// backend: POST /api/pool/market/create per Bettor r449 4 决策 (= 5 required + 6 backend defaults)
//
// 真测维度:
//   1. backend POST 5 fields → 200 + market_id + spine_p2sh
//   2. DB pool_markets row inserted with status=pending_oracle_sampling
//   3. spine_lock_tx 字段返回 (= relay 已签 + broadcast TX hex)
//   4. backend defaults auto-fill verify (= 6 件 r449)
//
// 不 cover (= 后续 iteration):
//   - browser UI 渲染 (= Owner 手 browser test + 后续 Playwright)
//   - chain TX 上链 confirm (= 真链 wait, async, 后续 chain_event poll case)
//   - oracle 接单 / settle / refund (= A.2b detail page case)
//
// host: 假设 TN12 console on 127.0.0.1:3300 (= J1 #540 deploy). 若不同 port, edit POOL_CONSOLE_URL env.

const POOL_CONSOLE_URL = process.env.POOL_CONSOLE_URL || 'http://127.0.0.1:3300';

// pick first available is_oracle=0 + is_maker_capable relay (= 测试 maker)
// 若 DB 没合适 relay, case fail with clear message
export default {
  id: 'create_market_happy_path',
  description: 'A.1 V2 极简 5 字段 → POST /api/pool/market/create 200 + spine_p2sh + DB row',
  domain: 'predictions',
  tags: ['happy_path', 'a1', 'real_chain'],
  // 真链 ship — manual / opt-in 不 batch run
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `SELECT id FROM relay_nodes WHERE is_oracle = 0 LIMIT 1`,
      expect: {
        must: {
          rows_min: 1,  // 至少 1 个 non-oracle relay 当 maker
        },
      },
      save_as: 'maker_relay',
    },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) as c FROM relay_nodes WHERE is_oracle = 1`,
      expect: {
        must: {
          // backend Fisher-Yates 抽 3 needs >= 3 in pool (excluding maker)
          rows_min: 1,
        },
      },
      save_as: 'oracle_pool_count',
    },
    {
      // V2 wireframe 5 字段, backend r449 4 决策 6 defaults auto-fill
      action: 'http_post',
      url: `${POOL_CONSOLE_URL}/api/pool/market/create`,
      body: {
        // dynamic — runner replaces ${maker_relay.id} from save_as
        maker_relay_id: '${maker_relay.id}',
        outcome_side: 'YES',
        // 30 min into future (= > 15 min POOL_DEADLINE_MIN_OVERRIDE 默认 + < 30 day cap)
        outcome_end_date: new Date(Date.now() + 30 * 60_000).toISOString(),
        resolution_rule_spec: 'A.1 happy_path test: 看 Binance BTC/USDT 6/30 23:59 UTC 收盘 ≥80000 = YES, 否 NO.',
        maker_stake_kas: '1',
        // backend defaults fill: oracle_relay_ids (auto-sample), broker_relay_id (= maker),
        // broker_fee_pct (0), oracle_bond_kas (1), outcome_market_source (kanet_v05),
        // outcome_token_id (KAS_native), outcome_condition_id (sha256)
      },
      timeout_ms: 30_000,
      expect: {
        must: {
          http_status: 200,
          response_ok: true,
          response_has_keys: ['market_id', 'spine_p2sh', 'spine_lock_tx'],
        },
      },
      save_as: 'create_result',
    },
    {
      // verify DB row inserted (= status pending_oracle_sampling per spec phase 顺序)
      action: 'query_db',
      sql: `SELECT id, status, maker_relay_id, broker_relay_id, broker_fee_pct, oracle_bond_kas, outcome_market_source, outcome_token_id FROM pool_markets WHERE id = ?`,
      params: ['${create_result.market_id}'],
      expect: {
        must: {
          rows_min: 1,
          row_eq: {
            // r449 4 决策 backend defaults verify
            status: 'pending_oracle_sampling',
            broker_relay_id: '${maker_relay.id}',  // D4: broker default = maker
            broker_fee_pct: 0,                      // D4: 0 default
            oracle_bond_kas: 1,                     // D3: 1 KAS hardcoded
            outcome_market_source: 'kanet_v05',     // D2: default
            outcome_token_id: 'KAS_native',          // D2: default
          },
        },
      },
    },
    {
      // verify oracle_relay_ids 3 sampled (= D1 server-side Fisher-Yates per Q11 exclude maker)
      action: 'query_db',
      sql: `SELECT oracle_relay_ids FROM pool_markets WHERE id = ?`,
      params: ['${create_result.market_id}'],
      expect: {
        must: {
          rows_min: 1,
          row_assert: {
            oracle_relay_ids: {
              // parse JSON, expect array of 3 unique, none = maker
              custom: (val, { saved }) => {
                const arr = typeof val === 'string' ? JSON.parse(val) : val;
                if (!Array.isArray(arr) || arr.length !== 3) return `oracle_relay_ids must be array of 3, got ${JSON.stringify(arr)}`;
                if (new Set(arr).size !== 3) return `oracle_relay_ids must be unique`;
                if (arr.includes(saved.maker_relay.id)) return `oracle_relay_ids must NOT include maker (Q11 violation)`;
                return null;
              },
            },
          },
        },
      },
    },
  ],
};
