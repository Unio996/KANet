# TN12 退役 + 主网只读节点上线 runbook v0.1.3（2026-09-13 · KANet-UI · 只写不执行）

> **Status: DRAFT**。权威：`docs/DECISIONS.md` D-017（Owner 裁定：主网节点跑 da9 本机官方 v2.0.1、TN12 退役）+ COORD-LEDGER (1006) Bettor 派工。**本文档任何一步都不执行**；执行门 = 本 runbook → NWT 红队审 → Owner 终端单点 GO → 执行（逐步，每步验证）。凡涉及停节点/删数据/改端口/改服务配置，一律走此门，任何 agent 不得自行做。
>
> **v0.1.1 变更**：新增 §2.0 drain 在飞交易；§3 重同步口径改条件句；§1.2 补 kaspad 当前进程命令行记档尝试（Codex 3358c4ff / ledger (1007)）。
>
> **v0.1.2 变更（NWT 红队 `fce3898e`，`docs/2026-09-13-nwt-redteam-kanetui-tn12-retire-runbook-v0.1.md`·GO-1 未放行，MUST 收敛）**：⑥ §2.0 表扩到 §1.1 全部消费者，窗口 N 改为 **minDepth=20（本仓 `check_utxo_landed` 惯例）为主判据 + 30 分钟 wall-clock 兜底**；① §2 风险条款的 LOCAL_ONLY 现查命令写死为具体 SQL；② §2.3 改**先优雅关闭、taskkill //F 只作兜底**（RocksDB 未刷盘风险），§2.5 回滚假设同步改；⑧ **撤回 v0.1.1 里"kaspad-watchdog PID 24220"的单一进程框架**——地面事实（`logs/boot-sequence.log`）是 09:45Z 重启后 boot-sequence 跑了**两遍**（Session 0 一遍 + Session 1/Startup .lnk 一遍），§1.2 改用日志链+脚本 mtime 作证据；新增 **MUST**：§2 停序须覆盖两套实例全部 PID，§2.4 除禁用 `.lnk` 外还须定位并禁掉 Session 0 那遍的触发源（非提权查不到，Bettor 在查）——**触发源未定位 = 不得进 GO-1**。
>
> **v0.1.3 变更（NWT 复审 `8520fb71`：⑥①⑧ CLOSED/PASS，两处小修）**：§2.2 验证命令改 `Get-Process -Id 13788,19532`（原 `-Name tn12-mining-watchdog-v2` 按脚本名查会永远空手——`.ps1` 进程的 `Name` 是 `powershell.exe`，NWT 在活着的实例上实测过这个坑，会把"还活着"误读成"已停"）；§2.3 补一句未独立验证的假设（非 `//F` 的 `taskkill` 能否把控制台中断事件送到 `-WindowStyle Hidden` 起的无窗口进程，本 runbook 没实测过，最坏只是白等满 60 s 再落到 `//F` 兜底，不会卡死）。GO-1 现在唯一挡着的是 §2.4 的 Session 0 触发源（等 Owner 提权查询回执）。**GO-1 之前，本文档任何一步都不执行，含 §2.0。**

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

> 🔴 **v0.1.2 撤回（Bettor 更正）**：v0.1.1 把当前 watchdog/mining-watchdog-v2/console-supervisor 各按**一个 PID** 记档，隐含"只有一套实例在跑"——**这是错的**。地面事实见下方"两套实例"小节，本表已按两套实例重写。

