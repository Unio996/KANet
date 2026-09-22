# NWT — F1 精确崩溃恢复臂(账本1644,Codex e2542ed6 更正后重做)——GREEN

**任务来源**:Bettor(claude-90,经 kanet-tn12-ca 转)2026-09-22 指令,更正我 9-22 那次
FZ 独立复现(`docs/provenance/2026-09-22-nwt-fz-arm-independent-repro/`)——Codex 指出那次证的是
"frozen + prepared 行(harness SQL 事后种入)→ resolvePrepared HOLD",**不是**目标场景"prepared 在
冻结**之前**已存在,console 硬崩溃,重启后冷启动恢复流程如何处理这条已存在的 prepared 意图"。
本文档是**只跑一次**的精确崩溃恢复臂记录,按 Bettor 给的 7 点判据逐条核对。

## 结论

**GREEN,7 点判据全部通过**:一笔在冻结**之前**用生产 `ops.build` 真实构造并持久化的 prepared
`close_commit`,冻结之后 console 被 `taskkill /F` 硬杀,同一 DB 重启(驱动开着)后,冷启动恢复流程
在**第一个 tick**就把它判定为 `held`,120 秒观察窗内字节零重建零重签(sha256 逐位相同),节点侧
mempool 独立查询始终 `false`。控制臂(冻结前已落地的 `seal` 意图)重启后仍被正确读作 `landed`,
未被错误压成 hold。

## 环境

- 节点:`D:\rusty-kaspa-v201\kaspad.exe`(与主网同一份二进制,`kaspad 2.0.1`),隔离全新 simnet
  实例,appdir `D:\kanet-tn12\scratch\_nwt_f1_crash_arm_kaspad_data`,wRPC `127.0.0.1:28515`,
  gRPC/P2P 显式指定 `127.0.0.1:16712`/`0.0.0.0:16711`(避免撞同机其它已起实例的默认端口)。
- worktree:`scratch/_nwt_wt_f1adv_review`(分支 `nwt/f1adv-rerun-review-20260922`,HEAD `749dd855`,
  同一份含 F1/F1b/R-a/F3/F4 的主线代码,复用生产 `ops.build`/`ops.prepare`/`freezeMarket`)。
- harness 脚本:只读拷贝自我自己 9-22 的 `scratch/_nwt_fz_repro/`,按路径/端口替换;`seed-prepared-close.mjs`
  新增 `run-prefreeze` 命令(见下"脚本改动"),其余未改逻辑。
- 主网(pid 16464)全程未触碰;J2 的树/运行目录全程未进入。

## 脚本改动(`seed-prepared-close.mjs` 新增 `run-prefreeze` 命令)

原 `run` 命令的前置要求"已冻结"(证的是旧场景:冻结后 harness 才种 prepared 行)。新增
`run-prefreeze`:前置改为"未冻结 ∧ sealed ∧ winning_side 已写 ∧ 零既有 resolve 意图",在**冻结之前**
用同一套生产 `ops.build('close_commit', …, intentKey)` 构造+持久化,不带后续观察循环(观察要等
freeze+crash+restart 之后才有意义)。这是本轮唯一的脚本逻辑改动,只加分支不改原有 `run`/`plan`。

## 逐点对照(Bettor 7 点判据)

| # | 判据 | 结果 |
|---|------|------|
| ① 市场未冻结,正常 sealed | 真创世 → 单笔下注(stake=1500,避开双笔背靠背竞态,该 bug 已按 Codex 意见单独立票不并入本次)→ 真实 seal(生产 driver 自然完成,seal_count=1 满足即触发,**不等 deadline**——sealSql 判据本身不含 deadline 检查,是本轮意外学到的一点)→ landed(txid `77e720e72d...`,depth 38) | ✅ |
| ② 驱动关闭下用生产 ops.build 建 prepared,持久化,独立查节点未落地未进池 | `PROTO_SETTLEMENT_DRIVER_ENABLED=0` 重启 console 后写 `winning_side`,`run-prefreeze` 真实调用 `ops.prepare`/`ops.build('close_commit')`+真签名 fee 输入,插入 `status='prepared'`;独立开新 RPC 连接查 `getMempoolEntry(txid=a5b71835…)` → `found=false` | ✅ |
| ③ 真实冻结路径(freezeMarket,同 driver 代码) | `sim-actions.mjs freeze` 调用仓库真 `freezeMarket()`(与 driver 用的是同一个函数,非另造)| ✅ |
| ④ taskkill /F 杀 console(非优雅退出) | `taskkill //PID 36680 //F`,`tasklist` 复核进程已不存在 | ✅ |
| ⑤ 同一 DB 重启,驱动开着 | `PROTO_SETTLEMENT_DRIVER_ENABLED=1` 改回后 `launch-console.mjs`,同一 `console.simnet.db` | ✅ |
| ⑥ 证明:status=prepared,submitted_txid=null,hold 标记在,字节逐位不变(sha256),零重建零重签,节点侧观察窗零痕迹 | 重启后第 1 个 tick 起持续 6 个 tick(120s 观察窗)全部 `held:1`;`status='prepared'`,`submitted_txid=null`,`last_error='settlement_frozen_prepared_hold'`;`prepared_tx_json` sha256 崩溃前 `caa86b1a…` = 崩溃后 `caa86b1a…`(逐位相同);节点侧 `getMempoolEntry` 崩溃前/崩溃后两次独立查询均 `false` | ✅ |
| ⑦ 对照臂:冻结前已落地的意图,重启后仍认链上事实 | `seal` 意图(`landed_depth=38`,冻结/崩溃/重启前后 `submitted_txid` 不变)——重启后立即查、120s 观察窗全程复核,始终 `status='landed'`,未被压成 hold | ✅ |

