# NWT 红队复核 · T4增补稿v0.3(`d1e53d11`)+v0.4(`0ca4fdb2`)——三字段ctor-only裁定 + tripwire/lint方案 + predicate_commit措辞

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1200：判断v0.3裁定②(三字段ctor-only,靠(c)+(d)覆盖)是否封住Q8"搬状态=创世状态不受检的洞"、
> 无安全回退——NWT 1203口头判断：是，附两条要求(tripwire+predicate_commit措辞)。
> Bettor 1204：v0.4已落两条要求，请把v0.3+v0.4合成书面verdict（1203口头判断落档）。lint钩子实现另派
> KANet-UI，到了再审。

## 结论：**v0.3裁定②GREEN——`poolMerkleRoot`/`committee_hash`/`predicate_commit`保持ctor-only、走(c)全字节
重编译比对+(d)P2SH重算,确认无安全回退,不需要"搬进state"那条更贵的路。v0.4的两条要求落地质量GREEN：
tripwire的"零赋值"前提独立复核（41个.sil文件全量重新grep,不是只查8个已知市场合约文件)仍是零命中;
lint正则设计经独立构造合成测试验证——正确排除`==`/`!=`,且正确命中本仓库真实使用的"ctor→state"规范转换
写法(`field = init_field;`,CloseZkV2等文件已经在用的既有写法)，这条验证比"抽象里没发现问题"更强，是拿
真实代码模式去测出来的。predicate_commit措辞更正准确、行号引用核对无误。**

## 一、v0.3裁定②——独立复核，GREEN（1203口头判断的书面落档）

### 1.1 三字段确实是纯ctor常量——独立grep确认（不是信J2的转述）

在`PayoutShard.sil`/`PayoutShardV2.sil`/`RootClose.sil`当前源码里逐个grep三个字段名的全部出现位置：
三个字段都只在ctor参数列表声明一次，此后全部出现在`require(x == 字段)`/`require(blake2b(...) == 字段)`
这类只读比较语句里——**零赋值语句**。`poolMerkleRoot`是depth-8委员merkle根（`close_attest`/
`cancel_attest`用于逐委员merkle proof校验，`require(cNCur == poolMerkleRoot)`共10处）；`committee_hash`
（RootClose）是5个committee pubkey的blake2b承诺（`require(blake2b(c0Pk‖...‖c4Pk) == committee_hash)`）；
两者都是真实trust-root用途，跟我此前Q8裁决描述的委员/oracle身份锚性质一致。

### 1.2 为什么ctor-only+（c）+（d）不是Q8担心的那个洞——独立推理确认

Q8当年的洞具体来说是：**一个值一旦搬进mutable state，consensus/合约本身就只能核"这个state值内部自洽"
（位点、类型对得上），核不出"这真的是创世编译时用的那个值，没被中途替换"这件事**——这正是`gateTmplHash`
判定MUST留ctor的理由（搬state=创世状态不受检的洞开在ZK电路锚上）。

现在的情况是：这三个字段**根本没有搬进state**——它们仍然是ctor，天然烤进redeem字节码、天然被P2SH承诺
锚定，跟`gateTmplHash`一直享有的保护机制完全同源，不是降级版。**(c)全字节重编译比对本身就要拿这三个ctor
值当输入去重建整段字节码**——值不对，重建出来的字节码就不等，(c)直接fail；**(d)再把重算的P2SH对上链上
真实地址**——两步组合验的是"创世那一刻确实用了这个值"，这跟state路径要解决的问题是同一个问题、给出的是
更强的答案（cheap-tier的位点比对只保内部自洽，(c)+(d)靠外部可验证的重编译+承诺哈希保外部真实性）。

**且由于零赋值语句=创世之后没有任何代码路径能改写这三个字段**，"只在创世查一次"对纯ctor常量而言逻辑上
等价于"每次都查"——没有漂移可能，检一次即检了这个字段存在的全部时间窗口。这跟我在T4 v0.2那一轮要求
"信任根字段必须构造前查"的顾虑不冲突：那条顾虑的前提是"这些字段会变成可变state"，这个前提在当前代码里
不成立，顾虑本身自然不适用于ctor-only的情况。

**结论：v0.3裁定②——三字段保持ctor-only+(c)+(d)——GREEN，无安全回退，不需要走"补T3状态布局改动"那条
更贵的路。**

## 二、v0.4——tripwire+lint方案+predicate_commit措辞更正，独立复核，GREEN

### 2.1 "零赋值"前提——独立重新验证（41个`.sil`文件全量，不是只查已知8个市场合约）

在`coord/j2-t3-market-sil`分支（v0.3/v0.4两稿实际落码所在的分支，先确认这一点，见下方"分支定位纠错"）
提取全部`kasia-console/src/lib/*.sil`文件（**41个，不是只查T3主网集8个已知文件**——这一点本身也是在
验证v0.4 §1.3"lint规则不该只白名单当前8个文件"这条设计考量背后的事实基础：现在库里确实还有其它非市场
合约的`.sil`文件同时存在，规则如果只扫8个文件名单，这些文件永远不受保护，这条顾虑是有真实文件基础的，
不是纸上假设），对三个字段名重新跑一遍赋值模式的grep：**0命中**，跟J2/NWT此前两次独立grep的结论一致。

