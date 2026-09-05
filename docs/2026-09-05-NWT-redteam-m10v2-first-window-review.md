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

### 8. 08:47Z console 挂死归因（2026-09-05T08:53Z · 只读旧实例 diag 行）
- 旧实例 15196（20:55:52Z 起）08:47Z 被 hb_guard/supervisor 判死，08:50:01Z 重起 4536（ledger 878）⇒ v3-A 生效。
- `logs/console.log.prev-20260905T084856Z` 末段：`zk.closeTickV2 ms=59464 at=08:44:39.060Z` → **`broker-intake.tick.sync ms=185197 at=08:47:44.352Z`**（起点 08:44:39Z，与前行结束同毫秒）→ broker-buy-completion 125 ms / pool.selectMarkets 204 ms（08:48:24Z）→ 08:48:56Z 轮转。⇒ **§2 定名的同一条同步 SELECT（`broker-intake-watcher.js:703-717`）把循环硬堵 3 min 05 s**；昨晚 p50 5.5 s（4–10 s）→ 今早 185 s，同站同 SQL 深 34 倍。08:44:39Z 前各 tick 仍在完成，故 600 s 不应答的前半段非循环堵（HTTP 排队，未归因）。
- 并排观测（不判因）：D-b 后 kaspad 24 blk/s、SST 读更多 ⇒ 页缓存争用加剧；与 §? Bettor 冷页假设相容。
- 新实例启动段 sql.*（前 3 min 31 行）：pair-ingestor.mjs:63 `broadcast_messages WHERE id > ?` **47.2 s**（M8 NaN 游标 = 全表扫而非只是不命中）、pool.js:3300 20.8 s/1694 行、broker-fee-emit.mjs:117 19.1 s、zk-autonomy-ticks.mjs:45 LIKE 18.4 s、migrate.js:5448 16.9 s、bshard-close-voter.js:458 ×5。启动段单列，不入稳态窗。
- **升级**：broker-intake 修法从 Phase-1 候选升为"已实际打挂 console 一次"，建议尽快上 Owner；最小改动 = 复合索引 `(to_address, observed_at DESC)`（16M 行表建索引须 Owner 批 + 停机窗）。

### 9. Phase-1 ③ M2 / ① M8 补丁审（2026-09-05T09:09Z）：两稿 GREEN
- Owner 全批（ledger 880）：① M8 rowid 游标 ② broker-intake 复合索引 ③ M2 IBD 期跳过 15 站 ④ tg-bot 轮询 30→300 s；Bettor 顺序 ③→①→④→②（881）。
- **③** `scratch/_j2_p1_m2_ibd_gate_patch_2026-09-05T09-07Z.diff`（sha `31f6aebe…153a`，12 文件 +163）：新 `lib/ibd-tick-gate.mjs`——`ibdGateSkip(site)`：`IBD_TICK_GATE=0` ⇒ 不读门放行；`read()` 抛错 ⇒ 不跳；只 `gate.isSynced === false` 跳；翻转一行 + 10 min 心跳 + resume；共用 `isNodeSyncedCached`（30 s TTL）。15 站逐站对号（settle.tick / pool.tick / close-voter ×3 / refund-claim-auto / prediction-voter / prediction-settler / oracle-pool-scanner / oracle-renewal / zk-prove-worker / zk ×4）= 881 A 清单无漏无多；每站函数第一行、在重入锁与首个扫描之前。测试 6/6（G1–G5 + S1 结构断言）。**GREEN**。
- **①** `scratch/_j2_p1_m8_pair_cursor_patch_2026-09-05T09-03Z.diff`（sha `ffd879e6…caae`）：`WHERE rowid > ? ORDER BY rowid`、`rows.length < limit` ⇒ 推进到 `MAX(rowid)`、`since_id` 兼容、`max_id` 别名；`broadcast_messages` 为 `id TEXT PRIMARY KEY` 无 WITHOUT ROWID ⇒ 成立。备注：boot 仍从 0 起一次全表 LIKE（一次性）。测试 6/6。**GREEN**。
- ② 预审（发 Bettor，881 已收）：无 sqlite3 CLI ⇒ node 脚本；索引 ≈1.7 GB、-wal 涨同量 ⇒ 建完 `wal_checkpoint(TRUNCATE)`；2–6 min；同名索引 + migrate v199 `IF NOT EXISTS` 幂等；中断 = 事务回滚；验收 EXPLAIN 无 temp b-tree + 首 tick `sql.all` ≪1 s；停前 quiesce、cp 副本只读。

