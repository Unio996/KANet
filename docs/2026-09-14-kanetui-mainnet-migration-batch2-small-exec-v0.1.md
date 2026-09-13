# 主网账号迁移 · 第 2 批（个位数-二十位数小额）执行页 v0.2（2026-09-14 · KANet-UI · Bettor 1182 派工 · 只写不执行）

> **Status: DRAFT**。权威链：`docs/2026-09-14-kanetui-mainnet-account-migration-runbook-v0.1.md`（v0.6，下称"迁移 runbook"）§6.2 第 2 批。**本页任何一步都不执行**——执行门 = 本页 → NWT 红队审 → Owner 批 → 执行，同第 1 批执行页（`docs/2026-09-14-kanetui-mainnet-migration-batch1-stress-exec-v0.1.md`，下称"第 1 批执行页"）的执行门。本页按第 1 批模板产出，第 1 批已实际执行验收通过（`docs/provenance/2026-09-14-kanetui-mainnet-migration-batch1-stress/`，10/10 一次通过），本页复用同一套方法，不重新设计机制，差异只在账号名单和 §2 探针改用的冷地址。
>
> **v0.2 变更（NWT 审第 1 批 `d4c9584d` GREEN 定案，同时提的一条建议，Bettor 1184 采纳为规矩）**：从第 2 批起，证据页除 README 外，必须附执行窗口的 `stdout`/`stderr` 原始日志副本（同 `docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/` 部署证据页的做法——那份留了 `console-mainnet-stdout-PID15396.log`/`-stderr...log` 两份独立副本，第 1 批证据页当时只写了摘录进 README，没留原始文件副本）。§7 证据清单补这一条，本批执行时落地。

## 0. 范围

**6 个账号**（迁移 runbook §1.3/§5 已查库+查链核实过的名单，余额取自该文档 §5 权威对账表）：

| name | 链上余额（迁移 runbook §5 权威基线） |
|---|---|
| J2 | 21.48052866 KAS |
| Trader-A | 7.45579730 KAS |
| KANet-UI | 4.32263407 KAS |
| Trader-M | 3.28361586 KAS |
| Bettor | 1.59303211 KAS |
| Qclaude | 0.77165257 KAS |
| **合计** | **38.90726057 KAS** |

导入后驻留总额 = 第 1 批已驻留的 4.98498280 KAS（`docs/provenance/2026-09-14-kanetui-mainnet-migration-batch1-stress/`）+ 本批 38.90726057 KAS ≈ **43.89224337 KAS**——仍远低于 `RELAY_HOTWALLET_TOTAL_MAX_KAS=1000`，单行也都远低于 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`（本批最大一行 J2 21.48 KAS，离 800 还有近 40 倍余量）。

## 1. 执行前检查清单（阻断条件，全部满足才能进 §2；同第 1 批执行页 §1，逐项复用）

1. **源库无持有进程**（执行当天重新核，不能用之前任何一次核实结论）：`C:\KANet` 路径下无 node 进程，`:3100`/`:3200` 均未监听。
2. **本次迁移使用的 mainnet console 实例状态**：当前 PID 存活且监听 `127.0.0.1:3202`——**执行当天必须重新核实这个 PID**，不能假设是第 1 批验收时的 `15396`，中间任何一次重启都会换 PID。
3. **NWT 2-1 三条准入门 env 仍生效**：`grep RELAY_HOTWALLET kanet.mainnet.env` 三行值未变（per-relay `800`/total `1000`/冷清单含 Trader-B+MarketMaker-A 两个地址）；当前进程 stdout 里能找到 `[relay-hotwallet-monitor] started` 这一行。
4. **第 1 批 10 行仍然健康**（本批新增前提，第 1 批执行页没有的一条——因为现在库里已经有正在跑的 relay 了，不是空表）：`relay_nodes` 里第 1 批 10 个 `stress-*` 名字对应的行仍然存在、对应子进程仍然存活（`relayHealthMonitorTick` 最近一次 tick 的 `deadCount` 不应把这 10 行算进去）；`events.hotwallet_relay_killed` 计数应仍为第 1 批验收时记录的值（导入前后不应凭空增加，增加说明第 1 批期间发生了本页执行窗口之外的意外，需要先查清楚再继续）。
5. **源库只读核数**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name IN ('J2','Trader-A','KANet-UI','Trader-M','Bettor','Qclaude')` 应 `=6`。
6. **新库尚无同名行**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name IN (同上六个名字)` 应 `=0`。

## 2. 拒绝场景验证（本批改用 MarketMaker-A 冷地址，验另一条冷清单项）

第 1 批已经用 Trader-B 冷地址验证过 `cold_address_denied` 这条分支真实生效（见第 1 批证据页 §2）——**本批不必重复验同一个地址**，改用 `RELAY_HOTWALLET_COLD_ADDRESSES` 里的**第二个**地址（MarketMaker-A），把冷清单两条都各验过一次，不留"第二条地址其实没在 env 里生效"这种未验证的假设。

1. `POST http://127.0.0.1:3202/relays`，`application/x-www-form-urlencoded` body：`name=zzz-admission-probe-<timestamp>&address=kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4&network=mainnet`（MarketMaker-A 冷清单地址，第 1 批未验过的第二条）——**不带 `mnemonic`**，零密钥材料，同第 1 批探针设计。
2. **预期结果**：`302`，`Location: /relays?hotwallet_denied=cold_address_denied`。
3. **验证行未被创建**：`SELECT COUNT(*) FROM relay_nodes WHERE name LIKE 'zzz-admission-probe-%'` 探针前后应从 `0` 到 `0`。
4. **如果探针没有被拒绝**：**立即停止，不得继续本页任何后续步骤**——按第 1 批执行页 v0.2 §2 第 5 点 a/b 同款处理（先 `POST /relays/:id/delete` 清理这条意外插入的探针行、复核查无，再回 §1 重新核实，顺序不能反），不是"反正后面还有 `startRelay()` 那层兜底就继续导"。

