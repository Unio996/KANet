> **Status**: CURRENT

# 🔴 重大发现: `ShardLeaf_direct` genesis 的 net_loss 理论最小值 ≈ 0.4 KAS，是现有 `ABS_FEE_CAP`(0.05 KAS) 的 8 倍

出处：Bettor 1383 裁定③"落码前用 `calculateTransactionMass` 对真实 tx 形状（genesis 1 输出 + 找零）离线算一遍 `required_fee`，记进 provenance；若 mass 费 + dust ≥ 0.05 KAS，按设计变更上调 `ABS_FEE_CAP` 并入账，不许静默改常量"。

## 结论先行

**`ShardLeaf_direct` genesis 这笔交易，无论把 `genesisOutputValue`（给新建 covenant 输出多少 KAS）定成多少，`net_loss = genesisOutputValue + required_fee` 都不可能落进现有 `ABS_FEE_CAP = 5,000,000 sompi (0.05 KAS)` 范围内**——实测（+理论验证，见下）net_loss 有一个全局最小值，在 `genesisOutputValue ≈ 20,000,000 sompi (0.2 KAS)` 附近，最小值约 **`40,000,000 sompi = 0.4 KAS`**，是硬顶的 **8 倍**。这不是"选错了 genesisOutputValue 数值"的问题，是 `ShardLeaf_direct` 这个 **15687 字节** 的巨型 covenant 脚本，在 mainnet 真实 KIP-9 storage mass 规则下的物理约束——本文档按 Bettor 1383③"按设计变更上调、不许静默改常量"的要求，**只报告数据，不擅自改 `covenant-broadcast.mjs` 里的 `ABS_FEE_CAP_SOMPI` 常量**，等 Bettor/NWT 裁决新值。

## 方法

完全离线：`randomBytes(32)` 生成一次性 throwaway 私钥（同 `u1-registration.test.mjs:43` 既有手法），不碰任何 relay/生产私钥，不连链，不广播。`ShardLeaf_direct.sil` 用真实 `compileSilV100` 编译产物（占位 ctor 值——只关心脚本字节长度，不关心 ctor 语义正确性）拿到真实 redeem 脚本大小。

脚本：[`estimate-genesis-mass-fee.mjs`](./estimate-genesis-mass-fee.mjs)，原始输出见 [`run.log`](./run.log)。

### 第一版实验的教训（脚本文件头注已记录，这里复述一遍避免只有代码注释才能看到）

第一版用 `version:0` + 裸 `payToScriptHashScript`（不调 `populateGenesisCovenants`）构造"看起来像"genesis 输出，产出荒谬的 `required_fee`（~100 KAS 量级）。核对 `kasia-relay/src/lib/p2sh.mjs:1856-1895`（`unlockBshardGenesisMintPayout`，生产真实 genesis 交易构造代码）后发现：真正的 covenant genesis 输出必须 ① `version:1`（`TX_VERSION_TOCCATA`，"covenant output 必需"）② 构造好 `Transaction` 后调用 `t.populateGenesisCovenants([new GenesisCovenantGroup(authInputIdx, [outputIdx,...])])` 显式标记这些输出属于 genesis 组——没有这两步，`calculateTransactionMass` 会把这个输出当成"未声明用途的巨型脚本 P2SH"套用更严厉的公式。改用生产代码模式重做后，数字量级正常了（但仍然远超硬顶，见下）。

## 实测数据（12 个候选 `genesisOutputValue`）

| genesisOutputValue (sompi) | mass | required_fee (sompi) | net_loss = value+fee (sompi) | net_loss (KAS) |
|---|---|---|---|---|
| 1,000 | 4,000,000,000 | 400,000,000,000 | 400,000,001,000 | ~4000 |
| 10,000 | 400,000,000 | 40,000,000,000 | 40,000,010,000 | ~400 |
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

