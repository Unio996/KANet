# L2 期 1 · `kaspa_tx_log` 保守 coverage 账 · 设计 + 候选原语 v0.1

> **Status**: DRAFT v0.1 · J2 2026-08-29 · 源：L2 稿 `70208425` §2.2/§4 期 1 + NWT 审注 (b)（期 1 coverage 有 over-claim 险：relay `ingestKaspaTx` fire-and-forget、backoff 丢 POST ⇒ 块标 covered 但 tx 掉 = 重造要闭的洞）· 候选 `indexer-coverage.mjs` + 真 schema 向量 **17/17** 在 `docs/provenance/2026-08-29-l2-coverage-v01/` · 不动代码；报备 → NWT → 落（期 1 不依赖期 2/3，可先走；消费方 = escrow v0.2 / refund-dedup v0.2 注入的 `indexerCoverage()`）。

## §0 保守规则（soundness 方向 = 宁可少标 covered）
| # | 规则 | 为什么 |
|---|---|---|
| R1 | **推进是唯一写法**：indexer 只在"该块全部命中 tx 的 POST 都收到 2xx"后，才对该块的 watched 集合 `advanceCoverage(daa)`；任一 POST 失败/backoff 跳过/超时 ⇒ 不推进 ⇒ 账上自然留洞。**不需要"punch hole"动作**——不写就是洞 | NWT (b)：POST 掉了块却标 covered = over-claim；把"成功"作为推进前置，掉帖 ⇒ 洞 |
| R2 | 推进本身也是 POST（`/ingest/coverage-advance`）；推进丢了 = 账少一段 = 洞 | 方向安全（少标不多标） |
| R3 | 相邻延伸阈 `ADJ`：`daa − end_daa ≤ ADJ` 才延伸同行，否则开新行 ⇒ 跳块可见 | `ADJ` = `spc_daa_index` 单块 DAA 跨度 **P99**（离线副本实测，调用方传入；原语不拍数）；NWT (d) 两条：P99 + scout 按序无跳块 |
| R4 | 查询：区间**并集**（跨 indexer）必须**完全**盖住 `[from,to]` 才 `covered=true`；任何缝 ⇒ `holes[]` | 消费方（escrow/refund）只认 `covered===true ∧ holes.length===0` |
| R5 | 时间→DAA 换算走 `spc_daa_index`：窗起点**向前**取（`daaAtOrBeforeMs`）、终点**向后**取（`daaAtOrAfterMs`，无更晚块则取最近）；换算不到 ⇒ `covered=false` | 保守：把窗放大再判 |
| R6 | 期 3 原子 batch（coverage + tx 同一 `transaction()`）之前，账只对"relay 声称已成功"的块成立 ⇒ 返回 `mode:'phase1-relay-attested'`，消费方可据此再收紧（如钱路只在期 3 后信） | NWT (b)：完全 sound 要期 3 |

## §1 表（v199+，DATABASE.md 同步）
```sql
CREATE TABLE kaspa_tx_log_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, address TEXT NOT NULL,
  start_daa INTEGER NOT NULL, end_daa INTEGER NOT NULL, indexer TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (end_daa >= start_daa));
CREATE INDEX idx_txlog_cov_addr_end ON kaspa_tx_log_coverage(network, address, end_daa);
-- 依赖: spc_daa_index(timestamp_ms) 索引 (EQP c9 全表扫) ⇒ CREATE INDEX idx_spc_daa_ts ON spc_daa_index(timestamp_ms);
```
`indexer` = `'relay:<relay_node_id>'`（期 1 过渡）| `'kaspa-scout'`（期 2 起）。乱序/重复到达（`daa ≤ end_daa`）⇒ skipped，账**不回退**。

## §2 写侧接线（期 1 过渡 = relay；期 2 起 = scout 同一接口）
1. `kasia-relay/src/ingest.mjs` `post()` **改为返回 promise**（现 `:16-45` 不返回 ⇒ 调用方不知成败——这是 over-claim 的机械根源），保留 backoff 语义：backoff 期跳过 ⇒ `Promise.resolve({skipped:true})`。
2. `rpc-listener.mjs indexBlockTxs()`（`:428-500`）：收集本块所有 `ingestKaspaTx` 的 promise；`Promise.allSettled` 后**全部 fulfilled 且非 skipped** ⇒ `ingestCoverageAdvance({network, addresses:[..._watchedAddresses], daa: block.daa})`；否则不发（洞）。**只对 finality-safe 块发**（沿 `drainFinalitySafeBlocks` 50 深，与 `spc-daa-block` 同点），避免 reorg 把"已覆盖"的块拿走。
3. console `api/ingest.js` 新端点 `POST /ingest/coverage-advance {network, addresses[], daa, indexer}` ⇒ `advanceCoverage()`（一个事务）；`indexer` 由 `RELAY_NODE_ID` 派生（relay-manager 已下发）。
4. **relay 重启**：`_indexedTxs` 内存丢 ⇒ 重启后从当前块起推进，重启前到重启后之间 = 新行 ⇒ 洞可见（正确）。
5. watched 集变更：新地址首次出现在 `addresses[]` 即开新行 ⇒ 之前的窗口对它是洞（正确：那段它没被看）。

## §3 消费方接线（钱路先）
`indexerCoverage(db, {network, address, fromIso, toIso}) → {covered, holes, fromDaa, toDaa, mode}`；escrow v0.2 / refund-dedup v0.2 已按此签名注入（`coverage.covered !== true || holes.length>0 ⇒ UNKNOWN`）。lint 规则 `R-TXLOG-ABSENCE-NEEDS-COVERAGE`（L2 稿 G5）在期 1 一并落。

## §4 验收
- offline（已跑 17/17）：C1 空账 / C2 首行 / C3 相邻延伸 / C4 跳块新行且洞可见 / C5 乱序不回退 / C6 缝在窗内不 covered / C7 尾部洞 / C8 多 indexer 并集 / C9 地址隔离 / C10 多地址 / C11 坏参 throw / C12 区间倒置；T1–T5 时间→DAA 取向（起点向前、终点向后、无块 ⇒ false、坏窗 ⇒ false）。
- live（落地后 1 h，只读）：账行随 finality 块增长；人为让一个 relay 进 backoff（不做——用日志里自然发生的 `[ingest] Console unreachable` 窗对时）⇒ 该 relay 的账在那段**必须**有新行（洞）；`indexerCoverage` 对任一 watched 地址的最近 10 min 窗 `covered=true` 且对 backoff 窗 `false`。
- 期 2 影子判据（NWT (c)）：scout 行 ⊇ 32-relay 并集 ∧ `from_address` 填上 ∧ 账与实行一致；scout 漏 ⇒ 不 cutover。

## §5 边界
- 期 1 的"2xx"只证明 console 收到并 `INSERT OR IGNORE` 返回——不证明落盘持久（WAL 崩溃前未 checkpoint 的写在 `synchronous=FULL` 下已 fsync，OK）。
- 非 finality-safe 块上的 tx 被 relay 立即 POST（现状），可能被 reorg 掉但留在 log（既有行为，不在本稿）。
- `ADJ` 实测未跑（需离线副本 `spc_daa_index` 相邻差分 P99）；未跑前用保守小值（如 20）只会多开行（多洞），不会 over-claim。
