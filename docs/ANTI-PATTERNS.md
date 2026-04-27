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

## 规则 13 · 协议消息 self-accept 检不能只靠 _from (broker 代发场景)

> NWT 2026-04-26 18:00 — Sophie e2e batch + Owner 真测多次撞 'Accept rejected: self-accept (maker === taker: hy65lxur9c5l)' — hy65lxur9c5l = Trader-B (broker 自己).

### Wrong
```js
// exchange-machine processAccept
if (msg._from && msg._from === offer.maker) {
  // self-accept reject
}
```
broker_dynamic_quote 路径下:
1. broker 自挂 SELL offer (`maker = broker`)
2. broker 代 user 发 `accept_v1` (`msg._from = broker`, payload `receive_address = user`)
3. 检 `_from === maker` 撞 reject — 但实际 taker 不是 broker 是 user
4. user 拼单不够 broker 补 deficit 必撞这条, 不是偶发是结构性

### Right
```js
// 真 taker 优先 receive_address (broker 代发 carry), fallback _from (普通 client)
const taker = msg.receive_address || msg._from;
if (taker && taker === offer.maker) {
  // self-accept reject
}
```

逻辑覆盖:
| 场景 | _from | receive_address | maker | taker = | 结果 |
|---|---|---|---|---|---|
| 普通 user 自 accept | user | (缺) | user | user | reject ✓ |
| broker 代 accept (broker 自挂) | broker | user | broker | user | 通过 ✓ |
| broker 代 accept (真 maker) | broker | user | 真maker | user | 通过 ✓ |
| 普通 user accept 别人 | user | (缺) | 别user | user | 通过 ✓ |

### Why
KANet broker = 多角色聚合. broker 代 user 发协议消息时 (accept_v1 / paid_v1), `_from` 是 broker, **真 user 在 payload 字段**. 协议级校验若只看消息 sender 不看 payload, 必误伤所有 "broker 代 user" 路径.

类似教训范畴 (写新协议消息 / 处理逻辑时):
- accept_v1: `_from` 是发送方 ≠ 真 taker (taker 在 `receive_address`)
- paid_v1: `_from` 是发送方 ≠ 真 payer (payer 在 `payment_meta`)
- delivered_v1: `_from` 是发送方 ≠ 真 deliverer (deliverer 在 `seller`)

新加协议字段时, 校验逻辑必明确区分 "信使 (sender)" vs "实际方 (在 payload)". 否则 broker 代发场景全炸.

---

## 规则 14 · anti-spam fuzzy match 86%+ 也拦, 不只 100%

**来源**: J1 e2e v2 cleanup 'NO' 撞 anti-spam 162s before, 04-26 06:42

**Wrong**:
```js
// e2e cleanup 每次发 'NO' / 'YES' / 'BSC' 同 message
await sendMessage('NO');  // 14min 内同 message 100% similar 拦
await sendMessage('BSC 链付款 vcx');  // tag 不够多样, 跟 'BSC 链付款 chs' 86% similar 仍拦
```

**Right**:
```js
// 复杂 message: 用变体 + tag, 内容差异 ≥ 30%
const variants = ['pay with BNB Smart Chain', 'use Binance chain', '走币安智能链', '币安网络付 USDT'];
const tag = Date.now().toString(36).slice(-3);
await sendMessage(`${variants[Math.floor(Math.random()*variants.length)]} #${tag}`);

