# J2 · console 主进程 IBD 期内存增长 只读诊断（2026-08-30）

> **Status**: DRAFT v0.1 · 给 NWT 审 · 未 commit · Bettor 派工 2026-08-29 23:47Z（只读、不改码、不重启、不碰 watchdog/supervisor）
> **对象**: `:3200` console 主进程 pid **16140**（2026-08-29 18:56Z 由 supervisor 拉起）· 方法 = `docs/kanet-investigation-methodology.md` 第 0–6 层
> **一句话**: 涨的**不是 JS 堆、不是 relay 子进程、不是 RPC 连接数**，是 **kaspa-wasm 线性内存**（`__wasm.memory.buffer.byteLength`）——单调、阶跃式（每 6–31 min 一个 15–45 MB 台阶）、0.39→0.46 GB/h；该内存 **硬顶 4 GiB**（wasm32、模块未声明 max）且**只增不减**；撞顶 = `memory.grow` 失败 = Rust panic `unreachable` = 实例毒化（8/05 劣化签名）。**READY（~91 h）前必须有序重启，且不止一次**：以 **wasmBytes 阈值**驱动（≥3.2 GB 起动），按现斜率首次 ≈ **02:40Z 8/30**，之后每 ≈6–7 h 一次。
> **台阶的载体（时序指认，机制未闭合）**：`preprune-capture-worker`（`index.js:861` 无条件启动、无开关）每 tick 对 177 个 `side_lock_daa IS NULL` 的盘各做一次主进程内 **最多 10,000 次 `getBlock({includeTransactions:true})` 反向 walk**（`trade-protocol-filter.js:1219-1233`），一 tick ≈ 9–12 min、≈1.77M 次 RPC、IBD 期 `recaptured=0` 结构性必败；**22 个台阶全部落在该 tick 结束行之后 0–3.4 min**（§4.5）。它是主进程里唯一量级够大的 wasm 流量（其余周期路径合计 <1k 次/tick）。**但**同形在隔离进程逐字复现 8 轮（含压堆 388 MB + `--max-old-space-size=4096`）仅 +0.4 MB 持平 ⇒ 增长是它与 console 内其它状态的相互作用，只读手段到此为止；闭合机制需 in-situ 差分埋点或一次 A/B（§8）。

---

## 0. 外部 service（第 0 层）

- kaspad（pid 35384，IBD 中，daa 80.59M）：`kaspad-stdout.log` 无 RPC 侧错误；p2p `connection reset from peer 70.17…`（01:54+07）与本题无关。
- console.log 当前进程：`RuntimeError` 0 / `memory access out of bounds` 0 / `Offset is outside the bounds of the DataView` 0；裸 `unreachable` 72 条全是 `[relay:*] [ingest] Console unreachable` 与 settle-daemon 业务行 `unreachable=7[...]`（**误命中源，见 §6 签名串排除式**）。
- ⇒ 第 0 层 clean，进内部六层。

## 1. 场景（第 1 层）

| 读数（00:12Z 8/30，CIM/`process.memoryUsage`） | 值 |
|---|---|
| console main Private / WS | 2332 MB / 236 MB（23:50Z 曾 2681 / 613 —— 降的是 V8 堆 191→65 MB + OS 修剪工作集，**不是** wasm 回落） |
| 35 个 relay 子进程 Private 合计 | 4819 MB（23:50Z 4780；23 min +39 MB / 35 个 ⇒ 可忽略，**不是本题**） |
| kaspad Private | 19.5 GB（稳） |
| 系统 commit | 60.6 / 99.6 GB |
| 主进程 → `:17210` 套接字 | 4 ESTABLISHED（settle-daemon 单例 `bshard-settle-daemon.mjs:74` + 3 条同批端口 56486/56487/56489，见 §5.2）+ 1 CloseWait ⇒ **不是连接泄漏** |

## 2. 真实数据（第 2 层）—— 仪器 = 既有 `[diag:heap-sample]`

仪器：`kasia-console/src/lib/eventloop-lag-heartbeat.mjs:59`（每 ~60 s 一行）+ `:44`（每次 lag>1 s 一行），字段 `wasmBytes` 来自 `kasia-console/src/lib/utxo-fetch-allocation-probe.mjs:53`（8/10 加，直读 `kaspaWasmInternal.__wasm.memory.buffer.byteLength`）。178 个样本，19:07Z→00:12Z：

