> **Status**: CURRENT (设计稿 v1.1·Bettor 方向审 GREEN-with-2-notes 已折入，等埋点数据定优先级，非阻塞)

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
- **读侧改动(🔴 Bettor 方向审注1，已锁定)**：新表结构改为
  `kaspa_tx_log_outputs (tx_id TEXT, output_index INTEGER, address TEXT, block_time INTEGER,
  PRIMARY KEY(tx_id, output_index))` + `CREATE INDEX idx_ktlo_address_time ON
  kaspa_tx_log_outputs(address, block_time)`——**`block_time` 冗余存一份**，不 join 回 794 万行的
  `kaspa_tx_log` 主表(join 本身可能是另一个隐性慢点，新表行数小，冗余存储成本可忽略)。
  `bshard-auto-settler.mjs:480` 改写为
  `SELECT tx_id FROM kaspa_tx_log_outputs WHERE address = ? ORDER BY block_time ASC LIMIT 1`
  (走 `idx_ktlo_address_time` 的 `SEARCH`，非 `SCAN`，零 join)。
- **历史数据 backfill(🔴 Bettor 方向审注2，已锁定为主选项，非留白子选择)**：thread-walk resume 的
  主要使用者恰恰是**老市场存量**(中断后续接场景)，"只覆盖迁移点之后的新 TX"(forward-only)对现存
  卡住盘几乎零改善——若埋点数据显示 resume 路径是热点元凶，backfill 大概率躲不掉，**这里提前把
  ramp 方案写清楚，不留到选刀会现想**：
  1. **分批**：按 `rowid` 区间分块(如每批 5 万行)，逐批 `SELECT tx_id, outputs_json, block_time
     FROM kaspa_tx_log WHERE rowid BETWEEN ? AND ?`，逐行 `JSON.parse` 拆出 outputs 写入新表，
     批间 `setTimeout` 让出 event loop(这条本身也要小心——批太大同样会造成单批内的长阻塞，5 万行
     量级需要先在测试库实测单批耗时，超过约 200ms 就再切小)。
  2. **限速**：整个 backfill 跑在**低流量窗口**(参考项目既有"分批 ramp 纪律"，先 1 批验证零副作用
     → 再放量，不一次性 794 万行糊上去)。
  3. **可中断可续跑**：记录 `backfill_progress` 的最后处理 `rowid`(可以是 `config_entries` 里一个
     key，不新建表)，backfill 脚本可安全中断重启，不用从头来。
  4. **验收**：backfill 完成后随机抽样(如 100 笔)人工核对 `kaspa_tx_log_outputs` 与 `kaspa_tx_log.
     outputs_json` 内容一致，同 admin-dedup 系列一次性脚本的可审计惯例(events 表记一条 backfill
     完成审计行，含处理总行数/耗时/抽样核对结果)。
- **优点**：语义不变，风险最低，符合 Bettor "优先评估既有索引/候选集缓存" 的指导。
- **缺点**：backfill 是不小的一次性工程(标准做法写清楚后风险可控)；新表 = schema 变更，需按
  DATABASE.md 规范登记 + migrate.js 版本号 + 文档同步。

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

## 3. 结论：候选 A(含 backfill)排除法+使用面分析双重锁定

候选 B 已在 §2 排除。**候选 A(正规化输出索引表)是唯一在协议层可行的路径**，不是两案比较后选出的
"更优"，是排除法只剩这一条。§1 的 backfill 子选择(🔴 Bettor 方向审注2，已锁定)：thread-walk resume
的主要使用者是**老市场存量**，forward-only(不 backfill)对现存卡住盘几乎零改善，所以 backfill 不是
"留给选刀会的开放选项"，是**大概率躲不掉的主路径**，ramp 方案已在 §1 写清楚。选刀会真正要决定的是
**要不要做/什么时候做**(取决于埋点数据显示 resume 路径的实际热度)，"怎么做"(方案本身)已经收敛。

## 4. 明确不做的事(范围边界)

- 不改 thread-walk resume 循环本身的步数上限/重试逻辑(那是另一个功能，非本次范围)。
- 不对 `kaspa_tx_log` 现有列做任何删除/改名(向后兼容，`to_address`/`outputs_json` 原样保留)。
- 不在数据未到位前假定候选 A/B 哪个是最终选择——这是选刀会的决定，本设计只负责把两案摊清楚。
