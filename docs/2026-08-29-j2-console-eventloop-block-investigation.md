# console 稳态 event-loop 同步阻塞（8–15 s）调查 v0.1 —— 嫌疑表 + 归因仪器 patch 草案 + 修法

> **Status**: DRAFT v0.1 · J2 2026-08-29 · Bettor 派（排队·只读·不动进程·不打 profile 到 live）· NWT 审。输入：`logs/console.log`（05:20–05:49Z 只读）/ `kasia-console/src` 静态盘点 / **离线** `console.db.bak-armwindow-20260723`（8.65 GB, 07-23 快照）`dbstat` + `EXPLAIN QUERY PLAN`（`scratch/_j2_eventloop_db_audit/audit{1..4}.out`）。**活库未开**（只 `ls -l`）。
> 🔴 作用域：回答 Bettor 三问（① lag 打点能否归因 / ② tick 同步 DB 查询静态盘点 / ③ 修法 + 是否需要 `--cpu-prof`）。**不裁定 05:13Z 27412 首死的根因**——本稿给的是"稳态阻塞段是什么、谁最可能、怎么一天内定罪"。

## §0 结论（五行）
1. **稳态阻塞是真的、持续的、不是重启瞬态**：05:20–05:49 每 10 min 稳定 33–34 次 `[diag:eventloop-lag]`，其中 ≥7 s 段每 20–30 s 一次（15.2 s → 8 s 递减），log 到 05:49:24 仍在。一次 ≥10 s 段 + curl 失败 = 旧 supervisor 心跳 10 s 阈一次即判死 ⇒ **27412 "首死" 完全可以是这个（4 天里迟早撞上）**——supervisor v0.1.4 的 soft-fail + 20 s 阈就是为它设的。
2. **现有仪器归不了因**：`eventloop-lag-heartbeat` 只量 gap（§1）；只有 3 个 tick 打 `[diag:tick-duration]`（settle-daemon / pool-settler / relay-health），其余 12 个嫌疑 tick **零计时**；HTTP ingest 路径零计时。⇒ 先装 §2 的**tick 注册表 + 同步前缀计时**（零行为改动、~60 行），一小时的数据就能把"紧邻"变成"肇事"。
3. **静态最像的三个**（§3）：(A) `pool-market-settler` 60 s tick（每盘 `pool_markets` 全表扫 ×N + `broadcast_messages content LIKE` + `json_extract` 扫 `pool_oracle_vote`，自带 30 s time-box = 曾超 30 s 的自证）；(B) `bshard-settle-daemon` 60 s tick（**实测** p50 0.9 s / p90 6.4 s / max 41.9 s；`execFileSync silverc` 首次必 miss；`kaspa_tx_log outputs_json LIKE` 7.9M 行扫）；(C) **写侧背景机制**：32 个 relay 各自索引 watched 地址 ⇒ 同一 tx 打 32 次 `/ingest/kaspa-tx`，每次 = 5 棵 b-tree 随机写（tx_id 随机 hash；索引 1.9 GB）+ 31 次 OR IGNORE 随机 seek（861 MB 唯一索引），`kaspa_tx_log` 占库 **87%**（7.57 GB @07-23，+140 MB/天）；`client.js` **没设 `synchronous`（WAL 默认 FULL = 每 commit fsync）、没管 `wal_autocheckpoint`（默认 1000 页）、全仓零显式 checkpoint**，WAL 常驻 112.9 MB 高水位 ⇒ 一次能推进的 checkpoint = ~100 MB 随机写 + fsync 到 13.8 GB 文件，**同步跑在主线程那次 `.run()` 里**。(C) 与 ≥7 s 段"不规则、随写压递减"的形最吻合，但**它无法从日志证明**——这正是 §2 仪器里要加 checkpoint 计时的原因。
4. **修法分三层**（§4）：零风险仪器（维护窗随 57fde30f 批）→ 索引/PRAGMA（`synchronous=NORMAL`、显式 checkpoint 移 worker、6 条索引，各 ≤ 数百 MB、离线可验）→ 结构（kaspa-tx ingest 只让 1 个 relay 当 indexer 或 console 侧批量写；`kaspa_tx_log` 保留期）。
5. **`--cpu-prof`**：**现在不需要**。仪器落地 24 h 后若仍分不清，再在维护窗内跑一次 5 min（`CPU_PROF_AUTO_EXIT_MS` 只许在窗内、对**即将被重启**的 console 注入）。理由 §5。

