# TN12 退役 + 主网只读节点上线 runbook v0.1.1（2026-09-13 · KANet-UI · 只写不执行）

> **Status: DRAFT**。权威：`docs/DECISIONS.md` D-017（Owner 裁定：主网节点跑 da9 本机官方 v2.0.1、TN12 退役）+ COORD-LEDGER (1006) Bettor 派工。**本文档任何一步都不执行**；执行门 = 本 runbook → NWT 红队审 → Owner 终端单点 GO → 执行（逐步，每步验证）。凡涉及停节点/删数据/改端口/改服务配置，一律走此门，任何 agent 不得自行做。
>
> **v0.1.1 变更（NWT 红队 FINAL v0.1 对 J1 §9 的两条 PUSH-BACK，Bettor ledger (1008) 转发·MUST）**：新增 §2.0 drain 在飞交易；§3 重同步口径改条件句；§1.2 补 kaspad 当前进程命令行记档（Codex 3358c4ff / ledger (1007)：从此"D-c/D-d 在跑"只认运行进程命令行，不认脚本文件/历史验收）。**GO-1 之前，本文档任何一步都不执行，含 §2.0。**

## 0. 范围与不做什么
- 本机（da9）：停 TN12 消费者 → 停 TN12 kaspad → 起主网 v2.0.1 只读节点，同盘、独立 datadir/端口。
- younio 侧（:3400 节点/consumer）**不在本 runbook 范围**（D-017 落账时已注明"younio 侧不管"，其去向待 Bettor/J1 另定）。
- 删除 TN12 ≈158 GB 数据目录**不在本 runbook 执行段内**（D-017 §3 已裁：不是起主网节点的前置），单列为"主网节点同步完成后的第二次 GO"（见 §5）。
- 合约/代币改造（`sil-v1/KanetTestToken.sil` 等）不在本 runbook 范围，走钱路设计→NWT→Owner 批的独立路径。

## 1. TN12 消费者清单（停止对象，均带证据）

### 1.1 console 内 setInterval tick（进程 = kasia-console `index.js` 的子模块，非独立进程，随 console 停/起）
| 消费者 | 证据（file:line） | 说明 |
|---|---|---|
| 市场结算 pool-market-settler | `kasia-console/src/services/pool-market-settler.js:206` | 结算 tick；`:2049/:2069` 按地址前缀 `kaspatest:` 推网络（波0前置 §G 类 B 已知风险，本 runbook 不改代码，仅停服务） |
| 预测市场结算 bettor-prediction-settler | `kasia-console/src/services/bettor-prediction-settler.js:41` | — |
| bshard 结算 daemon | `kasia-console/src/services/bshard-settle-daemon.mjs:1031` | `NETWORK` 默认值 `:52 = process.env.KASPA_NETWORK \|\| 'testnet-12'` |
| 做市 seeder | `kasia-console/src/services/market-seeder.js:24`（另 depositWatcher `:39`） | — |
| pool 做市 seeder | `kasia-console/src/services/pool-market-seeder.js:52` | — |
| bshard 平仓投票 voter | `kasia-console/src/services/bshard-close-voter.js:270`（网络判定 `:141`） | 日志标签 `[bshard-close-voter-v2]`（同文件内版本号，非独立文件） |
| ZK 结算 worker | `kasia-console/src/services/zk-prove-worker.mjs:125` | `:100` 含 `'testnet-12'` 字面量（评估 v0.2 §G 类 E 已知硬编码，主网需改代码，不在本 runbook） |
| 退款自动认领 claim-auto | `kasia-console/src/services/bettor-refund-claim-auto.mjs:180` | 8/22 曾出现"95 笔死锁"（已知历史问题，非本次新增） |
| Oracle 续期 cron | `kasia-console/src/services/oracle-pool-renewal-cron.mjs:212`（网络 `:126`） | — |
| Oracle 链扫描 cron | `kasia-console/src/services/oracle-pool-chain-scanner-cron.mjs:62`（网络 `:33`） | — |
| relay UTXO 再平衡 cron | `kasia-console/src/lib/broadcaster-utxo.mjs:98` | 评估 v0.2 提到的"再平衡 45,994 grams"主体 |

