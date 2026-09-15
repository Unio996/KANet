> **Status**: CURRENT

# 原型 v0 结算后半程设计 v0.1（封盘 → 委员裁决 → 赢家领奖 → 提现，含退款路径）

出处：Bettor 派工（账本1473–1475，Owner 已批准），在
`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md`（§2.4/§2.5/§2.6 业务级映射）与
`docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md`（§4/§5/§6 代码级精度）之上续写，
**只写设计，不写实现代码**（铁律0）。genesis/register_append 两段（market_genesis、下注）已落码并在
主网验证过（账本1462–1471），本文档只覆盖它们之后的部分：`convert_to_rootclose` → `close_commit` →
`convert_to_claim`/`convert_to_refundclaim` → `claim_draw`/`refund_payout` → `KanetTokenClaim.spend`。

D-021合规：本文档不写真实relay地址、真实账户余额、完整relay关联txid。审计过程中读取的真实market
a59c7b48/proto relay UTXO事实仅用于判断路线（A/B），具体数值见docs-private，本文档只引用结论。

---

## §0 Step-0 只读审计（先做、决定路线，不广播、不改任何生产状态）

### §0.1 方法论：为什么必须真执行，不能只读代码

账本1468（`ShardLeaf_direct.register_append`自续约偏移bug）连续4次没被现有测试抓到的根因，是
kaspa-wasm不导出脚本执行引擎——JS测试只能验证"构造出的值自己对不对得上自己"，从未真正执行过
`.sil`自己的`require()`链。唯一能在不广播前提下真实执行到这一层的工具是D-019/D-020系列已经确认过的
silverscript `cli-debugger`。本轮审计用的是**登记pin的构建**：
`D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe`（sha256 `b85bb524d22ae7611…`，
Bettor 1472已用它复核过账本1469的`own_redeem_len`修复，6/6 PASS）。

**关键纪律（账本1468教训的直接应用）**：cli-debugger对`.test.json`里某个输入，如果显式给了
`signature_script_hex`，就会用【我们自己构造】的字节，绕开它自己内部的见证合成逻辑；如果不给，
它会自己合成一份"看起来合理"的见证——后者曾经巧合地掩盖过账本1468那个bug整整4次（因为debugger自己
合成的见证很短，恰好让"从字节0切"这种错误偏移碰巧算对）。**本轮审计因此对每一个被检查的入口，
逐输入显式构造真实形状的sigScript**（`action_bytes ++ pushdata(redeem_bytes)`，action部分用真实ABI
编码——见§0.2，witness参数用真实协议常量而非短占位）。

### §0.2 新增工具：通用entry witness ABI编码器（`kasia-console/scripts/audit/`，仅审计用，未进`src/lib`）

`register_append`已有专用编码器`proto-tx-assembly-witness.mjs`/`proto-register-append-witness.mjs`
（账本1425/1431确认过与D-019 pin `silverscript-abi/src/lib.rs`的`encode_entry_sig_script`
逐字节一致）。本轮为审计`close_commit`/`convert_to_claim`/`claim_draw`/`refund_payout`等新入口，写了
一个**通用**版本（`kasia-console/scripts/audit/generic-entry-witness.mjs`）：直接读
`compileSilV100(...)._raw.contracts[C].entries[E].params`（真实编译产物的参数类型声明），按
D-019 pin源码`silverscript-abi/src/lib.rs:904-946 push_sig_arg`逐类型分派：