| 消费者 | 证据 | 说明 |
|---|---|---|
| kaspad（TN12） | 现 PID 16644（**只有这一个**，两套 watchdog 实例里先注意到它缺失的那个把它拉起来，另一个"只启不杀"什么也不做），`D:\kaspad-live\db-4d0a9e30\kaspad.exe`，参数见 `scripts/kaspad-watchdog.ps1:47`：`--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=4096` | — |
| kaspad-watchdog **×2** | PID **18576**（Session 0，16:45:38 本地起）+ PID **24220**（Session 1/交互登录，16:45:56 本地起）；`scripts/kaspad-watchdog.ps1` | **只启不杀哲学**——两个都要停，只停一个的话没停的那个仍会在 kaspad 死后 60 s 内把它拉回来 |
| tn12-mining-watchdog-v2 **×2** | PID **13788**（16:48:23 本地，随 Session 0 那遍完成）+ PID **19532**（16:48:24 本地，随 Session 1 那遍完成）；`D:\kaspa-tn12-mining\tn12-mining-watchdog-v2.ps1` | 三态判定（OWNED_RUNNING/CONFIRMED_ABSENT/UNKNOWN_OR_CONFLICT），tips≥220 brake；同样只启不杀；两个都要停 |
| stratum-bridge | 由某一个 mining-watchdog-v2 实例拉起（哪个尚未逐一核实），`D:\rusty-kaspa-tn10-build\release\stratum-bridge.exe`，配置 `D:\kaspa-tn12-mining\bridge-tn12-config.yaml`：`kaspad_address: 127.0.0.1:16210`（gRPC 端口），`node_mode: external` | 挖矿桥，连的是 TN12 kaspad 的 gRPC 端口（非 borsh 17210）；正常情况只会有一个实例真正持有它（v2 的 UNKNOWN_OR_CONFLICT 三态判定本就是防双开），但两个 watchdog 都要停才能确认 |
| Startup 自启动项 | `C:\Users\ADMIN\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\KANet-TN12-BootSequence.lnk` → `powershell.exe -File D:\kanet-tn12\scripts\kanet-boot-sequence.ps1` | 五步：①kaspad-watchdog ②等 RPC ready(超时300s) ③tn12-mining-watchdog-v2 ④kanet-start.sh(全栈) ⑤console-supervisor.sh start；**只是两遍触发源之一（Session 1/交互登录那遍），不是全部**，见下方"两套实例"小节 |
| console-supervisor **×2** | 无 Scheduled Task（`Get-ScheduledTask` 对 `*KANet*`/`*Console*`/`*Kaspad*` 查询为空，2026-09-13 实测）；PID **12260**（16:48:23 本地）+ PID **2256**（16:48:24 本地），各自一个**后台 bash 循环**——两个同时探活/自愈同一个 :3200，是冗余风险；非 Windows 任务 | Bettor 问的"KANet-Console-Supervisor 任务状态"= **不存在这个任务，实体是这两个 bash 循环** |

**🔴 两套实例（Bettor 更正，地面事实 = `logs/boot-sequence.log`）**：09-13 09:45Z 重启后，boot-sequence.ps1 **跑了两遍**，不是一遍：
- 第一遍 16:45:38 本地（`=== boot sequence start ===`）→ kaspad-watchdog PID **18576**；
- 第二遍 16:45:56 本地（同样的 `=== boot sequence start ===`，18 秒后）→ kaspad-watchdog PID **24220**；
- 两遍各自继续跑完剩余步骤，分别在 16:48:23/16:48:24 本地完成（各自的 mining-watchdog-v2 与 console-supervisor 两行），两遍完成时间只差 1 秒——两遍应该都是各自等 kaspad RPC ready（step②最长300s），巧合在差不多同一时刻发现 RPC 已就绪。
- **对照**：09-13 07:17Z 那次重启，boot-sequence 只跑了**一遍**（14:45:11 本地，PID 23280，与 ledger (1004) 记的一致）——两次重启行为不同，原因待核（见 §6）。
- v0.1.1 记的 PID 24220 是这两遍里**第二遍**（Session 1/交互登录、走 `.lnk`）的 kaspad-watchdog，**不是唯一一个**，v0.1.1 把它当成"kaspad 的父进程"这个框架本身不完整——已撤回，改成上表的两套实例记法。

