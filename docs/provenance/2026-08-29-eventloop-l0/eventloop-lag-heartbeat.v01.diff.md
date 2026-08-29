# L0 仪器 · 接线 diff 草案（不 apply · 报备）

## 1. `kasia-console/src/lib/eventloop-lag-heartbeat.mjs`（+3 行 import/+2 行 lag 行扩展）
```diff
@@ -22,1 +22,2 @@
 import { wasmBufferBytesMB, utxoFetchCallCount } from './utxo-fetch-allocation-probe.mjs';
+import { culpritsBetween, formatCulprits } from './tick-registry.mjs';   // L0 归因 (2026-08-29): lag 时回捞窗口内的同步段
@@ -42,3 +43,6 @@
     if (lagMs > LAG_ALERT_MS) {
       const mem = process.memoryUsage();
-      console.warn(`[diag:eventloop-lag] gap=${actualGapMs}ms expected=${EXPECTED_MS}ms lag=${lagMs}ms at=${new Date(now).toISOString()} heapUsed=… utxoFetchCalls=${utxoFetchCallCount()}`);
+      // 阻塞是同步的 ⇒ 本回调只能在阻塞结束后跑; 肇事者 = 窗口 [now−gap, now] 内开始过的同步段 (tick 同步前缀 / 慢 SQL), 由 tick-registry 环形缓冲回捞.
+      const culprits = formatCulprits(culpritsBetween(now - actualGapMs, now, 5));
+      let handles = -1; try { handles = process._getActiveHandles().length; } catch { /* internal API, best-effort */ }
+      console.warn(`[diag:eventloop-lag] gap=${actualGapMs}ms expected=${EXPECTED_MS}ms lag=${lagMs}ms at=${new Date(now).toISOString()} heapUsed=… utxoFetchCalls=${utxoFetchCallCount()} culprits=${culprits} activeHandles=${handles}`);
```
（`heapUsed=…` 处省略的字段原样不动。）

## 2. `kasia-console/src/index.js`（+2 行，须在**所有 service import 之前**——ESM 静态 import 提升 ⇒ 放到文件最顶部的第一个 import 之前，用动态 `await import` 保证顺序）
```diff
@@ -1,1 +1,4 @@
+// L0 归因仪器 (2026-08-29, observe-only): 必须先于任何 setInterval 注册 ⇒ 顶层 await import 在其它 import 之前执行.
+const { installTickRegistry: __installTickRegistry } = await import('./lib/tick-registry.mjs');
+__installTickRegistry();
 <原第 1 行>
```
⚠ 与 boot-marker（supervisor v0.1.4 `index.v01.diff`）同样落在文件顶部；两者都是 `await import` 形，顺序无关，可叠加。**须 NWT 核**：`await import` 在模块顶层早于静态 import 求值的前提是 index.js 的静态 import 都在它之后被 hoist——ESM 里静态 import **总是**先于模块体求值，所以严格说 `import './services/x.js'` 这种副作用 import 若在模块加载期就 `setInterval`，不会被包住；本仓 service 的 `setInterval` 都在 `start*()` 里、由 index.js 模块体显式调用（§3 盘点的 15 处均如此），因此包得住。**验收 5** 会用真日志核"15 个名字都出现过"。

## 3. `kasia-console/src/db/client.js`（+2 行）
```diff
@@ -44,2 +44,4 @@
 const sqlite = new Database(dbPath);
 sqlite.pragma('journal_mode = WAL');
+import { installSqliteTiming } from '../lib/sqlite-timing.mjs';   // ← 放文件顶部 import 区; 此处示意
+installSqliteTiming(sqlite);   // L0: 慢语句 (>=200ms) 记 [diag:sql-sync] + 进 tick-registry 环
```
⚠ `client.js` 被 15 个历史写脚本 import（memory `reference-console-db-client-default-path…`）；它们也会装计时——只多打日志，无害；`SQLITE_TIMING_OFF=1` 可关。

## 4. 新文件（候选全文在本目录）：`lib/tick-registry.mjs`、`lib/sqlite-timing.mjs`

## 5. 验收（落地前 offline + 落地后 1 h）
- offline：`node scratch/_j2_eventloop_l0/selftest.mjs`（in-memory sqlite）= T1–T16（自动包装/具名/async 只量同步前缀/慢 SQL 记录/快 SQL 不记/幂等/回捞/窗外不捞/kind 前缀/异常透传/this 与参数/返回值同一 promise/非函数透传/clearInterval 有效）。
- 落地后 1 h（只读日志）：① `[tick-registry] installed` 与 `[sqlite-timing] installed` 各一行；② `[diag:tick-sync] name=…` 里出现 §3 表 15 个 tick 的名字（匿名的按 `interval@file:line`）；③ 每条 `gap≥3000` 的 lag 行带非空 `culprits=[…]`；④ 若 `culprits` 里出现 `sql:run:INSERT OR IGNORE INTO kaspa_tx_log:NNNN`（NNNN ≥ 3000）⇒ (W) 坐实；若最大项是某 tick 名 ⇒ 转 §5 的 cpu-prof 决策。
- 关闭开关：`TICK_REGISTRY_OFF=1` / `SQLITE_TIMING_OFF=1`（重启生效）。
- 开销：每次 interval 回调 +2 次 `performance.now()`；每条 SQL +2 次 `performance.now()` + 一次字符串截取（仅超阈时）——在 60 POST/s 的 ingest 上 ≈ 每秒 ~200 次 µs 级调用，可忽略。