| 字段 | 19:07Z | 23:47Z | 00:12Z | 结论 |
|---|---|---|---|---|
| heapUsed / heapTotal | 346 / 433 | 70 / 191 | 55 / 65 | **平**（GC 正常，major GC 每几分钟一次） |
| rss | 731 | 587 | 236 | **平/降**（被 OS 修剪） |
| external | 45 | 1879 | 2066 | 单调涨 |
| **wasmBytes** | **40.6** | **1869.8** | **2061.9** | **单调涨 = external 的全部**；19:07→23:47 **0.39 GB/h**，23:47→00:12 **7.7 MB/min = 0.46 GB/h** |
| utxoFetchCalls | 11 | 682 | 746 | 见 §4.1（无关） |

**形态**（`scratchpad/jumps.txt`，用 heap-sample + lag 两类行做秒级序列，阈值 ≥15 MB）：22 个台阶，每个 **15–45 MB**，在 **15–60 s** 窗内完成，间隔 **6–31 min 不规则**（均值 ~14 min）；台阶之间底噪 1–3 MB / 1.5 min。台阶窗内 event-loop lag 告警均 38.6 次（非台阶窗 5.4 次）—— 台阶发生时主循环被同步阻塞（单次 4–15 s）。

**Private 读数会被堆/OS 噪声掩盖**（本轮 Private 降 350 MB 时 wasm 涨 190 MB）⇒ 🔴 盯守/告警**必须直接读 `wasmBytes`**，不用 Private/WS。

## 3. 协议（第 3 层）

- 主进程 **无任何 `subscribe*` / `addEventListener` 到 RpcClient**（grep `kasia-console/src` 0 命中，仅 UI `.eta` 的 DOM 事件）⇒ 通知缓冲候选排除。
- 主进程创建 RpcClient 的周期路径：`faucet-utxo-health.mjs:49`（60 s，`finally disconnect()` ✓）、`rpc-health.js:69 checkLocal`（`getWorkingRpc` 5 min 缓存到期时；**超时路径不 `disconnect()`**，§5.2）、`bshard-settle-daemon.mjs:74` 单例长连（出错才重建）、其余为 5 min/1 h cron 或 API 触发。全仓 **0 处 `.free()`**，wasm 对象回收全靠 FinalizationRegistry（`shared/vendor/kaspa-wasm/kaspa.js:8324`）。
- `getBlockAtDaa` 反向 walk（MAX_WALK=250,000）**跑在 relay 子进程**（`bshard-settle-daemon.mjs:158 relayPost → kasia-relay/src/rpc-listener.mjs:163`），不在主进程 wasm 里。

## 4. 执行逻辑（第 4 层）—— 候选逐条证伪

### 4.1 与 `getUtxosByAddresses` 无关（Bettor 候选"kaspa_tx_log/链读"族）
694 次调用全部 `addrCount=1`、`entries ∈ {0,1,13}`、0 次 THREW；按采样间隔分组：0 次调用的间隔 **6.33 MB/min**，≥8 次 6.03，1–2 次 7.08 ⇒ 无相关。

### 4.2 独立进程只读复现（`scratchpad/wasm_*_probe.mjs`，同一 `shared/vendor/kaspa-wasm`，只读 RPC，不连私钥不广播）

| 形 | 规模 | wasm 增量 | 判 |
|---|---|---|---|
| `new RpcClient→connect→getBlockDagInfo→disconnect`（不 free） | 15 次 | +0.3 MB | 阴性 |
| 同上 + `free()` | 15 次 | +0.2 MB | 阴性 |
| 一客户端 `getUtxosByAddresses`（faucet, 13 entries） | 15 次 | +0.1 MB | 阴性 |
| 一客户端 `getBlockDagInfo`+`getServerInfo` | 15 次 | 0 | 阴性 |
| **空闲长连** | 150 s | **0** | 阴性（settle-daemon 单例形） |
| **反向 `getBlock` walk**（relay 的 walk 形） | 20,000 次 | **3 B/call**，gc 后再 10,000 次 **0 B/call** | 阴性 |
| 10 个 relay 地址（含千级碎片 UTXO 的）并发 `getUtxosByAddresses` × 30 轮 | 300 | 前 10 轮 **+32 MB**、再 10 轮 +8、后 10 轮 **0**（GC 后复用）；并发 info ×120 = 0 | 大结果集有 ~270 B/entry 的 wasm 成本但可回收；console 里 probe 记录的 694 次最多 13 entries ⇒ 不是这条 |
| `new Address` / `ScriptBuilder.fromScript(2119 B redeem).p2sh` / `XOnlyPublicKey.toAddress` / `new Transaction(1in 2.2 KB sig, 2out covenant)` 各 2000/300 个 **不 free 持引用** | — | 0 / **2.2 KB/obj** / 0 / 0 | ScriptBuilder 有成本 |
| 同上 **gc 后再建同量** | — | **全部 +0.0 MB（内存被复用）** | ⇒ FinalizationRegistry 回收有效，**"包装器不 free 堆积"假设证伪** |
| 同上 显式 `.free()` | — | +0.0 | — |