**`required_fee` 与 `genesisOutputValue` 精确成反比**（KIP-9 storage mass 的 `p²/v` 惩罚公式——脚本大小 `p` 固定，`v` 越大 storage mass 越小），而 `net_loss = v + required_fee(v) ≈ v + K/v` 是一个 U 形函数，在 `v = √K` 处取最小值——`K ≈ required_fee × v` 在各数据点上高度一致（比如 `10M × 40M = 4×10^14`，`20M × 20M = 4×10^14`，`50M × 8M = 4×10^14`——同一个 `K`），代数验证了这条 `1/v` 关系不是巧合，是真实的、可预测的 mass 公式行为。`√(4×10^14) = 20,000,000`，与实测最小值点的位置完全吻合。

## 交叉验证：生产代码早就知道这个问题

`kasia-console/src/lib/pool-shard-register.mjs:85`：

```js
const SHARD_GENESIS_SEED = 20_000_000;  // A(b): 空 ShardLeaf genesis seed (0.2 KAS, KIP-9 safe). 首注 register_append
```

生产代码选的 `20,000,000 sompi (0.2 KAS)`，与本次实测/理论算出的最小值点 `genesisOutputValue ≈ 20,000,000` **完全一致**——这不是巧合，是生产代码的作者早就（大概率是真实撞过、或者也做过类似的 mass 估算）找到了这个"KIP-9 safe"的最优点。**但生产代码的 `_bshardFeeV1(1) = 1,000,000n sompi (0.01 KAS)` 这个静态手续费值，本次实测证明远远不够**（在最优点 `required_fee` 实际是 `20,000,000 sompi`，是 `_bshardFeeV1` 静态值的 20 倍）——**这暗示生产 bshard 这条 genesis 路径可能从未真正被 `calculateTransactionMass` 验证过手续费是否够用，只是凭一个静态 floor 常量"应该够用"**（这是一个越出本次 proto v0 任务范围的、值得另外报告的生产代码隐患，本文档如实记录发现但不在这里展开修——不是本次任务的范围）。

## 结论对 proto v0 的影响

1. **`genesisOutputValue` 应该定为 `20,000,000 sompi (0.2 KAS)`**——这是全局最优点，不是"越省越好"也不是"越大方越好"，偏离这个点（无论更大还是更小）`net_loss` 都会变大。
2. **`ABS_FEE_CAP_SOMPI`（`kasia-relay/src/lib/covenant-broadcast.mjs`）目前是 `5,000,000n`（0.05 KAS），必须上调才能让 `ShardLeaf_direct` genesis 通过 `validateNetLoss`**——本文档只报数据，建议值待 Bettor/NWT 裁决，供参考的候选：
   - **`40,000,000n`（0.4 KAS）**：恰好等于理论最小值，零安全余量（`net_loss` 精确等于 `fee_ceiling` 时，`validateNetLoss` 的判定是 `<=`，闭区间放行，但没有任何浮动空间——mass 计算如果因为 witness 长度等细节有几个 sompi 的浮动就会被拒）。
   - **`50,000,000n`（0.5 KAS）**：留一点余量，约 1.25× 理论最小值。
   - **`80,000,000n`（0.8 KAS）**：2× 理论最小值，与 `covenant-broadcast.mjs` 现有 `fee_ceiling = min(required_fee×2, ABS_FEE_CAP)` 的"×2 留余量"精神一致（如果把 `ABS_FEE_CAP` 定得比 `required_fee×2` 更宽松，`fee_ceiling` 实际上会取 `required_fee×2` 而不是 `ABS_FEE_CAP`，`ABS_FEE_CAP` 这时候更像是一个"防止 required_fee 算出离谱大值"的兜底上限，不是"日常生效"的那个数）。
3. **`bet_mint` 步骤 A（`KanetTestToken` genesis）的脚本大小需要另算**——`KanetTestToken.sil` 的编译产物大小与 `ShardLeaf_direct`（15687B）不同，理论最优 `genesisOutputValue` 和对应 `required_fee` 需要单独跑一遍同款实验（本文档不代算，是下一笔的任务，因为 §9.2 的净损耗公式对每个 kind 都要单独核，不能假设"一个 kind 算过了其余都一样"）。
4. **本文档不改动 `ABS_FEE_CAP_SOMPI` 常量本身**——按 Bettor 1383③"按设计变更上调、不许静默改常量"的要求，这个决策需要 Bettor/NWT 走一遍设计变更流程再落码，不是本 provenance 记录能单方面拍板的。