**分支定位纠错（如实记录一次自己的方法论失误，未影响最终结论）**：本次复核最初把`kasia-console/src/lib`
下的`PayoutShard.sil`/`PayoutShardV2.sil`对着本机HEAD（`bshard-m3-deploy`）跑grep，得到`predicate_commit`
的行号是84/246和98/201，跟v0.4文档里写的219/459和213/318不一致，一度以为发现了文档引用错误——**核实后
发现是我自己核对错了分支**：`bshard-m3-deploy`（我平时commit文档用的分支）此刻还没合入T3 v0.3的代币化
提交，这两个文件在这条分支上是较早、较短的版本；v0.3/v0.4两份文档实际写在`coord/j2-t3-market-sil`分支
上，那条分支上的文件才是文档描述的真实对象。切到正确分支重新核对：**219/459（PayoutShard.sil）、
213/318（PayoutShardV2.sil）——跟文档引用逐字一致**，是我自己先选错了对照对象，不是文档的问题。这个
自我更正记在这里，供以后同类"文档在侧分支、我默认对HEAD"的核对提个醒。

### 2.2 lint正则设计——独立构造合成测试验证，不是只读设计文本

对提议的正则`\b(poolMerkleRoot|committee_hash|predicate_commit)\s*=(?!=)`构造了三行合成测试：
```
require(c0Cur == poolMerkleRoot);        → 不匹配(正确，这是比较不是赋值)
require(predicate_commit != x);          → 不匹配(正确，!=被排除)
poolMerkleRoot = init_poolMerkleRoot;    → 匹配(正确，这是赋值)
```
三行结果全部符合预期。**更进一步**：独立grep了本仓库其它`.sil`文件里"ctor值搬进state"的真实既有写法
（`CloseZkV2.sil`的`int closed = init_closed;`/`byte[32] payoutRootField = init_payoutRootField;`等——
这是这个代码库里真实在用的、把ctor参数过渡成mutable state字段的规范写法：ctor参数改名成`init_X`，state
字段`X`用`X = init_X;`这一行声明并赋值），**用这个真实存在的写法去测试提议的正则，命中**——这比"抽象里
没想到反例"强得多：这条tripwire规则如果真被触发（未来某次改动真的把这三个字段之一搬进state），**极可能
就是走这个代码库自己已经在用的这种写法**，而正则确认能抓住它，不是理论上应该抓住却没验证过。

**检查了两个潜在盲区**：①复合赋值运算符（`+=`/`-=`）——独立grep确认这个语言在这41个文件里**没有真实的
复合赋值语法**（唯一命中都是注释文字里的概念性描述，比如"pool_value -= payout(draw-down)"是在解释账本
逐位如何变化，不是真实代码），不构成正则的盲区。②ctor参数声明行本身（`byte[32] poolMerkleRoot,`）——
确认逗号/换行不会被误判成赋值，声明行不会误触发（v0.4文档自己也点出了这条，本次独立验证确认属实）。

**已知的假阳性来源（`.sil`内部注释提到字段名但非真赋值、需要排除`//`行或用tokenizer）——v0.4文档已如实
列为"实现时需要处理，不是本稿要解决的"，我认可这个划分**：这条设计文档的职责边界划在"给出可实现的规则
+核心正则+已知陷阱清单"，具体用正则排除注释行还是接`silverc`的tokenizer，留给实现方按`lint-kanet.mjs`
现有处理`.sil`注释的方式决定——这个留白是合理的，不需要设计稿本身把实现细节钉死。

### 2.3 predicate_commit措辞更正——独立核对，准确

独立读了`PayoutShard.sil:219`/`:459`、`PayoutShardV2.sil:213`/`:318`（正确分支上核对，见2.1的自我更正）
四处`require(blake2b(byte[](predicate_commit)) != predicate_commit)`：确认这行确实**不**读取任何链下
oracle数据、**不**比较`winningSide`、**不**执行注释里提到的`judgeLine`函数——独立grep全库确认
`judgeLine`**不是一个已定义的函数**，只在注释文字里作为未来计划出现，当前代码零处调用。v0.4把"MUST覆盖
predicate_commit"改写为"结构完整性已covered，业务裁决门未接线"——这条区分准确，避免了"这个字段已经在
gate赔付"的误读，且不影响T4覆盖范围本身的裁定（仍然是MUST覆盖它的结构完整性，只是措辞不再暗示业务
语义也已经生效）。

### 2.4 DECISIONS.md tripwire注记——独立核对存在

`docs/DECISIONS.md:77`独立grep确认存在，日期2026-09-13T22:40:48Z、引用ledger 1203，内容跟v0.4文档§0/§1
描述的裁定与两条要求逐字对得上，不是转述失真。

## 三、给Bettor的处置建议

- **v0.3裁定②GREEN，v0.4两条要求落地质量GREEN**——三字段ctor-only+(c)+(d)路径确认无安全回退，tripwire
  前提独立复核仍为零命中，lint正则设计经合成测试验证能正确命中本仓库真实的ctor→state转换写法，
  predicate_commit措辞更正准确。
- **lint钩子的实际实现（落进`lint-kanet.mjs`）尚未落码**，本次复核只审了设计文档里的规则文本，不是审
  实现代码——KANet-UI落码后需要单独一轮复核（重点核：是否真的扫全部`.sil`而非硬编码8文件名单、是否正确
  处理注释行假阳性、error级别是否真的阻断commit、命中后的提示文案是否原样落地）。
- 本次未发现新的安全问题，可以按此裁定定案，不需要走"搬进state"那条更贵的路。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