🟡 以上未必是全部（`kasia-console/src/services/` 下还有 pool-auto-better / pool-bot-autofund / pool-house-agent / bettor-position-* / bettor-reactor / bettor-resolver / bettor-scanner / bettor-scavenger / bettor-variant-expander / broker-* 等 20+ 文件带 setInterval，未逐一列出 file:line——**停 console 进程本身会一并停掉所有这些**，本表只列了 Bettor 点名的几类，不代表其余不受影响）。

### 1.2 独立 Windows 进程（console 外）
| 消费者 | 证据 | 说明 |
|---|---|---|
| kaspad（TN12） | 现 PID 16644，`D:\kaspad-live\db-4d0a9e30\kaspad.exe`，参数见 `scripts/kaspad-watchdog.ps1:47`：`--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=4096` | — |
| kaspad-watchdog | 现 PID 24220，`scripts/kaspad-watchdog.ps1` | **只启不杀哲学**（脚本头注释明示："不提供 stop 参数"）——它不会主动杀 kaspad，但 kaspad 死后 60 s tick 内会**重新拉起**；因此必须先停 watchdog 本身，否则停 kaspad 后它会把节点拉回来 |
| tn12-mining-watchdog-v2 | 现 PID 19532，`D:\kaspa-tn12-mining\tn12-mining-watchdog-v2.ps1` | 三态判定（OWNED_RUNNING/CONFIRMED_ABSENT/UNKNOWN_OR_CONFLICT），tips≥220 brake；同样只启不杀 |
| stratum-bridge | 由 tn12-mining-watchdog-v2 拉起，`D:\rusty-kaspa-tn10-build\release\stratum-bridge.exe`，配置 `D:\kaspa-tn12-mining\bridge-tn12-config.yaml`：`kaspad_address: 127.0.0.1:16210`（gRPC 端口），`node_mode: external` | 挖矿桥，连的是 TN12 kaspad 的 gRPC 端口（非 borsh 17210） |
| Startup 自启动项 | `C:\Users\ADMIN\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\KANet-TN12-BootSequence.lnk` → `powershell.exe -File D:\kanet-tn12\scripts\kanet-boot-sequence.ps1` | 每次**用户登录**触发（非 Scheduled Task），五步：①kaspad-watchdog ②等 RPC ready(超时300s) ③tn12-mining-watchdog-v2 ④kanet-start.sh(全栈) ⑤console-supervisor.sh start；**本次改造必须先改/禁用这个 .lnk，否则下次开机/登录它会把已停的 TN12 栈重新拉起** |
| console-supervisor | 无 Scheduled Task（`Get-ScheduledTask` 对 `*KANet*`/`*Console*`/`*Kaspad*` 查询为空，2026-09-13 实测）；由 boot-sequence.ps1 步⑤ `bash scripts/kanet-console-supervisor.sh start` 拉起，是一个**后台 bash 循环**（PID 见 `logs/pids/console-supervisor.pid`），非 Windows 任务——它 curl 探活 :3200，死则自动 `kanet-start-headless.sh` 拉起 console | Bettor 问的"KANet-Console-Supervisor 任务状态"= **不存在这个任务，实体是上面那个 bash 循环** |

**当前 kaspad（PID 16644）进程命令行（Codex 3358c4ff / ledger (1007) 裁定：从此"D-c/D-d 在跑"只认运行进程命令行，不认脚本文件本身或历史验收记录，本条按此要求记档）**：
- 🔴 **本次记档失败，原样记录失败原因，不冒充成功**：`Get-CimInstance Win32_Process -Filter "ProcessId=16644"` 与按 `Name='kaspad.exe'` 查询，`CommandLine`/`Path` 字段均返回**空**；进一步核实 `SessionId=0`（非交互式会话，通常是提权/服务级上下文），我当前是非提权交互会话（`desktop-da9qq46\admin`，与 console/17428 等已知 SYSTEM 级进程同一权限边界问题，见记忆），**结构性读不到**，不是漏查。
- **可用替代（脚本静态参数字符串，非从运行进程读出，两者不能等价）**：`scripts/kaspad-watchdog.ps1:47` 现值 `--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=4096`——这是 watchdog **拉起 kaspad 时会传的参数**，前提是当前 16644 确实是 watchdog 按此脚本拉起的（进程树时间线吻合，见 (1005)），但**未经进程本身验证**，不满足 Codex 3358c4ff 的"只认运行进程命令行"标准。
- **待办**：真要满足这条权威要求，需要 J1/Bettor 提权读一次 `Get-CimInstance Win32_Process -Filter "ProcessId=16644" | Select CommandLine`（或等效的提权查询），执行本 runbook 前应补上；本 runbook 现状 = **诚实标注缺口，不是补全**。

