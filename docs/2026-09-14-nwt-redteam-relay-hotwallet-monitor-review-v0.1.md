# NWT 红队复核 · relay-hotwallet-monitor.js（`45594804`→`01a0f136`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`01a0f136`（含45594804的监控本体+第六笔Codex全局precheck修复）。以`01a0f136`为准，`45594804`不
> 单独复审（Bettor 1157指示）。
> 方法：独立worktree跑既有17条测试；**自己另写一份不复用测试文件的脚本**，直接import
> `relayHotwalletMonitorTick`带自己的依赖注入，独立复现Bettor点名的确切序列（rpcUrl每次成功、getRelayRows
> 每次失败，断言两个mock函数各自的真实调用次数，不只是读最终结果）；独立sha256核amendment#7 digest。

## 结论：**GREEN，监控本体对v0.2四点+Codex发现的全局precheck缺口全部落实到位，独立验证无误**

## 一、v0.2四点结构性核对

- **独立于健康监控，开关名不叫RH_OFF**：独立`setInterval`，开关`HOTWALLET_MONITOR_OFF`，设置时打印🔴🔴🔴级别
  `console.error`——读代码确认，不是`console.log`一行悄悄过去。
- **fail-closed，连续3次阈值**：per-relay余额查询失败、行/地址缺失(不变量违规)、全局precheck失败三类
  独立计数，全部用同一个`MAX_CONSECUTIVE_QUERY_FAILURES=3`常量，达阈值kill，不当没超限跳过。
- **kill不自动扫资金**：`_defaultKill`只调`stopRelay`+写`events`表告警，没有任何转账/资金移动代码路径。
- **聚合准入的互斥锁**：本文件明确不重复实现（"聚合上限的并发竞态由`relay-manager.js:startRelay()`内的
  `_withAdmissionLock`处理...本文件覆盖的是进来之后这一半"）——分工清楚，没有两处各写一半互相打架。

## 二、独立验证，不只是读report/跑既有测试

**既有17条测试**：独立worktree（`node_modules`软链接+`KASPA_RPC_URL`/`KASPA_NETWORK`/`DB_PATH`环境变量）
跑`node --test`——**17/17 PASS**，逐行核对了每条测试名跟断言内容一致。

**自己另写一份独立脚本，直接调用`relayHotwalletMonitorTick`（不是运行他们的test文件）**，针对Bettor点名的
确切序列——`resolveRpcUrl`每次都成功、`getRelayRows`每次都失败——**用调用计数器断言两个mock函数各自真的
被调用了3次**（不是只看最终结果"被杀了"就信，是确认"rpcUrl真的每次都成功了、getRelayRows真的每次都失败了"
这个前提条件本身成立）：
```
getRelayRows call count: 3 (expect 3)
resolveRpcUrl call count: 3 (expect 3, always succeeded)
killed: [{"relayNodeId":"nwt1","reason":"global_precheck_persistently_failed_fail_closed_relay_rows_query_threw"}]
globalPrecheckFailureCount at end: 0 (expect 0, reset after kill)
```
**确认：即使rpcUrl那一步每次都成功，只要getRelayRows持续失败，全局失败计数真的会累积到3并触发kill——
不会被rpcUrl的"成功"步骤错误清零**（这正是KANet-UI自己撞出的那个bug、也是Codex抓到的真缺口，这次改成
"两步都成功才清零"后独立验证确实修对了）。

**归因逻辑复核**：读了delta排序kill逻辑（按涨幅从大到小kill直到回线下）+"无正向delta则保守全杀"分支——
既有测试已覆盖这两条，逐行核对断言内容与实现逻辑一致，没有找到误杀/漏杀的边界。"第一次被监控看到的relay
不会因为没有历史记录被当成偷偷进账全部余额背锅"这条负责任的处理也独立确认存在且有对应测试。

**per-relay失败计数独立性**：`failureCounts`（per-relay）跟`globalPrecheckFailureCount`（全局）是两个独立
的状态容器，读代码确认互不稀释，既有测试"两个都活着的relay在全局precheck fail-closed时应该一起被杀"间接
印证了这条分离在全局失败场景下的行为正确。

**kill→30s重拉→被admission挡住**：这条我不需要另起一次真实进程/RPC的端到端测试——它是两个已经分别独立
验证过的机制的组合（monitor的kill只是调既有`stopRelay`；任何后续拉起尝试，无论来自`relay-health-monitor`
30s cron还是`system-repair.js`的`restart_relay_`，都会走到`relay-manager.js:startRelay()`同一个
`checkHotwalletAdmission`准入门——这条准入门本身我在`a65c28dc`/`39ae30b1`两轮已经独立验证过），组合的正确性
由两段各自独立验证过的正确性给出，不需要重新搭一套真实kaspad+console环境去跑一遍。

## 三、amendment #7——独立核对

manifest恰好新增一条`M0C3-relay-hotwallet-monitor`条目，白名单指向`relay-hotwallet-monitor.js`唯一一个
文件。**自己独立算了这个文件(01a0f136最终版)的sha256**（`80d1f45d...`），跟manifest里的`content_digest`
逐字节匹配——不是读manifest自称的值。

## 四、给Bettor的处置建议

- **`01a0f136` GREEN**，Codex抓到的全局precheck缺口修复正确，独立验证不是走过场。
- amendment #7的review_ref可以从占位符回填为本verdict。
- 无新发现的问题。
