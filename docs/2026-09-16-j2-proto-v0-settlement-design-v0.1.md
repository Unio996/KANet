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

### §0.4 逐入口结论表（v0.4 定稿：并入NWT simnet真实全链共识结果——账本1485-1487，出处
`docs/provenance/2026-09-16-nwt-proto-v0-settlement-simnet-verify/README.md`@`af019c17`，
本节只摘要/引用，不复制其脚本）

**证据层级说明（v0.4新增，须先读）**：本文档此前（v0.1-v0.3）的"真实执行"全部指cli-debugger
**离线**执行——它精确复现`.sil`的`require()`链逻辑，但**不模拟**真实kaspad节点的交易finality检查、
KIP-9 storage mass、以及"其它输入自己的脚本执行"（debugger只验证active input）。NWT用**与主网完全
同款**的v2.0.1二进制在隔离simnet上真实broadcast+确认了全部8步结算链，这是比debugger离线执行更高
一级的证据——**本节起，debugger结论与simnet结论冲突时，以simnet为准**（§0.13已定此闸）。

**公共基线（debugger离线部分，v0.1-v0.3遗留内容，仍适用于未被simnet覆盖的行）**：交易`version=1`；
ABI编码器`kasia-console/scripts/audit/generic-entry-witness.mjs`修复后版本，commit `449745f4`；
debugger二进制D-019 pin `3ed9733`，sha256 `b85bb524d22ae761150dcb80b070f0bf1beb95a1c6604470501883b4d0f552c6`。

**分类（v0.4更新）**：simnet ACCEPT = `register_append`、`convert_to_rootclose`、**`close_commit`**、
`convert_to_claim`、`claim_draw`(full分支)、**`KanetTokenClaim.spend`**（后两项由v0.3的"待定"改判，
见下方8步表）；debugger PASS（未被simnet覆盖，仍是debugger离线证据）= `convert_to_refundclaim`、
`refund_flip`、`refund_payout`(full/partial分支)；FAIL（真实缺陷，非harness伪影）=
`claim_draw`(partial分支)（此结论simnet未推翻，见下方追加验证）；**结构性阻塞点（v0.4新增分类）**=
`RootClaim.sil:103 require(payout>=1000)`（见下方"RootClaim待修清单"）。

**8步全链simnet结果（route A精确参数：`a59c7b48`同形状复现——`min_bet=1`，第一笔`YES stake=1`，
第二笔`NO stake=999`，`pool_value=1000`，裁决`winningSide=YES`，唯一赢票`payout=1000==pool_value`
恰好卡在`RootClaim.sil:103`门槛上，走`claim_draw` full分支）**：

| # | 入口 | 构造来源 | mass | requiredFee(sompi) | 结果 |
|---|------|---------|------|---------------------|------|
| 1 | `market_genesis` | 生产builder（`proto-covenant-builder.mjs`+`proto-tx-assembly.mjs`，主线代码） | 200,006 | 20,000,300 | ✅ simnet ACCEPT |
| 2 | `register_append`#1（YES, stake=1） | 生产builder（`buildRegisterAppendTxJson`） | 448,870 | 44,886,300 | ✅ simnet ACCEPT |
| 3 | `register_append`#2（NO, stake=999, held） | 生产builder（同上） | 446,880 | 44,687,300 | ✅ simnet ACCEPT |
| 4 | `convert_to_rootclose`（封盘） | 审计构造（尚无生产builder，见下方"审计构造结论的地位"） | 396,794 | 39,678,700 | ✅ simnet ACCEPT |
| 5 | **`close_commit`**（winningSide=YES，5委员checkSig） | 审计构造（委员签名走`kaspa.createInputSignature`，与生产签名同一底层函数） | 198,771 | 19,876,700 | ✅ **simnet ACCEPT**（debugger离线持续FAIL卡在`validSigs>=4`，与共识不一致，已不作依据，根因未定案） |
| 6 | `convert_to_claim` | 审计构造 | 396,718 | 39,671,100 | ✅ simnet ACCEPT |
| 7 | `claim_draw`（payout=1000，恰在门槛上） | 审计构造（ticket消费需真实bettor `authorize_spend`签名） | 393,781 | 39,377,400 | ✅ simnet ACCEPT |
| 8 | **`KanetTokenClaim.spend`** | 审计构造（赢家checkSig） | 196,628 | 19,662,500 | ✅ **simnet ACCEPT** |

**审计构造结论的地位**：④⑤⑥⑦⑧五步目前**没有生产builder**（proto-v0结算侧尚未落码），结论范围限定
在"这套合约逻辑在真实共识上可执行、参数/witness形状如上表"——**等生产builder实现后必须用生产字节
在simnet重跑，才是最终验收依据**（不能拿本轮审计构造的ACCEPT直接当生产验收凭证，见下方"实现清单"）。
①②③生产builder已是mainline代码，可直接作为验收依据。implied fee恒等式（Σinputs.amount−
Σoutputs.value==内部算出的netLoss/requiredFee）已从反序列化真实tx对象独立复算确认一致（账本1455
纪律，全部✅）。

| 入口 | 组合 | 结论 | 证据 |
|---|---|---|---|
| `ShardLeaf_direct.register_append` | readInputStateWithTemplate + 自续约(AB11) | ✅ **已修复**(账本1468/1469) | ✅ debugger PASS 6/6 + ✅ **simnet ACCEPT**（上表①②③） |
| `ShardLeaf_direct.convert_to_rootclose` | 只有`scanOwnedTokenInputs`(读, 无自续约) | ✅ **安全** | ✅ debugger PASS（NWT）+ ✅ **simnet ACCEPT**（上表④，审计构造） |
| `RootClose.refund_flip` | 只有`noTokenInput`(不读state) + 内建`validateOutputState` + CLTV | ✅ **安全** | ✅ debugger PASS（`06_audit_rootclose_refund_flip.mjs`）——**未做simnet验证**，CLTV节点级约束已由NWT在close_commit那条上验证（同一段`OpCheckLockTimeVerify`代码路径，见§0.11 MUST-1v0.4更新），结构性风险低，但字面上仍是"debugger PASS，simnet未测" |
| `RootClose.close_commit` | 同上 + 5次`checkSig`(唯一涉及真实签名的入口) | ✅ **simnet ACCEPT（定论，debugger结论已不作依据）** | ✅ **simnet真实共识ACCEPT**（上表⑤）；❌ debugger离线持续FAIL卡在`validSigs>=4`——已排除witness参数短占位、debugger见证重建缺陷（NWT逐push解码确认长度差是预期的redeem脚本差异，非bug）；根因仍锁定debugger自己的sighash计算路径（`silverscript#253`同族疑点），**未定案，不下"上游缺陷"结论**，仅记录"debugger与真实共识不一致"这一事实 |
| `RootClose.convert_to_claim`/`convert_to_refundclaim` | `scanOwnedTokenInputs`(读) + 外部模板(非自续约) | ✅ **安全** | `convert_to_claim`：✅ debugger PASS + ✅ **simnet ACCEPT**（上表⑥，审计构造）；`convert_to_refundclaim`：✅ debugger PASS（NWT），未做simnet验证 |
| **`RootClaim.claim_draw`(payout==pool_value, 无续约分支)** | 无自续约, 只读ticket/token | ✅ **安全** | ✅ debugger PASS（`01_audit_rootclaim_claim_draw.mjs`，见§0.5①）+ ✅ **simnet ACCEPT**（上表⑦，审计构造，`payout=1000`恰在门槛上） |
| **`RootClaim.claim_draw`(payout<pool_value, partial续约分支)** | `readInputStateWithTemplate`(读ticket+token) + **手写AB11自续约** | 🔴 **确认真实缺陷**（同账本1468同类defect） | ❌ debugger FAIL（符合预期，见§0.5②，449745f4修复后编码器复测结论不变）——**simnet未测这个分支**（本轮8步链走的是full分支），结论仍以debugger离线FAIL为准（这条debugger结论一直可信，不在close_commit那种"debugger与共识冲突"的例外范围内） |
| **`RootClaim.sil:103 require(payout>=1000)`（v0.4新增：结构性阻塞点，非本次构造错误）** | 代币化前KAS sompi时代遗留字面量 | 🔴 **结构性阻塞**：API真实默认`min_bet=1`的小额市场，只要赢家`payout<1000`枚代币，永远无法`claim_draw` | ✅ **simnet真实复现**：本轮第一次因此FAIL而误把`min_bet`临时改成1000才跑通（掩盖了这条真实阻塞）；追加验证用`min_bet=1`精确复刻`a59c7b48`同形状，`payout=1000`（门槛值本身）simnet ACCEPT；`payout<1000`（如999）未上链测试，但`.sil`字面是`>=`非`>`，源码已确定会FAIL，不需要再耗测试网资源验证。详见"RootClaim待修清单" |
| `RefundClaim.refund_payout`(pool_value==stake, 无续约分支) | 无自续约 | ✅ **安全** | ✅ debugger PASS（`03_audit_refundclaim_refund_payout.mjs`），未做simnet验证 |
| **`RefundClaim.refund_payout`(pool_value≠stake, partial续约分支)** | `readInputStateWithTemplate`(读ticket+token) + **内建`validateOutputState`(自续约)** | ✅ **安全** | ✅ debugger PASS（同上，见§0.9自我纠错记录），未做simnet验证 |
| `KanetTokenClaim.spend` | 无自续约(终态, 头注明确"不受V-T-8影响") | ✅ **simnet ACCEPT（定论）** | ✅ **simnet真实共识ACCEPT**（上表⑧，审计构造）——v0.3的"待定"（旧证据是代币化前9参数合约，见§0.6）现由simnet真实执行覆盖解决，不再需要针对当前`.sil`补debugger向量 |

