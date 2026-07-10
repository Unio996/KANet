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
2. **(NWT红队MUST-FIX后修正)** `bettor_count`/`projected_settle_mass`**不经过onBettorRegistered**(该函数内部调shardStakes()无refund过滤,会把32笔全算进去,数字错)。直接手动UPDATE为对应第21笔为止的真值:`bettor_count=21`,`projected_settle_mass=9647`(用kip9-mass.mjs的真实estimateStorageMass()对前21笔bet_sequence的stake_amount逐笔算的,非估算——脚本可复现)。这4个字段(current_leaf_outpoint/current_leaf_state/bettor_count/projected_settle_mass)是这次纠正唯一要动的列,一次UPDATE写死,不调用任何现有注册路径函数。
3. bet22-32这11笔`pool_bettor_sides`行标记为refunded(不删除,留审计痕迹+关联gateway托管的本金),走既有lv3rz(2026-06-30)phantom-leaf退款runbook(gateway原路退stake给11个bettor_pk对应地址)。**注**: 因为步骤2已经不再依赖shardStakes()的实时聚合,这里标不标refunded不影响current_leaf_state/bettor_count的正确性,但仍要标,防止未来任何代码路径(如canary-stats的hadBets)重新用shardStakes()误算出32笔。
4. shard9之后按正常consolidate流程(帶D=20新修复b3a6e420)推进,纳入28mln整体结算。

## 是否可以"纠正后重新advance"这11笔(而非refund)? ——论证,非默认
**covenant层面**: 查过PoolLeaf.sil的register_append入口(shard-leaf合约,line58-89)——只check `count<seal_count`/`side∈{0,1}`/`stake>=min_bet`,**没有deadline限制**。deadline常量只bake给seal_to_root(consolidate闸),不挡register_append。纯合约角度,技术上任何时候都能对这个leaf重新append,不因"过了几天"被合约拒绝。

**应用层面(这才是真正卡点)**: 正常`/register-v07/confirm`流程(pool.js:1371,`_v07PrepConfirmPrelude`共享)硬性要求`market.protocol_status==='pending_bettors'`——28mln现在已进入结算流程,`protocol_status`大概率已不是`pending_bettors`(需J2核实实际值),这条路**会被直接拒绝**。唯一能绕开这个检查的是`/api/admin/pool/register-v07/confirm-by-address`(pool.js:1627起)——查过整个handler,它**没有检查protocol_status**,理论上能用来对一个已经离开`pending_bettors`状态的市场重新写入bet。

**J1结论**: 技术上可行(covenant不拦, admin escape hatch不拦), 但这是把"专为救单笔孤儿单设计的逃生路"用在"重新对一个已进入结算流程的市场批量补11笔历史交易"这个从未设计过、从未测过的场景——11笔重新append会改变shard9的bettor_count/pool_value, 而28mln整体结算(consolidate/deadline sweep)可能已经基于"shard9=已知状态"做了假设(需J2核实28mln settle-daemon是否已对其他shard做了假设shard9状态的操作)。**推荐refund而非重新advance**:退款路径成熟(有lv3rz先例)、不touch正在结算中的市场状态机、11个bettor本金原样退回没有经济损失,风险面小得多。重新advance在纯技术上"论证成立"但操作风险不対称地高,不建议。

## J2补充(settler域: settlement-pipeline影响核实)

**28mln当前状态(直查DB, 2026-07-11)**: `protocol_status='verifying'`, `settle_txid=null`——印证J1判断: 确实已离开`pending_bettors`, `/register-v07/confirm`正常路径会拒。**无`pool_committee`缓存行**(committee尚未抽样)——这点关键: 意味着纠正shard9发生在committee抽样**之前**, 时序上是对的(若已抽样缓存, 纠正后的pool构成会跟已锁定的committee快照脱节, 需要额外失效逻辑; 现在不存在这个问题)。**shard0-8='settling'(已折入PayoutShard)/shard9='sealed'(卡点)/shard10='open'(count=1, 1500000000 sompi=15KAS, 天然partial trailing shard, 尚未sealed)**——consolidate流程还没跑到shard9之后的任何一步, 没有下游状态"已经假设shard9=32笔"过, 纠正不会打翻已完成的工作。

