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

### §0.2 新增工具：通用entry witness ABI编码器（scratch，仅审计用，未进`src/lib`）

`register_append`已有专用编码器`proto-tx-assembly-witness.mjs`/`proto-register-append-witness.mjs`
（账本1425/1431确认过与D-019 pin `silverscript-abi/src/lib.rs`的`encode_entry_sig_script`
逐字节一致）。本轮为审计`close_commit`/`convert_to_claim`/`claim_draw`/`refund_payout`等新入口，写了
一个**通用**版本（`kasia-console/scratch/j2_settlement_audit/generic-entry-witness.mjs`）：直接读
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

### §0.4 逐入口结论表

| 入口 | 组合 | 结论 | 证据等级 |
|---|---|---|---|
| `ShardLeaf_direct.register_append` | readInputStateWithTemplate + 自续约(AB11) | **已修复**(账本1468/1469: ctor烤入`own_redeem_len`+JS不动点收敛) | 真实cli-debugger 6/6 PASS(账本1469④, `verify-run-1469-ctor-matrix.log`) |
| `ShardLeaf_direct.convert_to_rootclose` | 只有`scanOwnedTokenInputs`(读, 无自续约) | 结构性安全 | 源码逐行核对+架构论证(§0.3); 未在本轮单独重跑, 建议实现前补1条向量 |
| `RootClose.close_commit`/`refund_flip` | 只有`noTokenInput`(不读state) + 内建`validateOutputState` | 结构性安全 | 源码逐行核对+架构论证(§0.3); 未在本轮单独重跑, 建议实现前补1条向量 |
| `RootClose.convert_to_claim`/`convert_to_refundclaim` | `scanOwnedTokenInputs`(读) + 外部模板(非自续约) | 结构性安全 | 同上 |
| **`RootClaim.claim_draw`(payout==pool_value, 无续约分支)** | 无自续约, 只读ticket/token | **安全**——不经过下面的bug代码 | ✅ **真实cli-debugger PASS**（16参数全部真实ABI编码、真实协议常量尺寸、active input显式`signature_script_hex`——见§0.5①） |
| **`RootClaim.claim_draw`(payout<pool_value, partial续约分支)** | `readInputStateWithTemplate`(读ticket+token) + **手写AB11自续约, `ownSig.slice(0, OWN_PREFIX_LEN)`** | **🔴 确认同账本1468同类defect, 真实cli-debugger复现**——诚实backend按"正确offset"（即`register_append`已修复的`ownLen-own_redeem_len`手法）构造出的续约输出，被合约自己的错误自检拒绝：`error: script ran, but verification failed` 精确命中`ownSig.slice(...)`那一行`require` | ✅ **真实cli-debugger FAIL（符合预期）**——见§0.5② |
| `RefundClaim.refund_payout`(pool_value==stake, 无续约分支) | 无自续约 | 安全 | 源码逐行核对 |
| **`RefundClaim.refund_payout`(pool_value≠stake, partial续约分支)** | `readInputStateWithTemplate`(读ticket+token) + **内建`validateOutputState`(自续约)** | 🟡 **已真实执行, 两种debugger输入模式结论不一致**——"state"模式(debugger自己合成见证)PASS且无任何崩溃特征, 证明V-T-8不是这个组合必然触发的确定性崩溃; 但"raw"模式(同§0.5手工构造真实字节, 已独立排查过我方构造无误)FAIL(非崩溃, 正常验证失败)——两者理论上应该等价却不一致, 根因未查清, 见§0.9 | 🟡 **真实执行完成, 结论待NWT核实差异根因后才能定案**——两份完整日志+一键切换脚本(`AUDIT_STATE_MODE=1`)已留在scratch, 见§0.9 |
| `KanetTokenClaim.spend` | 无自续约(终态, 头注明确"不受V-T-8影响") | 安全 | 源码+既有e2e向量(`docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/`) |

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

