# 主网账号迁移 · 第 4 批（Trader-B + MarketMaker-A，导入不起 relay）执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1294/1299/1309 派工）

> 权威：Bettor 1309 裁定——"会尝试但解密前被挡"是本批的合规形态（安全性质成立：密钥不进内存、无子进程；冷名单+per-relay上限是两道独立门），字面要求改为"不会被成功拉起且不解密"。三点源码前置核实见 §0，本页只写不执行，**执行门 = 本页 → NWT 审 → 执行**。

## 0. 前置源码核实（Bettor 1294 要求，带行号，本人独立读代码核实）

1. **导入是否必然 startRelay？—— 不会**。`kasia-console/src/api/relay.js:90-141` `POST /relays` 处理函数只调 `createRelayNode()`(建行) + mind skills/config 自动配置，全程不调 `startRelay()`。
2. **health-monitor/system-repair 会不会把"已导入未启动"行自动拉起？—— 会尝试**（无余额过滤）：三条路径共用同一个候选查询 `WHERE r.address IS NOT NULL AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)`——`kasia-console/src/services/relay-health-monitor.js:76-80`（30s cron）、`kasia-console/src/services/relay-manager.js:337-340`（`startAll()`，console 重启路径）、`kasia-console/src/services/system-repair.js:227-230`（`restart_relay_` 人工触发）。三者都收敛到同一个 `startRelay()`。
3. **准入门对超 800 的行——解密前拒绝**（既有代码注释，NWT 1147 已核）：`kasia-console/src/services/relay-manager.js:196-198` 原话"准入检查挪到解密之前——只用 account.address+net+rpcUrl（三者都是公开信息，不接触密钥材料）；被拒的候选在这里就 return，`getRelayPrivkey`/`getRelayMnemonic` 根本不会被调用，连解密动作本身都不发生"。`relay-manager.js:207-210` 是实际的 `if (!admission.ok) { ...; return admission; }` 短路点。

**结论（Bettor 1309 采纳）**：Trader-B（20,301.72 KAS）与 MarketMaker-A（1,004.996 KAS）均远超 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`，三条自动拉起路径都会周期性/事件性地尝试 `startRelay()`，但 `checkHotwalletAdmission()` 会在触碰任何密钥材料之前就返回拒绝——安全性质是"不会被成功拉起、不会被解密"，不是"从不被尝试"。

## 1. 范围

**2 个账号**（迁移 runbook §5/§6 权威对账表）：

| name | 链上余额（权威基线） |
|---|---|
| Trader-B | 20,301.72（精确值见迁移 runbook §5，本页执行时重新只读核实） |
| MarketMaker-A | 1,004.996 |

**本批不做**：不调 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS`/`RELAY_HOTWALLET_TOTAL_MAX_KAS`（上限保持 800/1000 不变）、不起 relay（不是目标，是被两层机制天然挡住的结果）、不做任何广播。

## 2. 执行前检查清单（阻断条件，全部满足才能进 §3）

