# 主网账号迁移 · 第 1 批（stress 验证批）执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1177 派工 · 只写不执行）

> **Status: DRAFT**。权威链：`docs/2026-09-14-kanetui-mainnet-account-migration-runbook-v0.1.md`（v0.6，下称"迁移 runbook"）§6.2 第 1 批。**本页任何一步都不执行**——执行门 = 本页 → NWT 红队审 → Owner 批 → 执行，跟迁移 runbook 本身的执行门是同一条。本页只把迁移 runbook 的通用方法（§1-§7）针对**第 1 批这 10 个具体账号**落成可打钩的步骤清单，不重新定义任何机制——所有引用编号（如"§5.1 第 2 层"）均指迁移 runbook 的对应章节。

## 0. 范围

**10 个账号**：`stress-user-01`~`08`、`stress-control-01`~`02`（迁移 runbook §1.3 已查库核实的 19 行名单里余额最小的一档，各 ≈0.49–0.50 KAS，合计约 5 KAS）。这批同时承担迁移 runbook §5.1 第 3 点、§6.2 第 1 批要求的"专门构造一次会被拒绝的场景"验证职能——本页 §2 是这条要求的具体操作化。

## 1. 执行前检查清单（阻断条件，全部满足才能进 §2）

1. **源库无持有进程**（迁移 runbook §0 第 1 项，执行当天必须重新核，不能用之前任何一次核实的结论）：`C:\KANet` 路径下无 node 进程（`Get-Process | Where Path -like 'C:\KANet*'` 应为空）；`:3100`/`:3200` 均未监听（`Get-NetTCPConnection`）。
2. **本次迁移使用的 mainnet console 实例状态**：当前 PID 存活（`Get-Content logs\mainnet\console-mainnet.pid` 读到的 PID 与 `Get-Process` 核实一致——2026-09-14 热钱包部署（`docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/`）验收时是 PID `15396`，**执行当天必须重新核，不能假设这个 PID 还在**，中间任何一次重启都会换 PID），`127.0.0.1:3202` 监听中。
3. **NWT 2-1 三条准入门 env 仍生效**：`grep RELAY_HOTWALLET kanet.mainnet.env` 应看到 `RELAY_HOTWALLET_COLD_ADDRESSES`/`_PER_RELAY_MAX_KAS`/`_TOTAL_MAX_KAS` 三行且值未被改动（本次部署定案值：per-relay `800`、total `1000`，冷清单含 Trader-B + MarketMaker-A）；当前进程 stdout 里能找到 `[relay-hotwallet-monitor] started` 这一行（证明这个 PID 是带着三条准入门起来的，不是三键写入之前的旧进程）。**这一项和迁移 runbook §0 第 2 项是同一条阻断条件**——已经在 2026-09-14 部署中满足，本项只是要求执行当天重新确认没有漂移。
4. **源库只读核数**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name IN ('stress-user-01','stress-user-02','stress-user-03','stress-user-04','stress-user-05','stress-user-06','stress-user-07','stress-user-08','stress-control-01','stress-control-02')` 应 `=10`。
5. **新库（本次迁移目标库）尚无同名行**：`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name IN (同上十个名字)` 应 `=0`——防止重复导入（脚本层面本身应该幂等检查这一条，不是只靠人工执行前看一眼）。

## 2. 拒绝场景验证（迁移 runbook §5.1 第 3 点/§6.2 第 1 批要求，早于本批任何一行真实导入）

**目的**：在任何一行真实密钥材料进入这个 mainnet console 实例之前，先用**零密钥材料的探针**证明两层准入检查里被官方文档称为"唯一真正的安全边界"的那一层（`checkHotwalletAdmission()`，迁移 runbook §5.1 第 2 点）**在这个具体运行实例上**确实生效，不是只有侧分支单元测试（11/11 GREEN）证明过、部署到生产实例后从没验证过。

**探针设计（零风险——全程不涉及任何真实助记词/私钥）**：
1. `POST http://127.0.0.1:3202/relays`，`application/x-www-form-urlencoded` body：`name=zzz-admission-probe-<timestamp>&address=<Trader-B 的冷清单地址,与 kanet.mainnet.env 里 RELAY_HOTWALLET_COLD_ADDRESSES 第一个值逐字相同>&network=mainnet`——**不带 `mnemonic` 字段**。
2. 代码路径核实（`relay.js:89-108`）：`address` 显式传入时 `resolvedAddress` 直接取这个值（不需要 `mnemonic` 来派生），所以 `if (resolvedAddress)` 分支会执行、`checkHotwalletAdmission()` 会被调用——探针能测到準入检查，但因为没有 `mnemonic`，即便万一没被挡下也不会有任何真实密钥材料写进库（`createRelayNode()` 的 `mnemonic` 字段会是 `null`，这一行本身就是个没有密钥的空壳，等同一个手误的空名单行，不是可用的热钱包）。
3. **预期结果**：HTTP 响应是一个 `302` 重定向，`Location` header 应为 `/relays?hotwallet_denied=cold_address_denied`（`relay.js:106` 的 `reply.redirect` 分支，字面拼出这个 reason 字符串——跟 `relay-manager.js:102` `checkHotwalletAdmission()` 内部 `return { ok: false, reason: 'cold_address_denied' }` 是同一个字符串，同一处代码，不是脚本自己判断"看起来像拒绝"）。
4. **验证行没有被创建**：`SELECT COUNT(*) FROM relay_nodes WHERE name LIKE 'zzz-admission-probe-%'` 执行探针前后应从 `0` 到 `0`（`relay.js:105-109`：`admission.ok` 为假时函数在 `createRelayNode()` 之前就 `return`，行从未进 `INSERT`）。
5. **如果探针没有被拒绝**（响应不是预期的 302+reason，或者行真的被插入了）：**立即停止，不得继续本页任何后续步骤**——说明§1 检查清单第 3 项"env 仍生效"这条实际上是假的（可能中途 env 被改过、或者当前 PID 不是带着三条准入门起来的那个进程），先回到 §1 重新核实，不是"反正后面还有 startRelay() 那层兜底就继续导"。