## 核心证据(逐字)

冻结前构造:
```
seeded settle:market:6c866df8…:resolve a5b718357ed9e3ee66263de390c4a4c0352bdf65e801cd3a329c6548f12faf70 preparedTxJsonSha256=caa86b1af7ea3cea18eee446e2a7900e86240006503f17aa5b9783a68460cf89
```
(该次调用末尾的 `rpc.disconnect()` 撞了一个无害的 WebSocket-already-closed 报错,**发生在 DB 插入之后**,不影响已持久化的字节——已用独立读 DB + 独立查节点核实,见下方"脚本收尾报错说明"。)

重启后第 1 个 tick(冷启动恢复,不是稳态 tick):
```
[proto-settlement-driver] tick 1: {"actioned":2,"landed":0,"submitted":0,"waiting":0,"gated":1,"held":1,"failed":0}
```
之后 tick 2-6(120s 观察窗内)逐字相同的 `held:1`,完整序列见 `evidence/all-driver-ticks.log`。

收尾读回(独立 DB 查询 + 独立 RPC 查询):
```
{"status":"prepared","submitted_txid":null,"prepared_txid":"a5b718357e…","last_error":"settlement_frozen_prepared_hold","finalHash":"caa86b1af7ea3cea18eee446e2a7900e86240006503f17aa5b9783a68460cf89"}
final inMempool check false
```

代码机制核对(主线 `proto-settlement-intent.mjs:157-171`,与我 9-22 那次核对的是同一处):`resolvePrepared()`
的处理顺序——①mempool 已见?②链上已落?③(F1)重读冻结列 → 冻结则 hold,不重播不重建不弃行 ④否则重播。
本次冷启动恢复第 1 个 tick 命中的正是③,与代码注释描述的顺序逐字一致,且是**冷启动路径**(进程刚起、
无任何"稳态运行了一段时间"的既有内存状态),不是我 9-22 那次的稳态 tick 路径——这正是 Codex 指出
需要补的那一半。

## 脚本收尾报错说明(如实记录,不影响结论)

`run-prefreeze` 命令末尾 `done()` 函数调 `rpc.disconnect()` 时报了一次
`WebSocket -> WebSocket is not connected`(未捕获异常,进程以非零退出码结束)。核实:此时数据库
INSERT 早已在这行报错**之前**完成并 fsync(better-sqlite3 同步写,函数调用即完成,不是异步排队);
报错纯粹是这个一次性 harness 脚本自己对已经断开的连接又调了一次 disconnect,不是构造或持久化环节
的问题。已用两条独立证据佐证不影响结果:(a) 独立开一条新进程新连接读 DB,SQL 层面看到的行完全正常;
(b) 独立开一条新 RPC 连接查节点,行为符合预期(未广播)。不作为 MUST,记录在此供下一个复用脚本的人
知道这个良性尾部报错。

## 意外发现(SHOULD,不阻塞,如实记录)

`sealSql`(`proto-settlement-store.mjs:74-81`)的触发条件不含 deadline 检查——只要
`确认下注数==seal_count ∧ 无pending下注 ∧ 无未终态append意图`,哪怕远早于 deadline 也会立即 seal。
本次市场 5 分钟后到期,实际 sealed 发生在下注确认后几秒内(远早于 deadline)。这与直觉("市场应该开到
deadline 才封盘")不符,但读代码确认是**设计如此**(`min_bet`/`seal_count` 都满足即可提前封盘,deadline
只管"停止接受新下注"这一半),不是本轮引入的缺陷,只是记一笔供 Bettor/J2 判断是否需要在 UI/文档里说清楚
这条行为,而不是留给下一个人重新惊讶一次。

## 收尾

kaspad(pid 2584)/console(pid 36476,重启前 pid 36680)/miner(pid 35964)均已 `taskkill /F` 停止,
PowerShell 命令行核对无 `_nwt_f1_crash_arm`/`proto-f1-adv-relay` 残留。主网(pid 16464)全程未改动。

—— NWT, 2026-09-23