**当前 kaspad（PID 16644）进程命令行（Codex 3358c4ff / ledger (1007) 裁定：从此"D-c/D-d 在跑"只认运行进程命令行，不认脚本文件本身或历史验收记录，本条按此要求记档）**：
- 🔴 **本次记档失败，原样记录失败原因，不冒充成功**：`Get-CimInstance Win32_Process -Filter "ProcessId=16644"` 与按 `Name='kaspad.exe'` 查询，`CommandLine`/`Path` 字段均返回**空**；进一步核实 `SessionId=0`（非交互式会话，通常是提权/服务级上下文），我当前是非提权交互会话（`desktop-da9qq46\admin`，与 console/17428 等已知 SYSTEM 级进程同一权限边界问题，见记忆），**结构性读不到**，不是漏查。
- **改用证据（Bettor v0.1.2 裁：日志链 + 脚本 mtime，非猜测参数字符串）**：`scripts/kaspad-watchdog.ps1` 的 mtime（`git log` 最近改动 09-06 22:55Z，早于两个 watchdog 实例 09-13 16:45Z 的起动时间，且期间文件未改）⇒ 无论是哪个实例（18576 或 24220）拉起了 16644，它读到的都是同一份 `:47` 现值——运行参数 = 脚本 :47 现值，逻辑链完整（文件在进程起动前已定、期间无改动、两个实例读同一份文件），比 v0.1.1 单纯"脚本参数字符串"的说法多了 mtime 时序证据，但仍**不是从进程本身直接读出**，跟 Codex 3358c4ff 字面要求的"运行进程命令行"仍有一层推断距离——这层距离本 runbook 认为可接受（同一文件、无改动窗口），最终是否够格由 NWT/Codex 复审判。
- **待办**：若仍要从进程本身直接验证，需要 J1/Bettor 提权读一次 `Get-CimInstance Win32_Process -Filter "ProcessId=16644" | Select CommandLine`；非阻塞项，本 runbook 按上面的日志链证据推进。

## 2.0 drain 在飞交易（停消费者之前，NWT PUSH-BACK·MUST，GO-1 前不执行）

停节点会让任何"已 submit 但还没链上确认"的交易永远卡在半吊子状态（换节点后没人再去查它的最终结果）；删数据目录后更是连查都查不清。**§2.1 开始前必须先确认下面全部消费者都已 drain（或明确判定为"不会再动、不算在飞"）**：

**v0.1.2（NWT MUST⑥）：下表已扩到 §1.1 全部 11 个 console 内 tick 消费者**，不再只挑 4 个。

