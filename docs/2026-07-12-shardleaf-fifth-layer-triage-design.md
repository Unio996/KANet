# ShardLeaf 第五层 triage 设计 — leaf front phantom vs 未知缺口

> **Status**: CURRENT(设计稿·待 NWT 红队 + Bettor 审;落码前不动代码)
> **作者**: J2 · 2026-07-12 · 派工: Bettor #hdrnw4(接位开工令,J2 域主笔)
> **对象**: 桶C 剩余 4 盘(w07cw/sbg5h/0ac0q/yaq0d),consolidate 步撞 `UTXO not found at <shard_p2sh>`,fail-loud
> 零钱动,daemon 每 tick 重试(同形不自愈)。NWT 三分叉判据前置(①phantom/②front-advanced/③indexer-gap)。

## 0. 重要修正:上班末尾诊断有 bug,结论需撤回重验

上班 `scratch/_j2_fifthlayer_triage.mjs` 算的"curAddr"是 `p2sh(shard_redeem_hex)` **原始未 splice**——但
`shard_redeem_hex`(`registerBettorOnShard` → `registerShard`,`pool-shard-register.mjs:406`)是**建 shard 时
一次性烤的 genesis 模板(state=0,0,0,0)**,`onBettorRegistered`(`shard-allocator.mjs:139-144`)只更新
`current_leaf_outpoint`/`current_leaf_state` 两列,**从不改 `shard_redeem_hex`**。真实"当前状态"地址必须
`spliceLeafState(shard_redeem_hex, current_leaf_state)` 后才算(`consolidateAllShards:412` 的真实调用形状)。
`p2sh(shard_redeem_hex)` 算出来的其实**就是 `shard_p2sh`(genesis 地址)本身**——上班"双锚地址全空"实际是
**同一地址测了两次**,零新信息。**已实测验证**(`node -e` 现场跑):w07cw 的 `p2sh(shard_redeem_hex)` ==
`shard_p2sh` 逐字节相同。此修正已入账,下文全部基于**修正后**(真 splice)的诊断。

## 1. 修正后诊断(live RPC,双锚+round-trip 自证)

### 1.1 round-trip 自证(先证方法论,同 gate-tmplhash live-derive 先例)

用今晚 thread-walk 波次里**已成功 consolidate** 的一个真实盘(`1857-ozzeu`,`current_leaf_outpoint` 已被
consolidate tx 花掉)反向验证:`p2sh(spliceLeafState(shard_redeem_hex, current_leaf_state))` 计算出的地址
**逐字节 == kaspa_tx_log 里那笔 consolidate tx 的真实输出地址**(`node -e` 现场核对,`true`)。**splice 重建
方法论本身正确**,下面的负结果不是重建 bug。

### 1.2 四盘现状(genesis 锚 + 真 tip 锚 双查)

| 盘 | DB count/bettor_count/pool_bettor_sides.count | genesis 地址 live | tip(splice DB 状态)地址 live | PS genesis live |
|---|---|---|---|---|
| w07cw | 11/11/11 | 空 | **空** | 2×20,000,000(seed,未花) |
| sbg5h | 19/19/19 | 空 | **空** | 2×20,000,000(seed,未花) |
| 0ac0q | 19/19/19 | 空 | **空** | 1×20,000,000(seed,未花) |
| yaq0d | 22/22/22 | 空 | **空** | 1×20,000,000(seed,未花) |

**关键推论**:**PS genesis 全部未花**(consolidate 从未成功过一次)。ShardLeaf 侧只有 `bshard_consolidate`
才能合法花费 leaf UTXO(spend 需同时消费 PS-input + leaf-input),PS 未花 ⟹ **没有任何合法交易花过这个
shard 的 leaf**。∴ "tip(DB 最终状态)地址空" 不可能是"consolidate 已花但 DB 未记"(claim 侧那种 landed
未持久化模式在这里**结构性不成立**——consolidate 侧没有走到这一步的路径)。真正的问题在于:
**DB 认为已完成的最终状态(count==bettor_count==pool_bettor_sides 行数,三源一致)对应的 on-chain 地址,
根本没有 UTXO 出现过**——即"最后那笔/那几笔 register_append 从未真正落链,但 DB(current_leaf_state +
pool_bettor_sides)已经乐观前进"。**方向与 claim thread-walk 相反**:claim 是"链比 DB 快",这里疑似
"DB 比链快"。

### 1.3 有界组合搜索(w07cw 现场跑,只读零钱动)