**mass观察（Bettor要求：占比最大来源，后续优化观察项；v0.8定稿：NWT用节点侧`getMempoolEntry`权威
分维度数字实测，精确数字见§0.14b）**：8步mass从196,628（spend）到448,870（register_append#1），
**register_append系与convert_to_*系（约397k-449k）已逼近simnet 500,000 compute mass上限的
80%-90%**（这是kaspa-wasm本地`calculateTransactionMass`报告的数字——v0.6一度怀疑本地数字漏算
v1交易的`compute_budget`项、真实margin应该更紧，但NWT实测节点侧权威mass后发现方向相反：**全部
7个非平凡步骤节点侧真实mass都比本地估算更低**（差2,824-12,800），`register_append`#1真实margin
精确值**89.10%**（由storage维度决定），跟本地数字基本一致甚至更宽松，v0.6"收紧到93.6%"的猜测
已被推翻删除；另有一笔极简单输入交易本地反而严重低估，详见§0.14b）。NWT独立确证了
KIP-9 storage mass对**小面值covenant输出**极度敏感（`reference-kip9-storage-mass-plurality-is-not-one-covenant-utxo-is-p2`）：首次把新建covenant输出面值设成`.sil`里`DUST_MIN`字面值（1000 sompi）时，
`requiredFee`被算成约4000 KAS（storage mass含`p²/v`项，v极小时被放大到天文数字）——**改用
`CONTINUATION_OUTPUT_SOMPI`（20,000,000 sompi，与其它续约/genesis输出同量级）后恢复正常**，这是
本节新增MUST-4的直接依据（见下）。精确compute/storage拆分因`kaspa.calculateStorageMass`撞
wasm `RuntimeError: unreachable`未取得，留作后续优化观察项。

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

**(A)路线精确参数（v0.4：NWT simnet已按此精确形状真实全链验证过，见§0.4的8步表）**：`a59c7b48`
第二笔下注**押NO，stake=999**（第一笔已有YES stake=1，两笔合计`pool_value=1000`，恰好卡在
`RootClaim.sil:103 require(payout>=1000)`门槛上——见§0.8/§0.4"结构性阻塞点"一行，`payout==1000`
本身是simnet真实验证过能通过的边界值，不需要再往上调）；委员**裁决YES**（唯一赢票，`payout=1000
==pool_value`，走full分支，无续约）。NWT的simnet全链验证走的正是这个精确参数组合（`min_bet=1`，
第一笔`YES stake=1`，第二笔`NO stake=999`），8步从`register_append`#2到`KanetTokenClaim.spend`
全部真实共识ACCEPT——**(A)路线不再是"结构性安全"这种理论推断，是有一整条真实链上共识确认过的
精确参数可以直接照抄执行**。

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

**🟢 v0.4更新：`close_commit`这个阻塞项已解除**——NWT的simnet真实全链共识验证已确认
`close_commit`真实ACCEPT（§0.4/§0.13），debugger离线FAIL已不再作为"能不能执行"的依据。(A)路线
现在是"有真实共识确认过的精确参数、可以直接执行"的状态，不再是"设计已就绪、尚不能执行"。(B)路线
仍需要先完成§0.8的`RootClaim.sil`修复（两处缺陷合并一次修改）并在simnet用真实partial形状重新
验证，但不再受close_commit本身的不确定性阻塞——(B)路线剩余的阻塞项纯粹是"`RootClaim.sil`还没修"，
不是"close_commit不知道能不能用"。

**本文档建议（仅供参考，不代Owner决定）**：先问清楚v0的业务规则是否要求支持"同一市场2个不同payout
赢家各自claim"——如果产品意图上v0本来就是"赢家通吃、一次性全额claim"（parimutuel常见简化：所有赢家
份额加总一次性发放，不是每人各自单独一笔`claim_draw`），那(A)路线不仅能救`a59c7b48`，也从根本上让
`RootClaim.sil`/`RefundClaim.sil`这两个未决风险在v0阶段永远不会被触发，把"要不要修`.sil`"这个决策
推迟到真正需要多赢家分别claim的那一刻——性质上等同于账本1471的`T-PROTO-LEAF-ARTIFACT-VERSIONING`
观察票（问题真实存在, 但触发条件是"未来需要", 不是"现在必须"）。

### §0.8 `RootClaim.sil`待修清单（v0.4更新：两处缺陷合并一次修改，预案，不实现，仅供Owner批准后
直接执行）——账本1484/1485-1487 Bettor复核+NWT simnet追加验证

**v0.4更新说明**：本节原本只覆盖partial续约偏移这一处（§0.5②确诊的真实缺陷）。NWT在simnet全链
验证时**追加发现第二处独立缺陷**：`RootClaim.sil:103 require(payout >= 1000)`是代币化之前
（KAS sompi时代）遗留的字面量，代币化后`payout`是KTT数量、不是sompi，两者量级完全不可比——**任何
`min_bet=1`（API真实默认值，`src/api/proto.js:118`）的小额市场，只要赢家最终`payout<1000`枚代币，
永远无法`claim_draw`**，这不是边缘情况，是**默认配置下的常见情况**（默认值本身就在这条门槛之下）。
Bettor要求**两处缺陷放在同一次修改里一并处理**，避免重复改`RootClaim.sil`两次，修后须在simnet用
真实多赢家partial形状重新全链跑通。

**与账本1469`ShardLeaf_direct.register_append`完全同构的手法**，六点对应partial续约偏移那处：

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
7. **（v0.4新增）`RootClaim.sil:103 require(payout >= 1000)`需要重新评估这条下限在代币化后的
   正确取值**——本文档只列选项与各自防的损失，不代为选择具体修法：
   - **选项a：直接删除这条require**——完全信任上游"`payout`必然是ticket合法claim出来的、不需要
     下限保护"这个假设；**防住的损失**：任何`min_bet>=1`的正常市场都不会被这条门槛卡住；**代价/
     风险**：如果这条`require`原本除了"防sompi时代dust金额"之外还兼有别的隐含防护作用（比如防止
     `payout=0`这种退化情形——需要额外确认`payout=0`是否已经被别的地方拦住，不能假设删掉这条
     就万事大吉），删除前需要通读`RootClaim.sil`全部`require`链，确认没有其它依赖这条下限成立的
     隐含前提。
   - **选项b：改成`require(payout > 0)`**——只防`payout=0`这种退化情形，不设任何有意义的下限；
     **防住的损失**：同选项a能救所有`min_bet>=1`的市场，同时保留"payout不能是0"这条最基本的
     健全性检查；**代价/风险**：如果Owner未来想要一个"最小claim金额"的产品性下限（比如为了控制
     链上小额claim产生的手续费浪费），这个选项没有提供该能力，需要另外在backend业务层（不是合约层）
     实现。
   - **选项c：改成与`min_bet`/`pool_value`关联的动态下限**（比如`payout >= min_bet`，或者
     `payout >= pool_value / some_divisor`）——**防住的损失**：给"防止链上出现经济上无意义的
     极小额claim"这个诉求提供了合约层强制；**代价/风险**：需要新增ctor参数或读取市场级的
     `min_bet`值，增加`RootClaim.sil`的state依赖面，且"多小算无意义"这个业务判断本身也需要
     Owner拍板一个具体数字或公式，不是纯技术决策。
   - 本文档倾向选项b最简单、最不引入新假设（仅供参考，不代Owner选），但最终选择需要Owner/Bettor
     确认。
8. **（v0.4新增）修复完成后，必须用真实多赢家partial形状在simnet重新全链跑通**——不能只靠
   cli-debugger离线PASS就认为修复完成，理由同§0.13的证据层级纪律：debugger验证的是"合约逻辑本身
   正确"，但simnet才能验证"真实节点会不会因为其它我们没预料到的节点级约束（如CLTV finality规则、
   KIP-9 storage mass，见MUST-1/MUST-4）而拒绝这笔交易"。回归场景至少覆盖：两个不同`payout`值
   的赢家各自`claim_draw`（真正触发partial续约代码路径，本轮8步链走的是full分支，从未真实覆盖过
   partial）+ `payout`恰好等于修复后新下限的边界值。

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