**为什么用 import 端点探针就足以代表 `startRelay()` 那层"唯一真正的安全边界"**：`checkHotwalletAdmission()` 是同一个函数，`relay.js:105`（import 早失败层）和 `relay-manager.js:206`（`startRelay()` 内部）**调的是同一处代码，不是两套独立实现各自维护一份逻辑**（迁移 runbook §5.1 第 2 点原话："三条自动拉起路径最终都收敛到这一个函数"）——探针证明的是这个共享函数在**这个具体部署实例、带着这个具体 env 配置**下真的按预期工作，这正是侧分支单元测试（跑在隔离测试库里）没有、也不可能覆盖到的最后一环。

## 3. 逐行导入（迁移 runbook §2/§3/§5，本批具体化为 10 行的执行顺序）

对 §1 第 4 项查出的 10 行，**逐行走完下述全部子步骤再开始下一行**（迁移 runbook §4 末尾："每导入一行立即核对，不要批量导完再统一核"）：

1. 对该行 `mnemonic_encrypted`，用旧密钥（迁移 runbook §1.2/§3.1：一次性环境变量注入，绝不用命令行参数）调本仓当前 HEAD 的 `decrypt()`，得到明文助记词，**只存在这一次脚本调用的局部变量里**。
2. 立即调 `addressFromMnemonic(phrase, 'mainnet')`，与该行 `relay_nodes.address`（源库存的值）逐字比对：
   - 不一致 → 按迁移 runbook §2 第 3 点处理：**单列出来，不导入这一行**，继续下一行，不假设"反正差不多"。
   - 一致 → 继续下一步。
3. `POST http://127.0.0.1:3202/relays`，`application/x-www-form-urlencoded` body：`name=<该行原 name>&mnemonic=<刚解密出的明文助记词>&network=mainnet`（**不传 `address`**——让服务端用自己的 `addressFromMnemonic()` 独立再派生一次，这是跟步骤 2 独立的第二次派生，两次派生都对得上源库地址，比对强度比只派生一次更高，迁移 runbook §5 采用的就是这个 body 形状，不是本页自创）。
4. **该行明文助记词变量在这次 `POST` 调用返回后立即丢弃**（不等整批做完再统一清，迁移 runbook §2 第 4 点）。
5. 检查响应：
   - `302` 且 `Location` 不含 `hotwallet_denied` → 视为通过导入端点早失败层，继续下一步核对。
   - `302` 且 `Location` 含 `hotwallet_denied=<reason>` → **不应该发生**（这 10 行余额均 ≈0.5 KAS，远低于 per-relay 800 上限，且累计不到 5 KAS 远低于总额 1000 上限，不在冷清单）——如果真的发生，说明前提假设有误（比如某一行余额跟预期不符），停下核实这一行的真实链上余额，不要强行继续导下一行。
6. **导入后立即核对**（新库侧）：`SELECT id,name,address,network FROM relay_nodes WHERE name=? AND network='mainnet'` 取刚插入的行，核对：
   - `address` 与源库该行地址（步骤 2 已确认过的值）逐字一致；
   - `network` 是 `mainnet`；
   - 只读 `getBalancesByAddresses([该地址])`（本机 `ws://127.0.0.1:17110`）查得的链上余额与迁移 runbook §5 对账表里该行的基线余额一致（该表数字是本人独立核实过的权威基线，不是本次临时查的）。
7. 十行全部完成后，`SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet' AND name IN (十个名字)` 应 `=10`，逐行 `address` 集合与源库对应集合完全一致（集合比较，不只是计数比对，防止"数量对但内容错位"这种更隐蔽的错误）。

## 4. 观察：这批账号会被启动，私钥会驻留内存（Owner 需要知道的实际含义）

**这不是理论风险，是这批操作的确定后果，写清楚不是免责声明**：

