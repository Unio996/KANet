> **Status**: CURRENT

# 用户反馈通道 — 卡B: console 桥实现设计

**作者**: J2 · 2026-07-12,Bettor 派工 #hfctq1.2,框架 v1.1 `docs/2026-07-12-user-feedback-channel-framework-design.md`
**继承约束(NWT 条件,逐字原文,非自行诠释)**:
> H1: 反馈 agent 工具面 = 独立字面量数组,禁复用/运行时过滤 broker 默认 TOOLS;DoD 含静态断言。
> H2: 身份参数(pk/address/tg_user_id)禁止出现在 LLM 可控工具参数里——由 harness 从会话锚定硬编码注入,工具 schema 只暴露"查哪个市场"类非身份参数。
> H3: 升级判定独立于对话 LLM 的确定性检查——基于用户原始输入的关键词/规则匹配,不读 LLM 自己的分类标记或复述。

## §1 查了哪些既有资产(不猜代码)

| 资产 | file:line | 用于 |
|---|---|---|
| `_callLlm`/`handleLlmDialog` | `kasia-console/src/services/broker-llm-agent.js:277/925` | LLM 调用本体(Rule 11 合规+retry+留痕已封装),**在 console 侧,非 tg-bot 侧**——卡A §3 留了"落点视卡B定"的口子,本设计定案:FEEDBACK_TOOLS **单源落在 console**(与 `_callLlm` 同进程,不跨进程传工具定义) |
| tg-bot → console 调用范式 | `tg-bot/console-api.mjs` 全文(`poolRegisterPrep`/`myPositions` 等既有函数) | API 桥照抄此范式(`req('POST', '/api/...', body)`) |
| 转人工桥 | `tg-bot/console-api.mjs:176 postOwnerMessageToDevCoord` → `POST /api/chat/send`(`kasia-console/src/api/chat.js:214`) | **🔴 实读发现(非框架假设)**:这是**真实链上广播**(`sendCommandAsync send_broadcast`,花 KAS,过预算检查),且对 `dev-coord-testnet` 有 `COORD_CHANNELS` 防火墙(`chat.js:226`)——仅 `OPUS_RELAY_NAMES` 或 `trust_level='owner'` 的 relay 能发。见 §4 开放问题。 |
| 工单表候选 | `execution_states`(`kasia-console/src/services/execution-state.js`) | **🔴 实查(非猜)**:生产 0 行(`SELECT DISTINCT type` 空集)——非"live 复用"而是"复用 schema 形状"。语义偏money-approval(`agentAddress` NOT NULL/`approval_timeout` 自动算 `approval_deadline`/`permissionLevel` 默认 'owner')。`pending_actions` 候选同样 0 行且要求 `local_address`/`target_address` NOT NULL(转账语义,不适配)。**本设计选 `execution_states`**(与卡A wording 一致、字段形状更接近"追踪单元+状态机+审计"),但**不复用** `execution-state.js` 导出的 `approveExecution`/`startExecution`(那些函数假设的 status 词汇表是money-flow 专属,反馈工单没有"approved/executing"这两态),改用最小直接 INSERT/UPDATE(见 §2)。 |
| 身份映射 | `tg-wallet.js:54`/`pool.js:3479` | H2 落位复用(与卡A 同源) |

## §2 API 桥 + 工单

**端点**(照抄 console-api.mjs 范式,tg-bot 侧新增 `feedbackAgentReply(tgUserId, linkedAddr, bettorPk, rawText)` 调用):

```
POST /api/feedback/reply
body: { tg_user_id, linked_addr?, bettor_pk?, raw_text }
```

- `linked_addr`/`bettor_pk` 由 tg-bot handler(卡A §2)闭包传入(H2:身份已在 tg-bot 侧锚定完成,console 端**再次校验**——不信任 tg-bot 传来的值未经验证,`bettor_pk` 必须与 `linked_addr` 反查一致,不一致 fail-closed 只给通用帮助,同 verify-value-source 精神延伸到跨进程调用)。
- 端点内部:H3 确定性关键词判定(**复用卡A §4 的 `ESCALATE_KEYWORDS` 常量,单源,非各自定义一份**——放在 console 侧一个共享文件,tg-bot 若需要提前提示也 import 同一份,不允许两处正则各自维护出现漂移,同 canonicalize 单源铁律精神)→ 命中先落 `execution_states` 行(`type='user_feedback'`, `status='pending'`, `permission_level='feedback'`[新值,非 'owner',DB 层即可辨识这类行不是资金审批行], `agent_address`=固定的 feedback-agent 系统标识[非用户地址,非签名地址], `action_details` JSON 含 `{raw_text, escalated}`)→ 未命中/命中都调 `_callLlm(messages, ctx, { tools: FEEDBACK_TOOLS, systemPrompt: FEEDBACK_SYSTEM_PROMPT })`(H1)→ LLM 回复 + 工单号回传 tg-bot。

