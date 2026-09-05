# Phase-2 慢 SQL 根治设计 v0.2.1（P2-1…P2-5 + 横切 P2-0）

> **Status**: DRAFT-FOR-REVIEW · J2 · v0.1 2026-09-05T11:4xZ → **v0.2 2026-09-05T12:0xZ**（`date -u`，吸收 NWT 预审 GREEN-conditional：P2-3 语义翻转缺陷、P2-4 LIKE 不分大小写缺陷、P2-1/P2-2/P2-0 三条条件）· 派工 Bettor（ledger 891 后）· 目标 **09-08 前 NWT GREEN**（IBD 结束 ③ 门放行前）· **不写码**。
> v0.1→v0.2 改动一览：P2-3 SQL 改 `json_valid(...) AND json_extract(...) IS NULL`（原 `NOT(...)` 会把坏 JSON 行变成 handoff 候选，与 JS `catch { continue }` 相反）；P2-4 加"LIKE 对 ASCII 不分大小写"前置核查 + `COLLATE NOCASE` 备选，写入方改为 4 处（`:682/:790/:2163/:2437`）；P2-1 注明生成列会进 `SELECT *` 的对外 JSON（33 处 `.get()`），UI 面归 Owner，重建表须带列；P2-2 影子比对去 LIMIT 按集合比；P2-0 `analysis_limit` 本构建默认 0 ⇒ boot 不 `optimize`，ANALYZE 只具名小表、只在低负荷脚本里跑。
> 依据：v3-A 首窗页 `scratch/_j2_m10v3A_window1_page_2026-09-05T09-57Z.md`（修前基线，60 min 1,047 条 ≥200 ms SQL）、修后页 `…postfix_window1_page_2026-09-05T11-03Z.md`（③ 门下这五条全为 0，**遮住非治好**）。
> 计划形来源：只含 DDL 的空库 `kasia-console/scratch/_j2_p2_explain_schema_only.mjs`（零 IO）+ **活库 readonly 只 EXPLAIN 不执行**（`_j2_p2_counts_readonly.mjs`，每条 <150 ms）。规模数（活库只读轻查 11:3xZ）：`pool_markets` **4,050** 行 / metadata 共 **27.6 MB**（avg 6.8 KB，坏 JSON 0）；`pool_bettor_sides` **36,012**（`claim_txid IS NULL ∧ side_lock_tx ∧ redeem` 33,859）；`payout_shards` 722；`market_shards` 1,341；`chain_events` ≈256k（`bettor_refund_available` **124**）；`kaspa_tx_log` 16.18M；SQLite **3.51.3**（生成列/表达式索引/`MATERIALIZED` 可用）。
> 优先级（Bettor）：P2-1 > P2-2 > P2-5 > P2-3 > P2-4。修法排序原则：加索引/标志列（零行为差）> 改写查询（谓词逐字搬家）> worker（最后）。

