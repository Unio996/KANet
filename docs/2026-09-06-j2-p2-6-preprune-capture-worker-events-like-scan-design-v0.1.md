# P2-6 · `preprune-capture-worker` 的 `events` LIKE 全表扫根治设计 v0.1（不写码）

> **Status**: DRAFT-FOR-REVIEW · J2 · 2026-09-06T20:3xZ（`date -u`）· Bettor 紧急派工 ledger 943 ② · 走常规审（NWT → Bettor → 修法碰钱路邻区 ⇒ Owner 知悉）· **本稿零代码零表零开关**；紧急止血 = ① env 开关 `PREPRUNE_CAPTURE_WORKER=0`（另笔，`scratch/_j2_ppw_disable_env_review_2026-09-06T20-19Z.md`）。
> 🔴 **本稿建在 J1 的 `docs/2026-08-06-preprune-recapture-permanent-failure-load-rootcause-design.md` v0.7 之上，不重做它**：那稿治的是【RPC backward-walk 重试循环】（§2.1/§2.2）与【"不可恢复"判据用错量】（§2.3/§4.2①）。**本稿治的是另一个此前不可见的成本：那个用来"跳过已放弃盘"的检查本身**——`_hasBeenMarkedUnrecoverable` 每次 = `events` 全表扫，③ 放行后 RPC 侧已经 `recaptured=0`（无事可做），**剩下的负载全是这个检查**。08-06 稿 §2.3 把它记为"已挡掉 759 个"的**好机制**，没量它的价格。

## 0. 一句话
③ 门 2026-09-06T20:08Z 放行后，`preprune-capture-worker` 每 60 s tick 对 **936 个非终态分片**各跑一次 `SELECT id FROM events WHERE event_type = ? AND payload_json LIKE '%"marketId":"…"%' LIMIT 1`；`events` **594,985 行、无 `event_type` 索引** ⇒ 每次 = `SCAN events`（EXPLAIN 实核），只读副本上单次 127–264 ms、活库同步连发 0.2–3.5 s（Bettor 读数）⇒ 单 tick 同步 SQL ≈ 分钟级，20:09–20:15Z 三次 ≥13 s 事件循环停顿、relay 全体 "Console unreachable"。而结果**恒定**：341 个逻辑盘早在 2026-07-17 就被标过，之后一个都没再标——**每 tick 重扫 = 结构性浪费**（锚点 < 剪裁点永远不会变，08-06 稿 §4.2① 已证）。
修法三层（可独立落、按序落）：**6a** 给 `events` 加 `(event_type, created_at DESC)` 索引（零行为差，7 处探测全受益）；**6b** worker 内存集合记"已标不可恢复"（每 tick 该检查 DB 成本 0）；**6c** 循环单位从分片改逻辑盘 + 终态/已标在 SQL 里预滤（迭代 1,575 → ≤434）。三层都不碰 `recaptureSideLockDaaForMarket`（钱路邻区）。

