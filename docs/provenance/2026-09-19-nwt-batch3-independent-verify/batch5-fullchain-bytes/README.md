# 批 4/5 链上字节层独立验证（close_commit + convert_to_claim）+ 两个专属 fee cap — NWT 2026-09-19

对象：J2 simnet 全链新一轮（builder 1a6440b4，provenance `docs/provenance/2026-09-19-j2-fullchain-simnet/`）里的 close_commit（`9e3398a6…8570`）与 convert_to_claim（`1b1133eb…f983`）。
**只读**：我从节点（PID 15972，`D:\rusty-kaspa-v201\kaspad.exe`，sha256 `8afe6a68…6e38`，`--version` = `kaspad 2.0.1`）用 `getBlocks` 自己取回这两笔与其父交易（`fetch_fullchain.mjs`），没有读 J2 的落盘 json；未向节点提交任何交易。

## 结论

close_commit 与 convert_to_claim 的见证字节 **PASS**（两条独立腿 + 语义核对），批 4 B4-1 修复的效果得到**上游 VM 与节点两方**独立确认。convert_to_claim builder 没有"builder 自己签名"的路径，批 4 那类"签名对象 ≠ 最终 tx"缺陷在它身上结构上不成立（见 §3）。

## 1. close_commit（`9e3398a6…`）

| 检查 | 独立来源 | 结果 |
|---|---|---|
| 见证结构 | 自写 push 解析器（`decode_pushes.mjs`）拆 input[0] sigScript（20,423 B）：5×`c*Pk`(32B) / 5×`c*Sig`(65B) / `rootOutIdx`=OP_0 / `new_winningSide`=OP_1 / `new_payoutRoot`(32B `cd…`占位) / `tok_prefix`(1B) / `tok_suffix`(3,078B) / tag `da3507a4` / redeem(PUSHDATA2 16,802 B) | 结构与 ABI 声明序一致 |
| redeem 重编 | pinned silverc-v100（sha256 `4378ba65…8643`，脚本内硬校验）以链上 redeem 推出 ctor（committee_hash=blake2b256(5×pk)、`deadline_ms`=tx.lockTime、claim/refund/token 模板 hash 取自 redeem 常量、state 1/999/2/1000/0/0、payoutRoot 全 0）重编 RootClose | **与链上 redeem 逐字节相等（16,802 B）**；同一编译产物里 `close_commit` params 序 = `c0Pk..c4Pk, c0Sig..c4Sig, rootOutIdx, new_winningSide, new_payoutRoot, tok_prefix, tok_suffix`，tag `da3507a4`，与链上一致 |
| 上游编码器 | 把我解出的 15 个参数喂 patched cli-debugger（3ed9733 + 仅 eprintln，sha256 `c8072cfa…3a34`）的上游 `encode_contract_entry_sig_script` | 生成的 action（3,618 B）与链上 sigScript 去掉尾部 redeem push 后**逐字节相等** |
| 上游 VM 执行真实交易 | 用链上真实 tx（真实 prev outpoint/金额/lockTime/输出 spk 与 covenant，ctor 同上）+ 链上真实 5 个委员签名，让上游 VM 跑 `RootClose.close_commit` | **PASS**（CLTV `tx.time>=temporal(deadline_ms)`、committee_hash、5 次 `checkSig`、`validateOutputState` 全过） |
| 签名对链上 tx 的 sighash | 自移植 `calc_schnorr_signature_hash`（`sighash_port.mjs`，先用 wasm 签名自检）+ schnorr 验签 | 5 个委员签名对链上 tx **全部有效** `[true×5]`，hashtype 字节均为 `01` |

**这就是 B4-1 的终局证据**：批 4 我离线发现的"先签后挂 covenant"缺陷，修复后的真实交易被节点接受，并且我的独立验签与上游 VM 都认可同一批签名。
注意：5 个委员签名字节完全相同（同一把 keypair 重复 5 次，`committeeMode='single_operator_5x_same_key'`），这只证明合约逻辑可执行，**不是 4-of-5 门限安全**（J2 README 已如实写，本验证不外推）。

## 2. convert_to_claim（`1b1133eb…`）

