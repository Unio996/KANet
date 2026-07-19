# Relay Catch-Up Thundering-Herd — 根因设计 + 修复方案

> **Status**: CURRENT（design，待 NWT 红队 + Bettor 审 + Owner 批钱路/生产改动。**11:51Z 重大更正见下，先读这段再读全文**）

**Owner**: J2
**日期**: 2026-07-19
**授权范围**: Bettor 派工 #21，追 11:28Z console 冻结事件根因
**Source commit**: `6da0f1623303f3e7a9253ab497a1a88c7291b7d0`（本设计基于此 commit 读码，未改任何 live 代码）

---

## 🔴 2026-07-19 11:51Z 重大更正——因果方向被推翻，先读

本文档前半部分（"根因链条"章节）建立在一个**已被证伪的因果假设**上："31 relay 同一秒齐发 catch-up（11:29:31.14-32.41）→ 打爆 console → 冻结 → supervisor 判死重启"。

**KANet-UI 用 `console-supervisor.log`（独立于 console 自身，重启不会抹掉）精确核对时间线后指出这个因果箭头反了**：
```
11:28:21Z  health fail #1/3
11:28:53Z  health fail #2/3
11:29:26Z  health fail #3/3 → 判 console death → 触发重启
11:29:30Z  新 console 进程 pid=68076 起来
11:29:31.14-32.41Z  31 relay 齐发 catch-up  ← 在重启之后！
```
31-relay catch-up burst **发生在新 console 进程启动之后**，是 `relay-manager` 重启后重新 fork 全部 31 个 relay 子进程的**确定性正常恢复序列**（每个 relay 进程启动时都会跑一次 `rpc-listener.mjs:523` 的 `catchUpHistory()`），**不是导致 11:28:21 起就开始健康探测失败的原始触发器**。真正让 console 在 11:28:21 之前就已经不健康的原因**仍未找到**。

**进一步复杂化（NWT 11:51Z 发现）**：完整 `[diag:eventloop-lag]` 记录不止 11:30:26 那一条 14.8s，还有 11:30:29(3.0s)、**11:34:23(16.1s，比第一次还大)**、11:34:26(2.9s)、11:34:32(2.5s)——是一串零星聚集出现的 lag 事件，跟"单次 relay-refork 风暴"这种规律复发模式对不上，更像今晚早前 RPC-staleness P0 那次"长驻进程渐进式劣化"同一族问题（11:34:23 那次目前尚未核实是否也对应某个 relay 重连事件，留作后续跟进）。

**本文档下方的"根因链条"三层分析（① api.kaspa.org 数据源 / ② 定时器无 jitter / ②b log-pipe 背压 / ③ 索引缺失）里描述的现象本身都是真实的、经过 live 验证的事实**（api.kaspa.org 确实必 404、31 个 relay 确实存在且确实会在重启后同秒齐发、并发确实会拖慢 console 请求处理），**只是它们描述的是"重启后的正常恢复序列"，不是"最初冻结的原因"**。保留这些分析是因为其中的观测和修复本身仍有独立价值，但**不再声称它们是本次 11:28Z 冻结事件的根因**。

**#21 最终修复方向（Bettor 11:51Z 拍板）**：
- **✅ 保留为主修**：修复④（health-check 优先级隔离）——**cause-agnostic**，不管最初冻结的真因是什么，只要"console 忙但活着"不该被误判 death 这条防御本身就成立，不依赖找到真触发器。
- **⏸ 降级、暂缓**：修复②（jitter 打散 relay 定时器相位）——它让*重启后*的恢复序列更平顺，仍有价值，但**不再是"冻结主修"**，因为它治的是果不是因。
- **⏸ 保持次要**：修复①③（数据源纠正 / 索引）——独立价值不变（省浪费、优化查询），但同样不是主修。
- **🔍 新首要任务（未完成，留给后续接手）**：查 11:28:21 之前（尤其 11:24:40-11:28:21 这几次此前已自愈的 health-fail #1，per NWT 更早发现）+ 11:34:23 那次更大的 lag 事件前是否有对应的 relay 重连/重启或其他异常，找到真正让 console 开始退化的触发器。**本设计不再声称已锤定根因**，这是诚实的未完成状态，不是回避。