运行记录：`kasia-console/scratch/j2_settlement_audit/rootclaim-claim_draw-audit-run.log`。夹具/工具
留在scratch供NWT复核复用（`generic-entry-witness.mjs`已对`register_append`专用编码器逐字节自检过；
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

### §0.7 路线判断（A/B，二选一，由Owner定，本文档不擅自选）

背景：市场`a59c7b48`已在主网betting，`count=1`（一笔下注），`seal_count=2`。

**若该市场只再接受至多1笔额外下注（`count`最终=2，两笔下注押同一方）且不产生"部分领取"场景**——即
resolve后唯一/全部赢家一次性`payout==pool_value`——**当前合约字节完全够用，走(A)**：`close_commit`/
`convert_to_claim`/`claim_draw`(无续约分支)/`KanetTokenClaim.spend`全部结构性安全（§0.4表），不需要
碰任何`.sil`文件。**约束**：resolve前必须先确认赢方只有一张有效`payout`值需要落地（即使有2笔下注，
只要都下在同一方且账目上被当成一次性`payout=pool_value`发放给"该方"，也不触发partial分支——**这一点
需要NWT在实现backend §1之前，明确"v0是否支持一个market里1笔claim覆盖同一方全部下注"这个业务规则**，
本文档不代为决定，只指出这是(A)能否适用的关键前提）。

**若该市场需要支持"两个不同`payout`值的赢家各自独立`claim_draw`"（depth-1上限恰好是2）**——**触发
partial续约分支**，走(B)：先修`RootClaim.claim_draw`（§0.5已用真实cli-debugger确诊defect；同账本
1469同款ctor烤入`own_redeem_len`+JS不动点收敛手法，§0.8给出具体设计），修复后需要真实cli-debugger
PASS（§0.5的夹具/方法论已经现成，不是从零开始）；`RefundClaim.refund_payout`的raw/state模式不一致
疑点也必须在此之前查清（§0.9——已真实执行两种模式、无崩溃迹象，但根因未查清，走(B)前必须补齐）。
**任何修改
`RootClaim.sil`/`RefundClaim.sil`都会改变`claim_tmpl_hash`/`refundclaim_tmpl_hash`——这两个值已经
烤进`a59c7b48`的`RootClose`（其`rootclose_tmpl_hash`又已经烤进`ShardLeaf_direct`本身）——`a59c7b48`
这个市场的leaf P2SH地址绑死在旧字节上，修复不能救它**（同账本1471NWT独立证实的"合约改动与既有市场
P2SH脱钩"结论，机制完全一致）。**走(B)意味着`a59c7b48`必须放弃，用修复后的代码重新genesis一个新
市场**——0.2 KAS genesis fee + 已下注的部分本金（若走cancel/refund路径能拿回代币本身，但genesis fee
与leaf dust不可回收，同账本1468④对旧市场的处置结论）。

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
6. `RefundClaim.sil`若也确认有等价问题（partial分支用`validateOutputState`——见下方§0.9），走(B)时
   一并处理，同一次工程投入。

### §0.9 `RefundClaim.refund_payout`的V-T-8开放问题——已真实执行, 结论有条件正面但留一个未解释的方法论疑点

**Bettor 1476明确要求补跑，已完成**（`kasia-console/scratch/j2_settlement_audit/03_audit_refundclaim
_refund_payout.mjs`，两种cli-debugger输入模式各跑一遍）：

