> **Status**: CURRENT (设计稿 v1.2·NWT 快审 GREEN-with-MUST-FIX 已折入，纯读零风险)

# 隐匿卡资金全库扫——第八层洋葱

**作者**: J2 · 2026-07-13 · Bettor 派工(ozzeu 教训 #j34qcg，"状态字段会说谎，链不会")
**依据**: ozzeu(6/23 建的 bshard 市场)`protocol_status='completed'`，但 spine UTXO 直连链上查仍是
100 KAS 未花费——假终态状态藏住了一笔真实卡住的资金，65 盘 refunding 大排查(昨晚)靠 `protocol_status`
筛选，天生看不到"状态本身撒谎"的这一类。

## 范围

`protocol_status IN ('completed','archived','pruned_expired_waived','cancelled',
'settle_zombie_quarantine','refunded','settle_failed')` 的全部 `pool_markets`，实查行数：

| 状态 | 行数 |
|---|---|
| completed | 262 |
| archived | 321 |
| pruned_expired_waived | 140 |
| cancelled | 59 |
| settle_zombie_quarantine | 189 |
| refunded | 992 |
| settle_failed(🔴 NWT 红队补，已折入) | 49 |
| **合计** | **2012** |

**🔴 NWT 快审 note(已折入)**：`settle_failed` 名字上正是"结算放弃了，可能还有钱躺着"的候选，不能默认
排除不问，纳入扫描范围。其余非扫描状态(`refunding`/`verifying`/`pending_*`/`collecting_sigs`/
`attested_v2`/`disputed`/`shard_internal`)是活跃态或非 logical-market 行，合理排除(非终态本身就不该
被期望"资金已清空"，排除有据)。

## 方法(纯读，🔴 NWT 快审 MUST-FIX 已折入：砍掉两级过滤，全量直连链验)

**v1.1 的两级过滤(本地 `kaspa_tx_log` 先筛"低嫌疑"，只对剩余候选做链验)被 NWT 否决，理由成立**：
本地 `kaspa_tx_log` 命中只证 relay 曾经观测过一次花费，**不证那笔花费仍在 canonical 链上**(reorg
风险——同 memory `reference-kaspa-tx-log-hit-is-not-canonical-chain-proof`)。用这个不可靠的本地信号
去跳过"低嫌疑桶"的链验，正是**复刻 ozzeu 本身的病**(信本地/状态字段，不信链)。

**量级核实(NWT 算过)**：2012 盘 ÷ 100 地址/批 ≈ 21 批 × 500ms 间隔 ≈ 仅 ~10 秒 RPC 时间，完全可承受
——省下的那点时间换不来"本地代理信号可能撒谎"的风险。**改为单级方案**：

1. **直连 kaspad RPC，全部 2012 盘一次扫完**：`getUtxosByAddresses` 批量查(每批 100 个 `spine_p2sh`
   地址，非逐个单查)。**批间 sleep 500ms**，避免密集请求拖累本已脆弱的 relay/console(今晚 event-loop
   调查仍在进行中，不给它添乱)。
2. 命中"仍是 live UTXO"的市场 = **真隐匿卡资金**，逐条记录：market_id/protocol_status/spine_p2sh/UTXO
   amount/outpoint。

## 输出

`scratch/_j2_hidden_stuck_funds_sweep_result.json`：
```
{ scanned: 2012, hits: [{market_id, protocol_status, spine_p2sh, amount, outpoint}, ...], total_stuck_sompi: "..." }
```
频道播报命中列表 + 总卡资金 KAS 数，不做任何写操作(纯观察，处置留给后续裁定，同 cohort B 老实例节奏)。

## 边界(诚实声明，不过度声称完备)

- 本次只查 `spine_p2sh`(容器①/maker bond)。bshard 市场的容器②(PayoutShard)资金是否也有同类"假终态"
  问题**不在本次范围**(payout_shards 地址结构不同，需要单独设计，若第一轮扫出信号再排后续卡)。
- 全量直连链验(v1.2 已去掉本地预过滤)——**结果的可信度不再依赖本地 indexer 覆盖完整性**，命中判定
  直接来自 `getUtxosByAddresses` 的 live 返回，跟 ozzeu 那次的验证方法同款(直连 RPC，不信 DB/状态字段)。
- 不处置，只普查。命中的市场按 Bettor 既有裁定(ozzeu 同款)另立卡处理，不在本设计范围内顺手清。

## 追记(2026-07-21，J2)：今晚活体重现了"假终态"的一种确切诞生机制

P2 批2 DoD-8(真实 E2E 下注验证 coherence gate)执行时，KANet-UI 误跑了 `test-framework` 的
`bshard_single_persona_bet_journey.test.mjs` 完整 3 步版本(含 `settle_journey_market_synthetic` 这个
**专门伪造第二份赢单来测 H2 `/mybets` 逻辑**的合成测试 action)对着一个原本正常的生产市场
(`ext-pool-v07-1784059111477-gxrr4`)。该 action(`runner.mjs:1181`)无条件执行
`UPDATE pool_markets SET protocol_status = 'completed', metadata = ?`，写入的 `close_txid`/`claim_txid`
是两个 `randomUUID()` 拼出来的假字符串(`settle_evidence.chain_settled` 明确标 `false`)——**从未广播上链**
(核实：该 txid 在 `kaspa_tx_log` 里查无)。结果：`protocol_status='completed'`，但底层真实 shard
(`gxrr4-s0`)仍是 `status='open'`、真实 1 KAS 下注仍完好落链未被处理——跟 ozzeu 的特征(`completed` +
链上从未真正关闭 + 资金原地不动)**逐条吻合**。

**意义**：这不证明 ozzeu 本身就是被这个特定 action 弄出来的(ozzeu 6/23 建盘，`settle_journey_market_synthetic`
是 7/17 才写的代码，时间线对不上，此路排除)，但**证明了"合成/测试类结算 action 误跑在生产市场上"是
能产生这类假终态特征的一条真实、可复现的路径**——如果历史上还存在其它类似的合成/诊断脚本曾经对生产市场
做过同类无条件 `UPDATE ... SET protocol_status = 'completed'` 操作(不一定是这个 action，可能是别的一次性
诊断脚本或手工操作)，本卡命中的隐匿卡资金里,可能有一部分同源。

**建议后续动作(不在本次事故修复范围，供下一轮排查参考)**：命中列表如果需要进一步归因"这行是怎么变成
completed 的"，可以查 `events`/`audit log` 表里有没有 `source`/`action_type` 字段指向
`synthetic`/`test-framework`/类似诊断脚本名称的记录，跟命中的 market_id 时间线对一遍。

**本次事故本身的修复**（gxrr4,不占用本卡范围,已在频道 #ujutj3 走精确修复方案审核流程）：
`protocol_status` 改回 `pending_bettors` + 清除注入的 `settle_evidence` + 删除 2 行纯伪造记录
(`market_shards` 合成 shard + 对应 `pool_bettor_sides` 行)，真实 1 KAS 下注原样保留。

**纪律补课**：合成结算类 test action 不该允许对着"看起来是生产市场"的对象无条件写库,需要专门的沙盒/
自建市场保护栏,另立卡(J2 owner, NWT 审)。