**11:53Z 该任务的调查结果（J2）**：查了 DB 侧周期任务表（`chain_snapshots`/`broker_workflow_markers`）时间戳，只看到 11:20/11:25 正常 5 分钟 tick、11:30 那一轮该到的没到——这只是"冻结后周期任务停摆"的症状，不是原因，没有提供新线索。结合 KANet-UI/NWT 独立核实：`logs/` 下没有任何文件覆盖 11:20-11:29 这段应用层细节（`console.log` 本身重启即冲掉，不是跨重启持久化的日志源，与 `_state.json` 丢 linkedAddr 是今晚已反复踩到的同一个"不持久化易失存储"模式）。**结论：这段应用层证据在当前可用数据里已经不可恢复，本次事件的确切触发器锁定到此为止，不再继续挖掘不可能挖到的东西。**

**长期基建建议（新增，供 #21 或另立跟踪项）**：给 console 加一个**独立于 `console.log` 本身、append-only、不受进程重启影响**的诊断环形缓冲/心跳记录（例如定期写入一个单独文件或 DB 表，记录心跳时间戳 + 关键指标如 eventloop-lag/heap/活跃连接数），这样下次再发生类似事件，冻结前的窗口就不会随进程重启一起消失。当前 `console-supervisor.log`（独立进程，本次唯一幸存的精确时间线来源）证明了"独立于目标进程本身的记录层"这个思路是有效的，值得把颗粒度从"health fail 时间戳"扩展到"关键运行时指标"。

---

## 事件回顾

- 11:28:53Z–11:29:26Z：supervisor 连续 3 次健康探测失败 → 判 console death → 自动重启（安全网生效，betting 中断约 1 分钟）。
- `[diag:eventloop-lag] gap=15800ms lag=14800ms at=2026-07-19T11:30:26.264Z` — console 自身事件循环记录到 14.8 秒的阻塞。
- NWT 独立核实：`catch-up comm` 日志行按分钟拆分 = 11:28: 0 / **11:29: 2130** / 11:30: 70 — 精确对上 relay-health monitor 重启 FaucetRelay-tn-2 的时刻（11:29:30.671Z）。

## 根因链条（三层，均已代码级验证，非猜测）

