# Relay Catch-Up Thundering-Herd — 根因设计 + 修复方案

> **Status**: CURRENT (design, 待 NWT 红队 + Bettor 审 + Owner 批钱路/生产改动)

**Owner**: J2
**日期**: 2026-07-19
**授权范围**: Bettor 派工 #21，追 11:28Z console 冻结事件根因
**Source commit**: `6da0f1623303f3e7a9253ab497a1a88c7291b7d0`（本设计基于此 commit 读码，未改任何 live 代码）

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

### 层③ — console 侧被打中的具体端点无索引（放大器，量化验证）
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

---

## 建议落地顺序

1. **修复③（索引）+ 修复①（数据源）**：两条都是低风险、独立、纯粹消除浪费/优化查询，可以尽快上（不改变任何业务逻辑/时序假设）。
2. **修复②（jitter）**：核心根治但改变时序行为，需要 NWT 完整红队（尤其确认没有隐藏的"同步触发"依赖）+ Bettor 审，若来得及在 19:00Z 决赛窗前上最好；来不及则维持现有两层缓解（决赛窗附近避免批量重启 relay + supervisor 秒级重启安全网）。

## 未覆盖 / 待确认

- 本设计基于 40ms 单次查询估算 + 请求排队模型解释 14.8s 阻塞，是合理量级匹配但非逐帧 profiling 坐实（没有直接的 CPU profile 证据链，是基于查询耗时 × 并发数的推算）。若红队需要更硬证据，可考虑给 `catchUpHistory` 加耗时埋点，下次复现时直接量化。
- handshake / unreplied-messages 两条子查询（`rpc-listener.mjs` 内 catchUpHistory 前两段）未逐一审查是否同样缺索引，需要 NWT 或后续跟进核实，本设计聚焦已验证的 pending-comm 分支。
