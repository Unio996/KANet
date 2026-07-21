# V2/ZK-native 市场退款编排设计 v0.2(cancelMarketLiveV2)

> **Status**: CURRENT(v0.2, NWT 2 MUST-FIX 全折入, 待 NWT 快速复核 + Owner money-path 签发)

- 作者: J1tn(SS covenant/enforce 域)· v0.1 2026-07-18 · **v0.2 2026-07-19: 折入 NWT 红队 2 MUST-FIX**(`docs/2026-07-18-NWT-redteam-v2-cancel-refund-design.md`)——①§3 二选一定案=splice 非 ctor 重编译+4 attest 字段 cancel 语义读 .sil 坐实; ②§7 kr5l4 表项 v0.1 修正版(ce35e3d3)已含, 本版再叠 5a0b2772 committee-seed 解法引用。
- 触发: kr5l4/j34vb/aukqt 三盘半决赛, 实测 side_lock_daa 100% 墙下方(kr5l4 694/694、j34vb 10/10, J1/J2/NWT 三方核) = 结算物理不可能 → 退款。
- 缺口: `bshard-auto-settler.mjs:782-786` J2 2026-07-08 预留 TODO 点名 kr5l4/j34vb + 本 doc。
- **scope 关系(7/19 更新)**: Gate0 报告扩为 15 盘 stranded(67192.52KAS), 总路由=J2 workstream A(`docs/2026-07-19-stranded-markets-refund-routing-design.md`)。本 doc 收窄为其中 **V2/ZK-native 家族盘的 cancel 使能件**(kr5l4/j34vb 已知 V2; aukqt=V1 走现成 cancelMarketLive; 其余 12 盘家族归属由 workstream A 逐盘定)。

## 1. 退款能成而结算不能

退款只读 DB `stake_amount` 建 refundRoot(computeRefundPlan:659), **不碰丢失的 side_lock_daa**——三盘能干净退款的根本(结算需 side_lock_daa 做 committee-exclude+ZK 判定锚, 已物理裁剪)。

## 2. 现成 bshard-aware 件(频道四方读码确认, 非从零建)

- **cancelMarketLive**(bshard-auto-settler.mjs:715-800+): 完整 bshard-aware 自包含 driver(build cancel_attest→4-of-5 committee sign→driver enforce 硬闸→submit→refund_claim 循环, 全程 relayPost, **不经 legacy dispatchRefund**, 避开主 tick isBshard 早退坑 pool-market-settler.js:388-389)。V1 已 proven。
- **reclaimBshardMakerBond**(bshard-auto-settler.mjs:847): maker bond(PoolSpine 容器①)bshard-aware 收口, 7/13 落码+四闸离线回归。**maker bond 非 gap**(纠早前误判)。
- 结论: 复用现成 cancel_attest+claim threading 骨架, **只补 V2 家族分派一层**(NWT 精确划的范围)。

## 3. V2 唯一新增: 家族分派(cancelMarketLiveV2 / kr5l4·j34vb)

### 3.1 expectedCancelledAddr 构造 = **splice, 不是 ctor 重编译**(NWT MUST-FIX① 定案)

v0.1 原文"家族分派 `compilePayoutShardV2Redeem`(V2, closed=2)"**按字面不成立**——该函数(pool-shard-register.mjs:229)签名只有 `{poolMerkleRoot, predicateCommit, closeZkTmplAnchor, consolidatedPool}`, closed/payoutRoot/4 attest 字段全部硬编码 genesis 值(0/z32/-1/0/z32/z32), 是 genesis-mint 专用函数。二选一定案:

