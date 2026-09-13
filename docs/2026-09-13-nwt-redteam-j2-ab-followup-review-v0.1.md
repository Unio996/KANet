# NWT 红队复核 · ab-followup（5 处硬编码回退 + 3 处 lint-allow + R-NET-PORT-LITERAL）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-ab-followup` `7122c785`（基线 `b8d035ba`）。
> 你点名两题：throw 位置是否在启动早退而非请求中途、3 处 lint-allow 理由是否站得住。

## 结论：**GREEN，可以合入**——一处 throw 位置不一致(功能上安全，风格上该改)，一处 lint-allow 理由写得不够准(结论对，理由不对)，两条都不阻塞，建议下次顺手改

## 一、throw 位置——五处里三种形态，逐个查了真实执行时机，不是读注释信

| 文件 | throw 位置 | 触发时机 | 是否安全 |
|---|---|---|---|
| `bshard-settle-daemon.mjs` | 模块顶层 | **启动早退**(ESM import 阶段) | **安全**——`KASPA_RPC_URL`/`KASPA_NETWORK` 是 GO-B 审计表"核心四项"，主网部署下永远有值，这条只在真配置错时才会响，且响的时机是"进程还没起来"，干净 |
| `faucet-utxo-health.mjs` | 模块顶层 | **启动早退** | 同上，**安全** |
| `oracle-pool-chain-scanner-cron.mjs`/`renewal-cron.mjs` | **函数体内**（`oraclePoolScannerTick()`/`oraclePoolRenewalTick()` 异步函数里，跟旁边 `requireRpcUrl` 检查同一层） | **每次 tick 触发时**，不是启动那一刻 | **功能上安全，风格上不一致**（见下） |
| `transaction.mjs` | 函数体内(`custodialSendKaspa` 参数默认值) | 每次调用时 | 同上，调用方按需触发，不是常驻daemon |
| `system-repair.js`(未改，只加了 lint-allow 注释) | 函数体内，无 throw | — | 不适用 |

**核心发现**：`oracle-pool-chain-scanner-cron.mjs`/`oracle-pool-renewal-cron.mjs` 这两处的 `configuredNetwork()` 调用**不在启动早退**——它们在每 5 分钟/1 小时触发一次的 cron tick 函数体内，跟同一个函数里紧挨着的 `requireRpcUrl` 检查用的是**两种不同的失败哲学**：`requireRpcUrl` 失败时是**优雅跳过**(`return { skipped: true, reason: 'no-rpc' }`，不抛)，而新加的 `configuredNetwork()` 一旦触发就是**硬抛**——同一个函数里两行相邻代码，一行"缺了就跳过这次"，一行"缺了就抛"，风格不统一。

**为什么现在不会真的出问题**：读了 `index.js:20-35` 的顶层 `uncaughtException`/`unhandledRejection` 处理器——**这两个处理器自己有个 `__booted` 门**：`__booted` 变 `true` 之前的任何异常是致命的(`process.exit(1)`)，**之后**才是"记录不退出"。这两个 cron 的 tick 函数只会在**完整启动流程跑完之后**才第一次被调用(daemon 启动本身在 `__booted` 置位之后)，所以就算 `configuredNetwork()` 真的抛了(只有 `KASPA_NETWORK` 真配置错才会)，也会被这套已经过了 `__booted` 门的处理器接住,**只是每次 tick 都记一条错误日志,不会真的把整个 console 进程拖垃**——这跟"启动早退"要防的那类致命崩溃(引用的是这次 GO-C 已经撞过两次的教训：context.js 的表不存在崩溃、broker 的 relay id 空崩溃,两者都发生在**顶层 import 阶段**,那时候 `index.js` 自己第 23/30 行的处理器**还没被注册**,因为 ESM 静态 import 全部解析完才轮到 `index.js` 自己的代码跑——这跟这里 cron tick 触发的时间点(远在那之后)完全是两个阶段)是两个不同性质的风险,这两处不会重演那两次崩溃。

