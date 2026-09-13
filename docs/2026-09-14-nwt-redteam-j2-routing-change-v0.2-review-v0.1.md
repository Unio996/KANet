# NWT 红队复核 · T1/T2/T3 路由变更稿 v0.2（守恒放宽 MUST-FIX 定案：市场侧遍历方案）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`coord/j2-t3-market-sil` `154855de`（`docs/2026-09-13-j2-t1-t2-t3-routing-change-remove-bout-design-v0.2.md`）+
> 探针留痕 `docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/`（19 项）。
> 方法：**不读 run.log 就信**——独立提取全部 19 个 provenance 文件、`sha256sum -c` 核对 MANIFEST；用本会话已独立构建的
> silverscript v1.0.0(`@3ed9733`) 工具链（`D:/silverscript-v100`，与之前两轮 T1 复核同一份编译器）**独立编译** `TokenStub.sil`
> 三个 ctor 变体 + `MarketScanProbe2.sil` + `MarketScanProbe.sil`，逐字节比对产物；**独立跑** `cli-debugger --run-all`
> 复现全部 6 条向量；额外用**另一份**（非探针脚本引用的那份 worktree）`@noble/hashes/blake2b` 独立重算三个 TokenStub 实例的
> P2SH `scriptPubKey`，核对跟探针自己派生的 `spk` 值一致；直接读 `silverscript-lang` 源码 `state.rs` 里
> `readInputStateWithTemplate` 的校验逻辑，不满足于"黑盒向量过了"。

## 结论：**方案 1（市场侧遍历）机制上真实堵住了我 v0.1 的攻击构造，PASS——但"两半合一等价旧精确守恒"这条论证目前只是"架构上可以做到"，不是"已经做到"，必须把 T3 v0.3 逐条落码 + 我逐条复核列为与 T1 v0.6 联合合入的硬性前提，不能只看这份设计稿就放行合入**

## 一、① 探针是否真覆盖我的构造——独立复现，不是读 run.log 信

提取 19 个文件、`sha256sum -c MANIFEST.sha256` 全部 `OK`（19/19，无缺项）。用独立工具链重新编译 `TokenStub_A/B/X.sil`
三个 ctor 变体 + `MarketScanProbe2.sil` + `MarketScanProbe.sil`——**5 份编译产物跟提交的 `*.compiled.json` 逐字节相同**。
自己跑 `cli-debugger --test-file ... --run-all`：

```
MarketScanProbe2: read_one_pass                                    PASS  (1/1)
MarketScanProbe:  V-scan-1_pass_two_owned_tokens_summed             PASS
                  V-scan-2_fail_silent_second_token_caught_by_scan  PASS
                  V-scan-3_pass_other_owner_same_template_not_counted PASS
                  V-scan-4_pass_non_token_input_safely_skipped      PASS
                  V-harness_flip_of_V-scan-1_expect_fail            FAIL(=谐波正确翻红)
```
跟 `run.log` 完全一致——**这是我自己独立编译独立跑出来的，不是相信报告**。

`mk_vectors.mjs` 读过了：`V-scan-2` 的构造跟我 6da618e8 的 token#1/token#2 攻击**逐字对应**——market 名下
`token#1`(A=100)+`token#2`(B=250)，`absorb` 只声明处理 100，遍历真的扫到 350，`total(350)≠declared(100)`，交易
**必须** fail。我独立跑出的结果确实是 `PASS`（=这条 fail 向量按预期真的失败了）。**这条不是纸面论证，是我亲手验证过
这套遍历机制在真实编译器上会拒绝我原来那个能通过的攻击交易**。

## 二、② owner==self 过滤是否可绕（P13 结构匹配松紧）——独立读源码确认，比黑盒向量更强的证据

`V-scan-3` 证明"同模板不同 owner"被正确排除在外，我独立跑通了。但光看向量过了不够——我去读了
`silverscript-lang/src/compiler/compile/state.rs` 里 `compile_read_input_state_with_template_validation` 的
实际编译逻辑（不是猜它"应该"做什么）：

```
actual_template = i64le(prefix.length) || prefix || i64le(suffix.length) || suffix
require blake3(actual_template) == expected_template_hash
expected_input_spk = ScriptPubKeyP2SHFromRedeemScript(actual_redeem_script)
require input_script_pubkey(input_idx) == expected_input_spk
```

