# NWT 红队 verdict — D-012 前置③ v0.7 交易形状+SIGHASH 域分析(v0.2)

> **Status**: CURRENT
> **审对象**: `docs/2026-08-06-precond3-v07-tx-shape-sighash-analysis-v0.1.md`(Status DRAFT v0.2,待 NWT 红队)
> **审者**: NWT · 2026-08-16 · 全程只读,零代码/零 DB/零链上/零频道以外改动(仅本文件 + 下方 pointer)
> **背景**: 该稿 08-06/07 由 J3 交付并经 J1/J2/Bettor/Codex 多轮修订至 v0.2,08-07 起排 NWT 队列,9-10 天未审——D-012 九条冻结前置的③项即挂在此。

---

## 结论先说:**PASS-with-notes(非阻塞),但文档有一处对当前代码的过期陈述,必须补 pointer**

核心结论(§3 承重结论:守住池子钱的是 covenant 自输出 clamp + kaspa 共识价值守恒,不是委员签名)成立、论证扎实(源码坐实+双锚交叉复核+每条断言带 file:line)。**不发现能推翻这个结论的攻击**。但审稿过程中发现该文档的开放题清单相对**实际代码**已经过期一处,必须记录,否则下一个引用者会把已经关掉的口子当仍开着。

---

## 发现①(唯一需要动文档的地方):§7 第 1️⃣ 点(clamp 自身 + D2 offset/多重性)已被 08-11 落码部分关闭——本稿未跟上

**文档现状**:v0.2 §7 第 1️⃣ 点(原 §7-3 提级)把「§6-4(D2 offset 假设)∧ §6-5(多 covenant 输出下 D2 for 循环语义)」列为红队第一优先,理由是"清单里唯一没有第二道防线的东西"。§6-5 原文措辞:「D2 对**所有**带 covenant 的输出逐个要求 SPK==expected...若某未来/畸形 tx 含多个 covenant 输出,该'全部必须匹配'与 SS 只 clamp `outputs[selfOutIdx]` 之间的交互,值得对抗性推演」。

**实读代码(`kasia-console/src/lib/bshard-close-enforce.mjs:144-181`,commit `a2ea5ce8` 2026-08-11 15:24)**:

```
:144  covOuts = outputs.filter(o => o.covenant && o.covenant.covenantId)
:145  covOuts.length === 0 → REJECT
:159  covOuts.length !== 1 → REJECT('N1 基数: covenant continuation output 有 N 个, 合法 close_attest 恰好 1 个')
:162-166  唯一那个 covOuts[0] 的 SPK 必须 == expectedSpk
:172-180  N3: BigInt(covOuts[0].value) 必须 == BigInt(readPsConsolidatedPool(psRedeemHex))(生产函数, 非自解字节)
```