### 10. Phase-1 ④ / ②(a)(b) 审 + ③① 落地核（2026-09-05T09:18Z）
- **③① 落地**：d8760fd8（③，12 文件 +163）、ab53b1f9（①，2 文件 +114/−22）逐行 = 审过补丁（③ 我第一遍按行序比对误报"不同"，行集合 155/155 相等，撤回）；已在 origin；live 测 6/6 + 6/6；生效待 console 计划内重启。
- **④** `scratch/_j2_p1_tgbot_poll_patch_2026-09-05T09-15Z.diff`（sha `69367765…02d5`）：`settlePollMs` 300 s/`TG_SETTLE_POLL_MS`、`testBotUsers` 默认 990001,999001/`TG_TEST_BOT_USERS`（`??` ⇒ 空串不排除）、`isTestBotUser`；bot.mjs 循环首行 skip（`u.tgUser` 核在）+ interval；其它 poller 不动；测试 3/3。**GREEN**。
- **②(a)** `scratch/_j2_p1_v199_index_patch_2026-09-05T09-15Z.diff`（sha `b5c27597…7289`）：`src/db/heavy-index-v199.mjs` 单源 `idx_kaspa_tx_log_to_addr_observed` + DDL；`ensure…` 三态 present / skipped(LOUD 不建) / built(仅 `KANET_MIGRATE_BUILD_HEAVY_INDEX=1`)；migrate v199 块只记账、每 boot 判。**GREEN**。理由：boot 内 2–6 min 建索引撞 boot-age 判活 ⇒ 杀-回滚-重建风暴，"不自建"是唯一不自锁的形。
- **②(b)** `kasia-console/scratch/_j2_p1_kaspa_tx_log_index_window.mjs`：同源 DDL import、3200 监听即拒（`--force`）、`--copy` 含 -wal 且不覆盖、dry-run readonly、单语句自事务、`wal_checkpoint(TRUNCATE)`、EXPLAIN after 断言含索引名且无 TEMP B-TREE 否则 exit 1。**GREEN**。备注：env 开关永不进 kanet.env，正路是 (b) 脚本。
- **勘误（2026-09-05T09:19Z）**：②(a) 以重生版 `scratch/_j2_p1_v199_index_patch_2026-09-05T09-18Z.diff`（sha `9f90a18d8ca96af000d8fd14ebc7595af46d043d3e90d445308c834079743427`）为准，b5c27597 作废；唯一差 = LOUD 文案加"永不进 kanet.env / 只允许 supervisor·hb_guard 已停时手动单跑 / 正路是停机窗脚本"。旧文件已被删，本次按阅读记录比对（流程备注：被替代补丁文件应留存）。
- **落地核（2026-09-05T09:21Z）**：②(a) = **1993d05f**（= 9f90a18d 行集合，3 文件 +84，含"永不进 kanet.env"文案）；④ = **3305f61d**（= 69367765 行集合，3 文件 +40/−2）。Phase-1 四笔落地版全部逐行核：③ d8760fd8 / ① ab53b1f9 / ②(a) 1993d05f / ④ 3305f61d；生效待 console 计划内重启（停机窗并入：quiesce → 停含 supervisor → cp 副本 → ②(b) 脚本建索引 → 起）+ tg-bot 重启。live 验收项：③ 15 行 skip、① `since_rowid=`、② EXPLAIN after 含索引名无 TEMP B-TREE + -wal 回落 + 首个 broker-intake `sql.all` ≪1 s、④ 轮询 300 s。

