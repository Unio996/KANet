# `kaspa_tx_log` 完整性 + 唯一 indexer（kaspa-scout）+ 批量 ingest · 设计稿 v0.1（L2）

> **Status**: DRAFT v0.1 · J2 2026-08-29 · 源：eventloop 调查稿 `77b1efde` §4 L2 · Bettor 裁：**不选"1 个 relay"，改 console 侧 `kaspa-scout` 做唯一 indexer** + verifier 保 RPC 回退 + relay 攒批/console 一个 `transaction()`；NWT 裁：**完整性排在写压优化之前**——`kaspa_tx_log` 正被当真相源用在钱路判据（`checkBrokerEscrow` 误判失金、`broker-fee-emit` 漏告警同根）。**不动代码**；NWT 审 → 报备 → 分期落。坐标 J2 2026-08-29 亲核（producer/consumer 地图由子代理读、我抽核关键行）。

## §0 结论（五行）
1. 今天的 32 路重复写**不是冗余**（同一段代码、同一 watched 集合、同一漏法 ⇒ `shared-source-verification-is-vacuous`），它只买了写放大；而真正的缺口——**索引没覆盖的窗口/地址**——32 路一起漏。
2. **完整性 = 可证明的覆盖**：给 `kaspa_tx_log` 配一张 **coverage 账**（哪些地址、哪段 DAA/时间被"在岗的 indexer"连续观察过），让每个把"0 行"当证据的消费方先问 coverage；没覆盖 ⇒ `UNKNOWN`（不得推断"未发生"）。escrow 候选（`28d96211`）已是这个形，本稿把它做成**库级原语**。
3. **唯一 indexer = kaspa-scout**：已是单进程、已订阅 `blockAdded`（`rpc-scanner.mjs:314`）、已 `getBlock(includeTransactions)` 取 verbose（`:260`，能拿到 relay 抓不到的输入地址 ⇒ 顺手修 `from_address` 100% NULL）、已经 `/ingest/*` 写 console（无直连 DB）、已有 watchdog（`scanner.js:272` `scout_checkpoint` 新鲜度）与 `backfill.mjs`。relay 侧 `ingestKaspaTx` 加门 **默认关**。
4. **批量 ingest**：scout 攒 ≤1 s/≤200 条 → `POST /ingest/kaspa-tx-batch` → console 一个 `transaction()`；耐久中性（仍是 WAL 事务），主线程同步段从 N 次 prepare/run 变 1 次。
5. **分四期、每期可独立回退**：0 度量 → 1 coverage 账 + 消费方接入（钱路先）→ 2 scout 影子并跑对拍 7 天 → 3 relay 门关闭 + 批量端点。**期 1 不依赖期 2/3**，可先走（它就是 NWT 要的"完整性先于写压"）。

## §1 现状（要害坐标）
**Producer**：每个 relay 子进程 `RELAY_MODE=rpc`（`relay-manager.js:70` 默认 `rpc`，全 32 个）→ `rpc-listener.mjs:752 subscribeBlockAdded` → `:851 indexBlockTxs(block)` → 命中 `_watchedAddresses`（`:412-426` 每 60 s 拉 `/api/indexer/watched-addresses`；失败静默沿用旧集）的**输出**（`:460-467`，输入只 best-effort ⇒ `from_address` ~100% NULL）→ `:480 ingestKaspaTx` fire-and-forget（`ingest.mjs:16-45`：**无重试、无队列；连续 5 失败 ⇒ 10→60 s backoff 期间 POST 直接丢**）；per-relay 内存去重 `_indexedTxs`（`:118`，重启即失）。**无任何 per-relay 门**（`RELAY_TX_INDEXER` 只在调查稿里）。
**Console**：`api/ingest.js:39-66` 单条 `INSERT OR IGNORE INTO kaspa_tx_log`（PK `tx_id`；无 `observed_by`；`observed_at` = 先到者的 console 接收时刻）；`/api/indexer/watched-addresses` `:134-166` = `relay_nodes.address ∪ exchange_offers.maker/taker(全历史) ∪ identities(30 天)`，**`network` 参数未进 WHERE**（主网/测试网地址混返）；**pool/market 侧 P2SH 不在 watched 集合**（`pool.js:2451-2455` 明写：外部用户付款到非 relay 侧 P2SH 永不被索引）。
**Consumers**（22 处，全在 `kasia-console/src`；`kaspa-scout`/`agent-mind` 0 处）：按"0 行时怎么办"分四级——
| 级 | 行为 | 代表 |
|---|---|---|
| T1 链读回退 | 没行 ⇒ RPC/relay 读链 | `cross-chain-verify.mjs:472-544`（本地优先 RPC 回退）、`bshard-close-voter.js:203-206`（relay `check_utxo_landed` 优先，表只作退化）、`trade-protocol-filter.js:1184-1198`（`spc_daa_index_coverage` 有界回走） |
| T2 重试等待 | 没行 ⇒ 下 tick 再看，不下结论 | `broker-fee-emit.mjs:133-149`（pendingIndex）、`pool.js:3808`、`pool-shard-settle.mjs:350-377`（三态） |
| T3 fail-closed | 没行 ⇒ 停/拒 | `bshard-auto-settler.mjs:246-247`、`bshard-close-voter.js:212-215`、`broker-state-authority.js:751-759`（把真 txid 当假） |
| **T4 absence = 证据（危险）** | 没行 ⇒ **推断"没发生"并动钱/状态** | `broker-refund-dedup.js:45-52,82`（漏 ⇒ **重复退款**；`broker-cancel-refund.js:78` 记过 87.9 KAS 教训）、`broker-state-machine.js:253-269`（`no_escrow`，定级页 `c6d0729b`）、`broker-intake-watcher.js:499/:739/:755`（假告警）、`broker-state-reconciler.js:144-187` |
**表**：7.57 GB/11.6 M 行（07-23）、+140 MB/天、每插 5 棵随机 b-tree（EQP 审计 `scratch/_j2_eventloop_db_audit/audit4.out`）。

