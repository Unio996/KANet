> **Status**: CURRENT (设计稿·并行撰写中，等埋点数据定优先级，非阻塞)

# kaspa_tx_log LIKE 全扫描修复——两案并比

**作者**: J2 · 2026-07-13 · Bettor 派工(#iynqdt/#iz3asy，与诊断埋点并行撰写)
**依据**: event-loop 长阻塞调查坐实的头号结构性风险嫌疑——`bshard-auto-settler.mjs:480`
`SELECT tx_id FROM kaspa_tx_log WHERE outputs_json LIKE ? ORDER BY block_time ASC LIMIT 1`
对 794 万行表 EXPLAIN QUERY PLAN 实测 `SCAN` 非 `SEARCH`。**诚实边界**：这条查询是否是
2026-07-13 08:03-08:06 那次具体 190s 缺口的近因**未证实**(对齐检查见 COORD-LEDGER 同日段)，
本设计修的是"这个查询本身是颗雷"，不依赖"这次事故就是它炸的"这个未证实前提。

## 0. 问题精确定位

`outputs_json` 是整个输出数组的 JSON blob(NWT 核实：目标地址可能在数组任意位置，非固定 index)。
`kaspa_tx_log.to_address` 列只记**主输出**(赢家地址)，PayoutShard continuation 输出(index 1)
只存在于 `outputs_json` 里——这就是当年(v2 修正时)选择 LIKE 全文匹配的**原因**，不是随手偷懒。
调用点：`bshard-auto-settler.mjs:456-489` thread-walk resume 循环，`live UTXO 探测(getUtxos)扑空
→ 落到这条 LIKE query 找历史记录 → 还是没有才 break`，循环上限 `MAX_PROBE_STEPS = claimData.length`
(项目历史记录桶A实测≤26步/市场)。

写入侧(唯一写点，`src/api/ingest.js:39-53` `POST /ingest/kaspa-tx`)：relay 观测到匹配 watched-address
的 TX 后上报，Console 落 `INSERT OR IGNORE INTO kaspa_tx_log`，`outputs_json` 整体存入，**不逐输出
拆列**——这是 LIKE 扫描存在的数据模型根源。

## 1. 候选 A：正规化输出索引表(补索引，不改查询语义)

新增 `kaspa_tx_log_outputs (tx_id TEXT, output_index INTEGER, address TEXT, PRIMARY KEY(tx_id, output_index))`
+ `CREATE INDEX idx_ktlo_address ON kaspa_tx_log_outputs(address)`。

- **写入侧改动**：`ingest.js` 的 `/ingest/kaspa-tx` handler 在写 `kaspa_tx_log` 的同一事务里，
  遍历 `outputs` 数组逐条 `INSERT`(输出数一般个位数，成本可忽略)。
- **读侧改动**：`bshard-auto-settler.mjs:480` 改写为
  `SELECT tx_id FROM kaspa_tx_log_outputs WHERE address = ? ORDER BY ... LIMIT 1`(走 `idx_ktlo_address`
  的 `SEARCH`，非 `SCAN`)——需要 join 回 `kaspa_tx_log` 拿 `block_time` 排序，或在新表也存
  `block_time` 冗余一列避免 join(存储换查询速度，行数不大，可接受)。
- **历史数据缺口**：794 万行既有数据不会自动补进新表。两个子选项：
  (a) 一次性 backfill 迁移(离线批处理，逐行 `JSON.parse(outputs_json)` 拆列写入新表)——**Bettor 已警示
  的坑**：对 794 万行做任何形式的批量写操作本身可能造成长时间锁写，backfill **必须分批 + 限速 +
  在低流量窗口跑**，禁一次性 `INSERT INTO ... SELECT`。
  (b) 不 backfill，新表只覆盖"迁移时间点之后"的新 TX——旧市场的 thread-walk resume 对旧数据仍会
  退回 LIKE 慢路径(或直接 miss，走 live UTXO 兜底)，**新市场立即受益，旧市场存量问题留观察**（thread-walk
  只服务"需要 resume 的老市场"这个逐渐萎缩的存量，随时间推移可能自然消退）。
- **优点**：语义不变，风险最低，符合 Bettor "优先评估既有索引/候选集缓存" 的指导。
- **缺点**：backfill(若做)是不小的一次性工程；新表 = schema 变更，需按 DATABASE.md 规范登记
  + migrate.js 版本号 + 文档同步。

## 2. 候选 B：直连节点 RPC 替代本地索引查询

**依据(memory)**：`reference-kaspa-tx-log-indexer-completeness-gap`——本地 indexer 本就有已知覆盖
缺口，"exact-txid 查询该走直连 RPC" 是既有纪律。thread-walk 要问的问题本质是"某个特定地址历史上
是否曾经收到过一笔款"，如果 kaspad RPC 原生支持这类查询，直连可能比本地索引**既快又更完备**。

**✅ 已验证(5 分钟查证完成，非假设)**：grep `kasia-relay/src/lib/commands.mjs` 全部 `CHAIN_GET_*` 命令
——只有 `CHAIN_GET_CURRENT_DAA_SCORE`/`CHAIN_GET_BLOCKS_FROM_DAA_SCORE`/`CHAIN_GET_BLOCK_AT_DAA`(DAA-score
维度的区块查询，服务 backward-walk 机制，跟"按地址查历史交易"无关)。全项目对 kaspad RPC 的实际使用
面(今晚反复读到的)只有 `getUtxosByAddresses`(当前 UTXO 集)+ DAA/区块维度查询，**没有任何"按地址查
历史交易"的原生 RPC 能力**——kaspad 是 UTXO-set/block-DAG 焦点的节点，不是历史交易索引器；
`kaspa_tx_log` 本身就是本项目为补这个缺口自建的本地索引(有覆盖缺口是已知代价，见 memory
`reference-kaspa-tx-log-indexer-completeness-gap`)。**结论：候选 B 在协议层不成立，排除**——不存在
"绕开本地索引直连 RPC 更快更全"这条路，kaspad 没有对应能力可绕。

## 3. 结论：候选 A 排除法胜出(非偏好，是候选 B 协议层不成立)

候选 B 已在 §2 排除。**候选 A(正规化输出索引表)是唯一在协议层可行的路径**，不是两案比较后选出的
"更优"，是排除法只剩这一条。剩余的设计决策收窄到 §1 里的子选项：是否 backfill 历史 794 万行(以及
backfill 怎么分批/限速安全跑)，还是接受"新市场受益、旧存量市场维持现状直到自然萎缩"。这个子选择
留给选刀会：埋点数据若显示旧市场 thread-walk 仍是热点重灾区，backfill 优先级上调；若热点集中在新
市场，backfill 可以先不做，省下这块工程量。

## 4. 明确不做的事(范围边界)

- 不改 thread-walk resume 循环本身的步数上限/重试逻辑(那是另一个功能，非本次范围)。
- 不对 `kaspa_tx_log` 现有列做任何删除/改名(向后兼容，`to_address`/`outputs_json` 原样保留)。
- 不在数据未到位前假定候选 A/B 哪个是最终选择——这是选刀会的决定，本设计只负责把两案摊清楚。