| ABI类型(`type.kind`) | 编码 |
|---|---|
| `int`/`temporal` | `add_i64` |
| `bool` | `add_i64(0/1)` |
| `byte` | `add_data([b])` |
| `bytes`/`text` | `add_data(原始字节)` |
| `pubkey` | `add_data(定长32B)` |
| `sig` | `add_data(定长**65B**——不是64B, 源码`push_fixed_bytes(...,65)`确认, 64字节schnorr签名+1字节sighash标志) |
| `datasig` | `add_data(定长64B)` |
| `fixed_bytes{len}` | `add_data(定长len B)` |
| `fixed_array`/`dynamic_array`(非struct元素) | 每个元素按`encode_fixed_payload`拼接成一段**无长度前缀**的字节块, **整体一次性**`add_data`推(不是逐元素多次push——`siblings: byte[32][]`一个depth-1证明只有1个元素时, 这段payload就是那一个元素的裸32字节) |

全部param推完后，追加一次`add_data(dispatch_tag)`（4字节）。**自检**：用这个通用编码器对
`register_append`的10个参数重新编码一遍，与已验证过的专用编码器逐字节比对——**PASS，完全一致**
（`00_self_check_generic_encoder.mjs`），因此信任它用于本轮新入口的审计。

### §0.3 逐合约架构性发现（先看这节，再看下方逐入口结论——这节解释了"为什么某些入口天生安全、
某些天生危险"，是整个路线判断的理论基础）

读D-019 pin源码`silverscript-lang/src/compiler/compile/state.rs:140-222`（`readInputStateWithTemplate`
的编译期codegen）逐字节确认：这个内建函数在编译期生成的字节码，对**任意输入**（不只是"自己"）算
"这个输入的redeem脚本从哪里开始"时，用的公式是：

```
bytecode_size = template_prefix_len + encoded_state_len + template_suffix_len
bytecode_base = input_sigscript_len(input_idx) - bytecode_size   // 从sigScript【末尾】往回算
```

**这个公式天然正确、不受前置字节（action witness）长度影响**——不管`tx.inputs[idx].sigScript`前面
垫了多少字节的entry调用参数，只要从末尾数`bytecode_size`个字节，就精确落在redeem脚本自己的
prefix+state+suffix区间。这正是账本1468里`register_append`修复后采用的公式（`ownLen - own_redeem_len`），
也是`convert_to_claim`/`convert_to_refundclaim`/`scanOwnedTokenInputs`/`noTokenInput`等**所有通过
内建函数读取"其它输入"状态的地方，结构上天然安全，不需要额外验证**的原因。

**危险只出现在一种特定组合**：同一个entry内，**同时**调用`readInputStateWithTemplate`系(经
`scanOwnedTokenInputs`等)**并且**需要对**自己**（`this.activeInputIndex`）做state续约时——这个组合
会触发一个已知的编译器/解释器运行期崩溃（V-T-8, `-N cannot be used as an array index`, NWT此前3次
独立实验未能钉死确切成因），逼着开发者绕开内建的`validateOutputState`，改成手写"从`ownSig`里切出
prefix/suffix、拼新state、算hash、比对scriptPubKey"这种AB11手写等价形式。**这段手写代码如果用
`ownSig.slice(0, ...)`（从字节0切，隐含假设action witness=0字节）而不是`ownSig.slice(ownLen-真实
redeem长度, ...)`（从末尾往回算，同内建公式一致），就会复现账本1468那个bug**——因为真实action
witness几乎从不是0字节（协议常量`tok_suffix`/`claim_suffix`等模板尾部动辄几百到上万字节）。

**没有这个组合的entry天然安全**：`RootClose.close_commit`/`refund_flip`只调用`noTokenInput`
（纯sigScript后缀匹配，不调`readInputStateWithTemplate`）+ 内建`validateOutputState`——不触发
V-T-8，可以放心用内建函数，编译器在**编译期自己**做不动点收敛算出自己的字节码长度（这正是账本1469
`convergeShardLeafOwnRedeemLen`在JS侧要手动做的事——对这些entry，silverc自己在Rust里已经做好了，
不需要JS侧操心）。`ShardLeaf_direct.convert_to_rootclose`/`RootClose.convert_to_claim`/
`convert_to_refundclaim`只做外部模板校验（去往RootClose/RootClaim/RefundClaim，不是"自己"续约），
同样不触发。

### §0.4 逐入口结论表（v0.2 更新：每条标注交易version/编码器commit/debugger sha256——账本1479 Bettor要求）

**公共基线**（除非表格里单独标注差异，每一行都是这个基线）：交易`version=1`；ABI编码器
`kasia-console/scripts/audit/generic-entry-witness.mjs`修复后版本，commit `449745f4`（修复"drain()
返回hex字符串被当UTF-8文本二次编码"这个bug之前的任何结果一律作废、不采信，见§0.9）；debugger二进制
D-019 pin `3ed9733`，sha256 `b85bb524d22ae761150dcb80b070f0bf1beb95a1c6604470501883b4d0f552c6`。

**分类（Bettor账本1479口径）**：PASS = `convert_to_rootclose`、`convert_to_claim`、
`convert_to_refundclaim`、`claim_draw`(full分支)、`refund_flip`、`refund_payout`(full/partial分支)；
FAIL（真实缺陷，非harness伪影）= `claim_draw`(partial分支)；待定 = `close_commit`、
`KanetTokenClaim.spend`。

| 入口 | 组合 | 结论 | 真实执行证据（version/编码器commit/debugger sha256均为公共基线，仅标注差异） |
|---|---|---|---|
| `ShardLeaf_direct.register_append` | readInputStateWithTemplate + 自续约(AB11) | ✅ **已修复**(账本1468/1469: ctor烤入`own_redeem_len`+JS不动点收敛) | ✅ **PASS 6/6**（账本1469④，`verify-run-1469-ctor-matrix.log`；用的是`register_append`专用编码器`proto-register-append-witness.mjs`，不是本轮`generic-entry-witness.mjs`，该专用编码器从未有双重hex编码bug，不受449745f4影响） |
| `ShardLeaf_direct.convert_to_rootclose` | 只有`scanOwnedTokenInputs`(读, 无自续约) | ✅ **安全** | ✅ **PASS**（NWT用`generic-entry-witness.mjs`测得——**编码器版本已由NWT自证为449745f4修复后版本**：她重跑后mass从113,105/61,777/60,473变为38,926/27,122/26,796，约减半，与"去掉双重编码后见证字节变回真实长度一半"的预期吻合；若仍是旧bug编码器，两次跑出的garbage字节长度会完全相同，不会系统性减半——这是比对时间戳更硬的证据，采信） |
| `RootClose.refund_flip` | 只有`noTokenInput`(不读state) + 内建`validateOutputState` + CLTV | ✅ **安全** | ✅ **PASS**（`06_audit_rootclose_refund_flip.mjs`，我方跑，公共基线）——初次FAIL是harness用法错误(test.json的`lock_time`字段必须嵌在`tx`对象内部, 不是顶层, 见§0.10) |
| `RootClose.close_commit` | 同上 + 5次`checkSig`(唯一涉及真实签名的入口) | 🟡 **待定** | ❌ **FAIL（卡在`validSigs>=4`），根因未100%钉死**——`07_audit_rootclose_close_commit.mjs`，公共基线。已排除sig_op_count/computeBudget（读consensus源码确认version>=1时该字段完全不参与sighash）与kaspa-wasm `createInputSignature`独立实现（确认调用同一`calc_schnorr_signature_hash`）两个候选。NWT用eprintln patch新查到：debugger内部实际验证用的`active_sigscript`只有**3,618字节**，我方构造喂给它的是**20,423字节**——量级差5.6倍，不像单一字段错位，更像main.rs:983那条重建路径对"5个sig类型参数+大redeem脚本"这种复杂entry整体没重建对，已报Bettor定夺是否精细patch定位还是先记harness缺陷。已交NWT接手（§0.10），本文档不再推进 |
| `RootClose.convert_to_claim`/`convert_to_refundclaim` | `scanOwnedTokenInputs`(读) + 外部模板(非自续约) | ✅ **安全** | ✅ **PASS**（NWT测得，同convert_to_rootclose一行的编码器版本证据，采信） |
| **`RootClaim.claim_draw`(payout==pool_value, 无续约分支)** | 无自续约, 只读ticket/token | ✅ **安全** | ✅ **PASS**（`01_audit_rootclaim_claim_draw.mjs`，公共基线，16参数全部真实ABI编码、真实协议常量尺寸、active input显式`signature_script_hex`，见§0.5①） |
| **`RootClaim.claim_draw`(payout<pool_value, partial续约分支)** | `readInputStateWithTemplate`(读ticket+token) + **手写AB11自续约, `ownSig.slice(0, OWN_PREFIX_LEN)`** | 🔴 **确认真实缺陷**（同账本1468同类defect） | ❌ **FAIL（符合预期）**——`01_audit_rootclaim_claim_draw.mjs`，公共基线。诚实backend按"正确offset"（即`register_append`已修复的`ownLen-own_redeem_len`手法）构造出的续约输出，被合约自己的错误自检拒绝：`error: script ran, but verification failed`精确命中`ownSig.slice(...)`那一行`require`（§0.5②）。用449745f4修复后编码器复测，结论不变——不是编码bug的假象，是真实合约缺陷 |
| `RefundClaim.refund_payout`(pool_value==stake, 无续约分支) | 无自续约 | ✅ **安全** | ✅ **PASS**（`03_audit_refundclaim_refund_payout.mjs`，公共基线） |
| **`RefundClaim.refund_payout`(pool_value≠stake, partial续约分支)** | `readInputStateWithTemplate`(读ticket+token) + **内建`validateOutputState`(自续约)** | ✅ **安全** | ✅ **PASS**（`03_audit_refundclaim_refund_payout.mjs`，公共基线——首次报告曾误判raw/state模式不一致，根因是审计脚本自身的双重hex编码bug，已用449745f4修复重跑确认，见§0.9自我纠错记录） |
| `KanetTokenClaim.spend` | 无自续约(终态, 头注明确"不受V-T-8影响") | 🟡 **待定** | ⚪ **本轮未真实执行**——现有证据（源码逐行核对+`docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/`）是**代币化重写之前的旧版本合约**（§0.6已证：那份夹具的`claim_draw`只有9参数、无`tok_prefix`等4个v0.3才加的witness参数，与当前16参数活跃版本不是同一份合约），不能直接采信为当前版本的结论。需要补一条针对当前`KanetTokenClaim.sil`的真实cli-debugger向量，本文档不代为担保"安全" |

**mass（真实KIP-9 storage mass，block限500,000，NWT用449745f4修复后编码器测得，公共基线，非估算）**：
`claim_draw`(A路线full分支) ≈ **331,580**（margin约34%，比预想更紧，不是随便留出来的余量）；
`convert_to_rootclose`/`convert_to_claim`/`convert_to_refundclaim` ≈ **38,926 / 27,122 / 26,796**
（NWT重跑后的修复后数字，见上表证据栏说明）。其余入口（`close_commit`/`refund_flip`/
`refund_payout`full+partial）的真实mass尚未测得，NWT`nwt_05_mass_check.mjs`此前撞到
`kaspa.TransactionOutput`需要真实`ScriptPublicKey`实例（不能传plain object）这个构造错误，已告知修法，
此处暂缺数字，不臆造。

### §0.5 独立复现`claim_draw`两个分支（工具问题已解决，真实执行完成）

构造真实完整的`claim_draw`夹具（16参数全部真实ABI编码 + ticket/token读取 + claimOutIdx/tokenOutIdx
新建输出的真实模板）过程中，一开始给active input显式提供`signature_script_hex`（绕开cli-debugger自己
的见证合成，正是本轮审计要的效果）时稳定报`WrongGenesisCovenantId(0, <hash>)`——读rusty-kaspa源码
（`crypto/txscript/src/covenants.rs:140-158`）查明根因：这不是对active input本身的校验，是对**每个
声明了`CovenantBinding`但其授权输入(`authorizing_input`)当前并不携带同一个covenant_id的输出**
（即"genesis类"输出，区别于"续约类"）的一致性检查——`covenant_id`必须等于
`covenant_id(授权输入的previous_outpoint, [(该输出index, 该输出)])`这个纯函数的真实结果，不能是
任意选的值；且**每个输出各自单独成组**（不能像我最初误做的那样，把`claimOutIdx`和`tokenOutIdx`两个
不同的新建covenant实例填成同一个`covenant_id`——那会被debugger当成"这两个输出属于同一个genesis组"
一起重算hash，对不上）。用`kaspa.covenantId(...)`（production代码`shardLeafCovId`/register_append
`mergedKttCovId`同款纯函数）对`claimOutIdx`/`tokenOutIdx`/`remainTokenOutIdx`三个新建输出**各自独立**
重算后，工具问题解决，三个场景全部真实跑通：

1. **full（payout==pool_value，无续约）**：`argsByName`按16个真实entry参数构造，`tok_prefix`/
   `tok_suffix`用真实`KanetTestToken`协议常量，`claim_prefix`/`claim_suffix`用真实`KanetTokenClaim`
   协议常量（均来自`proto-v0-template-anchors.json`，非短占位）——**✅ PASS**。
2. **partial（payout<pool_value，触发自续约），用"正确offset"（`ownLen-真实redeem长度`，同
   `register_append`已修复手法）构造续约输出**——**❌ FAIL**，报错精确命中
   `RootClaim.sil:198 require(tx.outputs[rootOutIdx].scriptPubKey == byte[](expectedSpk))`，
   与账本1468"script ran, but verification failed"完全同型。**这是本轮审计最核心的真实执行确诊
   结果**：一笔诚实backend若照抄已经修复过的`register_append`手法构造出来的续约交易，会被
   `RootClaim.claim_draw`自己的错误自检拒绝。
3. **partial，尝试手工复刻合约内部会算出的"bug offset"值（从完整sigScript字节0切）**——同样
   **❌ FAIL**，说明我方对"合约内部具体如何用错误offset"这一步的手工复现还有某个未对齐的字节细节
   （不影响②的结论——②已经独立、充分地证明"正确构造被拒绝"这一核心事实，不需要额外证明"我们能精确
   猜中它内部算出的错误值是什么"）。

运行记录：`kasia-console/scripts/audit/rootclaim-claim_draw-audit-run.log`。夹具/工具
留在`kasia-console/scripts/audit/`供NWT复核复用（`generic-entry-witness.mjs`已对`register_append`专用编码器逐字节自检过；
`01_audit_rootclaim_claim_draw.mjs`是完整可运行脚本，非半成品）。

### §0.6 一条独立的、不需要真执行就能确认的发现：既有"PASS"证据是过期夹具

`docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/`（`RootClaim.run.log`: 4/4 PASS，含
`DD-RC-claim_draw-2_pass_partial_with_continuation`）**看起来**已经验证过partial续约分支——**逐字节
diff该目录下的`RootClaim.sil`与当前主网活跃版本，发现两者根本不是同一份合约**：那份夹具测的
`claim_draw`只有**9个参数**（`rootOutIdx, payoutOutIdx, payout, merkle_index, tree_depth, siblings,
ticketInIdx, ticket_prefix_len, ticket_suffix_len`），派彩目的地是裸`ScriptPubKeyP2PK`，**完全没有
`tok_prefix`/`tok_suffix`/`claim_prefix`/`claim_suffix`这4个v0.3代币化改造才加入的witness参数**，
也没有`TokenState`/`ClaimState`读写——这是**代币化重写之前**的旧版本。当前活跃的`RootClaim.sil`是
16参数、代币化后的版本，action witness里必然包含那4个协议常量级别长度的字节块（真实尺寸参考：
`register_append`真实场景下`tok_suffix`单一字段就有3164字节）——**旧夹具的action witness短得多，
不能证明现在这份16参数、真实长action witness的合约能通过同一段AB11自续约代码**。这正是账本1468里
"唯一一次PASS的V-register_append-1夹具是代币化改造前的短见证, D-020后witness变长这份夹具从未更新
重跑"那个教训的**第二次独立发生**——只是这次是"发现"而不是"事故"，因为是本轮审计主动去查证据链、
而不是等主网广播失败才回头查。**结论：这条"4/4 PASS"证据对当前合约不适用，不能作为"claim_draw
partial分支已验证安全"的依据**——这个判断独立于§0.5的真实执行结果，是纯粹的文件对比事实（且两者
结论一致：旧夹具证据过期 + 新真实执行确诊defect，双重印证同一个结论）。

### §0.7 路线判断（A/B，二选一，由Owner定，本文档不擅自选；v0.2按Bettor账本1479校正）

背景：市场`a59c7b48`已在主网betting，`count=1`（一笔下注），`seal_count=2`。

**(A) 路线（救`a59c7b48`这个活市场）——第二笔下注必须押"另一方"（NO），不是同一方。** 这是对
v0.1初版的**校正**：`claim_draw`按ticket领奖，若两笔下注押同一方，会产生两张赢票，每张各自
`payout < pool_value`（pool按两张ticket的份额拆分），**必然触发partial续约分支**——这正是§0.5②
确认的真实缺陷所在，(A)路线不能这样构造。可行的(A)构造是：第二笔押相反方（NO），委员裁决YES，
形成"唯一赢家、一次性`payout==pool_value`"的full分支闭环——`close_commit`/`convert_to_claim`/
`claim_draw`(无续约分支)/`KanetTokenClaim.spend`全部结构性安全（§0.4表），不需要碰任何`.sil`文件，
不需要放弃`a59c7b48`。

**(B) 路线（供新市场）**：用账本1469同款ctor烤入`own_redeem_len`+JS不动点收敛手法，修复
`RootClaim.claim_draw`partial分支（§0.5已用真实cli-debugger确诊defect，§0.8给出具体设计），修复后
需要真实cli-debugger PASS（§0.5的夹具/方法论已经现成）；`RefundClaim.refund_payout`已确认安全
（§0.9，真实执行PASS，两个分支都过），走(B)时只需处理`RootClaim.sil`本身。**任何修改
`RootClaim.sil`/`RefundClaim.sil`都会改变`claim_tmpl_hash`/`refundclaim_tmpl_hash`——这两个值已经
烤进`a59c7b48`的`RootClose`（其`rootclose_tmpl_hash`又已经烤进`ShardLeaf_direct`本身）——`a59c7b48`
这个市场的leaf P2SH地址绑死在旧字节上，修复不能救它**（同账本1471NWT独立证实的"合约改动与既有市场
P2SH脱钩"结论，机制完全一致）。**走(B)意味着`a59c7b48`必须放弃，用修复后的代码重新genesis一个新
市场**——0.2 KAS genesis fee + 已下注的部分本金（若走cancel/refund路径能拿回代币本身，但genesis fee
与leaf dust不可回收，同账本1468④对旧市场的处置结论）。

**(A)(B)不互斥**：(A)是救活既有市场`a59c7b48`的短期路径，(B)是修复合约供未来新市场用的长期路径，
两者可以同时推进，不是二选一放弃另一个。

**🔴 两条路线均依赖`close_commit`结论出来，在此之前都不能真正落地**：`close_commit`是resolve的
必经环节（委员宣布结果），(A)需要它完成"裁决YES"这一步，(B)修复`RootClaim.claim_draw`后的新市场
同样需要`close_commit`能正常工作才能走到claim那一步——§0.10/§0.4已确认`close_commit`真实签名验证
**当前仍FAIL**，根因未钉死，已交NWT接手。**在NWT给出`close_commit`是"harness伪影"还是"真实合约
缺陷"这个结论之前，(A)(B)两条路线都只是"设计已就绪、尚不能执行"的状态，不是"可以立即执行"**。

**本文档建议（仅供参考，不代Owner决定）**：先问清楚v0的业务规则是否要求支持"同一市场2个不同payout
赢家各自claim"——如果产品意图上v0本来就是"赢家通吃、一次性全额claim"（parimutuel常见简化：所有赢家
份额加总一次性发放，不是每人各自单独一笔`claim_draw`），那(A)路线不仅能救`a59c7b48`，也从根本上让
`RootClaim.sil`/`RefundClaim.sil`这两个未决风险在v0阶段永远不会被触发，把"要不要修`.sil`"这个决策
推迟到真正需要多赢家分别claim的那一刻——性质上等同于账本1471的`T-PROTO-LEAF-ARTIFACT-VERSIONING`
观察票（问题真实存在, 但触发条件是"未来需要", 不是"现在必须"）。

### §0.8 若走(B)：`RootClaim.claim_draw`的修复设计（预案，不实现，仅供Owner选(B)后直接执行）

与账本1469`ShardLeaf_direct.register_append`完全同构的手法，六点对应：

1. `RootClaim.sil`：新增ctor参数`int own_redeem_len`（第13个字段，接在`init_claimed_bitmap`/
   `token_tmpl_hash`/`claim_tmpl_hash`之后）；partial分支`ownSig.slice(0, OWN_PREFIX_LEN)`改成
   `ownSig.slice(ownLen - own_redeem_len, ownLen - own_redeem_len + OWN_PREFIX_LEN)`（`OWN_STATE_LEN=96`
   偏移同理平移）。
2. JS侧新增`convergeRootClaimOwnRedeemLen`（同`convergeShardLeafOwnRedeemLen`手法：编译→量长度→
   以此值再编→直到稳定，≤4轮不收敛throw）——但RootClaim的编译产物长度是否也会像`ShardLeaf_direct`
   那样随ctor int字段（这里没有`seal_count`/`min_bet`这类字段，ctor里的int只有state字段，账本1468
   矩阵已证state字段不影响长度）变化，**需要针对RootClaim自己的ctor形状重新跑一次矩阵测试**（不能
   直接假设"同ShardLeaf_direct"，`shard_pool_id`这类byte[32]字段本身定长不会变，但仍要实测确认）。
3. fail-closed双闸：genesis侧（`RootClose.convert_to_claim`创建RootClaim那一刻）与`claim_draw`
   partial分支重建时都断言"真实编译长度==ctor里的own_redeem_len"。
4. 回归：`RootClaim.claim_draw`需要覆盖 full(无续约)/partial(有续约，正确offset)两种场景，各自真实
   cli-debugger PASS——§0.5已经给出full场景PASS、partial场景（修复前）FAIL的确诊结果，修复后需要
   partial场景反转为PASS，用同一套夹具改`own_redeem_len`偏移即可验证，不需要重新设计验证方法论。
5. 同步：`RootClose.sil`调用`convert_to_claim`时ctor里`claim_tmpl_hash`的来源（当前是协议常量，
   一次性算好）需要改成**逐市场现算**（因为`own_redeem_len`使`RootClaim`的编译产物不再是"纯协议常量、
   全市场复用"——这与`docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md` §7
   `T-PROTO-TEMPLATE-CONST-ASSUMPTION-CORRECTED`已经记录的"`claim_tmpl_hash`/`refundclaim_tmpl_hash`
   本来就因为`shard_pool_id`逐市场字段而不是真正协议常量"这条既有认知完全吻合，不是新增的复杂度，
   只是把"需要逐市场现算"的理由从"`shard_pool_id`不同"扩展到"再加上`own_redeem_len`也不同"）。
6. `RefundClaim.sil`已确认安全（§0.9），不需要修改。

### §0.9 `RefundClaim.refund_payout`的V-T-8开放问题——已真实执行, 结论正面(自我纠错记录见下)

**Bettor 1476明确要求补跑，已完成**（`kasia-console/scripts/audit/03_audit_refundclaim
_refund_payout.mjs`）：

- **full分支（pool_value==stake，无续约）**：**✅ PASS**。
- **partial分支（pool_value≠stake，`readInputStateWithTemplate`+内建`validateOutputState`同函数
  共存——即RootClaim.sil头注点名"一律AB11+实测"要求回避、但RefundClaim.sil未回避的那个组合）**：
  用真实ABI编码action witness、显式给active input传`signature_script_hex`（同§0.5对`RootClaim
  .claim_draw`的方法）——**✅ PASS**，无任何崩溃迹象（无rust panic/`-N cannot be used as an array
  index`一类特征文本）。

**结论：这个具体组合不触发V-T-8，`RefundClaim.sil`当前代码可以安全用于partial退款**——`RootClaim
.sil`头注那条"一律AB11+实测"的纪律，对这个具体的`readInputStateWithTemplate`+`validateOutputState`
组合不适用（或者说这个组合恰好不落在V-T-8的真实触发条件里，与NWT既有调查"V-T-8触发条件比'任意共存'
更窄"的认知一致）。

> 📌 **自我纠错记录（不回避，同§0.6"过期夹具"是同一类"必须诚实记录"的纪律）**：本节最初版本（首次
> 提交给Bettor/NWT时）报的是"raw模式FAIL、state模式PASS，两者不一致，根因未查清"——**这个报告是
> 错的，根因是我自己的审计工具`generic-entry-witness.mjs`有一个双重hex编码bug**：
> `kaspa.ScriptBuilder.drain()`返回的是**hex字符串**（不是字节，已用`typeof`实测确认），但该文件
> 把返回值又套了一层`Buffer.from(...)`——这会把hex字符串（比如`"55"`）当UTF8文本编码成
> `[0x35,0x35]`而不是解码成真正的字节`[0x55]`，导致这个通用编码器产出的每一条action witness全部是
> 双重编码的垃圾字节。**更隐蔽的是：`00_self_check_generic_encoder.mjs`这条自检当时是"假阳性
> PASS"**——它拿这份垃圾去跟`register_append`专用编码器的输出比对，但比对代码同样对两边都套了
> `Buffer.from(...)`，两边用**同一种错误方式**变形后仍然逐字节相同，"自检通过"掩盖了问题，这正是
> 账本1468"两边都用同一套错误假设、互相印证出一个假PASS"那类教训的**变体**——只是这次错的是我自己
> 的审计工具，不是被测的生产合约。
>
> **发现过程**：Bettor给出关键线索（上游`silverscript#253`，pin 3ed9733仍OPEN——active input的
> `signature_script_hex`只进tx组装供introspection用，真正驱动执行结果的`active_sigscript`在
> `debugger/cli/src/main.rs:893-909`始终由`function`/`args`独立重建，两者raw模式下可能是两份不同
> 字节）。为了验证这条线索是否是根因，在`/d/silverscript`（独立新开的临时worktree，同pin commit
> `3ed9733`，不碰生产pin那份干净worktree）加了一行`eprintln!`把`active_sigscript`真实转储出来
> （同账本1431"读不出来就在debugger源码上加eprintln patch, 逐字节比对"的既有先例），重编译后跑一遍
> 我的audit脚本，转储出的字节长度只有我自己`action`变量长度的**一半**（4340 vs 8680）——直接坐实
> "我的action是双重编码, 长度多了一倍"这个假设，而不是Bettor线索指向的那个上游issue（那个issue可能
> 依然真实存在，只是不是这次具体现象的根因——两件事互相独立，issue #253本身仍值得NWT在其它场景留意，
> 只是这次的锅在我自己）。
>
> **修复**：`generic-entry-witness.mjs`的`encodeEntryActionGeneric`改为直接返回`b.drain()`的hex
> 字符串（不转Buffer）；`combineActionAndRedeem`改为接收hex字符串（而不是字节）传给
> `kaspa.ScriptBuilder.fromScript(...)`（该函数本身就要hex字符串，之前传字节也是错的），只在最终
> 交付调用方时才用`Buffer.from(hex, 'hex')`正确解码成真实字节。修复后重新跑：
> 1. **`00_self_check_generic_encoder.mjs`**（改为直接比较两个hex字符串，不再经过Buffer）——
>    **真PASS**。
> 2. **`RefundClaim.refund_payout`两个场景**——full/partial均**PASS**（本节当前结论，raw/state
>    差异消失，因为两者本来就该一致——之前的"不一致"是我自己的编码bug造成的假象，不是debugger
>    tooling issue，也不是合约缺陷）。
> 3. **`RootClaim.claim_draw`三个场景（§0.5）用修复后的编码器重新跑，结论不变**：①full PASS、
>    ②partial-正确offset FAIL、③partial-bug offset FAIL——**这条交叉验证很重要**：如果§0.5的
>    "确认defect"结论是编码bug造出来的假象，修复编码器后①②的结论应该会变，但没有变，说明§0.5的
>    发现是真实的、不依赖这个已修复的编码bug。