**裁决**：**不阻塞**——`KASPA_NETWORK` 在 GO-B 计划下永远有值，这两处实际上永远不会真的抛；即使抛了，也是"每次 tick 记一条错误日志"而不是"进程崩溃"。但**建议下次顺手统一风格**：这两处要么改成跟旁边 `requireRpcUrl` 一样的"优雅跳过"（`if (!process.env.KASPA_NETWORK) return { skipped: true, reason: 'no-network' }`），要么把 `configuredNetwork()` 挪到函数外层跟另外两个 daemon 一样在模块顶层就检查——两种做法都行，只是不该在同一个函数里两种哲学混着用。**记档，不挡这次合入**。

## 二、3 处 `lint-allow-net-port-literal` 理由核实——2 处站得住、1 处结论对但理由不够准

**`settings.js:103`（"只读状态比对用的展示值"）——核实为真**：读了这段代码，`localUrl` 只用来跟 `getWorkingRpc()` 返回的**真实连接结果**做等值比较，算出一个 `source` 标签给状态展示 API 用，从未被传给任何实际发起连接的代码路径。**PASS，理由准确**。

**`system-repair.js`（"rpc-health.js 已 fail-fast，这里只防孤立 import"）——核实为真**：`rpc-health.js:19-23` 确实在自己模块顶层对 `KASPA_RPC_URL`/`KASPA_NETWORK` 两者都做了 `throw`；`system-repair.js` 自己在顶部就 `import ... from './rpc-health.js'`——意味着任何正常路径下 import `system-repair.js`，`rpc-health.js` 的顶层检查会先跑，配置错早就在那边炸了，根本轮不到 `_localUrl()` 这个兜底值生效。**PASS，理由准确，这行注释描述的场景在现实中几乎不可达，是防御性的belt-and-suspenders，不是漏洞**。

**`settings.js:28`（"表单'local模式'缺省建议值，非活连接默认"）——结论对，但陈述的理由不是真正站得住的那个理由**：读了完整上下文——这一行的 `url` 值**会被 `setConfig('rpc_url', url, ...)` 真正写进配置存储**，不是单纯的表单占位/展示——"非活连接默认"这句话字面上不准确。**真正让这里安全的理由是另一件事**：这段代码上方有一道闸——`if (isStrictLocalOnly() && mode !== 'local') { return 409 ... }`——而 GO-B 的部署计划里 `KASPA_RPC_LOCAL_ONLY=1` 恒为真，在 strict 模式下，`rpc-health.js` 的实际连接逻辑**从不读 DB 里的 `rpc_url` 配置**(这是我在更早一轮复核里已经确认过的 strict-local-only 设计本身的性质)，所以这里写进 DB 的值即使是错的硬编码回退，也不会被下游拿去真正连接——**安全,但因为"strict 模式下这个 DB 字段本来就是死数据",不是因为"这只是个展示占位"**。

**裁决**：**不阻塞**——三处的最终结论(可以放行)都对,只是 `settings.js:28` 这行注释的措辞建议下次改成"strict-local-only 模式下 DB 里的 `rpc_url` 从不被读来建立真实连接,这个回退值只影响 DB 里存的展示字段"，把真正的安全依据写清楚，而不是"非活连接默认"这种容易让下一个读者误解成"这个值反正没人用"的模糊说法（它明明被 `setConfig` 真的写进去了）。

## 三、其余核实

- `configuredNetwork()`(`shared/lib/kaspa-network.mjs:37-43`)自身实现核对：未设或非法值直接 `throw`，逐字确认与四处调用点的期望行为一致。
- `R-NET-PORT-LITERAL` 新 lint 规则的正则本身核对：匹配 `|| 'ws://...:1[678]xxx'` 这个模式,对着五处修复前的原始代码手工过了一遍,确认规则能命中这五处(修复后不再命中,因为已经换成 `process.env.X` 单一源)。

## 四、给 Bettor 的处置建议

- **GREEN，可以合入**，不阻塞 GO-C（涉及的 `KASPA_NETWORK`/`KASPA_RPC_URL` 在部署计划下恒有值）。
- 两条非阻塞记档：①两个 oracle-pool cron 文件的 `configuredNetwork()` 建议下次统一成跟同函数内 `requireRpcUrl` 一样的优雅跳过风格，或挪到模块顶层；②`settings.js:28` 的 lint-allow 注释建议改成准确的理由(strict 模式下 DB 字段是死数据，不是"非活连接默认")。
- 两处都不影响这次合入判断，供 J2 下次碰这几个文件时顺手带一句。
