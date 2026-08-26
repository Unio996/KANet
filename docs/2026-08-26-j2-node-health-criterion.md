# 节点「真健康」判据 — 与 KANet-UI 探针稿同一把尺(含 (622) tips-reconcile 补答)

> **Status**: DRAFT v0.1 · J2 2026-08-26 主笔 · Bettor 派工 (5)(对等消息) · **待 NWT 审, 与 `docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md` 一起审**。
> **性质**: 只读(采样数据 / 日志 / 源码 / 只读 RPC), 零改码。**判据文档, 不是探针实现**;探针实现归 KANet-UI 稿, 本文只负责"尺子刻度从哪来"。
> **证据标签**: `[MEASURED]` 实测 · `[LOG]` kaspad 日志原文 · `[SRC]` 源码 · `[DESIGN]` 选择。每个阈值带出处, 没出处的数不许进探针。

## §0 一句话

**「真健康」对 KANet 只有一个定义:钱路能【读到】并【写到】链上真相。** 它由六个独立问题合取(§2), 其中 **tips 不在里面**——8/22–23 的 690 条采样证明 tips 在 11 小时里纹丝不动而节点每秒处理 5.3 块(§1);而今天的 `daa=0 / utxos=[]` 证明「RPC 会答」也不在里面——答了、答的是 0、空集不报错(§5)。**KANet-UI 稿的 ALIVE / SYNCING / SYNC-STALLED / DEAD 与本文六问一一对得上(§4), 两稿是同一把尺。**

---

## §1 (622) reconcile 补答:tips = 结构 artifact 成立;真健康 = blocks-processed + DAA 单调 + lag 回落 `[MEASURED]`

**崩机前做到哪**:没做完。ledger (622) 之后无 J2 回复;频道最后一条 J2 消息 08-22T22:10Z;只留了采样数据 `scratch/_j2_dag_watch.jsonl`(690 条, 08-22T15:41Z → 08-23T03:02Z, 每分钟一采, 读 `getBlockDagInfo`+`getServerInfo`)。现在用它补答。

| 量 | 首 → 末(11.35h) | 极值 / 中位 | 读法 |
|---|---|---|---|
| **tips**(`tipHashes.length`) | 4374 → 4345 | min 4312 / max 4422 / 中位 4346 | **11 小时净变 −29,波动 ±55**。与下面三行**零关联**(逐小时:tips ±20 时 DAA 每小时 +2k~+41k 都有) |
| **DAA**(`virtualDaaScore`) | 80,102,450 → 80,319,190 | +216,740 = **5.30/s** | 23 次单采回退(virtual 重选, 幅度小), 趋势严格向上 |
| **blocks**(`blockCount`) | 3,705,282 → 3,922,022 | +216,740 = **5.30/s** | 与 DAA 增量逐采相等 ⇒ 节点在真处理块, 不是空转 |
| **lag**(sink 时间戳落后, min) | 26.2 → 9.2 | max **85.5** / 中位 21.3 | 振荡:每 2–4 小时冲到 50–80 min 再回落(见下) |
| **isSynced**(`getServerInfo`) | — | true **252/690 = 36%** | 与 lag 联动:lag > ~10 min 即翻 false(§2 R5 的源码定义) |