**给Owner/NWT的现状（已更新，不再是开放问题）**：`RefundClaim.refund_payout`的partial续约分支
**结构性安全**，走(A)或(B)都不受这条影响；(B)路线只需要处理`RootClaim.sil`（§0.8），不需要再改
`RefundClaim.sil`。上游`silverscript#253`若NWT有余力仍可独立跟进（不影响本文档任何结论）。

### §0.10 `RootClose.refund_flip`/`close_commit`真实执行（账本1479 Bettor派活，NWT并行审全部6入口）

**`refund_flip`：harness用法错误，已修复，确认安全**——`entry refund_flip(rootOutIdx, tok_prefix,
tok_suffix)`不涉及签名（只有`noTokenInput`+内建`validateOutputState`+CLTV）。首次真实执行FAIL报
`Unsatisfied lock time`——排查发现是**我自己的test.json写错了字段位置**：cli-debugger的`lock_time`
字段必须嵌在`tx`对象**内部**（`tx.lock_time`），我最初写在顶层（与`tx`同级），debugger读到的locktime
恒为0。挪进`tx`对象后**立即PASS**，无其它问题。**这是本轮发现的第3处审计工具/harness用法坑**（前两处
是账本1473的双重hex编码bug）——NWT此前报告"refund_flip未过"极可能是同一类错误，不是合约缺陷。