## 0. 横切发现 P2-0：活库从未 `ANALYZE`（`sqlite_stat*` 表不存在）
- 事实：`SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_stat%'` ⇒ **空**。planner 无行数/选择率信息，靠启发式（"有等值索引就用"）选计划。
- 后果实证（P2-2）：活库 EXPLAIN 从 `idx_pool_sides_side_lock_tx_unique (side_lock_tx>?)`（覆盖 33,859/36,012 行 ≈ 全表）驱动，再按 PK 找市场并**对每个 side 行**求 `json_extract(pm.metadata, …)`（同一市场的 metadata 被解析几十次）；在空库里塞入近似 `sqlite_stat1`（sides 36012 / markets 4050 / deadline 索引选择率）后，planner 自动改为**市场先行**（`idx_pool_markets_deadline` → sides 按 market_id），每市场只解析一次。
- 修法候选（**独立一笔，NWT 单独审**）：`ANALYZE pool_markets; ANALYZE pool_bettor_sides; ANALYZE market_shards; ANALYZE payout_shards; ANALYZE chain_events;`（**不**含 `kaspa_tx_log` 16M 行，那要分钟级全扫）——**只在低负荷/停机窗的 scratch 脚本里跑，boot 不做**。🔴 v0.2（NWT 实证）：本构建 `PRAGMA analysis_limit` 默认 **0 = 无限** ⇒ `PRAGMA optimize` 一旦判定 `kaspa_tx_log` 需要统计就是 16M 行全量 ANALYZE，放在 boot 里 = 又一个被 boot-age 判活杀掉的形。所以 **boot 不 `PRAGMA optimize`**；若将来要用，必须先 `PRAGMA analysis_limit=1000` 再 `optimize`，且仍不在 boot。小表 ANALYZE 秒级、只读扫描、写 `sqlite_stat1`，不需停机窗。
- 风险面：统计是**全局**的——其它查询的计划也会变（多数变好，个别可能变坏）；验收 = 跑一次前后 EXPLAIN 对照清单（本文五条 + broker-intake + settle/pool 主 SELECT），并盯首窗 `sql.*` 表有无新 src 冒出。**本文对 P2-2 仍给确定性的 `MATERIALIZED` 改写，不把正确性押在 planner 统计上**（统计可能被将来 VACUUM/迁移丢失）。