## §1 实测（只读日志，2026-08-29）
| 量 | 值 | 来源 |
|---|---|---|
| lag 事件 | 05 时 97 次；05:2x/05:3x/05:4x 各 33/34/33 | `grep '[diag:eventloop-lag] gap'` |
| ≥7 s 段 | 05:30 起：15.2/12.7/11.1/13.2/12.8/12.7/10.9/10.8/10.8/10.1/9.6/11.4/7.9/**20.5**/9.9/9.9/9.8/8.7/8.3/8.9/7.9 s；间隔 7–133 s（多数 20–36 s） | 同上，`start = at − gap` |
| 递减趋势 | 15 s（05:30）→ 8 s（05:47），同期 relay 追块结束（`catch-up done` 1024 行到 05:51）——**与写压/追块相关，不与某个固定周期相关** | |
| 心跳/堆 | lag 时 heapUsed 49–289 MB、heapTotal ≤421 MB、rss ~0.5 GB ⇒ **不是 GC**（同 08-07 结论） | lag 行自带字段 |
| `settleDaemonTick` | n=29, min 120 ms, p50 912, **p90 6428, max 41904**（05:22:09 boot 后首 tick）；>3 s 的 10 次全在 :22–:46 | `[diag:tick-duration]` |
| `poolSettlerTick` | n=29, p50 628, p90 2947, max 6024 | 同上 |
| `relayHealthMonitorTick` | 全 0–1 ms（末次 `deadCount=32` = 主线程阻塞时 32 个 relay 全被判死——**症状不是病因**） | 同上 |
| `[utxo-fetch-probe]` | 74 次/天，ms=0–22，一次 1074 | faucet 60 s tick，排除 |
| 大阻塞前 15 行内最后一个 console 侧 tag | `bshard-close-voter-v2` 30 / `settle-daemon` 12 / `diag:tick-duration` 12 / `broker-buy-completion` 10 / `rpc-health` 4 / `prediction-voter` 3 | 紧邻≠肇事：close-voter 30 s 周期与阻塞 20–30 s 间隔天然重叠，**不能定罪**（它的 enforce 路径是 async relay-IPC/fetch，静态不重） |
| DB 文件 | live `console.db` 13.83 GB（+5.2 GB/37 天）、`-wal` 112.9–118 MB 常驻、page 4096 | `ls -l` 只读 |
| PRAGMA | `client.js:45-46` 只有 `journal_mode=WAL` + `foreign_keys=ON`；无 `synchronous` / `wal_autocheckpoint` / `busy_timeout` / `mmap_size` / `cache_size`；全仓零 `wal_checkpoint` | 代码 |