**`close_commit`：真实签名验证未通过，已排除多个候选根因，仍未100%钉死**——`entry close_commit`是
本轮唯一需要真实`checkSig`（committee 4-of-5签名）验证的入口。构造真实`kaspa.Transaction`签名（用
`kaspa.createInputSignature(tx, 0, priv, SighashType.All)`）并喂给cli-debugger，**卡在
`require(validSigs >= 4)`**（`committee_hash`校验、CLTV、`noTokenInput`等更早的检查全部通过，说明
构造的其它部分是对的）。已用真实eprintln转储（同§0.5/账本1431先例）+ **直接读D-019 pin对应的
`rusty-kaspa a41a333b08848f41bf737b72592e463a6011b8ac`真实源码**（不是猜测），排除了以下候选：

1. **`version`/`lock_time`/`sequence`/UTXO amount+scriptPubKey/输出value+scriptPubKey**——逐字段
   eprintln转储debugger内部真实构造的`kas_tx`，与我自己签名用的`unsignedTx`**逐字节比对完全一致**
   （比对过程顺带抓出**第4处harness/工具坑**：我给debugger的`output[0]`用了
   `Buffer.from(placeholderOutSpk.script)`——`kaspa.ScriptPublicKey.script`同样是hex字符串而非字节
   ，同一类双重编码错误，已修复；修复后output[0]确认与签名tx一致，但close_commit依然FAIL，说明
   这不是唯一根因）。
2. **`sig_op_count`/`computeBudget`（compute_commit字段）**——直接读
   `consensus/core/src/hashing/sighash.rs::calc_schnorr_signature_hash`源码逐行确认：
   `if tx.version < 1 { ...sig_op_counts_hash... }`——**这个字段对version>=1交易的sighash完全没有
   影响**（v1时这两处相关hasher调用被跳过, 不管填什么值都不改变sighash）。之前怀疑debugger内部
   `SigopCount(...).into()`固定构造`ComputeCommit::SigopCount`变体（不感知version, 源码
   `impl From<SigopCount> for ComputeCommit`确认无条件转换）会导致v1语义不一致——**这个怀疑本身
   成立（这是真实的debugger实现局限, 值得记录), 但因为v1根本不hash这个字段, 不是本次checkSig
   失败的原因**。