## P2-1 · `lib/zk-autonomy-ticks.mjs:45` `_scanZkAutonomyCandidates`（closeTickV2 / claim / handoff 三 tick 各扫一次/30 s）
| 项 | 内容 |
|---|---|
| 现 SQL | `SELECT id, metadata FROM pool_markets WHERE metadata LIKE '%zk_continuation%'` → JS 逐行 `JSON.parse` 再筛 `proving.status==='ready' ∧ !exhausted ∧ outpoint ∧ redeemHex` |
| 活库计划 | `SCAN pool_markets`（4,050 行、27.6 MB 文本 LIKE）⇒ **命中 6 行**；三 tick 各扫一次 ⇒ 每 30 s 扫 83 MB；修前 75 行/h p50 0.4 s、**max 106 s**（三次 ≥60 s 大停顿的起点，两次 106 s 背靠背）|
| **修法 A′（v0.2.1 推荐，取代 A）** | **守卫式表达式部分索引，无生成列**：`CREATE INDEX idx_pool_markets_zk_ready ON pool_markets((CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.zk_continuation.proving.status') END)) WHERE (CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.zk_continuation.proving.status') END) = 'ready'`；查询改 `WHERE (CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.zk_continuation.proving.status') END) = 'ready'`（表达式须与索引逐字相同才命中，常量放 `lib/` 一处导出）。内存库实证（J2 12:0xZ）：`SEARCH pool_markets USING INDEX idx_zk_ready_expr (<expr>=?)`、`SELECT *` 列集不变（**无对外 JSON 形状变化 ⇒ 无 Owner UI 项**）、坏 JSON 行 INSERT/UPDATE **不抛**（`json_valid` 在表达式里守卫，修法 B 的写路径风险消失）、只索引 ready 行（部分索引，6 行量级）。**重建表须带索引**的备注仍适用（索引会随表重建丢，v3-A `sql.*` 行会抓回）|
| 修法 A（备选）| **VIRTUAL 生成列 + 部分索引**（零行为差、写入方不改；缺点 = 生成列进 `SELECT *`，见下方 🟡）：`ALTER TABLE pool_markets ADD COLUMN zk_proving_ready INTEGER GENERATED ALWAYS AS (CASE WHEN json_valid(metadata) THEN (json_extract(metadata,'$.zk_continuation.proving.status') = 'ready') END) VIRTUAL; CREATE INDEX idx_pool_markets_zk_ready ON pool_markets(zk_proving_ready) WHERE zk_proving_ready = 1;` 查询改 `WHERE zk_proving_ready = 1`（JS 其余筛选原样保留，`exhausted/outpoint/redeemHex` 仍在 JS 判）。计划 → `SEARCH pool_markets USING INDEX idx_pool_markets_zk_ready (zk_proving_ready=?)`（6 行）。`json_valid` 在生成列表达式里 ⇒ 坏 JSON 行得 NULL 不抛（写路径永不因索引维护失败）|
| 修法 B（备选）| 纯表达式索引 `ON pool_markets(json_extract(metadata,'$.zk_continuation.proving.status'))` + 查询 `json_extract(...) = 'ready'`。少一列，但**坏 JSON 行会让该行 INSERT/UPDATE 抛错**（表达式索引维护时 `json_extract` 抛）——今天 0 坏行，但把"写失败"引进钱路相邻表，不选 |
| 修法 C（顺带）| 三 tick 共用一次扫描（30 s 缓存）——A 落地后每次 <1 ms，无必要 |
| 停机窗 | **不需要**：`ALTER … ADD COLUMN … VIRTUAL` 是元数据操作（O(1)）；`CREATE INDEX` 对 4,050 行各求一次 `json_extract`（27.6 MB 解析）≈ 1–3 s、持写锁 ≤3 s。可走 migrate v200（非 ② 那种 16M 行量级，boot 内建可接受；仍加 `IF NOT EXISTS` + sqlite_master 记账日志）。⚠ drizzle `schema.js` 不知道新列——生成列不入 drizzle schema 无害（drizzle 只读它声明的列）|
| 🟡 对外形状（v0.2，NWT；**仅修法 A 才有，A′ 无**）| 仓内 **33 处 `SELECT * FROM pool_markets`（全是 `.get()` 单行；其中 API 层 16 处：`api/pool.js` 15、`api/admin-dedup.js` 1；services 层 17 处）**：生成列会出现在 `*` 里 ⇒ 这些 market 对象多一个 `zk_proving_ready` 键（0/1/NULL）。NWT grep：无 `INSERT…SELECT *`、无行展开写回 ⇒ 不破功能；但凡有 API/UI 把整行 JSON 原样吐给前端的，就是**对外 JSON 形状变化** ⇒ 页里写明，涉 UI 归 Owner 批（或改用 `SELECT <列清单>`，另案）。备注：今后任何**重建 `pool_markets` 表**的迁移（SQLite 加 CHECK/改列都要整表重建）必须把生成列与部分索引一起带上，否则 P2-1 静默退化回全扫（v3-A `sql.*` 行会把它抓回来，但要有人看）|
| 验收 | v3-A：`sql.all … src=src/lib/zk-autonomy-ticks.mjs:45` 行 **0**（阈 200 ms）；`EXPLAIN` 含 `idx_pool_markets_zk_ready`；候选集合前后相等（离线：临时库塞 ready/非 ready/exhausted/坏 JSON 四类行，新旧两查询 + JS 筛后 `marketId` 集合逐一相等）|
| 风险面 | **钱路相邻**（closeTickV2/claim 广播的候选集合）：修法只改"怎么找到候选"，不改"找到后做什么"；候选集合等价靠离线测试 + 上线首窗对照（旧 LIKE 查询保留为 `_scanZkAutonomyCandidatesLegacy` 一周，每 tick 比对集合、不等则 LOUD，之后删）|