## §2 回 ①：`[diag:eventloop-lag]` 能否归因 —— 不能；最小扩展 patch 草案（报备，不 apply）
**现状**（`lib/eventloop-lag-heartbeat.mjs:37-62`）：1 s `setInterval`，只量 `gap − 1000`，附堆/rss/wasm 字段。它回答"卡了多久、何时结束"，**不回答"谁卡的"**——因为阻塞是同步的，心跳回调只能在阻塞**结束后**才跑，那时调用栈已经空了；`process._getActiveHandles()` 计数在此刻也只反映句柄数，不反映刚才谁在跑。
**能归因的最小形 = 事前登记 + 事后对时**（阻塞是同步的 ⇒ "最近一个开始的同步段"就是肇事者）：
1. **tick 注册表** `lib/tick-registry.mjs`（新文件，~40 行）：`instrumentTick(name, fn)` 返回包装函数——记录 `{name, startedAt}` 到环形缓冲（64 条），`const t0 = performance.now(); const r = fn(); syncMs = performance.now() − t0`（**async 函数返回 promise 的那一刻 = 同步前缀结束**，这正是我们要量的段），`syncMs > 500` 直接打一行 `[diag:tick-sync] name=… syncMs=…`；`r` 若是 promise 再 `.finally` 记总时长。`process.env.TICK_REGISTRY_OFF=1` 可整体关。
2. **接线点**：`index.js` 里每个 `setInterval(fn, ms)` / 各 service 的 `start*()` 内的 `setInterval` 改成 `setInterval(instrumentTick('settleDaemonTick', fn), ms)`——**只包一层，不改 fn**；15 个嫌疑 tick（§3 表）先接，其余不动。
3. **HTTP 同步段**：fastify `onRequest`/`onResponse` 钩子按 route 量 handler 的同步前缀（`/ingest/kaspa-tx`、`/ingest/spc-daa-block`、`/api/chat/send`…），同一缓冲。
4. **SQLite 侧**：无 hook 可挂 checkpoint；改为 `sqlite.pragma('wal_autocheckpoint = 0')` + 一个 **60 s 显式** `PRAGMA wal_checkpoint(PASSIVE)`（先仍在主线程，用 `instrumentTick('walCheckpoint', …)` 包住 ⇒ checkpoint 时长从此有数；返回的 `busy/log/checkpointed` 三元组一并打）——这一步同时把 (C) 从"猜"变"量"。**注意**：它把 checkpoint 从"随机某次写触发"改成"固定 60 s 一次"，阻塞总量不变、可预测；这是行为改动，须 NWT 一眼 + Owner（live 守护逻辑同级）。
5. **lag 行扩展**：`lag > 3000` 时，把环形缓冲里 `startedAt ∈ [now − gap − 1000, now]` 的记录按 syncMs 降序附在行尾（`culprits=[settleDaemonTick:4900, walCheckpoint:3100]`）+ `activeHandles=N`。
**diff 草案要点**（落码前报备；全部 observe-only、失败 try/catch 吞、零 DB 写）：`eventloop-lag-heartbeat.mjs` +12 行；`tick-registry.mjs` 新 ~40 行；`index.js` + 各 service `setInterval` 处各 1 行包装（15 处）；`client.js` +1 行 pragma（若采 4）；一个 60 s checkpoint tick（~10 行）。验收：offline 用假 tick（`while(Date.now()<t+3000){}`）触发 lag 行含 `culprits=[fake:3000]`。