**账本1482更新（NWT逐push解码，v0.3更正：3,618/20,423的长度差不是重建路径bug）**：NWT把debugger
内部`active_sigscript`与我方explicit hex两份sigScript**逐push解码比对**，结论与§0.9①最初的猜测
（"main.rs:983整体没重建对"）**不一样，须更正**——前16个push**逐字节相同**（pubkey、真实签名、
全长`tok_suffix`都在其中）；3,618与20,423的差额，**恰好等于**explicit hex末尾那一段**16,802字节
的`RootClose` redeem push**——debugger自己编译`.sil`产出它内部用的redeem脚本，**不包含**我方
explicit hex里携带的这一段，这是**预期行为**（debugger走自己编译的redeem，我方走生产redeem字节，
两者本来就不该长度相同），**不是main.rs重建路径的bug**，v0.2那版"整体没重建对"的表述作废。
**签名侧`scriptPubKey`与test.json的`utxo_script_hex`同源**，这条也已排除。**剩余怀疑收窄到sighash
聚合分量本身**（同上面"尚未排除"清单第一条：`previous_outputs_hash`/`sequences_hash`/
`outputs_hash`这几个中间聚合hash，只核对过最终字段值，没有核对聚合hash本身）。**根因调查此后归
NWT接手**（她用本文档`07_audit_rootclose_close_commit.mjs`工具+eprintln patch，从UTXO entries与
sighash中间分量入手），本文档不再继续这条调查——但**结论最终以NWT正在起的simnet真实全链共识结果
为准**，不是debugger离线执行结果，见新增§0.13。

### §0.11 MUST：结算builder的硬约束（账本1479/1482 Bettor要求；MUST-1/MUST-4已按NWT simnet真实
共识发现在v0.4更新为精确规则，写入设计，供NWT实现§1时直接遵守）

**MUST-1（v0.4更新为精确规则）：`close_commit`/`refund_flip`的builder必须显式设置
`lockTime = deadline_ms`（`refund_flip`为`deadline_ms + 7,200,000`），committee签名input（active
input）的`sequence`必须取普通值`0`（不能是`MAX_TX_IN_SEQUENCE_NUM`），且提交时**节点当前时间必须
已经真实过了这个lockTime**。** 依据（v0.1-v0.3版本只写了"必须显式设lockTime"，NWT在simnet真实
提交时发现这远不是全部规则，是两条相互制约的节点级检查）：
1. **`OpCheckLockTimeVerify`本身要求ACTIVE input的`sequence < MAX_TX_IN_SEQUENCE_NUM`**
   （`rusty-kaspa` `crypto/txscript/src/opcodes/mod.rs:1055`，错误`"transaction input is finalized"`）
   ——这条规则专门防止用`sequence=MAX`把CLTV检查短路掉。
2. **节点级交易finality检查**（`consensus/src/processes/transaction_validator/
   tx_validation_in_header_context.rs:71-92`，`check_tx_is_finalized`）：若`tx.lock_time`>=当前
   区块时间/DAA，交易被判"未最终化"直接拒收（`NotFinalized`），**除非**该交易**全部**input的
   `sequence==MAX`。

**两条规则叠加的唯一自洽解**：committee-签名input的`sequence`必须是普通值（`0`），这就迫使规则2
必须走"`lock_time`已经真实过去"这条分支才能通过——**没有任何sequence组合能绕开"deadline必须已经
真实过去"这个前提**（NWT第一次尝试用"部署时刻+1小时"的未来deadline配合两个input都`sequence=MAX`，
被真实节点拒收；这是**cli-debugger完全测不出的**节点级约束，debugger从不模拟`check_tx_is_finalized`）。
**对当前活市场`a59c7b48`的含义**：其deadline已过，`close_commit`现在即可提交；`refund_flip`同样
已满足`deadline+2h`窗口，理论上任何人现在都能提交（MUST-3的permissionless风险已经是当前真实可
触发状态，不是理论风险）。这类"字段位置错/规则不完整→静默取默认值或被节点拒收"模式已作为
ANTI-PATTERNS候选写入，见附录。

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

**MUST-4（v0.4新增）：新建covenant输出的KAS值不得取`.sil`注释里`DUST_MIN`常量的字面值
（1000 sompi），必须与续约输出同量级（`CONTINUATION_OUTPUT_SOMPI`，20,000,000 sompi）。**
依据：NWT第一次构造`convert_to_claim`时把`claimOutIdx`的输出值直接设成`.sil`注释"KAS侧只剩dust
（DUST_MIN=1000）"字面提到的1000 sompi，`selectChangeShape`算出`requiredFee≈400,019,728,500 sompi`
（约4000 KAS）——根因是KIP-9 storage mass公式含`p²/v`项（`v`=输出面值），`v=1000`这种极小面值配合
covenant输出的plurality`p=2`，storage mass被放大到天文数字（同既有记忆
`reference-kip9-storage-mass-plurality-is-not-one-covenant-utxo-is-p2`的直接实例）。**这不是
debugger能测出的**（debugger不实现KIP-9 storage mass），是本轮除CLTV之外第二个"只有真实节点才会
暴露"的约束——`.sil`注释里"dust"这个词字面理解为"用DUST_MIN常量的具体数字"会直接产出天价fee交易，
必须统一改用远高于字面`DUST_MIN`、与其它covenant输出同量级的真实"dust"值（`CONTINUATION_OUTPUT_SOMPI
=20,000,000`，即0.2 KAS），改用后各步fee恢复到2000万-4500万sompi的正常区间（见§0.4的8步simnet
mass/fee表）。

**v0.5更正（重要，纠正v0.4的一处过度扩大化错误）**：v0.4曾在此处写"这条约束同时也是找零判定的具体
门槛来源——fee input找零必须是0或≥20,000,000 sompi"——**这条推论是错的，须删除**。读
`kasia-console/src/lib/proto-tx-assembly.mjs::selectChangeShape`真实源码才发现：该函数**没有任何
针对普通P2PK找零输出的最小值门槛**——它的实际逻辑是"带找零"与"不留找零全部并入fee"两种形状二选一，
取`net_loss`更小且不超过动态上限（`min(requiredFee×2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI
=1.0 KAS)`）的那个，找零值本身多小都不构成失败条件（哪怕找零只有0.09 KAS）。这本身是账本1427
Bettor复核订正过的既有代码（源码注释原话："原来的'必须0或>=20M dust门槛'与...冲突, 真实迭代出来的
找零≈15M会被那条硬门槛拒到构造不出来...20M只是KIP-9 U形曲线上'比较省'的经验点, 不是节点规则——
不该当成人为门槛写死"）——MUST-4本身完全成立（covenant输出面值不能取字面`DUST_MIN`），但它管的是
"新建covenant输出自己的面值"，不管"relay自己的P2PK找零输出"，这是两个独立的东西：前者p=2(covenant
plurality)对`p²/v`极敏感，后者p=1(普通输出)敏感度低5个数量级，量级完全不在一个档位，不能把同一条
门槛套用到两种不同性质的输出上。这处过度扩大化在§0.14的资金推演中曾被直接采用为约束条件，导致
推演结果有系统性偏差，已在§0.14 v0.5中重新按真实代码逻辑推演。

**v0.6再更正（Bettor账本1489指出v0.5仍不够严谨）**：v0.5说"P2PK找零无最小值门槛"是对的（代码
确实没有硬编码门槛），但**不代表小额P2PK找零就一定安全**——KIP-9 storage mass公式
`C·p²/v`对**所有**输出都生效，`p`只是把covenant输出的敏感度再放大4倍（p=2时p²=4），并不是说
p=1（普通输出）就不受`1/v`这一项影响。直接读`consensus/core/src/mass/mod.rs::calc_storage_mass`
真实源码验证：`v=0.0867 KAS`(8,670,000 sompi)的P2PK找零单独算，`storage_mass_parameter/v
=10^12/8,670,000≈115,340`；`v=0.01 KAS`(1,000,000 sompi)单独算是`10^12/1,000,000=1,000,000`
——后者单独就超过500,000区块上限。**但这只是"harmonic_outs"这一项单独的数字，不是交易最终的
storage mass**——真实公式是`max(0, harmonic_outs − arithmetic_ins或harmonic_ins)`，输入侧同样
按plurality贡献一个抵扣项，找零到底安不安全，取决于这笔交易全部输入输出一起代入公式算出的**净值**，
不能只看找零这一项的孤立harmonic分量。§0.14 v0.6用真实公式逐笔核对了本节6步实际选中的找零，全部
安全（含一笔用0.087 KAS小额UTXO的`spend`步骤，净storage mass算出来是0，因为输入侧的抵扣项足够大）
——但这是**这几个具体案例的核算结果**，不是"小额找零总是安全"这个结论，每次换一组不同的
输入/输出面值组合，都需要重新代入公式核实，不能凭"之前测过安全"就假设新案例也安全。**MUST-4
措辞最终版**：找零本身无代码门槛，但受storage mass约束（对所有输出、不止covenant输出生效）；
是否安全由构造期真实mass计算把关，不能靠"面值大小看着正常"这类目测判断。

另外（账本1489同批发现，v0.7更新：这条代码观察本身仍然真实，但由此推出的"真实mass应该更紧"这个
方向性结论已被NWT的节点侧实测推翻，不能再用来调整margin数字）：**kaspa-wasm本地
`calculateTransactionMass`对v1交易的compute_budget字段计算不完整**——直接读
`wallet/core/src/tx/mass.rs::calc_compute_mass_for_client_transaction_input`源码，该函数只读
`input.compute_commit.sig_op_count()`（v1交易的`ComputeBudget`变体这个方法返回`None`，
`unwrap_or(0)`直接归零），完全没有读`.compute_budget()`字段本身，代码里明确留了一行注释
`// TODO: Add support for v1 transactions.`——这个观察本身属实（wallet-core确实有这个已知未完成的
缺口），**但v0.6据此推出的"每步应该补7,000-14,000×input数量的真实mass、register_append margin
从89%收紧到93.6%"这个结论是错的**——NWT直接用`getMempoolEntry`查真实节点已接受交易的权威mass，
发现全部8步的节点侧真实值都**低于**kaspa-wasm本地估算（不是更高），方向与v0.6的推理相反，说明
本地"unsigned tx"估算路径本身还有其它未被v0.6考虑到的、量级更大的偏差（可能是
`calc_compute_mass_for_unsigned_consensus_transaction`给未签名交易额外叠加的合成签名字节
预估——真实已签名交易不需要这部分，见§0.14b的详细讨论），把两个方向不同的偏差混在一起简单相加
是错误的推理方式。v0.6那次"93.6%"的数字已删除，改用NWT节点侧权威数字（约87-89%，精确
compute/storage维度拆分待补，见§0.14b）。