1. **源库无持有进程**：`C:\KANet` 路径下无 node 进程，`:3100`/`:3200` 均未监听。
2. **本次迁移使用的 mainnet console 实例状态**：当前 PID 存活且监听 `127.0.0.1:3202`，执行当天重新核实。
3. 🔴 **冷清单 env 含这两个地址 + 两个上限未变**（本批新增的关键前置，不是套用批1-3模板）：`grep RELAY_HOTWALLET_COLD_ADDRESSES kanet.mainnet.env` 必须同时含 Trader-B 与 MarketMaker-A 两个地址（这是本批"第二道独立门"——不只靠 per-relay 800 上限单独挡，冷清单本身也会直接拒绝，两道门都要在场）；`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`、`RELAY_HOTWALLET_TOTAL_MAX_KAS=1000` 核实未变（不能是本批之前被谁调高过的状态）。
4. **批1+2+3 累计 17 行仍健康**：目标库只读核得 17/17，`relayHealthMonitorTick` 最近几次 tick `eligible=17 deadCount=0`。
5. **源库只读核数**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name IN ('Trader-B','MarketMaker-A')` 应 `=2`。
6. **新库尚无同名行**：同上查询在目标库应 `=0`。

## 3. 导入（2 行，方法同批1/2/3，**导入后不做§2那种拒绝场景探针**——本批的"拒绝"验证方式是观察自动拉起尝试被挡，见§5，不是主动探针）

1. 对源库两行 `mnemonic_encrypted`，用旧密钥解密，得到明文助记词。
2. 立即 `addressFromMnemonic(phrase, 'mainnet')` 与源库地址逐字比对：不一致 → 不导入，停下核查。
3. `POST http://127.0.0.1:3202/relays`，body：`name=<name>&mnemonic=<明文助记词>&network=mainnet`。
4. 明文助记词在 `POST` 调用返回后立即丢弃。
5. **检查响应**：这次预期跟批1-3相反——**含 `hotwallet_denied=cold_address_denied`才是正确结果**（因为§0.1已确认这是纯建行动作，不经过冷清单检查；而 relay.js:102-107 的"早失败层"只在 `resolvedAddress` 有值时才跑——本批两行都会传 `mnemonic`，服务端会自动派生地址，一旦派生出地址，这层早失败检查同样会跑，届时应该直接在导入这一步就被冷清单拒绝，行都不会被创建）。**若两行都拿到了 `302` 且 `Location` 不含 `hotwallet_denied`（即被当场创建成功）**，停下核查——这意味着冷清单在这个时点没有覆盖这两个地址，跟 §2 第3项的前置核实矛盾，需要先查清楚为什么冲突，不能因为"反正 per-relay 上限会挡住 startRelay"就继续。
6. **若确实在导入这步就被拒绝**（预期路径）：则本批不会真的产生新行，§4/§5"观察拉起尝试"这部分其实无法进行（没有行可以被 health-monitor 拾取）——这种情况下 Bettor 1309 裁定的"会尝试但解密前被挡"这条防线根本没被触发到，因为行连创建都没发生。**这种情况下如实记录"冷清单在导入层就已完全拦截，未能进入 startRelay 层观察"，不算异常，是比预期更早的一层防御生效**，本页结论仍然成立（更强，不是更弱）。

## 4. 若步骤③意外允许创建（不预期，需要先停下核查，见§3第5点）

不展开——按§3第5点处理，不在本页假设这个分支会走到底。

## 5. 观察窗口（≥3 个 health-monitor tick，覆盖 §3 无论走到哪个分支）

1. **健康监控 tick**：连续 ≥3 次 `relayHealthMonitorTick` 日志，若两行确实被创建（§3步骤⑥的"不预期"分支），应能看到 `[relay-health] <name> dead (...) — auto-restart attempt #N` 与紧随的 `[relay-health] <name> startRelay fail: cold_address_denied`（或 `per_relay_cap_exceeded`，取决于两道门哪个先短路）——**两行各自的拒绝日志/原因都要留证据**，不能只留一行。
2. **relay 子进程数全程保持 17**（`Get-CimInstance Win32_Process -Filter "ParentProcessId=<console PID> AND Name='node.exe'"`）——本批任何时刻都不应该比批1+2+3的基线多，Trader-B/MarketMaker-A 不应该对应任何新的 `node.exe` 子进程。
3. **零解密日志**：全量 stdout+stderr 里不应出现任何与这两行相关的、暗示解密发生过的行（`getRelayPrivkey`/`getRelayMnemonic` 内部若有日志需确认零命中；若这两个函数本身不打日志，则以"没有子进程创建"作为解密未发生的间接但充分证据——见§0第3点，被拒的候选在解密函数被调用之前就 return，逻辑上不可能解密）。
4. **链上余额前后一致（只读）**：导入前后各查一次这两个地址的链上余额，应完全相同（本批不涉及任何转账，余额变化会是异常信号）。

## 6. 回滚

若§3步骤⑤发现两行被意外创建且未被后续 health-monitor 拒绝（即真的启动了 relay，子进程数变化）：立即 `stopRelay()` + `POST /relays/:id/delete`（同批1-3 §6 四步流程），并把这次事故如实记录——这是本页最严重的失败模式，出现即视为§0前置核实的结论不成立，需要重新核代码而不是简单回滚了事。

## 7. 证据清单（执行完成后落 `docs/provenance/<日期>-kanetui-migration-batch4-large-import-only/`）

- 执行窗口 `stdout`/`stderr` 原始日志副本。
- §2 前置六项核实结果（含冷清单 env 的两个地址逐字核对）。
- §3 导入响应（两行各自的状态码+`Location`，不含密文/明文）。
- §5 观察结果：≥3 个 tick 的日志片段（含两行各自的拒绝原因，若走到该分支）、relay 子进程数逐次核对（应恒 17）、导入前后链上余额对照表。
- 三处源码行号引用（同§0，供 NWT 复核直接跳转）。