**这比 `MarketScanProbe.sil` 自己那层"P13 尾部字节比对"(`looksLikeToken`)严格得多**：`looksLikeToken` 只是一个廉价
预筛（只看 sigScript 尾部 `token_suffix_len` 字节），但真正的把关在 `readInputStateWithTemplate` 内部——它要求
claimed 的 prefix+suffix **重算出的 blake3 哈希**等于 `token_tmpl_hash`，**并且**这个 redeem script 重算出的
P2SH 哈希必须等于**这个输入自己实际花费的那个 UTXO 的真实 `scriptPubKey`**。后一条是关键：这个值不是攻击者能在
sigScript 里随便填的自由字段——它是这笔交易能通过共识层验证的前提（P2SH 花费本身就要求 `sigScript` 是那个
`scriptPubKey` 的合法 preimage），攻击者要伪造"看起来像代币、owner 字段填市场自己的 covenant_id"的输入，
唯一办法是**真的**用完全相同的 prefix/suffix 字节（即真的是同一份合约代码，只有 state 段不同）铸出一个真实
TokenStub/KanetTestToken 实例——这不是伪造，这正是"自由铸造测试币"这个 T1 既有设计本身允许的行为（任何人可以
给任意 owner 铸币），不是这次遍历机制引入的新洞。

**结论：owner==self 过滤在"防止空手套白狼伪造 state"这个维度是紧的（源码级确认，不只是黑盒向量）；它没有、也不需要
防"自由铸币模型下任何人都能把币铸给任意 owner"这件事——那是 T1 既有的、已接受的设计属性，不是本次遍历方案的责任
范围**。PASS。

## 三、③ "两半合一等价旧精确守恒"是否成立——特别是 market 之外的持有方，谁来遍历

