# NWT 红队 — 用户反馈通道 卡B(console 桥)实现设计(ea44d567)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-user-feedback-channel-console-side-design.md(J2)
> **verdict**: **GREEN-with-MUST-FIX——H1-H3 继承正确+§4 三方案分析扎实(与 Bettor 裁定一致);G1 execution_states 复用有真实碰撞面(设计资产盘点漏查的下游消费者),折入后落码 GO**

---

## Bettor 委托的数字核对(167 vs 0)——已查清,顺手挖出更重要的问题

`DATABASE.md:384` 记"execution_states(167 条)",我独立查询(readonly,与 J2 的 `SELECT DISTINCT type` 独立)确认**生产 0 行**——J2 claim 属实,DATABASE.md 是陈旧文档(某历史快照的行数,非当前 live 状态)。

**但顺着这条线追下去,挖出一个设计 §1 资产盘点漏查的真实碰撞面**:DATABASE.md 记该表"读取方:Episode 系统、审批 API"——我 grep 确认这些**仍是活跃代码**(`episode-builder.js`/`trading.js`/`mind-manager.js` 全部当前引用 `execution_states`)。逐个查询是否会碰上反馈工单行:

| 消费者 | 查询 | 是否碰撞反馈行 |
|---|---|---|
| `episode-builder.js:80` | `WHERE order_id = ?`(参数化) | 否——反馈行 order_id 应为 NULL,不会被具体 order_id 查中 |
| `mind-manager.js:1096` | `JOIN mm_orders ... WHERE order_id=... AND approval_deadline<now` | 否——INNER JOIN 对 NULL order_id 天然不匹配 |
| **`trading.js:1964-1967`** | `SELECT * FROM execution_states WHERE status = 'pending'`(**无 type/order_id 过滤,`GET /api/trade/pending-approvals` 不带 `agent_address` 时的"返回全部 pending"分支**) | **🔴 是——碰撞** |

## G1 🔴 MUST-FIX(真实碰撞,非假设): 反馈工单会混进 Owner 的"待批交易"审批视图

设计 §2 明确反馈工单落 `execution_states` 行 `status='pending'`(与其余字段一起)。`trading.js:1959-1967` 的 `GET /api/trade/pending-approvals`(无 `agent_address` 参数时)裸查询**全表**`WHERE status='pending'`,**没有 type 过滤**——反馈工单行会跟真实交易审批行混在一起返回,呈现在 Owner 审批 UI 里。

**后果链**:①Owner review "待批交易"列表时看到用户反馈工单混入,认知负担/可能忽略真实交易审批(alert fatigue 的反向——把无关行混进关键审批流);②若 Owner 误以为某条反馈行是笔交易点了"批准"(`POST /api/trade/approve-execution/:id`,1972-1994 行),代码会调 `approveExecution`+`startExecution`——把反馈工单的 `status` 强行推进 money-flow 状态机(approved/executing,J2 设计明确说反馈工单**不该有**这两态)。行 1983 `if (exec.order_id && exec.type)` 因反馈行 `order_id` 应为 NULL 会跳过实际转账调用(现状**物理安全**,不会真花钱),但**工单状态被污染成不该出现的值**,且这个安全性依赖"order_id 恰好是 NULL"这个隐性前提,不是显式设计出来的防线。

**修法(二选一,落码前定)**:
- (a) `trading.js:1964-1967` 的裸查询加 `AND type NOT IN ('user_feedback', ...)` 或改成白名单 `type IN (真实交易 type 列表)`——这是**改既有代码**,需评估是否在卡B 落码 diff 范围内(建议是,否则反馈通道一落地就给既有交易审批面引入噪音,是本设计造成的回归);
- (b) 反馈工单**不用 `status='pending'`**,改用一个不在 `status` 枚举里被这条查询捕获的值(但 `execution_states.status` 是自由 TEXT 无枚举约束,"不用 pending"只是回避不是修复——`trading.js` 的查询依然是"查全表 status=pending 不分 type"这个结构性问题,换个值只是这次绕过,未来别的反馈状态复用 pending 语义又会撞上)。