## 2.0 drain 在飞交易（停消费者之前，NWT PUSH-BACK·MUST，GO-1 前不执行）

停节点会让任何"已 submit 但还没链上确认"的交易永远卡在半吊子状态（换节点后没人再去查它的最终结果）；删数据目录后更是连查都查不清。**§2.1 开始前必须先确认下面四类都已 drain（或明确判定为"不会再动、不算在飞"）**：

| 消费者 | 队列/状态来源 | 查询 | 判据（drained） |
|---|---|---|---|
| P2SH 资金相关 submit（fund/lock、settle、refund、sweep、bshard_*、closezk_v2_*，含 J2 G-1 设计 v0.2 MUST-1 点名的 4 处 `pending.submit` 站点：`kasia-relay/src/lib/p2sh.mjs:306`、`transaction.mjs:226`、`utxo-split.mjs:125/:275`） | 无独立"pending 队列表"——这些是同步调用（提交后立即拿到 txId 或抛错），风险窗口只是"最近提交、还没上链确认"；relay 侧通用出账记录表 `tx_records`（`kasia-console/src/db/migrate.js:86`，`status` 默认 `'broadcasted'`，带 `confirmations` 列，**但本 runbook 未逐一核实这张表是否覆盖全部 4 处调用点，执行前需先核实写路径**） | ① `grep -n "submit\|pending.submit" logs/relay-*.log`（或对应 relay 进程日志）取最近一段时间窗内的提交记录；② 对每个拿到的 txid，查 `kaspa_tx_log`（`migrate.js:1861`，本机嵌入式链上索引器）或 `tx_records.status`，确认已从 `broadcasted` 变为确认态（或明确 `failed`）；③ 或直接用 `scripts/_kanetui_coverify_*.cjs` 式链读模板核对 `outputs_json` |
| relay UTXO 再平衡（`broadcaster-utxo.mjs:98`） | 同步 tick，日志行 `[broadcaster-utxo] <relay8> rebalanced N→M (target N) tx=<txid>` + 收尾 `[broadcaster-utxo] tick: N relays, rebalanced=N skipped=N failed=N` | `grep "\[broadcaster-utxo\]" logs/console.log \| tail -20` | 最近一次 tick 收尾行之后，把行里出现的每个 `tx=` 短 txid 前缀去 `kaspa_tx_log` 核实已确认（脚本注释自述"N 个输出需 ~1 confirmation"，不是 0） |
| bshard 平仓签名队列（`bshard-close-voter.js:270`，日志标签 `[bshard-close-voter-v2]`） | 日志行本身就带计数：`[bshard-close-voter-v2] tick: N pending \| signed=x refused=y skipped=z errored=w` | `grep "\[bshard-close-voter-v2\] tick:" logs/console.log \| tail -5` | **`pending` 字段 = 0** 即为 drained（本机现状实测：`1 pending`，几笔一直是 `refused`——那是已知的 `frozen_evidence: canonical fetch fail` 弃签行为，非在飞，见 §2.0 备注） |
| 退款自动认领（`bettor-refund-claim-auto.mjs`，表 `pool_bettor_sides`，列 `claim_txid`/`refund_attempted_at`） | 同步 tick 内提交后立即 `UPDATE ... SET claim_txid=?`；风险窗口极短（一个 tick 内） | ① `grep "\[claim-auto\]" logs/console.log \| tail -20` 看最近是否有 `CLAIMED` 行仍在发生；② 若要，SQL：`SELECT id, refund_attempted_at FROM pool_bettor_sides WHERE claim_txid IS NULL AND refund_attempted_at IS NOT NULL ORDER BY refund_attempted_at DESC LIMIT 20` | **⚠ 区分"真在飞"与"结构性死锁"**：8/22 频道已record 一批 95 笔 `claim_txid IS NULL` 且永远进不了授权函数的死锁记录（`J2-CLAIM-DEADLOCK`，protocol_status 全 `refunded` 但候选 WHERE 条件要求 `unresolved_needs_authorization`，两头堵死）——**这类不是"在飞"，等多久都不会变，是另一个已知未解问题，不算本步骤的阻塞项**；真正要等的只是"最近几分钟内 `refund_attempted_at` 有更新但还没落 `claim_txid` 的那几条" |

