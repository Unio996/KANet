# 节点「真健康」判据 — 与 KANet-UI 探针稿同一把尺(含 (622) tips-reconcile 补答)

> **Status**: DRAFT v0.3 · J2 2026-08-26 主笔(v0.2 = §9 吸收 NWT F-A/F-B/F-C; v0.3 = §10 KNOWN 残余 per-query unwrap_or_default + 二源交叉纪律) · Bettor 派工 (5)(对等消息) · **待 NWT 审, 与 `docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md` 一起审**。
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
| **SYNC-STALLED** | 8 | R3 ∧ ¬R5 ∧ **共识计数器**(`blockCount`/`headerCount`/`virtualDaaScore`/`nodeHeadersProcessedCount`/`nodeDatabaseHeadersCount`)零进度 ≥ **60 min** | **统一修法(Bettor 2026-08-26 裁, 两稿同落)**:`diskIoWriteBytes` **永不抑制 STALLED**, 只调告警节奏;进度只认共识计数器, **不认 lag**(lag 60–85 min 时节点仍在处理, §1)、不认 diskIo(卡死 IBD 挂 idle peer + compaction 持续写盘可同时满足 diskIo↑∧peer 在, NWT 反例) |
| **ALIVE** | 0 | R1∧R2∧R3∧R4∧R5∧**R6** | = 钱路可读可写。写路径的闸 `transaction.mjs:150` 用的正是 R5 同一字段;读路径无闸 ⇒ R6 由探针替它守 |

两稿对不上的地方 = 0;本文对稿的**三条补充**(请 NWT 一起判):
1. **稿 §9-Q1(diskIo 假进度)**:我原投合取 `diskIoWriteBytes↑ ∧ (activePeers ≥ 1 ∨ ibdPeer)`——**NWT 判 PARTIAL**:"卡死 IBD 挂着 idle peer + compaction 持续写盘"能同时满足合取。**采统一修法**:diskIo 永不抑制 STALLED, STALLED 由共识计数器 60 min 零进度硬判, diskIo 只调告警节奏(§4 表已按此改)。⚠ §3-A 阶段共识计数器全 0 不动 ⇒ 全新库 header 下载期**必然在 60 min 后报 STALLED**——这是**已知且可接受的假阳**(STALLED 只告警不拉进程), 探针文案里要写明 `phase=pp-chain-headers` 供操作员一眼判。
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
| STALLED 窗 | **60 min** 共识计数器零进度(diskIo 不参与) | `[DESIGN]` Bettor 2026-08-26 统一修法(原稿 30 min);本文数据不反对(近停滞段内共识计数器仍每分钟 +30~+60, 不会触发);§3-A 期为已知假阳(见 §4 补充①) |

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

---

## §9 NWT MUST-FIX 回答(v0.2 · 2026-08-26 · 只读源码, 断言带检出坐标)

**检出坐标**:live 二进制 = 日志 `kaspad v1.1.1-toc.1-7b1e18cc`;`/d/rusty-kaspa` HEAD 在 v2.0.0(`90dbf074`), **但 `7b1e18cc` 在树里(分支 tn10/tn12 含)**, 下列 file:line 全部来自 `git show 7b1e18cc:<path>`, 不是 HEAD。

### F-B:utxoindex 重建期, `getUtxosByAddresses` 是门控还是半建态? `[SRC @7b1e18cc]`

**一句结论:有闸, 但闸只盖「剪裁点 UTXO 集导入 → anticone 块体验证完」这一段;今天的 `[]` 来自这段【之前】的 header 阶段, 那时索引与共识一样"空且自洽", RPC 合法地答空集。重建本身对读者是原子的(写锁), 不会读到半建态;但 RPC 读 helper 会把 store 错误静默成空集。⇒ R6 的牙不能靠节点自己, 必须靠外部锚(DAA 下界 + 对照址)。**