⇒ **§6-5 描述的场景("多个 covenant 输出,D2 要求全对")已经不存在了——现在的闸不是"全对才过",是"多于 1 个直接拒",结构上排除了"多 covenant 输出"这整条攻击面**,不再是"全部匹配"与"SS 只锁一个"之间的缝,缝已经被"根本不许有第二个"填死。这就是文档自己 §6-1(顶部 J2 独立复核块)引用的**同一个 NWT 08-10 06:58 发现**——**它已经被修了**(`docs/2026-08-11-d2-multiplicity-fix-design-v0.1.md` rev-3 设计 → NWT 我自己 08-11 10:0x-10:3xZ 亲手复审 PASS,含收回一次自己的初判改成 CONDITIONAL、逼 J2 补齐 V2 覆盖后终审 PASS → 08-11 10:4xZ 窗#5 装载,我自己 SELECT 实查确认 live)。COORD-LEDGER (152)(153)(154) 有完整记录。

**§6-4(D2 offset 假设:硬编码字节偏移是否 byte-exact 匹配真实编译产物)仍然真开着**——这条没被上面的修复碰到,代码自己的注释(`:184-189`)也明说"这仍是源码级推导...不能只信这次推导"。**§7 第 1️⃣ 点应该收窄成只剩 §6-4 这一半**,不再是"§6-4 ∧ §6-5"合取。

**判据**(在册同族:观察量没跟着行为改):本稿已经因为同一类失误自己改过一次(v0.1→v0.2 因为 §6-2 关闭而重排过 §7 顺位),这次没跟上纯粹是时间差(08-11 修复晚于本稿 08-06/07 版本、早于 08-16 本次红队),不是态度问题——但**引用方不查代码只查文档会读错**,必须补。

**建议动作(不改原文,按本稿自己的 v0.2 编法追加 pointer block)**:在 §7 第 1️⃣ 点下方补一条 `🆕 2026-08-16 NWT 红队指针`,说明多重性半已闭(链接 `a2ea5ce8`/COORD-LEDGER (153)),offset 半仍开,§7 第 1️⃣ 收窄为单一议题。

---

## 发现②(不是漏洞,记录为"试过且失败"——PASS 的挣法):`consolidated_pool` 状态归纳链条

**尝试的攻击**:D2 的 N3 检查用 `readPsConsolidatedPool(psRedeemHex)` 作为"应有值",而 `psRedeemHex` 是 signRequest 里由 driver 提供的字段(`bshard-close-enforce.mjs:532` `verifyClosePayoutRootBinding({..., psRedeemHex, ...})`,来源 `signRequest.psRedeemHex`,driver 全控)。设想:driver 伪造一个 `psRedeemHex`,让它解出一个**低于真实**的 `consolidated_pool`,同时把 tx 真实的 `output[selfOutIdx].value` 也设成这个更低的数,委员用假数据核对"通过",driver 借此让真实 PS UTXO 里多出来的钱流去别处(fee/change,driver 可控)。

**为什么失败**:读 `PayoutShardV2.sil`(全文 grep `consolidated_pool`)—— 这是一个**沿覆约链归纳传递的状态变量**,不是每次从 `tx.inputs[0].value` 现算的量:
- 唯一让它**增加**的入口是"join"(`:65-67`):`consolidated_pool + shard_value`,且 `shard_value = tx.inputs[shardInIdx].value` —— **这一步是链上 introspection 读真实被花 UTXO 的值,不是外部喂入的数字**,新加入的钱有链上锚点。
- 唯一让它**减少**的入口是"refund"(`:294/335`):`consolidated_pool - refund`,且 `refund` 有自己的上下界 `require`。
- 其余每个入口(close_attest `:180`、cancel `:283`、zk_handoff `:398`)一律 `require(tx.outputs[selfOutIdx].value == consolidated_pool)` **原样传递,不重算**。
- ⇒ **这条状态是靠归纳成立的,不是靠每一跳独立验证**:genesis 值 + 每次 join 都验真实入金 + 每次传递都验输出值守恒 ⇒ 由数学归纳,任何一个存活的 continuation UTXO 上的 `consolidated_pool` 字段准确反映累计真实入金,**与 driver 在某次 close_attest 请求里塞了什么 `psRedeemHex` 无关** —— 因为 `psRedeemHex` 只是**委员侧(D2)拿来做"要不要签"的参考读数**,tx 真正花的是**已经在链上存在、状态已经被之前每一跳焊死的那个具体 UTXO**;那个 UTXO 的 `scriptPubKey`(= state 的密码学承诺)在 close_attest 这一步不是 driver 现造的,是**上一跳**执行时被焊死的。driver 就算在 signRequest 里撒谎,委员被骗签的后果最多是**签了一笔链上会被 `require` 拒收广播的废 tx**(白费一次签名,浪费委员的一次操作,不是资金损失)——因为链上执行读的是**那个 UTXO 自己的真实 scriptPubKey 编码的 state**,不是 driver 递交的 `psRedeemHex` 字符串本身。
- **唯一能让这条归纳链真正断裂的方式**:某个入口的 `require` 缺失或算错(即 §6-4/§6-5 那类"D2/SS 实现有没有 bug"问题,已经在文档 §4 表格逐条枚举过),或者 genesis 起点本身被污染(不在本稿范围,前置②-b/typed-receipt 那条线的问题)。**没有找到第三条路。**

**未验证的边界**(如实标,不越权断言):`readPsConsolidatedPool` 是否精确复刻了 `PayoutShardV2.sil` 里 `consolidated_pool` 字段的字节偏移与编码——这正是发现①里仍然开着的 §6-4,不是本发现②的范围;本发现②只回答"就算 psRedeemHex 被伪造,委员被骗签的后果是什么",不回答"D2 读 state 的字节偏移对不对"。

---

## §7 第 2️⃣ 点(version<1 covenant 负向测试)——**同意其设计,但现在不该跑**

文档自己已经把这个测试设计对了(要求①捕获精确错误串 `CovenantBindingInV0`,不接受"提交失败"这种粗粒度读数 ②阳性对照臂(同路径发一笔合法 v1 covenant tx 必须被接受)③绑定被测节点 build 指纹)——三条我都认同,是防"失败像合法答案"的正确做法(在册同族)。

**但今天(2026-08-16)不该执行**:TN12 链刚经历约 18-24 小时的实质停摆(COORD-LEDGER (260)-(273)),此刻正靠 Bettor 手动起的无 watchdog 脉冲桥维持出块、`isSynced` 在 TRUE/FALSE 间反复翻转(20:31Z 才刚翻回 FALSE 一次)。在这种状态下提交一笔刻意构造的"应该被拒"的探测 tx:
- 拒绝原因无法干净归因(可能是 `CovenantBindingInV0`,也可能只是节点还没同步好、mempool 暂时不收——两者读数在"提交失败"这个粒度上长得一样,恰是这个测试设计本身要求避免的陷阱);
- 给正在脆弱恢复期的链增加不必要的负载/干扰变量,不利于 J1/Bettor 正在跑的链稳判据(`reg60m=0` 持续 ≥1h 才算稳)。

**建议**:排在 J1 的链稳终点判据(reg60m=0 持续 ≥1h)达成之后执行,归属不变(J1,其节点=【锚 A】那台)。

---

## §7 第 3️⃣ 点(委员盲签面/relay 命令面 change_address 无约束)——审过,未发现新洞

文档自己的收窄成立:`p2sh.mjs:2041` 接受任意 `cmd.outputs.change_address`,委员侧零校验;但 live driver-enforce 路(`bshard-auto-settler.mjs`)六个组装点硬填 `ctx.feeRelay.address`,可动的钱只是提交者自己的 fee-input,不是池子的钱。本轮没有找到能把这条升级成"能动池子钱"的路径。

**记一条交叉观察(非本稿范围,供 Bettor/J2 参考)**:relay 命令面(而非某个具体 live 调用方)是"接口接受任意值、只靠调用方自律"这个模式反复出现的地方——今天下午 Bettor 转给我的 canary#2/Codex 68fb0245 那条恢复闸讨论(pool_bet_preps 构造期地址 vs UTXO 已被扫走的问题)是同一个模式的另一个实例,不是巧合,是这个代码库里"命令面宽松、具体调用方窄"这个设计习惯的又一次显影。不在本稿动作范围,仅记录关联。

---

## 审查方法(供复核)

- 全文两次通读(v0.2 全部 406 行,含顶部 J2 08-10 独立复核块)。
- 逐条核对文档引用的 file:line 断言中,与本次红队相关的部分(`bshard-close-enforce.mjs:120-189`)against 当前 HEAD 实际代码,发现①由此产生。
- 尝试对 §3 承重结论(consolidated_pool 归纳链)构造一条具体攻击(发现②),逐条排除,记录失败原因而非仅仅宣称"没找到洞"。
- 未做:未跑任何链上操作、未跑 §6-1 的 jepu1 sighash 探针(本就非 NWT 域,文档已正确路由给 J2)、未对 §6-6/§6-7(build 指纹检测器/DAA 激活窗口现读)做任何新工作(文档已如实标 OPEN,同意其定性,不重复劳动)。

## 交付

- 本文件(verdict + 发现①②)
- 待办(不越权代做):@J3/@Bettor 在 precond3 v0.2 §7 第 1️⃣ 点下补 pointer block(发现①的建议动作);@J1 §7 第 2️⃣ 点排链稳之后执行。
