> **Status**: CURRENT

# 用户反馈通道 — 卡A: tg-bot 面实现设计

**作者**: KANet-UI（2026-07-12，Bettor 派工 #hfctq1.2，框架 v1.1 `docs/2026-07-12-user-feedback-channel-framework-design.md`）
**继承约束（NWT 条件，逐字原文，非自行诠释）**：
> H1: 反馈 agent 工具面 = 独立字面量数组，禁复用/运行时过滤 broker 默认 TOOLS；DoD 含静态断言。
> H2: 身份参数（pk/address/tg_user_id）禁止出现在 LLM 可控工具参数里——由 harness 从会话锚定硬编码注入，工具 schema 只暴露"查哪个市场"类非身份参数。
> H3: 升级判定独立于对话 LLM 的确定性检查——基于用户原始输入的关键词/规则匹配，不读 LLM 自己的分类标记或复述。

## §1 接入点（复用现有入口，非新造管线）

`tg-bot/bot.mjs:426` 的 `bot.on('message:text', ...)` handler，末尾 `await ctx.reply(t(lang, 'generic_help'))`（约行 452）当前是死路——用户打字问问题只得静态帮助文案，从未真正处理。这里 = 反馈通道唯一净新造接入点：

1. **`/support` 命令**（新增，跟 `/mybets`/`/hot` 同款注册方式 `bot.command('support', supportHandler)`）：显式引导入口，展示反馈渠道说明 + 示例问法。
2. **`message:text` 兜底改造**：`generic_help` 分支替换为反馈 agent 调用（`PM.inBetFlow` 判断在前，不改押注流程；`确认/yes/数字` stale-session 判断在前，不改）。用户没在下注流程里、又不是这些特例词的自由文本 → 走反馈 agent。

## §2 身份锚定（H2 落位）

复用既有 `PM.getLinkedAddr(tgUser)`（`bot.mjs:432` 已在用，同一个函数）→ 若返回地址，再查 `tg_custodial_wallets`/`bettor_pk` 映射（`tg-wallet.js` 既有表）拿到 `bettor_pk`。**这个查询在 tg-bot handler 里、调 LLM *之前* 做，结果作为 harness 侧上下文注入进 system prompt 的事实陈述（"当前用户地址=X，pk=Y"），绝不作为 LLM 可调用工具的参数**——工具 schema（见 §3）里没有任何 `address`/`pk`/`tg_user_id` 字段，查询用户自己数据的工具函数签名里这些值由 handler 闭包直接传入，不经过 LLM 生成的参数。

未锚定用户（未 `/link`、无 custodial wallet）→ agent 只给通用帮助文案，不触发任何数据查询工具调用。

## §3 工具面（H1 落位）

新建 `tg-bot/feedback-tools.mjs`（或 `kasia-console/src/services/feedback-agent-tools.mjs`，视 console 桥落点定），导出一个**独立字面量数组** `FEEDBACK_TOOLS`：

```js
export const FEEDBACK_TOOLS = [
  { type: 'function', function: { name: 'query_my_bets', description: '查当前用户自己的押注历史', parameters: { type: 'object', properties: { status_filter: { type: 'string', enum: ['all','won','lost','pending'] } } } } },
  { type: 'function', function: { name: 'query_market_status', description: '查某个市场的当前状态', parameters: { type: 'object', properties: { market_id: { type: 'string' } }, required: ['market_id'] } } },
  { type: 'function', function: { name: 'open_ticket', description: '为当前用户开一个反馈工单', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
];
```

调用 `_callLlm(messages, ctx, { tools: FEEDBACK_TOOLS, systemPrompt: FEEDBACK_SYSTEM_PROMPT })`——显式传参，**不**用 `broker-llm-agent.js` 默认导出的 `TOOLS`，不对 `TOOLS` 做运行时 filter（filter 后的子集仍然"源自"完整数组，违反 H1 精神，且未来 `TOOLS` 增项会静默混入）。

**静态断言（DoD 必含）**：单测 `import { FEEDBACK_TOOLS } from '...'; import { TOOLS } from 'broker-llm-agent.js'` 断言 (a) `FEEDBACK_TOOLS !== TOOLS`（不同引用）(b) `FEEDBACK_TOOLS` 每个 `function.name` 都不在资金类操作白名单外（即：不含 transfer/settle/refund/claim 等字样的名字——正则守卫）(c) 无一 `parameters` 含 `address`/`pk`/`tg_user_id`/`user_id` 字段名。