### 层① — 数据源 bug（真实但与冻结物理无关，独立修）
`kasia-relay/src/rpc-listener.mjs:665-666`：
```js
const txRes = await fetch(`https://api.kaspa.org/transactions/${record.txid}`, ...)
```
`api.kaspa.org` 是公网 mainnet-facing explorer，对 TN12 自建测试网的 txid **必然 100% 404**（KANet 无公开 TN12 explorer 是已确认事实，见记忆 `reference-no-public-explorer-tn12-kanet-has-no-website`）。

**重要澄清（本设计初稿一度误判、已自纠）**：relay 由 `relay-manager.js:87` 用 `child_process.fork()` 起，是**独立 OS 进程、独立事件循环**——relay 自己打外部 `api.kaspa.org` 的网络等待，物理上**不会**阻塞 console 的事件循环（两个进程各自独立跑）。这条是真实的、100% 浪费的死路调用（该修），但**不是**冻结的直接机制。

### 层② — 无 jitter 的周期定时器（真正的同步触发源）
`kasia-relay/src/rpc-listener.mjs:35,528-530`：
```js
const CATCHUP_RETRY_INTERVAL_MS = 60000;
...
_catchupTimer = setInterval(() => { catchUpHistory().catch(...) }, CATCHUP_RETRY_INTERVAL_MS);
```
每个 relay 进程各自独立起一个**固定 60000ms、零 jitter** 的定时器，周期性调用 `catchUpHistory()`（内含 3 个子查询，其中 handshake + unreplied-messages + pending-comm 三条都会打 console 本地 API）。

console 当前管理 **~31 个** relay 进程（`[relay-health] tick eligible=31`）。今晚 console/relay 经历过多轮批量重启（RPC P0、link 绑定 P0 等各自触发过重启），**大批 relay 进程很可能是同批时间点起的**，各自的 60s 定时器相位高度接近 → 周期性地在同一个 ~1s 窗口内**同时**触发 `catchUpHistory()`，形成 thundering herd（惊群）。

FaucetRelay-tn-2 这次的重启（`relay-health` 探测到 dead → auto-restart）只是**触发点**：它重启后立即调一次 `catchUpHistory()`（`rpc-listener.mjs:523`，启动时跑一次），这次调用恰好落在一个已经因相位对齐而聚集的批量触发窗口里，成为压垮骆驼的最后一根稻草，不是唯一原因。

### 层②b — 竞争/互补候选机制（KANet-UI 发现，未定论，需一并红队）
`relay-manager.js:87` fork 配置是 `stdio: ['ignore','pipe','pipe','ipc']`（显式 pipe，非 inherit）——console 自身订阅每个 relay 子进程的 stdout/stderr `'data'` 事件，对每一行调用自己的 `console.log()`（`relay-manager.js:90/102/110`）。2130 行/分钟意味着 console **自己的进程**在那个窗口内执行了 2130 次同步 `console.log()`（写向持续增长的 console.log 文件）。这条**不需要**假设 relay 主动发 HTTP 请求给 console，纯粹是"多 relay 高频输出 → console 逐行同步写日志文件"的背压，可能比"relay 打 console API"（层②本节）更直接、或与其叠加共同致使阻塞。

**两条机制的关系**：无论最终 console 端阻塞的具体机制是 layer② 的 API 调用负载、这里的 log-pipe 背压、还是两者叠加，**触发"为什么 2130 行集中在一分钟内"这件事本身，都要靠层②"多 relay 60s 定时器相位对齐"这个根因来解释**（单个 relay 按 150ms/条节奏跑一分钟上限约 400 行，2130 行需要多 relay 近乎同时触发）。这意味着**修复②（加 jitter 打散相位对齐）对两种候选机制都有效**——无论最终坐实是 (a) 还是 (b)，把触发窗口摊平都能直接压低瞬时峰值。修复①③仍各自独立成立（数据源浪费 / DB 索引缺失），但**本设计的核心根治点仍是修复②**，(a)/(b) 之争影响的是"是否还需要给 console 的日志管道加背压保护"这一条**追加**措施，不影响修复②的必要性。

**待验证（KANet-UI 提议的具体测法）**：量测当前 console.log 文件大小下单次同步 write() 的实际耗时，或模拟高频 console.log 调用复现延迟量级，来判定 (a)/(b) 各自的贡献占比。本设计暂不下定论，留给红队/后续实测。

### 层③ — console 侧被打中的具体端点无索引（放大器，量化验证；针对候选机制 (a)）
`kasia-console/src/api/discovery.js:479-488`（`GET /api/discovery/message-index`）：
```sql
SELECT ... FROM kanet_message_index WHERE 1=1 AND payload_type = ? AND processed_at IS NULL ORDER BY block_time ASC LIMIT 100
```
`kanet_message_index` 现有索引（`idx_kanet_msg_for_address`/`from_address`/`txid`）**均不覆盖** `(payload_type, processed_at)` 或 `block_time` 排序，SQLite 对这条查询做全表扫描 + 排序。

**实测**（本次 session 直接对 live DB 跑同款查询）：
- 表总行数：104,706
- 单次查询耗时：**40ms**

better-sqlite3 是**同步**调用（阻塞整个 Node 单线程，无 async 让出）。若 ~20-30 个 relay 进程在同一窗口内几乎同时命中这条端点（外加 handshake/unreplied-messages 的类似查询），console 单线程需要逐个串行处理，40ms × N 台 relay 的累加 + 请求排队开销，量级上足以解释观测到的 14.8 秒事件循环阻塞。

---

## 修复方案（三条，按影响面/风险分层，均只读设计，未改 live 代码）

### 修复① — 数据源纠正（低风险，纯浪费消除）
把 `catch-up comm` 分支从打 `https://api.kaspa.org` 改成本地数据源：
- 优先复用今晚已验证过的方式：直连本地 RPC `rpc.getBlock()` / 已有的 `kaspa_tx_log` 本地 indexer（有完整性缺口但覆盖大多数场景，回退到 RPC block-scan）。
- 若本地查不到 payload（indexer 漏记 + RPC 也查不到，如老盘区块已 pruned），按现有 skip 逻辑处理（不阻塞整体 catch-up 循环）。
- 影响面：仅 relay 自身进程内部逻辑，不涉及 console/DB/covenant，风险最低，可独立先上。

### 修复② — 定时器加抖动（jitter）（核心根治，中等风险，需红队）
把固定 `CATCHUP_RETRY_INTERVAL_MS=60000` 改成基础值 + 随机抖动，例如：
```js
const jitterMs = Math.floor(Math.random() * 20000); // 0-20s 随机偏移
_catchupTimer = setInterval(..., CATCHUP_RETRY_INTERVAL_MS + jitterMs);
```
或更稳健：每个 relay 启动时用自身 `relayNodeId` 做确定性哈希取一个固定偏移（同一 relay 每次偏移一致，便于排查；不同 relay 天然错开）。
目的：让 ~31 个 relay 的周期触发在 60s 窗口内均匀打散，而不是集中在同一瞬间，把峰值请求量摊平。
影响面：改变每个 relay 的实际调用时机（不改变调用内容/频率总量），风险中等，需要 NWT 红队确认不会引入新的时序假设错误（例如某处依赖"整点触发"的隐藏假设）。