## P2-2 · `services/pool-market-settler.js:497`（`legacyRefundBuilderTick` 的 sides 扫描 · **P1 退款授权闸所在**）
| 项 | 内容 |
|---|---|
| 现 SQL | `SELECT pbs.…, pm.deadline, pm.protocol_version FROM pool_bettor_sides pbs JOIN pool_markets pm ON pm.id = pbs.market_id WHERE ( (pm.protocol_version IS NULL OR = 'v0.5') OR pm.id IN (<unfixable>) OR (pm.protocol_status IN ('cancelled','refunded') AND pm.protocol_version IN ('v0.6','v0.7')) ) AND pm.deadline <= ? AND pbs.side_lock_tx IS NOT NULL AND pbs.claim_txid IS NULL AND (pbs.refund_attempted_at IS NULL OR < datetime('now','-1 hour')) AND json_valid(pm.metadata) AND json_extract(pm.metadata,'$.refund_authorization') IN (…) ORDER BY pbs.stake_amount ASC LIMIT ?` |
| 活库计划 | `SEARCH pbs USING INDEX idx_pool_sides_side_lock_tx_unique (side_lock_tx>?)` → `SEARCH pm (id=?)` → `TEMP B-TREE FOR ORDER BY`：sides 驱动 33,859 行，**每 side 求一次 `json_extract(pm.metadata)`**（≈230 MB JSON 解析/tick）；修前 50 行/h p50 1.3 s、max 69 s |
| 修法（推荐）| **`WITH m AS MATERIALIZED (…市场谓词逐字搬家…) SELECT … FROM m JOIN pool_bettor_sides pbs ON pbs.market_id = m.id WHERE <sides 谓词逐字> ORDER BY … LIMIT ?`**。计划 → `MATERIALIZE m: SEARCH pm USING INDEX idx_pool_markets_deadline (deadline<?)` → `SCAN m` → `SEARCH pbs USING INDEX idx_pool_sides_market (market_id=?)`：市场 4,050 行各解析一次 metadata（27.6 MB，≈50–100 ms），sides 按索引点查。`MATERIALIZED` 让计划**不依赖统计**（P2-0 落不落都成立）。谓词一字不改、只是分层：`pm.*` 条件进 CTE，`pbs.*` 条件留外层，`ORDER BY/LIMIT` 不动 ⇒ 结果集合与顺序相等（LIMIT 内 stake 相等行的并列顺序 SQLite 本就未定义，前后同样未定义，不算变化——NWT 判）|
| 停机窗 | 不需要（纯查询改写）|
| 验收 | `sql.all … src=…pool-market-settler.js:497` 行 0；EXPLAIN 含 `MATERIALIZE m`；离线：临时库构造三入口各 ≥2 市场 × 多 side（含 `refund_attempted_at` 新旧、`claim_txid` 有无、坏 JSON 市场）新旧查询结果 **逐行相等**（同 `ORDER BY stake_amount, side_id` 归一后比）。🟡 v0.2（NWT）：**影子比对去掉 LIMIT 按集合比**（或 LIMIT 放大到 ≥ 全量），否则 LIMIT 边界上 `stake_amount` 并列行两边取到不同行 = 假阳性 |
| 风险面 | 🔴 **钱路**：这条 SELECT 就是 P1「验不成 ≠ 可以退款」授权闸（`docs/2026-08-04-p1-…` §10.1）——它选出的行会被拿去发退款。任何谓词漂移 = 闸失效。⇒ 改写只允许"搬家不改字"，NWT 逐谓词对拍；上线保留旧查询影子比对一周（同 P2-1 法）；由 Owner 批（用户面/钱路）|

## P2-5 · `api/pool.js:3300` my-positions 主查询（④ 只降频/排除，查询本身未修）
| 项 | 内容 |
|---|---|
| 现 SQL | `… FROM pool_bettor_sides s LEFT JOIN market_shards ms ON ms.shard_market_id = s.market_id LEFT JOIN pool_markets m ON m.id = COALESCE(ms.logical_market_id, s.market_id) WHERE s.bettor_pk = ? ORDER BY s.created_at DESC`（+ `:3402` 同路第二条 `WHERE s.bettor_pk = ? AND s.direction = ? AND COALESCE(…) = ?`）|
| 活库计划 | `SCAN s`（36k 行全扫）→ `SEARCH ms (shard_market_id=?)` → `TEMP B-TREE FOR ORDER BY`；修前 465 行/h p50 0.84 s（1,694 side 的测试地址）、真人 26 side 0.39 s |
| 修法（推荐）| 索引 **`CREATE INDEX idx_pool_sides_bettor_created ON pool_bettor_sides(bettor_pk, created_at DESC)`**。计划 → `SEARCH s USING INDEX idx_pool_sides_bettor_created (bettor_pk=?)`，**无 TEMP B-TREE**（索引序即 ORDER BY 序）；`:3402` 也走它（`bettor_pk=?` 前导）。零查询改写 |
| 顺带（另案）| handler 后半段的 BigInt 分账 + 10 MB JSON 序列化是主线程 CPU（NWT 首窗 7% 口径）——分页/`?since=` 属 API 行为变化（用户面），不在本稿 |
| 停机窗 | 不需要：36k 行建索引 <1 s，可 migrate v200 boot 内建（IF NOT EXISTS + 记账日志）|
| 验收 | `sql.all … pool.js:3300` 行 0（真人 26 side 应 <50 ms）；EXPLAIN 含新索引无 TEMP B-TREE；结果集合/顺序不变（索引序 = `created_at DESC`，并列 `created_at` 的顺序前后都未定义）|
| 风险面 | 无钱路；写放大：每 INSERT side 多维护一个索引（36k 行量级可忽略）|