**FEEDBACK_TOOLS**(单源,`kasia-console/src/services/feedback-agent-tools.mjs`,与 `_callLlm` 同目录同进程):
```js
export const FEEDBACK_TOOLS = [
  { type: 'function', function: { name: 'query_my_bets', description: '查当前用户自己的押注历史', parameters: { type: 'object', properties: { status_filter: { type: 'string', enum: ['all','won','lost','pending'] } } } } },
  { type: 'function', function: { name: 'query_market_status', description: '查某个市场的当前状态', parameters: { type: 'object', properties: { market_id: { type: 'string' } }, required: ['market_id'] } } },
  { type: 'function', function: { name: 'open_ticket', description: '为当前用户开一个反馈工单', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
];
```
(与卡A §3 示例逐字同——两卡对同一份工具面达成一致设计,本设计钉为**唯一实现落点**,卡A 落码时 import 这份,不各自定义。)

**H1 静态断言**(单测,DoD 必含,同卡A 措辞但落在本文件):`FEEDBACK_TOOLS !== TOOLS`(不同引用)+ 每个 `function.name` ∈ allow-list 字面量三名单(**Bettor 注a**:allow-list 非正则黑名单,新增第四个工具强制碰断言=强制 review 检查点)+ 无一 `parameters` 含 `address`/`pk`/`tg_user_id`/`user_id` 字段名。

`query_my_bets`/`query_market_status`/`open_ticket` 三个工具函数的**实现**(handler,非 schema)由 harness 闭包注入 `bettorPk`/`linkedAddr`(H2:这两个值不出现在传给 LLM 的 tool schema 里,只出现在 handler 执行时的闭包变量),内部调用既有 `my-positions`/市场状态查询 endpoint(§1 复用)。

## §3 升级投递(dev-coord 桥,🔴 开放问题,见 §4)

`execution_details.escalated=true` → 触发投递。**注b(Bettor 折入)**:每工单一次(status 从非-escalated 首次转 escalated 时投递一次,同一工单后续消息不重复推,即使再命中关键词)。

## §4 升级投递机制(Bettor 已裁 #hfwel0,方案B + 两硬条件)

**裁定:方案B**(events 行 + owner-bot 既有 poller 加一个轮询源,已授权身份代发)。方案A 否(给 feedback
agent 开协调频道发言权 = 权限面扩张,且用户反馈流进协调频道语义污染);方案C 否(`coord-status` = D-010
Bettor 单写签名摘要频道,语义不容混用)。

落地形状:反馈工单升级时写一条 `events`(`event_type='feedback_escalated'`,payload 含工单 id/用户原始
输入原文)。`tg-bot/owner-bot.mjs` 既有轮询循环(Direction B: dev-coord → Owner Telegram 那条)**加一个
并行轮询源**(查这类 `events`,非改造既有 dev-coord 轮询逻辑),命中后用它已授权的身份代发到 `dev-coord-testnet`。

**硬条件①(Bettor,今天身份事件直接教训)**:代发消息**必须硬前缀标注权威归属**——
`[用户反馈工单#{id}·AI生成·非Owner/代发身份发言]` + 附用户原始输入原文(N1 要求)。owner-bot 的 relay
在 dev-coord 有权威色彩,不标注 = 下一次"转达 Owner"混淆的温床(同今天 qzdh7nar 身份事件教训直接应用)。

**硬条件②(Bettor)**:owner-bot 新轮询源 = 纯只读 `events` 查询 + 失败静默重试,物理不得影响其 Owner 桥
主职(不能因为加了这条反馈轮询就把 Owner 通道搞挂——新轮询源独立 try/catch,异常不传播到既有轮询循环)。

## §5 N2 限流(console 侧,与卡A 的 tg-bot 侧滑动窗口互补,非重复)

- **全局并发**:`/api/feedback/reply` 端点内存计数器,同时处理中的 `_callLlm` 反馈调用上限(建议 5,与 broker-llm-agent 现有 adapter 队列的经验值同量级)——超限直接 429,tg-bot 侧提示"请稍后重试",不排队等 LLM(避免用户体感"卡住")。
- 卡A 的每用户滑动窗口(5次/分钟)是 tg-bot 入口闸,本闸是 console 端全局闸,两层互补不重复。

## §5.5 文档修正(Bettor ③,查清并修正)

`docs/DATABASE.md:384` 记 `execution_states（167 条）`,与本设计 §1 实查 `SELECT COUNT(*)=0` 对不上——
**已现查确认 0 是当前真值**(非我查漏,167 是过去某次快照,DB 后来被重置/清库未同步更新文档)。已修正
`DATABASE.md` 该行标注为 stale + 加"改表前必须现查不能信文档数字"提示,防将来同坑复发。

## §6 留痕、诚实边界

同框架 §3-④/§4,不重复。本设计新增内容全部是"如何接线",零新表、零新权限授予(§4 待裁定项除外——那本身是"要不要新授权"的决策,不是本设计单方执行)。

## §7 落码前置

1. NWT 红队(重点:execution_states 字段映射是否可接受/§4 三方案裁定/FEEDBACK_TOOLS 与卡A 单源落点确认/N2 两层闸不重复覆盖)。
2. Bettor 对 §4 拍板(或升 Owner)。
3. 落码后:锚定用户查押注+市场状态各测一次工具调用、升级链路端到端测(带 §4 裁定的实际投递机制)。
