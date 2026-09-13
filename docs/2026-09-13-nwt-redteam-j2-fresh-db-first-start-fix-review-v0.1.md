# NWT 红队复核 · fresh-db-first-start 修复（挡 GO-C）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-fresh-db-first-start` `ee24f62e`（基线 `b8d035ba`）。
> 方法：独立 worktree(`D:/kanet-freshdb-wt`,用后已清理) + 独立 `npm install`；不信"31 候选全人工核过"这句自报，自己用另一套独立正则扫了一遍全仓；**亲自跑**两个新测试文件（不是读测试代码信，是真执行）。

## 结论：**GREEN，可以合入 → 重试 GO-C**

## 一、①顶层站点是不是扫全了——**独立复核，结论一致**

自己在 `kasia-console/src` 下用零缩进锚点(`^const .*= sqlite\.(prepare|pragma)\(` / `^export const ...`)扫了一遍全部非测试源文件——**只命中 `context.js` 三行(修复前的版本)，没有第二个**。另外单独确认了 `index.js` 自己：`runMigrations()` 在第 121 行，往前的 import 与顶层代码没有碰 `_sqlite`(它自己后面用的 `_sqlite.prepare` 全部在 328 行以后，且都在函数体内、缩进过的)——**index.js 自身不构成同类风险**。

**两条独立方法(J2 的启发式扫描人工核 31 候选、我的正则锚点扫全仓)得到同一个结论**：`context.js` 是启动路径上唯一的顶层 DB 站点。这比只信一份自报的清单更可信。

## 二、②惰性化是否改了语义——**读了完整 diff，没有**

`context.js` 的改法是把三个 `sqlite.prepare(...)` 从模块顶层挪进一个 `stmts()` 惰性构建函数(带缓存)，**SQL 查询文本本身逐字未动**(只是因为放进对象字面量多缩进了一层)，调用点从 `stmtLookup.get(...)` 换成 `stmts().lookup.get(...)`，纯粹的"什么时候 prepare"时机改变，不是"prepare 什么"的改变。

**这个模式不是新发明**——读了 `agent-health.js:48-58`，逐字比对，`context.js` 的 `stmts()` 写法是照抄这个已经在生产里跑的既有形，不是这次临时拍脑袋想出来的写法。JS 单线程 + 无 `await` 意味着 `_stmts` 这个模块级可变变量没有并发竞态窗口(第一次调用同步跑完整个构建才返回)。**PASS**。

**关键的反向验证做对了**：`context.test.mjs` 的 H3 翻转前置——故意在 `runMigrations()` 之前就调 `getContextByAddress()`，**断言这时必须抛**——这条恰好证明"lazy 化"没有把"表必须存在"这条真实约束也一起悄悄吞掉，只是挪了"什么时候会去 prepare/查表"这一件事的时机。**这是我最担心的一类"表面修复实际改语义"的坏味道，测试专门堵了它**。

## 三、③首启测试是不是真走"全新 DB_PATH + 完整 runMigrations"——**亲自跑了两遍，不是读代码信**

独立 worktree + 独立 `npm install` 后：

```
=== context.test.mjs ===
✅ H1: import(0 表 DB) 不抛
✅ H3: runMigrations() 之前真的调用 → 仍然抛(lazy 化只挪时机, 不吞掉表依赖)
✅ H2: 迁移后调用 → 不抛, 无匹配返回 null
✅ harness flip arm went red as required
✅ all fresh-db context.js vectors passed

=== fresh-db-boot.test.mjs ===
✅ H1: 启动路径全程零 SqliteError/no such table(同类坑没有藏在别处)
✅ H2: runMigrations() 真的跑完(不是提前崩溃侥幸没报 SqliteError)
✅ H3: migrate 完成后续代码真的继续执行(至少一个 cron/daemon started)
✅ H4: 无未捕获异常/未处理拒绝
✅ harness flip arm went red as required
✅ fresh-db full boot path: zero SqliteError, migrations completed, daemons started
```

**两个文件都用"不预先建库文件，让 `new Database(dbPath)` 自己在真不存在的路径上建一个 0 表全新文件"这个做法**——不是"复制一个已建好表的库改名当作新库"这种会漏检的假新库,`fresh-db-boot.test.mjs` 更进一步:**真的 spawn 了一次 `index.js` 主进程**(不是单元测试式的函数调用,是完整的子进程启动),对着这个真全新文件跑完整个启动序列,断言输出里全程没有 `SqliteError`/`no such table`、看到 `[migrate] DB migrations complete.` 那行、看到至少一个 daemon 的 `started` 字样、没有未捕获异常。**这四条我亲手看到全部为真,不是转述。** 两个文件都不裸 `import better-sqlite3`(只经 `db/client.js`,合 M0a)。

## 四、附带核实：lint

在 `context.js`/`context.test.mjs`/`fresh-db-boot.test.mjs` 三个改动文件上跑了 `node scripts/lint-kanet.mjs`——**0 errors**(其余是全仓存量 WARN,与本次改动无关)。

## 五、给 Bettor 的处置建议

- **GREEN，可以合入，然后重试 GO-C**。
- 三重点(顶层站点扫全/惰性化不改语义/首启测试真走全新库+完整迁移)全部独立复核通过，其中"首启测试"这条我是亲自跑的，不是信自报。
- 没有发现需要补的东西，这笔修复干净、针对性强，正好卡在问题本身，没有借机夹带别的改动。
