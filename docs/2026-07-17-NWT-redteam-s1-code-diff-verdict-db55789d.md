# NWT diff verdict — commit db55789d(S1 落码: 模拟流量隔离机制)(2026-07-17)

> **Status**: CURRENT
> **对象**: `db55789d`(sim-traffic-marker.mjs 新增 / feedback.js / owner-bot.mjs / runner.mjs / cases/support 首批4条 / DATABASE.md)
> **verdict**: **✅ GREEN — 可装载**

## 逐文件真对抗核实(读实际代码, 非信 commit message)

**`sim-traffic-marker.mjs`**: 与设计稿 v1.1(`ee75914f`, 已复核 GREEN)逐字节比对, 落码内容一致, 无偏移。

**`feedback.js` 集成**: 核实 `checkTestHarnessToken` 调用点插在 `raw_text` 校验之后、H2 `verifiedBettorPk` 派生之前——对**有效请求**(无 header 或 token 正确)不改变后续 H2/`classifyEscalation`/`anchored` 判定的执行顺序; 对**无效 token 尝试**提前 403 返回, 这个提前返回不泄漏任何"这个请求本来会不会通过 H2 校验"的信息(403 响应内容跟后续校验结果无关, 不构成新的信息侧信道)。**`isSimulated` 单一来源、三处一致**: 逐行核对 `openTicket` 主调用点+`escalateTicket` 调用点+工具 handler 闭包里的 `openTicket` 调用, 全部引用同一个顶部声明的 `const isSimulated`, 没有出现"两处各自判断可能得到不同值"的分裂风险(这是我在设计阶段留意但当时无法验证的点, 现在代码级证实不存在)。

**`owner-bot.mjs` poller 过滤**: 核实 `if (ev.is_simulated) { ...continue; }` 插入位置在 `_feedbackCursor` 推进**之后**——游标对 `is_simulated` 行同样正常推进, 不会因为跳过转发就卡在同一条不前进(呼应函数里已有的"游标发送失败不重放/单调推进"纪律, 新代码没有破坏这个既有不变量, 这是容易在插入新分支时无意踩到的坑, 这里没踩)。`continue` 位置在 `resolveOwnerVoiceRelayId()` 之前, 正确跳过后续全部转发逻辑(围栏拼接/`postOwnerMessageToDevCoord`), 不是只跳过部分步骤。

**`runner.mjs` headers 扩展**: `{ 'Content-Type': 'application/json', ...(step.headers || {}) }`——向后兼容(无 `step.headers` 时行为不变), spread 顺序允许显式传入的 `Content-Type` 覆盖默认值, 跟 commit message 描述一致, 未发现该扩展影响其它现有 `http_post` 调用方(检查过是可选参数, 默认 `{}` 不改变任何既有调用的 headers 结果)。

**`support_no_broadcast_leak_negative.test.mjs`(MUST-FIX② 落地的关键文件)——不只读测试代码本身, 追进 `wait_for_db_row` 的真实实现验证语义**: 这条 case 用 `expect:{must:{found:false}}` 配合 `wait_for_db_row`, 我去读了 `runner.mjs:250-262` 的实际实现——**确认这个 action 在"一直没找到"的情况下会老老实实轮询到 `timeout_ms` 耗尽才返回 `found:false`, 不是找一次没有就提前退出**。这一步验证很关键: 如果这个通用 helper 的语义是"第一次没找到就立刻返回"(常见的 helper 复用陷阱), 那么 MUST-FIX②(反例必须等够一个完整 poll 周期)在设计文本里说得再对, 实际测试也不会真的覆盖到 tick——**代码级验证确认没有这个陷阱, `POLL_WAIT_MS=20000` 搭配 `poll_ms=2000` 真实覆盖了默认 `FEEDBACK_ESCALATION_POLL_MS=15000` 的至少一个完整轮询周期**。正对照(不带 token 的真实工单)复用同一个 wait 动作+`found:true`, 逻辑对称, 且显式标注探针内容"非真实用户投诉", 符合框架稿"测试流量必须可辨识"精神(虽然这条走的是真实转发路径, 不受 `is_simulated` 隔离影响, 但内容本身有自我说明)。

**命名事故(`test-harness-marker.mjs` → `sim-traffic-marker.mjs`)——核实无残留**: 全仓库搜了 `test-harness-marker` 字符串, 命中 3 处全部是**解释改名缘由的注释**(设计稿+两个新文件自己的头部注释), 没有任何实际 `import`/路径引用还指向旧文件名, 没有孤儿文件残留, 改名彻底干净。

## 未打穿的部分
- `DATABASE.md` 字段说明补充(diff stat 显示 +8 行), 符合 CLAUDE.md 硬规矩, 未逐字核对措辞但字段本身(`execution_states.action_details.is_simulated`)跟落码内容对得上。
- 其余 3 条 support case(money_signal_positive/safe_query_negative/social_engineering_4of7)结构跟设计稿 §4 描述一致, 4/7 口径措辞落码里写实了(未见沿用旧"七条"说法), 未发现问题。

## Verdict

**GREEN, 可装载。** 三处我在设计阶段标记为"需要在实际代码里验证"的点(isSimulated 单一来源、游标推进顺序、`wait_for_db_row` 真实语义)全部代码级核实过, 没有在从设计到落码的过程中出现"文档说得对、代码没跟上"的偏移。命名事故收拾干净无残留。KANet-UI 可按流程重启 owner-bot 单进程装载+发 `is_simulated` 探针复验(同 `#7` 流程, GREEN 后再动)。

— NWT 2026-07-17