3. **kaspa-wasm的`createInputSignature`是否有v1专属的sighash bug**（Bettor派活里明确提出的候选，
   出处"kaspa-wasm对version 1交易的支持有已知TODO"）——直接读`consensus/wasm/src/utils.rs`源码确认
   `createInputSignature`内部**直接调用**`kaspa_consensus_core::hashing::sighash::
   calc_schnorr_signature_hash`（与debugger内部用的是同一个函数、同一个crate、同一个pin commit），
   不是WASM独立实现的另一套逻辑——**排除"kaspa-wasm算错sighash"这个候选**。

**尚未排除、下一步该查的候选**（如实列出，不假装已经穷尽）：
- `previous_outputs_hash`/`sequences_hash`/`outputs_hash`是"对全部inputs/outputs聚合"的hash（不是
  只看active input一个），理论上我的tx只有1个input+2个output应该trivially一致，但没有做逐分量单独
  eprintln核对（只核对了最终字段值，没有核对这几个中间hash本身）——这是最应该补的下一步验证。
- `checkSig`在silverscript/kaspa-txscript里到底是`OpCheckSig`还是走了covenant专属的另一条校验路径
  （本合约在`covenants_enabled: true`的EngineFlags下执行，理论上`checkSig`应该是标准opcode，但没有
  直接读`kaspa-txscript`里`OpCheckSig`的具体实现代码来100%确认它调用的正是
  `calc_schnorr_signature_hash`而非某个covenant模式下的变体）。
- silverscript的ABI层是否在`sig`类型参数与`checkSig`之间有一次额外的字节转换（比如是否要求提交的
  65字节`sig`本身就是`schnorr_sig(64B)+sighash_type(1B)`，还是有其它打包约定）——`silverscript-abi`
  的`push_fixed_bytes(...,65)`只管"推65字节"，不关心这65字节内部语义，真正解释这65字节的是
  `kaspa-txscript`的`OpCheckSig`实现，同上一条一样没有直接读到那段代码确认。

**处置建议**：`close_commit`不影响(A)路线本身能不能做（(A)路线仍然需要`close_commit`——委员宣布
结果这一步是resolve的必经环节，不因为选(A)还是(B)而不同）——**这条FAIL如果反映的是真实的委员签名
构造问题，(A)(B)两条路线都会被挡住，是比"RootClaim/RefundClaim该不该修"更优先的阻塞项**。已把完整
工具链（真实签名构造脚本`07_audit_rootclose_close_commit.mjs`、eprintln patch后的debugger、逐字段
比对方法）留给NWT/后续会话接手，不需要从零开始——建议按上面"尚未排除的候选"清单顺序查，`checkSig`/
`OpCheckSig`的具体实现是当前最大的未知，需要真正读`kaspa-txscript`（不是`kaspa-consensus-core`）
对应的opcode执行代码。

**账本1482更新（NWT eprintln转储新发现）**：debugger内部实际验证用的`active_sigscript`长度只有
**3,618字节**，我方按真实ABI编码构造喂给它的是**20,423字节**——差5.6倍，量级上不像是某个单一字段
偏移错位（偏移错位通常只差几字节到几十字节），更像main.rs:983那条"从`signature_script_hex`重建
`active_sigscript`"的路径，对`close_commit`这种"5个`sig`类型参数+一份不小的redeem脚本"的复杂entry
形状，整体没重建对（比如可能漏算了某个循环/漏拼了某一段）。NWT已把这个新发现报给Bettor，待定夺是否
值得投入更细粒度的patch（分别dump redeem长度和witness长度两段来精确定位）还是先把这条计为
harness缺陷、开issue追踪。**根因调查此后归NWT接手（她用本文档`07_audit_rootclose_close_commit.mjs`
工具+账本1482新patch，从UTXO entries与sighash中间分量入手），本文档不再继续这条调查**。

### §0.11 MUST：结算builder的三条硬约束（账本1479 Bettor要求，写入设计，供NWT实现§1时直接遵守）

**MUST-1：`close_commit`/`refund_flip`的builder必须显式设置`lockTime`（毫秒时间戳），不能依赖
默认值。** 依据：§0.10发现`refund_flip`初次真实执行FAIL（`Unsatisfied lock time`）的根因不是合约
缺陷，而是test.json把`lock_time`字段写在了顶层（与`tx`同级）而不是`tx`对象内部，debugger读到的
locktime因此静默变成0，CLTV检查必然失败——**这个坑对生产builder同样成立**：`kaspa.Transaction`
构造函数的`lockTime`字段必须显式赋值为**毫秒时间戳**（不是DAA分数、不是秒），且必须放在
`Transaction`构造对象本身（不是某个嵌套子对象），否则会静默变成0导致CLTV永远视为"已过期"或
"从未过期"（取决于比较方向），这类静默默认值错误在生产环境里不会报错、只会让链上行为与预期不符
（同类"字段位置错→静默取默认值→无报错"模式已作为ANTI-PATTERNS候选写入，见附录）。

**MUST-2：封盘（`market_seal`/`convert_to_rootclose`）与`close_commit`必须背靠背提交，
`close_commit`的输入UTXO必须从封盘广播时暂存的`prepared_tx_json`派生，不能查链。** 依据：账本1478
已确认的路线A前提——"resolve前必须先确认赢方只有一张有效`payout`值需要落地"（§0.7）——要求封盘到
resolve这两步之间不能有任何时间窗口被第三方抢先花费RootClose那笔UTXO或让另一笔下注插进来打乱
`seal_count`/`count`的账目；即使没有恶意第三方，"广播后立即查链确认"这个动作本身在Kaspa的
DAG确认延迟下也可能读到还未着陆的旧状态，构造出的`close_commit`输入引用一个还不存在于虚拟链上的
UTXO会被拒绝或者引用错误的UTXO集合。正确做法：`market_seal`广播准备阶段已经产生的
`prepared_tx_json`（见`§2`的`prepared_action`/`proto_settlement_intents`表设计，字段
`prepared_txid`/`prepared_tx_json`）里已经包含了RootClose genesis输出的完整形状（scriptPubKey/
amount/covenant_id），`close_commit`的builder应该直接从这份JSON反推出它需要花费的UTXO
outpoint/amount/scriptPubKey，不经过任何RPC查询——这既避免了确认延迟的竞态，也避免了"链上查到的
UTXO形状和我们自己构造时假设的形状不一致"这类不可控的外部依赖。

**MUST-3：`refund_flip`不需要任何签名，deadline+2h后任何人都可以调用——这是设计已知的风险，
必须在执行页/文档里写清楚，不是遗漏。** 依据：§0.10已确认`RootClose.refund_flip`的入口签名只有
`noTokenInput`+内建`validateOutputState`+CLTV，**没有`checkSig`**——这意味着一旦CLTV设定的
deadline+2h宽限期过去，任何持有网络访问权限的人（不需要是委员、不需要是bettor、不需要任何私钥）
都可以构造一笔`refund_flip`交易并广播成功，把市场推进到"已退款"状态。这是**设计已知的风险**（`.sil`
头注本身就是这样设计的，可能是为了防止委员失联导致资金永久锁死的兜底机制），但对Owner而言这是一条
需要明确知道并接受的产品事实：**deadline+2h之后，市场的退款路径不再受任何权限控制**——具体
deadline/宽限期时长该设多久，以及要不要在这条路径上补一层委员签名，是产品选择，见§0.12列给
Owner的选项，本文档不代为决定。

### §0.12 给Owner的产品选项（本文档只列选项与各自防的损失，不替Owner选）

**选项组1：新市场的deadline / grace（宽限期）时长该设多久**

| 选项 | 防住的损失 | 代价/风险 |
|---|---|---|
| 短deadline+短grace（如24h+2h，接近当前主网市场的量级） | 资金被套住的时间短，委员失联时更快进入"任何人可refund_flip"的兜底状态，避免用户资金长期锁死 | grace窗口短，委员一旦真的短暂离线（网络故障、维护），更容易被外部人抢先触发refund_flip，即使委员随后就恢复也来不及裁决 |
| 长deadline+长grace（如7天+24h） | 给委员充分时间完成真实裁决，降低"委员只是暂时离线"却被外部人抢先refund的概率 | 用户资金被锁定的时间更长，如果委员真的永久失联（钥匙丢失/团队解散），用户要等更久才能拿回本金 |
| 中间值+可配置（每个市场genesis时由创建方自己指定deadline/grace，不写死协议常量） | 不同风险偏好的市场（小额测试市场 vs 大额市场）可以各自选适合自己的窗口，不用一刀切 | 增加ctor参数和实现复杂度，需要在市场genesis页面给创建方解释这两个数字的含义，用户理解成本更高 |

**选项组2：`refund_payout`是否需要委员签名**

