# ANTI-PATTERNS — AI 协作工程陷阱档案

> **用途**: 新任务开工前强制阅读。每一条都是 KANet 真实踩坑沉淀。
> **维护**: Opus + 协作 AI + Owner。看见新陷阱追加一条。
> **首版**: 2026-04-24，从 v1 retail-dex 1990 行偏离事件提炼。

这份档案**不是** code style 指南，不是 best practice 合集。这里记的是**已经翻过车的具体模式**——每条都对应一次"看起来合理但落地后方向错"的实际教训。

---

## 规则 1 · 新建前必 grep 已有基建

> Owner 2026-04-24 第 3 轮纠正：
> *"已有部件不止你列出来的，还有之前一套基础设施，且经过检测的"*

### Wrong
看 task spec 说 "做 X 功能" → 直接开始建 `new-x-service.js` / `new_x` 表 / `skills/new-x.mjs`。

### Right
新建前**必跑下面这三个 grep**，看 KANet 里是否已经有类似能力：
```bash
grep -rnE "关键词|能力名" kasia-console/src/services/ | head -20
grep -rnE "关键词|能力名" agent-mind/src/skills/ | head -20
grep -rnE "关键词|能力名" agent-mind/src/kernels/ | head -10
```
并填三问：
1. 已有哪些类似能力？（列 3+ 个候选）
2. 为什么不能复用？（具体技术原因，不能只说"感觉不太一样"）
3. 这是不是又一个 retail-dex？（对照本文规则 3）

### Why
KANet 基建在 2026-03 到 2026-04 快速演进，Mind 30+ skill、exchange-machine 904 行、mm-otc 集成了 CCXT、autoTaker 有 reputation 门禁 —— AI 不扫完就做判断会**重复造轮**。retail-dex 五文件 1990 行就是这样产生的：
- `retail-dex.js:347 selectBestOffer` 偷 `autoTaker.selectBestOffer`
- `retail-dex.js:404 computeQuote` 偷 `autoTaker` 报价
- `retail-dex.js:926 broadcastAcceptV1` 偷 `handleExchangeAccept`
- `retail-dex.js:790 _triggerBuyPublication` 偷 `market-seeder` 挂单
- `retail-dex-dialog/memory/pusher/profile` 867 行 100% 重复 Mind 已有基建

---

## 规则 2 · 角色 ≠ 实体

### Wrong
文档说 "broker"、"agent"、"worker"、"manager" 这类**角色词**，AI 翻译进代码就变成：独立表 + 独立 API + 独立 skill + 独立 dialog + 独立状态机 = **一个新实体**。

### Right
角色是 **已有 Agent 的使用模式**，不是需要新建的对象。正确的问题不是"怎么建 broker"，而是"哪些已有 Agent 能力组合起来就是 broker"。

### Why
Owner 2026-04-24 第 1 轮纠正："**broker 就是 seeker 和 taker 的粘合剂**"。v1 spec 把"粘合剂"理解为"中间层实体"，产生了：
- `retail_dex_orders` 表（应该进 `exchange_offers`）
- `is_dex_broker` 字段（任何 Agent 都能粘合，不需要标签）
- `/api/broker/*` 专属 API（`/api/agents/*` 通用端点够用）
- `retail-proxy` 唯一 skill + 关闭其他 30 个 skill（见规则 5）

AI 在训练先验中看到 "broker" 会自动映射到"券商实体"，写 spec 和 review 时要**反复校准**这个失真。

---

## 规则 3 · 禁止 `if asset === 'X'`

### Wrong
```javascript
if (order.asset === 'KAS') {
  // Kaspa-specific logic
}
```

### Right
```javascript
// 走协议字段，不对标的做主观判断
const chain = resolveChain(order.asset);
const adapter = getChainAdapter(chain);
await adapter.settle(order);
```

### Why
Owner 2026-04-24 第 2 轮纠正："**现在是 KAS 的标的，未来变成其他很容易的**"。KANet-Positioning：*协议不做对标的的主观判断*。写死 KAS 的代码 = 封死多资产泛化 = v2 扩展到 BTC/SOL/任何 token 时要重写整块。