1. `relay-health-monitor.js` 的 30 秒 cron 判断一行是否"eligible"（够格被检查/拉起）只看 `r.address IS NOT NULL AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)`（`relay-health-monitor.js:76-80`）——**不要求分配了 adapter，不要求任何额外的"启用"动作**。这 10 行导入完成、有 `address` + `mnemonic_encrypted` 之后，下一次 30 秒 tick 就会把它们判定为"dead"（还没启动过），进而尝试 `startRelay()`。
2. `startRelay()` 内部（迁移 runbook §5.1 第 2 层）跑准入检查：这 10 行余额各 ≈0.5 KAS，既不在冷清单，也远低于 per-relay 800、累计远低于 total 1000（10 行合计 ≈5 KAS）——**准入检查会通过**，不是"可能通过"。
3. 通过之后 `startRelay()` 继续走 `getRelayPrivkey`/`getRelayMnemonic` 解密、`fork` 一个 `kasia-relay` 子进程、把助记词/派生私钥通过子进程 env 传入——**这 10 个账号的私钥会实际进入 10 个独立子进程的内存**，不需要人工再做任何"启用"操作，30 秒 cron 会自动做完。**这是第 1 批导入的实际含义，不是导入之后还有一步"要不要启动"的选择题**——跟迁移 runbook §6.1 描述的 Trader-B/MarketMaker-A（导入但预期不会被拉起，因为余额超上限）是相反的情形：这批账号导入 = 这批账号很快会变成真正持有资金、私钥常驻的热钱包 relay 进程。
4. 因此本批执行前，Owner/Bettor 需要确认这 10 个账号"导入即启动、私钥即驻留"这个后果是预期内的（迁移 runbook 定位它们是"测试验证用"账号，余额小、损失面小，本页假设这本来就是预期，但不代为最终拍板，只负责把后果说清楚）。

## 5. 监控 tick 日志与 events 计数观察

导入完成、10 个 relay 陆续被 30 秒 cron 拉起之后，按下列方式确认整条链路（准入→启动→驻留期监控）在真实数据上运转正常：

1. **健康监控确认启动**：`stdout` 里应能看到 `[diag:tick-duration] relayHealthMonitorTick` 系列行，`eligible` 从 `0` 变为 `10`，`healthy` 逐步从 `0` 涨到 `10`（多个 tick 内，不要求一次 tick 全部拉起）。
2. **驻留期监控确认覆盖到这批**：`relay-hotwallet-monitor.js` 的 tick 日志行 `[relay-hotwallet-monitor] tick checked=<N> killed=<M>`——`checked` 应等于当前正在跑的 relay 数（这 10 个起来后应为 `10`，`killed` 应为 `0`）。
3. **`events` 表**：`SELECT COUNT(*) FROM events WHERE event_type='hotwallet_relay_killed'`，导入前后应保持 `0`——出现任何一条都说明某一行被驻留期监控判定超限杀掉了（理论上不该发生，见 §4 第 2 点的余额判断），出现即停止、按该条 `payload_json` 里的 `reason`/`detail` 字段（`relay-hotwallet-monitor.js:68-73`，不含任何密钥字段）核查具体原因，不要重新导入同一行掩盖问题。
4. **子进程存活确认**：`Get-Process -Name node` 数量应比导入前多 10 个（每个 relay 是独立 `fork` 出的子进程），且这些子进程都是这次 `console.mainnet.db` 所在实例 fork 出来的（父 PID 应等于 §1 第 2 项核实的那个 console PID）。

## 6. 回滚（迁移 runbook §7，本批具体化）

任何一行导错（地址派生比对失败却被误导入、`network` 字段错、或 §5 观察到异常）：
1. 找到该行对应的子进程 PID，确认已被 `stopRelay()` 停止（或手动 `Stop-Process` 兜底，随后走 `relay-manager.js` 的 `stopRelay` 记账路径核实状态一致）。
2. `SELECT id,name,address,network,created_at FROM relay_nodes WHERE id=?` 留证据（不选加密字段）。
3. `POST /relays/:id/delete`（迁移 runbook §7 已核实：零 `console.log`、不打印任何字段、只做两条 `DELETE`）。
4. 再次 `SELECT` 复核应查无。
5. 源数据（`C:\KANet` 那份库）未受影响，可重新走 §2/§3 正确流程补导这一行。

## 7. 证据清单（执行完成后落 `docs/provenance/<日期>-kanetui-migration-batch1-stress/`）

- §2 探针的完整 HTTP 响应（状态码 + `Location` header，不含任何请求体明文——探针请求本身也不含密钥材料，不是"脱敏后留档"，是本来就没有密钥材料）。
- §3 逐行核对结果表：10 行的 `name`/`address` 一致性结果/链上余额比对结果（**不含 `mnemonic` 字段**，同迁移 runbook §3.1 一次性脚本设计约束）。
- §5 观察到的健康监控/驻留期监控 tick 日志片段（时间窗覆盖导入后至少 2 个 30 秒 cron 周期）、`events` 表查询结果（导入前后各一次）。
- 导入前后 `relay_nodes`/子进程数量对照（§1 第 5 项 vs §3 第 7 步 vs §5 第 4 点）。
- 任何一行触发回滚：对应的 §6 四步操作记录。