### §0.12 给Owner的产品选项（本文档只列选项与各自防的损失，不替Owner选）

**v0.7更正（Bettor账本1490，NWT审出）**：v0.5版本的选项组2把"抢跑风险"的根源写错了——真正的
抢跑风险来自`RootClose.refund_flip`（无签名，deadline+2h后任何人都可调用，见§0.10/MUST-3），
**不是**`RefundClaim.refund_payout`。给`refund_payout`加委员签名，挡不住`refund_flip`被抢先
触发这件事本身（市场已经被推进到"已退款"状态了，`refund_payout`加不加签名都改变不了这个既成事实），
反而会破坏委员真的失联时用户拿回本金这条兜底路径（`refund_payout`本来就是这条兜底链路的最后一步，
加签名等于让兜底依赖一个可能已经不存在的委员）。v0.7把选项组2改成正确的靶子——"谁、何时可以触发
`refund_flip`"，并与选项组1（deadline/grace时长）合并表述（两者本来就是同一个机制的不同维度：
时长决定"多久之后"，触发权限决定"届时谁能动"）。

**选项组1+2合并：新市场的deadline/grace时长该设多久，以及deadline之后谁能触发`refund_flip`**

| 选项 | 防住的损失 | 代价/风险 |
|---|---|---|
| 维持现状（deadline过后+grace(如2h)，任何人都可触发`refund_flip`，无签名门槛） | 委员失联时用户仍能自主推进退款流程，不需要等待任何第三方动作——这是refund路径存在的本意（兜底，见§0.10/MUST-3） | grace窗口一过，**任何人都可以抢在委员真实裁决完成前**把市场推进到"已退款"状态——如果委员只是暂时离线（网络故障、维护）而不是真的失联，这条路径会抢跑掉一个本该有真实赢家的市场，所有下注者只拿回本金、赢家拿不到应得的赔付（资金错配，不是资金被盗，但赢家合理预期落空） |
| deadline后先进入"仅委员可flip"窗口（如deadline+短grace），之后才进入"任何人可flip"的更长宽限期（如再等7天） | 兼顾两头：短窗口内给委员优先裁决/flip的机会，抑制"委员只是暂时离线就被抢跑"这个风险；长宽限期过后仍保留permissionless兜底，委员真的永久失联时用户依然能拿回本金，不会退化成资金永久锁死 | 需要修改`RootClose.sil`的`refund_flip`entry，新增"仅委员"这个时间窗口的签名校验分支，**会改变`rootclose_tmpl_hash`**——同(B)路线一样，只适用于新市场，救不了`a59c7b48`这类已经把`rootclose_tmpl_hash`烤进`ShardLeaf_direct`的既有市场；且两段时间窗口本身的具体时长（多短的"仅委员"窗口、多长的"任何人"宽限期）仍需要Owner拍一个具体数字，不是纯技术决策能替代的 |
| 中间值+可配置（每个市场genesis时由创建方自己指定deadline/grace/委员优先窗口，不写死协议常量） | 不同风险偏好的市场（小额测试市场 vs 大额市场）可以各自选适合自己的窗口，不用一刀切 | 增加ctor参数和实现复杂度，需要在市场genesis页面给创建方解释这几个数字的含义，用户理解成本更高；若采用"仅委员窗口"这个机制，同样需要改`RootClose.sil`，同上一条一样只适用于新市场 |

**选项组3（v0.8定稿：simnet已ACCEPT，输家ticket不是永久锁死）**：输家ticket的0.2 KAS要不要引导
用户自行回收

**v0.8定论**：v0.5"永久锁死"的判断是错的，v0.7的"待simnet确认"现已确认——NWT直接构造真实
`authorize_spend`交易（bet2/NO/输家票自己签名，单输入该ticket UTXO+单输出付给relay测试地址，
`kaspa.createInputSignature`真实签名），真实广播：**✅ simnet真实共识ACCEPT**（txid见provenance
`50019d4f`"追加验证②"），成功取回20,000,000−2,000,000(fee)=18,000,000 sompi=**0.18 KAS**。
`PoolSideTicket.sil`唯一入口`authorize_spend(sig bettorSig)`只要求bettor自己签名，没有"必须是
赢家"这类额外校验——**这是builder/流程设计缺口，不是合约缺口**：现有proto-v0结算流程从未构造过
这笔交易，不代表合约做不到。**已核实的连带后果（Bettor追问）**：某个bettor提前（resolve之前，
或refund_flip之后但自己触发refund_payout之前）自行`authorize_spend`花掉自己的ticket，唯一后果
是**这个人自己放弃了该票日后`claim_draw`/`refund_payout`的资格**（票已经不在了，没有UTXO可以
再当输入）——不影响其他任何bettor的资金/权利，也不影响`pool_value`/`winning_side`/`payout_root`
等市场级账目（这些账目的权威来源是`RootClose`/`RootClaim`自己的state，不依赖ticket UTXO集合是否
还存在）——纯粹是"个人选择放弃自己权益"，不构成安全问题。

**"sweep入口"这个选项已撤销**（v0.5原本给的备选方案，前提是"需要改合约"——既然不需要，这个选项
不再成立）：

| 选项 | 防住的损失 | 代价/风险 |
|---|---|---|
| 实现一个回收builder（`buildTicketReclaimTxJson`），bettor自助操作，**不改任何`.sil`文件、不改任何模板hash、不影响既有市场P2SH** | 让输家能真正拿回自己ticket里的0.18 KAS（扣除回收本身的fee），不需要等待`claim_draw`/`refund_payout`；`a59c7b48`这类既有市场同样适用，是纯粹的backend/relay侧新增功能 | 需要教育/引导输家bettor自己发起这笔回收交易（不是自动的，是需要用户主动操作的一步）；回收这个新tx形状本身的fee计算需要小心处理（见§0.14b"关于回收交易fee选值的核实"——不能直接照抄现有的`computeRequiredFeeSompiOrThrow`辅助函数，本地mass对这种极简单输入交易形状会严重低估） |
| 维持现状（不主动提供/引导这个回收操作） | 不增加任何产品/开发工作量 | 即使技术上完全可行，用户不会自己想到用底层工具构造这笔交易，实践中dust依然会长期挂账，跟"技术上无法回收"的实际效果接近——但这纯粹是产品优先级问题，不是任何技术/安全限制 |

以上选项相互独立（deadline/grace时长+触发权限、输家ticket回收路径，互不影响），
Owner可以分别决定；本文档不推荐任何一个具体选项，只列出已知的、真实执行验证过的技术事实
（§0.10/MUST-3/§0.14）所决定的取舍空间。

### §0.13 simnet真实全链共识验证闸（v0.3新增，账本1482 Bettor批准，NWT主导执行）

**背景**：§0全篇的"真实执行"指的是cli-debugger**离线**执行——它精确复现`.sil`的`require()`链
判定逻辑（这是它相对纯JS测试的核心价值，见§0.1），但它**不是**真实kaspad节点的共识引擎，不会做
真实网络的mempool校验、完整交易格式校验、或者debugger自身实现里可能存在的、与真实共识不一致的
细节偏差。NWT已经在本机用**与主网同款的官方kaspad 2.0.1二进制**（`D:\rusty-kaspa-v201`，
sha256 `8afe6a68…`，commit `cfafeb4c`）起了一个**隔离simnet**（`toccata always`+
`skip_proof_of_work`，不联公网、不影响主网/TN12任何数据），可以真实提交完整交易并让真实共识引擎
给出裁决——这是比debugger离线执行更高一级、更接近"上主网会发生什么"的验证手段。

**闸的内容（本轮起，此后所有结算相关合约上主网前均适用）**：
1. **任何结算步骤（`market_seal`/`close_commit`/`convert_to_claim`/`convert_to_refundclaim`/
   `claim_draw`/`refund_flip`/`refund_payout`/`KanetTokenClaim.spend`）上主网前，必须先用**生产
   builder**（不是debugger的test.json/审计脚本，是真正会在relay里跑的那份构造代码）构造出的真实
   字节，在这个simnet上真实提交并等待确认**——debugger的PASS只是准入门槛，不是上主网的充分条件。
2. **`close_commit`与`KanetTokenClaim.spend`当前的"待定"结论，以simnet真实全链共识结果为最终定论**
   ——§0.4表格里这两行的"待定"状态在simnet结果出来前不升级为"安全"或"确认缺陷"，debugger侧的
   FAIL（`close_commit`）/证据过期（`KanetTokenClaim.spend`）只是背景信息，不代替simnet结论。
