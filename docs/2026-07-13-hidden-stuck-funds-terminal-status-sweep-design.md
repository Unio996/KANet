> **Status**: CURRENT (设计稿 v1.1·NWT 快审 GREEN-with-1-note 已折入，纯读零风险)

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

## 方法(纯读，两级过滤，不打live console/relay 硬)

1. **第一级(本地，零链上开销)**：对每个市场的 `spine_p2sh`，先查本地 `kaspa_tx_log` 有没有任何一笔
   `from_address = spine_p2sh` 的记录(= 曾观测到花费)。**有记录 → 大概率已花，先归入"低嫌疑"桶**(仍可能有
   indexer 漏块，见 §3 边界)；**零记录 → 归入"待链验"桶**——这批才值得下一步花活链查询。
2. **第二级(直连 kaspad RPC，仅对"待链验"桶跑)**：`getUtxosByAddresses` **批量查**(每批 100 个地址，
   非逐个单查——kaspad 该接口无分页但对"每地址至多 1-2 个 UTXO"这种小集合批量没有已知问题，历史崩溃
   案例是单地址 294 万 UTXO 的极端情形，不是本场景)。**批间 sleep 500ms**，避免密集请求拖累本已脆弱
   的 relay/console(今晚 event-loop 调查仍在进行中，不给它添乱)。
3. 命中"仍是 live UTXO"的市场 = **真隐匿卡资金**，逐条记录：market_id/protocol_status/spine_p2sh/UTXO
   amount/outpoint。

## 输出

`scratch/_j2_hidden_stuck_funds_sweep_result.json`：
```
{ scanned: 1963, local_low_suspicion: N, chain_verified: M, hits: [{market_id, protocol_status, spine_p2sh, amount, outpoint}, ...] }
```
频道播报命中列表 + 总卡资金 KAS 数，不做任何写操作(纯观察，处置留给后续裁定，同 cohort B 老实例节奏)。

## 边界(诚实声明，不过度声称完备)

- 本次只查 `spine_p2sh`(容器①/maker bond)。bshard 市场的容器②(PayoutShard)资金是否也有同类"假终态"
  问题**不在本次范围**(payout_shards 地址结构不同，需要单独设计，若第一轮扫出信号再排后续卡)。
- 本地 `kaspa_tx_log` 第一级过滤有已知覆盖缺口(memory `reference-kaspa-tx-log-indexer-completeness-gap`)
  ——"低嫌疑桶"不是"零嫌疑"，只是优先级降低，本次报告会清楚区分"链验为空(高确定性)"vs"本地无记录未链验
  (低置信度，样本量太大暂不逐个验，后续可加做)"。
- 不处置，只普查。命中的市场按 Bettor 既有裁定(ozzeu 同款)另立卡处理，不在本设计范围内顺手清。