| 选项 | 防住的损失 | 代价/风险 |
|---|---|---|
| 维持现状（`refund_payout`无需委员签名，任何持有正确ticket的bettor可在refund_flip之后自行退款） | 委员失联时用户仍能自主拿回本金，不需要等待任何第三方动作——这是refund路径存在的本意（兜底） | 如果`refund_flip`本身被抢先触发（MUST-3的风险），市场会在委员还没来得及裁决真实结果时就被推进到"退款"状态，所有下注者只拿回本金、赢家拿不到应得的赔付——这对"确实有一方真实赢了"的市场是一种资金错配（虽然不是资金被盗，但赢家的合理预期落空） |
| 加一层委员签名要求（`refund_payout`需要committee的`checkSig`，同`close_commit`的4-of-5模式） | 防止`refund_flip`被恶意/误触发后，资金立刻可以被任何人退款——即使`refund_flip`被抢先调用，真正的资金转移（`refund_payout`）仍需要委员参与，给委员一个"回来纠正"的窗口 | 需要修改`RefundClaim.sil`（新增签名校验逻辑），改变`refundclaim_tmpl_hash`，同(B)路线一样会让现有市场的P2SH地址脱钩，需要重新genesis；且如果委员是真的永久失联（不是暂时离线），加签名要求反而让用户连兜底退款都拿不到，退化成"资金永久锁死"，与refund路径设计初衷（防止委员失联导致资金永久锁死）自相矛盾 |

以上两组选项相互独立（deadline/grace时长的选择不影响是否给refund_payout加签名，反之亦然），
Owner可以分别决定；本文档不推荐任何一个具体选项，只列出已知的、真实执行验证过的技术事实
（§0.10/MUST-3）所决定的取舍空间。

## §1 每步交易形状（inputs/outputs/签名输入/covenant绑定/mass/fee）

沿用`covenant-construction-spec-v0.1.md`§1.4通则（fee input覆盖mass费+dust垫底、找零≥
`CONTINUATION_OUTPUT_SOMPI`或恰好0、`CovenantBinding`续约声明硬要求）与账本1462已落码的
`selectFeeUtxoByConstruction`选择器（按真实构造逐个尝试，非保守下界预筛）。以下按(A)路线（单次
`claim_draw`覆盖全部pool_value，不触发partial续约）给出交易形状；(B)路线的partial分支形状结构相同，
只是多一个`remainTokenOutIdx`/`rootOutIdx`续约输出对，mass/fee需要按(B)修复后的真实编译产物重新
估算（不在本文档预先给出数字，同§9.5"per-kind cap需要各自mass实验"的既有纪律，实现(B)前必须重跑）。

### §1.1 `market_seal`（`ShardLeaf_direct.convert_to_rootclose`，count==seal_count后单独触发）

- **输入**：`[leaf(ShardLeaf_direct, 当前UTXO), held_token(若count>1有合并代币), fee]`。
- **输出**：`[RootClose genesis(继承pool_value对应代币, KAS侧只剩dust), 代币转出到RootClose(owner=
  RootClose covenant id), fee找零]`。
- **签名输入**：只有fee input需要relay签名（`sign_input_indices=[feeIdx]`）；leaf/held_token输入
  靠自己的entry witness（`rc_prefix`/`rc_suffix`——市场genesis时已经烤进`ShardLeaf_direct`ctor的
  `rootclose_tmpl_hash`对应的**同一次**编译产物，不能重新编译一份不同ctor的RootClose再取前后段）。
- **CovenantBinding**：RootClose genesis输出走`populateGenesisCovenants`（同`market_genesis`
  `shardLeafCovId`手法，`kaspa.covenantId(fundingOutpoint, [{index, output}])`纯函数算出，无需上链
  查询）；代币转出输出是**genesis**（新KanetTestToken实例，owner=刚算出的RootClose covenant id），
  不是续约，不需要`CovenantBinding`（`CovenantBinding`只用于续约/自我延续，账本1465/spec §9.7已确认
  "续约类covenant输出"才需要，genesis类走`populateGenesisCovenants`）。
- **mass/fee**：与`register_append`同量级（两个covenant输入+两个covenant输出+一个fee input/找零），
  账本1462/1469已验证的`SIGNED_INPUT_CEILING_SOMPI`(1.0 KAS)/`GLOBAL_ABS_FEE_CAP_SOMPI`(1.0 KAS)两层
  防线沿用；per-kind cap（`CAP_MARKET_SEAL`）需要独立mass实验给出具体数字（同`CAP_MARKET_GENESIS`/
  `CAP_REGISTER_APPEND`已有的量测方法论，不能凭"看起来差不多"套用旧数字）。

### §1.2 `resolve`（`RootClose.close_commit`）

- **输入**：`[RootClose(当前UTXO), fee]`。
- **输出**：`[RootClose续约(closed:1, winningSide, payoutRoot——KAS侧只剩dust), fee找零]`。
- **签名输入**：fee input走relay签名；**committee witness签名**（`c0Sig..c4Sig`，5份，v0单keypair
  裁定下可以是同一个签名值填5遍，见`covenant-construction-spec-v0.1.md` §4的
  `T-PROTO-COMMITTEE-SIG-DISTINCTNESS`——**这条本文档不重复裁定，仍待落码时用cli-debugger离线向量
  核实"5个相同字节的sig是否被合约接受"**，属于§0之外、本文档范围内的第二个"需要实测才能关闭"的
  开放技术点，但风险等级远低于§0的两个——即使5个sig不能重复，只是需要真调用5次`createInputSignature`
  而不是复用同一次结果，不影响架构，纯粹是实现细节）。
- **CovenantBinding**：续约，需要`new CovenantBinding(0, rootCloseCovId)`（`authInputIdx=0`，即
  RootClose自己）。
- **new_payoutRoot计算**：见§4，不用`pool-payout-root.mjs`（depth-10，装不下depth-1约束）。

### §1.3 `convert_to_claim`（`RootClose.convert_to_claim`）+ `claim_draw`（`RootClaim.claim_draw`）

**两笔分开广播**（同`covenant-construction-spec-v0.1.md` §5"建议分两步更好排错"的既有裁定，本文档
维持）：

**Tx-A `convert_to_claim`**：
- 输入：`[RootClose(当前UTXO), 代币输入(owner=RootClose covenant id, amount=pool_value), fee]`。
- 输出：`[RootClaim genesis(7 State字段照抄+claimed_bitmap:0), 代币转给RootClaim(owner=RootClaim
  covenant id), fee找零]`。
- 签名：只有fee input（`convert_to_claim`没有委员签名要求——委员的裁决已经在`close_commit`那一步
  用签名锁定进`winningSide`/`payoutRoot`了，`convert_to_claim`只是照抄这些值搬到RootClaim，不需要
  重新授权）。

**Tx-B `claim_draw`**（(A)路线：`payout==pool_value`，无续约分支）：
- 输入：`[RootClaim(当前UTXO), 代币输入(owner=RootClaim covenant id), dust ticket(bettor自己那张,
  owner不重要——ticket本身就是花费凭证，spent即nullifier), fee]`。
- 输出：`[KanetTokenClaim genesis(market_cov_id=RootClaim自己的covenant id, winner_pk=ticket里的
  bettorPk, amount=payout), 代币转给新KanetTokenClaim(owner=该claim covenant id), fee找零]`
  ——**无RootClaim续约输出**（(A)路线`pool_value==payout`时代码走"不留root续约"分支，见RootClaim.sil
  行166-171注释"pool_value==payout⇒不留root续约"，这条本身是清白的、不涉及§0发现的bug，因为它根本
  不执行下面的自续约代码）。
- 签名：只有fee input——**ticket的花费需要`checkSig`吗？** 读`RootClaim.sil`源码：`claim_draw`只用
  `readInputStateWithTemplate`读ticket的State（`Tk{bettorPk,direction,stake,shardPoolId}`），**没有
  对ticket输入本身做任何签名校验**——这与`covenant-construction-spec-v0.1.md` §5"`ticketInIdx`…
  需要bettor签名"这句话**不一致**，需要NWT在实现前对照`PoolSideTicket.sil`自己的入场entry（如果
  它有`authorize_spend(sig)`要求）确认：ticket的"花费授权"到底是靠**ticket自己的entry require**
  （PoolSideTicket合约层面），还是像`covenant-construction-spec`原文假设的那样需要一个额外签名——
  这两种机制如果搞混，可能导致"以为有签名保护、实际没有"（同`T-PROTO-BETTORPK-BINDING`同族风险，
  本文档不代为下结论，标记为**待NWT核实的技术点**，不是新发现的漏洞，是既有文档表述与本次读到的
  源码之间的一处需要对齐的地方）。

### §1.4 `withdraw`（`KanetTokenClaim.spend`）

- 输入：`[KanetTokenClaim(当前UTXO), 代币输入(owner=本claim covenant id), fee]`。
- 输出：`[代币转出到目的地(to_market_input=false: 普通新genesis输出，owner=witness指定的任意值——
  v0场景赢家指定自己的一个新地址/新KTT实例作为"提现终点"), fee找零]`。
