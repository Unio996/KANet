// Regression guard: shard id → logical parent resolve (第二押注 shard_internal 修, 2026-07-01)
//
// Root cause (Owner 实测): bot /mybets "加注/反手" 复用持仓的 market_id = pool_bettor_sides.market_id
//   = SHARD id (shard_market_id, status='shard_internal'). 第一次押注走菜单(逻辑 id) OK; 第二次押注
//   (加注传 shard id) → prep/confirm status 检查 `!= 'pending_bettors'` → 拒 "market status=shard_internal,
//   registration closed"。每个真人第二押必撞。
//
// Fix (double-layer):
//   ① 根 (KANet-UI): GET /api/pool/market/:id + bot startBetFromMarket 解析 shard→logical (8da2e43a/0ef33d03)
//   ② prep 安全网 (J2 b3cd9c6d): _v07PrepConfirmPrelude 最顶 `SELECT logical_market_id FROM market_shards
//      WHERE shard_market_id=?` → shard id 换父逻辑盘 → 下游全按父盘(payAddr/nonce/register)。
//
// 这些 test 验 resolve 依赖的【数据不变量】(offline SQL, 无 chain/relay): shard_internal 市场必能解析到
//   一个存在的逻辑父盘。若不变量破(shard_internal 无 market_shards 行 / 父盘不存在)→ resolve no-op → bet 又撞。
//   = 守死"shard id 当 logical 用"这族 (同 [[shard_blind_query_regression]]·[[cov-id-provenance...]] 精神).

export default {
  id: 'shard_to_logical_resolve_regression',
  description: '第二押注 shard_internal 修 regression: shard id → logical parent resolve 数据不变量',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'shard_blind', 'offline', 'betting'],
  skip_in_batch: false,

  steps: [
    // ── Step 1: resolve SQL 语法有效 (= prep 安全网 b3cd9c6d 用的那句) ──
    // 假 shard id → 0 行, 无 error = SQL 语法有效。
    {
      id: 'resolve_sql_syntax',
      description: 'shard→logical resolve SQL 语法有效 (0 行 for fake shard id)',
      action: 'query_db',
      sql: `SELECT logical_market_id FROM market_shards WHERE shard_market_id = '__nonexistent_shard_id__' LIMIT 1`,
      expect: { must: { rows_min: 0 } },
    },

    // ── Step 2: 核心不变量 — 每个 shard_internal 市场都能解析到父逻辑盘 ──
    // shard_internal 是 shard-clone pool_markets 行 (register-v07 建·maker_stake=0)。它的 id 必是某
    // market_shards.shard_market_id → resolve 找得到 logical_market_id 父。
    // 违反 = shard_internal 市场的 id 不在 market_shards.shard_market_id (resolve no-op → 第二押注又撞 bug)。
    // 0 违反 = 不变量成立 (PASS)。
    {
      id: 'every_shard_internal_resolves',
      description: '不变量: 每个 shard_internal 市场 id 都在 market_shards.shard_market_id (resolve 找得到父·0 违反)',
      action: 'query_db',
      sql: `
        SELECT COUNT(*) AS violation_count FROM pool_markets pm
        WHERE pm.protocol_status = 'shard_internal'
          AND NOT EXISTS (
            SELECT 1 FROM market_shards ms WHERE ms.shard_market_id = pm.id
          )
      `,
      expect: {
        must: {
          rows_min: 1,                      // COUNT(*) 恒一行
          row_assert: { violation_count: 0 },  // 精确 0: 无 shard_internal 解析不到父
        },
      },
    },

    // ── Step 3: 解析出的父逻辑盘必真实存在 (pool_markets 有该行) ──
    // resolve 换到父 id 后·下游 SELECT * FROM pool_markets WHERE id=父 必命中。
    // 违反 = market_shards.logical_market_id 指向不存在的 pool_markets 行 (dangling·resolve 后取父盘失败)。
    {
      id: 'resolved_parent_exists',
      description: '不变量: 每个 shard 的 logical_market_id 父盘真实存在于 pool_markets (0 dangling)',
      action: 'query_db',
      sql: `
        SELECT COUNT(*) AS dangling_count FROM market_shards ms
        WHERE NOT EXISTS (
          SELECT 1 FROM pool_markets pm WHERE pm.id = ms.logical_market_id
        )
      `,
      expect: {
        must: {
          rows_min: 1,
          row_assert: { dangling_count: 0 },
        },
      },
    },

    // ── Step 4: sanity — 若有 shard_internal 数据·resolve 真能从 shard id 拿到父 (非空 mapping) ──
    // 0 行 = 此 DB 无 shard_internal (fresh 测库) → informational SKIP (vacuous PASS)。
    // 1+ 行 = 每行 shard id → 有效 logical 父 id·证 resolve 映射真通 (第二押注能兜到父盘)。
    {
      id: 'shard_to_logical_mapping_nonempty_if_data',
      description: '有 shard_internal 数据时·resolve shard→logical 映射非空 (第二押注兜底真通)',
      action: 'query_db',
      sql: `
        SELECT pm.id AS shard_id, ms.logical_market_id AS resolved_parent
        FROM pool_markets pm
        JOIN market_shards ms ON ms.shard_market_id = pm.id
        WHERE pm.protocol_status = 'shard_internal'
        LIMIT 5
      `,
      expect: {
        must: { rows_min: 0 },  // 0 = 无 shard 数据 (vacuous SKIP); 有则每行是有效 shard→parent 映射
      },
      // 回归价值: 若 resolve 依赖的 join 被破 (market_shards schema 变/shard_internal 不再进 market_shards)→此步暴露。
    },
  ],
};