**🔴 方案A步骤3的一个缺口(必须堵, 否则守恒会假绿又真崩)**: "标记为refunded"这个动作本身**不会**把这11笔从结算计算里排除——查了`getMarketBets`(pool-bettor-sides-query.mjs:93, 全库settler/daemon读bet-count/pool/payout的**唯一合法入口**, lint-kanet堵裸读): 它对bshard市场的排除粒度是**整片shard**(`WHERE status != 'manual_recovery_refunded'`, 见L104-105), 片内的`getSidesByShard`(L38-42)是**裸`SELECT * WHERE market_id=?`, 没有任何按行过滤的手段**(pool_bettor_sides本身也没有一个"排除出池"的列)。也就是说: 只要这11行还在`pool_bettor_sides`里且shard9不是整片被排除, `getMarketBets`会原样把32个bettor都读回来算payout_root——跟纠正后covenant实际只backing 21个bettor(648.24KAS)对不上, 会在settle/consolidate某一步撞守恒不符(比J1提的"重新advance风险"更隐蔽, 因为它不会立刻报错, 而是让payout_root算出一个链上验不过的假值, 委员会拒签或更糟——委员如果没做这层交叉验证会签出一个凭空多了11人份额的错误分配)。

**🔴 更正(J2自查撤回)**: 上面"按`merkle_index<count`过滤"这条建议是错的——直查shard9全32行实际数据, `merkle_index`字段值**全部是常量9**, 不是按片内注册顺序分配的0-31。查了`recordBettor`实际INSERT语句(pool.js:1574-1575)确认这一列写入的其实是`shardIndex`(=9, 分片序号), 不是片内下注序号——列名带"merkle"但语义与这次需求无关, 是我没先查值就假设了字段语义。撤回, 不采用。

**改用方案(范围收紧, 不碰共享函数)**: 已知这11笔的具体`pool_bettor_sides.id`(33444/33446/33449/33450/33452/33458/33459/33460/33467/33468/33471)——payout/结算计算读取shard9的bettor列表这一步, 按这个显式id列表排除, **不改`getSidesByShard`/`getMarketBets`这两个全库共用入口**(避免像NWT提醒的"通用改动不该跟这次操作绑在一起"; 若未来再遇到类似情形再评估是否值得补通用机制)。这11行仍标记refunded(记录退款时间, 供审计/防重复退款), 但**结算侧排除靠显式id列表, 不靠这个标记**——避免"结算正确性依赖有没有人记得去读某个标记"这个隐患。

**refund runbook适配**: lv3rz(2026-06-30)先例是整片shard排除+退款, 28mln这次是"片内部分排除"——机制不同但退款本身(gateway原路退stake给bettor_pk对应linked_addr)是同一个原语, 复用没有结构性障碍, 只是触发范围从"整片"变成上面11个具体row id对应的bettor_pk列表(从`pool_bettor_sides`原样读, 不受结算侧id排除影响, 退款走的是另一条读路径)。

## Bettor方向审notes(已核,折入)
- **身份新地面(Bettor独立核实)**: 11笔的4个bettor_pk全部是内部bot relay——HouseAgent(5笔×50KAS)/UnderdogBot(4笔×15KAS)/AutoBetter-1(48.81KAS)/AutoBetter-2(48.56KAS),custodial地址零命中真实用户。**零真实用户受影响**,退款面全内部,不需要用户面文案/Owner批沟通稿。
- **(a) payout基数值源核实**: 28mln整体payout计算必须以纠正后shard9(21注/648.24KAS)为准——J2需在其补充节明确payout实际读的pool基数来自链上`consolidatedPool`(自然只含真实21注)还是任何DB侧`projected_settle_mass`/`pool_value`等缓存值(后者若还是32笔口径必须先排除, 不能直接用)。这条待J2最终确认后NWT才能给收尾GREEN。
- **(b) 退款执行纪律**: 走lv3rz runbook, 但退款txid必须链上验证+写回`pool_bettor_sides`的退款记录字段(非空手认领); 广播前Bettor会predict-then-verify预钉这11行/4个bettor_pk/Σ=40737000000 sompi逐分对上, 不接受近似值。
- **执行序(不跳步)**: J2补完两问(已完成,见J2补充节)→NWT终GREEN(收尾(a)后)→Bettor终验→才动手执行,退款环节同样遵守"设计先行"纪律,不因为是退款就简化流程。

## 落地纪律
纯设计,不动DB/不广播交易。NWT红队后交Bettor终验,批准后按方案执行,执行本身也要走"设计→NWT审→Bettor验"同一节奏,不因为是"退款"就跳过。
