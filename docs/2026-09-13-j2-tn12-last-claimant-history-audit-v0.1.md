# TN12 历史只读审计 · "最后领取人/退款人"是否卡过 v0.1

> **Status**: FINAL-EVIDENCE **v0.1**（2026-09-13 · J2 · Bettor 派工（NWT b2abee3a 合审附带）「只读审计 TN12 历史：有没有'最后领取人/退款人'的 claim 广播被拒或卡在 delivering/unclaimed 的实例；结果先报我和 NWT——决定要不要单开事故账和 TN12 收尾手工处置；修法本身随 T3 一次到位，不在 TN12 单修」· 纯只读，零写入，本机 `kasia-console/data/console.db`（readonly 连接）· 交 Bettor + NWT 判是否开事故账。

## 0. 结论（三句）

1. **搜不到任何"claim 广播被拒"的直接证据**：`events` 表里没有 dust / zero-value / claim-reject 相关行；`pool_bettor_sides.claim_txid` 里唯一的非 txid 哨兵值 `'utxo_already_spent'` 来自**另一条代码路径**（`bettor-refund-claim-auto.mjs` 的 SS 押金退款，走 `pool_side_refund_cancelled_tx`，不是 T3 范围内的 PayoutShard/PayoutShardV2/RootClaim covenant `claim`/`refund_claim`/`claim_draw` 三条 MUST-FIX 路径），是"UTXO 已花=已被人手动领过"的自愈标记，不是广播拒绝。
2. **搜不到任何"卡在 delivering/unclaimed"的当前实例**：全库 925 个有赢家的 shard-market 里，**0 个**恰好"只剩一个赢家未领"（= 触发 T3 §3.0 分支的活跃候选）；**919 个（99.4%）赢家一个都没领过**（claim 流程本身在 TN12 极少被走完，不是卡在最后一步，是几乎没人走到最后一步）；仅 **5 个**shard 全部赢家都已领（§2）。
3. **无法从本地表机械判定这 5 个"全领"实例的最后一笔是否真的经过 T3 范围内的 covenant `claim` 入口**（§3 的关键不确定性）——`market_shards.current_leaf_state`（本应反映 PayoutShard/ShardLeaf 覆约后状态）在这些实例上**停在创世值不变**，`pool_markets.protocol_status` 也不是 `completed`（除一例），与"覆约 claim 真的执行过"的预期不一致；更像是走了另一条签付路径。**这条不确定性建议 NWT/Bettor 判要不要值得再花一次真链 RPC 核实**——本审计到此为止，不再深挖（超出"只读 DB 审计"范围，需要活节点信任链）。

## 1. 判据与范围

- **范围**：T3 MUST-FIX 四处入口——`PayoutShard.claim`(:217-224)、`PayoutShard.refund_claim`(:382-389)、`PayoutShardV2.refund_claim`(:333-344)、`RootClaim.claim_draw`(:94-108)。查它们历史上有没有触发"最后一笔清零 → 0 值续约输出 → dust 策略拒绝"。
- **判据**："卡住"= 该 side 有 `pay_amount_sompi`（判定为赢家）但迟迟无 `claim_txid`，且同 market 其余赢家都已领（= 数学上只差它一个，最像被同一个 bug 挡住）；或 `events`/日志里有 dust/reject 字样；或 `claim_txid` 存在但从未落链（`kaspa_tx_log`/`tx_records` 都查不到）。
- **数据源**：`pool_bettor_sides`（36012 行，字段 `market_id/bettor_pk/stake_amount/pay_amount_sompi/claim_txid/created_at` 等）、`market_shards`（1341 行，`shard_market_id/status/current_leaf_state`）、`payout_shards`（722 行，`logical_market_id/payout_cov_id/covenant_family`）、`pool_markets`（4050 行，`protocol_status/settle_txid`）、`kaspa_tx_log`、`tx_records`、`events`、`chain_events`。全部只读 `SELECT`，无 `UPDATE`/`INSERT`/`DELETE`。

## 2. 数据（逐条）

| 检查 | 结果 |
|---|---|
| 有赢家（`pay_amount_sompi IS NOT NULL`）的 shard-market 数 | 925（以 `market_shards.shard_market_id` 与 `pool_bettor_sides.market_id` 对齐，1338/1341 行匹配） |
| 恰好"只剩一个赢家未领"（活跃候选） | **0** |
| 全部赢家都已领 | **5**（`28mln-s10`、`dhxcp-s0`、`kngkl-s0`、`dwk36-s0`、`pxvml-s0`；每个 1–2 个赢家） |
| 一个都没领 | 919（99.4%） |
| 部分领（>1 个未领） | 1 |
| `claim_txid` 非空但不在 `kaspa_tx_log` | 2 行——① `'utxo_already_spent'` 哨兵（§0.1，另路径）；② 一行 `pay_amount_sompi IS NULL`（不是赢家，是退款尝试，`side_lock_daa` 有值但未在索引器命中——TN12 索引器/剪枝已知局限，非 claim 广播拒绝证据） |
| `events` 表 `summary`/`payload_json` 含 dust/zero-value/claim-reject 字样 | **0** 行（扫了 `%dust%`/`%0-value%`/`%zero%value%`/`%claim%reject%`/`%claim%fail%`） |
| `claim_thread_recovered` 事件（thread-walk 补记） | 24 条，全是"链上已落 DB 未记的 claim 补平历史账"——**方向相反**：这是"链上成功但 DB 没记"，不是"链上被拒" |