逐小时(UTC):
```
22T15 tips 4374→4356  daa +10142  lag 26→8    sync 19/19
22T16 tips 4360→4414  daa  +3154  lag  8→59   sync 12/60   ← 近停滞 1h
22T17 tips 4378→4334  daa +25213  lag 55→14   sync 31/60   ← 追回
22T19 tips 4359→4337  daa +12587  lag 27→52   sync 17/60
22T21 tips 4357→4324  daa +28447  lag 34→6    sync 11/60
23T01 tips 4360→4353  daa  +2262  lag 31→79   sync  0/60   ← 近停滞 1h(0.6 块/s)
23T02 tips 4350→4335  daa +41620  lag 80→7    sync  8/60   ← 追回(11.6 块/s)
```
**判**:
- **① reconcile 成立**。「tips 跌出 4312~4422 = 成功」这条判据**本来就测不到病**:tips 是持久化 DAG 结构属性(在册:停矿/pulse/重启都不排空), 它在节点健康与近停滞的两个小时里读数一样。**真病是「不处理块」(J1 判据 `Processed 0 blocks`), 已治**;真健康 = `blockCount`/`DAA` 持续增 + lag 回落到 < 10 min + `isSynced` 回 true。
- **② 持久 4342 tips 良性;re-break 风险不在 tips, 在【周期性近停滞】**。数据里有两个整小时只处理 2–3k 块(正常 20k+), 期间 isSynced 全 false、lag 冲 80 min, 然后自行追回。**这个振荡才是要盯的量**;触发阈值见 §6(`blocks/s < 1 持续 30 min` 或 `lag > 60 min`), **不是 `tips > 4500`**。⚠ 这段数据是 J1 8/23 提权重启**之前**的;重启后 (622) 记「IBD 100% + 2h 稳」, 振荡是否消失**未采**——列为 §8 待测。
- 🔨 判据教训:**一个在健康态与病态读数相同的量, 不能做判据**——tips 与「RPC 会答」都是这一族。

---

## §2 尺子:六个独立问题, 各一个字段, 各一个方向 `[SRC]+[MEASURED]`

| # | 问题 | 字段 / 来源 | 方向与阈值 | 何时它会说谎 |
|---|---|---|---|---|
| **R1 进程** | 我们那台 kaspad 在不在 | `Win32_Process Name='kaspad.exe'` (PID, CreationDate);**不用 CommandLine**(SYSTEM 进程非提权读 null, KANet-UI 35/35 实证) | 无 ⇒ DEAD;PID 变 ⇒ 记 restarted | 有进程 ≠ 活:8/23 坏库那份进程活着、`Processed 0 blocks and 0 headers` 打了 1,863 行 |
| **R2 口** | RPC 会不会答 | `connect()` + `getInfo()`(超时) | 超时/拒连 ⇒ DEAD | **答了不等于有数据**(§5) |
| **R3 身份** | 是不是 TN12 | `getBlockDagInfo().network === 'testnet-12'` | 不符 ⇒ DEAD:wrong-network | — |
| **R4 进度** | 在不在动 | 单调计数器相对**上次采样**严格增:`blockCount` / `headerCount` / `virtualDaaScore` / `getMetrics.consensusMetrics.nodeHeadersProcessedCount` / `nodeDatabaseHeadersCount` / `diskIoWriteBytes`(兜底) | 任一增 ⇒ 有进度;30 min 零增 ⇒ STALLED | IBD 首阶段(§3-A)前五个全 0 不动, **只有 diskIo 动**(KANet-UI 今日实测) |
| **R5 同步** | 链尖是不是"现在" | `getServerInfo().isSynced` | true ⇒ 同步 | 🔴 **它是时间判据不是进度判据** `[SRC rusty-kaspa protocol/mining/src/rule_engine.rs:125-135]`:`unix_now() < sink_timestamp + difficulty_window/4`(≈ **10 min**)。⇒ 节点在追块但 sink 仍落后 > 10 min 时为 false(8/22 那 64%);全网停链时 sink 不动也为 false(在册:停矿=整链 halt)。**它分不出"我落后"与"链停了"**;要配 R4 |
| **R6 可用** | UTXO 索引能不能查 | `virtualDaaScore > 80,095,687`(8/22 实测 DAA, 单调下界) **且** 阳性对照址 `getUtxosByAddresses([MiningRelay-tn12-new])` 非空 | 缺一 ⇒ 未可用 | 🔴 **今天实测**:IBD 期对持币地址返回 `{"ok":true,"utxos":[]}`, 不报错(§5)。**而 relay 读路径没有任何闸**:`kasia-relay/src/lib/p2sh.mjs:94-103 connectRpc` 直连即查;只有**写路径**有闸(`transaction.mjs:150-151` `getServerInfo().isSynced` 否则 `RPC node is not synced`)。⇒ 读写不对称:写会被挡, 读会静默给空 |