- **full分支（pool_value==stake，无续约）**：两种模式均 **✅ PASS**。
- **partial分支（pool_value≠stake，`readInputStateWithTemplate`+内建`validateOutputState`同函数
  共存）**：
  - 用**"state"模式**（把active input的当前状态直接告诉cli-debugger，由它自己按`function`/`args`
    合成完整sigScript，同`docs/provenance/2026-09-14-j2-t3-v03-rootclose-zero32-guard/`已有的
    `RootClose.convert_to_claim`验证向量用的同一种模式）——**✅ PASS**。**没有任何崩溃迹象**（无
    rust panic/`-N cannot be used as an array index`一类特征文本）——这是本次审计**最重要的正面
    结果**：至少证明了V-T-8不是"这个组合必然触发"的确定性崩溃，`RefundClaim.sil`当前代码结构本身
    没有硬编码的运行期地雷。
  - 用**"raw"模式**（同§0.5对`RootClaim.claim_draw`用的方法——手工按真实ABI编码action witness、
    手工拼`action++pushdata(redeem)`、显式给active input传`signature_script_hex`，绕开debugger自己
    的见证合成）——**❌ FAIL**（`error: script ran, but verification failed`，非崩溃），且**独立验证
    过我的构造本身没有错**：①`full`分支用**同一套**raw构造方法且PASS（证明action witness编码/redeem
    revealing这部分是对的）；②续约输出`rootOutIdx`的期望值用"重新编译一次pool_value减掉stake之后的
    RefundClaim、取其P2SH"这个标准手法算出，独立探针脚本
    （`04_probe_refundclaim_length_stability.mjs`）确认这个手法产出的字节在state区之外与原编译产物
    逐字节相同、state区正确反映新pool_value——构造本身找不出错误。

**如实记录一个未解释清楚的疑点，不回避**：按理论分析（`validateOutputState`的codegen在**编译期**就
确定"自己"的字节码长度，不依赖witness供给的长度，理应对raw/state两种输入模式产出等价结果——但实测
两种模式给出了不同结论。本文档没能在本轮时间预算内查清这个差异的确切原因（候选：debugger自己合成
witness时的某个实现细节与手工构造有一处未发现的字节差异；或`validateOutputState`在"active input显式
给signature_script_hex"这一特定debugger调用形态下，自身的redeem定位逻辑与`readInputStateWithTemplate`
用的定位逻辑不完全对称——这需要NWT有能力时读silverscript-lang对应的运行期codegen源码才能钉死，同
既有V-T-8调查"猜测式排除法边际收益已经很低"的既有认知一致）。

**处置建议（给Owner/NWT的判断依据，不是本文档替代结论）**：
1. "state"模式PASS + 无崩溃，是走(A)"活市场用单赢家形状先完成主网闭环"这条路径**不需要等这个疑点
   解决**的依据——(A)路线根本不触发partial分支，这个疑点与(A)无关。
2. 若走(B)（`RefundClaim.sil`要真正用于生产的partial退款），**这个raw/state模式的不一致必须先查清
   楚**——不能因为"state模式PASS"就直接判定安全：cli-debugger的"state"模式本质上是一种调试便利
   （debugger自己合成"合理"的witness），而真实主网广播用的必然是"raw"等价物（backend自己构造的真实
   字节）——如果raw模式的FAIL反映的是backend真实构造路径会遇到的问题（而不是我这次manual audit脚本
   自己的构造疏漏，虽然已经排查过没找到），那"RefundClaim.sil当前代码可以安全用于partial退款"这个
   结论就是错的、危险的。**这正是账本1468教训的核心**：不能相信debugger自己合成见证的PASS，必须
   相信raw模式（真实字节）的结果——本条疑点因此不能被"state模式PASS了"轻易带过，需要NWT解释清楚
   raw模式FAIL的根因（是我的audit脚本疏漏，还是真实构造路径会撞到的问题）才能真正关闭。
3. 已把两次运行的完整日志留在scratch（`refundclaim-refund_payout-audit-run.log`=raw模式FAIL、
   `refundclaim-refund_payout-audit-run-STATEMODE.log`=state模式PASS）供NWT对照复核，脚本本身支持
   `AUDIT_STATE_MODE=1`环境变量一键切换两种模式复现。

