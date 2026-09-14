# 主网账号迁移 · 第 3 批（NWT，540.15 KAS）执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1294 派工 · Owner 常设批准·同批2 v0.2 结构）

> 权威链：`docs/2026-09-14-kanetui-mainnet-account-migration-runbook-v0.1.md`（v0.5）§5/§6 第三批。本页按第 2 批执行页 v0.2（`docs/2026-09-14-kanetui-mainnet-migration-batch2-small-exec-v0.1.md`，commit `9f025f00`）同一套方法产出，差异只在账号名单（本批 1 行：`NWT`）和 §5 观察项数字（15→16，批3只有1行不是6行）。**Owner 已就剩余批次常设批准**（Bettor 1294："不再逐批请示"），本页写完直接进入执行，证据事后交 Bettor 六项核 + NWT 事后核，不再走批2那种"NWT 先审执行页草稿"的前置关卡。

## 0. 范围

**1 个账号**：`NWT`，`540.15205663 KAS`（迁移 runbook §5 权威对账表，本人独立核实）。runbook §6 原话："第一次真正让 per-relay 上限（800）在有意义的量级附近生效的账号（540 离 800 还有余量，但是这批'会被拉起'的账号里最大的一个）"。

导入后驻留总额 = 批1（4.98498280）+ 批2（38.90726057）+ 本批（540.15205663）≈ **584.04 KAS**——仍远低于 `RELAY_HOTWALLET_TOTAL_MAX_KAS=1000`；本批单行 540.15 KAS 低于 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`，但离上限只剩约 260 KAS 余量——**这是本会话第一次让 per-relay 上限在有意义的量级附近真正接受考验，不是形式检查**。

## 1. 执行前检查清单（阻断条件，全部满足才能进 §2；同批1/批2 §1，逐项复用，执行当天重核）

1. **源库无持有进程**：`C:\KANet` 路径下无 node 进程，`:3100`/`:3200` 均未监听。
2. **本次迁移使用的 mainnet console 实例状态**：当前 PID 存活且监听 `127.0.0.1:3202`——执行当天重新核实（自偏移线重启起应为 `18320`，但不假设，重新查）。
3. **NWT 2-1 三条准入门 env 仍生效**：`grep RELAY_HOTWALLET kanet.mainnet.env` 三行值未变；当前进程 stdout 命中 `[relay-hotwallet-monitor] started`。
4. **批1+批2 累计 16 行仍健康**：目标库只读核得 16/16，`relayHealthMonitorTick` 最近几次 tick `eligible=16 deadCount=0`，`events.hotwallet_relay_killed` 仍为批2验收基线值（0）。
5. **源库只读核数**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name='NWT'` 应 `=1`。
6. **新库尚无同名行**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name='NWT'` 应 `=0`。

## 2. 拒绝场景验证（复用已验证过的冷地址，仅作同日回归确认，不需要验第三个新地址——冷清单只有两个地址，两个都已分别在批1/批2验过）

1. `POST http://127.0.0.1:3202/relays`，body：`name=zzz-admission-probe-<timestamp>&address=<Trader-B 冷清单地址>&network=mainnet`（无 `mnemonic`）。
2. **预期结果**：`302`，`Location: /relays?hotwallet_denied=cold_address_denied`。
3. **验证行未被创建**：`SELECT COUNT(*) FROM relay_nodes WHERE name LIKE 'zzz-admission-probe-%'` 探针前后应从 `0` 到 `0`。
4. **如果探针没有被拒绝**：立即停止，不得继续本页任何后续步骤——先清理探针行、复核查无，再回 §1 重新核实，顺序不能反。

## 3. 导入（1 行，方法同批1/批2）

1. 对源库该行 `mnemonic_encrypted`，用旧密钥（一次性环境变量注入，进程退出即丢弃）调 `decrypt()`，得到明文助记词，只存在这一次脚本调用的局部变量里。
2. 立即调 `addressFromMnemonic(phrase, 'mainnet')`，与源库该行 `address` 逐字比对：不一致 → 不导入，停下核查。
3. `POST http://127.0.0.1:3202/relays`，body：`name=NWT&mnemonic=<明文助记词>&network=mainnet`（不传 `address`，服务端独立再派生）。
4. 明文助记词在这次 `POST` 调用返回后立即丢弃。
5. 检查响应：`302` 且 `Location` 不含 `hotwallet_denied` → 通过；含 `hotwallet_denied=<reason>` → **不应该发生**（540.15 < 800），发生即停下核实该行真实链上余额是否与基线一致，不强行继续。
6. 导入后立即核对（新库侧）：`address` 与源库逐字一致、`network='mainnet'`、只读查得链上余额与迁移 runbook §5 基线一致。
7. `SELECT COUNT(*)` 应 `=1`。

## 4. 观察：这行会被启动，私钥会驻留内存

同批1/批2的确定后果：导入完成后，下一次 30 秒 health-monitor tick 会把它判定为 dead 并尝试 `startRelay()`；540.15 KAS 低于两个上限（per-relay 800、加上批1+2+本批总额 ≈584 仍低于 total 1000），准入检查会通过；私钥会实际进入这个独立子进程内存。

## 5. 监控 tick 日志与 events 计数观察

同批1/批2方法：
1. **健康监控**：`relayHealthMonitorTick` 系列行，`eligible` 应从 `16` 变为 `17`，`deadCount` 短暂出现 `1` 随后归零。
2. **驻留期监控**：`relayHotwalletMonitorTick` 系列行，`checked` 应从 `16` 变为 `17`，`killed` 全程应为 `0`。
3. **`events` 表**：`hotwallet_relay_killed` 计数，导入前后应保持与 §1 第 4 项记录的基线一致。
4. **子进程确认**：`Get-CimInstance Win32_Process -Filter "ParentProcessId=<console PID> AND Name='node.exe'"` 应比导入前多 1 个，`CreationDate` 与本批导入时刻一致。
5. **观察窗口 ≥90s**（覆盖至少 2-3 个 30 秒 tick 周期）。

## 6. 回滚（同批1/批2 §6，复用迁移 runbook §7 现成路由）

任何异常（地址派生比对失败却被误导入、`network` 字段错、或 §5 观察到异常）：
1. 确认该行子进程已停止（`stopRelay()` 或手动兜底）。
2. `SELECT id,name,address,network,created_at FROM relay_nodes WHERE id=?` 留证据（不选加密字段）。
3. `POST /relays/:id/delete`。
4. 再次 `SELECT` 复核应查无。
5. 源数据未受影响，可重新走 §2/§3 正确流程补导。

## 7. 证据清单（执行完成后落 `docs/provenance/<日期>-kanetui-migration-batch3-nwt/`，同批2格式）

- 执行窗口的 `stdout`/`stderr` 原始日志副本（`console-mainnet-stdout-PID<当次PID>.log`/`-stderr...log`）。
- §2 探针的完整 HTTP 响应（状态码 + `Location`，不含请求体明文）。
- §3 导入核对结果（`name`/`address` 一致性/链上余额比对，不含 `mnemonic`）。
- §5 观察到的两个监控 tick 日志片段、`events` 表查询结果（导入前后各一次）、子进程数量对照。
- 任何回滚：对应的 §6 四步操作记录。