⇒ 结论：**RPC 客户端本身（生命周期/调用/空闲/walk/并发）与常见 wasm 对象都不产生台阶**；台阶源在 console 主进程独有的、我在独立进程里没复现到的路径。

### 4.3 时序富集（22 个台阶窗 vs 全部非 relay 日志 tag）
- 无任何 tag 覆盖 22/22。5 min 族 tick 覆盖 pool-settler 11/22、prediction-voter 13/22、settle-daemon pre-gate 9/22（按 15–60 s 窗的随机期望 ≈2/22 ⇒ 富集 ×4–6，但**共现≠因果**）；30 s 的 bshard-close-voter-v2 15/22 = 频率期望值内，不作证据。
- 已证伪（时间戳/覆盖率直接不对齐）：`[claim-auto]`（5 min，19:12/19:20 跑了无台阶）、`[rpc-health] checkLocal`（71 次仅 1 次在窗内）、`[zk-autonomy]` judge-propose tick（25 次，与台阶偏移 −442…+902 s，仅 2 次在窗内）、settle-daemon pre-gate（IN 14 / 60 s 内 34 / 远 252）、relay 子重启（窗内 0）、**长 tick**（poolSettlerTick 最长 51 s / 25 s / 14 s 均不在台阶窗；台阶窗内 settleDaemonTick 0.1–15 s 无规律）。
- 🔴 撤回一条中间误判：曾把 `[diag:interval-lag] _refundInterval gap=300488ms` 读成 300 s 事件循环阻塞——那是 5 min 定时器的漂移行，非阻塞。

### 4.5 台阶 ↔ `preprune-capture-worker` tick 边界（时序指认）

worker：`kasia-console/src/services/preprune-capture-worker.mjs`（`TICK_MS=60 s`，`_running` 防重入，行 96-126），每 tick `recaptureSideLockDaaForMarket`（`pool-market-settler-v06.mjs:420-446`，把 `deadline_daa` 作 `approxDaaHint`）→ `captureSideLockDaa`（`trade-protocol-filter.js:1184-1262`）：`new RpcClient`（:1189）→ `kaspa_tx_log` 未命中 → `_resolveStartCursor`（hint 在 `spc_daa_index_coverage` 内才用索引锚，否则从 `sink` 起）→ `_scanBackwardForTx` **`MAX_STEPS=10000` 次 `getBlock({includeTransactions:true})`**（:1219-1233）→ 找不到 → `disconnect()`。日志只在 tick 末打一行 `tick: scanned=177 … recaptured=0`。

