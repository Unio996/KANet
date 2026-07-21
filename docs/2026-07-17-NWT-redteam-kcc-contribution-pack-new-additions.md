# NWT 窄审 — KCC 贡献包新增件(Comment1 ABI联锁 + KCC1 cross-link + 兼容矩阵判定 + V01-V13 向量套)(2026-07-17)

> **Status**: CURRENT — GREEN-with-notes, 未落码(纯文档), 待 Owner 对外发布前按下方 1 项修完

## 范围声明
按 Bettor 派工(#olbn4r.2), 本审**只审相对 7/16 已审两意见(Comment2/3 前身)新增的部分**: `docs/standards/kcc/KCC20-KCC1-Cross-Spec-Review-Drafts.md` 的 Comment 1(ABI 联锁)+ 文末 "Optional short cross-link comment for KCC1"、`KANet-KCC-Compatibility-Matrix-v0.1.md` 全篇判定、`KCC1-KANet-Conformance-Vector-Proposal-v0.1.md` 的 V01-V13 向量套。**不重审 Comment2(Borrowed Receive)/Comment3(artifact provenance)**, 也不做上游 GitHub PR 原文核对(该项已明确指派 @J1 KCC 主笔域, 本地无上游源可对照)。

commit: `bb2e69f6`(分支 `agent/kcc-contribution-pack-2026-07`, Draft PR#2)。

## 真对抗结论

### 发现①(MUST-FIX 文档自洽性, 对外发布前修): 兼容矩阵图例未覆盖实际使用的全部判定标签

`KANet-KCC-Compatibility-Matrix-v0.1.md` 第 29 行图例只定义 4 个判定词:
> "一致"表示已经有明确实现证据；"概念一致"表示模型相近但尚未完成逐字节证明；"不兼容"表示不能用同一 profile 解释；"待证"表示必须生成向量再下结论。

但第 3 节表格实际使用了 **6 个不同标签**(逐行核过, 见下方精确计数): `待证`(1)、`概念一致`(6)、`不兼容`(2)、`高度一致`(2)、`跨规范缺口`(2)、`安全缺口`(1)。`高度一致` 与图例的 `一致` 不是同一字符串(可推断是"一致"的强调变体, 但未被字面定义); `跨规范缺口`、`安全缺口` **在图例里完全没有定义**, 读者第一次读到这两个词只能靠上下文猜——对一份"目的就是消除歧义、建立精确分类"的标准贡献文档而言, 自己的分类体系本身有未定义标签是硬伤, 会被上游 reviewer 当场抓到, 削弱可信度。

**修法**: 图例补齐 6 个标签的定义(或至少把 `跨规范缺口`/`安全缺口` 作为"超出基础 4 类的应用层判定"单独说明; `高度一致` 建议直接改回 `一致` 或在图例注明是强调用法)。**一行改动, 建议对外发布前一并修。**

### 发现②(报数口径纠偏, 非文档缺陷): 频道摘要"3不兼容"与文档实际计数不符

Bettor #olbn4r.1 频道消息称矩阵"3不兼容2跨规范缺口1安全缺口判定"。**逐行 grep 核实, 文档里 `不兼容` 判定实际只有 2 行**(多入口分发、模板哈希), `跨规范缺口` 2 行(KCC20 State ABI、KCC20 descriptor)、`安全缺口` 1 行(Borrowed Receive)与频道所述一致。**正确计数应为 2不兼容/2跨规范缺口/1安全缺口**, 不是 3不兼容。这是频道报数的笔误, 不是矩阵文档本身的错——但按本项目一贯纪律(DAA 算术错三方认账、报数口径别漂), 数字类结论必须逐行核对不能凭印象转述, 在此提出订正, 建议 Bettor/Owner 后续引用时用正确计数。

矩阵内容本身(两条 `不兼容` 判定的技术论证)经核: 多入口分发(hash-tag vs 位置选择器)与模板哈希(length-bound vs 裸拼接, V08 向量的经典长度歧义 `61|6263` vs `6162|63` 两组前后缀拼接成同一字节串却应产生不同哈希)两条判定**技术论证站得住, 判"不兼容"而非"待证"是对的**——这两处是不同 profile 下产生不同字节结果的真实结构性差异, 不是"多测几个向量就能调和"的模糊地带。

### 发现③(建议性补强, 非阻塞): V10 向量缺"授权重放"负向量

`KCC1-KANet-Conformance-Vector-Proposal-v0.1.md` V10(同模板/跨模板延续)已有的负向量覆盖: 替换成不同模板但保留相同 state、在未授权的输出位置放正确字节。**缺一类**: **复用一个此前已消耗过的合法跨模板授权信号, 对第二笔本不该被授权的迁移重放**——即"这个 authorization 曾经对某一次迁移有效, 能不能被抓来给另一次迁移背书"的重放/TOCTOU 类攻击, 跟本项目历史上反复撞过的 enforce↔sign TOCTOU、equivocation 同一个攻击家族(NWT 职责模式里明文列的核心攻击面)。当前 V10 描述的两个负向量都是"内容不对"型, 没有"内容对但时机/次数不对"型。

**建议**(不阻塞发布, 可在 V09-V12 那批随 KCC1 章节稳定后一起补): 加一条 V10 负向量——"合法跨模板授权已被消耗一次(用于第一笔延续)后, 尝试对第二笔不同延续复用同一授权信号 → 应 reject"。

### 未发现的问题(尝试过、没打穿, 如实记录)
- Comment 1 的规范化建议(record 名/字段类型/dispatch tag 发布为一致性向量/descriptor 引用 Program ABI 作为 MUST 级校验)与矩阵里 `KCC20 State ABI`、`KCC20 descriptor` 两行的判定和 action 描述**逐句核对一致, 无矛盾, 无重复定义两套真相源的风险**——已经是 Comment1 想要解决的问题, 不是新引入的。
- Comment 1 是否越界要求 KCC20/KCC1 标准化 KANet 特定业务逻辑: 检查过, 建议的 MUST 级校验(record 名/字段顺序/dispatch tag 一致性)是通用 ABI 卫生要求, 不含任何 KANet 专属业务语义, 符合文档自己声明的中立原则。
- 文末 "Optional short cross-link comment for KCC1" 与 Comment 1 的技术主张(record 名/dispatch tag/PushExplicit/length-bound TemplateHash)一一对应, 未发现新增矛盾或范围蔓延。
- V01-V13 整体覆盖: 逐条过了一遍每条的正/负向量设计, 除发现③那一点, 其余 12 条(尤其 V08 长度歧义、V11 leader/delegator 角色错位、V12 commitment 复用)覆盖面已经相当扎实, 明显是从本项目真实撞过的坑(shard21 派生偏差同族的角色错位/侧位攻击)反哺出来的, 不是凭空编的清单。
- 三份文档头部的规范快照哈希(KCC20 `a6e2fc25`/KCC1 `55b28d86`)和 KANet 证据快照(`eab2ebbc`)在三份文档里逐字一致, 无 pin 漂移。

## Verdict

**GREEN-with-notes**。无阻塞级技术缺陷。发现①(图例缺定义)建议对外发布前顺手修一行; 发现②是频道口径订正, 不改文档; 发现③是向量套的建议性补强, 排入 V09-V12 那批一起做, 不阻塞当前 Draft PR 状态下的迭代。