| 消费者 | 队列/状态来源 | 查询 | 判据（drained） |
|---|---|---|---|
| P2SH 资金相关 submit（fund/lock、settle、refund、sweep、bshard_*、closezk_v2_*，含 J2 G-1 设计 v0.2 MUST-1 点名的 4 处 `pending.submit` 站点：`kasia-relay/src/lib/p2sh.mjs:306`、`transaction.mjs:226`、`utxo-split.mjs:125/:275`） | 无独立"pending 队列表"——这些是同步调用（提交后立即拿到 txId 或抛错），风险窗口只是"最近提交、还没上链确认"；relay 侧通用出账记录表 `tx_records`（`kasia-console/src/db/migrate.js:86`，`status` 默认 `'broadcasted'`，带 `confirmations` 列，**但本 runbook 未逐一核实这张表是否覆盖全部 4 处调用点，执行前需先核实写路径**） | ① `grep -n "submit\|pending.submit" logs/relay-*.log`（或对应 relay 进程日志）取最近一段时间窗内的提交记录；② 对每个拿到的 txid，查 `kaspa_tx_log`（`migrate.js:1861`，本机嵌入式链上索引器）或 `tx_records.status`，确认已从 `broadcasted` 变为确认态（或明确 `failed`）；③ 或直接用 `scripts/_kanetui_coverify_*.cjs` 式链读模板核对 `outputs_json` | 见下方通用判据 |
| pool-market-settler（`pool-market-settler.js:206`，表 `pool_markets` 列 `protocol_status`） | 无独立"broadcasting"锁列，风险窗口 = tick 内"生成 tx→DB 更新"之间；已知稳定态 `verifying`/`unresolved_needs_authorization`/`disputed`/`cancelled`/`settle_failed` | `grep "\[pool-market-settler\]" logs/console.log \| tail -20`（若有 submit 相关行）+ 对拿到的 txid 查 `kaspa_tx_log` | 见下方通用判据；本 runbook 未找到该文件专属的"N pending"式 tick 汇总行，只能靠日志 grep + txid 交叉核 |
| bettor-prediction-settler（`bettor-prediction-settler.js:41`，表 `exchange_offers`） | 日志行自带计数：`[prediction-settler] tick: N expired, settled=x pending=y errored=z`（`:224`） | `grep "\[prediction-settler\] tick:" logs/console.log \| tail -5` | **`pending` 字段 = 0** |
| bshard-settle-daemon（`bshard-settle-daemon.mjs:1031`，表 `pool_markets`） | 无独立"N pending"式 tick 汇总行；已知终态 `settle_failed`/`settled_partial_claims` | `grep "\[bshard-settle\|settle-daemon\]" logs/console.log \| tail -20` + 对近期 submit 类 txid 查 `kaspa_tx_log` | 见下方通用判据 |
| market-seeder（`market-seeder.js:24`，表 `retail_dex_buy_publications` 列 `state`） | 状态机 `deposited→published`/`refunding→refunded\|failed` | `SELECT id, state, updated_at FROM retail_dex_buy_publications WHERE state IN ('refunding') ORDER BY updated_at DESC LIMIT 20`（`refunding` 是跨链退款中间态，风险最高） | 查询空结果，或结果里每条 `updated_at` 都已过通用判据窗口 |
| pool-market-seeder（`pool-market-seeder.js:52`，表 `pool_markets`） | 日志行：`[pool-seeder] tick: +N market(s), live X→Y/target`（`:186`）；同步创建，非长期挂起队列 | `grep "\[pool-seeder\] tick:" logs/console.log \| tail -5` | 最近一次 tick 之后无新增（`+0`），或新增市场的建仓 tx 已过通用判据窗口 |
| bshard 平仓签名队列（`bshard-close-voter.js:270`，日志标签 `[bshard-close-voter-v2]`） | 日志行本身就带计数：`[bshard-close-voter-v2] tick: N pending \| signed=x refused=y skipped=z errored=w` | `grep "\[bshard-close-voter-v2\] tick:" logs/console.log \| tail -5` | **`pending` 字段 = 0**（本机现状实测：`1 pending`，几笔一直是 `refused`——那是已知的 `frozen_evidence: canonical fetch fail` 弃签行为，非在飞） |
| zk-prove-worker（`zk-prove-worker.mjs:125`，表 `zk_prove_jobs` 列 `status`） | 显式状态机 `pending→in_progress→done\|failed`（`:137-139/:230/:243`） | `SELECT id, status, updated_at FROM zk_prove_jobs WHERE status = 'in_progress' ORDER BY updated_at DESC` | 查询空结果；可交叉核 `zk-prove-job-stuck-alert.mjs` 的告警状态 |
| 退款自动认领（`bettor-refund-claim-auto.mjs:180`，表 `pool_bettor_sides`，列 `claim_txid`/`refund_attempted_at`） | 同步 tick 内提交后立即 `UPDATE ... SET claim_txid=?`；风险窗口极短（一个 tick 内） | ① `grep "\[claim-auto\]" logs/console.log \| tail -20` 看最近是否有 `CLAIMED` 行仍在发生；② SQL：`SELECT id, refund_attempted_at FROM pool_bettor_sides WHERE claim_txid IS NULL AND refund_attempted_at IS NOT NULL ORDER BY refund_attempted_at DESC LIMIT 20` | **⚠ 区分"真在飞"与"结构性死锁"**：8/22 频道已record 一批 95 笔 `claim_txid IS NULL` 且永远进不了授权函数的死锁记录（`J2-CLAIM-DEADLOCK`，protocol_status 全 `refunded` 但候选 WHERE 条件要求 `unresolved_needs_authorization`，两头堵死）——**这类不是"在飞"，等多久都不会变，是另一个已知未解问题，不算本步骤的阻塞项**；真正要等的只是"最近几分钟内 `refund_attempted_at` 有更新但还没落 `claim_txid` 的那几条" |
| Oracle 续期 cron（`oracle-pool-renewal-cron.mjs:212`） | 日志行：`[oracle-renewal] tick: currentDaa=D ...`（`:156/:168/:172`，无"N pending"式计数，逐次全量判断） | `grep "\[oracle-renewal\] tick:" logs/console.log \| tail -5` | 最近一次 tick 行明确是"no renewals needed"/"no local enrollments"，或已续期的最新一笔已过通用判据窗口 |
| Oracle 链扫描 cron（`oracle-pool-chain-scanner-cron.mjs:62`） | 日志行：`[oracle-pool-scanner-cron] tick: snapshotDaa=... scanned=.../valid=.../rejected=...`；只读扫描，本身不提交 tx | `grep "\[oracle-pool-scanner-cron\] tick:" logs/console.log \| tail -5` | 只读消费者，无需等交易确认；停 console 即视为 drained，列出仅为完整性 |
| relay UTXO 再平衡（`broadcaster-utxo.mjs:98`） | 同步 tick，日志行 `[broadcaster-utxo] <relay8> rebalanced N→M (target N) tx=<txid>` + 收尾 `[broadcaster-utxo] tick: N relays, rebalanced=N skipped=N failed=N` | `grep "\[broadcaster-utxo\]" logs/console.log \| tail -20` | 最近一次 tick 收尾行之后，把行里出现的每个 `tx=` 短 txid 前缀去 `kaspa_tx_log` 核实已确认，见下方通用判据 |

