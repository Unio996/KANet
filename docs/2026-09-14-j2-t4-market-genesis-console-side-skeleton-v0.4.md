# T4 · 增补稿 v0.4（NWT 确认 (c)+(d) 无安全回退附两条要求：tripwire + predicate_commit 措辞）

> **Status**: DRAFT-FOR-REVIEW v0.4（2026-09-14 · J2 · ledger 1203 派发，承接 T4 v0.3，只增补两节，不改动
> v0.3/v0.2 其余内容。输入：NWT 对 v0.3 §3 裁定②（`poolMerkleRoot`/`committee_hash`/`predicate_commit`
> 保持 ctor-only，走 (c)+(d)）的复核结论——**确认无安全回退，附两条要求**）

## 0. 一句话

NWT 复核 T4 v0.3 §3 的裁定②（三字段保持 ctor-only、靠步骤 (c) 全字节重编译比对 + (d) P2SH 重算覆盖，
放弃 cheap-tier）后确认**这个结论本身没有安全回退**，但指出两点必须写清楚：① 这个结论成立的**唯一前提**
是"这三个字段在全部 T3 合约里永远没有被赋值"——这是一个**当前为真、但未来可能被打破**的事实（不是协议
层不可能发生的事），需要一个 tripwire（本稿加硬性注释 + 写一个 lint 钩子方案，钩子实现另派）；②
`predicate_commit` 目前只是一个"防篡改占位"，不是"正在生效的赔付判定门"，本稿之前和 v0.3 都没把这层区分
写清楚，本次补上措辞更正，避免接位者读错。

## 1. Tripwire：论证的唯一前提是"零赋值"，且这是运行期可能被打破的事实（NWT 要求①）

### 1.1 前提的精确表述

T4 v0.3 §3 裁定②"`poolMerkleRoot`/`committee_hash`/`predicate_commit` 保持 ctor-only，靠 (c)+(d) 覆盖即
可，不需要 cheap-tier"——这个结论的**全部安全性**建立在一个单一事实上：

> **这三个字段在 T3 主网集全部 8 个（含 `PayoutShard`/`PayoutShardV2`/`RootClose` 三个真正持有这些字段的
> 文件）`.sil` 合约的入口体内，从未出现过 `poolMerkleRoot = ...`、`committee_hash = ...`、
> `predicate_commit = ...` 这类赋值语句——它们只在 ctor 参数列表里出现一次，此后作为只读常量被
> `require(...)` 语句读取比对，永远不会被合约自身的运行期逻辑改写。**

这句话现在（截至本稿撰写时的代码状态）是**真的**——J2 独立 `grep`、NWT 独立 `grep`，两次都是**零命中**
（见 §1.2）。但这是一个**代码事实**，不是**协议层不可能违反的公理**——`silverscript` 语法完全允许一个
`byte[32]` 状态变量存在赋值语句（`RootClose.sil` 的 `payoutRoot`/`local_yes` 等其它字段就是这么写的），
如果未来任何一次改动（哪怕看起来无关的改动）不小心给这三个字段之一加上了赋值语句（让它们变成可变
state），**T4 v0.3 §3 裁定②的整个论证前提就被推翻**——那时候 (c)+(d) 单独覆盖就不够了，必须回到"搬进
state + cheap-tier 位点比对"那条路（T4 v0.3 §3 的路径 1），而如果没有人注意到这个前提被打破，T4 的对照
检查会继续假装自己覆盖到了这三个字段，实际上覆盖不到——这正是需要 tripwire 的原因。

### 1.2 当前状态的独立验证记录

```
grep -n "poolMerkleRoot\s*=[^=]" kasia-console/src/lib/*.sil   → 0 命中
grep -n "committee_hash\s*=[^=]" kasia-console/src/lib/*.sil   → 0 命中
grep -n "predicate_commit\s*=[^=]" kasia-console/src/lib/*.sil → 0 命中
```

（J2 2026-09-14 本次独立复核；NWT 同日独立复核，结论一致——两次核对都是在 T3 v0.3/v0.4 代币化 + 批次④
+ hand-off MUST-FIX 全部落码之后的最终代码状态上跑的，不是某个中间提交。）

### 1.3 lint 钩子方案（只写设计，实现另派）

**规则名**（建议）：`R-CTOR-ONLY-ASSIGNMENT-TRIPWIRE`

**触发条件**：对 `kasia-console/src/lib/**/*.sil`（含未来新增的市场合约文件，不限定当前 8 个文件名单，
理由见下）逐文件扫描，若匹配到以下任一模式（正则示意，具体实现由派工方按 `lint-kanet.mjs` 现有规则的
写法风格定）：

```
/\b(poolMerkleRoot|committee_hash|predicate_commit)\s*=(?!=)/
```

——即变量名后紧跟单个 `=`（排除 `==` 比较），命中即视为"这个字段被赋值了"。

