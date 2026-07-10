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

## 待J2补充
- 28mln当前protocol_status实际值+其他shard是否已假设shard9状态推进
- refund走既有runbook是否需要额外适配(28mln是v0.7/bshard,跟lv3rz是否同款结构)

## 落地纪律
纯设计,不动DB/不广播交易。NWT红队后交Bettor终验,批准后按方案执行,执行本身也要走"设计→NWT审→Bettor验"同一节奏,不因为是"退款"就跳过。
