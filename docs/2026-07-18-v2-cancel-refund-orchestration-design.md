# V2/ZK-native 市场退款编排设计 v0.1(cancelMarketLiveV2)

> **Status**: CURRENT(v0.1 设计稿, 待 NWT 红队 + Owner money-path 签发——三盘共 ~54270KAS)

- 作者: J1tn(SS covenant/enforce 域)· 2026-07-18 · 锚点 commit `3cd833cd`
- 触发: kr5l4/j34vb/aukqt 三盘半决赛, 实测 side_lock_daa 100% 墙下方(kr5l4 694/694、j34vb 10/10, J1/J2/NWT 三方核) = 结算物理不可能 → 退款。
- 缺口: `bshard-auto-settler.mjs:782-786` J2 2026-07-08 预留 TODO 点名 kr5l4/j34vb + 本 doc。

## 1. 退款能成而结算不能

退款只读 DB `stake_amount` 建 refundRoot(computeRefundPlan:659), **不碰丢失的 side_lock_daa**——三盘能干净退款的根本(结算需 side_lock_daa 做 committee-exclude+ZK 判定锚, 已物理裁剪)。

## 2. 现成 bshard-aware 件(频道四方读码确认, 非从零建)

- **cancelMarketLive**(bshard-auto-settler.mjs:715-800+): 完整 bshard-aware 自包含 driver(build cancel_attest→4-of-5 committee sign→driver enforce 硬闸→submit→refund_claim 循环, 全程 relayPost, **不经 legacy dispatchRefund**, 避开主 tick isBshard 早退坑 pool-market-settler.js:388-389)。V1 已 proven。
- **reclaimBshardMakerBond**(bshard-auto-settler.mjs:847): maker bond(PoolSpine 容器①)bshard-aware 收口, 7/13 落码+四闸离线回归。**maker bond 非 gap**(纠早前误判)。
- 结论: 复用现成 cancel_attest+claim threading 骨架, **只补 V2 家族分派一层**(NWT 精确划的范围)。

## 3. V2 唯一新增: 家族分派(cancelMarketLiveV2 / kr5l4·j34vb)

1. computeRefundPlan:683 `compilePayoutShardRedeem`(V1)→ 家族分派 `compilePayoutShardV2Redeem`(V2, closed=2)——expectedCancelledAddr 对得上链上 V2 covenant。
2. cancel_attest: PayoutShardV2.sil entry(closed 0→2, new_refundRoot+4-of-5 委员签+4 尾随字段透传, .sil:187-284)。relay `bshard_cancel_attest` 落码前核 V2 家族感知。
3. refund_claim: PayoutShardV2.sil entry(closed==2, bettorPk+refund+depth-10 merkle, .sil:287-345)。
4. state: V2=V1 4 段后多 4 尾随字段, state 透传带全(cancel 保 attest 字段原值)。
5. 签名走 bshard-close-voter.js:497(V2 safe_json proven)——绕 jepu1 经典路坑。

## 4. 全资金守恒(Bettor 硬门, 逐笔验; 池内总额出==入)

- bettor stakes → 原址: cancelMarketLive/refund_claim(kr5l4/j34vb V2 §3, aukqt V1 现成)
- maker bond → maker: reclaimBshardMakerBond(§2)
- seed → seeder: 待确认入口(§6)
- broker fee: 别漏

## 5. consolidate 前置(kr5l4·getUtxos 补丁 31fea8b7 仍必需)

cancelMarketLive:720 要 consolidated PS。kr5l4 卡 DB-lag → getUtxos 自愈补丁(31fea8b7, 已装载)救退款前置的 consolidate(它救不了结算的 side_lock_daa 墙, 但救得了这个)。cancelMarketLiveV2 内嵌"确保 consolidated"或前置校验。

## 6. 待确认(落码前逐条坐实, 不凭印象)

1. **reclaimBshardMakerBond scope**: 对 kr5l4/j34vb(V2)+aukqt(V1)是否都适用(NWT flag; 是否 covenant 容器①家族无关)。
2. **seed→seeder 处置入口**: 有无 bshard-aware 现成路。
3. **aukqt endBlockHash**: deadline 58695372 墙下方+cannot find header → committee 选不了 → 即使 V1 cancelMarketLive 也卡 computeRefundPlan:664。aukqt 需独立评估(fallback/人工)。
4. relay `bshard_cancel_attest` V2 家族支持(§3.2)。

## 7. committee endBlockHash 三盘分野

- j34vb: 61421827 墙上方+index 回填✓ → 可选
- kr5l4: 60722281 墙下但 covered:true 有 hash → 可选
- aukqt: 58695372 墙下+cannot find header → ✗(见 §6.3)

## 8. DoD

1. cancelMarketLiveV2 落码(§3)+regression(V2 退款 root 从 stake 不读 side_lock_daa + 守恒断言)。
2. consolidate 前置 getUtxos(kr5l4)。
3. 三盘 endBlockHash 逐盘实测(aukqt 风险)。
4. §4 全资金守恒 Bettor 逐笔核 landed。
5. 走 bshard-close-voter safe_json(绕 jepu1)。

## 9. money-path 硬门

设计→NWT→Owner 签(kr5l4 25075+j34vb 395+aukqt 28805=~54270KAS)。closed 0→2 write-once 不可逆——cancel 前确认"真·永久无解"(side_lock_daa 100% 墙下方实测坐实, 满足)。执行 Bettor 逐笔验。

## 10. NWT 审读重点

1. §3 家族分派全枚举(grep compilePayoutShardRedeem cancel 路径, 规则64);
2. §6.1 reclaimBshardMakerBond scope 对三盘;
3. §5 consolidate 前置 getUtxos 对 V2 正确性;
4. §6.3 aukqt endBlockHash;
5. refund_claim V2 state 4 尾随字段透传;
6. J2 settler 域分工(复用现成骨架)。
</parameter>
</invoke>