- 签名：`sig s`（赢家=committee keypair对`winner_pk`的签名，§1.2层②机制，console侧算好编码进entry
  witness）+ fee input relay签名。
- **无续约**（`KanetTokenClaim.spend`本身没有`validateOutputState`调用，头注已明确"花后不续约,
  不受V-T-8影响"）——是整条链路里唯一不需要§0那套自续约分析的入口。

### §1.5 退款路径对称形状

`refund_flip`（同`close_commit`形状，输出续约closed:2）→ `convert_to_refundclaim`（同
`convert_to_claim`形状，去往RefundClaim）→ `refund_payout`（同`claim_draw`形状，(A)路线下
`pool_value==tk.stake`走无续约分支；partial续约分支也已确认安全，见§0.9）→ `KanetTokenClaim.spend`
（复用§1.4，退款与领奖走同一个提现入口，这是设计上的一致性，不是额外工作）。

---

## §2 意图状态机与驱动接线

沿用`proto-market-intent.mjs`/`proto-bet-intent.mjs`已确立的`pending→prepared→submitted→
landed/ambiguous`模式，NO-TX-NO-STATE铁律（关键行必须在任何IPC之前落库），replay守卫按输入自身
地址核对（账本1468③已修复的口径，`kasia-relay/src/lib/transaction.mjs`的`replayPreparedTransactions`
现在按`inp.utxo.scriptPublicKey`派生地址分别查询，不假设所有外部输入共享同一个`senderAddress`——
本轮新增的covenant输入（RootClose/RootClaim/RefundClaim/KanetTokenClaim，都活在各自P2SH地址）天然
适配这个已修复的口径，不需要额外改动）。

**新表设计（提案，未落码，需Bettor/NWT审）**：不再对每个新动作重复"proto_markets加6个inline列"
（genesis已经这样做了）或"每个动作开一张新表"（proto_bet_intents只为register_append开）这两种模式
——本文档提议一张**通用**表`proto_settlement_intents`，覆盖`market_seal`/`resolve`/`cancel_refund`
（market级，一个市场最多各发生一次）与`convert_to_claim`/`claim_draw`/`convert_to_refundclaim`/
`refund_payout`/`withdraw`（claim级，一个市场可能有多个claim行，每个claim各自的这5步）：

```sql
CREATE TABLE proto_settlement_intents (
  intent_key       TEXT PRIMARY KEY,          -- 'seal:<market_id>' / 'resolve:<market_id>' /
                                                --  'claim:<claim_id>:convert' / 'claim:<claim_id>:draw' / ...
  subject_type     TEXT NOT NULL CHECK (subject_type IN ('market','claim')),
  subject_id       TEXT NOT NULL,              -- market_id 或 proto_claims.id
  step             TEXT NOT NULL CHECK (step IN (
                     'seal','resolve','cancel_refund',
                     'convert_to_claim','claim_draw','convert_to_refundclaim','refund_payout','withdraw'
                   )),
  depends_on       TEXT,                       -- 'claim_draw'依赖'convert_to_claim', 'withdraw'依赖对应draw/payout
  status           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','prepared','submitted','landed','ambiguous')),
  prepared_txid    TEXT, prepared_tx_json TEXT, submitted_txid TEXT,
  landed_depth     INTEGER, landed_at TEXT, last_error TEXT,
  created_at       TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

理由：`market_seal`/`resolve`/`cancel_refund`是"市场级、至多发生一次"的动作，不值得像genesis那样
各开6个inline列（3个动作×6列=18列，proto_markets已经因genesis的6列+基础列相当宽了）；claim/withdraw
是"每个bettor各自可能发生"的动作，天然是"多行"结构，套用`proto_bet_intents`的既有哲学最省心。
**这是本文档新增的设计提案，需要NWT/Bettor单独审——不是"沿用既有设计"，请审查时特别注意**。

`landed`判定：market级动作查该市场UTXO指针（`shardleaf_txid/vout`→`rootclose_txid/vout`的推进）；
claim级动作查`proto_claims`对应行的`claim_txid`/`withdraw_txid`是否已确认——具体helper函数设计
（`checkMarketSealLanded`/`checkClaimDrawLanded`等）与既有`checkMarketGenesisLanded`同构，落码时
现写，本文档不预先给出伪代码（避免"看起来像已经设计好了"但实际细节需要对照真实driver接线才能定案）。

---

## §3 委员会（v0单keypair模拟，沿用既有裁定）

`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §5已裁定：`c0Pk..c4Pk`全部填同一把测试
keypair的公钥，`committee_privkey_enc`用`src/services/crypto.js`既有加密helper存进
`proto_markets`自己的字段（已落码，genesis阶段已经这样做）。本文档在此基础上**只补一条**：
`close_commit`需要**真正调用`decryptCommitteePrivkey()`拿到明文签名**——这是`covenant-construction
-spec-v0.1.md` §9.2"私钥生命周期"那条纪律第一次被真正触发的地方（genesis/register_append都不需要
委员签名，只有`close_commit`需要）。**明文私钥只存局部变量、用完立即丢弃引用**这条纪律必须在
`resolve`端点的实现里落到实处，不是重复既有文字——是"第一次真正需要被检验"。

---

## §4 领奖分配（claim候选恰好1条、winning_side/payout_root计算与落库、链上核对一致性）