- **✅ 选: splice 链上 redeem**。新增 `_splicePayoutV2CancelRedeem(psv2RedeemHex, refundRootHex)`(落 bshard-close-enforce.mjs, **复用既有 `_PSV2_*` offset 常量单源**, 同 `_splicePayoutV2CloseRedeem`:157/`readPayoutShardV2AttestedState`:196 三函数共一份表): 只写两处——closed=2 @ `_PSV2_CLOSED_OFF`(10) + payoutRoot=refundRoot @ `_PSV2_PAYOUTROOT_OFF`(19); **consolidated_pool/w0-16/4 attest 字段的字节一概不动**(从 input redeem 原样带过)。源 redeem = 当前链锚 consolidated PS redeem(ctx.psState 当前态), 非 DB 字段重编译。
- **❌ 不选: 扩展 `compilePayoutShardV2Redeem` 签名走 ctor 重编译**。三条依据: (a) **K-18④(DEC-20260718-001, Owner 2026-07-18 拍'采用+ABC')明文"续期地址只认链上 redeem+splice、不认 DB 重编译"**——V2 cancel 若走"读 DB 字段→重编译→预测地址", 正是 8pson(zk_native flag 误改→按错家族重编译→地址分叉)同一事故类; (b) V1 侧 `_j2_A_close_attest` 已实证 recompile==splice==psContAddress byte-equal, splice 是已 proven 的等价物; (c) `_PSV2_*` offsets 已经 NWT 2026-07-07 独立按源码 derive 核过一轮(W2)。
- ctor 重编译**只留测试位**: 离线 regression 里把 `compilePayoutShardV2Redeem` 加 test-only 全参变体, 验 recompile(closed=2,root=R,attest=genesis)==splice(genesis redeem) byte-equal——两条独立推导路径互证(非 vacuous, 规则56), 进 §8 DoD。

### 3.2 四个 attest 字段的 cancel 语义(NWT MUST-FIX① 第二半, 读 .sil 坐实非猜)

- `cancel_attest`(.sil:187-284): require(closed==0); validateOutputState **273-282 行透传输入原值**——`attestedWinner: attestedWinner, attestedAtMs: attestedAtMs, betsRootBaked: betsRootBaked, refundRootBaked: refundRootBaked`。对从未 attest 的盘(closed=0)即 genesis 值 **-1/0/z32/z32**。cancel ≠"改写这些字段为某 cancel 标记", 而是"这些字段永远停在输入态"。
- `refund_claim`(.sil:287-345): 校验只读 `payoutRoot`(307 行 `require(cur == payoutRoot)`, cancel 后=refundRoot)——**4 attest 字段在 refund_claim 的任何 require 里都不出现**, 只在 validateOutputState(334-343)要求继续透传。
- **含义**: driver 不需要也不允许为这 4 字段发明值。splice 方案不触碰那些字节 = by construction 透传正确; 万一错了 validateOutputState 链上直接拒(fail-closed, 无资金风险)。

### 3.3 其余分派点(v0.1 原文, 不变)

1. cancel_attest: PayoutShardV2.sil entry(closed 0→2, new_refundRoot+4-of-5 委员签+4 尾随字段透传, .sil:187-284)。relay `bshard_cancel_attest` 落码前核 V2 家族感知(§6.4)。
2. refund_claim: PayoutShardV2.sil entry(closed==2, bettorPk+refund+depth-10 merkle, .sil:287-345)。
3. **claim threading 的 continuation redeem 同样走 V2-aware splice**: V1 的 `splicePayoutContinuation`(bshard-auto-settler.mjs:612)整段重序列化的是 V1 204B state 布局, 对 V2(288B, 多 4 尾随字段)直接用会截错——V2 claim 续约 = 只 splice consolidated_pool(-refund)+对应 w 字(bitmap 置位)两处, 其余字节(closed=2/payoutRoot/4 attest)不动, 仍共 `_PSV2_*` 常量表。
4. 签名走 bshard-close-voter.js:497(V2 safe_json proven)——绕 jepu1 经典路坑。

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
3. ~~**aukqt endBlockHash**~~ **已解**: 该风险实际覆盖 kr5l4+aukqt 两家(NWT MUST-FIX②, kr5l4 index hash 是假阳性), 但 5a0b2772 后退款路 committee seed 已零 endBlockHash 依赖, 整条风险消解——见 §7。
4. relay `bshard_cancel_attest` V2 家族支持(§3.2)。