// handler 严格 word 集 (CONFIRM_WORDS / CANCEL_WORDS): 不能加后缀, 用 word 轮换
const CONFIRMS = ['行', '确认', 'OK', 'ok', 'y', 'YES', 'yes', '好'];
await sendMessage(CONFIRMS[Math.floor(Math.random()*CONFIRMS.length)]);
```

**Why**: anti-spam 14min window 不只 100% exact match, 还做 fuzzy similarity (Jaccard / Levenshtein). 'NO' 跟 'NO 取消' 86% similar 也拦. 'BSC 链付款 vcx' 跟 'BSC 链付款 chs' 也 86% similar (3 char ts2 不同, 共同前缀长). e2e 反复跑同测试集必撞. **复杂 message 用语言完全不同的变体集, 单字 word 用轮换**.

---

## 规则 15 · 多机 cherry-pick sync 必双向, 不能信 :9202 单边 bundle

**来源**: NWT restart #2 后跑老 SYSTEM_PROMPT, 漏 J1 e810ecf9, 04-26 09:30

**Wrong**:
```bash
# NWT 同机
git pull /tmp/j2.bundle  # 只拉 J2 bundle, 没拉 J1 :9201
git reset --hard j2-master
bash kanet-stop.sh && bash kanet-start.sh  # 缺 J1 commit, 跑老代码
```

**Right**:
```bash
# 多机 sync 三方共识协议:
# 1. 每方 push 自己 bundle 到 LAN (J1 :9201, NWT/J2 同机 :9202)
# 2. cherry-pick / merge 前必 fetch 所有方 bundle
curl -o /tmp/j1.bundle http://192.168.1.138:9201/bundle
curl -o /tmp/j2.bundle http://192.168.1.123:9202/bundle
git fetch /tmp/j1.bundle master:refs/remotes/j1/master
git fetch /tmp/j2.bundle master:refs/remotes/j2/master
# 3. git log master ^j1/master ^j2/master 看自己有没漏的
# 4. git merge 或 cherry-pick 缺的 commits
# 5. restart 前再 verify 关键文件含期望 commit (grep 关键 marker)
```

**Why**: 三方协作 master 长期分叉, 单边 bundle pull 漏对方 commit. NWT cherry-pick 自己 commit 漏 J1 e810ecf9 服务态度铁律, restart 后 broker 跑老 SYSTEM_PROMPT, Owner 真测撞老大爷口吻. **任何 restart 前必 双向 sync + 关键文件 grep verify**, 不信 'master 看着新就对了'. NWT push bundle 路径不通 (LAN 防火墙) → J2 同机代 push.

---

## 规则 16 · CONFIRM_WORDS 严格 exact match, 加任何后缀都不命中

**来源**: J1 e2e v2 q3 '确认 vcx' 不命中 CONFIRM_WORDS, 04-26 09:00

**Wrong**:
```js
// broker handler
const CONFIRM_WORDS = ['YES', 'yes', 'y', '确认', '好', '行', 'OK', 'ok'];
if (CONFIRM_WORDS.includes(trimmed)) { ... }  // exact match

// e2e 测试加后缀避 anti-spam
await sendMessage('确认 vcx');  // ✗ trimmed='确认 vcx' !== '确认' 不命中, 走 LLM 路径
```

**Right**:
```js
// e2e: 严格 word 轮换, 不加后缀
const CONFIRMS = ['YES', 'yes', 'y', '确认', '好', '行', 'OK', 'ok'];
await sendMessage(CONFIRMS[Math.floor(Math.random()*CONFIRMS.length)]);

// 或 broker handler 改 fuzzy match (扩 includes):
const isConfirm = CONFIRM_WORDS.some(w => trimmed.toLowerCase().includes(w.toLowerCase()));
```

**Why**: broker handleBuyIntent 用 `CONFIRM_WORDS.includes(trimmed)` 严格 exact match. 加任何后缀 (e2e 避 anti-spam tag) 让它不命中, 走 LLM 路径, LLM 看 'YES' 部分可能识别 confirm 部分自由发挥, 真 finalize_order 不触发. **handler 严格 anchor 的 word 集 e2e 必用单字轮换, 不加后缀**.

---

## 规则 17 · LLM step 2/3 字段混淆: '想买 X KAS' 后问 'KAS 收款地址'

**来源**: J1 e2e v2 q4 (Eric peer) broker LLM 把 buy 路径问 sell 字段, 04-26 10:14

**Wrong**:
```
SYSTEM_PROMPT 字段补全段:
- 买 KAS: 数量 + 链
- 卖 KAS: 数量 + 链 + 收款地址

→ LLM step 1 识别 'buy', step 2 问 chain OK
→ step 3 LLM 把 sell 路径的 '收款地址' 也带进 buy 路径, 问 'user 的 KAS 收款地址'
```

**Right**:
```
SYSTEM_PROMPT 强制路径隔离 + few-shot 示例:
**买路径绝不问 user KAS 地址** (broker 直接发 KAS 到 user Kasia address)
**卖路径必问 user EVM 收款地址**

few-shot:
- 用户 '买 5 KAS BSC' → broker 'OK 买 5 KAS, BSC 链确认?' (绝不问 KAS 地址)
- 用户 '卖 5 KAS' → broker '好, 给我你 BSC 收款地址 0x...'

