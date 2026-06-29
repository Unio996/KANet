# Phase B — 经济层 spec（bonded settler + fraud-proof + slashing）

**作者**: Bettor (架构) · **日期**: 2026-06-23 · **状态**: 草案 v1, 待全 vantage 对抗硬化（像 6-21 那场）
**Owner 钦定**: A→B 串行, B 是主线优先级 > ZK。把 Track B 的【Layer 2 payout】从 trust-minimized 升级成 optimistic-trustless。
**配**: KB `architecture/zk-track-c-verified-trustless-settle.md` · memory `project-two-layer-trust-model-prediction-market` · Track B enforce 系列

---

## 0. 定位铁律（Owner 钦定产品语言, 不可违反）
- 本 spec **只升级 Layer 2 payout**（资金怎么分）到 optimistic-trustless。
- **Layer 1 outcome（谁赢）不在范围内**——永远 trust-minimized（oracle/UMA dispute, Phase D）。
- 永不说 "Track B becomes trustless / production-trustless"。本 spec 交付后表述 = **"trust-minimized outcome + optimistic-trustless payout"**。

## 1. 核心洞察：为什么是 fraud-proof 不是链上重验
完整 pari-mutuel 结算（N 个 bettor 求和+分配）撞 500k SIZE 墙——这正是 Track B 用委员的原因。**optimistic 模型不在链上验"对", 而让"错"被便宜地证明**:
- settler 乐观提交 payoutRoot（无需链上验全部 N）。
- 任何人可在挑战窗内提交一个**局部化的 fraud-proof**, covenant **只验那一个局部**（cheap, fit SIZE）。
- 无挑战 → finalize; 有效挑战 → slash settler bond + 冻结坏 root + 奖 challenger。
**把"信 4/5 不作恶"降级成"4/5 作恶=可验证损失"= 博弈论安全**（Arbitrum/Optimism 模型）。

## 2. 机制流（Owner 钦定链, 细化）
```
settler post { payoutRoot, winningSide, total_winning_stake(TWS), distributable_pool } + BOND
   ↓
challenge window 开 (Δ 区块/DAA)
   ↓ 任何人可提交 fraud-proof(见 §3 类型)
covenant 验 fraud-proof:
   有效 → slash settler BOND (部分奖 challenger + 部分烧/归池) + 坏 root 冻结/revert → 重新 settle
   无效 → 挑战者保证金没收(防垃圾挑战)
   ↓ 窗内无有效挑战
payoutRoot finalize → 进入 claim/redeem(现有路)
```
**关键新增**: settler 不只提交 payoutRoot, 还必须提交可被独立挑战的**聚合承诺** {TWS, distributable_pool}（+ §3.2 的 sum-tree）。

## 3. fraud-proof 类型（核心设计 = 把任何欺诈局部化到一个便宜的链上检查）
pari-mutuel: `payout_X = stake_X × distributable_pool / TWS`。欺诈面 + 各自的局部化证明:

### 3.1 单叶错（given 正确聚合）— 最便宜
challenger 声称: bettor X 的 leaf 在 payoutRoot 是 P, 但正确 P' = stake_X × distributable / TWS ≠ P。
- covenant 验: ① merkle proof X→P ∈ payoutRoot（D2 已绑）② X 的 ticket 链上存在（C1: pk/side=winning/stake_X）③ 用已提交的 distributable/TWS 算 P' ④ P≠P' → 欺诈。
- **成本**: 一次 merkle 验 + 一个 bettor 的算术 = 便宜。

### 3.2 聚合错（TWS / distributable 本身错）— 需 sum-tree 局部化
难点: 证明一个【和】错, 朴素要重新求和 = SIZE 墙。**解 = settler 提交 TWS 的 sum-tree**（partial-sum merkle, 同 binary-decomposition）:
- **内部节点错**: challenger 指一个内部节点声称 sum=S 但其两子=a,b 且 a+b≠S → covenant 验那一个加法。便宜。
- **叶错(成员资格)**: sum-tree 叶必须 == C1 complete-set 的 ticket（winning-side stake）。challenger 证: (a) 一个 winning ticket 链上存在但不在 sum-tree 叶（漏计赢家, 压低 TWS 抬高他人 payout）→ 需 C1 complete-set 锚定"全集"（这是 C1 已做的: 全 ticket 链上枚举）; (b) 一个 sum-tree 叶不对应任何 winning ticket / 对应 losing ticket（虚增/掺假）→ 验该叶 vs 链上 ticket side。
- distributable_pool = total_pool − fees: total_pool = 链上 ShardLeaf 聚合值（PS-pool 锚, 已有）; fees = 命门④ feeLeaves（链锚 fee_recipients_commit, 已有）→ distributable 可被独立 re-derive 挑战。

### 3.3 守恒错（Σpayout + Σfee ≠ pool）
challenger 证 payoutRoot 所有 leaf 之和 ≠ 链上 pool。**也需 sum-tree**（payout 侧 sum-tree）, 否则求和撞墙。同 3.2 局部化到一个节点。