## 1. 现场（2026-09-06T20:2xZ 活库 readonly 轻查 · 每条 <300 ms · Pin 见 §7）
| 量 | 值 | 怎么量的 |
|---|---|---|
| `events` 行数 / `MAX(rowid)` | **594,985** / 594,985 | `COUNT(*)` 264 ms |
| `events` 索引 | `sqlite_autoindex_events_1(id)`, `idx_events_created(created_at DESC)`, `idx_events_level(level)`, `idx_events_trace(trace_id)`, `idx_events_agent_addr(agent_address, created_at DESC)` — **没有 `event_type`** | `sqlite_master` |
| `EXPLAIN` :68 形 | **`SCAN events`** | `EXPLAIN QUERY PLAN SELECT id FROM events WHERE event_type = ? AND payload_json LIKE ? LIMIT 1` |
| `side_lock_daa_unrecoverable` 事件 | **341** 条 = 341 个 DISTINCT `marketId`（`json_valid` 341/341）；`created_at` 全在 **2026-07-17 18:28–20:43**，之后 0 条 | |
| `pool_bettor_sides.side_lock_daa IS NULL` | **33,149** 行 · **1,575** 个 `market_id`（分片）· 归并到 **871** 个逻辑盘 | 08-06 稿 §4.2 "单位"判据：循环单位是分片，闸字段挂逻辑盘 |
| 1,575 分片按逻辑盘状态 | 终态（`TERMINAL_STATUSES` 5 种）**639** · `deadline_daa < floor` **1,325** · `deadline_daa IS NULL` **71** | floor = `MIN(start_daa) FROM spc_daa_index_coverage` = 56,983,539 |
| 非终态逻辑盘 | **434**，其中**已标不可恢复 341**（= 全部 341 条事件都落在这 434 里）⇒ 未标 **93** | |
| ⇒ 每 tick 的 `:68` 探测次数 | **≈936**（1,575 − 639 终态分片；`_hasBeenMarkedUnrecoverable` 在**分片**循环里逐个调，同一逻辑盘的 N 个分片各扫一次） | 代码 `_tickBody` 循环形 |
| ⇒ 每 tick 同步 SQL 下界 | 936 × 0.13 s ≈ **120 s**（只读副本单次最快值）；活库 0.2–3.5 s ⇒ **3–50 min** | 与 60 s tick 相比 = 重入闸永远在（08-06 稿 §2.1 同形，但这次是 SQL 不是 RPC） |
| 全仓 `FROM events WHERE event_type` 探测点 | **7 处 / 6 文件**：`preprune-capture-worker.mjs`×2（:68 :83）、`preprune-capture-monitor.mjs`（stale 去重）、`spc-daa-index-monitor.mjs`、`mind-manager.js`、`bshard-coherence-observability-monitor.mjs`、`migrate.js` | `grep` |
| `payload_json LIKE` 探测点 | 3 处：本 worker :67/:82 + `broker-intake-watcher.js:747` | `grep` |

🔴 **两条"看起来像别的病"的读数要先钉住**：(a) 08-06 稿 §2.1 说"重入闸让定时器失效"——当时是 RPC walk 占满，现在 RPC 侧 `recaptured=0`、walk 几乎不发生（③ 门在 `captureSideLockDaa` 叶子），**占满的是同步 SQL**；两者在 `[preprune-capture-worker] tick:` 行上同形（都只见 tick 慢）。分法 = v3-A `sql.get … preprune-capture-worker.mjs:68` 行（20:09:48Z 一条 3,459 ms 已在窗内）。(b) 20:10:25Z `[trade-filter:capture] skip: node not synced (isSynced=false, not-synced) — … 0 RpcClient built` 在各 tick 已 `resume: node synced` 之后仍出现——那是**另一条读同步态的路**（观测值，归因另案，不进本稿）。

## 2. 根因（三句）
1. **检查的价格与集合大小无关、与 `events` 总量成正比**：`payload_json LIKE '%"marketId":"X"%'` 无法走任何索引；而 `event_type = ?` 本可以把候选从 595k 缩到 341——**只差一个索引**。
2. **检查在错的循环单位里**：分片循环 × 逻辑盘判据 ⇒ 同一逻辑盘的分片数倍重扫（`…72-fy1yk` 32 分片 ⇒ 32 次全扫，08-06 稿 §4.2 已指出单位混用把规模读大一个量级——**这里它把成本乘大同一个量级**）。
3. **结果恒定却每 tick 重算**：341 个标记两个月没变；"永远不可恢复"是一次性结论，应记一次读 N 次，不是读 N 次算 N 次。

## 3. 修法
### 6a · `events` 加索引 `idx_events_type_created ON events(event_type, created_at DESC)`（推荐先落 · 零行为差）
- 效果：:68 → `SEARCH events USING INDEX idx_events_type_created (event_type=?)`（341 行）再 LIKE 341 个 payload（每个 ~200 B）⇒ 单次 **<1 ms**；:83（`event_type = ? AND created_at > datetime(…)`）同索引前导列 + 范围 ⇒ 也 <1 ms；`preprune-capture-monitor` 的 stale 去重、`spc-daa-index-monitor`、`bshard-coherence-observability-monitor` 的同形探测**全部受益**（今天都是 `SCAN events`）。
- 建法：595k 行 ≈ 1–2 s（v199 那次 16M 行 50 s ⇒ ~0.3M 行/s），**boot 内建可接受**（同 v200 记账式 `IF NOT EXISTS` + `[migrate] vNNN: … 建完 N ms`），不需停机窗；`-wal` 峰 ≈ 索引大小（~30 MB）。
- 风险：`events` 写入方多（每条 INSERT 多维护一个索引，µs 级）；无查询行为差。
- 验收：离线 EXPLAIN 断言 + 活库 `sql.get … preprune-capture-worker.mjs:68` 行归零；v3-A 表里 `events` 相关 src 消失。
- 🟡 单独一提：`:83` 那条 `created_at > datetime('now', '-1 hour')` 是 R-SQL-TIME-STRINGCMP 族（`events.created_at` 由 `datetime('now')` 写、空格形，比较**恰好对**），baseline 已计；本稿不改它。

