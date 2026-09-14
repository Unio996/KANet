# V-T-8：`readInputStateWithTemplate` + `validateOutputState`（同函数内共存）运行期必崩

架构级 silverc 工具链限制，落 `PayoutShard.absorb`（读输家片代币状态 + 续本 PS 自身 State）时首次撞上，
Bettor ledger 1140 记为 V-T-8，判定同意（架构级）。9 个探针逐步排除变量，定位到最小复现（`AbsorbProbe8.sil`，
仅 8 行函数体）。

## 现象

同一个 `entry` 函数体内，只要**同时出现** `readInputStateWithTemplate(...)`（读外部合约状态）和
`validateOutputState(...)`（本合约自身 `State` 续约），后者运行期必崩：
`error: -NNN cannot be used as an array index`（N 每次不同 —— 明显是编译期算错了某个偏移量，不是业务层
`require` 拒绝；且发生在 `validateOutputState` 这一行本身，函数体内此前的 `require` 语句全部已经通过）。

## 隔离矩阵（每个探针只改一个变量）

| 探针 | 内容 | 结果 |
|---|---|---|
| `AbsorbProbe2.sil` | 仅 `readInputStateWithTemplate` + `validateOutputStateWithInputTemplate`（都是"外部模板"类）, 无自身 State 续约 | **PASS** |
| `AbsorbProbe3.sil` | 上一条外加 `scanOwnedTokenInputs()` 循环(内部也调 `readInputStateWithTemplate`) | **PASS** |
| `AbsorbProbe4.sil` | Probe3 基础上加回 `validateOutputState`(自身 State 续约, 完整复刻 absorb 真实形状) | **FAIL(崩)** |
| `AbsorbProbe5.sil` | Probe4 交换 `validateOutputState` 与 `validateOutputStateWithInputTemplate` 的顺序 | **FAIL(崩, 与顺序无关)** |
| `AbsorbProbe6.sil` | Probe4 把 `validateOutputStateWithInputTemplate` 换成 `validateOutputStateWithTemplate`(ctor 烤 prefix/suffix, 非复用输入字节) | **FAIL(崩, 换哪种"外部模板"原语都一样)** |
| `AbsorbProbe7.sil` | 去掉 `scanOwnedTokenInputs()` 循环, 只留一次裸 `readInputStateWithTemplate` + 两种 validate 调用 | **FAIL(崩, 循环不是必要条件)** |
| `AbsorbProbe8.sil`（**最小复现**） | 仅 `readInputStateWithTemplate` 一次 + `validateOutputState` 一次, 删掉中间的 `validateOutputStateWithInputTemplate`, 8 行函数体 | **FAIL(崩)** |
| `AbsorbProbe9.sil` | Probe8 交换两次调用的顺序(先续约后读, 反过来) | **FAIL(崩, 与顺序无关, 排除"读之前/之后"假设)** |
| `VOSWITProbe.sil` | 单独验证 `validateOutputStateWithInputTemplate` 本身在无 `readInputStateWithTemplate`/`validateOutputState` 陪同时能正常工作(对照组) | **PASS** |

**结论**：`validateOutputStateWithInputTemplate`/`validateOutputStateWithTemplate` 单独用没问题；
`readInputStateWithTemplate` 单独用没问题；**两者(任一"外部读"+`validateOutputState`"自身续约")同函数内共存
就崩**，与调用顺序、是否套循环、走哪种外部模板原语（复用输入字节 vs ctor 烤死）均无关——精确锁定在
"读一次外部状态 + 续一次自身 State"这个组合本身。

## 影响面（架构级，非局部实现细节）

T3 §2 表里凡是"A 类既要读外部代币输入状态、又要续自己 State"的入口都会撞这条——`PayoutShard.absorb`（本次
撞点）之外，`claim`/`refund_claim`/`claim_draw` 等含代币化续约分支的入口若未来也要在同一函数体内读外部代币
状态，理论上同样会踩。这不是某一处代码写错，是这条组合本身在当前 silverc（`scratch/_j2_silverc_v100`）里
不可用。