**补充**：NWT若有余力，仍建议对照`2026-09-14-nwt-redteam-refundclaim-tokenization-and-vt8-hypothesis
-review-v0.1.md`的既有结论——那份文档是V-T-8这条纪律本身的出处，可能已经记录过与本次raw/state模式
差异相关的线索（本文档没有去重读那份文档核对，只是引用其存在）。这条独立于`RootClaim`的
`own_redeem_len`问题，**即使(A)路线成立，只要该市场未来允许cancel且有超过1笔不同金额的下注，这个
风险依然存在**，不因为选了(A)就自动消失（区别在于：(A)路线下这是"尚未触发、已用state模式初步排除
崩溃风险、raw模式疑点待查"的既有风险，不是本次要修的对象；(B)路线下如果要动`RootClaim.sil`，顺手把
`RefundClaim.sil`这条也查清楚是更划算的工程决策，见§0.8第6点）。

---

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
`pool_value==tk.stake`走无续约分支——**安全，不经过§0.9的V-T-8开放问题**）→ `KanetTokenClaim.spend`
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
4. `refund_payout`：(A)路线无续约场景已PASS；partial场景已用两种debugger模式真实执行(§0.9)，state
   模式PASS/raw模式FAIL且根因未查清——走(B)前必须先用raw模式(真实字节, 不能只信state模式)重新确认，
   查清差异根因后再判断是否需要修复设计（本文档不预先给出修复方案，因为还不确定"要不要修"这件事
   本身）。
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
- §0.9：`RefundClaim.refund_payout`已真实执行(state模式PASS、raw模式FAIL、根因未查清)——NWT有能力
  查清raw/state差异根因后，再判断是否需要连同`RootClaim.sil`一起修，还是`RefundClaim.sil`当前代码
  已经够用（取决于raw模式FAIL到底是我的audit脚本疏漏还是真实构造路径的问题）。

---

## 附：本次审计产出的工具（供NWT复核/复用，均在scratch，未进`src/lib`）

- `kasia-console/scratch/j2_settlement_audit/generic-entry-witness.mjs`：通用entry witness ABI
  编码器，已对已验证的`register_append`专用编码器做过逐字节自检（PASS）。
- `kasia-console/scratch/j2_settlement_audit/00_self_check_generic_encoder.mjs`：上述自检脚本。
- `kasia-console/scratch/j2_settlement_audit/01_audit_rootclaim_claim_draw.mjs`：**完整可运行**的
  `claim_draw` full/partial(正确offset)/partial(bug offset)三场景真实执行夹具（§0.5①②③的产出脚本，
  非半成品）。
- `kasia-console/scratch/j2_settlement_audit/03_audit_refundclaim_refund_payout.mjs`：**完整可运行**
  的`refund_payout` full/partial两场景真实执行夹具（§0.9产出脚本，支持`AUDIT_STATE_MODE=1`环境变量
  一键切换raw/state两种debugger输入模式复现§0.9记录的不一致结果，NWT查根因直接用这个脚本）。
- `kasia-console/scratch/j2_settlement_audit/02_probe_genesis_covid.mjs`：`WrongGenesisCovenantId`
  问题的探针脚本（问题已解决，根因见§0.5——genesis类输出的covenant_id必须用
  `kaspa.covenantId(prevOutpoint,[(idx,output)])`按输出各自独立重算，不能任意选值或多输出共享）。
- `kasia-console/scratch/j2_settlement_audit/04_probe_refundclaim_length_stability.mjs`：验证
  `RefundClaim`编译产物长度/state区在不同`pool_value`间稳定（排除"是不是JS侧构造出了不同长度脚本"
  这个候选解释）。
- `kasia-console/scratch/j2_settlement_audit/rootclaim-claim_draw-audit-run.log`：`claim_draw`三场景真实运行
  记录（PASS/FAIL摘要）。
- `kasia-console/scratch/j2_settlement_audit/refundclaim-refund_payout-audit-run.log`：`refund_payout`
  raw模式运行记录（partial FAIL）。
- `kasia-console/scratch/j2_settlement_audit/refundclaim-refund_payout-audit-run-STATEMODE.log`：
  同上state模式运行记录（partial PASS）——两份对照即§0.9记录的不一致证据。
