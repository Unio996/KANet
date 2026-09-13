# NWT 红队复核 · broker-optional-2（bsc-incoming-watcher tick 门 · GO-C 第三次现场）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-broker-optional-2` `9c2987bb`（实际基线 `903a5ea0`；对当前主线 `git merge-tree` 独立核实 0 冲突）。
> 方法：独立 worktree + 独立 `npm install`；**亲自跑**修复后的 `fresh-db-boot.test.mjs`（新 65s 窗口）；**另外自己写了一段脚本单独捕获原始 stderr**，不依赖测试自身的正则判断；自己扫了一遍全仓"tick 内动态 import broker-*"。

## 结论：**GREEN，可以合入 → GO-D 重启**

## 一、①扫描是否全——自己独立扫了一遍，结论一致，另发现一处同类但更低烈度的问题(记档不阻塞)

用 `grep` 独立扫了 `await import(...broker-*...)` 在全仓的每一处出现（不只是 J2 报的那一处），逐个查了调用点上下文：

- `broker-llm-agent.js`/`broker-buy-handler.js`/`broker-sell-handler.js`/`broker-state-authority.js`/`broker-intake-watcher.js`/`broker-cancel-refund.js` 等文件内部的动态 import——这些文件本身只在 `BROKER_ENABLED='1'` 门内才会被加载到(broker-optional 那轮已经核过),门没开就不会执行到里面任何一行，不构成新风险。
- `broker-state-reconciler.js` 三处——在 `for (const order of rows)` 循环体内，空库 `rows.length===0` 时循环体不执行(broker-optional 那轮已核，这轮重新确认一遍结论不变)。
- `bsc-incoming-watcher.js` 自己的两处(`tick()` 内)——**这就是本次要修的那处，唯一一处"常驻 30s tick、不看有没有待处理项就先 import"的形态**，跟 J2 的扫描结论一致。

**另外查了 `bsc-incoming-watcher`/`broker-action-queue` 是否还有别的调用方**：`grep` 出的其余几个文件(`broker-action-queue.js`/`broker-bsc-intake-watcher.js`/`cross-chain-verify.mjs` 等)提到"bsc-incoming-watcher"只是**代码注释里的文字描述**，没有一个真的 `import` 它的 `tick`/`start`——确认 `index.js` 是唯一真实调用方，门只加在这一处就够。

**顺手发现一处同类、但性质不同的问题(记档，不阻塞这次合入)**：`exchange-machine.js:1160` 与 `trade-protocol-filter.js:2467` 也有"动态 import `broker-action-queue.js`"，但这两处**不是常驻 tick，是数据驱动的事件分支**(一笔挂单真的走到 `delivering→completed`、一笔对冲单真的成交)——**在全新空库上不会触发**，这次修复要防的"启动即炸"这条不涉及。但这两处的 `enqueue()` 都包在**空 `catch {}`** 里——意味着如果 `BROKER_ENABLED=0` 时,一笔跟 broker 无关的普通 OTC 交易走到交割完成,这里会静默地(不打日志、不告警)漏发"KAS已发"这条 DM 通知,用户不会被这个错误告知，运维也看不到任何痕迹。**这不影响本次 GO-D 重启的判断(不会崩、不会双付、只是漏发一条通知)，但建议记进 broker-optional 系列的"待清理清单"**，跟 `broker-llm-agent.js` 那处硬编码默认 id 一样，等真正要打开 broker 子系统那一轮一起处理。

## 二、②65s 窗口下 stderr 真零 FATAL——亲自验证了两遍，不是只看进程存活

先跑了修复后的完整测试，`arm B` 四项全绿。**另外自己写了一段独立脚本**，不复用测试自己的判断逻辑，单独 `spawnSync` 一次、把 `stderr` 原样打印出来手工看：

```
=== signal/status === SIGKILL null
=== STDERR raw (full) ===
[migrate] v199: 🔴 idx_kaspa_tx_log_to_addr_observed 缺失 — 不在 boot 自建...
[zk-prove-server] ZK_PROVE_SERVER_TOKEN not set — server NOT started (fail-closed, not fail-open).
[pool-settler] WARN: ORACLE_SILENT_TIMEOUT_MIN=30 < 1440 (= mainnet 24h 钢线 per v0.5 spec section 4.3)...
[external-gateway] 未配置 KANET_EXTERNAL_GATEWAY_HOST / _PORT ⇒ 不启动(fail-closed)...
[oracle-pool-scanner-cron] tick fail: pool empty (≥1 required)
=== stderr line count === 6
=== grep FATAL in stderr === not found
```

**6 行,逐行看过,没有一行是 FATAL**。这份输出还顺带印证了 Bettor 从真实 GO-C 现场读到的那条 `ORACLE_SILENT_TIMEOUT_MIN=30 < 1440` WARN——我这边独立跑出来的日志跟真实主网现场看到的完全对得上,说明这个测试环境是真实反映生产行为的,不是一个跟真实场景脱节的沙盒。**PASS，65s 窗口内 stderr 真零 FATAL，不是只看进程活着就算数**。

## 三、③门只管 start、不改 import 是否留下别的可达路径——核实无遗留

`bsc-incoming-watcher.js` 自身没有 `BROKER_RELAY_ID` 依赖,它的 `import` 本身是安全的(这也是为什么门加在 `index.js` 调用 `start()` 那一行,不用去改这个文件本身)。真正的风险点只在 `tick()` 函数体内的动态 import——而 `tick()` 只有通过 `start()` 内的 `setInterval` 才会被排入执行,`start()` 现在整段被 `if (BROKER_ENABLED==='1')` 包住,不满足条件时**这一整段代码(包括 `setInterval` 注册)根本不会跑**，`tick()` 永远不会被调度执行第一次。**核实了没有第二个调用方**能绕开 `index.js` 直接触发 `tick()` 或 `start()`(见①的"谁真的 import 这个文件"检查)。**PASS，门加在这一处就够，不需要额外改 `bsc-incoming-watcher.js` 自身**。

## 四、给 Bettor 的处置建议

- **GREEN，可以合入，让 KANet-UI 重启进 GO-D**。
- 三点全部核实：扫描完整(自己独立复核一遍)、65s 窗口零 FATAL(亲自跑 + 独立捕获原始 stderr 双重确认)、门加对了位置(无遗留可达路径)。
- 一条非阻塞记档：`exchange-machine.js`/`trade-protocol-filter.js` 里两处普通(非 broker 专属)交易完成分支静默 `catch {}` 掉了 `broker-action-queue.js` 的 import 失败——不影响这次重启,但等真正打开 broker 子系统那一轮,建议跟 `broker-llm-agent.js` 硬编码默认 id 一起清一遍这类"catch 太宽、错误被吞掉看不见"的点。
