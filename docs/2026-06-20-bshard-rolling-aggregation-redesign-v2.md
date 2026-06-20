# bshard 无限量 — 聚合重设计 v2 (design-first, 字节预算焊进)

> **状态**: DESIGN-FIRST 草案 (J1, 2026-06-20)。Owner redirect: 多片"无限量"是【设计失败=build-then-bust】非物理墙。
> 本文【先逻辑 + 字节预算自洽验, 后建】, 不再 build-then-bust。每条可行性 claim 待 NWT 核 + canonical silverc 实编 × 7.4 率。
> **前置**: `docs/2026-06-02-bshard-rolling-design-consensus.md`(原滚动设计) + 今日 ②生死调查(fold-tree 撞墙实测)。

## 0. 诊断 — 我们为什么撞墙(顺序错 + drift)

1. **drift**: 原设计(6/2 滚动)= 无限独立小分片 + commit_v2 全局锚 + 各片独立结, **无 fold-tree**。我们后期 drift 到 **convert-split + FoldNode-fold-tree**(把分片 covenant-fold 成一个 root), 那个才撞墙。
2. **build-then-bust**: FoldNode 把【fold 聚合 + seal 转换 + commit 完整性】**三合一塞进 1224B**, 建完才 probe 发现 9999 内 **create 不出来**(门1 生产 10887u / 门2 bootstrap 10263u 双源 BUST, 实测)。从没 design-first 在 9999 约束下先验。

## 1. 硬约束(design-first 焊死, 用 probed 率非 stale)

- **create 预算**: 任何 cross-contract convert-create 一个单元 = `(source_reveal + unit_template) × ~7.4u/B < 9999`(7.4 = J2 链上 probed, **非** stale 6.5)。
- ShardLeaf 源 reveal = 451B(register-proven LAND) → **unit_template < 900B**。⚠ 纯 fold-covenant 973B(我 divergent build, canonical 更大)> 900B = **仍 BUST**(NWT 7.4 纠正; 我早先"973B OK"是 6.5 假象)。
- **同合约 continuation**(非 cross-contract)= single-blake2b 自重建 ~2.5u/B, 便宜很多。**lever: 能用同合约 continuation 的就别 cross-contract convert**。
- byte[32]/int ctor 值影响 redeem 字节(int push 随值变)→ 字节验必用 **实值 ctor + canonical silverc**, 非 dummy(今日 silverc-divergence + ctor-假影双坑教训)。

## 2. 关键洞察 — fold 当初干了【两件事】, 别只拆 size

fold-tree 把 N 片折成 1 root, 同时完成:
- **(a) 全局总量**: Σ 所有片 local_yes/no = globalYes/No(算赔率必需)。
- **(b) 资金归集**: 所有片的 KAS 归并进 root → winner 从【全局池】按全局赔率领(parimutuel: A 片赢家可能要 B 片输家的钱)。

**撞墙的是 (b) 的实现(造大 fold node 归集资金)**。∴ 重设计必分别解 (a)(b), 且 (b) 是真难点(fold 存在的原因, 别只盯 (a) 总量)。

## 3. 方向 B(推荐, 原滚动) — 无 fold-tree, sidestep create 墙

**核心**: 分片永远独立小 P2SH(ShardLeaf 量级), 不折叠成大 node。

### (a) 全局总量 = committee-attested commit_v2 (小, 无 fold)
- 关池(deadline)时全局总池锁死。settler 算 globalYes/No, `commit_v2 = blake2b(globalYes‖globalNo‖market_id‖shard_count)`。
- 委员 4-of-5 经 sighash 背书 commit_v2(= **与 oracle verdict 同款已有信任模型**, 非新弱点)。
- 各片 settle entry 链上硬校验: `require(committee 4-of-5 sig on commit_v2)` + 用 commit_v2 里 globalYes/No 算赔率。**每片 settle 单元 = ShardLeaf 量级小**(无 fold node)。
- ⚠ trustless 程度: 总量信任委员(同 verdict)。fold-tree 的"链上数学证 Σ"是 nice-to-have 非 required(委员本就被 verdict 信任)。**用同款信任换掉 SIZE 墙 = 合理工程取舍**。