## 3. 关键不确定性（5 个"全领"实例的 claim 是否真走了 covenant 入口）

以 `28mln-s10`（唯一有 `payout_shards` 行、`pool_markets.protocol_status='completed'`、`settle_txid` 非空的实例）为例：
- `market_shards` 该 shard：`status='settled'`，但 `current_leaf_state = {"pool_value":1500000000,"count":1,...}`——**与创世值完全一致，没有反映"consolidated_pool 减 payout"的覆约后状态**。
- 该赢家的 `claim_txid` 在 `kaspa_tx_log` 里，`to_address` 是一个普通 `kaspatest:q…` P2PK 地址、`amount=15`（KAS）——这与 `PayoutShard.claim` 真实执行的输出形（`winnerLock = ScriptPubKeyP2PK(pubkey(bettorPk))`）**一致**，但**同样**与"某条更早的签名型 settle 路径直接付款给赢家"一致（本机 `kaspa_tx_log` 只记入账地址，不记花费的是哪个输入/covenant，**无法从这张表分辨钱是从 PayoutShard 覆约花出来的还是从别的钱包直接转出来的**）。
- `dhxcp` / `pxvml`（两个 2-赢家全领实例）的 `pool_markets.protocol_status` 分别是 `verifying` / `attested_v2`（**不是** `completed`），`settle_txid = NULL`——赢家已经拿到钱（`claim_txid` 落链），但市场自己的协议状态机从未推进到位。这**要么**是 T5（settler/payout 构造，批 T v0.7 §3 T5 行）里已知的"落链但账没跟上"缺口的又一实例，**要么**是这些历史行本身来自一条与 T3 覆约链不同的旧结算路径（`pool_markets` 表的 `spine_p2sh`/`oracle_relay_ids` 字段指向 J1 那条"签名型 escrow / 委员多签 spine settle"架构，批 T v0.7 §T0 列过的 `PredictionEscrowUnanimous5`/`ConsensualMid` 家族，与本次 T3 改的 ShardLeaf→PayoutShard→RootClaim 覆约链是**两条不同的历史架构**）。
- **两种可能都不能从本地表排除**；分辨需要真链 RPC 核对那几笔 txid 的**输入**（花的是 PayoutShard P2SH 覆约 UTXO 还是普通钱包 UTXO）——超出只读 DB 审计范围，本审计不做，列给 Bettor/NWT 判要不要再花一次。

## 4. 判读（供 Bettor/NWT 决定是否开事故账）

- **不建议开事故账**：① 没有任何可读证据显示 claim 广播被拒或卡住；② 触发条件（同市场其余赢家已领、只差最后一个）在当前库里 0 个实例；③ 历史上"全领"的样本量极小（5 个）且极可能根本没走 T3 范围内的覆约链（§3）——**风险面从未被证实发生过，与批 T P8（FoldNode 双记）同一判读形式：脚本层缺口成立，但可达性/历史发生率证据缺失或指向"从未真正走过这条路"**。
- **TN12 收尾**：不需要手工处置——没有找到卡住的资金或状态。
- 若 Bettor/NWT 认为 §3 的不确定性值得澄清（例如要精确知道 TN12 上 PayoutShard/RootClaim 覆约链是否曾被真实使用过一次），下一步是**一次真链 RPC 查询**（`getTransaction` 那几笔 txid 的输入 outpoint，比对 `payout_shards.payout_ps_addr` 的历史 UTXO）——不在本稿范围，需另派。

## 5. 没核到的
- 未查 `chain_events` 里是否有与这 5 个实例对应的 `bshard_*` 事件（§0.2 提到的 `bshard_close_sig` 等事件类型只在别的市场出现，未逐一核对这 5 个 market_id 是否命中）。
- 未核 `pool-market-settler.js` 的具体分支判断（哪条代码路径决定走覆约 claim 还是走签名 spine settle）——只从数据侧推断，未读全部相关源码。
- `28mln` 是批 T P8 稿里提到的同一个市场（`shard8_missing_bets_registered` 告警），本身是压力测试/异常市场（321 行 side 记录、大量 `claim_txid=undefined` 的赢家），其"全领"的那个 shard（`-s10`）可能只是压测收尾的一次性操作，不代表典型历史。
