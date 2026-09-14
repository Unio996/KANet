# RefundClaim.sil — v0.3 §2/§3 代币化（ledger 1164③ 三步之三，claim 家族已开闸）

> **RERUN 状态注记(2026-09-15, 账本 1408/1409/1415·f7342a32)**：同 RootClaim.sil——Owner 撤销 H1(b) 后
> "同病同治"删除本文件 ctor 的 `market_suffix_hash` 参数、`ClaimState.market_suffix_hash` 字段、构造字面量
> 那一行(仅三处, 逻辑零改动)。用真实生产 `KanetTestToken.sil`(v0.3方案C)+`KanetTokenClaim.sil`(v0.3,
> 4字段)+本文件重编译重跑既有 6 条向量，**6/6 pass**。详见 `run.log` 末尾 RERUN 章节。

Bettor ledger 1164/1166 裁：KanetTokenClaim 已 GREEN（主体 22bf679a + ZERO32 修 95e7c909，NWT 0073b0a5），
claim 家族的闸已开，RefundClaim 的③代币化不必再等，形状明确给出：`refund_payout` 的退款目的地改成本笔新建的
`KanetTokenClaim` 输出，`ClaimState` 五字段填齐，`validateOutputStateWithTemplate` 绑 `claim_tmpl_hash`
（Q8 结构性用途），代币输出 owner = `OpOutputCovenantId(claimOutIdx)` 且按 1158 规则加 `!= ZERO32`，
`remaining` 分支照 f8e95e35（`else` 分支保留 `validateOutputState`）。

## 改动

### ctor（9→12 参数）

新增三个 ctor-only 常量（不进 State，直接引用）：

- `token_tmpl_hash`：`pool_value` 现在代表的 KCC-20 代币模板 hash，P13 witness+blake3 形核对（同
  `PayoutShard.sil`/`PayoutShardV2.sil`）。
- `claim_tmpl_hash`：新建输出必须真是编译过的 `KanetTokenClaim` 字节这件事的锚——**Q8 结构性用途**：只嵌一个
  hash，不烤 claim 合约字节本身进 `RefundClaim`（同一原则贯穿 T3 v0.3 的所有 template hash 字段）。**同样用
  P13 witness+blake3 现场核**（`claim_prefix`/`claim_suffix` witness），跟 `token_tmpl_hash` 处理方式一致，
  没有对这一个字段单开一条"信任 ctor 烤值"的例外。
- `market_suffix_hash`：`RefundClaim` 自身 sigScript 尾部的 blake3——本合约在 `KanetTokenClaim` 语境里扮演
  "市场"角色，供新建的 claim 未来验证"转回本合约再下注"这条路径的真伪（同 `KanetTokenClaim.market_suffix_hash`
  字段的用途，只是这次由 `RefundClaim` 自己提供而不是某个真正的市场合约）。

### `refund_payout`（5 参数 → 12 参数, 彻底改变退款目的地）

**旧形**：直接 `require(tx.outputs[payoutOutIdx].scriptPubKey == byte[](bettorLock))` 付到裸 P2PK。

**新形**（D-017"代币只许 covenant 持有"，裸 P2PK 违规）：

1. 读 dust-ticket（不变）。
2. **P13 形**核 `token_tmpl_hash`，读本合约当前持有的代币输入 `heldTk`（`tokenInIdx`），核
   `heldTk.owner==本合约自身` + `heldTk.amount==pool_value`（不信任 witness，读真实持仓）。
3. **P13 形**核 `claim_tmpl_hash`（新增字段同款处理）。
4. **ZERO32 目的地守卫**（NWT 1158 系统性扫查纪律，措辞按 1173 更正）：`claimCovId = OpOutputCovenantId(claimOutIdx)`
   后立即 `require(claimCovId != ZERO32)`。**这一条不是 `claim_tmpl_hash` 模板校验的附属/冗余**——NWT 读 rusty-kaspa
   `covenants.rs` 确认：一笔输出的 `covenant` 绑定字段跟 `script_public_key` 是**完全独立**的两件事；一个输出
   可以脚本字节逐位匹配真实编译的 `KanetTokenClaim` 模板，同时 `covenant` 字段是 `None`（未声明），此时
   `OpOutputCovenantId` 照样回退 `ZERO_HASH`——**模板匹配 ≠ covenant 绑定**。NWT 自建的这类向量会被
   `require(claimCovId != ZERO32)` 精确单独拦下，不是被 `claim_tmpl_hash` 那条模板检查拦下。所以第 4 条和第
   5 条是两条独立承重的检查，缺一都会留洞，不能把 4 读成"5 的深化/顺带"。
5. `validateOutputStateWithTemplate(claimOutIdx, ClaimState{...}, claim_prefix, claim_suffix, claim_tmpl_hash)`
   建新 `KanetTokenClaim` 实例——五字段：`market_cov_id=本合约自身身份`（provenance）、`winner_pk=票面 bettor`、
   `amount=票面 stake`、`token_tmpl_hash`/`market_suffix_hash` 透传。
6. `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{owner:claimCovId,...}, tokenInIdx,...)`——
   转给新 claim 的那份代币，owner 派生自上面已核过非零的 `claimCovId`（不是裸 witness）。