**通用判据**：以上四类都查到"最近 N 分钟无新提交 + 所有近期 txid 已确认（或明确 failed）"，且 bshard-close-voter 的 `pending` 字段为 0，才算 drained，可以进 §2.1。N 的具体值（建议覆盖 2-3 个确认深度的时间窗）由执行时 NWT/Bettor 定，本 runbook 不钉死。

## 2. 停止顺序（消费者先、节点后；每步给验证命令）

**核心风险（Bettor 点名，须写清）——G-2 自愈对"节点已停但仍被期待可连"窗口的行为**：
G-2（`docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md`，已落地 09-07）的设计是**本机 RPC 连不上 N 次后重建客户端**，且 `KASPA_RPC_LOCAL_ONLY=1` 时**理应**跳过 discovery、直接 fail-closed 报 `no RPC node available`——这本身对"节点已停"是安全的（不会去连别的节点）。**但**当前有一个**未闭合**的已知缺口（NWT/J2 2026-09-13 核实、Codex 9fff92b0 第 2 条确认）：`rpc-health.js` 的 `getWorkingRpc()` 在本机 RPC 失败后**仍会走 `checkConfigured()`**，如果 DB 里配置了某个"已配置的外部 TN12 端点"，LOCAL_ONLY 挡不住这条路 ⇒ **停 TN12 节点后，console 有非零概率悄悄连到别的 TN12 公网节点继续 tick，而不是真正静默**。
⇒ **停节点前必须先核 DB 里有没有配置外部 TN12 RPC 端点**（`adapter_nodes` 或类似表，具体字段待执行时现查），有则一并清空或改成本机 loopback-only，否则"停节点"不等于"consumer 真的停了"。这条在 (a) LOCAL_ONLY 严格语义设计落地前是**已知未消除的风险**，不是本 runbook 能单独关掉的，只能靠"停之前核实配置"降低。

### 2.1 停消费者（console + console 侧子系统）
1. 通知频道 + Bettor（不可逆操作前置报备）。
2. 核 DB 有无外部 TN12 RPC 端点配置（见上，风险条款）。
3. `bash kanet-stop.sh`（会停 console 及其全部子进程/tick，见 §1.1 全表）。
4. 验证：`curl -sf http://127.0.0.1:3200/` 应连接失败（非 200/302）；`netstat -ano | grep :3200` 应无 LISTENING。

### 2.2 停挖矿桥 + mining-watchdog-v2
1. 先停 `tn12-mining-watchdog-v2.ps1`（PID 19532，`Stop-Process`）——它是"只启不杀"，先停它才能安全停下游 stratum-bridge 而不被它当"死了"重新拉起。
2. 停 `stratum-bridge.exe`（由 watchdog 拉起的子进程，watchdog 停后手动确认其已退出或单独停）。
3. 验证：`Get-Process stratum-bridge -ErrorAction SilentlyContinue` 应为空；watchdog 自身的 `_watchdog.log` 末行应无新 tick。

### 2.3 停 kaspad-watchdog，再停 kaspad
1. **先停 watchdog**（PID 24220，`Stop-Process`）——不先停它，停 kaspad 后 60 s 内会被拉回来。
2. 再停 kaspad（PID 16644，`taskkill //PID 16644 //F`）。
3. 验证：`Get-Process kaspad -ErrorAction SilentlyContinue` 应为空；`netstat -ano | grep :17210` 应无 LISTENING；等 90 s 后再查一次确认 watchdog 没把它拉回来（60 s tick + 余量）。