或: fast-path 严格 BUY_REGEX/SELL_REGEX 命中走 handler, 不进 LLM step 2/3 (e2e 验证有效).
```

**Why**: LLM 看 SYSTEM_PROMPT '买/卖' 字段并列陈述, multi-turn 上下文中混淆. 用户先 '想买 X KAS' (LLM 识别 buy) 后回 'BSC' (LLM 应给 quote 但回'给我 KAS 收款地址' 把 sell 字段错位). **路径隔离必须显式 + few-shot 反例**, 不能让 LLM 自己推断. 或 fast-path 短路 LLM step 2/3.

---

## 规则 18 · broker DM 真发 truncated address, e2e 反查 db 拿全 wallet

**来源**: J1 e2e v2 Eric q4 reply '0xaD12544E7020e16D1279...3efcEe' regex `[a-fA-F0-9]{40}` 不命中, 04-26 10:14

**Wrong**:
```js
const makerAddr = reply.match(/0x[a-fA-F0-9]{40}/)?.[0];  // truncated 不命中, 加 {4,} 拿不全
```

**Right**:
```js
// 从 dm_order_confirmed parse order_id (8 hex)
const orderId = reply.match(/订单已确认\s*#([a-f0-9]{8})/)?.[1];
// 反查 exchange_offers 拿完整 wallet
const offer = db.prepare("SELECT verification_meta FROM exchange_offers WHERE id LIKE ? || '%'").get(orderId);
const meta = JSON.parse(offer.verification_meta);
const makerAddr = meta.accepted_chains.find(c => c.chain === 'bnb')?.address;
```

**Why**: broker DM 故意 truncate maker address (前 22 + ... + 后 6) 防误抄, 但 e2e 测试需要完整 0x{40hex} 给 evm-transfer. **e2e parse user-friendly DM 永远不可靠 (broker 文案随时改), 必须从 chain_events / exchange_offers 真 db query**. order_id 是稳定主键 (broker 显式 # 暴露给用户).

---

## 规则 19 · broker → user DM 含的链上地址必从 db fetch, 不接受 LLM/handler 传值

**来源**: J1 真测 67903c5b broker preview DM 编 fake `0x1234567890123456789012345678901234567890` (Owner '系统钢线' 钦定), 04-26 13:06

**Wrong**:
```js
// SYSTEM_PROMPT 给 LLM placeholder 例子:
// "收款地址 (broker BSC): 0xaD12544E... (完整, 不省略)"
//                       ^^^^^^^^^^^^^^^^ LLM 看 example 自由生成 placeholder
// LLM 在 preview DM 渲染:
// "收款地址 (broker BSC): 0x1234567890123456789012345678901234567890" ← LLM 编的, 不是真地址
```
真 user 真转 USDT 到 0x1234... = 钱永久丢 = production 灾难.

**Right** (4 layer defense):
```js
// Layer 1: backend 真 fetch (broker-buy-handler.js buyPreview)
const makerWallet = db.prepare(`
  SELECT address FROM agent_wallets
  WHERE relay_node_id = ? AND chain = ? AND is_default = 1
`).get(BROKER_RELAY_ID, chainKey);

// Layer 2: tool 接口 不接受 address 参数 (LLM 没机会编)
preview_order: { parameters: { direction, qty, chain } }  // 不要 maker_addr / peer_kasia

// Layer 3: backend 生成 deterministic preview_text 整段, LLM 必须 100% 原样转发
const preview_text = `📋 订单画像...\n收款 (broker BSC): \`${makerWallet.address}\`\nKAS 收件: \`${peer_kasia}\``;
return { ok: true, preview_text };  // LLM SYSTEM_PROMPT '一字不改原样转发'

// Layer 4: action-queue 入链前 assert (defensive, broker 自己 wallet 校验)
const evmMatches = action.message.match(/0x[a-fA-F0-9]{40}/g) || [];
const validEvm = evmMatches.every(addr => isOurWallet(addr));
if (!validEvm) {
  logger.error('ADDRESS_INVARIANT_VIOLATED', { kind: action.kind, evm: evmMatches });
  return; // 拒发
}
```

**Why**: KANet broker 钢线 (Owner 钦定): 任何 broker → user DM 含的链上地址必须**直接从 agent_wallets DB fetch**, 不能让 LLM 自由生成 (LLM 会按 SYSTEM_PROMPT example 编 placeholder), 不能让 handler 上层传值 (信任链断裂). 4 层 defense in depth: backend fetch / tool 不暴露地址参数 / template 固定 / queue 入链前 assert. 任何一层漏一条, 真 user 真转 USDT 风险. **资金安全无侥幸**.

类似教训范畴 (写新 broker DM 时):
- dm_order_confirmed: broker BSC 真 fetch + offer.verification_meta 真值 (不接受外部 input)
- dm_pay_instr: maker_addr 从 exchange_offers 真值 (UI truncate 但 DB 真完整)
- dm_kas_delivered: kas_tx_id 真 onchain 验证后注入 (不让 LLM 编)
- 任何价格/数量数字: 真 fetchKasPrice + agg picks 真值 (不让 LLM 估)

新加 broker → user DM 协议字段时, 三问:
1. 这字段是不是钱安全相关 (地址/数量/tx_hash)?
2. 是不是 broker 100% 已知 (db fetch / payload)?
3. 有没有可能让 LLM 生成?
钱安全 + 100%已知 + LLM 风险 → 必走 Layer 1-4 defense.

lint-kanet R19 静态扫: broker handler / llm-agent 任何 \\\`\\\${anything_evm_addr}\\\` template 必伴 db.prepare SELECT agent_wallets fetch (不能 hardcode / 不能 LLM input).

---

## 规则 20 · 安全 invariant 必须覆盖**所有 sink**, 不只是表面路径

**来源**: J1 1bc2132d 真测撞 (2026-04-26 13:25), J2 a47789c29 修 (R19-EXT). NWT + J1 + J2 三方 RCA 收敛后沉淀.

**症状**: 设计了一个 invariant assert (R19: broker → user DM 含的链上地址必属 broker agent_wallets), 在某个路径 (broker-action-queue 入链前) 实现了它. 真测发现 invariant 没生效, 但代码确实在 disk + console 真跑.

**真因**: 同一类危险数据 (broker → user DM 含 EVM 地址) 在系统中有**多条独立通向 chain 的 sink**:
- 路径 A: broker handler enqueue → broker-action-queue → chain ← R19 在这
- 路径 B: handleLlmDialog return text → conversations.js reply.send → relay rpc-listener sendMessage → sendKaspa → chain ← R19 看不见

invariant 只在路径 A 生效, 路径 B 完全绕过. LLM 自由 reply 落路径 B → fake 地址真发出来.

**Wrong** (R19 v1 — 只 queue 路径):
```js
// broker-action-queue.js
async function pump() {
  const item = q.shift();
  const violation = assertAddressInvariant(item);  // ← 只这里 assert
  if (violation) { /* 拒发 */ return; }
  await sendKaspa(...);
}

// 但 conversations.js 另一条 sink:
const llmReply = await handleLlmDialog(peer, message);
return reply.send({ reply: llmReply });  // ← 没 assert, fake 直发
```

**Right** (R19-EXT — 上游收口 catch all):
```js
// broker-action-queue.js + 暴露 plain-text 版
export function assertReplyAddressInvariant(replyText) {
  const evmMatches = replyText.match(/0x[a-fA-F0-9]{40}/g) || [];
  const own = _ownEvmAddrSet();  // 复用 60s cache
  for (const addr of evmMatches) {
    if (!own.has(addr.toLowerCase())) return { violated: true, foreign_address: addr };
  }
  return null;
}

// conversations.js — 所有 broker reply 路径 collapse 到一个 _r19Guard
const _r19Guard = async (replyText, source) => {
  if (!replyText) return replyText;
  const v = assertReplyAddressInvariant(replyText);
  if (v) {
    console.error(`[R19-EXT] ADDRESS_INVARIANT_VIOLATED source=${source} foreign=${v.foreign_address}`);
    return '抱歉, broker 检测到地址异常 (内部 R19 拦截), 请稍后重试.';
  }
  return replyText;
};
if (buyReply !== null) return reply.send({ reply: await _r19Guard(buyReply, 'handleBuyIntent') });
if (sellReply !== null) return reply.send({ reply: await _r19Guard(sellReply, 'handleSellIntent') });
return reply.send({ reply: await _r19Guard(llmReply, 'handleLlmDialog') });
```

**怎么避** (4 步设计 SOP):
1. **先全 grep 危险数据所有 sink** (`grep -rn "sendKaspa\|sendMessage\|chain DM out"`)
2. **选最上游收口点**实现 invariant (越上游越能 catch all sinks 一道关)
3. **加 lint rule** 检查新加的 sink 必经 invariant 函数
4. **真测端到端覆盖所有路径** (单元 + handler + chain DM + 真 user 真触发场景), 不只 unit test invariant 函数

**Why**: invariant 设计陷阱不是 invariant 本身错, 而是**只看了 happy path 一条 sink, 漏了其他 sink**. 真测时 happy path 跑得过, 但真用户走另一条 sink 把规则全绕过. R19 看着像兜底但只覆盖路径 A, 路径 B 漏了 = 钢线被穿透. 任何"must-be-true-everywhere" 类不变式都吃这个亏.

**适用范围** (J1 4ca58a5c 增强, R20 普适不只 chain-out): 任何 'must-be-true-everywhere' invariant 都适用, 不限 broker, 不限 chain-out:
- DB write invariant: 多写入点 → 必中心化 trigger / 唯一 ORM hook
- Auth check: 多 endpoint → 必 middleware 不是 per-route
- Audit log: 多写入点 → 必 wrap / pre-write hook
- Spending lock (KANet 范例): 多 spending sink → 必 fund_lock 中心校验, 不是 per-handler
- Reputation record: 多 trade outcome → 必 trigger
- 设计任何 invariant 时**先列 sink, 不只看 happy path**.

**lint-kanet checkR20() 简化版** (J1 4ca58a5c 提议, 完美版 v1.1 audit-broker-sinks.mjs):
- 静态扫所有 \`sendKaspa(\` / \`send_message.*target=\` / \`sendCommandAsync.*type:.*send_message\` 调用点
- 同 function scope 内 (regex window ~50 行) 必含 \`R19|R20|assertAddressInvariant|assertReplyAddressInvariant\` 关键字
- 命中无关键字 → 报 'R20: chain-out sink 没 invariant 守, 是否 cross-function 守? 手 review.'
- best-effort, cross-file 守仍需 manual audit (v1.1 完美版用 audit 工具周扫)

---

## 规则 25 · 多层 wire fix 必从 user input 真 trace 到 leaf, 不止 leaf 真 fix

**来源**: J1 5d2450dc 真 ship (2026-04-27 01:23), Bug-Y NLG receive_address wire 真测发现. c82d05493 真前置 fix template 真 OK 但 wire 上游 4 层真断, 真 ship 后 broker 真 production 真还 hallucinate. 真编号 25 (J2 #3 e0d40b372 已占 R21-R24, J1 自决 rename 真避 merge conflict).

**症状**: 真测撞 leaf (NLG template) 真渲染错值. 真 fix leaf (template) → unit test 真 PASS 但 production 真 user trigger 真还撞同样错. 真 dig 才发现 leaf 真接受参数, 但参数 4 层 wire 真不传 — leaf 永远拿 default null.

**真因**: data flow 真 user input → LLM extract → tool args → executor → leaf function → render output. 真 fix 真只看 leaf signature 真接 param, 真没 trace upstream 真传值. 上游任意一层 drop 参数 → leaf 永远 default → fix 真无效.

**Wrong** (Bug-Y 真演示, c82d05493 v1 fix 真不全):
```js
// Layer 5 (leaf, c82d05493 真 fix template):
function buyPreview({ user_kasia, qty, pay_chain, give_asset, receive_address = null }) {
  const recv = assetMeta.chain === 'kaspa' ? user_kasia : (receive_address || '⚠ 缺 EVM addr');
  return preview_text(recv);  // ✓ template 真 OK
}

// Layer 4 (executor, 真 wire 真断):
const { direction, qty, chain, address, give_asset } = args;  // address 真存在
return buyPreview({ user_kasia: peer, qty, pay_chain: chain, give_asset });  // ✗ 真不传 address!

// Layer 3 (tool def): address description '卖路径必填' (没提 buy stable 真要)
// Layer 2 (SYSTEM_PROMPT): step 2 '买 → 数量 + 链' (没要 EVM addr)
// Layer 1 (user message): user 真 'buy 1 USDC, BSC, 0xCA89...' 真给了 — 但 SYSTEM_PROMPT 不要 → LLM 真 drop
```

真 leaf 真 fix template 真 OK, unit test buyPreview({receive_address: '0xCA89...'}) → 真 render 0xCA89. 但 production 永远 receive_address=null → ⚠ fallback path 真 user_kasia → broker DM hallucinate kasia addr.

**Right** (Bug-Y 真根治, 5d2450dc 真 ship 4-layer wire 真覆盖):
```js
// Layer 1: SYSTEM_PROMPT 真显示要求收集 EVM addr
'买 stable (USDC/USDT) → 数量 + 付款链 + EVM 收款地址 0x...42位'

// Layer 2/3: tool def address description 真 clarify
'买 stable (USDC/USDT) 必填 user EVM 收款地址 (0x...42位); 买 KAS 不填; 卖必填.'

// Layer 4: executor 真传
return buyPreview({ ..., receive_address: address || null });

// Layer 5: leaf signature 真接 (c82d05493)
function buyPreview({ ..., receive_address = null }) { ... }
```

**怎么避** (4 步 wire trace SOP, 写 leaf fix 前必跑):
1. **真画完整 data flow**: user input → ... → leaf. 列每一层接受 / 传出 param.
2. **真 grep upstream caller**: `grep -rn 'leafFunction(' .` 看每个调用 site 真传什么参数.
3. **真 test E2E**, 不止 unit test leaf. 写 e2e 脚本 真 user input → 真 LLM call → 真 production trace, 真观察 leaf 真收什么参数.
4. **真审 SYSTEM_PROMPT / tool def description**: LLM 真不收集真没 description 真要求的参数. SYSTEM_PROMPT step 2 / tool def description 真隐式 fix point.

**Why**: leaf fix 真 satisfies "代码改对了" 真感, 但 wire 真断 → production 真无效. R21 真 push 真 trace upstream — 真**写 leaf fix 前先 trace 真 user input 真 flow 真到 leaf**, 真 verify 每一层 真传值. 真 fix 多层 wire 一次, 不真留 90% 真 fix + 10% 真 silent drop. 真 generic 案例: API arg 真新加, downstream consumer 真升级, 但 caller 真没改 → 永远 default. R21 真避此 silent drop.

**lint-kanet checkR25() 思路** (v1.1 真扩):
- 静态扫所有 leaf function 真 signature 真有 default 值的 param (e.g. `receive_address = null`)
- 真 grep 调用点 — 真不传该 param 真 caller 真 flag (build 真 warn 'R25: caller drops optional param, verify intent')
- 真 false-positive 高 (default 真 intentional 真常见), 真用 manual audit 真 supplement.

---

## 规则 26 · peer LLM 真 echo broker hallucinate 真 propagate (R19 真 generalize 到 peer-side)

**来源**: J1 5d2450dc Bug-Y 真后续真观察 (2026-04-27 01:13:56 真 evidence). Sophie 真 LAN-Qwen3.6 brain 真**直接 echo broker 错地址** 真 reply 'USDC 收款地址：kaspa:qpjjv2...' (kasia 真 USDC 真错). 真 LLM-as-relay 真新 vector — R19 真 broker→user 单向 invariant 真不够, 真 user-side LLM 真无 validation 真 echo broker 真 hallucinate 真 propagate 真 trust chain.

**症状**:
1. broker LLM 真 hallucinate 错地址 (R19 violation OR 真 wire 断 真 silent drop)
2. broker DM user 真错地址
3. user 真 LLM brain 真**未 validate inbound** addr 真 schema, 真 echo back 'OK 我的 USDC 收款地址: kaspa:...' 真 confirm broker 错值
4. broker 真处理 user 真 echo (R19 invariant 真 user→broker 真不 catch, 真 R19 单向 only) → 真 stuck dispute / 真 wrong asset send

**Wrong** (Sophie 01:13:56 真 evidence):
```
broker → Sophie: 'USDC 收件 (你的 BNB): kaspa:qpjjv2...' (broker hallucinate)
Sophie LLM (LAN-Qwen3.6) → broker: '收。USDC 收款地址: kaspa:qpjjv2...' (echo, no validation)
→ broker 'YES' 处理 → 真转 USDT 真 stuck (broker 'kaspa:' 真 deliver 真不 USDC 不 BSC)
```

**Right** (peer-side validation, 4 layer):
```
1. peer LLM SYSTEM_PROMPT 真显: '收 inbound DM 含 address 真 invariant validate':
   - USDC/USDT 真 chain 必 EVM 0x... 42 字符
   - KAS 真 chain 必 kaspa:... 真 prefix
   - asset×chain mismatch → 真 reject + 真要 'asset/chain 错, 请 broker 真 verify'
2. peer-side 真 client 真 schema validator (LLM 真前层 真 deterministic 真 catch hallucinate)
3. peer 真 'echo' 真 send 必 sanitize 自己 own wallet 真 lookup, 真不 forward broker 真 inbound addr
4. invariant 真双向 — R19 broker→user + R26 user→broker 真双 catch
```

**Why**: trust chain 真 LLM 真 propagate 真 silent. broker hallucinate (R19 violation) → peer LLM 真 echo 真 amplify → 真 production 真 dispute. R19 真单向 invariant 真不够, 真 close trust loop 必双向. peer-side 真 LLM 真 'be helpful' 默认 echo 真 overrides safety. R26 真 push peer LLM SYSTEM_PROMPT 真显 schema 真 reject inbound hallucinate 真 break loop. 真适用 generic LLM-relay 场景 (任何 user-as-LLM-proxy 真 echo broker untrusted output 真模式).

**怎么避** (3 步 SOP):
1. **peer LLM SYSTEM_PROMPT 真加 inbound address validation** (asset×chain schema 真 deterministic 真 reject hallucinate)
2. **peer-side wallet 真 own lookup 真 forward** (own EVM addr 真 forward 真 broker, 真不 echo broker inbound)
3. **真 chain-out 真 dual invariant** (broker R19 + peer R26 真双 enforce, 真 close trust loop)

---

## 规则 27 · 安全 invariant 必区分 own-set vs allow-set, 真不 over-catch legitimate user input echo

**来源**: Owner 09:34 真测 SELL '我要卖 99 KAS, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' → broker LLM 真 echo Owner 真 sell addr → R19-EXT 真 single-direction strict (broker reply EVM addr 必 broker BSC own wallet) → **false positive reject** "broker 检测到地址异常". J2 #3 真 fix 真 whitelist user-supplied addr (2026-04-27 09:40 ship).

**症状**: invariant 真 protect 真 hallucinate fake addr (R19 真原意), 但 single strict 'addr ⊆ own_set' 真 over-catch 真 legitimate scenario:
- user 真 SELL flow 真 provide 真 own recv addr (broker 真 deliver USDT 真 user EVM)
- broker LLM 真 echo confirmation ('好, 卖 99 KAS, USDT 收 0x1417...' )
- R19 regex 真 see 0x1417... ∉ broker wallets → reject 真 false positive

**Wrong** (R19-EXT v1, single 'own' strict):
```js
export function assertReplyAddressInvariant(replyText) {
  const evmMatches = replyText.match(/0x[a-fA-F0-9]{40}/g) || [];
  const own = _ownEvmAddrSet();
  for (const addr of evmMatches) {
    if (!own.has(addr.toLowerCase())) return { violated: true, foreign_address: addr };
  }
  return null;
}
```

真 SELL flow 真 user echo legit → 拒.

**Right** (R19-EXT v2, J2 #3 02:40 真 ship — own ∪ allow_set):
```js
export function assertReplyAddressInvariant(replyText, userContext = '') {
  const evmMatches = replyText.match(/0x[a-fA-F0-9]{40}/g) || [];
  const own = _ownEvmAddrSet();
  // user-supplied addrs 真 conversation context 真 whitelist (legitimate echo path)
  const userAddrs = new Set();
  if (userContext) {
    const userEvm = userContext.match(/0x[a-fA-F0-9]{40}/g) || [];
    for (const a of userEvm) userAddrs.add(a.toLowerCase());
  }
  for (const addr of evmMatches) {
    if (!own.has(addr.toLowerCase()) && !userAddrs.has(addr.toLowerCase())) {
      return { violated: true, foreign_address: addr };
    }
  }
  return null;
}
```

caller 真 pass user message context: `_r19Guard(replyText, userMessage)` → invariant 真 widen.

**Why**: invariant strict-set 真 design 真 trade-off — too strict (own only) → false positive 真 legitimate echo; too loose (任意 addr OK) → 真 hallucinate fake addr 真过. R27 真 push 真**显式 model** 真 'own_set' (broker 自有) + 'allow_set' (per-conversation user-supplied) 真双 set 真 union check. 真原 R19 invariant 真意 (block hallucinate fake) 保留 + 真 legitimate user echo 真 unblock.

**怎么避** (3 步 SOP, 真设计 invariant 时):
1. **真 enumerate scenarios** — 真 happy path + 真 legitimate alt-path (e.g. SELL flow user echo) 都 list. 真 single-set invariant 真 over-catch 哪 legit case?
2. **真 model own_set + allow_set 真双 set** — 真 own 真严 (broker self 真 wallet); allow 真 dynamic (per-context, e.g. user msg) 真 widen
3. **真 test 真双 case** — both legit echo (whitelist) + true hallucinate (catch) 必 covered. 真 unit test 真 case 13a/b 同模式.

**适用范围**: 任何 'addr/value ∈ allowed_set' invariant 真 design — 真 own_set strict 真 hallucinate catch + 真 dynamic allow_set 真 per-context legitimate widen 真 dual-set pattern. 真 generic 反 over-catch.

---

## 规则 28 · deterministic mitigation 真 history fallback 真**永远不能**补 direction (SELL/BUY 必须 user 当前消息明确)

**来源**: NWT d44a29691 Bug-Z6 fix sediment (2026-04-27 05:27). NWT Bug-W v1 9a3b3ffce 真 design 真 history-first fallback — 真 stale BUY history 真 hijack new SELL message → 真 broker hallucinate '买 USDC 1 USDC' 真 user 真说 '卖 5 KAS'. NWT 真 own root 真 reflection: 'history fallback 永远不该补 direction'.

**症状**: deterministic 真 multi-turn fallback (e.g. broker LLM tool args 真 missing field 真 fill from history) 真 hijack current user input 真 stale prior context. 真 user 真 explicit 'sell' message 真 override stale BUY context — 真不可 history fallback 真 set direction='buy'.

**Wrong** (Bug-W v1 9a3b3ffce, NWT 真 own root):
```js
const buyHistoryMatch = brokerLastBuy.match(/(?:买|buy)\s*\d+\s*(KAS|USDT|USDC)/i);
const direction = 'buy';  // ← 真 BAD: assume buy direction always
const asset = buyHistoryMatch ? buyHistoryMatch[1] : 'KAS';
const qty = buyHistoryMatch[0].match(/\d+/)?.[0] || 1;
```

User 真 say '卖 5 KAS' 真 ignored, history 真 stale BUY 真 hijack.

**Right** (Bug-Z6 fix d44a29691):
```js
const sellKeyword = /^\s*(?:卖|sell|dump|出|抛)\s/i;
if (sellKeyword.test(currentMsg)) {
  // SELL keyword 真 explicit → skip Bug-W BUY-only fallback
  return null;  // broker-sell-handler 接管
}
const buyHistoryMatch = brokerLastBuy.match(...);
// 真 fill ONLY missing fields from history:
const direction = parseDirection(currentMsg) || 'buy';  // current msg FIRST
const asset = parseAsset(currentMsg) || (buyHistoryMatch?.[1]) || 'KAS';
const qty = parseQty(currentMsg) || (buyHistoryMatch?.[0]?.match(/\d+/)?.[0]) || null;
```

**怎么避** (3 步 SOP):
1. **direction (sell/buy) 真 ALWAYS current msg 真 explicit** — 真 never inherit from history. 真 user 真 each transaction 真 explicit intent.
2. **history fallback ONLY 补 qty/asset/chain** — 真 these fields 真 user 真 may省略 'qty' '哪个链' 真 question 多轮收集 OK; direction 真不可 ambiguous.
3. **current msg parse FIRST, history 真 fill missing only** — 真 NWT 70eb4b888 Bug-Z5 fix 真 priority swap 真同 design.

**Why**: deterministic mitigation 真 design 假设 follow-up 真 same intent (true for missing field collection: '5' '哪个链' 真 single field). 真**multi-turn 真 cross-intent** (Eric 5 KAS BUY USDC 完成后真 SELL 3 KAS) 真**真不应** silently inherit prior intent. 真 catastrophic if user confirm: broker 真 publish wrong-direction offer.

真 generic 真 design pattern: **'inherit only from same intent context'** — 真 history fallback 真 must 真 detect intent boundary 真 before fill.

**沉淀 J2 12:30 + NWT 12:42 真 cross-confirmation**: J2 8 probe + NWT llama-server probe 真证 'Qwen tool calling 真 normal'. 真 R28 真 deeper insight: deterministic fallback 真 design 真 careful 真 priority + scope, 真 align J2 prompt-engineering > regex-expansion 真 architectural direction.

---

## 规则 29 · LLM 真 dumb 真 tool 真 rich — 真 user-facing content 真 100% tool-generated, LLM 真 verbatim transmit

**来源**: J1 e450ea19 broadcast 真 deep arch re-cognition sediment (2026-04-27 05:46). 真 6h session 真 5 critical bugs (Bug-Y/Z5/Z6/sellPreview missing/R26 production) 真**单一 architectural root 真 identification** — 真 ALL hallucinate 真 'LLM 真 produce user-facing content 真 unbacked by tool data'.

**症状**: LLM 真 invocation 真 mixed responsibility — 真 NL understand + tool args extract + tool result transmit + free-text fallback when tool missing/fails. 真 free-text fallback 真 generates user-facing content (addresses, amounts, prices, intent statements) 真 unbacked by tool data → 真 hallucinate cascade.

**Wrong** (Bug-Y/Z5/Z6/sellPreview missing/R26 真同 root):
```js
// broker LLM tool call → tool returns ok:false (e.g. sellPreview not impl)
// SYSTEM_PROMPT 真 silent on what to do → LLM 真 free-text NLG fallback:
const llmReply = await openai.chat({ messages, tools, ... });
// LLM 真 fabricates: '好, 卖 5 KAS, 收款 1.9538 USDT (真 hallucinate price)'
// → user 真 confirm → broker 真 publish offer 真 fake price/asset/addr
```

**Right** (J2 v1.2 SYSTEM_PROMPT trim + sellPreview impl + 报价丰富化 NWT 758bb38b0):
```js
// tool generates ALL user-facing content (preview_text 4 sections, addresses, prices)
const result = await tool.preview_order({ direction, qty, chain, asset, address });
// SYSTEM_PROMPT 铁律: result.preview_text 真**100% 原样转发**, 不准改一字符
return llm.transmit_verbatim(result.preview_text);

// tool ok:false → SYSTEM_PROMPT 真 explicit:
// 'tool 返 ok:false → 必须 ack tool message 不替换, 不编 preview'
return llm.transmit_verbatim(result.message);  // 真 tool-provided error message
```

**Testable invariant**:
```
∀ broker LLM reply containing user-facing content (addr/amount/price/intent):
  reply.bytes ⊆ tool.preview_text ∪ user-input ∪ tool.error.message ∪ tool.ack
真违反 = bug
```

**怎么避** (4 步设计 SOP):
1. **真 tool 真 implement** every user-facing scenario — 真 preview/finalize/verify/error path 真 tool 真 produce content. 真 sellPreview missing 真 hallucinate vector.
2. **SYSTEM_PROMPT 真 explicit on every tool result branch** — ok:true (transmit preview_text), ok:false (transmit error.message), tool error (acknowledge generic). 真 LLM 真不 free-text fill gaps.
3. **真 testable invariant** — unit test 真 LLM reply ⊆ tool output. 真 randomized fuzz 真 user input 真 verify no LLM-generated unbacked content.
4. **真 tool result schema 真 carry intent** — tool returns `{ ok, preview_text, error_message, user_action_required }` 真 LLM 真 deterministic transmit per branch.

**Why**: LLM 真 powerful NL transducer 真 unreliable content generator 真 user-facing critical paths. 真 hallucinate addresses (R19) → 真 user 转 fake addr 钱丢. 真 hallucinate amounts/prices → 真 fake offer 真 protocol mismatch. 真 hallucinate intent (Bug-Z6 SELL→BUY) → 真 catastrophic confirm.

真 architectural principle: **separate transducer (LLM) from content authority (tool)**. 真 tool 真 single source of truth 真 user-facing transactional content. 真 LLM 真 stateless 真 transmit-only 真 user layer.

真 generic 真 适用 — 真不限 broker, 真 any LLM-mediated user-facing transactional system (legal/medical/financial AI agents). 真 align J2 12:30 + NWT 12:42 真 'Qwen tool calling 真 normal' finding — 真 prompt engineering 真 mature direction 真 'make tool rich, prompt directs strict transmit'.

**Owner 钦定 alignment**: '正则不可取 Qwen 没用好' — 真 R29 真 codify 真 'Qwen 用好' 真 architectural definition: tool-rich + LLM-strict-transmit. 真 J2 v1.2 SYSTEM_PROMPT trim 真 first concrete step 真 R29 direction.

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