## §3 回 ②：同步 DB 查询静态盘点（tick × 表大小 × 索引覆盖）
表大小（07-23 快照 `dbstat`；live 更大）：`kaspa_tx_log` 7.57 GB/~11.6M 行（索引 2.08 GB：to_address 958 MB、PK 861 MB、block_time 156 MB、from 109 MB）· `spc_daa_index` 263 MB/1.66M（仅 PK，插入 = rowid 追加，**便宜**）· `broadcast_messages` 149 MB/144K · `kanet_message_index` 126 MB/120K · `chain_events` 123 MB/244K · `tx_records` 97 MB/180K · `events` 94 MB/168K · `oracle_pool_chain_view` 72 MB/42K · `pool_bettor_sides` 47 MB/39K · `pool_markets` 42 MB/7.9K（5.3 KB/行 metadata）· `payout_shards` 16 MB/1.1K（14.7 KB/行）· `messages` 0.9 MB/940 · **无 `sqlite_stat1`（从未 ANALYZE）**。
| # | tick（file:line / 周期 / 本机门控） | 同步语句（要害） | 表 | 索引覆盖 | 守卫 | 判 |
|---|---|---|---|---|---|---|
| 1 | `pool-market-settler.js:197` `poolSettlerTick` / 60 s / `POOL_SETTLER_TICK_SEC=60` | 每个过期 verifying/collecting_sigs/refunding/disputed 盘（backlog ~90–140）：`isCommingledSpine` = `COUNT(*) FROM pool_markets WHERE spine_p2sh=? AND protocol_version='v0.7'`（`lib/pool-commingle-detect.mjs:24`）；v0.6/0.7 盘再 `:1127/:1150` `broadcast_messages WHERE channel_name='kanet-prediction' AND content LIKE '%…%' AND tx_hash NOT IN (SELECT txid FROM chain_events …)`；`decideConsensusV06 :1654` 每盘 5×`json_extract` 扫全部 `pool_oracle_vote`；watchdog `:1349/:1403` 再扫一遍 | pool_markets / broadcast_messages / chain_events | `spine_p2sh` **NONE**；`content` **NONE**；`payload` **NONE** | 有 + `TICK_TIMEBOX_MS=30_000 :601`（= 曾超 30 s 自证） | **实测 p90 2.9 s / max 6.0 s**；skip/backoff 路径纯同步叠成一块 |
| 2 | `bshard-settle-daemon.mjs:1016` `settleDaemonTick` / 60 s / `SETTLE_DAEMON_ENABLED=1` | `selectRipeMarkets :596` `SELECT * FROM pool_markets WHERE protocol_version='v0.7' AND deadline_daa+?<=? … ORDER BY`（全 metadata blob + temp sort）→ 每行 4×`JSON.parse` + `getMarketBets`；ripe 盘 **`execFileSync(silverc, …, timeout 30 s)`**（`lib/pool-bshard-artifacts.mjs:59`，cache key 含盘参数 = 首次必 miss）；claim 回溯 `bshard-auto-settler.mjs:531` **`kaspa_tx_log WHERE outputs_json LIKE '%addr%'`**（自注 7.94M 行 SCAN） | pool_markets / kaspa_tx_log | `protocol_version/deadline_daa` **NONE**；`outputs_json` **NONE** | 有 | **实测 p90 6.4 s / max 41.9 s** |
| 3 | `broker-state-reconciler.js:256` / 300 s + 启动 | 每个 expired 无 offer 的 `retail_dex_orders`（自注 12,788）跑相关子查询 `EXISTS(chain_events ce JOIN kaspa_tx_log ktl ON ce.txid=ktl.tx_id WHERE … ktl.amount BETWEEN …)`；`error_reason LIKE` 扫 | retail_dex_orders / chain_events / kaspa_tx_log | `error_reason/created_at` **NONE** | **无** | 中（5 min 一次） |
| 4 | `bettor-refund-claim-auto.mjs:171` / 300 s / 默认开 | `pool_bettor_sides s JOIN pool_markets WHERE s.claim_txid IS NULL AND EXISTS(chain_events WHERE event_type='bettor_refund_available' AND payload LIKE '%"market_id":"'‖s.market_id‖'"%' AND payload LIKE …)`；候选常年 95 笔每 tick 原样重算；`index.js:655-657` 有 CPU 打满实证 | pool_bettor_sides / chain_events | `claim_txid` **NONE**（EQP f6 = SCAN）；`payload` **NONE** | 有 | 中-高 |
| 5 | `preprune-capture-worker.mjs:135` / 60 s / 无门控 | `SELECT DISTINCT market_id FROM pool_bettor_sides WHERE side_lock_daa IS NULL`（全表）；每候选 `events WHERE event_type=? AND payload_json LIKE ? LIMIT 1`（**events 无 event_type 索引**，EQP g3）；RPC `getBlock(includeTransactions)` 回溯 ≤10000 步主线程反序列化；TERMINAL 集不含 verifying ⇒ 卡盘每分钟重扫 | pool_bettor_sides / events | **NONE** | 有 | 中 |
| 6 | `broker-fee-emit.mjs:57` / 300 s | `pool_markets WHERE broker_pk IS NOT NULL AND json_extract(metadata,…) IS NULL AND (… OR json_extract(…)=1)` 无 LIMIT，OR 上 json_extract 让 status 索引失效；`pendingIndex` 永不标记 ⇒ 每 5 min 重扫 | pool_markets | **NONE** | 无（体同步） | 中 |
| 7 | `bshard-settle-daemon.mjs:1074/:1084` `zkCloseTickV2`/`claimAutonomousTick` / 各 30 s | `zk-autonomy-ticks.mjs:45` **`pool_markets WHERE metadata LIKE '%zk_continuation%'`** ⇒ 每 30 s 两次全表 + 全 metadata blob JSON.parse | pool_markets | **NONE** | 有 | 中（42 MB 表，~百 ms 级，但每 30 s 两次） |
| 8 | `bettor-prediction-voter.js:71` / 60 s | 每 oracle relay（~8–9）：`pool_markets WHERE oracle_relay_ids LIKE ? …`；每盘 `chain_events payload LIKE` ×2；每 collecting_sigs 盘 `COUNT(*) payload LIKE` ×2；`prediction-parallel-judgment.mjs:254` `exchange_offers WHERE id=? OR outcome_condition_id=?`（OR 让 PK 失效） | chain_events / exchange_offers | `payload`/`outcome_condition_id` **NONE** | 有 | 中 |
| 9 | `oracle-voter-health-monitor.js:135` / 120 s | 整段同步：每 oracle × 每过期 verifying 盘 `chain_events WHERE event_type='pool_oracle_vote' AND from_address=? AND payload LIKE ?` | chain_events | `payload` NONE | 有 | 中 |
| 10 | `bettor-auto-valve.js:29` / 1 h | `bettor_market_price_history WHERE condition_id=? ORDER BY snapshot_at DESC LIMIT 1` × 每 >90 天仓位（今天全部）；索引是 `(market_id, snapshot_at)` = 读写错位 | bettor_market_price_history | `condition_id` **NONE** | 有 | 低频但单块大 |
| 11 | `pair-ingestor.mjs:135` / 30 s + boot | `broadcast_messages WHERE id > ? AND content LIKE '%"intent":"pair_%' …`——`id` 是 TEXT UUID、游标数字 0 ⇒ **每行为真 = 全表 LIKE**；之后 `Math.max(0,'<uuid>')=NaN` 行为未验 | broadcast_messages | `content` NONE | n/a | 中 + **缺陷** |
| 12 | `bshard-settle-daemon.mjs:1108` `zkHandoffAutonomousTick` / 30 s | `payout_shards JOIN pool_markets` **无 WHERE**，每 30 s 拉全部 `payout_redeem_hex`（14.7 KB/行）+ metadata | payout_shards / pool_markets | — | 有 | 低-中 |
| 13 | `bshard-close-voter.js:550` V2 / 30 s | 空闲一条 status 索引查询；有 zk_native collecting_sigs 盘时 `deriveTicketAddr` = **`compileSil` execFileSync**（cache miss）/ ticket；relay `check_utxo_landed` 超时回退 `kaspa_tx_log outputs_json LIKE` / ticket | kaspa_tx_log | NONE | **无** | 紧邻 30/97 但静态不重；**须 §2 仪器定罪** |
| 14 | `broker-intake-watcher.js:1095` 5 min 子 tick（Z20 等） | `NOT EXISTS(events WHERE event_type=… AND payload_json LIKE …)` × drift 候选；Z20 对全部 broker 挂单 `json_extract(metadata)` + 两条 `NOT EXISTS payload LIKE`；串行 IPC 30 s 超时 | events / exchange_offers | `event_type` NONE | **无** | 已埋 `[diag:step-Z20]`（今 max 4 ms）⇒ 今日排除 |
| 15 | `lib/faucet-utxo-health.mjs:115` / 60 s | 非 DB：`getUtxosByAddresses` wasm 编组 | — | — | 有 | `[utxo-fetch-probe]` ms≤22 ⇒ **排除** |
| C | **HTTP ingest（非 tick）** `api/ingest.js:39` `/ingest/kaspa-tx` | `INSERT OR IGNORE INTO kaspa_tx_log`（9 列）= 5 棵 b-tree 写（PK 861 MB + to_address 958 MB + from 109 MB + block_time 156 MB + 表）、tx_id 随机 hash ⇒ 全随机页；**32 个 relay 各自索引 watched 地址**（`rpc-listener.mjs:480`，`/api/indexer/watched-addresses` 每 relay 60 s 刷新）⇒ 同一 tx 打 32 次 = 1 次真插 + 31 次 OR IGNORE 随机 seek | kaspa_tx_log | PK 有（这正是成本所在） | — | **背景写压主源**；`/ingest/spc-daa-block`（`:81`，每 relay 每 finality-safe 链块 ≈ 0.186 行/DAA ⇒ TN12 ~1.9/s/relay ⇒ ~60 POST/s）三条语句全 O(1)/3 页 ⇒ **便宜，排除** |
| W | **WAL 自动 checkpoint（非 tick）** | 每 1000 页（4 MB）WAL 由**当时那条写语句**同步做 PASSIVE checkpoint；WAL 高水位 112.9 MB = 27.6k 页 ⇒ 一次能推进的 checkpoint 最多写 ~100 MB 随机页 + fsync（`synchronous` 默认 FULL） | 整库 | — | — | **与 ≥7 s 段"不规则、随写压递减"最吻合的机制**；无法从日志证明 ⇒ §2-4 |