### 修复③ — console 端索引补齐（低风险、独立可上，配合①②效果更好）
给 `kanet_message_index` 加一条覆盖索引：
```sql
CREATE INDEX idx_kanet_msg_unprocessed ON kanet_message_index(payload_type, processed_at, block_time);
```
把单次查询从全表扫描降到索引查找，即使未来 relay 数量增长或表继续增大，单次查询成本也不会线性劣化。
影响面：纯 DB schema 加索引，只读查询优化，不改写路径，风险最低（唯一要过 migrate.js 版本号流程）。

### 修复④ — health-check 端点优先级隔离（Bettor 11:49Z 拍板，#21 主修之一）
根治"冻结→supervisor 误杀"这条链的第二环：即使 console 因并发 burst 变慢（忙但活着），health-check 探测本身也不该被普通业务请求（catch-up 等）排在同一个 Fastify 请求队列后面等到超时。做法：给 health-check 端点独立轻量路径，不与 catch-up/业务 API 共享同一处理队列/优先级（例如更早的路由匹配、或独立轻量 HTTP server 只服务 health、或给 Fastify 加请求优先级机制）。
影响面：改变 health-check 请求的处理路径，需要确认不改变探测语义本身（仍要能真实反映 console 存活状态，不能沦为"永远秒回但 console 其实卡死"的假阳性），需 NWT 红队重点看这条。

---

## 建议落地顺序（2026-07-19 11:46Z 更新——(a)/(b) 微基准均被实测证伪，真因仍待锤定）

**11:45-11:46Z 实测结果（两条独立 live 验证，几乎同时完成）**：
- **(a) 查询贵？证伪**——Bettor 直接 live 计时同款查询：**35ms**，返 70 行。EXPLAIN 显示全表 SCAN（层③索引缺失属实），但 live 耗时便宜。35ms × 31 relay ≈ 1s 级，够不上观测到的 14.8s。
- **(b) log-pipe 背压？证伪**——KANet-UI 在隔离副本上模拟 2130 次同步 `appendFileSync`（当前文件~3.5MB 及 padding 到~22.5MB 两种量级）：总耗时均 ~109ms（avg 0.05ms/次），与文件大小基本无关（O(1)），离 14.8s 差两个数量级。

**两个微基准都测出"便宜"，但都解释不了观测到的 14.8s 冻结——说明瓶颈很可能不在"单次操作有多贵"，而在真实故障场景下的\*并发聚合效应\*，两个孤立微基准都没有建模这一点。**

**精确请求量数据（J2 11:46Z 查证，纠正了一处口径混淆）**：11:29:31.140Z–11:29:31.920Z 这不到 1 秒的窗口内，**恰好 31/31 个 relay 进程**全部打出各自的 `catch-up: 70 pending historical comm TX`（硬实锤，phase-align 触发假说不再是推测）。**注意口径**：那 2130 行"catch-up comm: API xxx"日志是每个 relay **进程内部**打外部 `api.kaspa.org` 产生的（不打 console），不能等同于"console 收到 2130 个请求"。真正打到 console 本地 API 的，是这 31 个 relay 各自的**批量 GET**（一次性拿 70 条，不是逐条打）+ catchUpHistory 另外 2 条子查询（handshake / unreplied-messages），粗算约 **31×3≈93 个真实 console 请求**聚集在 <1 秒窗口内——这是"请求队列饱和"假说该验证的正确量级，不是 2130。

**当前状态（诚实标注，不选边站）**：真因未锤定。**"~93 个并发请求在 <1 秒内挤爆 Fastify 请求队列，导致 health-check 请求本身也排队超时"**是当前最具解释力的候选（能覆盖"证伪 a/b 单次成本但观测到秒级冻结"这个数量级缺口），但仍待 KANet-UI 正在跑的**30 并发端到端聚合延迟复现测试**（模拟真实并发场景，而非孤立单操作耗时）验证坐实。

**落地顺序（不依赖 a/b 结论、均已知是真实改进，但均不得标注"已修 freeze"）**：
1. **修复①（数据源纠正）**：优先级回落至"独立价值——省浪费调用 + 减少无意义日志噪音"，**不再**因为(b)机制而标"并列第一"（(b)已证伪，该理由链失效）。仍值得做，但不是本次冻结的主修。
2. **修复③（索引）**：同样独立价值（优化一条明确缺索引的查询），但 live 计时已证实非本次冻结瓶颈，不改变"是否修"的判断，只改变"这是不是主修"的判断——不是。
3. **修复②（jitter）**：**仍是本设计认为最贴近真因的核心杠杆**——无论最终"请求队列饱和"假说是否 100% 坐实，打散 31 个 relay 的相位对齐本身直接消除了"<1 秒内 93 个并发请求"这个已经实测坐实的聚合触发条件，是唯一同时对"phase-align 触发"和"下游随便什么阻塞机制"都有效的措施。仍需 NWT 红队 + Bettor 审，力争 19:00Z 前。
4. **待 KANet-UI 30 并发复现测试结果**：若坐实"请求队列饱和"，追加 Fastify 层面的 health-check 请求优先级隔离（不与普通业务请求共享同一队列，或给 health-check 单独端口/进程）——这条目前设计未覆盖，视测试结果决定是否新增。