| 层 | 位置 | 行为 |
|---|---|---|
| RPC 闸 | `rpc/service/src/service.rs:697-703`(`get_utxos_by_addresses_call`) | `!config.utxoindex ⇒ NoUtxoIndex`;`async_is_consensus_in_transitional_ibd_state() ⇒ Err(ConsensusInTransitionalIbdState)`。**是报错, 不是空集**——这段窗口里探针会拿到错误, 是好事 |
| 闸的定义 | `consensus/src/model/stores/pruning_meta.rs:83-85` | `transitional = !anticone_fully_synced ∥ !pruning_utxoset_stable ∥ !pruning_smt_stable` |
| 闸何时升起 | `consensus/src/consensus/mod.rs:468 intrusive_pruning_point_store_writes` → `:506-515`:两个 stable 标志置 **false** + `body_missing_anticone` 置非空, **与写入新剪裁点同一 batch**(注释:防中途崩溃) | = 开始导入剪裁点 UTXO 集(§3-C)那一刻 |
| 闸何时放下 | `mod.rs:1149 import_pruning_point_utxo_set` 完成后 utxoset 标志回 true;`:1504-1506` anticone 块体验证完置空 | = §3-C/D 之交 |
| **闸不盖的段** | 标志缺省值:`pruning_meta.rs:63-66` anticone 缺省空、`:79-81` smt 缺省 **true**(注释"upgrading nodes had no SMT state");`mod.rs:352 consensus_transitional_flags_upgrade` 把缺省写回 | ⇒ **全新库在 header 阶段(§3-A/B)不是 transitional** ⇒ 闸不拦 |
| 索引在那段的状态 | `indexes/utxoindex/src/index.rs:37-45 new()`:`!is_synced() ⇒ resync()`;`:115-137 is_synced` = 索引 tips == 共识 virtual parents;`:144-186 resync` = `delete_all` 后按 2048 一批从共识 virtual UTXO 重建 | 全新库共识 virtual UTXO 集为空 ⇒ resync 得到**空索引**, tips 一致 ⇒ `is_synced()=true` ⇒ **"已同步的空索引"** ⇒ 任何地址答 `[]`(今日实测) |
| 半建态可能吗 | 读:`indexes/utxoindex/src/core/api/mod.rs:73-74` `spawn_blocking(self.inner.read()…)`;重建:`index.rs:213-219 handle_consensus_reset` → `utxoindex.write().resync()` | **写锁包住整个 delete_all+重建** ⇒ 读者在重建期间**阻塞**, 拿到的要么是重建前整体、要么是重建后整体, **没有部分地址有/部分空的中间态**(对读者原子)。`index.rs:141-143` 注释另提"resync 时若共识同时通知 diff 可能 corrupt db"——那是写侧一致性风险, 不是读到半建态 |
| 🔴 第二个静默点 | `service.rs` helper `get_utxo_set_by_script_public_key`(`:～745-755`):`.await.unwrap_or_default()` | **store 层任何错误 ⇒ 空集, 不报错** ⇒ 与今日同形的第二个"失败像合法答案" |
| `isUtxoIndexed` | `service.rs:495` `is_utxo_indexed: self.config.utxoindex` | **是配置开关不是建成状态** ⇒ 不能用它交叉判"索引建好没" |
| `isSynced`(getInfo) | `service.rs:496` `is_sink_recent_and_connected` = `has_peers ∧ sink 时间戳 10min 内`(`rule_engine.rs:117-119,125-135`) | 与 §2 R5 一致, 且含 peer 条件 |

⇒ **R6 的牙**:节点侧只在 transitional 窗口给错误(探针要把 `ConsensusInTransitionalIbdState` 映射成 SYNCING:`utxoindex-pending`, 不是 DEAD);窗口之外"空且自洽"与"真空"节点自己分不出 ⇒ **DAA 下界 + 对照址是唯一判别器**, 两稿共享定义 **ALIVE ⇔ R1∧…∧R5∧R6**(F-A)。

### F-C:对照址 `[]` 分不出"索引没建好"与"被花光"

- **现成的不可花永久 UTXO:没有。** 查过的候选:① `xzztw`(16B 死 spine)在 DB 里已是 `refunded`(spine `dd61ca48…` 可能已被 maker 退款花掉, IBD 期无法链核)⇒ 不能当永久;② 137 个 `pruned_expired_waived` spine(7/30 链核全为原始 lock 输出未花)——**长期未花但可花**(Owner 批准回收即消失);③ Kaspa 没有"OP_RETURN 永久留在 UTXO 集"这种可证不可花输出可用(未找到, 不声称有)。
- **改法(写进 v0.2, 与 UI 稿同落)**:
  1. 对照不是一个地址, 是**一组 ≥ 2 个互相独立的长期持币址**(env 列表):矿址 `MiningRelay-tn12-new` + 一个 7/30 已链核未花的 pruned spine(被回收时换下一个);**任一非空即过**。
  2. **全部为空时的裁定 = UNKNOWN, 永不 DEAD**;并按下面三条交叉定 SYNCING 子态:`getUtxosByAddresses` 报 `ConsensusInTransitionalIbdState` ⇒ `utxoindex-pending`(确定);`virtualDaaScore ≤ 80,095,687` ⇒ `pre-utxoset`(确定, §3-A/B);`daa > 下界 ∧ isSynced=true ∧ 全空` ⇒ `control-set-drained?` **告警交操作员**(对照集可能真被掏空)。
  3. **不用 `isUtxoIndexed` 交叉**(F-B 表:它是配置开关)。