- 本进程 29 个 tick 结束行（由相邻 diag 行定时）：19:25:22、19:43:29、19:55:05、20:05:18、20:17:27、20:26:40、20:40:32、20:48:58、20:59:48、21:08:20、21:20:43、21:29:11、21:39:12、21:51:17、22:01:22、22:10:28、22:18:52、22:29:25、22:38:42、22:47:44、22:57:02、23:03:11、23:11:15、23:19:12、23:26:48、23:35:45、23:44:14、23:52:32、00:01:15 ⇒ tick 长 6–18 min（中位 ~10 min）。
- 22 个台阶窗起点距**前一个** tick 结束行：+2.0 / +1.2 / +1.0 / +0.7 / +2.6 / +1.1 / +1.0 / +3.4 / +0.3 / +1.0 / **0** / +0.5 / +0.8 / +0.7 / **0** / +0.7 / +1.0 / +0.5 / **0** / +2.3 min（首个 18:56 台阶在 boot 期，无前置 tick）⇒ **全部在 tick 边界后 0–3.4 min 内**，无一例外落在 tick 中段。
- 规模：177 盘 × ≤10k 步 × 0.4 ms/步（独立进程实测）≈ 10–12 min = 实测 tick 长 ⇒ 每 tick ≈ **1.77M 次 `getBlock`**（主进程内），是主进程 wasm 流量的 >99.9%。
- 为何结构性必败（DB 只读）：`pool_bettor_sides.side_lock_daa IS NULL` 共 **33,149 条 / 1,575 盘**，盘 `deadline_daa` 28.4M–840.7M；`spc_daa_index_coverage` 8,187 段覆盖 **56.98M–80.90M** ⇒ 覆盖外的盘退化为从 tip 反向 10k 步（≈2 万 DAA），而 bet 在几千万 DAA 之前 ⇒ 永远 `no-block-hash`；覆盖内的盘在 IBD 期 `getBlock` 旧块也拿不到。**每分钟重来一遍。**
- 🔴 隔离复现阴性（§4.2 末两行）：8 × (new RpcClient + 10k `getBlock(tx)` walk + disconnect) = +0.4 MB 后 0；加 388 MB 常驻堆 + `--max-old-space-size=4096` + 每步留 JS 垃圾 = 同样 +0.4 MB 后 0 ⇒ **walk 本身、连接生命周期、GC 节奏三者都不足以复现**；console 内的增长需要与其它常驻 wasm 状态/并发路径相互作用（碎片化或真泄漏，现有仪器分不开）。

### 4.4 未覆盖/未指认
- 主进程独有且未在独立进程复现的 wasm 路径：`bshard-close-transport.mjs:411-425`（`new Transaction` 带 `utxo` 条目 + `serializeToSafeJSON`；judge-propose 每 tick ≤5 次）、`settle-safe-json.mjs:37`、`prediction-escrow-ss.mjs:152-155`、`bshard-close-enforce.mjs`（J1 lib）、`coord-status-sign.mjs:91 verifyMessage`、`Resolver`（`rpc-health.js discoverNode`，本进程仅 3 次）。**每条单看都是 KB 级**，凑不出 15–45 MB 单台阶——除非某处在循环里做了成千上万次；这正是需要 §7 埋点而不是继续猜的原因。
- 台阶大小 15–45 MB **不是** `memory.grow` 粒度（独立进程实测 grow 以 0.1 MB 级增长 = 64 KiB 页），是真实的一次性/几十秒内密集分配；grow 后线性内存永不归还，但已释放的块**会被复用**（§4.2 gc 后 +0.0）⇒ 单调增长 = **真泄漏或碎片化**，二者用现有仪器分不开。

## 5. 数据流向（第 5 层）

### 5.1 增长最终落在哪
`kaspa-wasm` 单实例（`shared/vendor/kaspa-wasm/kaspa_bg.wasm`，`memory[0] min=62 pages max=NONE`，导出非导入 ⇒ 进程内唯一）。`WebAssembly.Memory` 只能 `grow`，**无 shrink API** ⇒ 与 8/05 memory 档案"只有换进程"一致。

### 5.2 次级缺陷（顺手抓到，非本题主因，报备不动码）
- **`rpc-health.js:62-92 checkLocal` 超时路径漏 `disconnect()`**：`Promise.race` 超时 ⇒ `catch` 直接 return false，RpcClient 既不 disconnect 也不 free；本进程日志 3 条 `local node TCP ok but data check failed: timeout`（L2623/2625/2627）↔ 主进程恰有 3 条同批端口的 ESTABLISHED 到 :17210（56486/56487/56489）。空闲连接本身不涨内存（§4.2），但是句柄泄漏。
- **zk judge-propose tick 在 IBD 期每 12 min 让 relay 做 6 次 250k 反向 walk**（events 表 `zkJudgeProposeTick_judge/endblockhash: getBlockAtDaa: backward walk exhausted MAX_WALK=250000`，同 6 个盘每 tick 重复；每次 ~2 min）——settle-daemon 有 pre-gate（`bshard-settle-daemon.mjs:553`）而 `zk-autonomy-ticks.mjs` judge-propose 路径没有同款闸 ⇒ relay+kaspad 在 IBD 期持续吃 CPU/IO 做注定失败的 walk。与内存无关，单列。

## 6. 存储（第 6 层）与撞顶签名