## 绕路探针 AB10（死路，Bettor 1142 采纳记账）

`AbsorbProbe10.sil`：自续约改用 `validateOutputStateWithInputTemplate(selfOut, State{...},
this.activeInputIndex, own_prefix_len, own_suffix_len, own_tmpl_hash)`——**同样崩**（同一类
`-N cannot be used as an array index`）。说明范围比最初报的更窄：AB2/AB3 能过是因为它们的
`validateOutputStateWithInputTemplate` 指向的是**别的输入**(shard)，不是这个原语家族本身没事；一旦
`templateInputIndex` 指向 `this.activeInputIndex`（自己），同样触发崩溃。

且这条路径**概念上就走不通**，不只是这次绕不过去：`own_tmpl_hash` 作为 ctor 值会被烤进自身前缀里，
`template_hash = blake3(前缀+后缀)` 这个函数的输入包含它自己的输出，等于要解自指方程
`hash(...x...) == x`，是哈希函数原像问题的量级，没有可行的迭代求解路径。

## 绕路探针 AB11（**通路，已验证**）

`AbsorbProbe11.sil`：完全不走任何"状态编码"内置原语（不用 `validateOutputState`/
`validateOutputStateWithInputTemplate`/`validateOutputStateWithTemplate` 做自续约），改为手写等价形式：

1. **State 字段编码格式**（逐字节实测确认，`AbsorbProbe8_real.compiled.json` 的 `state_span` 字节转储）：
   `int` 字段 = `0x08`(push 8 字节) + 8 字节小端值；`byte[32]` 字段 = `0x20`(push 32 字节) + 32 字节原样。
   与 `PayoutShardV2.sil` `zk_handoff` 里已有的手写 `stateBytes` 构造手法完全一致（并非新发明）。
2. **借用自身 prefix/suffix**：不需要把"自身模板 hash"塞进 ctor（AB10 的死路）——直接从
   `tx.inputs[this.activeInputIndex].sigScript`（当前执行脚本自己的完整字节码）里切片借出
   `ownPrefix`/`ownSuffix`，只替换中间的 state 字节区段。`OWN_PREFIX_LEN`/`OWN_STATE_LEN` 是**编译期常量**
   （取决于本合约源码结构 + ctor 里各动态 `byte[]` 字段的**长度**，不取决于其内容值——同一份源码 + 同一套
   模板长度选择，这两个数跨实例不变），本探针用 `AbsorbProbe8_real` 的真实编译产物实测值硬编码
   （`OWN_PREFIX_LEN=1`, `OWN_STATE_LEN=51`）。
3. 重算 `blake2b(ownPrefix + newStateBytes + ownSuffix)` → `new ScriptPubKeyP2SH(...)` → 与
   `tx.outputs[selfOutIdx].scriptPubKey` 比对。

**向量**：`AB11_pass`(正确续约金额 150) **PASS**；`AB11_fail_wrong_amount`(续约金额故意错填 130) **PASS**
(按预期拒绝，证明不是空判据)。**这条路完全绕开了 V-T-8 的崩溃组合，是当前唯一验证通过的绕路**。

**部署时的代价**（如实记录，不是零成本）：`OWN_PREFIX_LEN`/`OWN_STATE_LEN` 必须按每个合约文件的**实际编译
产物**重算并硬编码（不能塞进 ctor，见 AB10 死路论证）——换一次源码结构或换一次外部模板（如
`token_prefix`/`token_suffix`）长度选择，都要重新编译、重新量、重新硬编码这两个数。State 字段列表本身也要
跟着 `OWN_STATE_LEN`/`newStateBytes` 手写编码同步维护，不再是声明式的 `State{...}` 字面量那么省心。

## 处置状态

Bettor ledger 1140/1142：记为 V-T-8，架构级，判定同意；AB10 死路论证已采纳；**AB11 已验证是可行绕路**。
是否在 pinned silverc 分支上修复 `validateOutputState`（让声明式写法重新可用），还是接受 AB11 手写形做
生产写法，等 NWT 判定（NWT 并行定位 silverc 源码）。