## 3. 逐行导入（同第 1 批执行页 §3 方法，本批 6 行）

对 §1 第 5 项查出的 6 行，**逐行走完下述全部子步骤再开始下一行**：

1. 对该行 `mnemonic_encrypted`，用旧密钥（一次性环境变量注入，绝不用命令行参数，进程退出即丢弃）调本仓当前 HEAD 的 `decrypt()`，得到明文助记词，只存在这一次脚本调用的局部变量里。
2. 立即调 `addressFromMnemonic(phrase, 'mainnet')`，与该行 `relay_nodes.address`（源库存的值）逐字比对：不一致 → 单列出来，不导入这一行，继续下一行；一致 → 继续下一步。
3. `POST http://127.0.0.1:3202/relays`，`application/x-www-form-urlencoded` body：`name=<该行原 name>&mnemonic=<刚解密出的明文助记词>&network=mainnet`（不传 `address`，让服务端独立再派生一次）。
4. 该行明文助记词变量在这次 `POST` 调用返回后立即丢弃。
5. 检查响应：`302` 且 `Location` 不含 `hotwallet_denied` → 通过；含 `hotwallet_denied=<reason>` → **不应该发生**（本批最大一行 J2 21.48 KAS 远低于两个上限），发生即停下核实该行真实链上余额是否与迁移 runbook §5 基线一致，不强行继续导下一行。
6. 导入后立即核对（新库侧）：`address` 与源库该行地址逐字一致、`network='mainnet'`、只读 `getBalancesByAddresses` 查得余额与迁移 runbook §5 对账表该行基线一致。
7. 六行全部完成后，`SELECT COUNT(*)` 应 `=6`，逐行 `address` 集合与源库对应集合完全一致（集合比较，非仅计数）。

## 4. 观察：这批账号会被启动，私钥会驻留内存

跟第 1 批同样的确定后果（`relay-health-monitor.js` 的 eligible 判定不要求 adapter，只看 address+mnemonic 存在——见第 1 批执行页 §4 完整展开，本页不重复）：这 6 行导入完成后，下一次 30 秒 health-monitor tick 会把它们判定为 dead 并尝试 `startRelay()`；余额均远低于两个上限，准入检查会通过；私钥会实际进入 6 个独立子进程内存，不需要人工再做任何"启用"操作。

