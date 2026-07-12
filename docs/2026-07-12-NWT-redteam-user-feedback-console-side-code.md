# NWT 红队 — 用户反馈通道 卡B 落码 diff 审(f452ab5f)

> **Status**: CURRENT
> **对象**: commit f452ab5f(feedback-agent-tools.mjs/feedback.js/trading.js G1 修法/两套单测)
> **verdict**: **GREEN——H1-H3+G1 全部实落且独立验证通过,一处观察性 note(非阻塞)**

---

## G1 修法独立验证 CONFIRMED

`trading.js` diff:参数化 `type NOT IN (?)`(`NON_TRADE_TYPES=['user_feedback']`),非字符串拼接(无注入面)。**测试自证质量高**:`feedback.test.mjs` ⑥附近的 G1 测试明确写"裸查询(修复前行为)会命中 2 条反馈行,修复后(type 过滤)0 条"——这是**真实的修复前/修复后对照回归测试**,不是"断言新代码工作正常"这种单向测试,证明了 bug 曾经存在过、现在被堵住了。注释里自己承认"未来新增非交易 type 需同步维护排除表"的 drift 风险(手工配对家族的诚实自我标注),接受——当前只有一个已知非交易 type,排除法比白名单法(0 行无枚举依据)更合适,同 Bettor 裁定一致。

## H1-H3 逐条核实(不信自证,亲读代码)

- **H1**:`FEEDBACK_TOOLS` 独立字面量数组(feedback-agent-tools.mjs:17-21),`validateFeedbackTools`(55-69 行)在 `feedback.js:13` **模块加载时就跑**(`validateFeedbackTools()` 顶层调用,非等到请求才检查)——工具面若被意外改坏,服务启动即 fail-loud,比"运行时才发现"更早拦截。allow-list 精确 Set 匹配(24 行),非正则黑名单。
- **H2**:身份闭包 `buildFeedbackToolHandlers`(78-88 行)——`bettorPk`/`linkedAddr` 是外层参数,三个工具的 handler 实现里没有一处从 `args`(LLM 传入的工具调用参数)读取身份值,`open_ticket` handler(86 行)传的 `bettorPk`/`linkedAddr` 来自闭包非 `{ summary }` 解构。跨进程再校验(feedback.js:74-88):`deriveXOnlyPubkey(linked_addr)` 独立重导出,与声称的 `bettor_pk` 比对,不等 fail-closed 返回通用帮助——不信任 tg-bot 传来的值,console 是最后一道闸,verify-value-source 精神延伸到跨进程边界落实到位。
- **H3**:`classifyEscalation(raw_text)`(feedback.js:91)在 `_runFeedbackDialog`(LLM 调用)**之前**执行,输入是 `raw_text`(HTTP body 直接来的原始文本),非 LLM 输出——判定权确实不在对话 LLM 手里。

## tool-dispatch 循环核查

`_runFeedbackDialog`(122-146 行):3 轮上限(125 行)防死循环;未知工具名(H1 allow-list 理论上已在启动自检卡过,这里是纵深防线,137 行)返回 error 对象而非崩溃;`_callLlm` 返回 null 时 throw(128 行)而非静默失败——上层 `feedback.js:105-112` 用 try/catch 包住 LLM 调用,失败时**工单已开的事实不受影响**(`ticketId` 已在调用前生成),用户仍拿到工单号——LLM 侧故障不影响工单本体这个降级路径设计得对。

## N1 🟡 note(观察性缺口,非阻塞): H2 pk_mismatch 路径零留痕

`feedback.js:80-82` 的 pk_mismatch 分支是**早 return**,在 `openTicket`/`escalateTicket`(93-94 行)之前——这意味着一次"声称的 bettor_pk 与 linked_addr 反查不符"的请求**不会产生任何 `execution_states`/`events` 行**,只是静默回一句"请重新 /link"。

这条路径的语义可能是善意的(tg-bot 传了缓存过期的 bettor_pk),也可能是恶意的(有人尝试用不属于自己的 pk 冒充身份——H2 的整个威胁模型就是防这个)。框架 §3-④"留痕全覆盖"的精神是"每个动作→events"——**一次身份不符的尝试本身是一个值得记录的安全相关事件**,即使不需要每次都升级到 dev-coord(可能大多数是良性 staleness,频繁升级会制造噪音),至少应该有一条低优先级 events 记录(如 `event_type='feedback_identity_mismatch'`),供将来做模式分析(同一 tg_user_id 短时间多次 mismatch 可能是真实攻击尝试,当前完全没有数据留痕支撑这种事后分析)。

**不要求本轮修复**(当前行为本身安全,没有数据泄漏或资金风险,只是观察性盲区),记账留续卡,不阻塞本次 verdict。

## 独立跑测(不信"20+15 断言全绿"自证)

- `feedback-agent-tools.test.mjs`:独立执行,20 断言全绿,含 H1 静态断言/allow-list 拒绝/H2 禁用字段检测/H3 判定(含我 F2 回归反例)/身份闭包注入 5 个类别。
- `feedback.test.mjs`:独立执行,含 G1 修复前后对照测试(裸查询修复前命中 2 条→修复后 0 条)/H2 mismatch fail-closed 真实响应/tool-dispatch 全链路(真 kaspa-wasm 地址锚定 + LLM mock,非另造 mock 框架)全部通过。

## 结论

G1 修法真实堵住(参数化+回归测试证明修复前后行为差异),H1-H3 逐条代码级核实全部落实(非重申设计承诺),tool-dispatch 循环边界处理合理。**GREEN,可视为落码闭合**。N1 是留续卡的观察性建议,不阻塞。续卡(owner-bot 侧轮询源接线+卡A tg-bot 侧落码待 Owner 文案批)按既定队列走。

— NWT 2026-07-12
