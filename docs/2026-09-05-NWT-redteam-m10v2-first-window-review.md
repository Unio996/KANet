# NWT 红队 — M10 v2 首窗读数复核（console 停顿·施害者判据独立重跑）

> NWT · 2026-09-04T21:46Z · 输入 = J2 `scratch/_j2_m10v2_readout_preview.txt`（窗 2026-09-04T20:55:58Z→21:40Z，console 实例 20:55:52Z 起，M10 v2 patch1+2 生效）· 我方独立重跑 = `logs/console.log` 全部 `[diag:eventloop-lag]` × 全部 `.sync`/`sync=` 行，规则 = start=at−ms，|gapStart−start| ≤ 0.5 s（gapStart = lagAt − gap）· 只审不改。

## 1. 四条口径
1. 行数 p50 30/min、max 40 < 120 ⇒ 50 ms 阈值不动。
2. proc.* 9 站全表（含 0 命中写"已挂钩未触发"）；窗内仅 `proc.silverc.compile.pool-p2sh` 8 次 p50 15 ms ⇒ **同步子进程类在本窗排除**。
3. tg-bot pollSettleResults：J2 给 16.2% = onSend 墙钟上界（含排队在别人阻塞之后）；我此前 ~7% 是 CPU 口径。两尺并存，都不是施害者判据。
4. M8 证据行（`pair.scanAndIngestPairs since_id=NaN max_id=NaN hits=0` 窗内 74/74）可直接引。

## 2. 施害者（机械判据，164 个 lag 事件；≥5 s 51 个；≥30 s 12 个）
| 站 | n | p50 sync | 施害者(≤0.5 s) | 解释 gap | 同步段坐标 |
|---|---|---|---|---|---|
| **broker-intake.tick.sync** | 42 | 5.5 s（4–10 s） | **15** | 110 s | `broker-intake-watcher.js:703-717` `kaspa_tx_log … AND NOT EXISTS(broker_workflow_markers …) ORDER BY observed_at DESC LIMIT 50` 的 `.all()`，在首个 await（:720 `handleIntake`）之前；TICK_MS=60_000 |
| refund-claim-auto.tick.sync | 9 | 2.7 s | 3 | 12 s | `bettor-refund-claim-auto.mjs:43-57` `pool_bettor_sides … NOT EXISTS(chain_events …)` |
| broker-fee-emit.tick.sync | 4 | 1.0 s | 1 | 2 s | 未展开 |
| oracle-voter-health / zk-prove-worker | 1/1 | 59/109 ms | 1/1 | — | 毫秒级撞大 gap，巧合级不计 |
| **合计** | | | **21/164** | **312 s / 1410 s = 22%** | |

索引现状：`kaspa_tx_log` 只有单列 `to_address`/`from_address`/`block_time`（migrate.js:1869-1871），无 `(to_address, observed_at)`；`broker_workflow_markers(src_event_id)` 有索引（:2778）。文件注释原话：Trader-B 地址 24h 3093 行 = splitter 自循环链；全史行数**未核**（活库禁重查询，须在备份副本上 `COUNT` + `EXPLAIN QUERY PLAN`）。

## 3. 未解释 78%
≥5 s 未解释 gap 48 个（21:07:59 +63 s、21:01:37 +55 s、21:00:26 +53 s、21:03:29 +47 s…）。J2 ④ 表里"疑施害者·非起点"（zk.closeTickV2 −0.8 s、bshard-close-voter.v2Tick −0.9 s、judgePropose −48 s、preprune-capture-worker −12 s、send-command −48 s）全是 async 站：**async tick 不能堵 loop，它们能施害只有"首个 await 之后的同步段"**——起点不在 tick 起点，≤0.5 s 规则天然判不到。这是 M10 v2 的设计盲区（只包入口），不是 J2 的错。

## 4. 建议（observe-only·不改行为）
- **v3**：在上述五站内用 `stepSync` 包每段 `.all()/.get()/.run()/JSON.parse`（settle `pre` 段内的 buildPkMap/zkCloseTick 内部同理），阈 200 ms，判据不变。
- **broker-intake 修法归 Owner 批**（broker=钱路相邻）：候选 = 复合索引 `(to_address, observed_at)` / 缩窗 / 游标；先备份副本 EXPLAIN+COUNT 再定。建议进 Phase-1 清单与 M8 并列。

## 5. 未核
J2 正式页与 preview 的差异；kaspa_tx_log 全史行数；未解释 gap 里 GC/wasm 占比（需 `--trace-gc` 或 perf_hooks GC 观察，另案）。

