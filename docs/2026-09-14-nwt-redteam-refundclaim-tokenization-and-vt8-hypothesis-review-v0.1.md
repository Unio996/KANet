# NWT 红队复核 · RefundClaim③代币化(`6bc8ff55`) + V-T-8反例根因排查

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1170：①独立复现6向量+两条caret；②ClaimState五字段派生绑定；③V-T-8反例(bytecodeSize假说是否
> 一致，对照PayoutShard的bytecode_length)；④调试器genesis-covenant-id坑是否让向量失真。

## 结论：**GREEN，但②发现一处文档措辞不准确（不是代码缺陷）；③我自己动手构造反例，推翻了我自己此前的
bytecodeSize不动点假说——用三组独立实验把它排除，根因目前仍未定位到精确点，如实报告排除过程而非猜测；
④确认调试器坑不影响脚本层实际观察到的语义，独立读了pinned源码验证。**

## 一、①独立复现6向量 + 两条caret

字节级重编译与`RefundClaim.compiled.json`一致（`bytecode_length=2656`）。6条向量独立跑通6/6 PASS。

**两条关键负向量caret独立确认**（翻转expect逼出verbose）：
- `V-RC-TOK-3`（目的地假claim模板）：failed at `validateOutputStateWithTemplate`调用行，跟README描述一致。
- `V-RC-TOK-4`（owner改道）：failed at `validateOutputStateWithInputTemplate`调用行，跟README描述一致。

## 二、②ClaimState五字段派生绑定——GREEN，但README对ZERO32守卫"为什么安全"的解释不准确

**先独立读了pinned rusty-kaspa源码**（`crypto/txscript/src/covenants.rs`，musl-toolchain-v1-91-g4d0a9e30，
`/d/rusty-kaspa-da`），确认协议层的真实机制：`TransactionOutput.covenant: Option<CovenantBinding>`是一个
跟`script_public_key`**完全独立**的字段——一笔输出可以有正确的、匹配某模板的`script_public_key`，同时
`covenant`字段是`None`（没声明任何covenant绑定）。`OpOutputCovenantId`读到的就是这个独立字段（`.unwrap_or
(ZERO_HASH)`），跟输出的脚本字节匹配与否无关。

**据此我自己独立构造了一条对抗向量**（复用`V-RC-TOK-2`的真实通过向量作模板，把`claimOutIdx`那个输出的
`covenant_id`/`authorizing_input`字段整个删掉，但**保留完全正确、匹配真实KanetTokenClaim编译产物的
`script_hex`**）——独立运行确认这条被拒绝，翻转expect逼出verbose确认**失败行精确落在`require(claimCovId
!= ZERO32)`那一行**（`105:106`），不是落在`validateOutputStateWithTemplate`那一行。

**这证明**：README里"独立验证=紧跟着的`claim_tmpl_hash`结构性核对本身（裸输出通不过那条模板匹配）"这句
**技术上不准确**——`validateOutputStateWithTemplate`检查的是`scriptPubKey`字节，跟`covenant`字段是两个
独立维度，一个"裸输出"完全可以有正确的`scriptPubKey`同时`covenant`字段是`None`，那条模板匹配本身**拦不住**
这个情形。**真正拦住它的、唯一的、不可或缺的防线是那一行显式的`!= ZERO32`require**——代码本身完全正确
（守卫的位置、时机、条件都对），只是commit/README对"为什么安全"给出的机制解释有误，值得纠正，避免以后
有人照着这句错误解释在别处"觉得模板匹配本身就够了"而漏掉显式的ZERO32检查。

**处置建议**：代码不需要改，建议README那一句"独立验证=claim_tmpl_hash核对本身"改成"独立验证=这一行显式
`!=ZERO32`本身，跟后面的`claim_tmpl_hash`模板匹配是两条独立防线（前者防裸输出/未声明covenant，后者防
"声明了某个真实covenant但脚本字节不是真KanetTokenClaim"）"，如实记录两条防线各自防什么，不合并成一条。

## 三、③V-T-8反例——推翻我自己此前的假说，三组独立实验排除法，根因未定位（如实报告）

**我此前的假说**（本会话早前基于`compile.rs:97-105`一个32轮自指定点收敛循环的观察提出）：崩溃跟这个
编译期`bytecode_size`不动点收敛失败有关。**这次用三组独立实验逐条排除，假说不成立**：

