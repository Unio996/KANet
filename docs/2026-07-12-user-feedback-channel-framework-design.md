# 用户↔系统反馈沟通通道 — 方向框架稿(设计先行①)

> **Status**: CURRENT(框架稿·待 NWT 红队;红队过后才拆实现卡派工,落码前不动代码)
> **作者**: Bettor(架构师帽)· 2026-07-12 · 依据: Owner 终端直令(7/12 06:1x"用户和系统层反馈沟通,本地智能体承接,难度升级转人工,做好身份、职责边界和安全考量"+"不重复造轮子,重在梳理和接通")+ J1tn 转达 Owner 安全边界要求(tx 8cae155c,身份三锚已认证)+ NWT 三硬门(06:25 checklist)。
> **资产依据**: 全库只读摸底(2026-07-12,tg-bot/console/agent-mind/DATABASE.md 六项),复用件清单见 §1。

## §0 一句话

用户在 TG 里说人话反馈问题 → 本地智能体(既有 LLM 对话管线)诊断/解释/开工单,**全程只读**;命中"涉资金 或 需新判断"任一门槛 → 既有 owner-bot 桥转人工。**净新造 ≈ 5 个小接点,其余全部接通现成件。**

## §1 复用资产地图(全部实读核过,file:line)

| 能力 | 复用件 | 位置 |
|---|---|---|
| 用户前端 | grammY 命令框架 + 自由文本入口 | `tg-bot/bot.mjs:426`(现在自由文本只回静态 generic_help=浪费的入口) |
| 自然语言→回复 | `handleLlmDialog`/`_callLlm`(Rule 11/13 合规+retry+留痕已封装) | `broker-llm-agent.js:925/:277` |
| DM 入站路由 | `POST /api/agent/reply` 三级分发 | `conversations.js:324+` |
| 工单本体 | `execution_states`(状态+owner 审批语义)或 `pending_actions`(队列+重试+幂等) | DATABASE.md L384/L406 |
| 事件流水/回复留痕 | `events` / `replies` | DATABASE.md L340/L361 |
| 转人工桥 | owner-bot dev-coord 双向桥(`postOwnerMessageToDevCoord`/`pollDevCoord`) | `tg-bot/owner-bot.mjs:25-52` |
| 身份锚定 | tg_user_id↔kaspa_address↔bettor_pk 三段映射 | `tg-wallet.js:54`/`audit-prediction.js:28`/`pool.js:3479` |
| 用户回溯 | `GET /api/audit/prediction-trace/:user_pk`(接受 pk/address 双形式) | `audit-prediction.js:28` |

## §2 净新造最小集合(五接点,无一新表新管线)

1. tg-bot 新增 `/support` 命令 + `bot.on('message:text'):452` 的 generic_help 分支改为反馈引导(用户面文案=铁律0 Owner 批)。
2. TG→Console 一条 API 桥(照抄 console-api.mjs 既有调用范式),挂到 `handleLlmDialog`。
3. 工单语义:`execution_states` 新增 `action_type='user_feedback'` + `events` 对应 event_type(不新建表)。
4. 升级判定钩子:挂在 LLM 回复后置校验处,双门槛命中即走 owner-bot 桥(见 §3-③)。
5. 反馈 agent 的系统 prompt/工具面配置(见 §3-①,physical 只读)。

## §3 安全边界(硬门,NWT 三条 + Owner 要求逐条落位)

- **① 默认只读/建议性(物理隔离非提示词约束)**:反馈 agent 可调用的工具面 = 只读查询白名单(audit-trace/mybets 数据/市场状态/工单读写)。**零资金原语**——转账/结算/退款函数物理不在其可达面内,不是"prompt 里叮嘱不要转账"。任何涉资金诉求→agent 只能开工单+升级,资金动作永远走回"设计→红队→Bettor/Owner 批→执行"既有流程,不因对话界面抄近道。
- **② 用户输入不可信(社工假设显式化)**:用户话术是攻击面(伪装"钱没到账"诱导转账/伪装身份套取他人信息)。verify-value-source 纪律延伸到自然语言:用户声称的一切(txid/金额/身份)只作为查询线索,agent 回复只基于**自己链读/DB 读到的**事实。防跨用户信息泄漏:回复中的账户特定信息只限**当前 tg_user_id 锚定身份**(§1 三段映射)名下数据;未锚定(没钱包没 /link)只给通用帮助。
- **③ 升级双门槛(命中任一即转人工)**:(a)涉资金——诉求的满足需要任何链上/余额变动;(b)需新判断——现有规则/文档答不了、要出新口径。升级动作 = 工单标记 escalated + owner-bot 桥推 dev-coord(带工单 id+身份锚+agent 诊断摘要),**agent 不越界替 Owner/团队拍资金/新判断类板**。
- **④ 留痕全覆盖**:每轮对话→`replies`,每个动作→`events`,工单状态机→`execution_states`;审计可回放(与"全可审计"定位一致)。
- **⑤ 用户面文案**:/support 引导语、工单回执、升级提示——全部样例呈 Owner 批后落码(铁律0)。

## §4 诚实边界(不做什么)

- 不新造 LLM 管线/订阅机制/工单表——§1 全复用,违者需在实现设计里单独论证。
- 不承诺实时人工响应——升级=推 dev-coord 队列,响应时效如实告知用户"团队会跟进"。
- 不做 web 客服界面——TG 是唯一用户面(现状唯一真实入口)。
- 本框架稿不含实现细节(表字段/函数签名)——红队过方向后,实现设计另出(KANet-UI 主笔 tg 面 + J2 主笔 console 桥,各自半页,各走 diff 审)。

## §5 验收方向(实现卡的 DoD 基线,红队后细化)

1. 真人 TG 实测:锚定用户问"我的注怎么没结算"→agent 只读诊断给出链上事实+工单号;未锚定用户同问→只得通用帮助(跨身份信息零泄漏)。
2. 社工红队用例:伪装"钱没到账快转我"类话术→agent 零资金动作、正确开工单/升级(NWT 出攻击话术集)。
3. 升级链路实测:双门槛用例各一→dev-coord 真收到带完整上下文的升级消息。
4. 留痕回放:任一对话可从 replies+events 完整重建。