当前 `trade-protocol-filter.js` 部分路径还有 KAS-specific 分支 —— 新代码不要再引入，改造时逐步搬到协议字段。

---

## 规则 4 · 单 skill Agent 不是粘合

### Wrong
给 Trader-B 启用 `retail-proxy` 一个 skill，关闭其他 30 个 skill，声明"这是 broker"。

### Right
**粘合角色需要多 skill 协作**：对话 (`conversational-ops`) + 记忆 (`memory` kernel) + 主动推送 (`proactive`) + 用户画像 (`address-profiler`) + 社交触达 (`social-outreach`) 合奏。**关闭其他 skill 即违反粘合定义**。

### Why
粘合本来就是 "调度多种能力对接用户" 的动作。用一个 skill 把其他 skill 全关掉，相当于把"服务员"降级成"接线员"——丢掉了记忆、画像、主动跟进、多语言对话等**真正让粘合有价值**的能力。

v2 spec 第二章反例：任何"把 Agent skill 限制到一个"的设计都触发此规则。

---

## 规则 5 · 理念是锚不是教条

> Owner 2026-04-24 第 7 轮纠正：
> *"无论什么理念，我们都要从实际场景出发"*

### Wrong
看到 KANet-Positioning："不托管资金" → 代码里**一概拒绝**任何"用户把 KAS 转给 Agent"的场景 → 用户直觉就想转 KAS 给 broker 处理 → 体验崩。

### Right
理念是方向锚，具体场景可**合理突破教条只要对齐锚心**：
- v1 错法：为了 "不托管" 拒绝 B 模式（sell KAS 场景）→ 失去实际价值
- v2 正法：保留 B 模式（broker 短暂代持 + 自动代卖 + 跨链转 USDT），**保持三重透明**（费率 + 流程 + 链上证据）—— 没违反 "无暗箱" 锚心

类似地 "不撮合" 的原话是**不搞平台撮合**，但帮用户发现匹配对手方是粘合的合理范围。

### Why
"不 X" 类规则往往是**防止特定滥用**而非禁止**所有表面类似的动作**。新代码触犯边缘时，要追问"原规则要防止的滥用是什么"，不是机械套用。

---

## 规则 6 · 广播发送必须校验自己 relayId

### Wrong
代码里任何地方 **hard-code 一个 relayId** 调 `/api/chat/send` 或 `sendCommandAsync('send_broadcast')` —— 特别是当这个 relayId 不是"本 daemon/skill 自己的 Agent" 时。

### Right
- 每个发送链上广播的 script/daemon 启动时**读自己的 relayId 到 CFG.relayId**
- 调 send API 时**显式传 CFG.relayId**，绝不从外部输入 (LLM 回复 JSON、用户 payload、bridge 透传) 抽取 relayId
- Code review 必 grep `relayId` 和 `/api/chat/send`，确认每个调用点的身份来源可追溯到 daemon 自己

### Why
2026-04-24 20:52-20:53 发生身份冒用事件：两条 `pqqqe78fjev3` (J2) 地址发出的 broadcast 非 J2 Opus 本人。根因嫌疑是某个 daemon 错用了别人的 relayId。

链上广播一旦上链**不可撤回**，冒用会破坏责任链、reputation、三方协作信任。这条规则不是架构，是**安全底线**。

---

## Case Study · v1 retail-dex 1990 行偏离（2026-04-23 → 2026-04-24）

### 事件时间线
- **04-23 11:00** J1 Opus 写 `docs/spec/2026-04-23-dex-agent-v1.md`
- **04-23 13:42 — 04-24 00:45** QClaude 按 T1-T9 实施，smoke 全绿
- **04-24 早** Owner 发现"broker + seeker + taker 一体"架构与粘合本质矛盾
- **04-24 中** Owner 6 轮对话纠正方向
- **04-24 下午** J2 Opus 写 v2 spec，J1 Opus + QClaude 审校
- **合计产生**：5 个新表 / 5 个新文件 1990 行 / 1 新 skill / 1 新字段 / 1 专属 API / 1 UI tab / 1 绕路白名单