### (b) 资金归集 = 待设计的真难点(候选, 逐个 design-first 验)
- **B1 settler-orchestrated 归集 + 链上验**: settler 发归集 TX 把输家片资金路由到赢家片, 链上 introspection 验【路由后总量守恒 + 目标地址 == commit 承诺的赢家集】。每步小 TX, 非大 fold node。难点 = 归集 TX 的链上验逻辑要小且安全。
- **B2 designated payout-shard**: 关池时归集到一个【专用 payout 片】(非"fold node", 是普通 ShardLeaf 量级的池, 只是被指定收钱), winner 从它领。归集 = 各输家片 spend 到 payout-shard, 链上验目标 == commit 锚的 payout-shard。
- **B3 claim-pull 跨片**: winner claim 时直接 spend 多个片的 UTXO 凑够 payout(merkle-prove ∈ commit 的赢家集 + 跨片 input 求和)。无归集 TX, 但 claim TX 多 input。
- 每个候选: **先 offline 编译实字节 × 7.4 < 9999 + NWT 核组合安全**, 再选。

## 4. 方向 A(备选, 拆 fold-tree) — 仍知 knife-edge

保留 fold 但把 FoldNode 三件拆成各 <900B 独立步。但 **纯 fold-covenant 973B 已 > 900B 预算(7.4 率)** → 必再砍:
- **streaming-manual fold**(记忆 `reference-silverscript-covenant-fold-limits` 点4): `for(k){readInputState(OpCovInputIdx(cov_id,k))}` 不建 `State[] prev_states` 数组 = O(1) 栈 + **可能更小字节**(去掉 auto-form State[] 机器)。待编译实测能否 <900B。
- 或缩 ShardLeaf 源 reveal <451B(腾预算)。
- A 即便 fit 也 knife-edge(命门③ enforce / fee 字段一加 re-bust, NWT fragility 立)。**∴ A 是 fallback, B 更结构稳**。

## 5. design-first 验证协议(NWT core, 防 build-then-bust 再犯)

每提一个拆分单元 → **offline canonical-silverc 编译实字节 × 7.4 率 → 算 (source+template)×7.4 < 9999 by construction → NWT 核【预算自洽 + 组合安全(拆出 commit/seal 不破完整性)+ 跨节点 determinism(同 silverc sha)】→ 验通才建**。synthetic probe(J2 在跑)给 fold-步 intrinsic script-units + k-斜率, 辅助 (a)/(A) sizing。

## 6. 下一步

1. J1: 细化 B(a) committee-attested settle 单元 SS 草案 + B1/B2/B3 资金归集逐个字节预算粗估 → 出可 NWT 核的预算表。
2. J2: synthetic fold-only probe 出 fold-步真 script-units + k-斜率(喂 A 的 streaming-fold 可行性)。
3. NWT: 核 B(a) 信任模型(委员背书总量 == verdict 信任, 无新弱点?)+ 各候选预算自洽。
4. Owner: B vs A 方向(B = 换委员信任总量换掉 SIZE 墙, 结构稳 / A = 保链上数学证但 knife-edge)。

---

## §6.1 — (b) 跨片资金流设计 (DESIGN-FIRST, 待 NWT 对抗核 + J2 双领 teeth)

> Owner GO【按原设计落码】后真工作面。SIZE 墙已 moot(无 fold node), 但 **(b) 跨片资金流 = 真安全面**(NWT 自纠: (a) 总量 provable-slash 是容易部分; (b) 资金流才是实风险)。每机制【先安全验 + 字节预算自洽, 后码】。