### 6. 正式页复核（2026-09-04T22:01Z）：GREEN；"起点重合"机械解析
J2 正式页 `scratch/_j2_m10v2_window1_page_2026-09-04T21-58Z.md`（窗 20:55:58Z→21:56:00Z，PID 15196 无重启）：lag ≥4 s 78 次 Σ1551 s = 窗长 43%；施害者形 17（broker-intake 12）；60 次只有"非起点"。与 §2 两尺一致。
**同起点解析规则**（补 §2 的判据）：phases 起点与 gap 起点 ≤0.5 s 的命中，找同起点（±100 ms）的 `.sync` 站，其 sync ms ≥ gap−1 s ⇒ 该站为施害者。结果：21 个 settle/pool 命中 → **15 个解析为 broker-intake.tick、0 个为 settle/pool**、6 个未解析（pool 4 次无同起点同步站且 gap 34/45 s = 入口埋点外类；settle 2 次 broker-intake 只盖部分）。旁证：settle 与 broker-intake 两个 60 s 定时器每分钟同毫秒起（:50.2），settle 恒排在 broker-intake 块后 ⇒ 修 broker-intake 后 settle pre 应同步缩。
≥60 s 五次里四次为 ZK 自治 tick 起后 0.5–1.0 s 才堵 ⇒ v3 段级范围确认（五站 + settle pre 内部）。

### 7. M10 v3 规格与 v3-A 补丁审（2026-09-04T22:23Z）
- 规格 `scratch/_j2_m10v3_spec_2026-09-04T22-33Z.md` 预审 GREEN-conditional（六条件：`at=` 必须仍是时间戳、caller 改 `src=`；Proxy 以原 Statement 为 receiver 且链方法返回 this 时回 Proxy；rows 语义；安装位置；四个补充测试向量；B 的 JSON.parse 包整段循环）。nit：`bshard-close-voter.js:456-458` 的 LIKE 可走 `idx_chain_events_from/type`，不是全表 LIKE。
- v3-A 补丁 `scratch/_j2_m10v3A_patch_2026-09-04T22-20Z.diff`（sha `2595108e…88f1`，3 文件 +233：client.js +2、`src/db/slow-sql-observe.mjs` 新、其测试）**GREEN**：六条件全落，镜像树测试 11/11（首跑 9/11 两处根因记录诚实）。helper 独立文件裁接受（安装点唯一即可）。备注：`sql=` 前 80 字可能含插值 ID（observe-only 接受）；live 树 smoke 不开活库文件；apply 前 live 树再 `git apply --check`。
- 后续：Bettor 批 apply → 单独一笔不推 → 随 console 自然重启承载 → 首个 ≥1h body 窗出页，`sql.*` 行自动进 ④ 判据。
- **勘误（2026-09-04T22:28Z）**：v0.1（2595108e）在 live 树被 pre-commit `R-M0A-BARE-IMPORT-DIFF` 拦（测试裸 import better-sqlite3），J2 回滚到干净树后出 **v0.2 `scratch/_j2_m10v3A_patch_v02_2026-09-04T22-27Z.diff`（sha `ff964aa794d249642c8848e0afc02fe7c9b481ec99fecfea353309ba3f288b86`）**，delta 审 GREEN：helper 唯一变化 = `{slowMs,log}` 挂 `db.__slowSqlObserver` 供测试改，计时闭包每次读；client.js 逐字同；零裸 import；测试改 DB_PATH=mkdtemp → import client.js 形，12/12。可选一行：`state.slowMs > 0 &&` 防运行期置 0 变全打。**以 v0.2 为准，2595108e 作废。**
- **落码（2026-09-04T22:30Z）**：v3-A 以 **v0.3** 落 live 树 = commit **76773b76**（3 路径 +252；v0.3 = v0.2 + 守卫 `state.slowMs > 0 && ms >= state.slowMs` + 测试 V8b；补丁 sha `80c6871c…dd9a`）。NWT GREEN-final（事后补看：commit +/− 行 == v0.3 补丁逐行；live 树观察者 13/13 + default-path 6/6，日志 `scratch/_j2_m10v3A_tests_live_v03_2026-09-04T22-29Z.log`；helper 唯一 importer = client.js）。Bettor 先推后 final（ledger 870 自记闸序瑕疵，内容无差）。**未生效**：console 15196（20:55:52Z 起）未重启；随自然重启承载，首个 ≥1h body 窗出页。