## P2-3 · `lib/zk-autonomy-ticks.mjs:239` `_scanHandoffCandidates`（handoff tick /30 s）
| 项 | 内容 |
|---|---|
| 现 SQL | `SELECT pm.id, ps.payout_redeem_hex, pm.metadata FROM payout_shards ps JOIN pool_markets pm ON pm.id = ps.logical_market_id` → JS 逐行 parse metadata、跳过已有 `zk_continuation`、`readPayoutShardV2AttestedState(redeemHex)`（Buffer 读，廉价）|
| 活库计划 | `SCAN ps`（722）→ `SEARCH pm (id=?)`：计划形本身合理；成本在**每 tick 搬运 722 份 metadata（≈5 MB）并 JS 解析**；修前 88 行/h p50 1.2 s、max 45 s（max 大概率是被别人堵住时的排队墙钟，见 ④ 判据"受害者"）|
| 修法（推荐）| 不取 metadata 血：`SELECT pm.id AS marketId, ps.payout_redeem_hex AS redeemHex FROM payout_shards ps JOIN pool_markets pm ON pm.id = ps.logical_market_id WHERE json_valid(pm.metadata) AND json_extract(pm.metadata,'$.zk_continuation') IS NULL`；候选（通常 0–几个）再按 id 单取 `metadata` 供下游 `meta.zk_handoff_pending`（`:284` 用到）。SQL 侧对 722 行各做一次 `json_extract`（≈5 MB 解析，10–30 ms）但**不再把 5 MB 传给 JS 再 parse 一遍**。若 P2-1 修法 A 落地，可再加生成列 `zk_has_continuation`（同表达式）让这条也走索引——增益小，先不做。🔴 **v0.1 缺陷（NWT 抓）**：v0.1 写的是 `WHERE NOT (json_valid(...) AND json_extract(...) IS NOT NULL)`——对坏 JSON 行 `NOT(false)=TRUE` ⇒ 坏 JSON 市场会变成 handoff 候选，而现 JS 是 `catch { continue }` **跳过**它。v0.2 改为两条件同真才算候选，与 JS 等价（坏 JSON ⇒ `json_valid`=0 ⇒ 不候选）。教训进验收：离线四类里"坏 JSON"那类必须断言**不在**候选集 |
| 停机窗 | 不需要（查询改写 + 候选补取）|
| 验收 | `sql.all … zk-autonomy-ticks.mjs:239` 行 0；离线：临时库构造 有/无 `zk_continuation`、坏 JSON、redeem 非法 四类，新旧候选集合相等 |
| 风险面 | 钱路相邻（handoff 广播候选）：候选集合等价靠离线测试 + 影子比对一周 |