**实验①：编译期收敛本身跟运行期崩溃无关**——独立编译最小复现`AbsorbProbe8.sil`（V-T-8既有最小复现文件），
编译期debug输出显示不动点收敛**干净完成**（`100→594→596→596`），跟`RefundClaim.sil`（不崩）的收敛模式
（`100→2654→2656→2656`）**形状完全一样**——两者编译阶段都顺利收敛，但一个运行期崩、一个不崩。**编译期
不动点收敛跟运行期是否崩溃没有关联**，我此前的假说定位错了阶段（真正的崩溃是运行期`-N cannot be used as
an array index`，不是编译期产物）。

**实验②：ctor烤死 vs witness供——不是决定因素**。我照着`AbsorbProbe8.sil`（`token_prefix`/`token_suffix`
是ctor常量）手写了一个单变量对照版本`AbsorbProbe8Witness`（唯一改动：把这两个字段从ctor搬成entry函数参数，
运行期witness供），其余逐字不变——**独立编译+运行，同样崩溃**（`-949 cannot be used as an array index`，
同一行）。排除"ctor烤死大字节数组扰乱自身state_span探测"这个假说。

**实验③：if分支包裹——不是决定因素**。把`AbsorbProbe8.sil`的`validateOutputState`调用包进一个
`if(shard_amount>0){...}`（无else，同`f8e95e35`/本次`RefundClaim③`draw-down分支的"只有then分支"形状）——
**独立编译+运行，同样崩溃**。排除"包进条件分支能避开"这个假说。

**bytecode_length对照（Bettor明确要求）**：`RefundClaim.sil`（不崩）`2656`字节，比崩溃的最小复现
`AbsorbProbe8.sil`（`596`字节）**大约4.5倍**——文件更大反而不崩，跟"文件小/简单才崩"这类朴素猜测方向
相反，**bytecode体积本身不是判别变量**。（`PayoutShard`/`PayoutShardV2`目前用AB11绕开了这个组合，它们
现在的编译产物已经不含`validateOutputState`自续约调用，不是同一件事的直接对照对象，不能拿它们现在的
`bytecode_length`跟崩溃与否做因果比较——这条我之前理解有误，这次订正。）

**如实报告**：**排除了三个具体假说，但没能定位到精确根因**。真正的差异变量可能在`readInputStateWithTemplate`
+`validateOutputState`组合之外还牵扯别的东西（调用总数？特定原语的排列组合？某个具体的字节偏移量数值巧合
落在正/负分界线两侧？），**继续猜测式排除法边际收益已经很低，需要真正读silverc对应运行期字节码生成/解释
路径的Rust源码才能钉死**——这不是本轮该做的事（Bettor之前明确指示不读silverc源码去定位，交NWT并行核实
"反例"这件事本身，不是要我去读源码钉根因）。**结论：`refund_payout`这个具体组合实测安全（6/6独立复现确认），
但它"为什么安全、跟AbsorbProbe8的具体差异在哪"仍是未解之谜，不建议再投入更多探针式排除法，如果以后真的
需要钉死根因，建议直接读silverc运行期解释器里处理`validateOutputState`自续约的那段代码，不要再靠黑盒排除**。

## 四、④调试器genesis-covenant-id坑——不影响脚本层观测语义，独立读源码确认

独立读`covenants.rs::from_tx`确认：genesis covenant_id的密码学重算（`hash(previous_outpoint, output_set)`）
是**consensus层**（整笔交易是否合法）的检查，**完全在covenant脚本执行之前、且脚本本身从不参与这个重算**——
脚本能读到的只是`OpOutputCovenantId`回显的**声明值**本身，不关心这个值是通过"genesis重算路径"还是"continuation
等值路径"被认定合法的。测试夹具用"续约形式技巧"（哑元输入声明同值+authorizing_input指向它，走continuation
分支跳过重算）只是绕开了**调试器要不要在测试环境里正确模拟这条consensus级重算**这个工具局限，**不影响脚本
逻辑观察到的`covenant_id`取值本身**——脚本看到的值，跟这个值背后是走genesis重算还是continuation等值确认的，
是两件事，前者才是脚本逻辑真正依赖的东西。**结论：不失真，向量可信**。

## 五、给Bettor的处置建议

- **`6bc8ff55` GREEN，可以定案**。
- ②建议README措辞订正（不是代码缺陷，一句话说清两条防线各防什么）。
- ③已排除三个具体假说（编译期不动点收敛无关/ctor烤死无关/if分支无关），根因未定位，建议不再投入探针式
  排除法，如需彻底钉死需要读silverc运行期解释器源码——这条不阻塞任何在跑的业务代码（RefundClaim③实测安全）。
- ④确认不失真。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