## §2 完整性（先做）
### 2.1 缺口分类（每类对应一个机制）
| # | 缺口 | 今天 | 机制 |
|---|---|---|---|
| G1 | **地址不在 watched 集合**（侧 P2SH、外部用户付款目标、broker 新地址） | 永久漏，无人知 | coverage 账按**地址**记起止；不在账上的地址 ⇒ 消费方 UNKNOWN |
| G2 | **时间/块窗口缺**（indexer 重启、backoff 丢帖、console 重启孤儿化） | 漏且无痕（32 路同漏） | coverage 账按 **DAA 区间**记（沿 `spc_daa_index_coverage` 的形，但要修它的"相邻延伸"路径——现 350 行全 span-1，`ingest.js:96` 阈值 10 与乱序到达）；洞 = 回填任务的输入 |
| G3 | **网络混杂** | watched 端点不按 network 过滤 | 端点加 `WHERE network = ?`（或地址前缀过滤）；账按 network 分 |
| G4 | **输入地址缺** | `from_address` ~100% NULL ⇒ 出金匹配全 miss（`broker-state-machine.js:263`、`broker-state-reconciler.js:141`） | scout 用 `getBlock(includeTransactions)` verbose 解析输入 ⇒ 填 `from_address`（relay 侧做不到是结构原因：blockAdded 事件无输入 verboseData） |
| G5 | **消费方把 absence 当证据** | T4 四处 | 库级原语 `indexerCoverage(addr, [t0,t1])` → `{covered, holes}`；T4 全部改三态（escrow 候选是样板）；lint 规则 `R-TXLOG-ABSENCE-NEEDS-COVERAGE`：任何 `FROM kaspa_tx_log` 的 `count(*)/NOT EXISTS/SUM` 判据附近须出现 `indexerCoverage(`（静态守） |
### 2.2 coverage 账（新表 v199，DATABASE.md 同步）
```
kaspa_tx_log_coverage(
  id INTEGER PRIMARY KEY, network TEXT NOT NULL, address TEXT NOT NULL,
  start_daa INTEGER NOT NULL, end_daa INTEGER NOT NULL,      -- 连续观察区间(含)
  indexer TEXT NOT NULL,                                     -- 'kaspa-scout' | 'relay:<id>'(过渡期)
  updated_at TEXT NOT NULL)  + INDEX(network,address,end_daa)
```
- 写法：indexer 每处理完一个 finality-safe 链块（沿 relay `drainFinalitySafeBlocks` 的 50 深判据），对当前 watched 集合每地址 `end_daa = daa`；相邻（`daa − end_daa ≤ ADJ`）延伸，否则开新行（真洞）。ADJ 从 `spc_daa_index` 实测链块间距分布定（07-23 快照 0.186 行/DAA ⇒ 均 5.4 DAA，取 P99），**不是拍 10**。
- 读法：`indexerCoverage({network, address, fromDaa, toDaa})` ⇒ 区间并集是否盖住 `[from,to]`，返回 `holes[]`。时间→DAA 换算走 `spc_daa_index`（EQP c9：`timestamp_ms` 无索引 ⇒ 加 `idx_spc_daa_ts`，L1 清单已有）。
- 心跳：现 `spc_tip_heartbeat`（单行 last-writer-wins）保留作"indexer 在岗"信号；coverage 行是"在岗时看着谁"。
### 2.3 漏插检测/回填
- 检测：`holes[]` 非空 ⇒ `events(kaspa_tx_log_coverage_hole)` 一次（去重按 address+start_daa）。
- 回填：scout `backfill.mjs`（已存在，按时间窗走 `getBlock`）扩成"按 `(address, [start_daa,end_daa])` 洞回填"：沿 `spc_daa_index` 取洞内链块 hash → `getBlock(includeTransactions)` → 命中地址 ⇒ `/ingest/kaspa-tx`（幂等）→ 回填完把洞合并进 coverage。**有界**（每次 ≤ N 块），不在 console 主线程（scout 进程内）。
### 2.4 消费方接入顺序（钱路先）
1. `broker-refund-dedup.js:45-52,82`（T4，重复退款）：0 行 ∧ 未覆盖 ⇒ **拒退**（fail-closed，宁可人工）。
2. `broker-state-machine.js` escrow（候选 `28d96211` 已三态）。
3. `broker-intake-watcher.js:499/:739/:755` 假告警 ⇒ 未覆盖时不告警、改记 hole。
4. `broker-fee-emit.mjs` pendingIndex ⇒ 未覆盖 ⇒ 触发回填而非无限等（修 P3 "永远 pending"）。
5. T3 三处：fail-closed 保持，但错误文案区分"未覆盖"与"覆盖了但没有"。