### 2.4 禁用开机自启动（否则下次登录/重启整套 TN12 栈会被拉回）
1. `KANet-TN12-BootSequence.lnk`：改名加 `.disabled` 后缀（同目录已有 `tn10-mining-watchdog.cmd.disabled` 先例，是本仓沿用的禁用记号），**不删除**（保留可回滚）。
2. 验证：下次登录不应再看到 boot-sequence.log 有新的 "=== boot sequence start ===" 行。

### 2.5 回滚（任何一步出问题）
- 恢复 `.lnk`（去掉 `.disabled` 后缀）。
- 重新手动起 `kaspad-watchdog.ps1` → 等 RPC ready → `tn12-mining-watchdog-v2.ps1` → `kanet-start.sh` → `console-supervisor.sh start`（= boot-sequence.ps1 的五步，手动顺序重放）。
- kaspad 本身不需要特殊恢复：`--appdir=D:/kaspa-tn12-data` 数据目录本步骤未删，watchdog 拉起后会从原状态继续。

## 3. TN12 数据目录

- **路径**：`D:\kaspa-tn12-data`（来自 `kaspad-watchdog.ps1:47` 的 `--appdir`，非猜测）。
- **实测大小**：158 GB（2026-09-13 17:xx 本机 `du -sh` 实测；9/7 评估文档写的 ≈204 GB 是更早的读数，剪枝后回落，两者不矛盾）。
- **⚠ 澄清（防误删）**：Bettor 提到的保留清单——`console.db`（实际路径 `D:\kanet-tn12\kasia-console\data\console.db`）、`docs/evidence`、`docs/provenance`（均在 `D:\kanet-tn12\docs\` 下）、pinned silverc 编译器产物——**没有一个在 `D:\kaspa-tn12-data` 目录树内**，它们是仓库/console 侧文件，与 kaspad 链数据是完全不同的目录树。删除该目录不会碰到它们——保留清单存在的意义是"确认删除命令的作用范围没有误伤到别处"，不是"这个目录里有东西要挑出来留"。pinned silverc（`silverc-zk-8065184`）确切路径待 J2/NWT 执行时核对，但可以确定不在此目录下（编译器产物属于 `/d/silverscript` 或工具链目录）。
- **⚠ 重新同步能否完成 = 条件句，不是"随时能"（NWT 红队 PUSH-BACK·MUST 改）**：`D:\kaspa-tn12-data` 是公链数据、格式上确实可以整目录删除后重新 IBD——**但这话只在"有节点可同步"的前提下成立**。TN12 全网从我们视角**只有一个在我们未来的前向 peer（`136.243.93.17`）**，且该 peer 当天两次自行断连（一次 3.5 分钟自愈、一次 ≥108 分钟未回，ledger (992)(993)(999)）；J2 (999) 的只读扫描已确认**无第二候选前向节点**，公共 Resolver 对 TN12 无条目。⇒ **正确表述是"若该 peer 在线，可以重新同步；若它不在线或以后彻底下线，TN12 数据一旦删除即不可恢复"**——这不是理论风险，是本机 9 月已实测发生过的真实状况（两次自断连中的后一次持续超过 1.75 小时未回）。GO-4（删除，见 §5）执行前应再核一次该 peer 在线状态，且既然 D-017 已裁 TN12 退役、不追加投入，此风险本身不构成"不能删"的理由，只是"删之前想清楚——删了如果它已经永久下线，这份数据就没有回头路"。
- **删除时机**：**不在本 runbook 执行段**，推迟到"主网节点同步完成"之后，作为第二次独立 GO（见 §5）。D: 现空 758.7 GB，远高于官方最低 640 GB，删除不是任何前置阻塞项，纯粹是空间回收，不急。

## 4. 主网只读节点

### 4.1 官方 release（已验证，未下载新文件——本机已有一份，只做了完整性核对）
- Release：`kaspanet/rusty-kaspa` tag `v2.0.1`（"Mainnet Toccata Release"，published 2026-06-15T19:14:22Z）。
- Windows 资产：`rusty-kaspa-v2.0.1-win64.zip`，size 46,762,325 bytes，**sha256（GitHub API digest 字段，非本机计算）= `bec0710079baa612fa0776af9460ae8106193b6458974eb2ebdb9e233383bce8`**。
  下载地址：`https://github.com/kaspanet/rusty-kaspa/releases/download/v2.0.1/rusty-kaspa-v2.0.1-win64.zip`（GitHub 该 release 未附单独 `checksums.txt`，上面这个 digest 取自 GitHub Release Assets API 的 `digest` 字段，是 GitHub 上传时算好的，非本次下载后自算）。
