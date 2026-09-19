# T-FEE-PRICING 的 NWT 输入（汇总，2026-09-19）

范围：Bettor 裁定 ③ 后，修 relay 估费器 = T-FEE-PRICING 本体，本轮不做；这份文件只把我已有的证据按"对定价设计有用"的方式汇总，供将来出设计稿时引用。**不构成降 fee 的依据，不改变任何生产 fee 规则。**

## 1. relay 本地 wasm 估费：对 storage 占优形状偏高，对 compute 占优形状偏低

`requiredFee = 100 × kaspa-wasm calculateTransactionMass(draft)`（builder 与 relay 各用一次，天花板 = 2× requiredFee）。

- **偏高（storage 占优）**：wasm 的 storage 维度 == "输入 plurality 恒为 1"的 KIP-9 公式，逐位相等（批 3–7 的 fee 曲线每个采样点都有 `equal=true`）。真实 covenant UTXO 的 plurality 是 2（`ceil((63+|spk|+32)/100)`），所以对含 covenant 输入/输出的交易，wasm 与节点的 storage 值不同，我在批 3 已用 8/8 节点值验证节点侧公式。这一偏差使 fee 高于必要值；实测 builder 实付 fee 高于节点 mempool 最低费 genesis 25.1×、bet1 11.7×（见 `../../2026-09-19-nwt-fee-ladder-experiment/README.md`），但注意那里还写明：优先级 feerate 的分母含 storage mass，所以"高"不等于"可以直接降"。
- **偏低（compute 占优）**：`wasm_budget_probe.mjs`（本目录）同一笔 v1 交易只改每输入 `computeBudget`：0 / 70 / 5000，wasm 返回值恒为 **825**，而我移植的 compute 公式（`size + 10×Σ(2+spkLen) + 100×Σbudget`，与批 3–7 的节点值逐位吻合）分别为 761 / 7,761 / 500,761。**wasm 不计入 v1 的每输入 computeBudget 项。** 当 compute 是最大维度时，wasm 估值低于节点值，见 §2 的 ticket_reclaim。（budget=0 那一行 wasm 比我的公式多 64，这是我探针里 spk/字段表示的差异，未追究，不影响"随 budget 不变"这个结论。）
- 结论：两个方向的偏差来自不同的缺项（storage：plurality；compute：budget），**不能靠单个系数（×1.5、×2）统一修**。两侧（builder 与 relay）应同步换成精确公式并对同一个函数取值，这与 Bettor 裁定一致。

## 2. 已知的失败实例（转述，我未独立验证）

Bettor 转告：批 8 v2（ticket_reclaim，`[ticket, fee] → [P2PK, 找零]`，simnet dc40f701）的 relay 估费为 141,000，2× 天花板 282,000，节点最低费 1,528,200（compute mass 15,282），fee=282,000 被节点拒。这与 §1 的机制一致（漏计 budget 项），但我没有取回该交易，也没有对它复算；**批 8 的字节层与 cap 按 Bettor 排序暂缓**。另：Bettor 更正，(1491) 里"本地 wasm mass 814"是错的，同形状应为 3,087（漏 compute 维度）；我的 provenance 没有引用过 814。

## 3. 定价设计需要的确定事实（均有源码坐标或实测）

1. 节点 mempool 最低费 = `100 sompi/gram × max(compute, normalized_transient)`（`check_transaction_standard.rs:140-176`；simnet 实验中节点回复的最低费与公式逐位一致）。
2. mempool/区块模板的**优先级 feerate = fee / max(compute, transient, storage)**（`consensus/core/src/tx.rs:662`，`calculated_feerate`）。storage 计入分母，所以仅"过最低线"的 storage 占优交易优先级低。
3. RBF：`submitTransaction` 禁止替换；`submitTransactionReplacement` 要求严格更高 feerate；P2P 中继允许替换（fee-ladder README 增补节）。
4. 现行估费在 draft（找零 = leftover）上算，而不是最终 tx；两者差别只在找零值，对 mass 的影响见各批 fee 曲线（找零值本身也影响 storage 的调和项）。
5. 主网打包时延证据**尚不存在**：simnet 只有我一个矿工，不测排序。T-FEE-PRICING 设计稿必须先取这份证据，再谈系数。

## 4. 给设计稿的建议输入（供 Bettor 取舍）

- 用精确的三维 mass（storage 用真实 plurality、compute 含 budget、transient 用 size×4×0.5）算 `max(...)`，builder 与 relay 共用同一个实现，避免"两套代码同量级"的假一致（批 3 已发现 wasm 与节点 storage 值的分歧）。
- fee = 市场 feerate（`getFeeEstimate`）× 上述 contextual mass × 安全系数，并设**下限 = 节点最低费**（这条能挡住 §2 的类型：估费低于最低费必被拒）、**上限 = 各 builder 的专属 cap**（批 6/7 已按 F3' 推出：claim_draw 50M、withdraw 55M；market_seal/convert_to_claim/close_commit 见前批）。cap 的推导前提是 wasm 口径；换精确公式后 cap 必须按新口径重推。
- 任何一个 builder 的 fee 规则改动都要重跑该批的三源相等（断言信号 == 节点 mempool == 区块记录）。

## 复现
`wasm_budget_probe.mjs`：本地算，不碰节点。