**「真健康」= R1 ∧ R2 ∧ R3 ∧ R4 ∧ R5 ∧ R6。** 少 R6 是 KANet-UI 稿 3.2b 已补的那条(源头就是今天这次实测);少 R4 只看 R5 会把"追块中"判成"死";少 R5 只看 R4 会把"在处理但落后 1 小时"判成"健康"而钱路 500。

---

## §3 IBD 各阶段各读什么 `[LOG 8/22–23 坏库 .1.gz 全序列 + 今日新库]`

日志源:`D:\kaspa-tn12-data\kaspa-testnet-12.corrupt-20260826\logs\rusty-kaspa.log.1.gz`(8/16→8/26 00:18, 含 8/23 J1 修复那轮)与新库 `kaspa-testnet-12\logs\rusty-kaspa.log`(8/26 16:29 起)。时间为本地 +07。

| 阶段 | kaspad 日志原文(去数字) | RPC 读数 | 会动的量 | KANet-UI 稿 `phase=` |
|---|---|---|---|---|
| **A. pruning-point proof + 剪裁点链段 headers** | `Validating level N from the pruning point proof (N headers)`(302 行) → `Downloaded N headers from the pruning point chain segment`(今日 16:39→20:51 共 251k, **≈58k/h**) | `headerCount=blockCount=daa=0`, `isSynced=false`, `sink==pruningPointHash`, `pastMedianTime`=2021 genesis | **只有** `diskIoWriteBytes` 与日志行 | `pp-chain-headers`(今日所在) |
| **B. header 处理** | `IBD: Processed N block headers (N%)` (8/22–23 共 781 行) | `headerCount` 增, `blockCount=0`, `nodeHeadersProcessedCount` 增 | headerCount | `headers-processing` |
| **C. UTXO 集导入** | 🟡 8/22–23 日志里 **grep 不到** `Received … UTXO` 类短语(n=0);源码有 `flow_context.rs:665 on_pruning_point_utxoset_override`。**这一阶段的日志指纹未实测, 列 §8** | 预期 `sink` 从 pruningPoint 移开, `blockCount` 仍小 | 未实测 | (稿里并入 `bodies/utxo`) |
| **D. 块体下载 + 处理** | `IBD: Processed N blocks (N%) last block timestamp: <T>`(4,808 行;**`<T>` 距今 = 真实落后量**) 与 `Processed N blocks and 0 headers in the last 10s (… N UTXO-validated blocks …)` | `blockCount`/`daa` 增(8/23 00:00 段 **10–20 块/s**), `isSynced=false` 直到 sink 时间戳进 10 min 窗 | blockCount, daa | `bodies/utxo` |
| **E. 完成 → 稳态** | `IBD with peer … completed successfully`(8/22–23 共 178 次——**它会反复出现**, 每次追上一段就打一次, 不是"只打一次的终点") ;稳态 = `Processed N blocks and N headers in the last 10s (… N UTXO-validated blocks …)` 且 **UTXO-validated > 0** 持续 | `isSynced=true`(sink 在 10 min 内), daa ≈ 5–11/s(8/22 5.3;J1 8/17 健康窗 11.05) | 全部 | ALIVE(再过 R6) |

**失败指纹(同样来自日志, 探针不读日志但操作员要认得)**:
- `Processed 0 blocks and 0 headers in the last Ns` **连续**(坏库 8/26 那份 1,863 行;8/22–23 也有 1,929 行穿插)= 不处理。单行无意义(IBD 阶段 A 也打它), **持续 ≥ 30 min 且 R4 计数器全不动**才是 STALLED。
- `IBD with peer … completed with error: block is known to be invalid`(坏库 458 次)= **库坏**的指纹, 换 peer 无用, 与 8/26 换库决策一致。
- `IBD … completed with error: timeout expired`(8/22–23 131 次)/ `peer connection is closed`(71)= peer 层, 换 peer 自愈, 不是节点病。
- kaspad-stderr `Failed to create lock file …/meta/LOCK` = 第二个实例撞锁, 是**拉起方**的病(watchdog 误拉), 不是节点的。

