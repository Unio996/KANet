# fee 阶梯实验（simnet，节点 mempool 最低费）— NWT 2026-09-19

Bettor 批准并设条件：J2 全链跑完后再上、用我自己的独立 UTXO、记录节点 sha256/--version、每档 fee 与节点回的 mass 与是否接受；结论必须写明——**它只回答"节点 mempool 最低费是否接受"，不回答主网矿工按什么排序打包，所以实验结果本身不构成降 fee 的依据**；任何生产 fee 规则的改动另需主网打包行为的证据、出设计、Bettor 审，涉及真实 KAS 还要报 Owner，本轮不做。D-021：不含真实主网余额；simnet 地址已在日志里脱敏。

## 环境（提交前现核）

- 节点：PID 15972，`D:\rusty-kaspa-v201\kaspad.exe --simnet …`（只绑 127.0.0.1）；二进制 sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`（脚本内硬比对，输出 `== 官方 2.0.1 pinned`），`getServerInfo.serverVersion = 2.0.1`，`hasUtxoIndex=true`。
- 身份与资金：我自己新生成的 simnet 测试身份（私钥只在 gitignored 的 state 文件，simnet 无价值）；补挖 1,100 块（1,085 ms，每块约 1 ms）成熟 coinbase，拆出 8 枚 0.95 KAS fee UTXO。提交前已通知 J2（其 simnet 身份与 chain2 记录未触碰）。
- builder：J2 合入候选 `f71e8b4c` 的生产 builder（`buildMarketGenesisTxJson`、`buildRegisterAppendTxJson`），**只在 builder 产出后改最后一个（找零）输出的值以改变 fee**，重签 fee 输入；covenant 输出、见证字节、covenant id 不变。
- 每个形状只提交 2 笔：先 fee=1,000 sompi（必被拒，用来让节点在拒绝信息里报出它要求的最低费与所依据的 mass），再按该数提交（被接受后挖 1 块确认）。

## 结果

| 形状 | builder 实付 fee | 探针 fee | 节点回复（原文摘要） | 按节点所报最低费提交 | 接受后节点 mass |
|---|---|---|---|---|---|
| `market_genesis` | 20,280,700 | 1,000 | REJECTED：`transaction has 1000 fees which is under the required amount of **808300** for **compute mass 8083**` | fee=**808,300** → **ACCEPTED** 并被我的矿工挖块确认 | storage 202,952 / compute 8,083 |
| `register_append#1` | 43,339,900 | 1,000 | REJECTED：`… under the required amount of **3691400** for **normalized transient mass 36914** (proportional to transaction byte size)` | fee=**3,691,400** → **ACCEPTED** 并挖块确认 | storage **391,231** / compute 33,927 |

- **节点的最低费公式与我从源码推得的预测逐位一致**：`fee_min = 100 sompi/gram × max(compute_mass, normalized_transient_mass)`（`check_transaction_standard.rs:140-176`，`config.rs:23` 速率 100_000/kg；`normalized_transient = size×4×0.5`）。genesis：`max(8,083, 353×4×0.5=706)=8,083` → 808,300；bet1：`max(33,927, 18,457×4×0.5=36,914)=36,914` → 3,691,400。bet1 的 3,691,400 是我在批 3 provenance §2.2 里**事先写下**的估计值，节点原文命中；genesis 的 808,300 我没有事先写，是实验后按同一公式复算得到（compute 主导：100×8,083），与节点所报一致。
- **storage mass 的预测也命中**：bet1 在 fee 取最低费时 storage = **391,231**（占 500,000 的 78.2%），与我用移植公式在 `whatif_bet1_fee.mjs` 里预测的 391,231 **逐位相同**；builder 实付 43,339,900 时是 457,504（91.5%）。⇒ "mass 卡点"的根因确认为 fee 定价：现行 `requiredFee = 100 × 本地 wasm mass`（wasm 把输入 plurality 恒当 1 算，见 F3'），比节点 mempool 的最低费高 **genesis 25.1×、bet1 11.7×**，多付的 fee 缩小了找零、抬高了调和项。

## 这个实验证明了什么、没证明什么（Bettor 的条件，原样保留）

- **证明**：在官方 2.0.1 节点上，上述两个形状按 `100 × max(compute, normalized_transient)` 计的 fee 即被 **mempool 接受**并能被本地矿工打进块；节点对不足费的拒绝信息与该公式一致。
- **没证明**：主网矿工/区块模板构造器是否会按这个 fee 及时打包。simnet 只有我自己一个矿工，`submitBlock` 会打进 mempool 里的一切，**完全不测排序/优先级**。Kaspa 的区块模板选择是否把 storage mass（这里 391,231，远高于 compute）计入 fee/mass 比，我没有验证；在拥堵时一笔"刚好过 mempool 最低线"的交易可能长期不被打包。
- **所以这个实验本身不构成降 fee 的依据。** 任何对生产 fee 规则的改动（例如把 `requiredFee` 从"本地 wasm mass×100"改成"节点最低费 × 余量"）需要：(1) 主网上关于打包行为的证据（例如观察主网 mempool 里 feerate 恰在最低线附近的交易的确认延迟，或在主网做一次极小额的、可回滚的测试），(2) 单独的设计稿，(3) Bettor 审，(4) 涉及真实 KAS 的部分报 Owner。本轮不做。