- **本机已有一份，且刚核对完整性一致**：`D:\rusty-kaspa-v201\rusty-kaspa-v2.0.1-win64.zip`（2026-08-01 落地）本机 `sha256sum` = 上面那个值，**逐字节匹配**；解压产物 `D:\rusty-kaspa-v201\kaspad.exe` 跑 `--version` 输出 `kaspad 2.0.1`，与解压出的 `kaspa-wallet.exe`/`rothschild.exe`/`stratum-bridge.exe` 同目录齐全。**⇒ 本 runbook 执行阶段不需要重新下载**，直接用这份（执行前建议再跑一次 sha256 复核，防这几周内文件被改动过）。

### 4.2 datadir
- 目标路径：`D:\kaspa-mainnet-data`。
- **⚠ 需先核（本 runbook 未做，标 TBD，执行前必查）**：此目录**已存在**，`LastWriteTime` = 2026-04-09（半年前，早于本项目当前所有工作），内含子目录 `kaspa-mainnet` 与一个孤立文件 `kaspad.log`（3.9 MB，2026-04-10），总大小仅 ≈37 GB——体量远小于一个已同步的 pruned 主网节点应有的量，判断是**某次早期试验留下的陈旧/未完成数据**。**执行时必须先看清楚里面到底是什么**（`kaspad.exe --appdir=D:\kaspa-mainnet-data` 直接起会不会因版本/格式不兼容出错、还是能续传）再决定复用或清空重建，不能假设它可以直接拿来用，也不能假设它没用直接删——两个方向都要先看数据再定，本 runbook 不替执行者做这个判断。

### 4.3 建议启动参数（骨架，非最终——执行前 NWT/J2 再核一遍）
```
kaspad.exe --appdir=D:\kaspa-mainnet-data --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=4096
```
- `--utxoindex`：Bettor 明确要求。
- `--rpclisten-borsh=127.0.0.1:17110`：**显式回环绑定**（17110 是 `kaspad.exe --help` 读到的官方 mainnet 默认端口，来源见下）——TN12 侧曾经默认绑 `0.0.0.0` 暴露到 tailnet 接口，2026-07-28 才修成显式回环；主网从第一天就该带这个参数，不重蹈覆辙。
- **不带** `--testnet`/`--netsuffix=12`（这是 mainnet）。
- **不带** `--enable-unsynced-mining`（TN12 专用的 bootstrap 死锁绕过；波 0 是只读节点，不在本机挖矿）。
- `--rocksdb-cache-size` 数值沿用 TN12 现在的 4096 只是起点参考，J2 资源估（评估 v0.2 §2 第⑤条，仍标"待核"）出来后应重新核这个值。
- 端口来源：`kaspad.exe --help`（本机已有二进制，读 help 是只读操作）——`--rpclisten`（gRPC）默认 mainnet 16110/testnet 16210；`--rpclisten-borsh` 默认 mainnet **17110**/testnet 17210；`--listen`（P2P）默认 mainnet **16111**/testnet 16211。与 Bettor 给的 16111/17110 一致。

### 4.4 预计同步时长
**TBD，本 runbook 不给数字**——评估 v0.2 §2 第⑤条已经把"pruned 磁盘/内存数字"列为待办（分派 J2，未回）,本机没有做过主网 IBD，没有可引用的实测或权威估法基础；不编造。执行前若 J2/官方文档给出坐标，补进本节。

