# NWT 红队复核 · V-T-8（readInputStateWithTemplate + 自续约同函数崩溃）+ AB11 绕路验证

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`114272cc`(V-T-8 探针AB2-9+VOSWIT) + `99084e35`(AB10死路+AB11通路)。
> 方法：不读J2报告先信——自建独立最小复现(4臂对照)+独立提取J2的AB8/AB11用自己的silverscript v1.0.0工具链
> 重新编译+跑；用真实读代码定位到可能的根因机制（32轮不动点收敛）；对AB11自己新造一个"常量写错"的对抗性变体
> 实测fail-closed性质，不是纯理论推断。

## 结论：**V-T-8确认为真实、架构级的工具链缺陷，独立复现成功；AB11绕路方案独立验证通过、无安全反例，推荐立即用于absorb生产写法；编译器根因给出源码级假说但未精确定位到单一行，作为不阻塞的背景议题继续**

## 一、V-T-8独立复现

自建4臂最小探针(`SelfRecreateProbe.sil`)——用极简两字段State + 124字节小foreign suffix——**全部PASS，没有复现出崩溃**，如实报告了这个"未中"结果，没有藏起来。随后独立提取J2的`AbsorbProbe8.sil`（用真实KanetTestToken六字段TokenState结构 + 3214字节真实token_suffix）自己编译+跑，**复现出`-575 cannot be used as an array index`**，与J2报告完全一致。两次结果放在一起看，说明触发条件跟"合约/外部模板的真实规模"有关，不是随便一个玩具例子都能撞上——这条我记录为观察，没有做成"多大才会崩"的精确刻画（时间/优先级让位AB11）。

## 二、编译器根因假说——源码级证据支持，未精确定位单一行

读了`silverscript-lang/src/compiler/compile.rs:97-105`：`this.bytecodeSize`不是编译期字面常量，是一个**最多32轮的不动点迭代**——`contract_uses_bytecode_size()`只要合约任意位置出现`validateOutputState`家族调用就返回true(`analysis.rs`的判断本身不看目标索引)，触发后从猜测值100开始，每轮重编译整个合约、量实际字节数、跟猜测比对，直到收敛。`readInputStateWithTemplate`本身不使用`this.bytecodeSize`(用调用方显式传的外部prefix_len/suffix_len)，但它的字节码贡献进合约总长度——总长度正是这个不动点在收敛的量；`validateOutputState`的redeem-script计算含一步减法(`bytecode_base = input_sigscript_len - bytecode_size`)。**这个结构完美解释AB10"只有指向self才崩、指向别的输入不崩"**：指向别的输入用外部显式参数，跟这个自指不动点无关；指向self必须依赖可能算错的`this.bytecodeSize`。这是有具体行号支撑的假说，不是拍脑袋——但没有继续往下单步调试精确定位到"哪一步算出了-575"这个具体数字，因为AB11已经提供了绕路，Bettor裁定"不阻塞"，这条作为背景议题记录，未来若要真的修编译器，这份假说是起点。

## 三、AB11绕路——独立验证通过，四项审点逐条

**独立复现**：提取`AbsorbProbe11.sil`+两组ctor(`out150`/`out130wrong`)，独立编译字节级跟提交产物完全一致；`cli-debugger --run-all`独立跑`AB11_pass`/`AB11_fail_wrong_amount`，2/2跟`run.log`一致。

**③常量写错是否存在攻击者可利用的反例——实测，无反例**：自己造了一份`OWN_PREFIX_LEN`(1→2)/`OWN_STATE_LEN`(51→40)写错的对抗性变体，拿原本合法的`AB11_pass`交易去跑——`verification failed`，不是crash也不是意外通过；`expectedRedeem`的字节转储明显是错位乱码，跟blake2b雪崩效应预期一致(常量错→重算hash基本随机→跟任何真实输出撞上是哈希原像量级)。**结论：常量错=入口对诚实用户和攻击者一样失活，是活性(liveness)故障不是安全(security)漏洞**，Bettor原判断成立。

**④sigScript切片是否可被同笔交易其它输入干扰——协议层保证，无需实测**：`tx.inputs[this.activeInputIndex].sigScript`按协议强制、非攻击者可控的索引读取**这一个**数组元素，语言的数组类型语义没有"其它元素内容混入"的机制，跟`readInputStateWithTemplate`需要显式prefix/suffix参数读外部合约是完全不同的原语，这条不需要靠向量验证，是索引语义本身决定的。

**②20字段State逐字段编码核对——待J2交列表，本轮未覆盖**。

## 四、处置建议

- **AB11批准用于absorb生产写法**，机制安全、无反例；同款结构未来推广到claim/refund_claim/claim_draw等含代币化续约分支的入口时，需要逐入口重新核对①(独立编译跑)。
- **运维纪律要求，非安全阻塞**：`OWN_PREFIX_LEN`/`OWN_STATE_LEN`每次改源码结构或换模板长度都要重算，建议每个用这个模式的合约配一条构建期自检向量(编译产物量真实state_span跟硬编码值比对，不一致builds fail)，把"忘了重算"从上线后才发现提前到编译/测试阶段拦下。
- 编译器根因假说记录在案，作为不阻塞的背景议题，若未来有资源真的修编译器，从`compile.rs:97-105`的32轮不动点收敛机制查起。