沿用`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §2.5"claim候选数量必须恰好1条"
（Bettor 1354裁定，已在`proto.test.mjs`验证过501占位阶段的这条硬闸——`v0 single-operator assumption
violated, refusing to auto-pick one`，实现resolve/claim时这条闸门直接复用，不需要重新设计）。

**`new_payoutRoot`计算（depth-1专用，不复用`pool-payout-root.mjs`——`covenant-construction-spec
-v0.1.md` §1.3/§4.1已给出完整设计）**：

- (A)路线（单一`payout`值覆盖全部`pool_value`）：depth-0，`payoutRoot = leaf`本身
  （`tree_depth=0, merkle_index=0, siblings=[]`），**不需要真正的merkle树**——这是(A)路线相对(B)
  路线的又一个简化：不仅避开了§0的bug，连merkle证明本身都退化成平凡情形。
- (B)路线（2个不同payout值）：depth-1，两个叶子`leaf_i = blake2b(bettorPk_i ‖ le8(payout_i))`，
  `root = blake2b(leaf_0 ‖ leaf_1)`，`merkle_index`按bettorPk字典序或下注顺序固定映射（0/1），
  `siblings = [leaf_(1-i)]`。

**链上核对一致性**：`resolve`端点写入`proto_markets.winning_side`/`payout_root`之前，必须先用
**独立**代码路径重算一遍`new_payoutRoot`（不是调用同一个函数两次自证——`covenant-construction
-spec-v0.1.md` §4 T4-lite清单第2条已经点명这条纪律），并且落库的值必须与即将广播的`close_commit`
交易里`new_payoutRoot`参数逐字节一致（防止"链上写了一个值、DB记了另一个值"这种事后核对不上的分裂）。

**`winning_side`裁定来源**：v0操作员在`resolve`请求体里传`outcome`（`docs/2026-09-14-j2-proto-v0
-backend-api-design-v0.1.md` §2.4已定义），本文档不改这条——**结算权威仍然是操作员+委员签名，不是
链上某种"自动结算"机制**（v0范围明确排除，同`docs/DECISIONS.md` D-013既有裁定"register-only不部署
自动化"精神一致，虽然那条裁定针对的是另一个系统，但"人工触发、不自动"的原则贯穿整个proto-v0设计）。

---

## §5 回归（verify脚本扩展 + ctor矩阵）

沿用账本1469建立的方法论（`verify-shardleaf-direct-scripts.mjs`真实生产builder构造 + relay真签名 +
cli-debugger真执行），本文档要求实现阶段新增一个**同构**脚本
`verify-settlement-entries-scripts.mjs`，至少覆盖：

1. `market_seal`（`convert_to_rootclose`）：1个场景（count==seal_count触发）。
2. `resolve`（`close_commit`）：2个场景（YES赢/NO赢），5个签名槽验证方式待§1.2的
   `T-PROTO-COMMITTEE-SIG-DISTINCTNESS`技术点先确认。
3. `claim_draw`：(A)路线场景（无续约）**必须**PASS；若走(B)，partial续约场景在§0.8修复落地后必须
   PASS，**且要覆盖"用正确offset构造 vs 用旧错误offset构造"两个向量**（同账本1469"传错误ownRedeemLen
   必须fail-closed throw"那条负向测试的精神，验证fail-closed断言真的会拦，不是只测正向路径）。
4. `refund_payout`：(A)路线无续约场景与partial续约场景均已真实cli-debugger PASS（§0.9），无需
   额外修复设计。
5. `withdraw`（`KanetTokenClaim.spend`）：至少1个场景，虽然§0.4已判定安全，仍需要端到端形状验证
   （模拟从`claim_draw`产出的真实KanetTokenClaim实例，走完整的"领→提"链路，不是孤立测试`spend`）。
6. **ctor矩阵**（若走(B)修`RootClaim.sil`）：同账本1469`convergeShardLeafOwnRedeemLen`矩阵测试的
   方法论，对`RootClaim`自己的ctor形状（`shard_pool_id`/state字段组合）跑一遍，确认`own_redeem_len`
   是否也随某些字段变化——**不能假设"同ShardLeaf_direct的结论"，必须独立实测**（ShardLeaf_direct
   变化的原因是`seal_count`/`min_bet`这两个纯ctor int常量，RootClaim的ctor里没有这两个字段，但有
   没有其它int字段会导致同类minimal-push宽度变化，需要专门测）。

---

## §6 `T-PROTO-LEAF-ARTIFACT-VERSIONING`（账本1471观察票）评估

Bettor 1471裁定"原型v0当前无活市场⇒不扩本次范围，触发条件=出现第二个活市场或下次修改该合约之前"。
**本文档评估：走(B)路线本身就是"下次修改该合约"这个触发条件**——如果Owner选(B)，落码时应该**顺带**
把这张观察票实现（每市场genesis时落库合约源commit+编译hash，builder发现当前编译hash≠链上P2SH时
fail-closed拒绝），理由：(B)路线下一旦发现`RootClaim.sil`/`RefundClaim.sil`需要改，"旧市场P2SH绑死
旧字节"这个后果会**在resolve/claim阶段第一次真正发生**（此前只在genesis/register_append阶段发生
过一次，账本1468/1471那次），说明这个问题不是"一次性事故"，是"每次改这批合约都会复发的结构性代价"
——第二次复发就应该借着(B)这次工程投入一并解决，而不是继续记观察票、等第三次复发。**若Owner选(A)**，
本文档同意Bettor原裁定"不扩范围"，因为(A)路线不改任何`.sil`文件，观察票的触发条件不成立。

---

## §7 主网执行页草案（顺序、验收读数、中止条件）

**前提**（走(A)路线，`a59c7b48`继续用）：

1. **确认市场状态**：`a59c7b48` betting，count=1；若Owner计划再加1笔下注，需先与业务侧确认"两笔
   下注是否押同一方"（决定resolve后是否真的落在(A)路线的"单一payout值"前提内，见§0.7约束）。
2. **`market_seal`**：`count==seal_count`时触发。验收：`proto_markets.status→sealed`,
   `rootclose_txid/vout`写入，链上核对RootClose UTXO存在、代币金额==pool_value。中止条件：广播失败
   不推进status（NO-TX-NO-STATE），leaf仍可重试。
3. **`resolve`**：操作员传`outcome`。验收：`close_commit`广播成功，`proto_markets.status→resolved`,
   `winning_side`/`payout_root`落库且与独立重算值一致（§4）。中止条件：委员私钥解密失败/签名验证
   失败——fail-closed，不允许"跳过签名校验直接推进status"这种降级。
4. **`convert_to_claim`**：验收：RootClaim genesis成功，代币全额转入。
5. **`claim_draw`**：验收：KanetTokenClaim genesis成功，`proto_claims`记账（`claim_txid`/`amount`）。
   中止条件：若发现实际场景需要partial续约（payout<pool_value）——**立即停止，回退到§0.7路线判断，
   不允许"先广播试试看"**（§0已经证明这条代码路径未经充分验证）。
6. **`withdraw`**：验收：赢家提现成功，`proto_claims.withdrawn_at`/`withdraw_txid`落库。

**通用中止条件（所有步骤）**：任何一步的`net_loss`/`SIGNED_INPUT_CEILING_SOMPI`检查失败——fail-closed
报`no_suitable_fee_utxo`或`net_loss超限`，不允许放宽阈值"让它先过"；proto relay余额检查
（`assertProtoRelayHealthy`，`covenant-construction-spec-v0.1.md` §9.1）必须在每一步广播前重新核实，
不是只在流程开始时查一次。

**Owner需要在实现前先拍板的问题（汇总，本文档不代为决定）**：

- §0.7：(A)还是(B)？
- §0.7括号内：v0业务规则是否要求"同一市场支持2个不同payout值的赢家各自claim"，还是"赢家通吃/份额
  加总一次性发放"就够？这直接决定(A)是否真的适用，不只是"能不能技术上跑通"的问题。
- §0.9已解决：`RefundClaim.refund_payout`确认安全，走(B)不需要动它，只需修`RootClaim.sil`。

---

## 附：本次审计产出的工具（v0.2：已从`kasia-console/scratch/j2_settlement_audit/`移到
`kasia-console/scripts/audit/`——`scratch/`是gitignored目录，审计工具是长期可复用资产，不该待在
一次性目录里；账本1479 Bettor要求，供NWT复核/复用，未进`src/lib`）

**方法论新增两条断言（账本1479要求，此后每次跑新入口的真实执行审计都必须显式检查，不能只看
"PASS/FAIL"这一个信号）**：
1. **debugger内部重建的`active_sigscript`必须与我方显式提供的`signature_script_hex`逐字节一致**——
   §0.10发现`close_commit`的`active_sigscript`重建长度（3,618字节）与我方构造长度（20,423字节）
   相差5.6倍，这类量级级别的不一致必须在跑完整逻辑判定之前先检查出来，不能等到`require`失败了才
   回头查；PASS的结果如果没有做这条逐字节核对，也不能100%排除"侥幸凑巧的字节碰撞"（虽然概率极低，
   但方法论上应该显式核过，不是省略）。
2. **`lock_time`必须核实位于`test.json`的`tx`对象内部，不是顶层**——§0.10的`refund_flip`初次FAIL
   就是这条坑（见MUST-1/ANTI-PATTERNS候选②），此后写任何新的test.json前先grep自己的脚本确认
   `lock_time`的嵌套位置，不要等到CLTV报错才回头查字段位置。

- `kasia-console/scripts/audit/generic-entry-witness.mjs`：通用entry witness ABI
  编码器，已对已验证的`register_append`专用编码器做过逐字节自检（PASS）。
- `kasia-console/scripts/audit/00_self_check_generic_encoder.mjs`：上述自检脚本。
- `kasia-console/scripts/audit/01_audit_rootclaim_claim_draw.mjs`：**完整可运行**的
  `claim_draw` full/partial(正确offset)/partial(bug offset)三场景真实执行夹具（§0.5①②③的产出脚本，
  非半成品）。
- `kasia-console/scripts/audit/03_audit_refundclaim_refund_payout.mjs`：**完整可运行**
  的`refund_payout` full/partial两场景真实执行夹具（§0.9产出脚本，两个场景均PASS）。
- `kasia-console/scripts/audit/02_probe_genesis_covid.mjs`：`WrongGenesisCovenantId`
  问题的探针脚本（问题已解决，根因见§0.5——genesis类输出的covenant_id必须用
  `kaspa.covenantId(prevOutpoint,[(idx,output)])`按输出各自独立重算，不能任意选值或多输出共享）。
- `kasia-console/scripts/audit/04_probe_refundclaim_length_stability.mjs`：验证
  `RefundClaim`编译产物长度/state区在不同`pool_value`间稳定（排除"是不是JS侧构造出了不同长度脚本"
  这个候选解释）。
- `kasia-console/scripts/audit/rootclaim-claim_draw-audit-run.log`：`claim_draw`三场景真实运行
  记录（PASS/FAIL摘要）。
- `kasia-console/scripts/audit/refundclaim-refund_payout-audit-run.log`：`refund_payout`
  两场景真实运行记录（均PASS）。
- `kasia-console/scripts/audit/06_audit_rootclose_refund_flip.mjs`：**完整可运行**的
  `refund_flip`真实执行夹具（§0.10，PASS）。
- `kasia-console/scripts/audit/rootclose-refund_flip-audit-run.log`：对应运行记录。
- `kasia-console/scripts/audit/07_audit_rootclose_close_commit.mjs`：`close_commit`
  真实签名+真实执行夹具（§0.10，**当前仍FAIL**，留给NWT/后续会话接手排查，脚本内含"MY SIGNED TX
  DUMP"直接打印签名用tx的每个字段，配合下面的patch可直接逐字段比对）。
- `kasia-console/scripts/audit/rootclose-close_commit-audit-run.log`：对应运行记录。
- **`/d/silverscript-debugger-3ed9733-eprintln`**（本机路径，未入库——不是本仓文件，是D-019 pin
  commit `3ed9733`的独立临时worktree，加了两处`eprintln!`：①`main.rs`~911行转储`active_sigscript`
  hex；②`main.rs`~941行转储完整`kas_tx`的version/lock_time/每个input的prevOutpoint+sequence+
  compute_commit+sigscript+每个output的value+scriptPubKey+每个utxo的amount+scriptPubKey+
  covenant_id——均只读打印，未改一行判定逻辑。二进制：
  `target/release/cli-debugger.exe`（`CARGO_TARGET_DIR`独立，不冲突干净pin那份）。NWT/后续会话可
  直接复用，不需要重新patch重编。