### 6b · worker 内"已标不可恢复"内存集合（推荐与 6a 同落 · 该检查每 tick DB 成本 0）
- `_hasBeenMarkedUnrecoverable(id)` 改为 `Set.has(id)`；集合在**首个 tick** 用一条查询播种：`SELECT DISTINCT json_extract(payload_json,'$.marketId') FROM events WHERE event_type = ? AND json_valid(payload_json)`（6a 后 <5 ms；6a 前一次 ~0.3 s，一次即可）；`_markUnrecoverableIfBeyondFloor` 插入事件后 `Set.add`。
- 语义与现状**逐字等价**：现状也是"事件存在即跳过、不限时间窗、永不撤销"；进程重启 = 重播种（事件是持久的）。跨进程一致性靠事件表本身，与现状同。
- 🔴 不做的：不把集合落 `pool_markets` 新列——那是表结构 + 写入方变更 + DATABASE.md，收益不比 6a+6b 大，而多一个可能与事件表漂移的真相源（同一事实两处存，必有一处陈）。若将来要"可查询的持久标记"，走 `pool_markets.protocol_status = pruned_expired_waived`（08-06 稿 §4.2 已指出该状态**不在** `TERMINAL_STATUSES` 里的不一致——那是 6c 的事）。
- 验收：离线用例：播种后同 id 不再查 DB（prepare 计数 0）；新标后即刻 `has`；重启（新 import）重播种。

### 6c · 循环单位改逻辑盘 + SQL 预滤（次序在 6a/6b 后 · 碰循环形不碰 recapture）
- 现：`SELECT DISTINCT market_id …` 取 1,575 分片 → JS 逐个 resolve/终态/已标。改：一条 SQL 直接产出**逻辑盘去重 + 非终态 + 未标**的候选（`LEFT JOIN market_shards` 归并 → `JOIN pool_markets` 滤 `protocol_status NOT IN (…)` → `NOT EXISTS`/`NOT IN` 已标集合），再对每个候选逻辑盘的分片调 `recaptureSideLockDaaForMarket(shardId)`（**调用形不变，只是外层循环变了**）。
- 顺带收 08-06 稿 §4.2 那条不一致：`pruned_expired_waived` 并入 `TERMINAL_STATUSES`（同仓 `bshard-coherence-observability-monitor.mjs` 已把它当已归因）——**这一条改判据，单独一小笔、NWT 单审**，不与 6c 的纯形改混。
- 预期：迭代 1,575 → ≤434（未标 93 个逻辑盘 + 其分片）；配 6a/6b 后 tick 的同步 SQL 回到 ms 级；剩余成本只剩对 93 个未标盘的 recapture（③ 门叶子在，IBD 期 0；同步期按 08-06 稿 §4.2① 两条件 fail-closed 标记后逐渐归零）。

### 3.5 与 NWT 两个候选的对比（NWT 20:2xZ 提）
| 方案 | 每 tick `events` 成本 | schema | 语义 | 判 |
|---|---|---|---|---|
| (i) NWT：每 tick **一次**扫描装 Set（N→1） | 1 次全扫（6a 前 ~0.13–3.5 s；6a 后 <5 ms） | 零 | 同现状 | ✅ 可接受的中间形；**6b 更进一步**：播种一次 + 新标即 add ⇒ 每 tick 0 次，语义仍同现状（标记只增不撤、事件持久）。若担心跨进程别人写标记（今天只有本 worker 写），退回 (i) 每 tick 一扫也行——6a 后两者成本都 ms 级，差别只在哲学 |
| (ii) NWT：`events` 加 `market_id` 生成列 + 索引 | <1 ms | **改 schema**（通用审计表加业务列；`json_extract(payload_json,'$.marketId')` 只对本事件族有意义，其它 event_type 该列 NULL）+ DATABASE.md | 同现状 | ❌ 不推荐：6a 的 `event_type` 前导索引已把 LIKE 候选缩到 341 行（µs 级），生成列多出来的是**一个只服务一个消费者的通用表列**，且 P2-1 A′ 那次已议过生成列会进 `SELECT *` 的对外 JSON（33 处 `.get()`）。**留作 6a 不够时的备选** |
| 本稿 6a + 6b（+6c） | 0 次（首 tick 1 次） | 只加索引（记账式，boot 内建 ~1–2 s） | 同现状 | ✅ 推荐 |