- 撞顶前：`wasmBytes` 单调趋近 **4096 MB** 后**停住不变**（这本身是签名：`wasmBytes ≥ 4000 ∧ 10 min 不变`）。
- 撞顶后 console.log 逐字串（**排除式**，避开 settle-daemon 业务行与 relay 行）：
  ```bash
  grep -a -E "RuntimeError|unreachable executed|memory access out of bounds|outside the bounds of the DataView|table index is out of bounds|could not allocate" logs/console.log | grep -a -v "unreachable=\|^\[relay:"
  ```
  当前基线 **0**。撞顶后 console 大概率仍活（curl `:3200` 200、心跳文件在写）但链读毒化；首个 caller 会是当时过 wasm 的路径（本进程最可能 `[faucet-health]`（60 s）/ `[rpc-health]`；8/05 是 `[broker-fee-emit]`）。DB 侧同步信号：`events.rpc_health_check_failed` 每分钟 1 条起（2026-08-29 00–04h 已有 61/h 的先例）。

## 7. 判断：若不修，READY 前是否必须有序重启、最晚时点

- **必须，且不止一次。** 硬顶 4 GiB；现 2062 MB @00:12Z，斜率 0.39–0.46 GB/h ⇒ 4 GiB ≈ **04:3x–05:30Z 8/30**；READY 基准 ~91 h ⇒ 不重启必撞顶 ≥10 次量级。
- **触发建议（同意 Bettor 阈值驱动）**：`wasmBytes ≥ 3.2 GB` 起动有序重启（quiesce ingress + drain，`feedback-preshutdown-money-surface…`），**8 h 兜底偏长**：按 0.46 GB/h 从 ~0.05 GB 到 3.2 GB ≈ **6.9 h** ⇒ 兜底改 **6 h** 更稳；首次 ≈ **02:40Z 8/30**（3.2 GB）/ 03:20Z（3.5 GB）。斜率会随 IBD 阶段变（05:20Z 那任活了 8h52m 未撞顶 = 当时斜率更低或被误判，无 wasmBytes 记录不能反证），**以读数为准不用外推**。
- 每次重启后 wasmBytes 从 ~40 MB 起；台阶源不修，周期不变。

## 8. 下一步（需报备批准；1/2 零行为改变，3 是最便宜的机制闭合）
1. **A/B（推荐，借已排定的有序重启）**：`preprune-capture-worker.mjs` 加一个 env 开关（如 `PREPRUNE_CAPTURE_OFF=1` 或 `isSynced=false ⇒ 本 tick skip` 的 IBD 门，镜像 `bshard-settle-daemon.mjs:553` pre-gate 的思路），重启时关掉，看 wasmBytes 斜率是否从 0.4 GB/h 掉到底噪（≤0.1 GB/h）。一行改动、非钱路、非用户面；IBD 期该 worker 本就 100% 无效（§4.5），关掉零功能损失。若斜率不变 ⇒ 载体判断错，回到 2。
2. **per-tick wasm 差分埋点**（同 8/10 probe 家族）：各 `start*Cron` tick 入口/出口读 `__wasm.memory.buffer.byteLength`，打 `[diag:wasm-delta] tick=<name> +N MB`；`captureSideLockDaa` 内再按市场打一行——定位到具体盘/具体步。
3. `rpc-health.js checkLocal` 超时路径补 `disconnect()`（一行，§5.2）。
4. `preprune-capture-worker` / zk judge-propose 两处加"覆盖外或 IBD 期直接 skip"的 pre-gate（设计项，走审；同时解决 relay 侧每 12 min 6 次 250k walk）。
5. 独立进程未跑完的一形：`serializeToSafeJSON` 需 `utxo` 条目的 tx（脚本待补），预期仍为 KB 级。

## 附：证据文件
- `logs/console.log`（当前进程，重启即截断）：`[diag:heap-sample]` 178 行、`[diag:eventloop-lag]` 1.6k 行、`[utxo-fetch-probe]` 746 行。
- 分析中间件（会话 scratchpad，非仓库）：`jumps.txt`（22 台阶秒级窗）、`wasm_rate.txt`、`step_vs_lag.txt`、`wasm_growth_probe.mjs` / `wasm_obj_cost.mjs` / `wasm_walk_probe.mjs` / `wasm_conc_probe.mjs` / `wasm_mem_limits.mjs` 及其输出。需要留档时由 J2 复制进 `docs/provenance/2026-08-30-console-wasm-growth/`（未做，等 NWT 审后一并）。
