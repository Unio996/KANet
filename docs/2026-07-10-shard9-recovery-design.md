Status: DRAFT — J1(shard域)起稿, 待J2(settler域)补settlement-pipeline影响, 待NWT红队, Bettor终验。禁止在设计通过前直接手改DB。

# shard9恢复设计(28mln, ext-pool-v07-1783455512843-28mln-s9)

## 背景(A线已定案,证据见频道#fbutv6/#fbvgwf及本会话记录)
- shard9链上真实前沿 = step21: covenant leaf现址`kaspatest:pq6j9t6nyrpl50zzq98kwm2xdzrhezzekfad035st5jg0u63a0angpaawqx4u`,
  UTXO `67ebc76a1ab623b6b2256aa06c257b022cc1544fcf883820cd89123f9831d51c:0` = 64824000000 sompi(J1/Bettor两节点独立RPC复核一致)。
- bet22-32(11笔,共40737000000 sompi=407.37KAS)的register_append曾短暂landed(txid 821c8cb3...,J2/NWT/KANet-UI/J1四方独立验证过block_hash+地址+金额)但**被reorg踢出选定链**——不是phantom丢失,是从没真正成为canonical状态。J1 block-scan(24.8万块)+NWT本机日志(105次一致"not found")互证:这笔spend不存在于当前canonical链。
- 11笔bettor的side_lock付款已按正常sweep_per_bet流程被gateway扫回,本金现在gateway托管(非丢失非被盗)。
- DB当前记录(market_shards.current_leaf_state/current_leaf_outpoint)错误地停在step32,需纠正回step21真实前沿。

## 方案A: DB纠正 + 11笔按refund处理(J1推荐)
1. 纠正`market_shards`(shard9行): `current_leaf_outpoint`='67ebc76a1ab623b6b2256aa06c257b022cc1544fcf883820cd89123f9831d51c:0', `current_leaf_state`=step21状态`{"local_yes":46102000000,"local_no":18722000000,"count":21,"pool_value":64824000000}`(取自J1 rewind脚本docs/iteration/shard9-leaf-rewind-result.json的step21输出,非手写)。
2. `bettor_count`/`projected_settle_mass`按step21的21笔bettor重算(shard-allocator.mjs的onBettorRegistered同款公式,不新写逻辑)。
3. bet22-32这11笔`pool_bettor_sides`行标记为refunded(不删除,留审计痕迹+关联gateway托管的本金),走既有lv3rz(2026-06-30)phantom-leaf退款runbook(gateway原路退stake给11个bettor_pk对应地址)。
4. shard9之后按正常consolidate流程(帶D=20新修复b3a6e420)推进,纳入28mln整体结算。

## 是否可以"纠正后重新advance"这11笔(而非refund)? ——论证,非默认
**covenant层面**: 查过PoolLeaf.sil的register_append入口(shard-leaf合约,line58-89)——只check `count<seal_count`/`side∈{0,1}`/`stake>=min_bet`,**没有deadline限制**。deadline常量只bake给seal_to_root(consolidate闸),不挡register_append。纯合约角度,技术上任何时候都能对这个leaf重新append,不因"过了几天"被合约拒绝。

**应用层面(这才是真正卡点)**: 正常`/register-v07/confirm`流程(pool.js:1371,`_v07PrepConfirmPrelude`共享)硬性要求`market.protocol_status==='pending_bettors'`——28mln现在已进入结算流程,`protocol_status`大概率已不是`pending_bettors`(需J2核实实际值),这条路**会被直接拒绝**。唯一能绕开这个检查的是`/api/admin/pool/register-v07/confirm-by-address`(pool.js:1627起)——查过整个handler,它**没有检查protocol_status**,理论上能用来对一个已经离开`pending_bettors`状态的市场重新写入bet。

**J1结论**: 技术上可行(covenant不拦, admin escape hatch不拦), 但这是把"专为救单笔孤儿单设计的逃生路"用在"重新对一个已进入结算流程的市场批量补11笔历史交易"这个从未设计过、从未测过的场景——11笔重新append会改变shard9的bettor_count/pool_value, 而28mln整体结算(consolidate/deadline sweep)可能已经基于"shard9=已知状态"做了假设(需J2核实28mln settle-daemon是否已对其他shard做了假设shard9状态的操作)。**推荐refund而非重新advance**:退款路径成熟(有lv3rz先例)、不touch正在结算中的市场状态机、11个bettor本金原样退回没有经济损失,风险面小得多。重新advance在纯技术上"论证成立"但操作风险不対称地高,不建议。

