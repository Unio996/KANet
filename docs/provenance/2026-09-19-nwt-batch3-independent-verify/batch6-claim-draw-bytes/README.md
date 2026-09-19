# 批 6 claim_draw 链上字节层 + 上游 VM 独立验证，及 claim_draw 专属 fee cap — NWT 2026-09-19

对象：J2 simnet 全链 v2（builder ef45f568）的 claim_draw，txid `0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f`。节点 = 官方 kaspad 2.0.1（PID 15972，sha256 `8afe6a68…6e38`，J2 释放后我只读）。我自己用 `getBlocks` 取回该交易与其父交易（`fetch_claimdraw.mjs`），未读 J2 落盘；未向节点提交任何交易。
交易形状：4 输入 = RootClaim（20M，covenant）/ 赢家 ticket（20M，普通 P2SH 无 covenant）/ 合并 KTT（20M，covenant）/ fee（95M）；3 输出 = 新 KanetTokenClaim（20M，genesis）/ 代币转出（20M，genesis）/ 找零。节点区块记录：storageMass 179,586、computeMass 40,407，version 1。

## 结论：PASS

| 检查 | 独立来源 | 结果 |
|---|---|---|
| 见证结构（RootClaim 输入，sigScript 7,300 B） | 自写 push 解析器 | 16 个参数 + tag `ed9a9003` + redeem（PUSHDATA2 2,951 B）：`rootOutIdx=0, claimOutIdx=0, tokenInIdx=2, tokenOutIdx=1, remainTokenOutIdx=0, payout=1000, merkle_index=0, tree_depth=0, siblings=[]（OP_0）, ticketInIdx=1, ticket_prefix_len=1, ticket_suffix_len=32, tok_prefix(1B), tok_suffix(3,078B), claim_prefix(1B), claim_suffix(1,238B)` |
| RootClaim redeem 重编 | pinned silverc-v100（sha256 `4378ba65…8643`，脚本内硬校验）：ctor 由链上 redeem 推出（state 1/999/2/1000/closed=1/winningSide=1/payoutRoot/claimed_bitmap=0，`shard_pool_id`/`claim_tmpl_hash` 取自 redeem 常量） | **逐字节相等（2,951 B）**；`claim_draw` params 声明序与链上一致，tag `ed9a9003` 一致 |
| ticket redeem 重编 | 同上：`PoolSideTicket(bettorPk, direction=1, stake=999, shardPoolId)`，bettorPk 取自 redeem 状态区 | **逐字节相等（117 B）**；`authorize_spend(sig bettorSig)` tag `8c1c0eeb` 与链上一致；ticket 的 `shardPoolId` == RootClaim 的 `shard_pool_id` |
| 上游编码器 | 把我解出的参数喂 patched cli-debugger（3ed9733 + 仅 eprintln，sha256 `c8072cfa…3a34`）的上游 `encode_contract_entry_sig_script` | RootClaim `claim_draw` action（4,346 B）与链上 sigScript 去掉尾部 redeem push 后**逐字节相等**；ticket `authorize_spend` action（71 B）**逐字节相等** |
| 上游 VM 执行真实交易：ticket | 链上真实 tx（真实 prev outpoint/金额/输出 spk 与 covenant）+ 链上真实 bettor 签名，active input=1 | **PASS**（`checkSig(bettorSig, pubkey(bettorPk))` 通过） |
| 上游 VM 执行真实交易：RootClaim | 同一笔链上真实 tx，active input=0；输入 1/2 的真实 sigScript 与父输出 spk 作为上下文提供 | **PASS**（整条 `claim_draw` 入口：`closed==1`、payout 范围、ticket 读入与 `ps_tmpl_hash`/`shardPoolId`/`direction==winningSide`、depth-0 merkle `cur==payoutRoot`、claimed_bitmap slot、token 读入、KanetTokenClaim 输出模板校验与 covenant id 全过） |
| ticket 签名对链上 tx 的 sighash | 自移植 `calc_schnorr_signature_hash` + schnorr 验签（`sighash_port.mjs`） | 对最终 tx **有效**；**反向臂**（去掉 output0 的 covenant）**无效** ⇒ 签名确实绑定 covenant，B4-1 类缺陷在批 6 不存在 |

## 批 6 的签名对象一致性（Bettor 追问的续）
`buildClaimDrawTxJson` 先建 covenant 已就位的候选 tx，`assertTicketSigningKey`（公钥推导链证明）通过后才对它签 ticket 输入，再用真实签名重建最终 tx。上表 sighash 验签与上游 VM 双重证明该时序正确（迄今 builder 里用 createInputSignature 的两条路径——close_commit 与 claim_draw——都已用"对最终 tx 验签 + 反向臂"独立验过）。
ticket 的 `authorize_spend` 只要求 `checkSig(bettorSig, bettorPk)`，签名承诺全部输出与全部输入 outpoint，所以**任何持有 bettor 私钥的人都能用这张 ticket 参与任何 tx**；在 v0 里 bettorPk = 委员公钥，等于"谁拿到委员私钥谁能花所有 ticket"，与 Codex MUST-PROVE 描述的边界一致（`assertTicketSigningKey` 是第一道拦截，多用户场景需另设计）。

## claim_draw 专属 fee cap（F3' 同法：`fee_curve_claim_draw.mjs`）
`requiredFee(v) = 100 × wasmLocalMass(draft)`，draft = 只改 fee UTXO 面值 v、找零 = leftover（= v + 20M：ticket 面值回到找零）。用真实 wasm `calculateTransactionMass` 对链上真实形状（真 sigScript、真 outputs、covenant）：

| v | 50M | 60M | 70M | 95M | 100M |
|---|---|---|---|---|---|
| wasm mass | 268,833 | 279,168 | 288,035 | 305,471 | 308,333 |
| = 公式（输入 plurality 恒 1） | ✓ | ✓ | ✓ | ✓ | ✓ |
| requiredFee | 26,883,300 | 27,916,800 | 28,803,500 | **30,547,100（= J2 实付，逐位）** | 30,833,300 |

v ≤ 1.0 KAS（`SIGNED_INPUT_CEILING`）时最大 requiredFee = **30,833,300**；cap = 1.5 × 最大 = 46,249,950 → 向上取整到 5M：**`feeProfile.claim_draw.cap` = 50,000,000 sompi（0.50 KAS）**（`min(2×requiredFee, cap, 1 KAS)`：2×requiredFee ≥ 53.7M > 50M，所以 cap 起作用）。失效条件同 F3'：仅对此固定布局与常量输出成立，fee 规则一改必须重推；cap 是损失上界，不是 fee 预测。

## 未验证
- n=1 的市场形状（route A：pool_value=1000，单赢家，depth-0）；partial 分支与 depth≥1 不在批 6 范围。
- 上游 VM 是 debugger（只执行 active input，各输入分别跑）；节点接受由 J2 的 simnet 记录担保，三源（断言=getMempoolEntry=区块记录）已由 J2 报告，我只取了区块记录的 storage/compute（179,586 / 40,407）核对。
- `bettorPk = 委员公钥` 的生产映射意味着 ticket 私钥 = 委员私钥（加密信封不入库）；我的验证只用链上签名与公钥，没有用任何私钥。