3. **cli-debugger离线审计降级为开发期辅助手段，不再作为"能不能上主网"的依据**——它仍然是排查
   `require()`链逻辑、快速定位具体是哪一行断言失败的最高效工具（§0.1的价值论证不变），但"debugger
   PASS"这句话本身，从本轮起不再等同于"可以上主网"，两者是不同层级的验证，必须都做。
4. **节点/编译器/debugger使用前一律先核版本与sha256，不能凭路径名或"应该是这个"假设**——同账本
   1482这次的具体实践（simnet节点sha256核对与主网一致后才使用），也同§0.1本文档一直坚持的"pin
   commit+sha256"纪律的自然延伸，适用对象从"debugger二进制"扩大到"simnet节点二进制"。

**结果（v0.4：NWT全链验证已完成，账本1485-1487，出处
`docs/provenance/2026-09-16-nwt-proto-v0-settlement-simnet-verify/README.md`@`af019c17`，本节只
摘要/引用，不复制其脚本，本文档所有具体结论以Bettor派工时给出的这份provenance为准）**：30分钟
主网健康观察窗完成（全程主网节点PID未被触碰，同步状态/`virtualDaaScore`持续增长、console无新
FATAL）后，genesis→register_append×2→convert_to_rootclose→close_commit→convert_to_claim→
claim_draw→KanetTokenClaim.spend**8步全链**在v2.0.1 simnet真实提交，**全部真实共识ACCEPT**（逐步
mass/fee/构造来源见§0.4新表）。`close_commit`——本轮验证的决定性问题——真实共识**接受**，与
cli-debugger持续FAIL形成明确不一致：**已按本节闸的口径判定"debugger结论与真实共识不一致，
debugger不再作为close_commit可执行性的依据"，根因未定案（不排除debugger自身未公开bug，也不排除
其它未触及的边界条件），不下"上游silverscript缺陷"结论**。`KanetTokenClaim.spend`同样simnet
ACCEPT，v0.3的"待定"状态解除。途中另确认两项cli-debugger完全测不出的节点级真实约束（CLTV
finality规则、KIP-9 storage mass对小面值covenant输出的敏感性），已写入§0.11 MUST-1/MUST-4；
并追加发现`RootClaim.sil:103 require(payout>=1000)`是代币化前遗留的结构性阻塞点，已写入§0.8/
§0.4。

### §0.14 主网资金推演：(A)路线剩余6笔交易的fee UTXO选择与执行完毕资金（v0.5重算，账本1482/1488
Bettor要求；D-021合规：本节只给结构性形状与推演结论，不给真实地址/完整txid，具体UTXO/txid见
`docs-private/proto-v0-funds-seed-transfer-balances.md`）

**v0.5更正说明**：v0.4版本只扣了手续费（`找零=fee UTXO−fee`），**漏算了每步新建covenant输出锁进去
的KAS、以及被释放回relay的KAS**——Bettor用账本1473首笔下注的真实数据指出了这个错误（输入leaf 0.2+
fee UTXO 0.95，输出leaf续约0.2+ticket 0.2+held 0.2+找零0.116601——fee UTXO实际付出0.433399手续费+
0.4新锁定，找零只有0.1166，不是v0.4写的0.50-0.56）。本节直接读`kasia-console/scripts/simnet/
run-full-chain.mjs`与`src/lib/proto-tx-assembly.mjs`的真实`leftover`公式重新推演（不是重新猜测——
这是NWT那次真实simnet全链验证实际跑的同一份代码逻辑），并更正了v0.4里一个连带的错误理解（找零并
没有"0或≥20,000,000 sompi"这条门槛，那条只管covenant输出自己的面值，见MUST-4 v0.5更正）。

**正确公式（Bettor给出，与`selectChangeShape`源码逐项对应）**：
`relay找零 = Σrelay自有输入 − fee − Σ本步新增锁定的covenant输出KAS + Σ本步释放回relay的covenant
输入KAS`。"新增锁定"="本步产出的、非relay自己P2PK的输出"（leaf续约不算新增，它本来就是覆盖它自己
的输入，净零；ticket/held/RootClose/RootClaim/KanetTokenClaim等新建或延续的covenant输出才算）；
"释放"="本步消费掉的、非relay自己P2PK的输入"（同理，覆盖掉与之对应的续约输出后，若还有剩余就是
净释放）。全部covenant"KAS侧"面值统一是`CONTINUATION_OUTPUT_SOMPI`=`GENESIS_OUTPUT_SOMPI`=
20,000,000 sompi=0.2 KAS（`proto-tx-assembly.mjs`两个常量同值，账本1473真实例子的leaf/ticket/held
均为0.2 KAS，直接印证）。

**逐笔覆盖分类（新增锁定 vs 释放，均从`run-full-chain.mjs`真实`leftover`公式逆推，非猜测）**：