### 偏离路径
每一条都触犯本文档一条规则：

| 偏离 | 触犯规则 |
|---|---|
| 建 `retail_dex_orders` 表 | 规则 1（`exchange_offers` 已在） |
| 建 `is_dex_broker` 字段 | 规则 2（角色不是实体）|
| 建 `retail-proxy` 单 skill + 关其他 | 规则 4（单 skill 不是粘合）|
| "撮合费隐形收 Maker 少发 KAS" | 规则 5（违反 KANet"无暗箱"锚心）|
| `retail-dex.js:347 selectBestOffer` | 规则 1（`autoTaker.selectBestOffer` 已在）|
| `retail-dex-dialog/memory/pusher/profile` 867 行 | 规则 1（Mind 基建 100% 重复）|
| `conversations.js:118-130` 绕 Mind 白名单 | 规则 2（把"状态机模式"写成"独立路由"）|
| 所有 KAS-specific 流程 | 规则 3（`asset === 'KAS'` 打补丁）|

### 为什么没被 smoke test 拦住
T1-T9 每个单元 smoke 都 PASS（功能层面代码都能跑），但**测试不能测 "架构方向是否偏离"**。v2 引入：
1. Spec 审校环节（至少 Owner + 另一个 AI 过一遍）前置到 T 任务之前
2. 每个 T 任务前强制追问"这和已有基建什么关系"
3. Smoke test 加"方向对齐"检查（对照 spec 主张）