- 对照址由 env 给、不烤死在码里(UI 稿 3.2b 原则不变)。

---

## §10 v0.3 · NWT 终核采纳后的精确说法 + KNOWN 残余(2026-08-26)

**R6 的牙没有消失, 是换了位置**(NWT 精确措辞, 采纳):F-B 证明重建对读者原子 ⇒ **A2 对照址非空 ⇒ 整个索引 live ⇒ 各址读得对**——A2 有牙且充分;A1(DAA 下界)只挡 §3-A 的 `daa=0` header 期, 是弱的那一半。⇒ 两稿共享:**ALIVE ⇔ R1∧…∧R5∧R6, 其中 R6 的承重是 A2, A1 是前置粗筛。**

🔴 **KNOWN 残余(探针 / A1 / A2 都挡不住)** `[SRC @7b1e18cc rpc/service/src/service.rs get_utxo_set_by_script_public_key / get_balance_by_script_public_key: `.await.unwrap_or_default()`]`:
它是 **per-query** 的——索引 live 时, **某一个地址的某一次查询**遇瞬时 store 错仍返 `[]`。对照址那次查询非空只证明"索引 live", 证明不了"你这次查的那个地址那一次没撞错"。
⇒ **纪律(写进脚本包与任何钱路关键读)**:
1. **空集必须二源交叉**才能写成 `n=0`:二次查询(间隔 ≥ 数百 ms)+ 第三源(本机 `kaspa_tx_log` 该址是否曾收款, 或直连 kaspad 另一连接)。
2. **只查到一次的空 = `SINGLE_SOURCE`, 不是 absent**;二次查询非空 = `retry-recovered`(把第一次记成"疑似瞬时错", 不丢)。
3. 结果里每个 `n=0` 旁标 `source: double-empty` 与 `txlog_ever_received`, 读的人一眼能判"两次都空、且本机从没见它收过款"与"两次都空、但本机见过它收款(⇒ 真被花光 或 索引仍有问题, 交人判)"。
4. 非空结果不需要二源(空集才是会说谎的那个方向:`unwrap_or_default` 只会把错误变成空, 不会凭空造 UTXO)。

**已落实**:`scratch/_j2_postibd_chaincheck_20260826/_common.cjs` `utxos()`(二次查询 + `kaspa_tx_log` 第三源, 状态 `single-nonempty / retry-recovered / double-empty / SINGLE_SOURCE`);对照集第二址 = pruned 盘 `cn5xn` 的 spine `kaspatest:pzrhg8y8…swe79q`(100 KAS 原始 lock 输出, spine 独占、0 逻辑键注、不在任何 refund/claim 候选), 与 KANet-UI 探针 `KASPAD_PROBE_CONTROL_ADDRS` 同址同尺。
  **出处(逐字, 可 grep)**:① `COORD-LEDGER.md` (112) 2026-07-30 :4930「`33,735 KAS 卡在 137 个 protocol_status='pruned_expired_waived' 的盘里, 而【两侧都是我们自己的】`」+ :4931「`140/140 命中,改 1 sompi ⇒ 0/140`」(**ledger 记的是金额对合约字节的验证, 不含"链上未花"那句**);② "137/137 的 spine UTXO 仍是当初那笔 spine_lock_tx 的原始输出(链上判据)"这句出自 memory `project-stuck-33735-kas-recovery-v07-exit-paths`(2026-07-30T08:45Z, 三方实测记录), **ledger (112) 正文没有它**;③ 逐址产物 `scratch/settle-truth/covenant-funded.json:2315`(2026-07-29~31 只读链查)。⚠ 三者都是 7/30 链态;今天无法复核, UTXO 可用后 `run.cjs 4` 重核。