**我倾向 (a)**:既然要复用 `execution_states`,复用方就该把"下游已知消费者需要按 type 区分"这件事在**表的层面**修好(一次性,惠及所有未来的非交易类 type),而非在反馈通道这边"挑一个不会被现有查询捕获的巧合值"这种脆弱做法。

## H1-H3 继承核实

- **H1**:`FEEDBACK_TOOLS` 与卡A §3 示例逐字相同,卡B 钉为唯一实现落点(console 侧,与 `_callLlm` 同进程)——单源落点合理,卡A 落码时 import 这份而非各自定义,避免规则55/D-008 同族的"两处独立实现同一份"家族病。静态断言(allow-list 精确匹配)同卡A v1.1 的 F1 修法,一致。
- **H2**:§2"console 端再次校验——不信任 tg-bot 传来的值未经验证,bettor_pk 必须与 linked_addr 反查一致,不一致 fail-closed"——**这正好闭合了我在卡A 审查时记的 N1**(H2 完整性依赖卡B 契约)。跨进程调用不信任上游声称值,重新验证,同 verify-value-source 精神延伸到跨进程边界,认可。
- **H3**:复用卡A 的 `ESCALATE_KEYWORDS` 单源(非各自定义),同 canonicalize 单源铁律精神——正确决定,防止未来两处正则各自维护出现漂移(同 F2 那种漏洞若只修一处、另一处不同步,复发风险)。

## §4 三方案分析(Bettor 已裁方案B,我独立核实裁定合理性)

Bettor 裁方案B(events 行 + owner-bot 既有 poller 加一个轮询源,已授权身份代发)。我独立评估三方案:
- **方案A(直接开权限)**:正确否决——给反馈系统本身获得协调频道发言权 = 权限面扩张,且这个权限的"申请人"是反馈系统这样一个处理不可信用户输入的组件,风险不对称(H2/H3 已经在防的正是"用户输入不可信",却让处理这些输入的系统直接获得广播权,方向矛盾)。
- **方案B(选中)**:合理,复用既有 `broker-fee-emit.mjs` 式"写 DB 行→已授权 poller 拾取→用 poller 自己身份代发"模式(non-novel,今晚已验证过这个模式活的)。**但有一点必须显式钉死(呼应我框架审的 N1)**:poller 代发的内容如果是"LLM 生成的诊断摘要",trust 属性跟 `broker-fee-emit` 那种"poller 代码自己计算的链读事实"不同——**events 行 payload 应该是原始用户输入 + 工单元数据(raw fact),不是 LLM 润色过的摘要**,poller 转发时清楚标注"来自自动反馈系统,内容未经人工核实"。这条 Bettor 硬条件①("代发消息...物理不得影响 Owner 桥主职")已经在防"别把 Owner 通道搞挂"的可用性风险,我这条补的是**内容可信度标注**的风险,两者互补不重复。
- **方案C(否决)**:同意否决,coord-status 语义(D-010 Bettor 单写签名摘要)不该被复用于反馈系统这种不同信任模型的场景,混用会稀释 coord-status 频道本身的信任语义。

## 结论

H1-H3 继承扎实、方案B 合理(与 Bettor 独立裁定一致)、FEEDBACK_TOOLS 单源落点干净。**G1(execution_states 全表裸查询碰撞)是真实发现,非假设**——设计 §1 查了写入方/主要读取方,但漏了 `trading.js` 这个"无过滤查全表"的边缘消费者,这正是"资产盘点"该覆盖但容易漏的那类("查了主要用法,没查所有 SQL 引用点")。折入 G1 修法(建议方案 a:给 `trading.js` 裸查询加 type 过滤)+ 方案B 的内容标注要求后,**落码 GO**。落码 diff 我复审:G1 修法实落/execution_states 新 INSERT 字段完整性/events payload 是否为 raw fact 非 LLM 摘要。

— NWT 2026-07-12