### 11. v3-A 首窗页审 + Phase-1 live 验收（2026-09-05T10:01Z）
- **v3-A 首窗**（08:50:01Z→09:50:01Z，console 4536，= 修前基线）：J2 页 `scratch/_j2_m10v3A_window1_page_2026-09-05T09-57Z.md` **GREEN**——我用自己的脚本对 `console.log.prev-20260905T095830Z` 重算：sql.* 1,047 行，前 7 src 的 n/p50/max/Σ 逐格相同（pool.js:3300 465 行 Σ680 s；broker-intake:717 49 行 p50 11.9 s max 35.7 s Σ598 s；zk:45 75 行 max 106.5 s；pool-settler:497 50 行 max 69 s；zk:239 88 行 max 45 s；refund-claim:57 12 行 p50 4.1 s）；lag ≥4 s 119 次。三嫌疑对号同意（close-voter LIKE 非施害；judgePropose 是 await）。
- **链规则**（我补）：gap 起点 ≤0.5 s 的 sql 行起、后行起点落前行终点 ±0.5 s 内即接链、链 Σ ≥ gap−1 s 判覆盖 ⇒ 单行 17 + 链 24 = **41/119**，覆盖 30% gap 时间；链头 broker-intake:717 19、zk:239 6、pool-settler:497 3；三次 ≥60 s 全为链。剩 70% 不在 ≥200 ms SQL 行里 ⇒ (a) 非 SQL 同步段（B）或 (b) <200 ms SQL 背靠背 ⇒ 建议 **v3-C 每 tick SQL 累计器**（n + Σms，Σ ≥200 ms 打一行）分 (a)(b)。
- **停机窗**（Bettor 09:56:22→09:58:53Z，2.5 min）：副本 9.5 s、CREATE INDEX **50 s**（我估 2–6 min，冷扫更快）、-wal 峰 1675 MB → TRUNCATE 0、EXPLAIN after 走复合索引无 TEMP B-TREE、intake 查询 1 ms、✓ ACCEPTED。
- **live 验收（console 5392，我亲核 10:00Z）**：② `[migrate] v199 … 记账通过`、broker-intake 零 sql.* 行且零 tick 行、-wal 2.4 MB ✓；③ skip 15 行 = 13 新门站 + 2 preprune（v1 close-voter 不在 cron、oracle-renewal 未到点 ⇒ 未见属预期），zk:45 / pool-settler:497 慢 SQL 行 0 ✓；① `since_rowid=146591` 整数、每 tick 1 ms ✓；boot 后 sql.* 4 行、lag 1 次（对照 4536 启动段 35 行 Σ260 s）。④ 待 J2 报。**②③① live 全过。**
- **口径勘误（2026-09-05T10:03Z · J2 补）**：§11 的"41/119 = 30%"只是链头对齐窗放在 at−gap±0.5 s 的读数；心跳分辨率 1 s ⇒ 阻塞真实起点 ∈ [at−gap, at−gap+1 s]，放 at−lag±0.5 s ⇒ 31/119 = 18%，并集 [−1.5, +0.5] s ⇒ **82/119 = 55%**（无对齐 0、对齐但盖不住 37）。**三口径并列报，覆盖率真值在 18–55%**；修后窗（施害 SQL 被 ②③ 拦掉）应能收窄。v3-C（每 tick SQL 累计器）等修后首窗（11:00Z）看剩余份额再提。

### 12. Phase-1 修后首窗（09:59:01–10:59:01Z · console 5392 · 2026-09-05T11:03Z）：GREEN
- J2 页 `scratch/_j2_p1_postfix_window1_page_2026-09-05T11-03Z.md`；我同脚本独立重算逐项相同：lag >1 s **0**（修前 313）、≥4 s 0/0（119/1,663 s）、≥60 s 0（3）；sql.* **1 行**（pool.js:3300 0.4 s；修前 1,047）；broker-intake:717 **0**（修前 49 行 p50 11.9 s）；zk:45/:239、pool-settler:497、refund-claim:57 全 0（③ 门）；my-positions 1 行 rows=26（④）；pair boot 2.6 s + tick `since_rowid=146591 ms=1`（①）；skip 15 站 + 心跳、resume 0；链规则三口径 0/0。
- **仪器活性核**（防"0 = 静默失败"）：`heartbeat started (expected=1000ms, alert_threshold=1000ms)` 行在；`logs/console-heartbeat.txt` mtime 与 now 差 1 s；`[diag:step]` 10–11 行/min 在流 ⇒ 0 为真 0。
- **读法（必留）**：③ 份额 = 15 站 IBD 期不跑 = **遮住不是治好**（settle 自环 / ZK 扫盘 / pool 循环都在门外）；真修只有 ②（35 s → <200 ms）与 ④（465 行 → 1 行）。**下一次有信息量的窗 = IBD 结束后 ③ 自动放行的首个 1 h**；v3-C 与 Phase-2 排序到那时按剩余份额定（建议按修前 Σms：zk:45 310 s > pool-settler:497 179 s > zk:239 167 s > refund-claim:57 56 s）。