## P2-4 · `services/bettor-refund-claim-auto.mjs:57`（claim-auto tick /5 min）
| 项 | 内容 |
|---|---|
| 现 SQL | `… FROM pool_bettor_sides s JOIN pool_markets m … WHERE s.claim_txid IS NULL AND s.side_lock_tx IS NOT NULL AND s.side_redeem_script_hex IS NOT NULL AND EXISTS (SELECT 1 FROM chain_events ce WHERE ce.event_type='bettor_refund_available' AND ce.payload LIKE '%"market_id":"'‖s.market_id‖'"%' AND ce.payload LIKE '%"bettor_pk":"'‖s.bettor_pk‖'"%')` |
| 活库计划 | `SEARCH s (side_lock_tx>?)`（33,859 行）→ `SEARCH m (id=?)` → 每行一次 `SEARCH ce EXISTS USING INDEX idx_chain_events_type (event_type=?)`（124 行 × 2 个 LIKE）⇒ **≈4.2M 次 LIKE / tick**；修前 12 行/h p50 4.1 s、max 15.3 s |
| 修法（推荐）| 反转驱动方向：`WITH ra AS (SELECT DISTINCT json_extract(payload,'$.market_id') AS market_id, json_extract(payload,'$.bettor_pk') AS bettor_pk FROM chain_events WHERE event_type='bettor_refund_available' AND json_valid(payload)) SELECT … FROM ra JOIN pool_bettor_sides s ON s.market_id = ra.market_id AND s.bettor_pk = ra.bettor_pk JOIN pool_markets m ON m.id = s.market_id WHERE s.claim_txid IS NULL AND s.side_lock_tx IS NOT NULL AND s.side_redeem_script_hex IS NOT NULL`。计划 → `CO-ROUTINE ra: SEARCH chain_events USING INDEX idx_chain_events_type` → `SCAN ra`（124）→ `SEARCH s USING INDEX idx_pool_sides_market_bettor (market_id=? AND bettor_pk=?)`（点查）⇒ 124 次索引点查代替 4.2M 次 LIKE。语义：**四个写入方（`pool-market-settler.js:682 / :790 / :2163 / :2437`，NWT 四处全核，v0.1 写的 `:778/:2151` 是行号漂移）**的 payload 都是 `JSON.stringify({ market_id, bettor_pk, … })` ⇒ `json_extract` 等值对应原 LIKE 子串匹配；`json_valid(payload)` 守卫坏 JSON（语义差 1：坏 JSON 但含子串的事件，新法不认——审计事件都是我们自己 `JSON.stringify` 写的，可接受）。🔴 **语义差 2（v0.2，NWT 实证）：SQLite `LIKE` 对 ASCII 不分大小写**（`'…"ABC"…' LIKE '%"abc"%'` = 1；`client.js` 未设 `case_sensitive_like`），而 `s.bettor_pk = ra.bettor_pk` 是精确比较 ⇒ 若任一事件 payload 的 `bettor_pk`/`market_id` 与 side 行大小写不同，现在匹配、新法不匹配（`voter_pubkey` 大小写不对称是本仓已知 MUSTFIX 族）。写入方四处都用 `side.bettor_pk`/`market.id` 原值，理论同案，但**落地前置条件**：在备份副本（只读）上跑一次 `COUNT(*)` — 事件 `json_extract` 值与 side 行 `lower()` 相等而原值不等的对数，**须为 0**；不为 0 ⇒ 用 `COLLATE NOCASE`（索引 `idx_pool_sides_market_bettor` 也得 NOCASE，否则走不了索引）或先归一化写入方。影子比对一周保留 |
| 停机窗 | 不需要 |
| 验收 | `sql.all … bettor-refund-claim-auto.mjs:57` 行 0；离线：临时库构造 匹配/只匹配 market_id/只匹配 bettor_pk/坏 JSON 四类事件 × sides 三态，新旧结果集合相等（坏 JSON 类按上述差异单列）|
| 风险面 | 🔴 钱路（自动退款 claim 的候选）：同 P2-2 纪律——谓词对拍、影子比对一周、Owner 批 |