### 3.4 fee 欺诈（命门④ 的 optimistic 版）
fee leaf 收款地址/bps ≠ genesis 烤的 fee_recipients_commit → challenger 出示 commit + 错 leaf。covenant 比对。便宜（已是现有命门④ 的链锚, 这里变可挑战）。

## 4. 经济参数（Owner 决策数值, 机制保证任意合法配置成立）
- **BOND**: settler 锁定 ≥ 单笔市场最大可能欺诈收益（否则作恶 EV>0）。建议 = f(pool_size)。
- **challenge window Δ**: 够长让诚实 challenger 发现+提交（liveness 取舍: 太短=漏挑战, 太长=结算慢）。
- **challenger reward**: slash 的一部分给 challenger（激励监督）, 一部分烧/归池（防 settler-challenger 自演合谋退 bond）。
- **challenger 保证金**: 防垃圾挑战（无效挑战没收）。
- **liveness 假设**: optimistic 模型依赖"至少一个诚实 challenger 在线"（与 Layer 1 的"oracle 在线"是不同假设, 要分清诚实标）。

## 5. covenant 侧需强制什么（fit SIZE 的部分）
covenant **不重算结算**, 只验单个 fraud-proof:
- merkle inclusion（payoutRoot/sum-tree, 已有 blake2b 原语）
- 一个加法 / 一个 pari-mutuel 除法（i64 算术, SIZE 内）
- 一个 ticket 的链锚校验（C1, OpInputCovenantId/readInputState 已有）
- bond UTXO 的 slash/release（covenant 控 bond output）
**全部是现有原语的组合, 无新合约能力依赖**（对比 Track C 需 OpZkPrecompile + silverc 加 builtin）。∴ Phase B 工程上比 Phase C 近。

## 6. 与现有 C1/C2/D2 + Track C 的关系
- **复用**: C1 complete-set（成员资格/全集锚）+ C2 poolMerkleRoot（聚合结构）+ D2 payoutRoot 绑定 + 命门④ fee 链锚 + PS-pool 锚（total_pool）。fraud-proof 站在这些链锚上, **不重造**。
- **新增**: settler 的 BOND + sum-tree 承诺 + challenge-window 状态机 + fraud-proof 验证 entry。
- **Track C(ZK)关系**: Phase B(optimistic/交互式 fraud-proof)与 Phase C(ZK/validity proof)是**同一个 Layer-2 保证的两种实现**——optimistic=便宜+挑战窗+liveness 假设; ZK=即时+无 liveness 假设+proving 成本。**Phase B 先落（现有原语可建）, Phase C 6.30 后作升级**（去掉挑战窗+liveness 假设）。同一 sum-tree/局部化逻辑, ZK 版把"挑战一个节点"变"证明所有节点"。

## 7. 对抗硬化点（我先抛, 等 J1 determinism / J2 storage / NWT 验证 / KANetUI 经济+UI 全 vantage 挑）
1. **sum-tree 局部化完备性**: 是否每种聚合欺诈都能局部化到一个节点/叶? 有没有"全局一致但整体错"的构造逃过所有局部检查?（NWT 红队重点, 类比 verify-value-source）
2. **C1 complete-set 是 fraud-proof 的根**: "漏计赢家"型欺诈依赖能证明"全集"——C1 必须真锚全 ticket（genesis-ticket 洞 Phase A 修的正是这个！Phase A 是 Phase B 的前提）。
3. **liveness/挑战窗**: 诚实 challenger 缺位→坏 root finalize。Δ 怎么定? 谁兜底跑 challenger watchdog?（KANetUI UX + 我们自己的 watchdog）
4. **bond 经济**: BOND < 欺诈收益 → 作恶 EV>0。bond 怎么 scale pool? 多市场并发 bond 锁定?（J2 资金流）
5. **settler-challenger 合谋**: 自演假挑战退 bond? reward 设计防这个（烧一部分）。
6. **determinism**: fraud-proof 的 re-derive 必跟 settler 的计算 byte-equal（同 pari-mutuel 公式/取整/canonical 序）, 否则诚实 settler 被误 slash。J1 域。
7. **争议事实必须在链上**（NWT 铁律）: Phase B 只能裁 Layer 2（链锚可重演的）。任何需要链外事实的争议 = Layer 1 = 不在 Phase B 范围, 走 Phase D。

## 8. 路径
spec(本文) → 全 vantage 对抗硬化 → 落码(BOND 机制 + sum-tree 承诺 + challenge 状态机 + fraud-proof entry, 复用 C1/C2/D2) → 链上验(诚实 settle finalize + 注入欺诈被挑战 slash, single-var A/B, gold BUST) → 回归守 byte-equal。**Phase A 收口是前提**（C1 complete-set 必须真锚全 ticket, 含 genesis）。