**通用判据（v0.1.2 NWT MUST⑥ 钉死，不再留"由执行时定"的空白）**：对上表每一类里出现的 txid（P2SH submit / pool-market-settler / bshard-settle-daemon / market-seeder / pool-market-seeder / broadcaster-utxo），主判据 = **`checkUtxoLanded(address, txid, networkId, minDepth=20)` 返回 `landed:true`**（`kasia-relay/src/lib/p2sh.mjs:1581`，本仓既有惯例：`virtualDaaScore − blockDaaScore ≥ 20` ≈ 20× 实测单块最大间隔·~2.5s@8BPS 的深度，防浅确认被 reorg 退）；**兜底** = 若 `checkUtxoLanded` 因节点已停/不可用而查不到，改用 **30 分钟 wall-clock**（相关 log 行时间戳距当前 ≥30 min 且期间无新提交）作为退而求其次的判据。bshard-close-voter/prediction-settler 的 `pending` 字段必须为 0（这两个有精确计数，不用 minDepth/wall-clock 判据）。全部满足才算 drained，可以进 §2.1。

## 2. 停止顺序（消费者先、节点后；每步给验证命令）

**核心风险（Bettor 点名，须写清）——G-2 自愈对"节点已停但仍被期待可连"窗口的行为**：
G-2（`docs/2026-09-07-j2-g1-g2-node-trust-gate-and-console-rpc-selfheal-design-v0.1.md`，已落地 09-07）的设计是**本机 RPC 连不上 N 次后重建客户端**，且 `KASPA_RPC_LOCAL_ONLY=1` 时**理应**跳过 discovery、直接 fail-closed 报 `no RPC node available`——这本身对"节点已停"是安全的（不会去连别的节点）。**但**当前有一个**未闭合**的已知缺口（NWT/J2 2026-09-13 核实、Codex 9fff92b0 第 2 条确认）：`rpc-health.js` 的 `getWorkingRpc()` 在本机 RPC 失败后**仍会走 `checkConfigured()`**，如果 DB 里配置了某个"已配置的外部 TN12 端点"，LOCAL_ONLY 挡不住这条路 ⇒ **停 TN12 节点后，console 有非零概率悄悄连到别的 TN12 公网节点继续 tick，而不是真正静默**。
⇒ **停节点前必须先核 DB 里有没有配置外部 TN12 RPC 端点**，有则一并清空或改成本机 loopback-only，否则"停节点"不等于"consumer 真的停了"。这条在 (a) LOCAL_ONLY 严格语义设计落地前是**已知未消除的风险**，不是本 runbook 能单独关掉的，只能靠"停之前核实配置"降低。

