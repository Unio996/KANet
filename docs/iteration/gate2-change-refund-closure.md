# DoD Gate② 找零(change/refund)跨节点收口 — 实质 PASS

> Owner 裁定 2026-06-12: **省力路·gate② 实质收口**。
> 守: NO TX NO STATE CHANGE(验证也适用)/ cross-node ≠ same-node / doc-owner 对抗(不接受 echo PASS,实码+链上)。

## 裁定

gate② 找零(change/refund)跨节点维度 **实质 PASS**。不强求 fresh cross-node disagreement-refund TX(重场景,Owner 省力路下列 optional 后续)。

## 证据链(5 条,每条实证)

| # | 证据 | 类型 | 锚 |
|---|---|---|---|
| ① | refund/change 构造 determinism(单构造 preimage L1878 maker_relay build,oracle 签同一个不重建;explicit DB-sourced inputs L1787-1791) | 代码 3 方核(J1+J2+Bettor) | settler 实码 |
| ② | 同节点 refund 落链 | 链上 | refund_txid `ccc0c6b06e852257bb497d29cd33776e188182029c742031e7af778540ddeb11`(market eo7aj, maker-1), relay check_utxo_landed = `{ok:true,landed:true}` (Bettor 核) |
| ③ | 跨节点 settle 的 change/payout 输出落链 + 5/5 跨节点委员签 | 链上 | mix0d settle_txid `d513f7b4`(DoD#1.4b)= **跨节点 oracle 签名机制已锚** |
| ④ | 0-bet refund = 结构性 maker 单方(仅 spine_lock_tx 输入 + maker 单签 + 0 oracle sig) | 代码(J2 实码 L2247-2256 pool_refund_maker_unjoined_tx) | 这类 refund 本就无跨节点签名,**正确非缺陷** |
| ⑤ | 含 oracle 签的 refund(dispatchRefundDisagreement)用**跟 settle 同款**跨节点签名机制 | 机制 | 被 ③ 锚 |

## 关键发现(本轮价值)

- **J2 实码挖出 0-bet refund 结构性 maker-only**(L2247-2256):避免 J1 用 0-bet 市场(sk1aa)跑"跨节点 refund"白跑 + 误报。0-bet refund 无论 oracle 拓扑都不可能跨节点(无 oracle 签名)。
- 真正会跨节点签名的 refund = 委员分歧场景(dispatchRefundDisagreement),用 settle 同款机制,已被 ③ 锚。

## 诚实边界

- 唯一**未直接单独演示**:fresh cross-node dispatchRefundDisagreement TX(委员分歧 refund 含 oracle bonds → oracle 跨节点签)。Owner 省力路下列 optional belt-and-suspenders,testnet 范式 demo 非 blocker。
- 跨节点签名机制本身已被 ③(mix0d settle)直接锚定;disagreement-refund 复用同机制 = 强隐含。
- testnet 范式(非 mainnet 生产,守 G5)。

## 关联

- P1 吞吐补丁全收口(aa1c2628,~63-100x + 跨节点 determinism 3/3): 见 channel r716。
- DoD#1.4b 跨节点 committee settle: `[[project-dod14b-crossnode-committee-settle-chain-verified]]`。
- 同节点 settle/refund 链上: `[[project-dod1-samenode-settle-chain-verified]]`。