## 7. committee endBlockHash 三盘分野(J2 RPC 直核订正)

⚠ 早前"kr5l4 covered:true 有 hash 可选"是 **index 假阳性**——J2 直接 RPC 核 kr5l4 的 index hash(e5ec9d1a…)**同样 cannot find header**(index 记了但节点已裁,同 aukqt/j34vb-8bettor)。订正:
- j34vb: deadline 61421827 墙上方 + index 回填(J2 RPC 核过 canonical block 真存在)→ **committee 真可选**(唯一)。
- kr5l4: deadline 60722281 墙下 + index hash RPC 核=cannot find header → **committee endBlockHash 拿不到**(假阳性, 非可选)。
- aukqt: 58695372 墙下 + cannot find header → 拿不到。

**含义(退款也要 committee 签 cancel_attest → 需确定性 seed 选 committee)**: kr5l4/aukqt 的 endBlockHash 墙下不可得 → 旧 `deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot)` 算不了 → cancel_attest 的 committee 选不出——这曾是三盘退款的**共同障碍**(v0.1 头号未决)。

**✅ 已解(2026-07-19, J2 `5a0b2772`)**: 退款路径 committee seed 改 `deriveRefundCommitteeSeed(marketId, poolMerkleRoot)`——纯 ctor-baked 链上不可变锚, **零 endBlockHash 依赖**, 结算路 `computeSettlePlan` 一字未动(NWT 独立读码 GREEN, `docs/2026-07-19-NWT-redteam-refund-committee-seed-diff-verdict-5a0b2772.md`; covenant 侧 cancel_attest 只验签名/pk 唯一/committeePkHash/merkle membership, 不验 seed 本身, J1/NWT/Bettor 早前已各自独立核)。该修目前**留在 `review/j2-refund-committee-seed` 分支未 merge**(Bettor 7/19 12:00Z 拍: 钱路码不单独抢 merge, 跟整条退款路径一起过 Owner 批时再上)——**本 doc 的 cancelMarketLiveV2 落码必须基于该分支(或 merge 后的 live 分支), 不基于旧 seed 路径**。endBlockHash 三盘分野自此只剩史料价值, 不再是退款阻塞。

## 8. DoD

1. cancelMarketLiveV2 落码(§3)+regression(V2 退款 root 从 stake 不读 side_lock_daa + 守恒断言)。
2. **splice↔recompile byte-equal 离线 regression(§3.1)**: test-only 全参 `compilePayoutShardV2Redeem` 变体 recompile(closed=2, payoutRoot=R, attest=genesis) == `_splicePayoutV2CancelRedeem`(genesis redeem, R) 逐字节相等——两条独立推导互证(规则56 非 vacuous), 同 W2 对 close 路的 DoD 惯例。
3. consolidate 前置 getUtxos(kr5l4)。
4. 落码 base = `review/j2-refund-committee-seed`(含 5a0b2772)或其 merge 后的 live 分支(§7), **不基于旧 endBlockHash seed 路径**。
5. §4 全资金守恒 Bettor 逐笔核 landed。
6. 走 bshard-close-voter safe_json(绕 jepu1)。

## 9. money-path 硬门

设计→NWT→Owner 签(kr5l4 25075+j34vb 395+aukqt 28805=~54270KAS)。closed 0→2 write-once 不可逆——cancel 前确认"真·永久无解"(side_lock_daa 100% 墙下方实测坐实, 满足)。执行 Bettor 逐笔验。

## 10. NWT 审读重点

1. §3 家族分派全枚举(grep compilePayoutShardRedeem cancel 路径, 规则64);
2. §6.1 reclaimBshardMakerBond scope 对三盘;
3. §5 consolidate 前置 getUtxos 对 V2 正确性;
4. §6.3 aukqt endBlockHash;
5. refund_claim V2 state 4 尾随字段透传;
6. J2 settler 域分工(复用现成骨架)。