## §3 唯一 indexer = kaspa-scout
| 项 | 设计 |
|---|---|
| 门 | relay：`rpc-listener.mjs:480` 前加 `if (process.env.RELAY_TX_INDEXER !== '1') return;`（**默认关**；`relay-manager.js:74-88` 不下发 ⇒ 全关）；过渡期可对**一个** relay 下发 `=1` 作影子（§4 期 2） |
| scout | `SCAN_MODE=rpc` 路径 `rpc-scanner.mjs`：`handleBlock` 里加 `indexBlockTxs`（从 relay 搬同名逻辑，**输入侧用 verbose 解析填 `from_address`**）+ 攒批 + coverage 更新；watched 集合同一端点（修 G3 后）；`_indexedTxs` 持久化到 `scout_checkpoint`（重启不重发）|
| 批量端点 | `POST /ingest/kaspa-tx-batch {items:[…≤200]}` ⇒ `sqlite.transaction(items => for … INSERT OR IGNORE)()`；单条端点保留（回填/兼容）；**同一事务顺带写 `kaspa_tx_log_outputs`**（`2026-07-13-kaspa-tx-log-like-scan-fix-design.md` 设计的归一表，与本稿耦合处只此一点）|
| 心跳/存活 | scout 每 finality 块更新 `spc_tip_heartbeat`（现由 relay 各自写，last-writer-wins ⇒ 改成只 scout 写）；`scanner.js:272` watchdog 已在（`scout_checkpoint` 新鲜度）；scout 死 ⇒ 心跳陈 ⇒ 所有 T4 消费方自动 UNKNOWN（**fail-safe 由构造给**，不靠人盯）|
| 单点风险 | 与今天比：今天 32 路**同源同漏**、无覆盖账、漏了没人知；单 indexer + coverage 账 + 回填 = 漏了**知道且能补**。可用性靠 watchdog 拉起 + 回填补洞，不靠多写 |
| `bshard-close-voter.js:211` "voter 自写 = 跨节点确定性锚"假设 | 需重看：它已优先 relay IPC `check_utxo_landed`（`:203`），表只退化；单 indexer 后退化路仍在，只是写者变了。标 verify-when-built |

## §4 分期与验收（每期可独立回退）
| 期 | 内容 | 验收 | 回退 |
|---|---|---|---|
| 0 度量（随 L0 仪器） | `[diag:sql-sync]` 里 `INSERT OR IGNORE INTO kaspa_tx_log` 的 changes=0 占比 = 真实重复倍数（把调查稿"32× worst-case"变实测）；`/ingest/kaspa-tx` QPS | 有数 | — |
| 1 完整性 | v199 coverage 表 + `indexerCoverage()` + 过渡期由 relay 侧写 coverage（`indexer='relay:<id>'`，取并集）+ G3 端点修 + T4 四处接三态 + lint 规则 | offline：真 schema 向量（覆盖/洞/网络分离/T4 每处 UNKNOWN 路）；live：coverage 行随块增长、洞事件出现即真洞 | 表只读不影响旧路；T4 改回布尔 = 单文件 revert |
| 2 影子 | scout 开索引（写同表，`INSERT OR IGNORE` 幂等）+ coverage `indexer='kaspa-scout'`；relay 仍写；7 天对拍：scout-only 命中 vs relay-only 命中 集合 | relay-only 命中 = 0（或全能归因到 G1/G3）；scout-only 命中 > 0（G4 输入地址）| 关 scout 索引 |
| 3 切换 | relay 门默认关；批量端点；心跳只 scout 写 | 写压：`[diag:sql-sync]` kaspa_tx_log 命中 ↓、WAL 高水位 ↓（调查稿 W 假说的直接检验）；coverage 无新洞 | `RELAY_TX_INDEXER=1` 全员下发 = 回到今天 |
| 4 保留期（另稿） | 非 watched/非钱路行的老化 | — | — |

## §5 边界
- 未量 live 重复倍数（期 0 给）；未量 scout `getBlock` verbose 的吞吐（TN12 10 bps × 每块 `getBlock` = scout 已在做 `:260`，看它现在的 VERBOSE-FAIL 率）。
- coverage 的 ADJ 阈值待 `spc_daa_index` 分布实测；`spc_daa_index_coverage` 现有"相邻延伸不生效"疑点（350 行 span-1）要先查清再复用其形。
- 与 §10/relay 身份无关；不碰 relay 生产钥；relay 门只是 env。
- 期 1 的 lint 规则是静态守，不是证明；T4 是否还有第五处以子代理 22 处地图为准，落码前再 grep 一遍。
