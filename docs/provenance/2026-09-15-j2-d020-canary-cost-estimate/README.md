> **Status**: CURRENT

# 金丝雀执行页 §5 成本数字真实核算(账本1454)

出处：金丝雀执行页 §5 要给 Owner 准确的成本数字；NWT 判断 D-020 取消 stake 输入后 register_append
的真实 mass 应明显低于旧 stepB 估计(0.45–0.6 KAS)，而页面现在写的是 0.6–0.8 KAS。本笔用主线
`c019a933` 的真实 builder(`buildMarketGenesisTxJson`/`buildRegisterAppendTxJson`)+ 真实
`kaspa.calculateTransactionMass`，按生产形状离线构造(不签名、不广播、不碰 DB/网络)三种场景，取
真实数字回答。

D-021 合规：以下全部是协议常量与本次核算假设的测试面值(0.5/0.95/1.05/1.95 KAS)，不是任何真实账户
持仓；不涉及未修复漏洞。

## 🔴 关键发现：被要求核算的 0.5 KAS / 0.95 KAS 两个 fee 输入面值，对 register_append 都真实构造失败

`buildRegisterAppendTxJson` 的输出布局固定 3 个协议常量 dust 输出(leaf 续约 0.2 KAS + PoolSideTicket
genesis 0.2 KAS + 合并 KanetTestToken genesis 0.2 KAS = 0.6 KAS)，且当前构造逻辑要求**单个 fee 输入
一次性垫付全部 0.6 KAS**(不区分 leaf/held 自身携带的续约价值——`leftover = feeUtxo.value −
CONTINUATION_OUTPUT_SOMPI − GENESIS_OUTPUT_SOMPI − GENESIS_OUTPUT_SOMPI`，与 heldInput 是否存在无关，
见 `kasia-console/src/lib/proto-tx-assembly.mjs` `buildRegisterAppendTxJson` 内 `leftover` 那一行)：

- **0.5 KAS**：`leftover = 0.5 − 0.6 = −0.1 KAS < 0`，结构性不足，连 mass 都算不到就直接拒绝构造。
- **0.95 KAS**：`leftover = 0.35 KAS`，够垫 dust 但不够垫真实 mass 费(真实 `requiredFee` ≈
  0.38–0.42 KAS，取决于是否有 held)，`selectChangeShape` 两种找零形状都不可行，同样构造失败。

两者都不是脚本 bug——是这笔交易本身对单个 fee 输入面值的真实门槛。额外探测（见 `run.log` 末尾附带的
探测记录）确认：**真实可行的最小量级约 1.05 KAS**，本报告的预算核算改用这个值给出"多少才够"的答案。

## 三种场景的真实数字(D-019/主线 c019a933 真实 builder + 真实 mass)

| 场景 | fee 输入 | required_fee | 锁进合约输出合计 | net_loss | 找零形状 |
|---|---|---|---|---|---|
| ①market_genesis | 0.5 KAS | **0.21333300 KAS** | 0.2 KAS(genesis 输出) | 0.21333300 KAS | 带找零(0.08666700 KAS) |
| ②a首笔下注(无held) | 0.5 KAS | — | — | — | **构造失败**(结构性不足, leftover<0) |
| ②b首笔下注(无held) | 0.95 KAS | — | — | — | **构造失败**(mass费超过可用余量, 两种找零形状均不可行) |
| ②c首笔下注(无held, 补充探测) | 1.05 KAS | **0.44022200 KAS** | 0.6 KAS(leaf续约+ticket+合并KTT) | 0.44022200 KAS | 带找零(0.00977800 KAS) |
| ③a第二笔下注(有held) | 0.95 KAS | — | — | — | **构造失败**(同②b, 有无held不影响fee输入门槛——见下方"为什么有held也不能降低门槛") |
| ③b第二笔下注(有held, 补充探测) | 1.05 KAS | **0.41015500 KAS** | 0.6 KAS | 0.41015500 KAS | 带找零(0.03984500 KAS) |

**方向性结论(呼应 NWT 的判断)**：D-020 之后 register_append 的**真实 required_fee**(0.410–0.440
KAS)确实明显低于旧两步设计 step B 单独的估计值(`bet_mint_step_b.requiredFeeEstimate` =
59,900,000 sompi = 0.599 KAS，见 `kasia-console/scripts/proto-v0-template-anchors.json`)——NWT 的
方向判断是对的。但**页面"0.6–0.8 KAS"这个数字如果指的是"单笔 fee 输入需要准备多少"，真实门槛不是降低
了而是提高了**（旧两步设计把 0.6 KAS 的 dust 分摊在两笔各自独立出资的交易里，D-020 合并成一笔后，
单个 fee UTXO 必须一次性覆盖全部 0.6 KAS + mass 费，实测最低约 1.05 KAS）。这两个说法都成立，取决于
"0.6–0.8 KAS"原本指的是哪个量——**建议 Owner/Bettor 明确页面这个数字的原始定义**(required_fee 本身，
还是单笔需要准备的 fee UTXO 面值)，再决定往哪个方向改。

## 金丝雀预算核算(种子面值 1.95 KAS，建 1 个市场 + 下 1 笔)

用真实可行值(genesis 0.5 KAS + 首笔下注 1.05 KAS，合计消耗两笔 fee UTXO 面值 1.55 KAS)：

- 两笔 net_loss 合计(真正付给网络、一去不复返) = **0.65355500 KAS**
- 找零合计(genesis 0.08666700 + 下注 0.00977800) = 0.09644500 KAS
- 种子 1.95 KAS 里，1.55 KAS 投进这两笔 fee UTXO 后，剩余未动用种子 = **0.40000000 KAS**
- relay 侧最终可支配余额(剩余未动用种子 + 两笔找零) = **0.49644500 KAS**

## 结算入口落地前取不回的金额

以"建 1 个市场 + 下 1 笔"后的最终态计(不重复计入被续约取代的旧 genesis 输出——leaf 续约是 genesis
输出的延续，同一份 KAS 滚动前进，不是额外新增锁定)：

| 项目 | 金额 | 说明 |
|---|---|---|
| leaf 续约 | 0.2 KAS | 继承自 genesis，非新增锁定 |
| PoolSideTicket dust 票据 | 0.2 KAS | 首笔下注新增 |
| 合并后的 KanetTestToken genesis | 0.2 KAS | 首笔下注新增 |
| **合计** | **0.6 KAS** | market_resolve/claim_draw/refund_payout 落地前无法取出 |

若再下第二笔(有 held)：结构不变仍是 0.6 KAS——held 被完全消费(`next_states=[]`)，它原本锁着的
0.2 KAS 转移进新的合并 KTT 输出里，不是额外叠加锁定。也就是说**这 0.6 KAS 是"稳态锁定额"，不会随
下注笔数线性增长**(每次 register_append 都是消费上一次的 held、产出新的 merged KTT，同一份 0.2 KAS
在滚动，只有 leaf 续约 + 当次新增的 ticket 才是持续存在的锁定项)。

## 文件清单

- `compute-canary-cost.mjs` — 核算脚本，可重跑复现(`DB_PATH=<临时db路径> node compute-canary-cost.mjs`，
  在 `kasia-console` 目录下执行以满足相对路径解析；DB_PATH 只是满足 `db/client.js` 的入口守卫，本脚本
  不做任何数据库读写)。
- `run.log` — 完整真实运行输出(含 JSON 格式的结构化结果)。
- `README.md` — 本文件。