### 4.5 磁盘/内存预算（与 TN12 并存期）
| 项 | 数值 | 来源 |
|---|---|---|
| D: 总空闲 | 758.7 GB | Bettor 2026-09-13T10:07:36Z 自跑 `Get-PSDrive` |
| 官方最低要求 | 640 GB | 评估 v0.1 §1 硬事实表引 `docs/toccata-guide.md` |
| TN12 datadir 现用 | 158 GB（实测，见 §3） | 本机 `du -sh` |
| D:\kaspa-mainnet-data 现有内容 | ≈37 GB（陈旧，待判断复用/清空，见 §4.2） | 本机实测 |
| ⇒ 并存期磁盘余量（不删 TN12、不动旧 mainnet-data 情况下） | 758.7 − (mainnet IBD 增量，未知) | 主网数据会持续增长直到与 TN12 磁盘总和逼近官方最低线之前应有充足余量，具体交叉点未知（同 §4.4 TBD） |
| RAM 总量 / 现空闲 | 61.6 GB / 42.2 GB | Bettor 同上时间点自跑 |
| TN12 kaspad 实测工作集 | 15–28 GB（视 cache，`--rocksdb-cache-size=4096` 现值） | seed/ledger 既有记录 |
| 主网节点工作集 | 未知（新节点，无实测） | 同 §4.4 TBD |
| ⇒ 并存期 RAM 判断 | 若主网节点工作集与 TN12 相近（15–28 GB 量级），42.2 GB 空闲**可能**不够两个节点同时跑满负荷 cache；建议主网节点先用较小 `--rocksdb-cache-size`（如 2048）起步同步，同步完成、TN12 停掉腾出内存后再考虑提高 | 推断，非实测，执行前应留意 IBD 期间内存曲线 |

## 5. GO 检查点（哪一步之前必须 Owner 一句 GO，非菜单）

1. **GO-1（本 runbook 整体执行前）**：Owner 看过本 runbook + NWT 红队审结论，终端单点确认可以开始 §2.1。
2. **GO-2（§2.3 停 kaspad 前，若与 GO-1 分开要）**：TN12 停节点是本次唯一真正不可逆的"服务中断"动作（消费者/挖矿桥停止都可随时重启复原，节点数据本身不删），若 Owner 想在这一步再确认一次可单独设卡；默认并入 GO-1，除非 Owner 要求拆开。
3. **GO-3（§4 起主网节点前）**：确认 §4.2 的 `D:\kaspa-mainnet-data` 陈旧内容已判断清楚（复用或清空）之后再起。
4. **GO-4（独立、晚于本 runbook）**：删除 `D:\kaspa-tn12-data`（§3）——主网节点同步完成后的第二次 GO，与本 runbook 执行无关联时间点，另开一次报备。

## 6. 待核实/未完成（本页故意留白）

- §4.2 `D:\kaspa-mainnet-data` 旧内容具体是什么、能不能复用——执行前必查，本 runbook 不代查。
- §4.4 主网 IBD 预计时长——无可引用坐标，等 J2/官方文档。
- §2 风险条款提到的 DB 外部 TN12 RPC 端点配置——具体字段/表名待执行时现查（不在本 runbook 阅读阶段做，因为这本身是只读核查，放执行步骤里更准确）。
- pinned silverc 确切路径——待 J2/NWT 核对（确定不在 `D:\kaspa-tn12-data` 内，不影响 §3 删除范围判断）。
- §1.2 kaspad 16644 的真实运行进程命令行——本次非提权查询结构性读不到（`SessionId=0`），需 J1/Bettor 提权补一次，执行本 runbook 前应补上（Codex 3358c4ff 的硬要求）。
- §2.0 `tx_records` 表是否覆盖 `p2sh.mjs`/`utxo-split.mjs` 全部 4 处 submit 调用点的写路径——本 runbook 未逐一追踪代码确认，执行前应核实，不确定则以 relay 日志 grep + `kaspa_tx_log` 交叉核对为准。
- §2.0 drain 的等待窗口 N（分钟）——本 runbook 未钉死具体值，执行时 NWT/Bettor 定。
