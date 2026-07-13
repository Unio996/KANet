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
