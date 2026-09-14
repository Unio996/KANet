# PayoutShard.sil v0.3 落码 — absorb(V-T-8/AB11 绕路) + close_attest/cancel_attest(noTokenInput)

> 📌 **状态注记（2026-09-14 · Bettor ledger 1209）**：本目录向量集用的是 **23 参数 ctor**（`claim_tmpl_hash`/
> `market_suffix_hash` 加入前），当前 `PayoutShard.sil` 是 **25 参数**——直接重跑本目录的 test.json 会报
> `constructor expects 25 arguments, got 23`，**不适用重跑**（历史陈旧，非本次回归）。**superseded by**
> `docs/provenance/2026-09-14-j2-t3-v03-payoutshard-current-suite/`（完整现行向量套件，含本目录全部
> absorb/close_attest/cancel_attest 向量在当前 ctor 下的等价重生成 + `absorb` 新增的 sole-source 6 条 +
> 1122 边界 3 条）。本文件下方内容保留作历史记录，不改原文。

Bettor ledger 1131（先做 absorb/close_attest/cancel_attest）→ 1140（撞 V-T-8）→ 1142（AB10 死路+AB11 通路）→
1145（裁：直接用 AB11 改 absorb，四条件）→ 1149（补 noTokenInput 的 1122 边界向量）→ **1151（裁：改回 T2 §3.3
已审设计形——witness 供 tok_prefix/tok_suffix + blake3 现场核 token_tmpl_hash，不维持 ctor 烤死变体）**。
本目录是全部裁定的合并交付证据。

## 〇、1151 修正：`scanOwnedTokenInputs`/`noTokenInput` 改回 P13 witness+blake3 形

**起因（J2 自纠错误）**：最早落码时误判"blake3 不是 silverscript 可调用的内置函数"（只查了 `TUTORIAL.md`
的函数列表，没有直接查 silverc 源码），据此把这两个 helper 从 T2 §3.3 原文的"witness 供 prefix/suffix +
blake3 现场核 token_tmpl_hash"改成了"prefix/suffix 直接 ctor 烤死，不做 hash 校验"。经核实
`silverscript-lang/src/compiler/compile/expression/builtin.rs:33`，`blake3` 确是注册齐全的真实内置函数，
误判已纠正并报告。

**Bettor 1151 裁：改回已审设计形，理由四条**：① 偏离已审设计且前提错误，设计先行规矩；② Q8/Owner 币解耦——
市场模板只嵌 32 字节 `token_tmpl_hash`，换币 = 换一个 hash，不能把代币代码烤进市场模板；③
`readInputStateWithTemplate` 本就只需要 `len`+`hash`（字节从输入 `sigScript` 自取、内部再校验），烤字节只
服务 `looksLikeToken` 预筛和 `noTokenInput` 尾比对，这两处按 T2 §3.3 P13 形改 witness 供即可；④ 代币模板
字节一旦烤进 ctor，就会进每个市场实例的 redeem script，每次调用都要带整段，mass 有放大风险。

**改动**：ctor 删 `token_prefix`/`token_prefix_len`/`token_suffix`/`token_suffix_len` 四个字段（只留
`token_tmpl_hash`，27 参数 → 23 参数）；`scanOwnedTokenInputs`/`noTokenInput` 签名各加
`byte[] tok_prefix, byte[] tok_suffix` witness 参数，函数体第一行改为
`require(blake3((tok_prefix.length as byte[8])+tok_prefix+(tok_suffix.length as byte[8])+tok_suffix) ==
token_tmpl_hash)`（T2 §3.3 已验证 preimage，`docs/provenance/2026-09-13-j2-t2-p13-no-token-proof-a2/`），
验过再用验过的 `tok_suffix`/`tok_prefix.length`/`tok_suffix.length` 做后续尾匹配与 `readInputStateWithTemplate`
调用；`absorb`/`close_attest`/`cancel_attest` 三个入口签名各加 `tok_prefix`/`tok_suffix` 两个 witness 参数,
调用点相应传入。

**bytecode_length 改前/改后对比**（`measure_output.json`，均为真实 ctor 完整编译产物）：