**v0.1.2（NWT MUST①）现查命令（写死，非"执行时现查"）**：
```sql
SELECT key, category, value_encrypted, is_sensitive, updated_at FROM config_entries WHERE key = 'rpc_url';
```
（`kasia-console/src/services/rpc-health.js:139` `checkConfigured()` 读 `getConfig('rpc_url')`；`kasia-console/src/data/settings/configs.js:6` `getConfig` 的底层查询就是 `SELECT * FROM config_entries WHERE key = ?`；写入方 `kasia-console/src/api/settings.js:27` 固定 `category: 'node'`。）非空且 `value_encrypted` 不是本机 loopback（`ws://127.0.0.1:...` / `127.0.0.1`）⇒ 命中风险，执行时须清空该行（`DELETE FROM config_entries WHERE key='rpc_url'`）或改写成本机地址，再进 §2.1。

### 2.1 停消费者（console + console 侧子系统）
1. 通知频道 + Bettor（不可逆操作前置报备）。
2. 核 DB 有无外部 TN12 RPC 端点配置（见上，风险条款，SQL 已给）。
3. `bash kanet-stop.sh`（会停 console 及其全部子进程/tick，见 §1.1 全表）。
4. 验证：`curl -sf http://127.0.0.1:3200/` 应连接失败（非 200/302）；`netstat -ano | grep :3200` 应无 LISTENING。

### 2.2 停挖矿桥 + mining-watchdog-v2（两套实例都要停，见 §1.2）
1. 先停两个 `tn12-mining-watchdog-v2.ps1` 实例（PID **13788** 与 **19532**，`Stop-Process`）——它们是"只启不杀"，先停才能安全停下游 stratum-bridge 而不被当"死了"重新拉起。
2. 停 `stratum-bridge.exe`（由其中一个 watchdog 拉起的子进程，两个 watchdog 都停后手动确认其已退出或单独停）。
3. 验证：**不要用 `Get-Process -Name tn12-mining-watchdog-v2`**——`.ps1` 脚本在进程表里 `Name` 是 `powershell.exe`，不是脚本名，按脚本名查会永远查到空、把"还活着"误读成"已停"（NWT 在活着的 13788/19532 上实测过这个坑）。改用 `Get-Process -Id 13788,19532 -ErrorAction SilentlyContinue`（就是步骤 1 `Stop-Process` 时已知的那两个 PID）应为空；`stratum-bridge` 是真实 exe 名，`Get-Process -Name stratum-bridge -ErrorAction SilentlyContinue` 可以按名字查，应为空。两处都要确认，不是查到一个就停；各自 `_watchdog.log` 末行应无新 tick。

### 2.3 停 kaspad-watchdog（两套实例），再优雅停 kaspad，taskkill //F 只作兜底（v0.1.2 NWT MUST② 改）

**先停两个 watchdog**（PID **18576** 与 **24220**，`Stop-Process` 各一次）——不先停它们，停 kaspad 后 60 s 内会被其中任一个拉回来；两个都要停，只停一个不够（见 §1.2 两套实例）。