## J2补充(settler域: settlement-pipeline影响核实)

**28mln当前状态(直查DB, 2026-07-11)**: `protocol_status='verifying'`, `settle_txid=null`——印证J1判断: 确实已离开`pending_bettors`, `/register-v07/confirm`正常路径会拒。**无`pool_committee`缓存行**(committee尚未抽样)——这点关键: 意味着纠正shard9发生在committee抽样**之前**, 时序上是对的(若已抽样缓存, 纠正后的pool构成会跟已锁定的committee快照脱节, 需要额外失效逻辑; 现在不存在这个问题)。**shard0-8='settling'(已折入PayoutShard)/shard9='sealed'(卡点)/shard10='open'(count=1, 1500000000 sompi=15KAS, 天然partial trailing shard, 尚未sealed)**——consolidate流程还没跑到shard9之后的任何一步, 没有下游状态"已经假设shard9=32笔"过, 纠正不会打翻已完成的工作。

**🔴 方案A步骤3的一个缺口(必须堵, 否则守恒会假绿又真崩)**: "标记为refunded"这个动作本身**不会**把这11笔从结算计算里排除——查了`getMarketBets`(pool-bettor-sides-query.mjs:93, 全库settler/daemon读bet-count/pool/payout的**唯一合法入口**, lint-kanet堵裸读): 它对bshard市场的排除粒度是**整片shard**(`WHERE status != 'manual_recovery_refunded'`, 见L104-105), 片内的`getSidesByShard`(L38-42)是**裸`SELECT * WHERE market_id=?`, 没有任何按行过滤的手段**(pool_bettor_sides本身也没有一个"排除出池"的列)。也就是说: 只要这11行还在`pool_bettor_sides`里且shard9不是整片被排除, `getMarketBets`会原样把32个bettor都读回来算payout_root——跟纠正后covenant实际只backing 21个bettor(648.24KAS)对不上, 会在settle/consolidate某一步撞守恒不符(比J1提的"重新advance风险"更隐蔽, 因为它不会立刻报错, 而是让payout_root算出一个链上验不过的假值, 委员会拒签或更糟——委员如果没做这层交叉验证会签出一个凭空多了11人份额的错误分配)。

**必须新增的一环(建议加成方案A步骤3.5)**: 在shard9纠正`current_leaf_state.count=21`的同时, 需要让这11笔行在`getSidesByShard`层面被排除。两个选项, 推荐②:
  ① 直接从`pool_bettor_sides`物理删除这11行——丢审计痕迹, 不符合KANet"每笔链上交易必须入库"的底线, 不推荐。
  ② **给`getSidesByShard`加一个基于`merkle_index`的下界过滤**: `WHERE market_id=? AND merkle_index < (对应shard.current_leaf_state.count)`。`merkle_index`在注册时就是按leaf count顺序分配的(bet22-32的merkle_index分别是21-31), 纠正后count=21意味着"merkle_index<21"精确等于"真实落链的21笔", 天然排除这11笔, 不删行、留审计、不需要新schema列。**这不是shard9专属hack, 是补一条通用正确性不变式**("DB里的bettor行必须≤covenant实际committed的count")——以后任何一次类似phantom(即使概率低, D=20已根治大部分场景)都会被这条不变式自动兜住, 不需要每次重新设计排除机制。落地时需确认这个过滤不影响shard0-8/shard10(它们count==实际行数, `merkle_index<count`对它们是全集, 无副作用)。
  这11行本身仍然是"标记refunded"(增加一个字段或复用`refund_attempted_at`记录退款时间), 但**排除出结算计算靠merkle_index过滤, 不靠这个标记**——标记只是给退款流程/审计用, 结算的守恒正确性不应该依赖"有没有人记得去读这个标记"。

**refund runbook适配**: lv3rz(2026-06-30)先例是整片shard排除+退款, 28mln这次是"片内部分排除"——机制不同但退款本身(gateway原路退stake给bettor_pk对应linked_addr)是同一个原语, 复用没有结构性障碍, 只是触发范围从"整片"变成"11个具体bettor_pk列表"(已知: bet 33444/33446/33449/33450/33452/33458/33459/33460/33467/33468/33471的bettor_pk, 需要从`pool_bettor_sides`原样读, 不受merkle_index过滤影响因为退款走的是另一条读路径, 不经`getSidesByShard`的结算用途)。

## 落地纪律
纯设计,不动DB/不广播交易。NWT红队后交Bettor终验,批准后按方案执行,执行本身也要走"设计→NWT审→Bettor验"同一节奏,不因为是"退款"就跳过。