### 共同锚: committee-attested commit_v2
`commit_v2 = blake2b(globalYes ‖ globalNo ‖ winningRoot ‖ market_id ‖ shard_count)`, 委员 4-of-5 sighash 背书。
- `winningRoot` = merkle root of 赢家集 `{leaf=blake2b(bettorPk ‖ ser(stake,8))}`(绑【谁赢+各自 stake】, 防委员漏报/虚报单个赢家)。
- provable-fraud-slashable: 每片 local 值链上公开 → 任何人 sum 核 globalYes/No; winningRoot 漏赢家 → 该赢家自证 ∈ 应得集 → slash。

### B2 consolidate-then-prorata (推荐, 防 insolvency 根治)
1. **归集**(关池后, 各输家片独立并行): 每片 spend 全额进【单一 payout-pool P2SH】(market_id 派生, 确定性 + commit 锚)。
   - 资金流 enforce(introspection, 小): `require(out[k].value == shard.pool_value)`(全额, 防截留)+ `require(out[k].scriptPubKey == payout_pool_spk)`(防重定向)。每片归集 = ShardLeaf 量级单元【无 fold node = 无墙】。
2. **pro-rata claim**(winner 从已归集全局池领):
   - `payout = winner_stake × consolidated_pool / globalWinningTotal`(分母 = 委员背书的赢方总 stake)。
   - 🔴 **insolvency guard(NWT 残留的根治, 核心)**: 分子分母都【绑链上实量】防 mis-ratio:
     - winner merkle-prove `leaf ∈ winningRoot`(stake 焊进 leaf, 同 RefundClaim_merkle amount-weld)→ winner_stake 不可虚高。
     - `globalWinningTotal` 必 == winningRoot 所有叶 stake 之和(委员背书, 且 provable: 任何人重建 winningRoot 核和)→ 委员【报低 winningTotal 抬赔率】= winningRoot 和 ≠ 背书值 = provable slash。
     - `consolidated_pool` = payout-pool 链上 state 实值(非 witness)→ 不可虚报。
     - ∴ Σ payout = consolidated_pool × (Σ winning_stakes / globalWinningTotal); 若 globalWinningTotal == Σ winning_stakes(provable)→ Σ payout == pool 【精确守恒, 无 insolvency】。output-bind weld 每 claim draw-down 兜底。
   - **double-claim**: payout-pool state 带 `claimed_bitmap`, winner merkle_index slot 领一次(同 RootClaim R7 nullifier + aliasing-fix)。跨片已归集成单池 → 【单池 nullifier 即够, 无需跨片 nullifier】(B2 比 B3 简单处)。
3. **预算**: 归集单元(输家片 spend + introspection)~ShardLeaf 量级 / payout-pool claim(merkle climb + bitmap + prorata mulDiv)~RootClaim 量级(874B canonical < 9999 已 landed)。**每单元 canonical-silverc × 实率 < 9999, J2 probe LAND 裁。⚠ mulDiv: SS 无原生, runtime int=i64 → consolidated_pool × winning_stake 可能溢出 i64(记忆 silverscript-kaspa-ss-gotchas), 须 mulDiv 防溢出顺序或定点。**

### B1 settler-orchestrated (备选): settler 发归集 TX, 链上验路由守恒。比 B2 多链下编排, 安全面类似。
### B3 claim-pull 跨片 (备选): winner claim 直接凑多片 input。风险 = 【跨片 double-claim(同片 UTXO 被多 winner 凑)】须【跨片 nullifier】(比 B2 单池 nullifier 复杂, 配记忆 recreatable-utxo-nullifier)。B2 归集成单池避掉这个 → 推 B2。

### design-first 验证序 (NWT core)
1. NWT 核 B2 insolvency-guard 自洽: globalWinningTotal == Σ winningRoot 叶 stake 的 provable 绑定是否真挡委员 mis-ratio + i64 溢出处理。
2. J2 双领 teeth: payout-pool claimed_bitmap 防 double-claim(修前 LAND 修后 BUST, 同 R7)。
3. 各单元 canonical-silverc 编译实字节 × 实率 → J2 probe LAND < 9999 → 才落码 PoolSpine_v07。