| | own_prefix_len | own_state_len | own_suffix_len | **bytecode_length（锁定脚本总长）** |
|---|---|---|---|---|
| 改前（ctor 烤 token_prefix/suffix，两者取自真实 KanetTestToken 实例，1+3214 字节） | 1 | 204 | 21571 | **21776** |
| 改后（witness 供，ctor 只留 token_tmpl_hash） | 1 | 204 | 21988 | **22193** |

**如实记录：本次锁定脚本反而略微变大（+417 字节），不是"改小了"**——`OWN_PREFIX_LEN`/`OWN_STATE_LEN` 两个
V-T-8/AB11 常量本身**没有漂移**（仍是 1/204，量测脚本确认），但 `blake3` 校验逻辑在 `absorb`（经
`scanOwnedTokenInputs`）与 `close_attest`/`cancel_attest`（各自经 `noTokenInput`）三个调用点各展开一份
（silverc 对这类 helper 是内联而非共享子程序调用，同此前调试痕迹里反复出现的 `__inline_N_functionName`
一致），三份 blake3 校验 opcode 加起来的字节数比"只烤一次、约 3215 字节的完整 KanetTestToken 前后缀"更多。
**这不推翻 Bettor 1151 的四条理由**——理由②③是关于"市场模板不应该跟代币字节内容耦合"这条架构原则，理由④
关心的是**每次 spend 都要重复携带**的那部分成本（本次量测的是锁定脚本，不是每次调用的 witness 总量；
换币场景下"改一个 hash 常量 vs 改整段 ctor 字节并影响所有已部署实例的模板哈希"这条差异本次量测没有覆盖，
量的只是单份锁定脚本大小），只是"字节数变小"这个具体推论，在**本文件这个大小量级**上没有兑现，如实记录
不掩盖。

**全部既有 19 条向量（9 absorb + 10 battest）+ 本次新增 4 条 witness 错误负向量重跑，23/23 PASS**（详见 §条件(c)
与 §二，两组 run.log 已更新）。

## 一、absorb 的 AB11 绕路实现

`readInputStateWithTemplate`（读 shard 代币状态）与声明式 `validateOutputState`（续本合约 State）同函数内
共存运行期必崩（V-T-8，架构级 silverc 限制，见 `docs/provenance/2026-09-14-j2-vt8-read-external-plus-self-continue-probe/`）。
`absorb` 恰好需要两者同时出现，因此自续约改手写等价形式：不调用 `validateOutputState`，改为自己拼接
State 编码字节、重算 P2SH、跟 `tx.outputs[selfOutIdx].scriptPubKey` 比对。

### 条件 (a)：常量不手抄，量测脚本 + 漂移检测

`measure_payoutshard_state_span.mjs`：对 `PayoutShard.sil` 用真实 ctor 参数完整编译，从编译产物的
`state_span` 字段量出 `own_prefix_len`（=`state_span.offset`）、`own_state_len`（=`state_span.len`），
再解析源码里 `OWN_PREFIX_LEN`/`OWN_STATE_LEN` 两个 `int constant` 声明值比对——不一致直接 exit(1) 报
"CONSTANT DRIFT DETECTED"。**本次运行结果**（`measure_output.json`）：

```
measured: { own_prefix_len: 1, own_state_len: 204, own_suffix_len: 21571, bytecode_length: 21776 }
declared: { own_prefix_len: 1, own_state_len: 204 }
OK: no drift
```

**维护纪律**：以后任何一次改动本文件源码结构、或改变 ctor 里 `token_prefix`/`token_suffix` 的**长度**选择
（哪怕只改长度不改内容），落码前必须重跑这个脚本；`OWN_PREFIX_LEN`/`OWN_STATE_LEN` 两个常量只能由脚本量出
后手工誊抄进源码，不能凭记忆/凭上次的值蒙。这条以后进 T4 创世对照范围（Bettor 1145 裁）。

### 条件 (b)：PayoutShard 20 字段 State 手写编码表（供 NWT 逐字段核对 + 独立复现）

State 布局顺序（`contract PayoutShard(...)` 花括号内的字段声明顺序，即 `consolidated_pool` 起 20 个字段）:

| # | 字段名 | 类型 | tag 字节 | payload 长度 | 编码表达式 |
|---|---|---|---|---|---|
| 1 | `consolidated_pool` | `int` | `0x08` | 8 | `8 as byte[1]` + `(consolidated_pool+shard_amount) as byte[8]` |
| 2 | `closed` | `int` | `0x08` | 8 | `8 as byte[1]` + `closed as byte[8]`（本入口不改, 原样透传） |
| 3 | `payoutRoot` | `byte[32]` | `0x20` | 32 | `32 as byte[1]` + `byte[](payoutRoot)`（原样透传） |
| 4–20 | `w0`..`w16` | `int` × 17 | `0x08` 每个 | 8 每个 | `8 as byte[1]` + `wN as byte[8]`（原样透传, N=0..16） |

`tag` 字节即 Kaspa 脚本"push N 字节"惯例（opcode 值本身等于要 push 的字节数, 1–75 范围内直接编码）；每个
`int` 字段固定编码为 8 字节小端（`as byte[8]`）, `byte[32]` 字段固定 32 字节原样, 与 `PayoutShardV2.sil`
`zk_handoff`（`:387-405`）已有的手写 `stateBytes` 构造手法逐字节一致——本次不是新发明编码规则, 是把已经在
本仓库跑通过的手法复用到 absorb 上。总长度 = (1+8)×2 + (1+32) + (1+8)×17 = 18+33+153 = **204 字节**,
与量测脚本实测的 `own_state_len` 完全对上。

`OWN_PREFIX_LEN`/`OWN_STATE_LEN` 不走"自身模板哈希进 ctor"这条路——那条已被 AB10 证明是自指方程
（`hash(...x...)==x`，原像问题量级，无可行解），改为直接从 `tx.inputs[this.activeInputIndex].sigScript`
（当前执行脚本自己的完整字节码）切片借出 `ownPrefix`/`ownSuffix`，只替换中间 204 字节的 state 区段。

### 条件 (c)：向量 —— `absorb.run.log`，**11/11 PASS**（含 1151 新增 2 条 witness 错误负向量）

| 向量 | 类型 | 验证点 |
|---|---|---|
| `V-absorb-1_pass_owned_plus_incoming_shard` | 正 | 归己代币(100)+吸收 shard(50)→150, 全链路(scan+tokenOutOk+自续约手写编码+dust)一次跑通 |
| `V-absorb-2_fail_smuggled_second_owned_token_uncounted` | 负 | NWT token#2 攻击原形——第二笔归己代币未被 scan 计入, 挡在 `scanOwnedTokenInputs()==consolidated_pool` |
| `V-absorb-3_pass_stranger_same_template_present_not_counted` | 正 | 同模板不同 owner 的代币合法在场不计入(owner 过滤), 不误伤 |
| `V-absorb-4_fail_output_diverted_to_stranger_owner` | 负 | 代币续约 owner 指向陌生 covenant, 挡在 `validateOutputStateWithInputTemplate`(1127① 纪律) |
| `V-absorb-5_fail_output_wrong_amount` | 负 | 代币续约金额算错(130≠150), 同上原语挡下 |
| `V-absorb-6_fail_self_output_below_dust_min` | 负(**本合约自续约金额/字段全对**, 唯独 KAS 低于 `DUST_MIN`) | 手写编码 scriptPubKey 比对**通过**, 在下一行 `value>=DUST_MIN` 才拒——证明这条不是被 V-T-8 崩溃"意外救回"的假阳性(已用 flip-expect 复核错误发生行, 见下) |
| `V-absorb-7_fail_self_continuation_wrong_closed_field` | 负(条件 c 要求"任一非金额字段错") | `closed` 字段(int, 顶层控制位)被改, 手写编码 scriptPubKey 比对失配 |
| `V-absorb-8_fail_self_continuation_wrong_payoutRoot_field` | 负(条件 c) | `payoutRoot` 字段(byte[32]) 被改, 同上失配 |
| `V-absorb-9_fail_self_continuation_wrong_w5_field` | 负(条件 c) | `w5` 字段(int, 17 字数组第 6 个, 深处字段) 被改, 同上失配——证明手写编码覆盖到数组深处, 不是只对齐了前几个字段 |
| `V-absorb-10_fail_witness_wrong_tok_prefix_blake3_mismatch`（1151 新增） | 负 | witness 供错 `tok_prefix`, 在 `scanOwnedTokenInputs` 的 blake3 现场核那行结构性拒绝, 不会走到后面任何业务检查 |
| `V-absorb-11_fail_witness_wrong_tok_suffix_blake3_mismatch`（1151 新增） | 负 | 同上, 镜像 `tok_suffix` |