7. **draw-down 分支**（f8e95e35 建立的形状，`else` 分支不变，逐字沿用 `validateOutputState`）：
   `remaining==0` ⇒ 无代币剩余续约、无 bookkeeping 续约；`remaining>0` ⇒ 代币剩余量续给本合约自己
   （`validateOutputStateWithInputTemplate`，owner=本合约）+ bookkeeping 续 `pool_value-stake`
   （`validateOutputState`）。

### V-T-8 复核（本次没有绕道 AB11，如实记录为什么）

`refund_payout` 在同一函数体里同时出现了 `readInputStateWithTemplate`（×2：ticket + 代币）和 `validateOutputState`
（同合约自身 bookkeeping 续约，仅 partial 分支）——这正是 V-T-8 已知会崩的组合形状（
`docs/provenance/2026-09-14-j2-vt8-read-external-plus-self-continue-probe/`）。**先按 Bettor 字面给的形状
（"remaining 分支照 f8e95e35"）实现并实测，而不是预先假设会崩就绕去 AB11**——事实上这个组合在本文件里
**没有崩溃**（`V-RC-TOK-1`/`V-RC-TOK-2` 两条 pass 向量都干净通过，没有触发运行期 panic 或"-N cannot be used
as an array index"类错误）。这跟 `PayoutShard.sil` 的 `absorb` 需要绕 AB11 的情形不完全一样——`f8e95e35`
的 draw-down 修复本身也是 `readInputStateWithTemplate`(ticket) + `validateOutputState`(self) 同函数共存，
同样没有崩过，说明 V-T-8 的触发条件比"两者同函数共存"更窄（具体是什么额外条件目前不确定，按 Bettor 指示不去
读 silverc 源码定位，交给 NWT 并行核实）；**如实记录这个观察，不代表 V-T-8 的一般性结论被推翻**，只是这个
具体组合在实测中是安全的。

## 向量（`run.log`，6/6 PASS，2 条关键负向量用交互步进精确定位失败行）

复用既有 dust-ticket `PoolSideStub.sil`、`KanetTestToken.sil`（代币）、`KanetTokenClaim.sil` 编译真实实例
（`template_hash`/`prefix`/`suffix` 对 ctor 字段值不变的既有性质，同 T1/T2 全程复用的手法）。

| 向量 | 验证点 | 交互步进确认的真实失败行 |
|---|---|---|
| `V-RC-TOK-1_pass_partial_refund_with_remainder` | pass：部分退款，代币剩余量续给本合约 + bookkeeping 续约 | — |
| `V-RC-TOK-2_pass_exact_no_remainder` | pass：恰好清零，无代币剩余续约、无 bookkeeping 续约 | — |
| `V-RC-TOK-3_fail_destination_not_real_claim_template`（Bettor 明确要求的"目的地 claim 模板错"） | fail：新建输出不是真编译的 `KanetTokenClaim` 字节 | `validateOutputStateWithTemplate`（行 110） |
| `V-RC-TOK-4_fail_token_owner_diverted_to_stranger`（Bettor 明确要求的"owner 改道"） | fail：代币输出 owner 被导向陌生人而非真 claim covenant | `validateOutputStateWithInputTemplate`（行 119） |
| `V-RC-TOK-5_fail_witness_wrong_tok_prefix`（Bettor 明确要求的"witness 错"） | fail：代币模板 witness 错，blake3 现场核不过 | `token_tmpl_hash` blake3 核对（行 93） |
| `V-RC-TOK-6_fail_witness_wrong_claim_prefix` | fail：claim 模板 witness 错，blake3 现场核不过 | `claim_tmpl_hash` blake3 核对（行 100） |

## 调试器踩坑记录（新发现，供后续复用）

**genesis-covenant-id 不是 `blake2b(bytecode)`**：一个输出声明 `covenant_id` 且找不到匹配的续约输入时，
调试器把它当"genesis 输出"处理，真正的期望值来自 `kaspa-txscript::covenants.rs` 的
`hashing::covenant_id::covenant_id(input.previous_outpoint, output_indices...)`——是"花费的那笔 UTXO 的
outpoint + 被授权的输出集合"的哈希，**跟合约编译字节码的哈希完全无关**。测试夹具没法（也不需要）真的复现这个
推导——本项目既有的绕法（本次才第一次踩到、之前的向量刚好都绕过去了）是"续约形式技巧"：给新输出任意选一个
`covenant_id`，同时在 tx 里放一个专门的哑元输入声明**相同**的 `covenant_id`，把新输出的 `authorizing_input`
指向那个哑元输入——这样 `input_covenant_id == covenant_id` 成立，触发"续约"分支而不是"genesis"分支，完全跳过
真实的密码学重算路径（`OpOutputCovenantId` 读回的值不受这个分类影响，始终是声明的那个值）。已写进本文件的
生成脚本注释，供下一次构造"全新覆盖输出"向量时直接抄。

## 已知后续依赖（不在本次范围内，明确记录）

`RootClose.convert_to_refundclaim` 目前仍按旧的 9-参数 `RefundClaim` ctor 构造新实例（
`validateOutputStateWithTemplate(rcOutIdx, State{...7 字段...}, rc_prefix, rc_suffix, refundclaim_tmpl_hash)`）
——本次 ctor 新增的三个字段（`token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`）还没有反映到
`RootClose.sil` 那一侧。这是 Bettor 排的④"RootClose/RootClaim/ShardLeaf/ShardLeaf_direct"批次的一部分，
本次不动 `RootClose.sil`，如实记录这个断点，不是漏做。

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