**结构性索引缺口**（migrate.js 实核 + EQP）：`events(event_type)` 缺（≥6 tick 用）；`chain_events(payload)` 被 ≥12 处 `LIKE '%"market_id":"…"%'`；`pool_markets` 缺 `spine_p2sh/protocol_version/deadline_daa/broker_pk`，metadata 被 ≥8 tick 整 blob 读；`pool_bettor_sides` 缺 `claim_txid/side_lock_daa`；`kaspa_tx_log(outputs_json LIKE)` 3 条路径；`broadcast_messages(content)`；`exchange_offers(outcome_condition_id/taker/completed_at)`；`bettor_market_price_history(condition_id)`；`retail_dex_orders(error_reason/created_at)`。另：`idx_tx_records_txid`/`idx_bcast_tx`/`idx_pool_sides_market` 三个冗余索引 ~28 MB。

## §4 回 ③：修法（按风险分层；每层都可离线验）
**L0 仪器（零行为改动 · 随 57fde30f 批进维护窗）**：§2 的 1/2/3/5（不含 4）。产出：24 h 内每个 ≥3 s 段带 `culprits=[…]`。
**L1 索引 + PRAGMA（离线在 bak 副本上 `CREATE INDEX` 计时 + EQP 复核 SEARCH，再进维护窗；每条一次 migrate 版本）**：
| 修 | 影响 | 估算 |
|---|---|---|
| `PRAGMA synchronous = NORMAL`（WAL 下标准；只在断电时丢最后几笔已 commit 的 tx，**不破坏一致性**） | 每 commit 少一次 fsync；checkpoint 仍 fsync | `client.js` +1 行 |
| 显式 checkpoint 移出主线程：`wal_autocheckpoint=0` + **worker_thread 自己开一个连接**每 60 s `wal_checkpoint(PASSIVE)`（SQLite 允许另一连接做 checkpoint；主线程不再被它卡）+ 日志 `busy/log/ckpt` | 把 (W) 从主线程拿走 | 新 `lib/wal-checkpoint-worker.mjs` ~40 行 |
| `CREATE INDEX idx_events_type_created ON events(event_type, created_at DESC)` | tick 5/14 + 三个 alert | ~10 MB |
| `CREATE INDEX idx_pool_sides_unclaimed ON pool_bettor_sides(market_id) WHERE claim_txid IS NULL`；`…(market_id) WHERE side_lock_daa IS NULL` | tick 4/5 | 部分索引，KB 级 |
| `CREATE INDEX idx_pool_markets_pv_deadline ON pool_markets(protocol_version, deadline_daa)`；`…(spine_p2sh)`；`…(broker_pk)` | tick 1/2/6 | 各 <1 MB |
| `CREATE INDEX idx_kanet_msg_unprocessed ON kanet_message_index(block_time) WHERE processed_at IS NULL`；`idx_chain_events_observed ON chain_events(observed_at DESC)`；`idx_tx_records_status ON tx_records(status, created_at)`；`idx_bcast_status … WHERE status<>'confirmed'`；`idx_payout_shards_ps_addr` | EQP b2/b3/b4/e/e3/f10 全表扫 → SEARCH | 各 ≤ 数 MB |
| `ANALYZE`（一次，维护窗内，写 `sqlite_stat1`） | planner 从默认启发式变成有统计 | 13.8 GB 全扫，**分钟级，只能窗内** |
| 🔴 **不建**：`kaspa_tx_log(observed_at)`（+150 MB，只为 c2 那类查询——先确认有没有调用方）；`chain_events(payload)`/`pool_markets(metadata)` 上的表达式索引（治标，应改查询把 market_id 抽成列） |
**L2 结构（设计稿另立，Owner 域）**：(a) kaspa-tx 索引只由 **1 个** relay（或 console 侧 `kaspa-scout`）做，其余 31 个关掉 `ingestKaspaTx`（`rpc-listener.mjs:480` 加 `RELAY_TX_INDEXER=1` 门）——写压 ÷32；(b) `/ingest/kaspa-tx` console 侧改批量：relay 攒 1 s 一批 POST，console 一个 `transaction()` 写；(c) `kaspa_tx_log` 保留期（watched 地址以外的行？先量有多少行从未被读）；(d) `chain_events.payload LIKE '%"market_id"…'` 族改成 `market_id` 列 + 索引（12 处调用点一次迁）；(e) tick 1/2/4 的每盘循环加 `LIMIT` + 游标，或移 worker_thread（它们已是 landed-gated 慢路径，不在乎延迟）。
**顺手缺陷（非阻塞，记账）**：`bettor-auto-valve.js:172` INSERT chain_events 缺 `txid NOT NULL` ⇒ 每次抛被吞、告警从未落库；`pair-ingestor.mjs:57` 游标类型错位；`broker-state-machine.js:249` 硬编码主网地址 ⇒ TN12 恒 0 行；`broker-bsc-intake-watcher.js:56` `order_type='broker_as_maker'` 违 CHECK 恒空；`broker-fee-emit.mjs:137` pendingIndex 永不标记；`spc_daa_index_coverage` 近期行全 span-1（`start_daa==end_daa`，350 行）= 覆盖区间"相邻延伸"路径疑未生效（`ingest.js:96` 阈值 10 vs 链块平均 5.4 DAA 间距——32 个 relay 乱序到达可能让 `daaScore − latest.end_daa` 常为负或 >10）；`events.created_at` 混用 `datetime('now')` 空格形与 ISO `T` 形 ⇒ 字符串比较把当天 ISO 行全纳入"最近 N 分钟"。