---

## §4 三态映射:本文六问 ↔ KANet-UI 稿退码(同一把尺) `[DESIGN]`

| KANet-UI 稿 | 码 | 本文条件 | 备注 |
|---|---|---|---|
| **DEAD:no-process** | 9 | ¬R1 | 唯一该拉进程的形态(稿 3.4 硬闸同意) |
| **DEAD:connect-fail / timeout** | 5 / 4 | R1 ∧ ¬R2 | |
| **DEAD:wrong-network** | 2 | R2 ∧ ¬R3 | |
| **DEAD:empty-data**(收窄后) | 3 | R3 ∧ **R5=true** ∧ daa ≤ 0 | 同意收窄:同步了却没数据才是"数据坏";`daa=0 ∧ isSynced=false` 是 §3-A 的合法态 |
| **SYNCING** | 7 | R3 ∧ ¬R5 ∧ (R4 有进度 ∨ 未超 30 min) | 含稿 3.2b 的 `utxoindex-pending`:R5=true 但 ¬R6 **也**停在 7 |
| **SYNC-STALLED** | 8 | R3 ∧ ¬R5 ∧ R4 零进度 ≥ 30 min | **进度只认 R4 计数器, 不认 lag**(lag 60–85 min 时节点仍在处理, §1) |
| **ALIVE** | 0 | R1∧R2∧R3∧R4∧R5∧**R6** | = 钱路可读可写。写路径的闸 `transaction.mjs:150` 用的正是 R5 同一字段;读路径无闸 ⇒ R6 由探针替它守 |

两稿对不上的地方 = 0;本文对稿的**三条补充**(请 NWT 一起判):
1. **稿 §9-Q1(diskIo 假进度)**:我投**合取** `diskIoWriteBytes↑ ∧ (activePeers ≥ 1 ∨ ibdPeer)`。理由:8/22–23 日志里 `IBD started with peer` 488 次、`timeout expired` 131 次——peer 反复断连时节点仍会写日志/压缩, diskIo 单独会把"无 peer 空转"读成 SYNCING。
2. **R5 是时间判据**(§2)⇒ 单采 `isSynced=false` **不构成任何判定**;稿 3.2 已用"进度 + 30 min 窗"兜住, 建议在稿里**写明 isSynced 的源码定义**, 防下一个人拿单采 false 当死。
3. **(622)-② 的 re-break 触发**换成 §6 的两条(`blocks/s` 与 lag), 从 watchdog/sampler 里**删掉 `tips > 4500`** 这条(它在 §1 数据里对健康/近停滞两态读数相同)。

---

## §5 今日反例:哪些字段在说谎, 谎话长什么样 `[MEASURED 2026-08-26]`

| 读数 | 来源 | 天真读法 | 真相 | 被骗的下游(实存) |
|---|---|---|---|---|
| `daa_score: 0` | relay `chain_get_current_daa_score`(`rpc-listener.mjs:148-152` 读 `getBlockDagInfo.virtualDaaScore`) | "没数据 = 死" | §3-A 合法值 | `kaspad-rpc-probe.mjs:86-89` ⇒ 退码 3 ⇒ watchdog 三次误拉撞 LOCK(KANet-UI 稿 §1.1);`bshard-settle-daemon.mjs:600` `deadline_daa+60 <= 0` ⇒ 0 盘 ripe, `[pre-gate]` 行消失, 看起来像 daemon 停了 |
| `{"ok":true,"utxos":[]}` | relay `get_address_utxos`(`p2sh.mjs:1516`, 无同步闸) | "这地址没钱" | utxoindex 还没建 | 任何链上核脚本——没有 R6 会把 **544k KAS 分片键 pocket 全部读成"钱没了"**(stuck 地图 §5);已在 `scratch/_j2_postibd_chaincheck_20260826/` 用 R6 双闸挡住, 反向臂实测 exit 3 |
| `isSynced: false` | `getServerInfo` | "节点坏了" | sink 落后 > 10 min(可能在追) | 写路径 500 `RPC node is not synced`(正确挡);但若探针据此判 DEAD 则误拉 |
| `tips: 4342` 不动 | `getBlockDagInfo.tipHashes` | "wedge 没解" | 结构残留 | (622) 那条判据 |
| `Processed 0 blocks and 0 headers` 一行 | kaspad 日志 | "不处理 = 死" | §3-A 也打它 | 需持续 + R4 合取 |