## 可复现
`01_setup.mjs`（身份 + 挖块 + 拆 UTXO）、`02_ladder.mjs`（两个形状的阶梯）、`ladder_log.json`（每次提交的 fee、结果、节点回复原文、节点 mass）。脚本里的路径指向我的 review worktree（`scratch/_nwt_wt_j2_7f1e339b`，检出 `f71e8b4c`）；需要 simnet 节点在 `ws://127.0.0.1:18510`。state 文件与临时 DB 不入库。

## 增补（同日）：链式未确认交易与 RBF 的实测（回答 dotk M4-7 与 M1 的开放点）

同一节点（官方 2.0.1，我的身份，`03/04/05_*.mjs`）。**这些实验只涉及 mempool 行为，不涉及打包排序。**

| 实验 | 结果 |
|---|---|
| 链式未确认（普通 P2PK）：child 花 parent 的**未确认**找零输出 | **ACCEPTED** |
| 链式未确认（**covenant**）：`register_append#1`（bet1）花**未确认**的 `market_genesis` leaf 输出，两笔之间不挖块 | **ACCEPTED** |
| `submitTransaction`（RPC 默认）提交与 mempool 里某笔**花同一输入**的第二笔，不论 fee 更高/相同/更低 | **全部 REJECTED**：`output … already spent by transaction …`（`flow_context.rs:690` `RbfPolicy::Forbidden`） |
| `submitTransactionReplacement`（RPC，`RbfPolicy::Mandatory`，`flow_context.rs:715`）：更低 / 相同 fee | REJECTED：`fee rate per contextual mass gram is not greater than the fee rate of the replaced transaction` |
| `submitTransactionReplacement`：**更高 fee** | **ACCEPTED**，旧交易被移出 mempool（`replaced=yes`） |

- **P2P 中继路径的策略是 `RbfPolicy::Allowed`**（`protocol/flows/src/v7/txrelay/flow.rs:223`）：从对等节点收到的、花同一输入且 feerate 更高的交易**会替换**本地 mempool 里的旧交易。所以 RBF 在网络层是真实存在的，攻击者不必有我们的 RPC。
- **替换判据用的 feerate = `fee / normalized_max(compute, transient, storage 三维 mass)`**（`consensus/core/src/tx.rs:662` `calculated_feerate`，日志里的 "contextual mass gram"）。也就是说，**storage mass 计入 feerate**。

### 对结论的影响（我之前说法的订正）
1. **"fee 定价偏高"的框架要收敛**：mempool **最低费**确实比 builder 实付低 11.7×/25.1×（实验证实），但 mempool 与区块模板的**优先级 feerate 以 contextual mass 为分母**：bet1 在最低费时 feerate ≈ 3,691,400 / 391,231 ≈ **9.4 sompi/gram**，而 builder 实付时 ≈ 43,339,900 / 457,504 ≈ **94.7 sompi/gram**，后者与普通交易（compute≈contextual，≥100 sompi/gram）同一量级。拥堵时刚过最低线的 bet1 会比普通交易的优先级低约 10 倍。所以现行"100 × 本地 wasm mass"作为**优先级定价**并不离谱；真正需要修的是它**用的是偏高的 wasm mass（输入 plurality 恒 1）且基于 draft 而非最终 tx**，以及 fee 与 storage mass 的耦合。合理的后续（T-FEE-PRICING 的设计输入）：`fee = 市场 feerate（`getFeeEstimate`）× 精确 contextual mass（已合入的精确公式）× 安全系数`，且先在主网取打包时延证据。
2. **dotk M4-7（链式未确认）已有答案**：节点接受未确认父交易的子交易，包括 covenant 链 ⇒ **reveal 可以在 commit 提交后立即提交，不必等确认**（dotk 自己的 covenant 未直接测，机制是通用 mempool 行为；J1 的空跑仍应在其真实形状上复核一次）。
3. **dotk M1/M3/runbook §3.4 的"第二份更高 feerate reveal 替换"必须改**：SDK 的 `submit` 走 `submitTransaction`（Forbidden），**它无法完成替换**。替换只能经 `submitTransactionReplacement`，要求新交易 feerate（contextual mass 基）**严格高于**旧交易。所以：(a) 门面的 RPC 白名单要多一个方法 `submitTransactionReplacement`（共 5 个），且同样只放行垫片已批准并签过的 txid；(b) "第二份 reveal"必须预先算好其 feerate 严格高于第一份，并由垫片而非 SDK 提交；(c) 如果第一份 reveal 已被 mempool 接受但迟迟不被打包，才用替换；如果第一份被拒/丢弃，直接普通提交第二份即可。
4. **M1 的抢注窗口的攻击面因此是真的**：攻击者用更高 feerate 的同 gap 输入 commit，经 P2P（Allowed）或自己的 `submitTransactionReplacement` 就能替换我们尚未确认的 commit。缓解方向 = 我们的 commit 自己用**高得多的 feerate**（提高其替换门槛；SDK fee 上限 5 KAS 内可到 ~10× 常规），并且 commit 后立刻提交 reveal 让链条更早确认。残余风险仍接受。