### 不做 / 排除
- ❌ 只拉长 `TICK_MS` / 只加 LIMIT（08-06 稿 §4.1/§4.2② 已排除：重入闸让定时器失效；无序 LIMIT 造"永不被尝试"的不显形故障）。
- ❌ 把 `events` 的 `marketId` 抽成新列 + 索引由写入方回填（Bettor 候选之一）：`events` 是通用审计表，为一个消费者加业务列 = 表语义漂移；6a 的 `event_type` 前导索引已把候选缩到 341，LIKE 在 341 行上是 µs 级，**不需要**再为 LIKE 建索引。
- ❌ 在 `_tick` 里直接跳过 `deadline_daa < floor` 的盘（"锚点已剪永远无事可做"）：**那是判据变更**（08-06 稿 §2.3/§4.2① 已证 floor 用错量、须换剪枝点 + 两条件 fail-closed），本稿不碰；6b 只让"已经标过的"不再重扫，不新增任何标记。

## 4. 落地顺序与包
| 笔 | 内容 | 停机窗 | 审 |
|---|---|---|---|
| ①（已出稿） | env 开关止血 | 否（Bettor 重启一次） | NWT → Bettor |
| 6a | migrate vNNN `idx_events_type_created`（记账式，boot 内建）+ 离线 EXPLAIN 用例 | 否 | NWT |
| 6b | worker 内存集合 + 播种/新标/重启三向量用例 | 否 | NWT |
| 6c | 循环单位/SQL 预滤（形改）；`pruned_expired_waived` 入终态**另小笔** | 否 | NWT（后者判据变更 + Owner 知悉）|
| 收尾 | kanet.env 去掉 `PREPRUNE_CAPTURE_WORKER=0`，worker 重新开；一窗 v3-A 验 `:68/:83` 行 0、tick 行 <1 s | 否 | Bettor |

## 5. 验收判据（每笔各自）
- 6a：`EXPLAIN` 含 `idx_events_type_created`；活库首窗 `sql.get … preprune-capture-worker.mjs:68` 与 `:83` 行 **0**；`preprune-capture-monitor` 等 5 处同形探测 src 在 v3-A 表消失。
- 6b：worker 单 tick 内 `events` prepare 次数 = 0（除首 tick 播种 1 次）；标记语义对拍用例绿。
- 6c：`[preprune-capture-worker] tick: scanned=N` 的 N 从 ~936（分片）降到 ≤93（未标逻辑盘）；lag ≥10 s 事件不再与该站对齐（④ 判据）。
- 全部落地 + 开关移除后一窗：事件循环 lag ≥4 s 次数与 Σ 相对 20:08→21:08Z 窗（本窗页另出）下降，且下降的那部分对齐到本 worker 站点。

## 6. 未做 / 未核
- 活库单次探测 0.2–3.5 s 是 Bettor 读数（活库有写者竞争），我只读副本上量到 127–264 ms；两者同量级同形，结论不变。
- 6c 的候选 SQL 只写了形，未在活库 EXPLAIN（`pool_markets` 4,050 行、`market_shards` 1,341 行，量级小，不会成为新瓶颈；落码时附 EXPLAIN）。
- `[trade-filter:capture]` 在 ③ 放行后仍 "not synced" 是另一条同步态读取路径，观测值已记，未归因。

## 7. Pin（引用本文数字必须一起引）
活库 `D:\kanet-tn12\kasia-console\data\console.db` readonly · 2026-09-06T20:2xZ · console PID 19184（13:56:22Z 起）· ③ 放行 20:08:19Z · `events` 594,985 行 · floor 56,983,539 · 数字随 `events` 写入与结算推进而变，引用前重读。
