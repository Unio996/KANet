Status: DRAFT — J1(shard/链锚域)主笔, J2(settler域主)审, NWT红队, Bettor终验。禁止实现前直接改DB/改判定逻辑上线。

# C1链锚问题: 已折叠(folded)shard的leaf-outpoint创建tx物理不可读

## 根因(已定位,非phantom/非bug,是设计假设过时)
`verifyBettorsCompleteFromChain`(bshard-close-enforce.mjs:728-783)对每个shard验"leaf state链锚":
`ctx.readOutpointCreatedAddr(current_leaf_outpoint)` == `p2sh(spliceLeafState(shard_redeem_hex, current_leaf_state))`。

`readOutpointCreatedAddr`(bshard-close-voter.js:205-210)的实现是查本地`kaspa_tx_log`表(`SELECT outputs_json WHERE tx_id=?`)——这是个indexer表,不是RPC实时查询。已确认(J2:7.39M行查0命中;J1:shard1封片时间2026-07-07 21:13早于我节点当前kaspad剪裁点2026-07-09T08:43,双重证实):**28mln整个下注期(7/7-7/8)的leaf-creation tx既不在任何已知节点的kaspa_tx_log里,也已经过了kaspad自身的RPC剪裁点**——两条读路径都物理够不到,不是bug,是"老block不可能被两种机制中的任何一种覆盖到"这个事实。

**设计假设过时点**: `readOutpointCreatedAddr`(landed-in-history)这个机制本来就是为了解决"leaf已经consolidate/spent,checkUtxoLanded(unspent)会false"这个问题(见758-763行注释,ozzeu 2026-06-23事故),但没考虑到"这笔tx本身可能老到超出indexer覆盖+RPC剪裁双重范围"——那次修复解决了"spent"问题,没解决"太老"问题,两个是不同的失效模式。

**(n1,Bettor方向审要求补的论证)方案成立的关键前提——为什么open/sealed分支不撞同样的墙**: `checkUtxoLanded`(bshard-close-voter.js:186-200,txid给定分支)走的是`check_utxo_landed` relay IPC → relay直连自己的kaspad节点做`getUtxosByAddresses`风格的实时UTXO集查询,这条路径查的是【当前活跃UTXO集】,不需要读取任何历史区块数据——只要这个outpoint的UTXO还没被花掉(unspent),不管它是哪年创建的,活跃UTXO集里都能查到,天然不受RPC剪裁/indexer覆盖窗口限制(剪裁只影响"能不能翻回去看老区块",不影响"当前UTXO集里有什么")。这正是shard9(status=sealed,leaf UTXO=67ebc76a...:0,J1/Bettor两节点RPC复核过仍在)和shard10(status=open)这两类"未折叠"shard天然免疫这个问题的原因——它们的leaf UTXO处于unspent状态,查的是"现在"不是"历史"。已折叠(settling)的shard则相反:它们的leaf UTXO在fold操作时已经被花掉(consolidate把它spend进了PayoutShard),`checkUtxoLanded`对一个已花的outpoint必然查不到(这正是ozzeu 2026-06-23那次事故的起因,才引入了readOutpointCreatedAddr这个"查历史创建tx"的机制)——而"查历史创建tx"这条路径本身又会撞到本文档描述的"太老"问题。两条路径的免疫/易感边界精确对应"unspent vs spent",不是运气,是机制本身的结构性差异。

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

## (n3,J2/NWT升级为确定项)级2-B同样会挂,原因不是"太老"是"从没被watch过"
`checkUtxoLanded(addr, txid)`在`txid=null`(级2-B per-ticket调用方式,line 852)时**结构上没有live查这条路**——relay的`check_utxo_landed` IPC命令schema把txid定为必填字段,txid缺省直接是INVALID COMMAND,不是"查了没找到"(bshard-close-voter.js:193-197注释原文)。此时代码走`SELECT 1 FROM kaspa_tx_log WHERE outputs_json LIKE '%addr%'`——J2实测确认ticket地址(per-bettor派生,不在"已知relay身份"watchlist上)跟shard9那次的gateway地址不是一回事: 不是"老到查不到",是"这张indexer表从一开始就没在watch这类地址",概率上大概率对这批老bettor的全部ticket地址都会查不到(即使ticket本身链上仍是unspent dust,查询机制本身就够不到)。

**修复方向**: 需要relay侧(kasia-relay)给`check_utxo_landed`命令加一个地址-only(无txid)的live查询模式——直接对relay自己的kaspad连接做`getUtxosByAddresses([addr])`,有UTXO即landed,不经kaspa_tx_log。这是跨包改动(kasia-relay+kasia-console两侧的IPC协议),范围比级2-A(纯console侧)大,需要J2(settler域,relay IPC协议熟悉)主笔这部分或至少共同设计;J1这版先把问题坐实+给出方向,具体relay命令改动细节请J2补。

**验收(i)按Bettor钉的加一步实测**: 对28mln全部303张ticket地址跑一次真实`getUtxosByAddresses`(不经kaspa_tx_log),确认全部unspent/存在——这个实测结果本身就能证明"ticket没丢,只是查询机制查不到",是这版设计成立的关键证据,不是可选项。

**(更新,J2实测中)** 抽样7个(跨shard0/2/4/6/8/9/10,含folded+shard9纠正后+未折叠)现有`checkUtxoLanded(addr,null)`(即现状kaspa_tx_log路径)**7/7命中true**,零false——数据目前**不支持**"级2-B从没被watch过"这个假设,倾向支持**方案A: 级2-B维持现状,不需要relay侧改动**。下面的"修复方向"(addr-only live查询)保留作为方案B,视全量303张的结果二选一——若扩大样本后出现任何false,则采用方案B;若303张全部命中,级2-B这一节可以整体划掉,只需在doc里留痕"已验证过、结论是不需要动"。等J2跑完全量结果,由NWT/Bettor拍二选一,我不预判。

## 落地范围
- 改动文件①(级2-A,J1范围): `bshard-close-enforce.mjs`(verifyBettorsCompleteFromChain的级2-A循环,加`sh.status==='settling'`分支)。
- 改动文件②(级2-B,J2范围,本次纳入不留follow-up): `kasia-relay`的`check_utxo_landed`命令handler(加地址-only live查询模式)+ `bshard-close-voter.js`的`checkUtxoLanded`闭包(txid=null分支改调用新live模式,不再回退kaspa_tx_log)。
- 不改: `readOutpointCreatedAddr`本身、聚合层check(811-817行)、级2-A对open/sealed shard的现有逐片检查。

## 验收
- (i) 28mln全部303张ticket地址实测live getUtxosByAddresses,确认unspent/存在(见上,n3新增,证明级2-B的"查不到"是查询机制问题非资产问题)。
- (ii) 用28mln真实数据跑一遍改后的verifyBettorsCompleteFromChain,期望shard0-8(folded)不再因创建tx读不到而BUST,聚合pool_value检查仍然生效(故意改一个shard的pool_value验证会BUST,确认没有"降级=什么都不验了")。
- (iii) 对仍是open/sealed的shard(如shard10),确认原有逐片检查行为不变(regression: 故意伪造shard10的leaf state应该仍被抓)。
- (iv) 级2-B改用地址-only live查询后,对同一批303张ticket重跑enforce,确认不再BUST。
- (v) test-framework加对应regression case(覆盖①②两处改动)。