## §4 升级判定（H3 落位）

在 §1 的 `message:text` handler 入口处，**LLM 调用之前**，对用户原始输入文本跑确定性关键词匹配（正则/关键词表，非 LLM）：

```js
const ESCALATE_KEYWORDS = /退款|没到账|钱不见|争议|投诉|骗|hack|漏洞|资金|refund|money.*(missing|gone)|dispute|scam/i;
const escalated = ESCALATE_KEYWORDS.test(rawUserText);  // rawUserText = ctx.message.text, 未经LLM处理
```

`escalated` 一旦为 `true`，本轮对话标记 escalate=true 并**不可被后续对话内容撤销**（用户后面说"算了不用升级"不清除这个标记——判定发生在收到第一句触发文本的那一刻，是会话级粘性状态，非可协商）。工单 `execution_states.action_type='user_feedback'` 行落 `escalated=1`，`events` 写一条 `feedback_escalated`（payload 含用户原始输入原文，N1 要求），随后走 `postOwnerMessageToDevCoord`（`owner-bot.mjs:176` 已有函数，复用其 dev-coord 广播机制，非 Owner 专属那条 gate，改用一个新的"用户反馈"身份 relay 或复用现有低权限 relay 广播）推 dev-coord。

**社工话术负例（NWT 交付 7 条，落码时逐条跑通）**：紧迫性驱动/伪造权威/诱导取消升级（上面已说明不可撤销）/跨身份套取（H2 已堵）/累积信任攻击/间接注入伪系统标记/升级载荷投毒——由于判定在 handler 入口对原始文本做正则，不读 LLM 输出，这几类话术对判定环节本身无效；仍需在 §3 工具面之外确认 agent 的诊断回复不会被这些话术诱导执行工具调用之外的动作（本设计工具面本就只读，无越权动作可诱导）。

## §5 N2：限流（NWT 要求实现设计必答）

- **单用户**：`tg_user_id` 维度，滑动窗口 5 次/分钟（内存 Map + 定时清理，同 `PM` 模块既有的会话状态管理模式，不新建表）。超限 → 静态文案"请求太频繁，请稍后再试"，不调 LLM。
- **全局**：复用 `broker-llm-agent.js` 既有的 adapter HTTP 端点，其自身已有的 Qwen 队列/超时机制（Rule 11 合规调用路径）天然是全局瓶颈——不额外新增全局计数器，若观测到本地 Qwen 被打爆再加（YAGNI，避免过度设计未验证的问题）。

## §6 留痕（§4 硬门）

每轮反馈对话 → `replies` 表一条记录（复用 conversations.js 既有写入路径）；每个动作（开工单/升级）→ `events` 表；工单状态 → `execution_states`。零新表。

## §7 用户面文案（铁律 0，样例先呈，落码前需 Owner 批）

**`/support` 引导语**（示例，待批）：
```
有问题想问？直接打字说就行，比如"我的押注怎么还没结算"。
我能帮你查押注记录、市场状态，开工单跟进。
涉及资金变动或需要人工判断的情况，会转给团队处理。
```

**升级提示**（示例，待批）：
```
这个问题需要团队处理，已经帮你开了工单（#{ticket_id}），团队会跟进，请耐心等待。
```

## §8 明确不做什么

- 不改 `PM.inBetFlow`/押注流程分支——反馈通道只接管 generic_help 死路，不碰其余逻辑。
- 不新建工单表——`execution_states`/`events`/`replies` 全复用。
- 不做 web 客服面板——TG 是唯一入口（框架 §4 已定）。
- 不承诺响应时效——如实告知"团队会跟进"。

## §9 落码前置

1. NWT diff 审（重点：FEEDBACK_TOOLS 独立性静态断言实落/身份参数零 LLM 暴露实核/升级正则覆盖 7 条话术负例/N2 限流实现）。
2. §7 用户面文案 Owner 批复。
3. 落码后：锚定用户+未锚定用户各测一轮、双门槛升级各测一次确认 dev-coord 真收到（带原始输入原文）。