**已用 flip-expect 复核每条负向量的真实失败行**（不是巧合通过）：V-absorb-6 在
`require(tx.outputs[selfOutIdx].scriptPubKey==...)` 那行**先通过**、下一行 `value>=DUST_MIN` 才失败；
V-absorb-7/8/9 全部准确失败在 `scriptPubKey` 比对那一行——三个不同字段（int 顶层 / byte32 / int 数组深处）
改动均被手写编码正确捕捉，不是只对第一个字段敏感的表面通过。

## 二、close_attest / cancel_attest：`noTokenInput()`（不受 V-T-8 影响）——`battest.run.log`，**12/12 PASS**（含 1151 新增 2 条 witness 错误负向量）

这两个入口的委员签名逻辑本次一字不动（沿用既有 4-of-5 门限 + depth-8 merkle），只加两条：
`require(noTokenInput())`（B 类不在场证明，1123 Codex 复核采纳）+ KAS dust weld 下限
`tx.outputs[selfOutIdx].value >= DUST_MIN`（原为 `==consolidated_pool`）。

真实 5-of-5 有效签名向量构造超出本次范围（沿用此前 `RootClose` 冒烟测试的做法：用格式合法但内容全零的
"假签名"验证 `noTokenInput()` 本身的两个分支正确工作）：

| 向量 | 验证点 |
|---|---|
| `V-close_attest-1_fail_no_token_sigs_invalid_reaches_sig_gate` | 无代币输入 → `noTokenInput()` 放行 → 落到签名门限(0 个有效签名)才拒——证明 `noTokenInput()` 没有误挡干净交易 |
| `V-close_attest-2_fail_token_input_present_rejected_by_noTokenInput` | 代币模板输入在场 → 在签名门限**之前**被 `noTokenInput()` 结构性拒绝 |
| `V-cancel_attest-1/2` | 镜像上两条 |
| `V-{close,cancel}_attest-6_fail_witness_wrong_tok_prefix_blake3_mismatch`（1151 新增） | witness 供错 `tok_prefix`, 在 `noTokenInput` 的 blake3 现场核那行结构性拒绝(未到长度闸/P7 尾匹配) |

**1122/1122-补 边界纪律（Bettor 1149 提醒自查后补齐, 三条 × 两入口 = 6 条）**：`noTokenInput()` 跟
`scanOwnedTokenInputs()` 共享同一个 `MAX_INS_SCAN=8` 常量与同一套 `require(len<=bound)` 先拒超界纪律,
之前只在 `MarketScanProbe3.sil` 抽象探针里证过机制, **本文件的真实 `noTokenInput()` 实现之前没有专门补这三条
边界向量**——本次补齐, 均已用 flip-expect 复核真实失败行(不是巧合通过)：

| 向量 | 验证点 | 真实失败行(flip-expect 复核) |
|---|---|---|
| `V-{close,cancel}_attest-3_fail_at_bound_8_inputs_no_token_reaches_sig_gate` | 恰好=界(8 输入, 无代币) | `checkSig` 那行(签名门限), 证明界处仍是"干净放行", 不是被长度闸/noTokenInput 误伤 |
| `V-{close,cancel}_attest-4_fail_bound_plus_one_9_inputs_rejected_by_length_guard` | 界+1(9 输入, 无代币) | `require(tx.inputs.length <= MAX_INS_SCAN)`(noTokenInput 内, 长度闸本身), 隔离出纯粹是长度闸拦的 |
| `V-{close,cancel}_attest-5_fail_victim_token_at_last_reachable_index_7` | victim 代币在下标 7(8 输入内最后可达位置) | `require(noTokenInput())`(调用点), 证明循环真实展开到下标 7, 不是提前截断 |

## 三、T3 v0.4 增补（另提交）

Bettor 1145(d) 要求"V-T-8 绕路形"记入 T3 v0.4 增补稿一节——见后续单独 commit
（`docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.4.md`，含 RefundClaim 8 合约收口 + 本节）。