## 未覆盖 / 待确认（2026-07-19 11:48Z 最终状态——诚实标注：全量级未 100% 锤定）

**KANet-UI 精确复现测试结果（用修正后的 93 请求量，非早前误用的 2130）**：
- 93 并发请求 burst 耗时：avg 1980ms / max 3898ms，health 探针被堵到 3.3-3.8 秒。
- 31→93（3 倍负载）对应 1.3s→3.9s 排队延迟，**近似线性缩放**，非爆炸式增长。
- **按此线性模型外推，要达到观测到的 ~30s 排队延迟需要 700+ 并发请求量级，远超实测坐实的 93 个。**

**结论（不假装比实际知道的更多）**：
1. ✅ **已坐实**：31 个 relay 进程的 60s 无 jitter 定时器确实会相位对齐，在 <1 秒内同时触发（11:29:31.140-31.920Z 硬数据）。
2. ✅ **已坐实**：这种并发触发确实会造成 console 端请求排队延迟（35ms→687ms/1309ms@31 并发，35ms→1980ms/3898ms@93 并发均实测验证），排队机制真实存在且方向正确。
3. ❌ **未坐实**：纯请求排队饱和（线性模型）在实测的 93 并发量级下，只能解释到 ~4 秒级延迟，距观测到的 ~30 秒（health-fail 3 次跨窗口）/14.8 秒（event-loop-lag 单条记录）仍差一个数量级以上。
4. **可能的补充因素（未验证，留给后续跟进）**：SQLite 写锁争用（并非本次涉及的查询都是纯读，但同一时刻可能有其他写操作在跑）、事件当时 console 系统资源状态比隔离测试环境更紧张（当晚经历多轮重启/高负载，内存/GC 压力可能叠加）、或还有第三个未识别的负载源。

**决策（Bettor 11:49Z 拍板定案，不再等"100% 锤定精确倍数缺口"）**：

已坐实、足够定修的两点：
1. **触发器**：phase-alignment（31 relay 同一秒齐发 catch-up，硬实锤 31/31）。
2. **机制**：并发争用真实存在且方向正确（35ms→687ms/1309ms@31 并发、35ms→1980ms/3898ms@93 并发，KANet-UI 两轮独立复现）——即使未能 100% 解释全部 30 秒量级，"burst 拖慢 console + health-check 被同队列排后超时 + supervisor 误杀"这条链条本身已经成立。

**#21 主修（按杠杆排序，J2 定案）**：
1. **修复②（de-phase / jitter，直击触发器）**——31 relay 别同秒齐发，加随机 offset 错峰。改动小、风险低、可能决赛前上。**最高杠杆**：无论剩余量级缺口最终由什么补充因素解释，摊开 burst 本身就直接消除已坐实的触发条件。
2. **修复④（health-check 优先级隔离，防误杀）**——即使 console 忙但活着，health 探测不该被普通业务请求堵塞到超时。断开"冻结→误杀→中断"链条的第二环。
3. **修复①③（数据源纠正 + 索引）**——独立价值（省浪费/优化查询/减日志噪音），继续做但不算主修，也别标"已修 freeze"。
4. **长期**：`catchUpHistory` 加耗时埋点（KANet-UI 提议），下次复现直接拿 profiling 级证据；handshake / unreplied-messages 两段的 per-item 放大效应未查（本次 11:29 窗口经 NWT 核实**零 pending handshake**，排除了这条作为本次事件放大源，但作为通用风险仍值得后续审查）。

**未解之谜（诚实留白）**：93 并发实测排队延迟只到 ~4 秒，按线性外推需要 700+ 并发才够 ~30 秒量级，与实测坐实的 31/93 有数量级差距。可能的补充因素（SQLite 写锁争用、事件当时系统资源状态更紧张等）未验证。本设计不因此阻塞修复①②④上线——已坐实机制本身足以支撑这些修复的正当性，精确缺口留给后续埋点复现。
