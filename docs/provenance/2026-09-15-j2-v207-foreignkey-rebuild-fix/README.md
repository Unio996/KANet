> **Status**: CURRENT

# v207 迁移外键崩溃修复(NWT 复核发现，账本1425后续)

## 问题

`kasia-console/src/db/migrate.js` 的 v207 迁移(`proto_markets` 加 genesis 两阶段状态机字段)用了
v204/v83 既有的"重建表加 CHECK 值"手法——`CREATE proto_markets_v207` → `INSERT...SELECT` 拷数据 →
`DROP TABLE proto_markets` → `RENAME`。`client.js:47` 恒开 `PRAGMA foreign_keys = ON`，而
`proto_bets.market_id REFERENCES proto_markets(id)`——直接 `DROP TABLE proto_markets` 在
`foreign_keys=ON` 下被 SQLite 拒绝(`SQLITE_CONSTRAINT_FOREIGNKEY`)。

v204(`submit_intents`)/多数既有重建式迁移之所以没撞到这条，是因为那些表恰好是叶子表(没有其它表用
FK 指向它们)。`proto_markets` 是第一个"自己被下游 FK 引用"的重建对象。

## 实测复现(不是理论推演)

用当前仓库 v207 之前(`4174764f~1`)的 `migrate.js` 建一个真实的 v206 形态库，插入 1 条
`proto_markets`+1 条 `proto_bets`+1 条 `proto_bet_intents`(FK 链完整)，`foreign_keys=ON`，
`PRAGMA foreign_key_check` 干净。用**当前**(含未修复 v207)的 `migrate.js` 对这个库跑迁移：

```
SqliteError: FOREIGN KEY constraint failed
    at Database.exec (...\better-sqlite3\lib\methods\wrappers.js:9:14)
    at runMigrations (...\migrate.js:6085:16)   ← sqlite.exec('DROP TABLE proto_markets')
  code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
```

真实崩溃，不是警告——生产库(`data/console.mainnet.db`)一旦有任何市场/下注数据，下次 console 重启
执行迁移会直接崩在这一步，console 起不来。

## 修法(同 v83 既有手法: `PRAGMA foreign_keys=OFF` 必须在事务外)

`PRAGMA foreign_keys` 在事务内修改是 no-op(SQLite 文档明文)——原代码用 `BEGIN TRANSACTION`
包住整个重建过程，若把 `PRAGMA foreign_keys=OFF` 塞进事务里不会生效。修法：

```
sqlite.exec('PRAGMA foreign_keys = OFF');   // 事务外
try {
  sqlite.exec('BEGIN TRANSACTION');
  try { ...重建... sqlite.exec('COMMIT'); }
  catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  const fkViolations = sqlite.pragma('foreign_key_check');
  if (fkViolations.length) throw new Error(...);
} finally {
  sqlite.exec('PRAGMA foreign_keys = ON');   // 事务外, 无论成功失败都恢复
}
```

新增 `foreign_key_check` 断言(重建完成后、重新打开 `foreign_keys` 之前跑)——不只是"不崩"，还要
确认 `proto_bets`/`proto_bet_intents` 对 `proto_markets(id)` 的引用全部仍然有效，没有留下悬空外键。

## 修复后实测(同一个真实数据库，四条断言全部核过)

| 断言 | 结果 |
|---|---|
| ① `PRAGMA foreign_key_check` 为空 | ✅ `[]` |
| ② `proto_bets`/`proto_bet_intents` 的 `CREATE TABLE` 原文仍引用 `proto_markets`/`proto_bets`(字面量表名，不是 `proto_markets_v207`) | ✅ 确认——`RENAME` 只改变被重命名表自身的名字，不会去改写其它表 DDL 文本里的字面引用 |
| ③ 行数迁移前后一致 | ✅ markets=1, bets=1, intents=1，且已有行的 `status='betting'` 未被新 DEFAULT 影响 |
| ④ 幂等：同一个已迁移过的库二次跑迁移 | ✅ `"already has genesis intent columns/CHECK states (idempotent skip)"`，`fk_check` 仍 `[]`，行数不变 |

另外重新确认了全新空库(无预存数据)路径修复后仍然正常应用(0 rows preserved，符合预期)。

## 处置

`kasia-console/src/db/migrate.js` 已修复并提交。文档 `docs/DATABASE.md` 同笔更新
`proto_markets` 表的新字段/状态值/DEFAULT 语义(CLAUDE.md"数据库修改规范"要求)。

## 文件清单

- `run.log`(完整修复前崩溃 + 修复后四条断言通过的真实输出)
- `README.md`(本文件)
