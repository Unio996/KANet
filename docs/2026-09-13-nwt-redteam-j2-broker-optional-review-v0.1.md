# NWT 红队复核 · broker-optional 修复（GO-C 第二崩）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-broker-optional` `fefa4be6`（基线 `c880db63`）。
> 方法：自己写了一个 BFS 脚本独立扫全仓静态 import 图（不信"11个里3个被无条件静态拉入"这句自报）；独立 worktree + 独立 `npm install`；**亲自跑**了修复后的 `fresh-db-boot.test.mjs`（含新增 arm B）。

## 结论：**GREEN，可以合入 → GO-C 第三次**

## 一、①隐藏静态边是否扫全——自己 BFS 一遍，结论一致

写了一个真正做静态 import 图 BFS（不是 grep 猜）的脚本，对修复前的树（`c880db63`）跑了一遍：先找到全部 11 个顶层 fail-loud 的 broker 文件（`broker-action-queue.js`/`broker-bsc-intake-watcher.js`/`broker-buy-completion-watcher.js`/`broker-buy-handler.js`/`broker-cancel-refund.js`/`broker-intake-watcher.js`/`broker-inventory-watcher.js`/`broker-llm-agent.js`/`broker-sell-handler.js`/`broker-state-authority.js`/`broker-v2/router.js`，恰好 11 个，跟派工描述的数字一致），再反向 BFS 找"谁在静态 import 它、谁又在静态 import 那个 importer……一路查到 `index.js` 自己的静态 import 集合"。

**结果**：只有 `broker-intake-watcher.js`、`broker-state-authority.js`、`broker-buy-completion-watcher.js` 三个直接在 `index.js` 自己的静态 import 里，其余 8 个查不到任何静态路径——**跟 J2 的"3 个被无条件静态拉入"结论完全一致**。

**隐藏二级边我也单独核实了**：`grep` 确认 `index.js` 自己**无条件**静态 import 了 `api/admin-dedup.js`（第 81 行）与 `services/broker-state-reconciler.js`（第 841 行）——这两个文件本身不在 11 个 fail-loud 名单里,但**它们各自静态 import 了名单里的两个文件**（`admin-dedup.js` → `broker-intake-watcher.js`；`broker-state-reconciler.js` → `broker-state-authority.js` ×3 处）。读了修复后的 diff——两处都改成了各自调用点内的 `await import(...)`（`admin-dedup.js` 两个 route handler 各自动态 import；`broker-state-reconciler.js` 三处 `advanceToRefunded` 调用点各自动态 import，且**三处都已经在既有 try/catch 里**，动态 import 失败会被现有 catch 逻辑接住不传播）。**扫全了，两处隐藏边都堵了，跟我独立 BFS 的结论一致**。

## 二、②未启用态下无 ReferenceError 路径——核实为真

`grep -rn` 了修复后整个 `kasia-console/src`，`startIntakeWatcher`/`startStaleAligningSweep`/`startCompletionWatcher` 这三个符号**只出现在它们自己各自的 `if (BROKER_ENABLED==='1')` 块内**（`await import` + 调用两行），没有第四个文件在别处引用这三个名字期望它们在外层可见。**PASS，不存在"未启用时某处代码摸到一个不存在的符号"这种崩溃路径**。

## 三、③arm B 真起主进程——亲自跑了，不是读测试代码信

独立 worktree（`fefa4be6` 检出）+ 独立 `npm install` 后跑了完整的 `fresh-db-boot.test.mjs`：

```
✅ H1-H4（arm A，同前一轮，原样验证过一次不重复贴）
✅ arm B H1: 进程存活 ≥30s(被 harness timeout 打断, 非自己提前退出; 实际 signal=SIGKILL status=null)
✅ arm B H2: 看到 broker 门禁 disabled 日志(BROKER_ENABLED 门真的生效, 不是没跑到这行)
✅ arm B H3: 零 FATAL(11 个 broker-*.js 顶层 throw 都没被触发)
✅ arm B H4: 无未捕获异常/未处理拒绝
✅ arm B harness flip arm went red as required
```

**这个新测试本身有一处值得称赞的自我修正**：它的注释坦白承认上一版 arm A 给 `BROKER_RELAY_ID` 塞了个 stub 值（掩盖了真实崩溃现场），这次特意用 `delete envB[k]`（不是设成空字符串）来精确复现"真的没配置"（跟"配置成空字符串"是两种不同的代码分支，这个区分是对的）。`FATAL_MARKER` 正则还带一条踩过的假阳性教训（旧 `migrate.js` 注释里的小写 "fatal bug" 曾撞过裸 `/FATAL/i`）——这是真的调过、不是凑出来的测试。**PASS，亲手验证 ≥30s 存活、零 FATAL 均为真**。

## 四、④`broker-llm-agent.js` 硬编码默认 id——同族问题，确认存在，但不阻塞

`services/broker-llm-agent.js:31`：
```js
const BROKER_RELAY_ID = process.env.BROKER_RELAY_ID || '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
```
**这确实是同一族问题**——跟 ab-followup 那轮我已经点名、这次 `bshard-settle-daemon.mjs` 已经修掉的 `SETTLE_DAEMON_FEE_RELAY_ID` 硬编码旧网默认值是同一个模式：不 throw，而是**静默**回退到一个 TN12 relay id，在主网新库里查这个 id(`:315`/`:654` 两处 `sqlite.prepare(...).get(BROKER_RELAY_ID)`)会查到**空**（新库没有这行），不会崩，但会悄悄地"什么都不做/查不到"而不是"明确告诉操作者没配"。

**裁决：记档，不阻塞本次合入**——理由：①这个文件不在这次 fresh-DB 首启的可达路径上(我的独立 BFS 与亲跑的 arm B 都确认了,`BROKER_ENABLED` 关闭时它根本不会被加载,零 FATAL 已经证明);②它只有在 broker 子系统被**明确打开**(`BROKER_ENABLED=1`,需要操作者主动配置好一整套 relay 身份)之后才可能被真正调用到,那时机已经超出这次"能不能干净起服务"的范围。**建议**：等 GO-E 阶段真的要打开 broker 子系统时，照 `bshard-settle-daemon.mjs` 这次的修法（默认 `null` + 用到前显式判空返回，不静默回退旧网 id）一并处理，不需要现在为了这一处单独开一轮。

## 五、给 Bettor 的处置建议

- **GREEN，可以合入，重试 GO-C 第三次**。
- 四点全部核实：隐藏静态边扫全(自己独立 BFS 复核)、无 ReferenceError 路径、arm B 亲自跑通、`broker-llm-agent.js` 同族问题记档不阻塞。
- 这笔修复本身质量很好——两处隐藏边找得准，新测试还主动修正了上一版测试的一个真实方法论缺口(stub 值掩盖真实崩溃现场)，这个自我修正比很多"直接补丁"式的修法更让人放心。
