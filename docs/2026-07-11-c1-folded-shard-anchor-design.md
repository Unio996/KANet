Status: DRAFT — J1(shard/链锚域)主笔, J2(settler域主)审, NWT红队, Bettor终验。禁止实现前直接改DB/改判定逻辑上线。

# C1链锚问题: 已折叠(folded)shard的leaf-outpoint创建tx物理不可读

## 根因(已定位,非phantom/非bug,是设计假设过时)
`verifyBettorsCompleteFromChain`(bshard-close-enforce.mjs:728-783)对每个shard验"leaf state链锚":
`ctx.readOutpointCreatedAddr(current_leaf_outpoint)` == `p2sh(spliceLeafState(shard_redeem_hex, current_leaf_state))`。

`readOutpointCreatedAddr`(bshard-close-voter.js:205-210)的实现是查本地`kaspa_tx_log`表(`SELECT outputs_json WHERE tx_id=?`)——这是个indexer表,不是RPC实时查询。已确认(J2:7.39M行查0命中;J1:shard1封片时间2026-07-07 21:13早于我节点当前kaspad剪裁点2026-07-09T08:43,双重证实):**28mln整个下注期(7/7-7/8)的leaf-creation tx既不在任何已知节点的kaspa_tx_log里,也已经过了kaspad自身的RPC剪裁点**——两条读路径都物理够不到,不是bug,是"老block不可能被两种机制中的任何一种覆盖到"这个事实。

**设计假设过时点**: `readOutpointCreatedAddr`(landed-in-history)这个机制本来就是为了解决"leaf已经consolidate/spent,checkUtxoLanded(unspent)会false"这个问题(见758-763行注释,ozzeu 2026-06-23事故),但没考虑到"这笔tx本身可能老到超出indexer�covery+RPC剪裁双重范围"——那次修复解决了"spent"问题,没解决"太老"问题,两个是不同的失效模式。

## 影响范围
28mln的shard0-8(已'settling'=已折叠进PayoutShard)全部同龄(7/7-7/8下注期),C1对它们逐片会全部撞到同一个"读不到创建tx"失败——这不是shard9纠正引入的新问题,是28mln这个市场的委员签名流程本来就会在shard1(第一个被检查的folded shard)卡死,shard9纠正完成与否都绕不开。

## 方案: 折叠shard降级为聚合链锚,不逐片验历史创建tx
C1现有代码里【已经存在】一个聚合层链锚(bshard-close-enforce.mjs:805-817,`ctx.psConsolidatedPool`检查): `consolidatedPool == PS_SEED + Σloaded`——这个值来自PayoutShard**当前**链上状态(近期块,活UTXO,两种读路径都够得到)。

**改动**: 在级2-A逐片验证循环(750-783行)里,对`status`已经是`'settling'`(已折叠/已consolidate进PayoutShard)的shard,**跳过**`readOutpointCreatedAddr`/`checkUtxoLanded`那步个体链锚,直接信任该shard的`current_leaf_state`参与聚合求和;对`status`仍是`'open'`/`'sealed'`(尚未折叠)的shard,**保持现有逐片链锚检查不变**(它们的leaf outpoint是近期的,两种读路径都读得到,该验的继续验)。

聚合层(`psConsolidatedPool`)检查本来就存在且不受影响——它继续兜住"folded shard们的state总和是否跟PayoutShard实际吸收的金额一致"这条底线。

## 残留风险(必须显式披露,不能藏)
这个降级**减弱**了对已折叠shard的**单片**反伪造保护——原来的逐片检查除了验总额,还验每片的local_yes/local_no/count具体拆分(anti-swap:防止有人在两个已折叠的片之间把YES/NO份额互换而总和不变)。降级后,**如果两个已折叠shard之间的yes/no份额被对调但总和不变,聚合层检查会PASS**(psConsolidatedPool只看Σpool_value,不看yes/no细分)——这是个真实存在、需要团队明确接受的风险敞口,不是"降级=零风险"。

**缓解/待讨论**: 
- (a) 这类攻击需要能改DB(pool_bettor_sides/market_shards)且清楚anti-swap的具体机制才能构造,不是外部攻击者能做的事,更像"内部人篡改"场景;shard9这次纠正本身走的是"设计→NWT审→Bettor验"全程留痕,不是这个降级要防的那类场景。
- (b) 是否需要额外加一条"折叠shard的Σlocal_yes/Σlocal_no(不分片,只求两个跨片汇总)"链锚,让聚合层至少能抓"总yes/no被整体篡改"(仍抓不住"片间互换"但比纯pool_value更细一档)——这个我倾向加(成本低,收益明确),但不在这次范围内做,先解决"委员签不出来"这个today的BUST,风险敞口的进一步收窄留follow-up。

## 落地范围
- 改动文件: `bshard-close-enforce.mjs`(verifyBettorsCompleteFromChain的级2-A循环,加`sh.status==='settling'`分支)
- 不改: `readOutpointCreatedAddr`/`checkUtxoLanded`本身、聚合层check(811-817行)、级2-B per-ticket check(819-864行,ticket本身是bettor自己的dust票据,时效性跟leaf不同,需要J2/NWT确认是否也撞同样的"太老"问题——若撞,同一个降级思路适用,但ticket地址是per-bettor不是per-shard,粒度不同,需要单独判断,这次先只动C1级2-A)。
- 需要J2/NWT确认: 级2-B(per-ticket anti-swap)对这批老bettor的ticket地址会不会撞同一个"kaspa_tx_log/RPC都够不到"的问题——如果撞,这条设计需要扩展覆盖级2-B,现在先标记为待查,不假设没事。

## 验收
- (i) 用28mln真实数据跑一遍改后的verifyBettorsCompleteFromChain,期望shard0-8(folded)不再因创建tx读不到而BUST,聚合pool_value检查仍然生效(故意改一个shard的pool_value验证会BUST,确认没有"降级=什么都不验了")。
- (ii) 对仍是open/sealed的shard(如shard10),确认原有逐片检查行为不变(regression: 故意伪造shard10的leaf state应该仍被抓)。
- (iii) test-framework加对应regression case。