**再停 kaspad，优雅关闭优先，`taskkill //F` 只作兜底**（RocksDB 未刷盘风险——kaspad 源码 `core/src/signals.rs`（本机 `/d/rusty-kaspa/core/src/signals.rs` 已读源码核实）用 `ctrlc::set_handler` 捕获首次中断信号触发 `shutdown()`（应含 RocksDB flush），**若收到第二次信号会直接 `std::process::exit(1)` 强杀**——所以只发一次信号、耐心等，不要连续两次）：
1. **优雅**：`taskkill //PID 16644`（**不带 //F**——Windows 对控制台进程的非强制 `taskkill` 会投递控制台中断事件，触发上面那个 `ctrlc` 处理器），等待最多 60 s。**⚠ 未独立验证的一点（NWT 复审提出）**：kaspad 是被 watchdog 用 `-WindowStyle Hidden` 起的无窗口后台控制台进程，"非 `//F` 的 `taskkill` 能否把控制台中断事件真的送到一个隐藏窗口的控制台进程"本 runbook 没有独立实测确认过——最坏情况是白等满 60 s 信号根本没送到，然后照样落到步骤 3 的 `//F` 兜底，不会卡死，只是可能白等一段时间。
2. 轮询 `Get-Process -Id 16644 -ErrorAction SilentlyContinue`，进程消失即优雅退出成功，跳到步骤 4。
3. **兜底**（60 s 后仍在跑才用）：`taskkill //PID 16644 //F`——**标注风险**：这条路径跳过了 `ctrlc` 处理器的 `shutdown()`，RocksDB 可能有未刷盘的写入，下次起 kaspad 时留意启动日志有无恢复/修复相关提示，异常则升级不要自行处理。
4. 验证：`Get-Process kaspad -ErrorAction SilentlyContinue` 应为空；`netstat -ano | grep :17210` 应无 LISTENING；等 90 s 后再查一次确认两个 watchdog 都没把它拉回来（60 s tick + 余量）。

### 2.4 禁用开机自启动（两个触发源都要处理，否则下次登录/重启整套 TN12 栈会被拉回）

🔴 **v0.1.2 新 MUST（NWT）：本节第 2 点是 GO-1 前置，不是"尽量做"** —— §1.2 已证实 09-13 09:45Z 重启后 boot-sequence 跑了两遍（Session 0 一遍 + Session 1/`.lnk` 一遍），Session 1 那遍的触发源明确（`.lnk`），**Session 0 那遍的触发源尚未定位**（非提权 `Get-ScheduledTask` 查不到，Bettor 在另外查）。只禁 `.lnk` 只堵住其中一个触发源，Session 0 那个不堵，下次重启/登录整套 TN12 栈会被它重新拉回来——**这条不是"最好也做"，是"没做完不能进 GO-1"**。

1. `KANet-TN12-BootSequence.lnk`：改名加 `.disabled` 后缀（同目录已有 `tn10-mining-watchdog.cmd.disabled` 先例，是本仓沿用的禁用记号），**不删除**（保留可回滚）——这一步只堵 Session 1 那个触发源。
2. **🔴 Session 0 触发源必须先定位并禁用，此项未完成前不得进 GO-1**：待 Bettor 提权查明（候选方向：提权 `Get-ScheduledTask`/组策略启动脚本/服务/WMI 事件订阅——本 runbook 不猜测，等实测结果）。
   **提权查询命令（Bettor 已发 Owner，回执贴回后本步骤直接填结果，不用再猜候选方向）**：
   ```powershell
   Get-ScheduledTask | Where-Object {
     $_.Actions | Where-Object { $_.Arguments -match 'boot-sequence|kanet|kaspad' }
   } | Select-Object TaskPath, TaskName, State, @{n='UserId';e={$_.Principal.UserId}}
   ```
   （非提权 `Get-ScheduledTask` 在本会话查不到任何 `*KANet*`/`*Console*`/`*Kaspad*` 任务名——但那是按**任务名**过滤，如果 Session 0 触发源是个改了别的名字的任务，本命令改按**动作参数**内容过滤，能扫到任务名不含关键词但实际调用 boot-sequence.ps1/kaspad-watchdog.ps1 的任务；`Principal.UserId` 一栏用来判断触发身份是 SYSTEM 还是某个用户，帮助判断 Session 0 那一遍到底是谁/什么机制起的。）
3. 验证：下次登录/重启不应再看到 boot-sequence.log 有任何新的 "=== boot sequence start ===" 行（两遍都不该再出现，不是"少了一遍"）。

