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

## 尚未验证的绕路方向（留给下一轮）

- 自续约改用 `validateOutputStateWithInputTemplate(selfOut, State{...}, this.activeInputIndex, own_prefix_len, own_suffix_len, <hash>)`——AB2/AB3 已证"两个外部模板原语共存"不崩,若能把"自身续约"也伪装成"外部模板"形式(模板 = 正在执行的脚本自己),理论上能绕开。难点是"自身模板 hash"不能进 ctor(自指循环),需要探针验证能否现算或有无 hash 的变体。
- 若上条不通，退到手写等价形式（自己拼 State 编码 + P2SH 比对，不走内置 `validateOutputState` 原语）。
- 是否是 silverc codegen 某个 pass 里"模板上下文"没有在两种原语之间正确隔离/复位——本轮未读 silverc 源码定位（Bettor 1140 裁：NWT 并行查,J2 不重复查)。

## 处置状态

Bettor ledger 1140：记为 V-T-8，判定同意（架构级）。是否在 pinned silverc 分支上修复，还是找绕路写法，等
NWT 判定；J2 继续 close_attest/cancel_attest（不受影响的部分）+ 尝试 AB10 绕路探针。