**GO-E 验证身份 + GO-E 九步安排（Bettor 1182 明确要求写清楚）**：迁移 runbook §8（Owner 1168 ④/Bettor 1168-补）已经定过——GO-E 清单"波 0/1 验证身份"改用本批迁移进来的 `Bettor`（1.59303211 KAS）或 `Trader-A`（7.45579730 KAS）二选一，不新建专门身份；`Trader-B` 即便已在第 4 批（未来另派）迁移，也因 Rule 1 零引用 grep 命中源码硬编码常量而**永不能**被选作验证身份（同一条理由此前已排除，本页不重复展开判据本身）。**GO-E 清单（`docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md`）九步验证流程本页不代为执行**——待本批（第 2 批）验收通过、`Bettor`/`Trader-A` 两行确认已导入且 relay 正常启动之后，**单独另派一次 GO-E 九步执行**，不在本批执行窗口内顺带做，两件事分开验收、分开留证据。

## 5. 监控 tick 日志与 events 计数观察

同第 1 批执行页 §5 方法：

1. **健康监控**：`stdout` 里 `[diag:tick-duration] relayHealthMonitorTick` 系列行，`eligible` 应从 `10`（第 1 批已在跑的）变为 `16`（第 1 批 10 + 本批 6），`deadCount` 短暂出现 `6`（本批刚导入还没启动的那几行）随后归零。
2. **驻留期监控**：`[diag:tick-duration] relayHotwalletMonitorTick` 系列行，`checked` 应从 `10` 变为 `16`，`killed` 全程应为 `0`。
3. **`events` 表**：`hotwallet_relay_killed` 计数，导入前后应保持与 §1 第 4 项记录的基线一致（不应凭空增加）。
4. **子进程确认**：`Get-CimInstance Win32_Process -Filter "ParentProcessId=<console PID>"` 应比导入前多 6 个 `node.exe`，且这 6 个的 `CreationDate` 应集中在同一个 tick 附近（同第 1 批 10 个子进程同一创建时刻的证据形式）。
5. **观察窗口 ≥90s**（同第 1 批，覆盖至少 2-3 个 30 秒 tick 周期）。

## 6. 回滚（同第 1 批执行页 §6，复用迁移 runbook §7 现成路由）

任何一行导错（地址派生比对失败却被误导入、`network` 字段错、或 §5 观察到异常）：
1. 确认该行子进程已停止（`stopRelay()` 或手动兜底）。
2. `SELECT id,name,address,network,created_at FROM relay_nodes WHERE id=?` 留证据（不选加密字段）。
3. `POST /relays/:id/delete`。
4. 再次 `SELECT` 复核应查无。
5. 源数据未受影响，可重新走 §2/§3 正确流程补导这一行。

## 7. 证据清单（执行完成后落 `docs/provenance/<日期>-kanetui-migration-batch2-small/`，同第 1 批格式 + v0.2 新增第 0 项）

- 🔴 **v0.2 新增（NWT 建议，Bettor 1184 采纳）：执行窗口的 `stdout`/`stderr` 原始日志副本**——从本批起，证据目录除 README 外必须另存两份独立文件（命名同热钱包部署证据页惯例：`console-mainnet-stdout-PID<当次 PID>.log` / `console-mainnet-stderr-PID<当次 PID>.log`），覆盖从 §2 探针发出到 §5 观察窗口结束的完整区间——不是只在 README 里摘录几行，`logs/mainnet/` 下的活动日志会在下次重启时被覆盖，独立副本是本批执行完成后唯一还能重新核对原始文本的地方。第 1 批证据页当时只摘录进了 README、没留这两份独立副本，是本条要补的缺口，第 1 批本身不用补（NWT 已就第 1 批本身 GREEN 定案，这条只管第 2 批起）。
- §2 探针（MarketMaker-A 版本）的完整 HTTP 响应（状态码 + `Location`，不含请求体明文）。
- §3 逐行核对结果表：6 行的 `name`/`address` 一致性结果/链上余额比对结果（**不含 `mnemonic` 字段**）。
- §5 观察到的两个监控 tick 日志片段（覆盖导入后至少 2 个周期）、`events` 表查询结果（导入前后各一次）、子进程数量对照。
- 任何一行触发回滚：对应的 §6 四步操作记录。
- 本页不含 GO-E 九步的执行证据——那是另一份独立派工，见 §4 说明。