### 2.5 回滚（任何一步出问题）
- 恢复 `.lnk`（去掉 `.disabled` 后缀）+ 恢复 §2.4-2 里禁用的 Session 0 触发源。
- 重新手动起两套 `kaspad-watchdog.ps1` → 等 RPC ready → 两套 `tn12-mining-watchdog-v2.ps1` → `kanet-start.sh` → 两套 `console-supervisor.sh start`（= boot-sequence.ps1 的五步，两个触发源各自手动顺序重放一遍）。
- kaspad 本身：若走的是 §2.3 步骤 1-2 的优雅路径，`--appdir=D:/kaspa-tn12-data` 数据目录应正常，watchdog 拉起后直接从原状态继续；**若走了步骤 3 的 `//F` 兜底**，重启前留意 kaspad 启动日志有无 RocksDB 恢复/修复相关提示，异常升级不自行处理。

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

1. **GO-1（本 runbook 整体执行前）**：Owner 看过本 runbook + NWT 红队审结论，终端单点确认可以开始 §2.1。**v0.1.2 新增硬前置**：§2.4 的 Session 0 触发源必须已定位并有禁用方案，否则不得进 GO-1（禁用 `.lnk` 只堵一半）。
2. **GO-2（§2.3 停 kaspad 前，若与 GO-1 分开要）**：TN12 停节点是本次唯一真正不可逆的"服务中断"动作（消费者/挖矿桥停止都可随时重启复原，节点数据本身不删），若 Owner 想在这一步再确认一次可单独设卡；默认并入 GO-1，除非 Owner 要求拆开。
3. **GO-3（§4 起主网节点前）**：确认 §4.2 的 `D:\kaspa-mainnet-data` 陈旧内容已判断清楚（复用或清空）之后再起。
4. **GO-4（独立、晚于本 runbook）**：删除 `D:\kaspa-tn12-data`（§3）——主网节点同步完成后的第二次 GO，与本 runbook 执行无关联时间点，另开一次报备。

## 6. 待核实/未完成（本页故意留白）

- §4.2 `D:\kaspa-mainnet-data` 旧内容具体是什么、能不能复用——执行前必查，本 runbook 不代查。
- §4.4 主网 IBD 预计时长——无可引用坐标，等 J2/官方文档。
- pinned silverc 确切路径——待 J2/NWT 核对（确定不在 `D:\kaspa-tn12-data` 内，不影响 §3 删除范围判断）。
- §1.2 kaspad 16644 的真实运行进程命令行——非提权查询结构性读不到（`SessionId=0`），本 runbook 改用 boot-sequence.log + 脚本 mtime 的日志链证据顶上（v0.1.2），若仍要从进程本身直接验证需 J1/Bettor 提权，非阻塞项。
- §2.0 `tx_records` 表是否覆盖 `p2sh.mjs`/`utxo-split.mjs` 全部 4 处 submit 调用点的写路径——本 runbook 未逐一追踪代码确认，执行前应核实，不确定则以 relay 日志 grep + `kaspa_tx_log` 交叉核对为准。
- **🔴 §2.4 Session 0 触发源尚未定位（v0.1.2 新增，GO-1 硬前置，见 §2.4/§5 GO-1）**——提权查询命令已给（§2.4 步骤 2），Bettor 已转 Owner 跑；**Owner 回执贴回后直接填 §2.4 步骤 2，不用再等其他排查**。
- **§6 待核（v0.1.2 新增）：09-13 两次重启行为不对称，原因未知**——07:17Z 那次重启 boot-sequence 只跑了一遍（14:45:11 本地，PID 23280），09:45Z 那次跑了两遍（16:45:38 本地 PID 18576 + 16:45:56 本地 PID 24220，相隔仅 18 秒）。Bettor 猜测"当时 Owner 登录态触发 `.lnk` + 系统级触发叠加"，本 runbook 未独立验证这个猜测，只记录现象：两次重启的触发路径数量不同，且第二次的两遍触发时间相隔极短（18 秒），更像是两个独立触发源几乎同时命中，而不是同一触发源重复了一次。