**触发后行为**：`error` 级别（阻断 commit，同 lint-kanet 现有 error 级规则的处理方式），提示信息里写明：
"检测到 `{字段名}` 出现赋值语句于 `{文件}:{行号}`——这个字段之前被 T4 创世对照设计（`docs/2026-09-14-j2-
t4-market-genesis-console-side-skeleton-v0.3.md` §3）认定为『永远 ctor-only、靠 (c)+(d) 全字节比对覆盖，
不需要状态区位点比对』，这个赋值语句打破了那条论证的前提——**这不是一个可以直接绕过/加白名单跳过的
warning，必须先叫 NWT 复核这次改动是否需要重新设计 T4 的覆盖路径（回到搬进 state + cheap-tier 那条路），
复核通过后才能改这条 lint 规则本身或加例外**"。

**为什么不限定当前 8 个文件名单**：T3 的封闭集合本身有过"7→8"的演进（`RefundClaim` 后补，v0.4 收口）——
如果这个 lint 规则只硬编码当前 8 个文件名，未来第 9 个市场合约文件出现时这条 tripwire 就形同虚设。规则
应该扫**全部** `.sil` 文件（不管是不是当前已知的市场合约），对字段名做匹配而不是对文件名做白名单——
成本可忽略（3 个正则 × 全部 `.sil` 文件，扫描量很小），换来的是"新文件也自动受保护"。

**已知的假阳性来源（实现时需要处理，不是本稿要解决的）**：
- 注释里提到这几个字段名但不是真赋值（例如本稿这段文字如果被扫到——但 lint 规则只扫 `.sil` 不扫
  `.md`，不会有这个问题）；`.sil` 文件内部的注释行如果提到"`predicate_commit = xxx`"这种字面文本（目前
  没有这种注释，但理论上可能），需要正则排除以 `//` 开头的行或用真正的 tokenizer 而非纯正则——具体取舍
  交实现方按 `lint-kanet.mjs` 现有其它规则处理 `.sil` 注释的方式（如果有的话）保持一致，本稿不代为决定
  用正则还是接 `silverc` 的 tokenizer。
- ctor 参数列表声明本身（`byte[32] predicate_commit,`）不是赋值，正则 `=(?!=)` 后面必须紧跟表达式而不是
  逗号/右括号，声明行不会误命中——但实现时应该补一条对应的负向量测试确认这一点。

## 2. `predicate_commit` 措辞更正（NWT 要求②）

**问题**：T4 v0.2/v0.3 稿以及 `PayoutShard.sil`/`PayoutShardV2.sil` 的既有文件头注释，用"钩子1·命门③"
这类措辞描述 `predicate_commit`，容易让读者（尤其是接位者，没有从头看过 `close_attest`/`cancel_attest`
的实际代码）误以为这个字段**现在就在门控**赔付判定（"命门"字面意思容易读成"关键判据"）。

**实际代码现状**（`PayoutShard.sil:219`/`:459`、`PayoutShardV2.sil:213`/`:318`，四处一致）：

```
require(blake2b(byte[](predicate_commit)) != predicate_commit);
```

这一行是**恒真**的（`blake2b` 的输出不可能等于输入，属性上不可能被编译期常量折叠成"永远通过所以等于没
写"——这正是它的设计目的：强制 `predicate_commit` 这个 ctor 常量必须真的被烤进这个入口的 redeem 字节
里、进而影响这个入口实例的 `covenant_id`，形成"这份 redeem 确实携带了当时烤入的这个值"的**结构性存在
证明**）。它**不**读取任何链下预言机数据，**不**比较 `winningSide` 与任何"真实赛果判定结果"，**不**执行
文件注释里提到的"未来 oracle phase 才会做"的
`require(winningSide == judgeLine(predicate_commit rule, ESPN fields))`那一步——那一步在当前代码里
**完全不存在**（`judgeLine` 不是一个已定义的函数，只是注释里描述的未来计划）。

**T4 稿的对照检查覆盖范围措辞更正**：T4 §2/§3 提到"MUST 覆盖 `predicate_commit`"时，准确的表述是：

> **`predicate_commit` 的结构完整性（这个值确实是创世时烤入的那个值，没有在传输/存储链路中被替换）
> 已经、且只能靠 T4 的 (c)+(d) 全字节比对覆盖到；`predicate_commit` 所承诺的业务裁决逻辑（读取真实比赛
> 结果、判定 `winningSide`、门控赔付）在当前代码里尚未接线——`require(blake2b(x)!=x)` 这行 sanity-use
> 只保证"这个值确实存在于 redeem 里"，不代表"这个值现在正在决定谁能拿到赔付"。T4 的对照检查因此覆盖的
> 是"这个占位值有没有被污染/替换"这一层，不是"赔付判定逻辑是否正确"那一层——后者要等 oracle phase 真正
> 接线 `judgeLine` 之后才存在，属于另一轮独立的安全审查范围，不在本稿讨论范围内。**

这条更正同样适用于任何未来引用"`predicate_commit` MUST 覆盖"这句话的场合——不要省略"结构完整性 vs 业务
裁决门"这个区分，省略了就会读成"这个字段已经在把关赔付对不对"，不成立。

## 3. 没有变化的部分

T4 v0.3 §1/§2/§4/§5（除本稿明确更正的措辞外）、v0.2 §3/§4/§5/§6 **原文不动**——本稿只加 §1（tripwire）
和 §2（`predicate_commit` 措辞更正）两节，不重写既有内容。DECISIONS.md 的 tripwire 注记由 Bettor 已加
（ledger 1203 原话），本稿不重复记录该注记的具体位置/编号，以 `docs/DECISIONS.md` 当时状态为准。