若"最后 k 笔登记未真正落链"成立,真实 tip = 从 DB 已知的 11 笔 bet 中**移除 k 笔**后的候选状态。已现场
验证:
- **remove-1**(11 个候选,每个候选=去掉 1 笔已知 bet 后的 state → splice → live 查):**0 命中**。
- **remove-2**(C(11,2)=55 个候选):**0 命中**。

**🔴 前提校验(Bettor 方向审已核):remove-k 结构成立的依据 = `spliceLeafState`(`pool-shard-register.mjs:77-81`)
的 state 是 4 个**聚合字段**(local_yes/local_no/count/pool_value)的纯集合聚合(Σ和/计数),不依赖登记顺序——
子集搜索(去掉任意 k 笔的组合)结构上等价于"链上真实登记集合是 DB 已知集合的某个大小 N-k 子集",这个假设
成立(已亲读代码确认)。

**两层都不中**——排除"最后 1-2 笔乐观写入未落链"这个最简单假设。剩余可能:①k≥3(组合数增长快,
C(11,3)=165 尚可跑,C(19,3)=969/C(22,3)=1540 仍可跑,但需设计明确上限+时间预算);②某笔 bet 的 DB 记录
(stake_amount/direction)本身与链上实际广播值不符(非"缺笔"而是"记错笔",remove-k 搜不到);③真 phantom
(整条 leaf 链某处被 reorg 剪掉,从未在 canonical 链重新出现)。

## 2. Triage 设计(分层递进,每层有退出判据,禁止跳级下结论)

```
L0 round-trip 自证(已做, 见 §1.1)——校准方法论, 每次 triage 跑先过一次(选一个当晚已知成功consolidate的盘)
L1 genesis + tip(DB最终态) 双锚 live 查(已做, 见 §1.2)——两者皆空 → 进 L2；genesis空+tip活 = 正常(不该在
   队列里, 数据不一致另案)；genesis活 = 从未注册过任何东西, 走别的已知路径(不属本设计)
L2 remove-k 有界组合搜索(k=1,2,...K_MAX; K_MAX=3 起步, 候选数 C(N,k) 超过预算(建议 2000)才升 k 前停):
   **🔴 注1(Bettor MUST-FIX)**: 候选地址 live 命中**不等于**状态命中——必须加 amount 断言:命中 UTXO 的
   金额 == 该候选 state 的 `pool_value`,且该 UTXO 是该地址**唯一** UTXO(dust/杂币防线,同 thread-walk H2
   同族的"找到 tip 还要核余额"纪律)。地址碰撞 + 金额不符 = 假命中,不能当真结论用。
   任一候选(通过 amount 断言)live 命中 → 【②可救】: 命中状态 = 真实 tip,缺失的 k 笔**候选**bettor
   进入 §2.1 逐笔链验(不直接判定,见下)。
   全部候选查完仍 0 命中 → 进 L3(记录已尝试的 K_MAX, 挂账不猜)

### 2.1 ②命中后的退款语义(Bettor 注2 MUST-FIX:禁一律退)

L2 命中后,"缺失的 k 笔" 只是**候选**——每一笔必须**逐笔独立链验 `side_lock_tx`**(该 bettor 下注时的
支付交易),三分(同 refund-verify-chain-not-db-claim 铁律,链是终审非 DB claim):
- **side P2SH UTXO 仍 live(未花)** → 真退款候选,钱确实卡在半路,可退;
- **side P2SH UTXO 已被花**(付过款但后续被消费,如被 gateway sweep 走)→ 另案追踪(钱去哪了,非本卡);
- **side P2SH UTXO 从未落链**(bettor 从没真正付过这笔)→ **零退款**(DB 记录的这笔本身就是假/未完成的
  下注意图,没有钱可退)。
禁止对 k 笔候选做"整批退款"的简化处理。
L3 block-scan 正推(28mln/shard9 先例方法论, 只读零钱动): 从 shard 创建 DAA(market_shards.created_at)开始
   正扫区块, 找"花费 genesis outpoint(genTx:0)的 tx"→ 若找到, 解出它的输出地址(=第1次register后的地址,
   已知state=1笔bet的splice, 可现算比对确认)→ 递归找"花费这个新outpoint的tx"→ 一路正推到链真正的尽头。
   这是【definitive】方法(不依赖 DB 任何字段, 纯链正推), 但扫描范围可能跨数周(28mln 先例扫过 30万+行),
   需要分批/限速, 非本设计一次性完成的量级。
   **Bettor 注4(弱先验,非判据)**: L3 正式起跑前,可先查 `kaspa_tx_log` 里 genTx 及各 register tx 的历史
   观测记录,粗圈扫描范围(缩小 block-scan 窗口,省时间)。**命中只证"当时观测过",不证 canonical**(同
   `kaspa-tx-log-hit-is-not-canonical-chain-proof` 铁律)——只能当先验缩小范围,不能替代 L3 本身的判定。
   L3 走到底(链正推停在某个 outpoint 后再没有任何 spend, 且 kaspa_tx_log/live UTXO 都验证该 outpoint
   现在无 live UTXO——即该 outpoint 本身也是 phantom)→【①phantom】: 从该点起的登记序列整体从未落链或已被
   reorg 剪掉, 挂 manual_recovery_refunded 退款路(lv3rz 先例, Bettor 拍板②经济完整性)。
```

