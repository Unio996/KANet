> **Status**: CURRENT

# bet_mint 步骤 A（KanetTestToken genesis）mass/fee 实测 — 与 market_genesis 同一最优点，且有明确原因

出处：Bettor 1386③"不假设一样，每 kind 单独跑一遍 mass 实验"。方法论同 `docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/`（ShardLeaf_direct 的 market_genesis 实验）。

## 结论先行

**bet_mint 步骤 A（KTT genesis）的 required_fee/net_loss 曲线与 market_genesis（ShardLeaf_direct genesis）逐 sompi 完全相同**——全局最优点同样在 `genesisOutputValue = 20,000,000 sompi（0.2 KAS）`，`net_loss ≈ 40,000,000 sompi（0.4 KAS）`。

**这不是因为"两个 kind 恰好一样大"就直接照搬结论——是因为跑了才发现的一个更基础的原因**：ShardLeaf_direct 编译产物 15687 字节，KanetTestToken 编译产物只有 3867 字节（用于本实验的 132 字节 `market_tmpl_suffix` 占位，该机制本身已被 NWT 红队推翻重新设计，见 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.1.md`，但这不影响本实验的 mass 结论——见下），体积相差超过 4 倍，但两者的 mass/required_fee/net_loss 数字逐行相同。**原因**：genesis 交易的 KIP-9 storage mass（`p²/v` 那条公式）只看**输出的 scriptPubKey 长度**，而 genesis 输出用的是 P2SH 包装（`payToScriptHashScript`），P2SH 输出的 scriptPubKey 长度是**固定的**（`OP_BLAKE.../<32字节hash>/OP_EQUAL` 形状，恒定字节数），完全不依赖被包装的 redeem 脚本本身有多大——redeem 脚本的字节数只在**花费**这个 UTXO 时才会体现在 sigScript 里，走的是另一条"线性 mass"公式（NWT 已核实："输入侧大 sigScript 是线性 mass，输出侧才有 p²/v"）。这就是为什么两个体积悬殊的合约的 genesis mass 曲线完全一致——不是巧合，是 KIP-9 公式本身的结构性质。

**对 anchors.json 的影响**：`feeProfile.bet_mint_step_a` 可以直接复用 `feeProfile.market_genesis` 的数值（`genesisOutputValue=20,000,000`/`requiredFeeAtOptimum=20,000,000`/`minNetLoss=40,000,000`/`cap=80,000,000`），但**理由是"genesis mass 与 redeem 脚本大小无关"这个结构性事实，不是"两个 kind 碰巧一样"**——如果未来某个 kind 的 genesis 输出走了非 P2SH 的包装方式，或者输出数量/形状不同，这个复用就不成立，需要重新实验，不能默认"以后新 kind 也一样"。

## 方法

完全离线，throwaway 私钥，同 `market_genesis` 实验手法。`KanetTestToken.sil` 用真实 `compileSilV100` 编译（`market_tmpl_suffix` 占位 132 字节——该字段本身在设计修法后会被删除，见上方链接的设计稿，但删除后 genesis 输出仍然是 P2SH 包装，本实验的"genesis mass 与 redeem 脚本大小无关"结论对修法后的版本同样成立，无需重跑）。

脚本：[`estimate-ktt-genesis-mass-fee.mjs`](./estimate-ktt-genesis-mass-fee.mjs)，原始输出见 [`run.log`](./run.log)。

## 实测数据（11 个候选 `genesisOutputValue`，与 ShardLeaf_direct 实验逐行相同）

| genesisOutputValue (sompi) | mass | required_fee (sompi) | net_loss (sompi) | net_loss (KAS) |
|---|---|---|---|---|
| 1,000 | 4,000,000,000 | 400,000,000,000 | 400,000,001,000 | ~4000 |
| 100,000 | 40,000,000 | 4,000,000,000 | 4,000,100,000 | ~40 |
| 1,000,000 | 4,000,000 | 400,000,000 | 401,000,000 | ~4.01 |
| 5,000,000 | 800,000 | 80,000,000 | 85,000,000 | 0.85 |
| 10,000,000 | 400,000 | 40,000,000 | 50,000,000 | 0.5 |
| 15,000,000 | 266,666 | 26,666,600 | 41,666,600 | 0.417 |
| **20,000,000** | **200,000** | **20,000,000** | **40,000,000** | **0.4 ← 全局最小** |
| 25,000,000 | 160,000 | 16,000,000 | 41,000,000 | 0.41 |
| 30,000,000 | 133,333 | 13,333,300 | 43,333,300 | 0.433 |
| 50,000,000 | 80,000 | 8,000,000 | 58,000,000 | 0.58 |
| 100,000,000 | 40,001 | 4,000,100 | 104,000,100 | 1.04 |

## 未完成项

- bet_mint 步骤 B（`register_append`，ShardLeaf_direct 的花费+续约交易）**不是 genesis**，这条"P2SH 输出 mass 与 redeem 大小无关"的结论**不适用**——步骤 B 会真正把大合约的 redeem 脚本暴露在 sigScript 里（线性 mass），且涉及多个输入输出（续约 ShardLeaf_direct + 新铸 PoolSideTicket + 续约 KTT + relay fee input），需要独立、更复杂的 mass 实验，是下一步任务，不能用本文档的结论替代。