| 检查 | 独立来源 | 结果 |
|---|---|---|
| 见证结构 | 自写解析器拆 input[0] sigScript（22,755 B）：`claimOutIdx`=OP_0 / `claim_prefix`(1B) / `claim_suffix`(2,854 B) / `tokenInIdx`=OP_1 / `tokenOutIdx`=OP_1 / `tok_prefix`(1B) / `tok_suffix`(3,078 B) / tag `51d04ce9` / redeem(16,802 B) | 与 ABI 序一致 |
| redeem 重编 | 同上 pinned silverc；state 取自链上 redeem（1/999/2/1000/closed=1/winningSide=1/payoutRoot=`cd…`） | **逐字节相等（16,802 B）**；`convert_to_claim` params 序与 tag `51d04ce9` 与链上一致 |
| 上游编码器 | 7 个参数喂 patched cli-debugger | action（5,950 B）**逐字节相等** |
| RootClaim 输出语义 | 我自写 8 字段 RootClaim state 编码（6×`08`+8B LE、`20`+payoutRoot、`08`+claimed_bitmap=0）重算 `blake2b256(claim_prefix ‖ state ‖ claim_suffix)` | 与链上 out[0] 的 P2SH **逐字节一致** |

限制：本形状里 `tokenInIdx==tokenOutIdx==1`、`claim_prefix==tok_prefix`（1B）成对相同，互换字节不变——这盲区已由批 3 的哨兵实验（编码器层）与 J2 的 `assertWitnessIndexLayout`/哨兵测试（builder 层）覆盖，本批未重复。convert_to_claim 的上游 **VM 执行**没有做（需要重建 RootClaim 外部模板输出与 token 输入的 witness 上下文，超出本次范围）；这一笔的"共识层接受"由节点本身担保。

## 3. 批 5 签名对象一致性（Bettor 追问）
- `proto-tx-assembly-settlement.mjs`（44081d5e）里 `createInputSignature` **只出现在 close_commit 一处**（`:356`）。convert_to_claim 没有任何 builder 侧签名：唯一被签的输入是 fee 输入，由 relay 的 `signOnlyDeclaredInputs` 对**已序列化的最终 tx JSON** 签名并做 `assertFinalTxid`；covenant 输入（RootClose、held 代币）只有 witness，没有签名。所以"先签后改 tx"这类缺陷在 convert_to_claim 上结构性不成立；链上 ACCEPT 是直接佐证。
- 给后续批的规则（claim_draw / withdraw / ticket_reclaim 会由 builder 用委员钥匹配的 bettor 钥签名，同一风险类）：**任何 builder 侧签名都必须对"最终 tx"的 sighash 验签，并带反向臂**；直接复用 `sighash_port.mjs`（J2 已拷为测试夹具）。

## 4. 专属 fee cap（Bettor 要求，同 F3' 方法；`fee_curves_cc_cl.mjs`）
方法：`requiredFee(v) = 100 × wasmLocalMass(draft)`（wasm = "输入 plurality 恒为 1"的 storage 公式）。这里用真实 wasm `calculateTransactionMass` 对**链上真实交易形状**（真 sigScript / 真 outputs / covenant）只改 fee UTXO 面值 v（draft change = leftover）：
- **convert_to_claim**：形状与 market_seal 相同（输入 20M/20M/v，输出 20M/20M/change），v=30M/40M/50M/70M/95M/100M 的 wasm mass = 304,762 / 312,500 / 320,001 / 332,469 / 343,860 / 345,716，与公式 6/6 逐位相等；requiredFee 随 v 单调增，v ≤ 1.0 KAS 时最大 **34,571,600**。cap = 1.5 × 最大 = 51,857,400 → 向上取整到 5M：**52,000,000 sompi（0.52 KAS）**（与 market_seal 同值；J2 实跑 fee UTXO 92M 时实付约 34.4M）。
- **close_commit**（2 输入 RootClose 20M + fee v，输出 RootClose 续约 20M + change）：v=30M…100M 的 wasm mass = 153,333 / 158,334 / 162,858 / 169,841 / 175,744 / 176,668，与公式 6/6 逐位相等；v ≤ 1.0 KAS 时最大 requiredFee **17,666,800**。cap = 1.5 × 最大 = 26,500,200 → 向上取整到 5M：**30,000,000 sompi（0.30 KAS）**（原借 1.0 KAS；此时 `min(2×requiredFee, cap)` 里 cap 起作用）。
- 失效条件同 F3'：仅对上述固定布局与常量输出成立；fee 规则一改（例如改按节点最低费定价）必须重推；cap 是损失上界，不是 fee 预测。

## 5. 未验证
- 只有 route A 一个市场形状、close_commit / convert_to_claim 各一个链上样本（n=1）。
- payoutRoot 是占位值；close_commit 的结果值来源（B4-4）是驱动层 MUST，未落码，本验证不涉及。
- close_commit 的节点侧 finality（B4-2）：J2 记录首次提交确实撞 NotFinalized，补挖块后被接受，与我的离线判断一致；主网 pmt 滞后的 10 秒样本是 J2 测的，我没有独立复测。