## §5 是否需要维护窗内 `--cpu-prof` 采样
- **现在不需要**：cpu-prof 给的是"CPU 在哪"，而本案 ≥7 s 段有相当比例可能是 **I/O 等待**（checkpoint fsync、随机页读）——profile 里会显示为 `(program)`/native 帧，归不到 JS 行；§2 仪器（同步前缀计时 + checkpoint 计时）直接回答"哪个同步段、多长"，成本 60 行、零 CPU 开销。
- **何时需要**：L0 落地 24 h 后，若 `culprits` 里最大项仍是某个 tick 的**纯 JS 同步段**（非 walCheckpoint、非单条 SQL），再在维护窗内对**即将被 ③ 重启的那个** console 注入 `CPU_PROF_AUTO_EXIT_MS=300000` 起一次 5 min 采样（`index.js:42-47` 基础设施已有；**禁止**对稳态 live 注入——它会 `process.exit(0)`）。
- 更便宜的替代：仪器 5 里对 `syncMs > 3000` 的 tick 附 `new Error().stack` 无意义（同步段已结束）；但可以在 **tick 内部**再细分（settle-daemon 已有 `[pre-gate]` 分段日志，pool-settler 有 time-box）——先看 L0 数据再决定要不要细分。

## §6 边界 / 未核
- 表大小是 07-23 快照；live +5.2 GB 几乎全在 `kaspa_tx_log`。`pool_markets/chain_events/events` 的 live 行数未量（活库不重读）。
- (W) 是机制推断：WAL 112.9 MB 是高水位不是当前深度（SQLite 不缩文件），"checkpoint 被长读者卡住"未直接证——外部读者（各 agent 的 `_*.mjs` 只读脚本、`_step0_gate.mjs` 60 s）确实存在但此刻谁持快照查不到；§2-4 落地后 `busy` 字段会直接回答。
- 紧邻统计（close-voter 30/97）只是 tag 相邻，不是因果。
- 不裁 27412 首死根因；不动任何进程；未跑 profile。
