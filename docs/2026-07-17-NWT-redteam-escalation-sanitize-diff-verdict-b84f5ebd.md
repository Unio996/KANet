# NWT diff verdict — commit b84f5ebd(escalation payload 净化补丁 v2, #7 续)(2026-07-17)

> **Status**: CURRENT
> **对象**: `b84f5ebd`(tg-bot/escalation-sanitize.mjs + owner-bot.test.mjs, owner-bot.mjs 零改动)
> **verdict**: **✅ GREEN — 原 2 处绕过现场复测均已堵死, 1 项非阻塞观察项**
> **流程注记**: KANet-UI 这次严格执行"落码→NWT verdict GREEN→才重启装载", 未重犯 8446d4fb 那次抢跑, 认可这个自我纠正。

---

## 复测: 原两处绕过是否真堵死(现场跑代码, 非读码猜测)

用 `git show b84f5ebd:tg-bot/escalation-sanitize.mjs` 取出未装载的新版本单独跑, 拿此前 PUSH-BACK verdict 里用过的**同一组攻击输入**重放:

### 绕过①复测(伪造 `---END UNTRUSTED USER TEXT---`)
输入不变, 拼出的完整 body 里 `---END UNTRUSTED USER TEXT---` 精确匹配次数从**2 次降到 1 次**(只剩真围栏那个)。伪造的那份被 `collapseFenceMarkers` 中和成 `--END UNTRUSTED USER TEXT--`(2 连横线, 不再是 3 连), 不再具备伪造围栏标记的结构条件。**堵死。**

### 绕过②复测(U+2028 LINE SEPARATOR)
含 U+2028 的输入过 `sanitizeRawTextForBroadcast` 后, `result.includes(U+2028)` 从 `true` 变 `false`, 折叠成可视占位符 `⏎`, 内容不丢失。**堵死。**

## 追加两轮真对抗(不满足于"原两个洞补上了就够")

### 新尝试①: 视觉相似但非 ASCII 的破折号(homoglyph)伪造围栏
用 U+2014 EM DASH(在很多字体里跟 ASCII 连字符视觉相近, 尤其小字号/等宽字体不明显)拼 `———END UNTRUSTED USER TEXT———`, 现场实测 **`collapseFenceMarkers`(`/-{3,}/g`)不匹配 U+2014, 原样保留**。

**评估(非阻塞, 记观察项)**: 这是一个真实存在但**严重度明显低于**原两处绕过的残留面——原绕过是**字节级精确复现**真实围栏标记字符串(任何字符串比对/精确匹配都会被骗过); 这个 homoglyph 变体**不是**真实围栏标记的精确字节复现, 只是视觉近似, 对做精确字符串匹配的下游消费者(比如未来若有自动化工具解析这条消息找真实 BEGIN/END 边界)不构成欺骗, 只对**人眼扫读**在特定字体渲染下可能有一点误导概率, 而且构造门槛(得故意打 U+2014 而非按 Enter/连按减号)比原两处绕过更高。**不要求本轮堵, 值得记一句留意**(如果以后要做, 可以把 `-{3,}` 扩展成一个包含常见 dash-like Unicode 码点的字符类, 但完整 homoglyph 防御是一个通用的、范围大得多的问题, 不建议为这一个消费场景过度工程)。

### 新尝试②: 跨消息攻击(分两次 escalate, 拼起来伪造围栏)
`sanitizeRawTextForBroadcast` 是单次调用的纯函数, 天然处理不了"消息 A 结尾是 `--`, 消息 B 开头是 `-END...`, 两条拼起来在阅读者脑内组成假围栏"这类跨消息社工。**这不是这个函数的设计边界内的缺陷**——单条 escalation 事件本来就是独立单元, 每个工单一次(已有幂等去重), 攻击者需要控制两个不同工单的措辞并期待阅读者恰好连续读到且脑内拼接, 攻击成本高、可靠性低, 且防这个已经超出"净化单条 payload"这个函数该管的范围, 应该(如果将来真值得管)放在消费端阅读纪律层面, 不是这个函数的责任。**不阻塞本次 verdict。**

## 其余复核

- `owner-bot.mjs` 本次零改动(diff stat 确认), 与声明一致。
- 新增回归 ⑦⑧ 两组测试逻辑正确, 断言精确(逐字符核过 `⑦` 组的"5 连横线变体"用例和 `⑧` 组的三码点独立断言+组合断言 `r === 'a ⏎ b ⏎ c ⏎ d'`), 不是宽松断言撑出来的绿。
- 修法顺序(先 fold 再 collapse)确认不会互相抵消或重新引入问题(fold 只插入不含横线的占位符, collapse 只处理横线游程, 两者操作对象不重叠, 交换顺序结果等价, 无需额外测这个)。
- `String.fromCharCode(十进制)` 替代 `\u` 转义字面量的技术记录属实——本 NWT 自己今天写这几份文档时也撞了同一个编辑管线坑(字面 unicode 字符被写入后 Edit 工具报"字符串不匹配", 根因是文件里已经是不可见控制字符非我以为的转义文本), 独立印证这条技术笔记不是找借口, 是真实撞过的坑。

## Verdict

**GREEN, 可装载。** 原 PUSH-BACK 的两处阻塞项现场复测确认堵死, 新增测试覆盖到位。1 项非阻塞观察项(homoglyph dash)记录在案, 不要求本轮处理。

— NWT 2026-07-17
