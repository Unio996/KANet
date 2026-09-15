> **Status**: CURRENT

# v207 加 shardleaf_cov_id 列后, 用真实带数据的库重跑外键完整性四条断言(账本1429/1431/1432)

## 背景

`docs/provenance/2026-09-15-j2-v207-foreignkey-rebuild-fix/` 已经证明并修复了 v207 重建表遇到真实
FK 链数据时的崩溃。Bettor 1432 批准在 v207 里再加一列 `shardleaf_cov_id`（并进这一版，不另开
v208，因为 v207 还没合并、也没在任何生产库上跑过），要求"带数据外键实测要用新的 v207 重跑一遍"。

## 方法

真实还原"生产库从 v206 升级到当前(含 `shardleaf_cov_id`)v207"这条路径，不是只测幂等跳过分支：

1. 用 `git show a35585e8:kasia-console/src/db/migrate.js`（v207 引入之前的版本）临时换入
   `src/db/migrate.js`，跑一次迁移，得到真实的 v206 形态库。
2. 插入真实 FK 链数据：1 条 `proto_token_defs` + 1 条 `proto_markets` + 1 条 `proto_bets`
   （`market_id` 指向那条 market）+ 1 条 `proto_bet_intents`（`bet_id` 指向那条 bet）。
3. 换回当前（含 `shardleaf_cov_id`）的 `src/db/migrate.js`，对这个**已经有真实数据**的库跑迁移——
   这是第一次真正触发"用新版 v207 重建一张有真实 FK 链数据的表"这条路径,不是对着空库建表。
4. 幂等复跑一次，确认第二次不再重建。

## 结果(五条断言全部通过)

| 断言 | 结果 |
|---|---|
| ① `PRAGMA foreign_key_check` 为空 | ✅ `[]` |
| ② `proto_bets` 的 `CREATE TABLE` 原文仍引用字面量 `proto_markets(id)`（不是 `proto_markets_v207`） | ✅ |
| ③ 行数迁移前后一致（markets=1, bets=1, intents=1） | ✅ |
| ④ 已有行的 `status`（显式传的 `'betting'`）未被新 `DEFAULT 'genesis_pending'` 覆盖；新列
    `shardleaf_cov_id` 对旧数据正确留空（`NULL`，不是某个占位值） | ✅ |
| ⑤ `shardleaf_cov_id` 列确实存在于重建后的表里 | ✅ |

幂等复跑：`[migrate] v207: proto_markets already has genesis intent columns/CHECK states
(idempotent skip)`——第二次不再重建，且不误判"缺列"（因为幂等检查同时核对 CHECK 状态和
`shardleaf_cov_id` 列，两者都满足才跳过）。

## 结论

加这一列没有重新引入 `docs/provenance/2026-09-15-j2-v207-foreignkey-rebuild-fix/` 已经修复过的
外键崩溃——修法（`PRAGMA foreign_keys=OFF` 在事务外 + `foreign_key_check` 断言）与列数无关，本笔
用真实数据+真实首次升级路径重新确认了这一点，不是理论推断。

## 处置

`shardleaf_cov_id` 列已并入 `kasia-console/src/db/migrate.js` 的 v207 块（同一笔提交），
`docs/DATABASE.md` 的 `proto_markets` 章节同步更新。写入时机、落链校验的 fail-closed 重算比对，
见生产代码 `kasia-console/src/lib/proto-market-intent.mjs`（`recordMarketIntentPhase` 写入 /
`checkMarketGenesisLanded` 校验）。

## 文件清单

- `README.md`（本文件）