🔨 共同形状:**「失败」与「合法的早期态」返回同一个值**。修法不是换字段, 是**每个读数配一个"它什么时候会这样说"的表**(本文 §2 最后一列), 再由合取把它们的盲区互相盖住。

---

## §6 阈值与出处(没出处的数不许进探针)

| 阈值 | 值 | 出处 |
|---|---|---|
| isSynced 时间窗 | ≈ 10 min | `[SRC]` `rule_engine.rs:131-134` `difficulty_window_duration/4`, 注释"Roughly 10mins" |
| R6 DAA 下界 | 80,095,687 | `[MEASURED]` 8/22 14:58Z virtual DAA(Track-A 报告 §2);只许抬不许降 |
| R6 对照址 | MiningRelay-tn12-new `kaspatest:qrys4yax…u34fru` | `[MEASURED]` (623) 链上 11 亿含 10.8 亿单 UTXO;由 env 给(稿 3.2b) |
| 稳态处理速率 | 5–11 块/s | `[MEASURED]` 8/22 采样 5.30/s(带 flap);J1 8/17 健康窗 11.05/s |
| 近停滞 | < 1 块/s 持续 30 min | `[MEASURED]` 8/22T16 与 8/23T01 两段 0.6–0.9 块/s, 各持续 ~1h, 自行追回;30 min 与稿 STALL_MS 对齐 |
| lag 告警 | > 60 min | `[MEASURED]` 8/22–23 max 85.5;健康窗(J1 8/17)lag≈0;60 取两者之间, **只告警不判死**(那两段自愈了) |
| 阶段 A headers 速率 | ≈ 58k/h | `[MEASURED]` 今日 16:39→20:51 251k(KANet-UI 同读 58k/h) |
| STALLED 窗 | 30 min 零进度 | `[DESIGN]` 稿 3.2;本文数据不反对(近停滞段内 R4 计数器仍每分钟 +30~+60, 不会触发) |

---

## §7 与既有判据的关系
- **J1 8/17 `docs/2026-08-17-j1-nodehealth-verdict-artifact.md`**:isSynced 46/46 + DAA 单调 + tips 191–238 = 那时的 ALIVE 样本;本文 §1 是它的反面样本(isSynced 36%、tips 4342)——两份合起来才覆盖"健康"与"处理中但落后"两态。
- **runbook 记忆 `reference-tn12-node-mining-outage-recovery`**「验 isSynced 用 `getServerInfo.is_synced`, 别用 pastMedianTime」:与 R5 一致;本文补的是"isSynced 本身也只是时间判据, 要配 R4"。
- **死螺旋记忆 `reference-tn12-sync-gate-removed-miner-death-spiral`**「lag↑∧tips↑ = 过产;lag↑∧tips 平 = 饥饿」:与 §1 一致(8/22 是 tips 平 + lag 振荡 = 饥饿/落后型, 不是过产), 处置是等/加算力, 不是重启。

## §8 未做 / 待测(诚实边界)
- 阶段 C(UTXO 集导入)的日志指纹与 RPC 读数**未实测**(8/22–23 日志 grep 零命中), 等今日新库走到那一步时采(新库现仍在 A)。
- J1 8/23 重启**之后**的 lag 振荡是否消失**未采**((622) 只记 2h 稳)。
- `getMetrics` 各计数器在 B/D 阶段的实际动态未逐阶段采(KANet-UI 只采了 A)。
- 本文不改探针/watchdog 一行码;不动 kaspad;不给 tips 任何阈值。
- 阳性对照址若被掏空(它是矿址, 会被转出)R6 会假红——探针须把"对照址空"报成 UNKNOWN 而非 DEAD, 并换址(稿已由 env 给)。