| # | 步骤 | 消费的covenant输入(I_cov) | 产出的covenant输出(O_cov) | 净效应(O_cov−I_cov) | 真实fee(KAS) |
|---|------|---------------------------|---------------------------|---------------------|---------------|
| 1 | 第二笔下注(`register_append`#2) | leaf(0.2)+held(0.2)=0.4 | leaf续约(0.2)+ticket#2(0.2,**新增**)+held续约(0.2)=0.6 | **+0.2（净新增锁定）** | 0.446873 |
| 2 | 封盘(`convert_to_rootclose`) | leaf(0.2)+held(0.2)=0.4 | RootClose genesis(0.2)+token转出(0.2)=0.4 | 0（覆盖平衡） | 0.396787 |
| 3 | `close_commit` | RootClose(0.2) | RootClose续约(0.2) | 0（覆盖平衡） | 0.198767 |
| 4 | `convert_to_claim` | RootClose(0.2)+token(0.2)=0.4 | RootClaim genesis(0.2)+token转出(0.2)=0.4 | 0（覆盖平衡） | 0.396711 |
| 5 | `claim_draw`(full分支) | RootClaim(0.2)+token(0.2)+**赢票ticket(0.2)**=0.6 | KanetTokenClaim genesis(0.2)+token转出(0.2)=0.4（**无RootClaim续约**，full分支不留） | **−0.2（净释放回relay）** | 0.393774 |
| 6 | `KanetTokenClaim.spend` | KanetTokenClaim(0.2)+token(0.2)=0.4 | 代币转给赢家目的地(0.2)（**无KanetTokenClaim续约**，终态） | **−0.2（净释放回relay）** | 0.196625 |

**每步relay净流出（= fee + 净新增锁定）**：0.446873+0.2=**0.646873**；0.396787+0=**0.396787**；
0.198767+0=**0.198767**；0.396711+0=**0.396711**；0.393774−0.2=**0.193774**；0.196625−0.2=
**−0.003375**（`spend`这一步实际是净流入！释放的0.2 KAS比fee本身还多0.003375）。**6步净流出合计
= Σfee(2.029537) + Σ净新增锁定(+0.2−0.2−0.2=−0.2) = 1.829537 KAS**（不是v0.4错误算出的
2.029537——差的0.2 KAS正是"漏算`claim_draw`/`spend`两步净释放"这个错误本身的量级；`register_append`
那步漏算的+0.2净锁定与这两步漏算的−0.4净释放方向相反，净误差为−0.2，即v0.4的数字比正确值少算了
relay实际会多拿回的0.2 KAS）。

**fee UTXO逐笔选择（用`selectFeeUtxoByConstruction`真实算法模拟——优先尝试面值最小、仍够用的
UTXO，非"专挑大面值"）**：起点7枚UTXO（约0.95×4 + 0.116601/0.086667/0.086667，合计约4.089935 KAS，
账本1475）。按执行顺序模拟：

| # | 步骤 | 选中fee input面值 | 找零(=leftover−fee，无≥0.2门槛) | 找零去向 |
|---|------|---------------------|-------------------------------|---------|
| 1 | 第二笔下注 | 0.95（4枚大额之一） | 0.303127 | 供③使用 |
| 2 | 封盘 | 0.95（第二枚） | 0.553213 | 供④使用 |
| 3 | `close_commit` | 0.303127（步骤1找零） | 0.104360 | 剩余 |
| 4 | `convert_to_claim` | 0.553213（步骤2找零） | 0.156502 | 剩余 |
| 5 | `claim_draw` | 0.95（第三枚，小额均不够——0.086667/0.116601+0.2=0.286667/0.316601仍<0.393774） | 0.756226 | 剩余 |
| 6 | `spend` | **0.086667（3笔小额之一，够用！**leftover=0.086667+0.2=0.286667，fee仅0.196625，找零=0.090042≥0） | 0.090042 | 剩余 |

**回答Bettor第4问（"某步找零<0.2 KAS又不为0该怎么办"）**：上表③④⑥三步找零分别是0.104360/
0.156502/0.090042，全部<0.2 KAS且不为0——**按现有真实代码，这些完全合法，不需要任何特殊处理**
（不用"并入手续费"，也不用"换更大面值凑够0.2"）。`selectChangeShape`的"带找零"形状（shape A）
只检查`requiredFee ≤ netLoss ≤ dynamicCeiling`，`netLoss`对shape A恒等于`requiredFee`本身，
找零的具体数值（无论是0.09还是0.75）完全不影响这个判定；`validateNetLoss`同样只检查
`netLoss ≤ feeCeiling(=min(requiredFee×2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI=1.0KAS))`，
没有独立的找零下限检查。以上④③⑥三步的`requiredFee`分别是0.198767/0.396711/0.196625，对应
`ceiling`分别是min(0.397534,cap,1.0)/min(0.793422,cap,1.0)/min(0.39325,cap,1.0)——三者的
`netLoss`（=各自`requiredFee`本身）显然都远小于自己的`ceiling`，**fee上限允许，不存在"并入
手续费"这个备选方案被迫启用的场景**（那是shape A本身不可行时——比如leftover<requiredFee——
才会触发的shape B）。本节唯一需要"换面值"的地方是③（用X1=0.303127支付close_commit的
0.198767fee时，若把找零门槛错误地理解成"必须≥0.2"，会误判这笔构造失败，从而错误地跳到换更大的
U3/U4——这正是v0.4犯过的错误，v0.5已更正）。

**发现（v0.5新增，纠正v0.4"3枚小额一律闲置"的判断）**：`spend`步骤因为有0.2 KAS净释放、真实fee又
最小（0.196625），是6步里唯一一步**小额UTXO单独就够用**的——不需要多输入组合，`selectFeeUtxoByConstruction`
现有的单UTXO选择算法（`按面值升序逐个尝试`，非多输入合并）直接就会选中它。其余两枚小额
（0.116601/0.086667）与`claim_draw`/`close_commit`等步骤仍不够用（即使算上0.2的净释放，
`0.116601+0.2=0.316601`仍小于`claim_draw`的0.393774fee），**目前代码不支持多UTXO合并当fee
input**（`selectFeeUtxoByConstruction`逐个尝试单一候选，未见合并逻辑），这两枚小额若想变得可用，
需要先起一笔单独的整理交易（自己转给自己，合并成一枚更大的UTXO），本次6步执行不产生这个需求（不
影响资金充足性），留给后续按需处理。

**最终状态（v0.5重算，两种独立算法交叉核对一致）**：
- **relay最终P2PK余额** = 起点4.089935 − 6步净流出合计1.829537 = **2.260398 KAS**——与逐笔UTXO
  模拟表独立相加的结果**完全一致**（`close_commit`找零0.104360+`convert_to_claim`找零0.156502+
  `claim_draw`找零0.756226+`spend`找零0.090042+始终未用的1枚大额0.95+2枚小额0.116601+0.086667
  = 2.260398），两条独立算路交叉验证吻合，**没有内部不一致**。
- **链上仍锁定在covenant里的KAS**：`spend`完成后，赢家的代币转出目的地（新genesis KTT实例，赢家
  控制）持有**0.2 KAS**——这是设计上的终态（赢家的钱，不是relay的钱，也不是"丢了"）。
- **"永久锁死"的dust——v0.8定论：不是永久锁死**：**第二笔下注（NO，输的那方）创建的ticket，
  0.2 KAS，`claim_draw`full分支不会消费它**（只消费赢家YES那张）。v0.5曾误判这必然永久锁死；
  **v0.8：NWT已用simnet真实广播确认**`PoolSideTicket.sil`的`authorize_spend(sig bettorSig)`
  只要求bettor自己签名，输家bettor可以自己签名花回这张ticket，真实取回
  20,000,000−2,000,000(fee)=18,000,000 sompi=**0.18 KAS**（不是完整0.2，回收本身要付fee）——
  不需要新合约入口，只需要一个新的回收builder（`buildTicketReclaimTxJson`），见§0.12选项组3v0.8
  与§7.1实现清单。**这是流程/backend缺口，不是合约缺口**：合约从一开始就允许这笔花费，只是proto-v0
  现有流程从未构造过它。§0.14"执行完毕后剩余资金"因此是**2.260398+0.18=2.440398 KAS**（不是
  v0.7误算的2.460398，那个数字漏扣了回收这笔交易自己的fee）。同族先例（旧市场`a0c4d628`的leaf
  dust，0.2 KAS，账本1473记录）**性质不同，不能类推**——leaf continuation走的是`register_append`
  的AB11自续约逻辑，不是简单的`authorize_spend(sig)`，是否同样可回收需要单独核实`ShardLeaf_direct`
  相关entry的签名要求，本文档不代为下结论。

### §0.14b mass真实核算（v0.8定稿：NWT分维度节点侧权威数字，账本1489/1490，出处同一份
`docs/provenance/2026-09-16-nwt-proto-v0-settlement-simnet-verify/README.md`@`50019d4f`"追加验证①"）

**背景**：Bettor指出v0.5的推演只算了资金（fee/找零），没有验证"换成不同fee UTXO后，这笔交易真实
mass会不会变、会不会顶到500,000上限"——这是必须补的一环，因为KIP-9 storage mass对输出/输入的**面值**
本身敏感（不只是covenant输出，见MUST-4 v0.6更正），换一个面值不同的fee UTXO，交易的真实mass确实
会变，不能假设"跟NWT那次一样"。v0.6的手算方向错了（详见v0.7的更正记录，此处不重复），v0.8用
NWT新增的`probeMempoolMass`工具（在`submitTransaction`成功、`mineOne`确认前调用真实
`rpc.getMempoolEntry`）取得的**节点侧权威分维度数字**定稿，不再是估算。

**RPC字段映射（NWT逐字段核对过，重要）**：`getMempoolEntry`返回的`transaction.mass`字段
**始终等于**`transaction.storageMass`（8/9笔样本无一例外），不是`max(compute,storage)`合并值；
`computeMass`是独立字段（`verboseData.computeMass`），第9笔样本里`computeMass`(7,750)甚至
**超过**`mass`/`storageMass`(5,555)，证实两者是完全独立的两个维度——**margin判定必须分别核对
两个维度是否都在500,000以内，不能只看`mass`这一个字段**（这本身也是MUST-4 v0.6更正"由构造期
mass计算把关"这句话的具体化：构造期计算不能只看一个数字）。该RPC不暴露独立的transient mass字段，
留作后续观察项。

**8步+1步（输家ticket自我回收）节点侧权威mass表**：

| # | 步骤 | storageMass(=`mass`字段) | computeMass | 二者较大值 | margin(较大值/500,000) | 本地kaspa-wasm对照 |
|---|---|---|---|---|---|---|
| 1 | `market_genesis` | 200,013 | 8,083 | 200,013 | 40.00% | 200,013（完全一致） |
| 2 | `register_append`#1 | 445,518 | 33,927 | 445,518 | **89.10%** | 448,342（本地高出2,824） |
| 3 | `register_append`#2 | 435,969 | 44,198 | 435,969 | 87.19% | 445,350（本地高出9,381） |
| 4 | `convert_to_rootclose` | 385,410 | 60,422 | 385,410 | 77.08% | 395,159（本地高出9,749） |
| 5 | `close_commit` | 194,960 | 35,560 | 194,960 | 38.99% | 198,120（本地高出3,160） |
| 6 | `convert_to_claim` | 384,865 | 48,618 | 384,865 | 76.97% | 394,977（本地高出10,112） |
| 7 | `claim_draw` | 377,634 | 40,407 | 377,634 | 75.53% | 390,434（本地高出12,800） |
| 8 | `KanetTokenClaim.spend` | 184,263 | 29,914 | 184,263 | 36.85% | 194,766（本地高出10,503） |
| 9 | 输家ticket自我回收（见§0.12/§0.14下方） | 5,555 | **7,750（compute占优）** | **7,750** | 1.55% | 814（本地严重低估，只有真实值约1/9.5） |

**核心发现（v0.7方向性猜测的最终定论）**：全部7个非平凡结算步骤，节点权威mass都比本地
kaspa-wasm数字**更低**（低2,824-12,800不等）；但第9步（单covenant输入+单P2PK输出的极简交易）
反过来本地**严重低估**（本地814 vs 真实7,750）——**两种不同交易形状下，kaspa-wasm本地
`calculateTransactionMass`的偏差方向不统一**（复杂covenant交易本地偏高，极简单输入交易本地
偏低）。NWT给出的倾向性解释（供参考，非定论）：本地`calculateTransactionMass`看起来已经内含
一个接近storage mass的计算，不是"只缺一个compute_budget分量"这么简单，v0.6/v0.7把"本地基线
本身有偏差"和"漏算compute_budget"这两件事混成了一个，方向判断反了。**结论：kaspa-wasm本地mass
在任何交易形状下都不可信，不能假设固定方向的修正系数，任何依赖它做margin判断的代码必须换成
`getMempoolEntry`真实核对**。

**最终结论**：**全部9笔（含输家ticket回收）都远低于各自维度的500,000上限，mass安全**；最紧的
是`register_append`#1，真实margin**89.10%**（由storage维度决定，不是v0.6错误手算的93.6%，也
不是v0.7临时引用的"约87-89%"区间——现在是精确数字）；margin最大的一步是spend之后的ticket自我
回收（1.55%，且这一步是唯一compute维度占优的样本，再次印证"必须两个维度分别核对，不能只看一个
字段"这条纪律不是空话）。

**资金结论（含输家ticket自我回收，v0.8更新）**：(A)路线6步执行完毕后relay余额2.260398 KAS
（§0.14主表，未变）；**输家ticket自我回收已被simnet真实ACCEPT**（见§0.12v0.8，`authorize_spend`
签名花费，取回20,000,000−2,000,000(fee)=18,000,000 sompi=**0.18 KAS**，不是v0.7暂记的0.2整数——
回收本身也要付fee）。**路线(A)+回收ticket执行完毕后relay最终余额 = 2.260398+0.18 =
2.440398 KAS**（不是v0.7写的2.460398，那个数字漏扣了回收这笔交易自己的fee）。

**关于回收交易fee选值的核实（Bettor第3问）**：NWT这笔回收实测用的fee是**固定给的2,000,000 sompi**，
不是套用`computeRequiredFeeSompiOrThrow`公式（`SOMPI_PER_MASS(100)×本地mass`）算出来的——若真的
套用该公式，本地mass=814，算出的fee只有814×100=**81,400 sompi**，而真实需要的（按
`max(storageMass,computeMass)×SOMPI_PER_MASS`=7,750×100=**775,000 sompi**）比这个高**近10倍**。
**NWT用2,000,000（比两者都高、留了充分余量）是刻意的保守选择，不是巧合对上了公式**——两者不一致，
且巧的是"公式算出的81,400"比"真实需要的775,000"更危险（会导致这个具体形状的交易fee给不够）。
**这条对生产`buildTicketReclaimTxJson`的直接含义**：**不能直接照抄`computeRequiredFeeSompiOrThrow`
这个复用已久的辅助函数**——它对"单covenant输入+单P2PK输出"这种此前从未出现过的极简交易形状会算出
危险的过低估计（本地mass被低估约9.5倍），必须要么（a）对这个新builder单独加一个安全余量/下限
（同NWT这次的2,000,000做法），要么（b）在合入生产代码前，同样用`getMempoolEntry`对这个具体
新tx形状做一次真实mass核实，不能假设"这个helper函数对其它入口好用、对这个新形状也一样好用"。

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

## §7 实现清单（v0.4新增：结算builder + 意图状态机 + 驱动接线 + relay漏斗命令，账本1482
Bettor要求；v0.8新增第6个builder——输家ticket回收）

**总纪律（适用于本节全部条目）**：每一项实现完成后，**输出的真实字节必须在§0.13的simnet上真实
提交确认，才能合入mainline**——不能只靠单元测试/cli-debugger PASS就合并。simnet ACCEPT是必要
条件，不是可选的加分项（同§0.8第8点对`RootClaim.sil`修复的同一条纪律，适用到全部结算builder）。

### §7.1 六个结算builder（v0.8新增第6个：输家ticket回收）

| # | Builder | 对应entry | 相关MUST | 回归要求 |
|---|---------|----------|---------|---------|
| 1 | `buildMarketSealTxJson`（封盘） | `ShardLeaf_direct.convert_to_rootclose` | MUST-2（广播成功后立即暂存`prepared_tx_json`供下一步用）、MUST-4（新建covenant输出KAS值用`CONTINUATION_OUTPUT_SOMPI`，不用字面`DUST_MIN`） | simnet真实ACCEPT（§0.4④已用审计构造验证过合约逻辑本身可行，生产builder字节需重新过simnet） |
| 2 | `buildCloseCommitTxJson`（resolve） | `RootClose.close_commit` | MUST-1（`lockTime=deadline_ms`+committee input `sequence=0`+提交时须已过deadline）、MUST-2（输入UTXO从封盘`prepared_tx_json`派生、不查链、与封盘背靠背提交） | simnet真实ACCEPT（§0.4⑤已用审计构造验证，debugger离线FAIL不作为验收依据，见§0.13） |
| 3 | `buildConvertToClaimTxJson`/`buildConvertToRefundclaimTxJson`（对称，共用大部分逻辑） | `RootClose.convert_to_claim`/`convert_to_refundclaim` | MUST-4（新建RootClaim/RefundClaim genesis输出KAS值） | `convert_to_claim`：simnet真实ACCEPT（§0.4⑥）；`convert_to_refundclaim`：目前只有debugger PASS，**必须补simnet验证**才能合入（symmetric不代表可以免测） |
| 4 | `buildClaimDrawTxJson`/`buildRefundPayoutTxJson`（对称） | `RootClaim.claim_draw`/`RefundClaim.refund_payout` | 若走(B)：§0.8修复完成后须用真实partial形状回归；full分支已有§0.4⑦simnet证据 | `claim_draw`(full)：simnet真实ACCEPT（§0.4⑦）；`claim_draw`(partial)：**阻塞于§0.8修复**，修复前不得合入；`refund_payout`(full/partial)：目前只有debugger PASS，需要补simnet验证 |
| 5 | `buildWithdrawTxJson`（提现） | `KanetTokenClaim.spend` | 无（`.sil`头注"不受V-T-8影响"，本身不涉及自续约） | simnet真实ACCEPT（§0.4⑧） |
| 6 | `buildTicketReclaimTxJson`（v0.8新增：输家/任意bettor自行回收自己ticket的0.2 KAS） | `PoolSideTicket.authorize_spend`（单输入该ticket UTXO+单输出付给bettor自己指定地址，`kaspa.createInputSignature`真实签名，不经过`RootClaim`/`RefundClaim`） | **无既有MUST覆盖，v0.8新增一条**：这个"单covenant输入+单P2PK输出"的极简交易形状，**不能直接复用`computeRequiredFeeSompiOrThrow`算fee**——该辅助函数依赖kaspa-wasm本地mass，对这个具体形状本地mass被低估约9.5倍（本地814 vs 真实7,750，见§0.14b），会算出危险偏低的fee（81,400 sompi vs 真实需要775,000 sompi）；必须加安全余量或用`getMempoolEntry`对这个新形状单独核实 | simnet真实ACCEPT（§0.12/§0.14b"追加验证②"，NWT用真实`authorize_spend`签名广播成功，取回18,000,000 sompi）——生产builder字节仍需重新过simnet，审计构造的ACCEPT同样不能直接当生产验收凭证（同①-⑤的既有边界） |

**审计构造→生产builder的落码提醒**：§0.4表④⑤⑥⑦⑧五步目前用的是NWT的**审计构造**（非生产
builder），只证明了"合约逻辑在真实共识上可执行"；上表每个builder落码后，必须用**生产字节**重新
在simnet跑一遍，不能直接复用审计构造的ACCEPT结果当验收凭证（§0.4"审计构造结论的地位"已强调过
这条边界，此处重申适用到具体实现工作）。

### §7.2 意图状态机（§2既有设计，本节只列与本轮新发现相关的更新点）

- 状态机的`pending→prepared→submitted→landed/ambiguous`模式（§2）不变；**新增**：`prepared`态
  必须携带完整`prepared_tx_json`（不只是`prepared_txid`），供MUST-2的"背靠背+不查链"派生使用——
  这是本轮新增的字段完整性要求，之前的意图表设计可能只按惯例存了txid。
- `resolve`（`close_commit`）与`market_seal`两步在状态机里需要标记为"背靠背对"（一个逻辑单元，
  中间不能被别的操作打断），不是两个独立的、可以任意顺序/任意时间执行的普通步骤。

### §7.3 驱动接线（触发/轮询逻辑）

- `market_seal`的触发条件`count==seal_count`已有（§1.1），驱动逻辑本身不变；**新增CLTV约束**
  （MUST-1）：`close_commit`/`refund_flip`的驱动逻辑必须先检查"当前时间是否已经真实超过
  `deadline_ms`（`refund_flip`为`+7,200,000`）"，未到时间点提交会被节点`NotFinalized`直接拒收，
  驱动逻辑应该在拒收之前就做好这个前置检查，不要依赖"广播失败再重试"这种被动模式。
- `claim_draw`驱动逻辑触发前需要判断走full还是partial分支（§0.7路线判断）——(B)路线修复前，
  驱动逻辑遇到partial场景应该**直接拒绝构造**（同§7旧版"中止条件"里"立即停止，不允许先广播试试看"
  的既有纪律，移到这里延续）。

### §7.4 relay漏斗命令（IPC/命令类型注册）

- 六个结算builder（含v0.8新增的ticket回收）对应的命令类型需要在`kasia-relay/src/lib/commands.mjs`里注册（同现有
  `register_append`等命令的既有模式），**必须同时在`COMMAND_FIELD_TYPES`里注册对应字段类型**——
  本仓lint（`R-COMMAND-REGISTRATION`）现有WARN规则专门抓"命令类型注册了但字段类型没注册"这种
  半截注册，新增命令类型必须两处同步登记，不能只加一半。
- committee签名（`close_commit`）与bettor签名（`claim_draw`消费ticket，见§1.3"待NWT核实的技术点"）
  这两类"非fee input"的签名，需要在漏斗命令层面明确区分签名者身份（不能全部走`signOnlyDeclaredInputs`
  的默认fee签名路径），具体接线方式留给NWT实现时按现有`covenant-broadcast.mjs`的既有扩展模式决定，
  本文档不代为设计具体API形状。

## §8 主网执行页草案（v0.4更新：close_commit阻塞解除、精确参数、simnet闸前置条件）

**前提（simnet闸，账本1482——§0.13）**：本节所有步骤上主网广播前，必须先满足§0.13的simnet真实
全链共识验证闸——用生产builder构造的真实字节在simnet（真实kaspad 2.0.1，版本/sha256核对过与主网
一致）上真实提交并确认。debugger审计（本文档§0全篇）是开发期定位`require()`链具体断言失败位置的
工具，不是上主网的充分依据（§0.13闸内容第3点）。**`close_commit`/`KanetTokenClaim.spend`已由NWT
的审计构造simnet验证ACCEPT（§0.4/§0.13结果），但生产builder落码后仍需用生产字节重新过一遍simnet
——审计构造的ACCEPT不能直接当生产验收凭证（§7.1已强调）**。

**执行步骤**（走(A)路线，`a59c7b48`继续用，精确参数见§0.7"（A）路线精确参数"）：

1. **确认市场状态**：`a59c7b48` betting，count=1。第二笔下注**押NO，stake=999**（不是同一方，
   §0.7 v0.2校正；精确数字见§0.7"(A)路线精确参数"——NWT已用这个精确组合在simnet全链验证过）。
2. **`market_seal`**：`count==seal_count`时触发。验收：`proto_markets.status→sealed`,
   `rootclose_txid/vout`写入，链上核对RootClose UTXO存在、代币金额==pool_value；生产builder字节
   须先simnet ACCEPT。中止条件：广播失败不推进status（NO-TX-NO-STATE），leaf仍可重试。
   **MUST-2**：广播成功后立即把`prepared_tx_json`暂存供下一步`close_commit`直接派生输入UTXO用，
   不依赖后续查链。**MUST-4**：新建covenant输出KAS值用`CONTINUATION_OUTPUT_SOMPI`
   （20,000,000 sompi），不能用`.sil`注释字面`DUST_MIN`（1000 sompi），否则storage mass爆炸
   （§0.11 MUST-4）。
3. **`resolve`（`close_commit`）**：操作员传`outcome=YES`。**须与`market_seal`背靠背提交**
   （MUST-2）：输入UTXO从上一步暂存的`prepared_tx_json`派生，不查链。**builder必须显式设置
   `lockTime=deadline_ms`，committee签名input的`sequence`取`0`，且提交时节点当前时间必须已经
   真实超过`deadline_ms`**（MUST-1 v0.4精确规则——`a59c7b48`的deadline已过，现在满足这个前提）。
   验收：`close_commit`广播成功且生产字节已过simnet真实共识确认，`proto_markets.status→resolved`,
   `winning_side`/`payout_root`落库且与独立重算值一致（§4）。中止条件：委员私钥解密失败/签名验证
   失败——fail-closed，不允许"跳过签名校验直接推进status"这种降级。
4. **`convert_to_claim`**：验收：RootClaim genesis成功，代币全额转入；生产builder字节须先simnet
   ACCEPT（§0.4⑥已有审计构造证据）。**MUST-4**同上，新建RootClaim genesis输出KAS值同样不能用
   字面`DUST_MIN`。
5. **`claim_draw`**：验收：KanetTokenClaim genesis成功，`proto_claims`记账（`claim_txid`/`amount`），
   `payout=1000==pool_value`走full分支（无续约，§0.7精确参数）；生产builder字节须先simnet ACCEPT
   （§0.4⑦已有审计构造证据）。中止条件：若发现实际场景需要partial续约（payout<pool_value）——
   **立即停止，回退到§0.7路线判断，走(B)前须先完成§0.8的`RootClaim.sil`修复**，不允许"先广播
   试试看"（partial续约的代码路径仍是§0.5②确诊的真实缺陷，未修复前不能用）。
6. **`withdraw`**：验收：赢家提现成功，`proto_claims.withdrawn_at`/`withdraw_txid`落库；生产
   builder字节须先simnet ACCEPT（§0.4⑧已有审计构造证据，v0.3的"待定"已解除）。

**通用中止条件（所有步骤）**：任何一步的`net_loss`/`SIGNED_INPUT_CEILING_SOMPI`检查失败——fail-closed
报`no_suitable_fee_utxo`或`net_loss超限`，不允许放宽阈值"让它先过"；proto relay余额检查
（`assertProtoRelayHealthy`，`covenant-construction-spec-v0.1.md` §9.1）必须在每一步广播前重新核实，
不是只在流程开始时查一次；`refund_flip`的builder同样必须显式设置`lockTime=deadline_ms+7,200,000`+
committee input `sequence=0`（MUST-1），且执行页需要向操作员明示MUST-3的风险（deadline+2h后任何人
都可触发refund_flip，不受权限控制——`a59c7b48`的这个窗口目前也已经满足，理论上任何人现在都能提交，
见§0.11 MUST-1）；任何新建covenant输出必须遵守MUST-4的KAS值下限，不能取字面`DUST_MIN`。

**资金充足性**：(A)路线剩余6笔交易的fee UTXO选择、找零合规性、执行完毕后剩余资金，见§0.14"主网
资金推演"——结论是资金充足，无缺口（6步执行完毕2.260398 KAS，加上输家ticket自我回收
[已simnet ACCEPT，见§0.12/§7.1] 净得0.18 KAS，最终**2.440398 KAS**）；mass已由NWT用节点侧
`getMempoolEntry`权威分维度数字逐步核对，全部9步（含ticket回收）安全，最紧的是`register_append`
#1，真实margin**89.10%**（由storage维度决定，精确分维度数据见§0.14b）。

**Owner需要在实现前先拍板的问题（汇总，本文档不代为决定）**：

- §0.7：(A)还是(B)？（v0.4更新：(A)已有simnet真实共识确认的精确参数可直接执行，不再受
  close_commit不确定性阻塞；(B)仍需先完成§0.8修复）
- §0.7括号内：v0业务规则是否要求"同一市场支持2个不同payout值的赢家各自claim"，还是"赢家通吃/份额
  加总一次性发放"就够？这直接决定(A)是否真的适用，不只是"能不能技术上跑通"的问题。
- §0.8：`RootClaim.sil:103 require(payout>=1000)`的修法选项a/b/c，Owner/Bettor需要确认选哪个
  （本文档倾向选项b，仅供参考）。
- §0.9已解决：`RefundClaim.refund_payout`确认安全，走(B)不需要动它，只需修`RootClaim.sil`。
- §0.12：新市场的deadline/grace时长与`refund_flip`的触发权限（合并选项组）——这一组仍需Owner拍板；
  输家ticket能否自行回收已由simnet确认（能，见§0.12v0.8），不再是需要Owner决策的技术不确定性，
  剩下的是"要不要做这个回收builder/要不要引导用户使用"这个纯产品优先级问题。

---

## 附：本次审计产出的工具（v0.2：已从`kasia-console/scratch/j2_settlement_audit/`移到
`kasia-console/scripts/audit/`——`scratch/`是gitignored目录，审计工具是长期可复用资产，不该待在
一次性目录里；账本1479 Bettor要求，供NWT复核/复用，未进`src/lib`）

**方法论新增两条断言（账本1479/1482要求，此后每次跑新入口的真实执行审计都必须显式检查，不能只看
"PASS/FAIL"这一个信号）**：
1. **debugger内部重建的`active_sigscript`必须逐push解码后与我方显式提供的`signature_script_hex`
   逐字节比对，不能只比总长度**——§0.10最初只看到`close_commit`的`active_sigscript`重建长度
   （3,618字节）与我方构造长度（20,423字节）相差5.6倍，一度误判为"main.rs重建路径整体没对"；
   NWT逐push解码后发现前16个push（pubkey、真实签名、全长`tok_suffix`）逐字节相同，长度差恰好等于
   explicit hex末尾一段16,802字节的`RootClose` redeem push——debugger自己编译`.sil`产出的redeem
   与我方携带的生产redeem字节本来就不该长度相同，这是**预期差异**，不是bug。**教训：总长度不一致
   不能直接下"重建路径错误"的结论，必须先逐push拆开比对，排除"两边redeem脚本本来源头就不同"这类
   结构性预期差异，再看剩余部分是否真的不一致**。
2. **`lock_time`必须核实位于`test.json`的`tx`对象内部，不是顶层**——§0.10的`refund_flip`初次FAIL
   就是这条坑（见MUST-1/ANTI-PATTERNS候选②），此后写任何新的test.json前先grep自己的脚本确认
   `lock_time`的嵌套位置，不要等到CLTV报错才回头查字段位置。
3. **自检/回归比对必须至少有一侧是独立可信来源，不能是"两份自己写的实现互相比"**（账本1480教训，
   ANTI-PATTERNS候选见规则84同族补充）——账本1473的双重hex编码bug之所以能存活一整轮审计，正是因为
   `00_self_check_generic_encoder.mjs`比对的是"通用编码器"与"`register_append`专用编码器"两份都由
   本轮/前几轮自己写的实现，两者共享同一个`Buffer.from(drain())`错误封装，比对出"完全相同"的假阳性
   PASS；真正发现bug是靠eprintln转储**debugger自己内部**的真实构造这个独立来源做比对，才发现长度
   减半的矛盾。此后任何自检脚本，如果两侧都是"我方自己写的代码"，其PASS只能证明"两份实现互相一致"，
   不能证明"两份都对"——必须至少有一侧换成debugger内部真实状态（eprintln转储）或simnet真实广播结果
   （见§0.13）这类独立于我方编码逻辑的来源，才能真正验证正确性。

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