这条我重点看了原文（不只是转述），发现摘要口径("市场侧遍历"）比原文实际覆盖范围窄，需要纠正：

**原文 §6 明确写的不是"市场"，是 T3 既有分类下的"每一个 A 类入口"**：`absorb`/`claim`/`refund_claim`/
`claim_draw`/`zk_handoff`/`convert_to_claim`/`convert_to_refundclaim` 等——这个清单跟我之前几轮已经审过的
T3 分类（`主网集 7 合约 23 条入口逐条分类 A 共花代币 15 条`）是同一套。**`claim`/`refund_claim`/`claim_draw`
正是领取(claim)covenant 自己的入口**（对应 `PayoutShard.claim/refund_claim`、`PayoutShardV2.refund_claim`、
`RootClaim.claim_draw`，T3 v0.2 那轮我已经审过这几个入口的另一条缺陷）——**"领取 covenant 那边谁来遍历"这个
问题原文其实已经回答了：领取 covenant 自己的这些入口，同样要新增 `scanOwnedTokenInputs()` 调用，跟市场侧是
同一份公共 helper、同一份纪律，不是漏掉了这一类持有方**。这条我判断 Bettor 1119-补③的顾虑是**该问、但原文
在 §6 已经覆盖**，不是空白——我要纠正的是，如果只读 §0-§4（"市场侧"这个措辞反复出现），确实容易误读成"只管
市场"，§6 才把范围铺满，这是**表述上的一个真实的可读性缺陷**（容易被后续转述/摘要漏掉这条范围声明，就像这次
Bettor 转发给我的三点摘要本身就把"每个 A 类入口"简化成了"市场侧"），建议 J2 在 v0.3/T3 落码时把 §0 一句话
总结也改成"每个 A 类入口"，不要让"市场"这个措辞在摘要层面持续走样。

**但"原文已经声明覆盖"≠"已经验证覆盖是完整且正确的"——这条我要拦住，不能放行成既成事实**：

1. **覆盖面是"当前已知的 7 合约 23 入口"这个封闭集合，不是任何未来持有方的自动保证**。如果 T3/T4 之后新增第 8 个
   会持有代币的合约类型，这份"两半合一"论证不会自动延伸过去——这不是本稿的错，但要写成一条**跨版本长期纪律**
   （任何新增的、会共花代币的合约，落码清单必须显式加一行"补 `scanOwnedTokenInputs()`"，不能靠"应该记得"），
   否则若干版本后这条隐含前提会像 CLAUDE.md 通则里说的"接位必读文件里的过期指令"一样悄悄失效。
2. **§6 列的 7 个入口名字目前只是清单，T3 v0.3 尚未逐条落码**——`V-scan-2` 证明的是"遍历机制本身在孤立探针里
   工作"，**不证明**未来 T3 v00.3 真的会在 `claim`/`refund_claim`/`claim_draw`/`zk_handoff`/`convert_to_claim`/
   `convert_to_refundclaim` 这 7 个入口(以及 absorb 之外其余同类 A 类入口，共约 15 条)**每一条**都正确接入、
   且等式右边(RHS)写对。§7 自己也点出了这条最大的剩余风险："multi-unrelated-token-input 批量入口的等式右边
   精确形式"——这恰好是最容易写错的地方（如果某个入口合法业务场景本来就要处理"这笔交易里两笔不相关的代币"，
   RHS 如果偷懒写成"总是等于我这次要处理的那笔"，遍历得到的 350 会跟只声明 100 的 RHS 对不上，导致**误杀**
   一笔合法交易——这是"过紧"而非"过松"的方向，比 MUST-FIX 那条(过松)危害小，但仍是需要逐条核的正确性问题，
   不是可以留白的细节）。
3. **`max_ins_scan` 遍历上界**（§7 open item 1，原文自己也点出未定）：如果这个界比协议真实允许的单笔交易最大
   输入数小，"把 victim 的代币输入藏在遍历不到的下标之后"这条攻击路径没有被这次机制堵死——`sum_in>=sum_out`
   本身是全局弱校验，不会替市场侧补上这个边界漏洞。**这条必须钉死为"`max_ins_scan` ≥ 协议/构造层实际允许的
   最大输入数"，不能是一个"典型场景够用"的经验值**，否则遍历本身可以被"凑够输入数撑爆遍历上界"绕过。

**给③的裁决：架构上的覆盖范围是完整的（我独立核对过，不是市场专属，§6 已铺满已知全部持有方类型），但"等价旧
精确守恒"这句话现在只是"设计目标"，还不是"已验证的事实"——变成事实需要三件都做到：(a) T3 v0.3 在全部 A 类入口
逐条落码 `scanOwnedTokenInputs()`，(b) 每条入口的等式 RHS 单独复核（尤其多代币输入合法场景），(c) `max_ins_scan`
钉死为不小于协议实际最大输入数。这三条我裁为 T1 v0.6 + T3 联合合入前的硬性前提（跟原文 §4 自己说的"两边必须在
同一次合入里一起落码"是同一个精神，我只是把它从"合入时机"延伸到"合入时机 + 逐条正确性核验"），到时候我会照
这三条逐条复核，不是只看一份汇总声明就放行。**

## 四、④ 弃方案 2 的论证是否成立——两条子理由独立核对，成立

**子理由(a)（读 market 续约输出撞 V-T-6）**：这是从本会话已经三层独立证据钉死的 V-T-6 根因（`binding=cov`
结构性无法内省非本 covenant 输出）直接推出的逻辑必然结果——代币合约的 `transferPolicy` 结构上必须是
`binding=cov`（§1 已论证，跟 v0.1 一致），market 的续约输出对代币合约而言就是"非本 covenant 输出"，不需要
另开一轮探针验证"会不会也坏"，**这是同一个已证事实的直接应用，不是新的、需要单独验证的主张**。认可。

**子理由(b)（读 market 先前输入状态，时序不对）**：这条是**因果上的必然结果，不是需要工具链验证的经验主张**——
"先前状态"在这笔交易被构造之前就已经确定（写入链上或计算出来），而"这笔交易到底夹带了哪些代币输入"是**构造
这笔交易的人（可能是攻击者）在事后决定的事实**，任何在交易发生前就已固定的值都不可能编码一件发生在它之后才
被决定的事情。这个论证不需要探针复现，逻辑上是自洽的，我认可。

**结论：弃方案 2 的两条理由都站得住，选方案 1 是唯一在时序和工具链两个维度都成立的选项，跟 J2 的表述一致**。

## 五、给 Bettor 的处置建议

- **机制本身（方案 1）PASS**：我独立复现了全部编译产物字节相同 + 全部 6 条向量结果一致 + 用独立 blake2b 库
  重算 P2SH 哈希一致 + 直接读源码确认 `readInputStateWithTemplate` 的 P2SH 交叉验证比黑盒向量看到的更强——
  这条真的堵住了我 6da618e8 的攻击构造，不是纸面论证。
- **③需要纠偏但原文已覆盖**：Bettor 1119-补③的顾虑成立、该问，但读原文 §6（不是只读摘要）会看到"每个 A 类
  入口"已经把 `claim`/`refund_claim`/`claim_draw` 等领取侧入口纳入同一份纪律——不是空白，是表述层面容易被
  转述削窄，建议 J2 在后续摘要/口头转述里统一说"每个 A 类入口"，别再简化成"市场侧"。
- **不批准"设计稿通过=可以合入"**：T1 v0.6 + T3 联合合入前，我要求三件事逐条兑现且我逐条复核：(a) 7 个/约15条
  A 类入口全部真落码 `scanOwnedTokenInputs()`（不是清单，是真代码+真向量）；(b) 每条入口的等式 RHS 单独核对，
  尤其合法多代币输入场景不能被误杀；(c) `max_ins_scan` 钉死为不小于协议实际最大输入数，堵住"藏在遍历界外"
  这条尚未验证的边界。这三条不满足，"两半合一等价旧精确守恒"这句话就还只是意图，不是事实。
- **弃方案 2 的论证 PASS**，两条子理由（V-T-6 同构 / 时序因果不可能）都经得起核对，不需要重开。
- 19 个 provenance 文件 `sha256sum -c` 全部 `OK`，跟树对齐。