**穷尽性纪律(NWT 前置要求)**:L2 未跑满预算前不得下③indexer-gap 结论(indexer 已被 live RPC 绕过,
本设计从 L1 起就是 live-only,③在这个 triage 序列里已经天然排除,不需要单独判);**判①phantom 前必须
走完 L3**(不能停在"L2 没找到"就下 phantom 结论——同 refund-verify-chain-not-db-claim 铁律)。

**🔴 Bettor 注3(报数口径,MUST 遵守)**:L2 全空**只能说**"排除了 DB 已知集合内 k≤K_MAX 的乐观写假设",
**禁止说**"排除了 front-advanced"——若真实情况是"链比 DB 多"(某笔 register 落链了但 DB 从未记录,即
真正的"未持久化"那一侧,跟 claim thread-walk 同方向而非本设计假设的反方向),remove-k(在 DB 已知集合的
子集里搜)**结构性搜不到这种情况**(候选集合根本不包含"DB 未知的第 N+1 笔"这个可能性)。definitive 结论
只有 L3(block-scan 正推,不依赖 DB 已知集合,能发现 DB 完全不知道的登记)才能给。

## 2.2 身份定性(NWT F1,续卡处置输入,不改本轮设计范围)

**4 盘全部 100% 内部身份**:maker_pk 与全部 8 个唯一 bettor_pk(71 笔下注,同 8 个内部 pk 重复参与)逐一命中
`relay_nodes`,0 外部;4 盘创建时间集中 2026-07-06~07 同一时段,同一 maker 建全部四盘——**固定小集合内部
relay 重复参与的测试/彩排批次**,与今晚已定性的 fy1yk(一次性 fresh pk bulk demo)形态不同、族同(内部
资金,非真实用户暴露)。

**影响续卡优先级**(处置决策输入,非本设计裁定):若 L2 全跑仍空,继续投入 L3(独立重活,28mln 先例
30万+行扫描量级)前,应先问是否有比 L3 更便宜的路径——同今晚桶B/fy1yk 已立的豁免收口先例("没转账不叫
refunded",内部测试资金零外部权利主张)可能同样适用于这 4 盘的最终处置,不必然要求 L3 definitive 结论
才能处置。**triage 本身仍该做**(搞清链上真相是任何处置决策的前提,不因内部资金就跳过诊断),只是"L2
全空后是否值得砸 L3"这一步的成本/收益判断需要把这个身份事实喂给处置决策方。

## 3. 本卡范围(诚实边界)

- **本设计交付** = L0(方法论自证)+ L1(双锚诊断,已做)+ L2(有界组合搜索框架 + w07cw 实测到 remove-2)。
- **L2 完整跑完(k 到预算上限,4 盘全跑)+ L3(block-scan)不在本设计落码范围**——L3 是独立量级的工作
  (28mln 先例是多人协作+专用脚本+数十分钟到小时级),留续卡。
- **零资金风险**:全程 fail-loud(daemon 已如此),本设计不改变这一点,只是把"猜"变成"分层有退出判据的
  搜索",每层结论都可独立复核。
- **退款前置**(若 L2 命中②):缺失 bettor 的退款走既有 manual_recovery_refunded runbook,**走前必四方
  独立核对 stake 归属 pk + 金额**(同 shard9/shard10 phantom 处置先例的纪律,非本设计新造)。

## 4. 验收(DoD,分阶段)

1. **本轮**:L0+L1 诊断脚本留存 `scratch/`(gitignored,只读,不进库)；关键结果(splice 修正/round-trip
   自证/四盘双锚状态/w07cw remove-1-2 结果)记入本设计 §1 + ledger,不依赖脚本文件本身留存。
2. **续卡**(排队,非本轮 BLOCKING):4 盘 L2 跑满(w07cw 到 k=3,sbg5h/0ac0q/yaq0d k=1-2 起);任一②命中→
   退款四方核对 runbook;全部 L2 空 → 排 L3 block-scan(独立卡,量级预估+分工)。
3. 报数口径:本设计产出前,4 盘继续挂 TRANSIENT 状态,daemon 重试不误标 settle_failed(现状已如此,不变)。