### 废除与保留（见 v2 spec 第七章）
- **废除**：retail-dex/* 五文件走向 + `conversations.js:118-130` 白名单
- **保留改造**：`retail_dex_broker_config` 改名 `agent_service_terms`（Agent 服务声明通用载体）
- **保留**：Trader-B Agent 本身 + UI "Broker tab" 改名 "Agent Services"

---

## 规则 7 · 共用频道要分层 — 协作频道禁止 Agent 自动发

### 来源
2026-04-24 下午 proactive spam 事件：J1 往 `kanet-arch` 发 TASK-ALLOC，数秒内 7+ 个 Agent 的 Mind proactive cycle 看到新广播就各自调 Brain 生成 "[SILENT]" / "已看到, 同意" / 英文 proactive 复读并 broadcast 回去。频道 5+ 条/分钟被 LLM 自嗨淹没，真人和 Opus 之间的协作消息被埋。

### Wrong
- 协作频道（`dev-coord` / `kanet-arch` / `kanet-review` / `kanet-alert`）和 Agent 公共频道（`general` / `kanet-exchange` 等）**不区分**，任何 relay 都能发。
- Agent proactive 默认往用户最近关注的 channel 回复。
- Firewall 只在一处（比如 action-executor）拦截 —— 另外的路径（比如 `triggerAutoReply` IPC 或 Mind 直调 `/api/chat/send`）绕过。

### Right
**分层 + 白名单 + 纵深防御**：
- 定义一批"协作频道" `COORD_CHANNELS` 常量，Agent Mind 一律不能发。
- 定义"Opus/Owner relay 白名单" `OPUS_RELAY_NAMES`，只有这些 relay 能往协作频道发。
- Firewall 挂 **每一个**可能发广播的层（Console endpoint / action-executor / auto-reply IPC），逐层检查，缺一不可。
- Check 用 `relay.name`（来自 DB），不用 header / LLM 输出 / 用户 payload（都能伪造或幻觉）。

### Why
协作频道的价值是**低噪高信**：人类 + Opus 就方向问题快速收敛。Agent proactive 是 LLM 生成的"看起来合理"的消息，**对决策无权威但会污染注意力**，且可能**冒名顶替式地"赞同"某个方案**（比如本次事件里一堆 Agent "推荐 option b"，但他们没决策权）。

Agent 的 proactive social outreach 应留给 `general` / `kanet-exchange` 这类 agent-to-agent 活动频道，不踩协作线。

### 工程落地
- `agent-mind/src/action-executor.mjs sendBroadcast` ← 第一道
- `kasia-console/src/api/chat.js POST /api/chat/send` ← 第二道（Console 层）
- `kasia-console/src/api/chat.js triggerAutoReply` ← 第三道（IPC 路径）

**关键**：firewall 数量不是问题，**一漏就全泄**。

---

## 规则 8 · Ready probe 永远用 GET / health，不用 POST

### 来源
2026-04-24 NWT 完成 T-NWT-04 时诚实报告：她用 `curl POST -d '{"name":"_probe"}' /api/relay/xxx/publish-card` 在 loop 里当作 Relay ready probe，等 `200` 再发真 card。**Relay ready 的那一刻真把 `_probe` 当 card 请求处理了**，上链成一张 name="_probe" 的 Agent Card。Kasia card 是链式结构（root_tx 不可改），`_probe` 永久成了 Trader-B 的首张 root card，真 card 只能做 latest（指向 `_probe` 的 parent）。功能无影响（Scout 看 latest），但审计回溯永远能看到这个污点。

### Wrong
```bash
# 用"有副作用的 POST"当 readiness check
until curl -sf -X POST http://localhost:3100/api/x/publish-card \
    -H 'Content-Type: application/json' \
    -d '{"name":"_probe"}' > /dev/null; do
  sleep 1
done
# 目的只是等 endpoint ready, 但每次成功调用都是一次**真请求**
```

### Right
```bash
# health endpoint 或纯读 endpoint, 永远没副作用
until curl -sf http://localhost:3100/health > /dev/null; do sleep 1; done

# 或用 endpoint 自己的 read path
until curl -sf http://localhost:3100/api/relay/$ID/card > /dev/null; do sleep 1; done
```

### Why
**上链操作不可回滚**。Kasia broadcast / EVM transfer / mm-otc publish — 任何 probe 如果触发真 state change，污点就永久。区块链的"append-only"对正确数据是特性，对 probe 数据是诅咒。

**判断是否 safe probe**：endpoint 名 + HTTP method 就能看出来。`GET /health` 安全；`POST /x/publish` / `POST /x/create` / `POST /x/send` 不安全。不知道就查代码，**永远不拿带副作用的 endpoint 做 ready check**。

### 实例教训
Trader-B 首张链上 card root_tx = `8663390e8e1fc9c4...` name="_probe" — 这不可改，已作为历史档案留存。NWT 本人把这条记入她自己的 anti-pattern 本，这条规则正式沉淀到团队档案。

---

## 规则 9 · Qwen LLM caller 必加 chat_template_kwargs.enable_thinking=false

> NWT 接位 2026-04-26 17:00 — broker-llm-agent.js _callLlm 漏写, Owner 真测撞 LLM 60-120s timeout 反复.
> Owner 原话: "这个问题不是之前一个智能体早就发现了, 而且给出了解法！？？？搜！"

### Wrong
```js
fetch(`${aiUrl}/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
  signal: AbortSignal.timeout(60_000),
});
// 没 chat_template_kwargs → Qwen3.6 默认 reasoning mode → thinking 累积
// → 60-120s timeout, prompt 跑到 56k tokens (含 thinking)
```

也错: `messages[0].content = '/no_think\n' + sys` 或 user message 加 `/no_think` 后缀.

### Right
```js
fetch(`${aiUrl}/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({
    model, messages, tools, tool_choice: 'auto',
    chat_template_kwargs: { enable_thinking: false },  // ← QWEN-RULES.md Rule 11
  }),
});
// 可选兜底: data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, '')
```

### Why
**QWEN-RULES.md Rule 11 实测 (line 279-281)**:
| 方法 | answer | thinking | 时间 |
|---|---|---|---|
| sys /no_think | 116c | **1974c (不生效)** | 8s |
| user /no_think | **0c ❌** | 2756c | timeout |
| **chat_template_kwargs** | 163c ✓ | **0c ✓** | **1s** ✓ |

Qwen3.6-35B-A3B 默认 `reasoning-budget: activated, budget=2147483647`. `/no_think` 前缀 sys/user 都不生效 (Qwen3 chat template 不识别). 唯一有效是 API body kwarg.

已有 4 个 caller 全 follow:
- `agent-adapter/src/providers/openai.mjs:141`
- `kasia-console/src/services/llm-dispatcher.js:22`
- `scripts/qwen-bridge-worker.js:105`
- `scripts/qwen.js:92`

新写 LLM caller 前 grep `chat_template_kwargs` 直接复制. 写完 commit 前 lint 自动检 (`scripts/lint-kanet.mjs`).

---

## 规则 10 · 新 broker DM kind 必同步注册 TX_PRODUCING_KINDS + executeAction case

> J2 2026-04-26 12:46 T-J2-26b: dm_paid_no_tx 漏注册 → 'unknown queue kind' FAIL after 3 retry = 90s 静默, J1 case 2 真链路 8/12 TIMEOUT 真因.
> NWT 2026-04-26 17:00 重犯: dm_auto_payment_detected (T-NWT-V2) + dm_order_confirmed (议 1) + dm_price_query (hotfix) 都漏过.

### Wrong
broker-buy-handler.js / broker-sell-handler.js / 新 watcher 加新 DM kind:
```js
_qDm('dm_my_new_kind', peer, message);  // 没改 broker-action-queue → 'unknown queue kind' throw
```

`broker-action-queue.js executeAction` 默认 `throw new Error('unknown queue kind: ' + kind)` → retry 3 次 backoff 6s × 3 = 18s. 加 anti-spam dedup 14min, 重复 message 永远发不出.

### Right
**新 DM kind 必同步改 3 处**:

1. `broker-action-queue.js TX_PRODUCING_KINDS` Set — 加新 kind
   ```js
   const TX_PRODUCING_KINDS = new Set([..., 'dm_my_new_kind']);
   ```

2. `broker-action-queue.js executeAction` switch — 加 case 跟其他 DM 一致路由
   ```js
   case 'dm_quote':
   case 'dm_pay_instr':
   case 'dm_my_new_kind':  // ← 新加
     return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_message', target: item.peer, message: p.message });
   ```

3. `_qDm` 调用处 — 写新 kind 用法

### Why
broker-action-queue 是单线 FIFO pump, 所有 broker 对外动作走这里. kind 是路由 key, 必须全注册否则 throw. 漏注册不是 lint 错 (语法对), 是运行时 throw → retry 浪费 18s + 阻塞 queue + anti-spam dedup 拒重发.

T-J2-26b 是真链路实测 8/12 TIMEOUT 90s 才发现真因. 新代码可借助 lint 静态扫 `_qDm\('([^']+)'` 提取所有调用 kind, 对照 TX_PRODUCING_KINDS Set 完整性, 漏报错.

---

## 规则 11 · 中文 deterministic regex 必含 (?:了)? 完成态助词后缀

> J1 2026-04-26 13:50 case 2 v6 报告: '转完了' 1/12 LLM timeout (标"偶发").
> NWT 2026-04-26 16:00 PAID_NO_TX 扩展时发现真因: 不是 LLM timeout, 是 PAID_NO_TX_REGEX 漏 "了" 后缀 → fall LLM → LLM timeout.

### Wrong
```js
const PAID_NO_TX_REGEX = /^(?:已付|付了|转完|完成|...)\s*[!！。.…]*\s*$/i;
// "转完了" → "转完" + "了" + "" → 不匹 (regex 没含 "了" 单独后缀)
// 静默 fall LLM → 60-120s timeout (Rule 9) → 体验崩
```

### Right
```js
const PAID_NO_TX_REGEX = /^(?:已付|付了|转完|完成|...)\s*(?:了)?\s*[!！。.…]*\s*$/i;
//                                                ^^^^^^^^^ 助词后缀
// "转完了" → "转完" + "了" + "" → 匹 ✓
// "完成了!" → "完成" + "了" + "!" → 匹 ✓
// "已经付了" 在 list 直接 hit, 也能被 "已经付" + "了" 匹 (双覆盖)
```

### Why
中文完成态助词 "了" 是高频结尾, deterministic regex 漏即静默退化 LLM. 类似助词:
- 完成态: 了 / 啦
- 询问态: 吗 / 呢 / 嘛
- 强调态: 啊 / 哦 / 呀

任何 user-facing deterministic intent 检测的中文 regex 都加 `\s*(?:了|啦)?\s*` (完成动作类) 或对应助词 (其他类).

不加的隐性代价: J1 case 2 v6 把这个标"偶发 LLM timeout 1/12", 实际是结构性 regex 漏. 测试报告可能误判, 真因藏在 LLM 兜底.

---

## 规则 12 · 接位 Agent 必扫 ANTI-PATTERNS.md 在写代码之前

> Owner 2026-04-26 17:30 元问题: "我感觉这些事情, 以前做过的, 但是还会不断遇到重复的问题, 怎么解决?"

### Wrong
新会话 / 接位 Agent:
1. 读 CLAUDE.md 必读 4 文档
2. 读 memory 索引看历史 context
3. 直接开始写代码

**漏掉**: 写代码涉及的具体技术陷阱档案 (本文件 / QWEN-RULES.md / dev-* 子文档 / git log 该领域 commit message). 凭直觉填代码 → 重复犯过的错.

### Right
**接位 SOP 第 1 步 (写代码前必扫)**:

1. **领域 anti-pattern**: `grep -i <topic> docs/ANTI-PATTERNS.md docs/QWEN-RULES.md` (本文 + Qwen 规则)
2. **现有 caller 模式**: `grep -rn <key_function> kasia-console/src/` (e.g. 写 LLM caller → grep chat_template_kwargs 看现有怎么写)
3. **该领域 commit 历史**: `git log --grep=<topic> --oneline -20` (近期相关 fix 暴露的坑)
4. **memory 相关 feedback**: `grep -ri <topic> ~/.claude/projects/*/memory/feedback_*.md`

**接位 SOP 第 2 步 (写完 commit 前必跑)**:
- `node scripts/lint-kanet.mjs` 检 KANet-specific 静态规则 (LLM kwargs / DM kind 注册 / SQL prepare / 链上身份等)
- 失败一条 commit 都不让. 加 git pre-commit hook 强制.

### Why
KANet 知识沉淀分散在 6 个容器: ANTI-PATTERNS.md / QWEN-RULES.md / DEVELOPER-GUIDE.md (索引→guide/*) / DATABASE.md / memory/ / 频道历史 / commit message. 没统一索引就靠 Agent 自觉, 接位时认知盲区是必然.

强制扫描 + Lint 堵口子 = 把"自觉记忆"降级为"机制保证". 重复犯错次数从 N 降到 0.

每次撞了未在 ANTI-PATTERNS.md 的新坑, 立即追加一条 + 写 lint rule 堵死. 文档 + 工具双层防御.

---

## 如何扩充本档案

新陷阱踩过后**立即**追加，格式保持：
- 规则名（陈述句）
- 来源引语或日期（有源头更有说服力）
- **Wrong**（具体反例代码或设计）
- **Right**（正确做法 + 三问清单或代码骨架）
- **Why**（一两段，点出这条规则**防止的具体滥用**）

新陷阱不要和现有条冲突；如果新陷阱和旧条拉扯，说明一条需要更精细拆分，去改旧条。

**强制阅读触发**: CLAUDE.md 必读列表已含本文件 (2026-04-26 NWT 加). 新会话 / 接位 Agent 写代码前必扫此档案 + 跑 `scripts/lint-kanet.mjs`.

---

*本档案在 v2 spec 第八章元教训基础上独立。spec 聚焦"这次怎么做"，本档案聚焦"下次别再犯"。*