## 4. 落地顺序与打包（建议，Bettor 排）
| 批 | 内容 | 停机 | 审 |
|---|---|---|---|
| A（零行为差）| P2-5 索引 + P2-1 守卫式表达式部分索引 A′（migrate v200，boot 内建 ≤3 s，IF NOT EXISTS + 记账；A′ 无 schema 列变化 ⇒ 不再需要 Owner 批 UI 面，只剩 P2-1 查询改写本身的钱路相邻审）| 否 | NWT |
| B（查询改写·非钱路）| P2-3 | 否 | NWT |
| C（查询改写·钱路）| P2-2 `MATERIALIZED` 分层、P2-4 反转驱动；各带影子比对一周 | 否 | NWT + Owner |
| D（横切）| P2-0 小表 `ANALYZE` + boot `PRAGMA optimize`；前后 EXPLAIN 清单对照 | 否（低负荷时）| NWT 单独 |
- 全部在 ③ 门放行（IBD 结束）**之前**落，让放行后首个 1 h 窗直接成为验收窗；验收统一用 v3-A `sql.*` 表（五个 src 各自 0 行）+ lag ≥4 s 次数/Σ 与修前页并排。
- 影子比对（P2-1/2/3/4）：新查询为准执行，旧查询只算集合、不参与执行，差异 LOUD 到 `events`（`event_type='phase2_shadow_mismatch'`）；一周零差异后删旧查询（单独一笔）。

## 4b. NWT 复审 GREEN（v0.2.1，2026-09-05T12:2xZ）· 落码三条件（进每笔 diff 的验收）
- **C1 表达式单源**：与 `heavy-index-v199.mjs` 同形——一个模块导出 `ZK_READY_EXPR`（字符串常量）+ `ZK_READY_INDEX_DDL`；migrate v200 与 `_scanZkAutonomyCandidates` 的查询都 import 它拼 SQL，**禁止两处手打**（表达式差一个空格以外的字符就不走索引）。
- **C2 查询用字面量 `= 'ready'`，不用绑定参数**：本构建 `= ?` 绑 'ready' 也走索引，但那是版本行为不是契约；部分索引可用性靠"查询谓词蕴含索引谓词"，字面量才稳。测试加一向量：`EXPLAIN QUERY PLAN` 断言含 `USING INDEX idx_pool_markets_zk_ready`。
- **C3 P2-4 前置核查 SQL**（备份副本 readonly，J2 跑、NWT 复核数字）：`SELECT count(*) FROM (SELECT DISTINCT json_extract(payload,'$.market_id') m, json_extract(payload,'$.bettor_pk') b FROM chain_events WHERE event_type='bettor_refund_available' AND json_valid(payload)) ra JOIN pool_bettor_sides s ON lower(s.market_id)=lower(ra.m) AND lower(s.bettor_pk)=lower(ra.b) WHERE s.market_id<>ra.m OR s.bettor_pk<>ra.b` 须 **= 0**；不为 0 ⇒ `COLLATE NOCASE`（连接列与索引同 NOCASE）。
- NWT 独立实证 A′：同表达式 `= 'ready'` ⇒ `SEARCH … USING INDEX (<expr>=?)`；只索引 ready 行；`SELECT *` 列集不变；坏 JSON 写不抛；去外层括号写法也命中。**A′ 取代 A 成立。**

## 5. 未做 / 未核
- 真实耗时只在活库上才有意义，本稿只给计划形与规模数；每项落地后用 v3-A 行做验收，不预估 ms。
- P2-2/P2-4 的谓词等价与影子比对是 NWT/Owner 闸；本稿只给形。
- `bettor_refund_available` 写入方 4 处（`:682/:790/:2163/:2437`）payload 键 NWT 四处全核在（v0.2）；大小写前置核查（P2-4）在落地前于备份副本上做，本稿未做。
- NWT 预审（v0.1 → v0.2）：GREEN-conditional，两缺陷已改、四条件已入；下一版 NWT 按 diff 核 P2-2 谓词逐字搬家。
