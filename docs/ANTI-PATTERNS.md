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

## 规则 13 · e2e batch send_message 必须 await onchain verify, 不信 ok=true

**来源**: J1 case 2 v6 重跑 0/12 PASS, 04-26 06:39

**Wrong**:
```js
const data = await fetch('/api/relay/X/send-command', { ... });
if (data.ok) console.log('sent');  // 同 UTXO 5 连发, 第 1 上链, 后 4 RPC reject 但 data.ok=true
```

**Right**:
```js
async function sendVerified(msg) {
  const data = await fetch(...).then(r => r.json());
  if (!data.ok || data.error) return { ok: false, error: data.error };  // RPC reject 也 ok:true 含 error
  if (!data.txId) return { ok: false, error: 'no txId' };
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const onchain = db.prepare("SELECT 1 FROM kaspa_tx_log WHERE tx_id=?").get(data.txId);
    if (onchain) return { ok: true, txId: data.txId };
  }
  return { ok: false, error: 'tx not in kaspa_tx_log after 12s' };
}
```

**Why**: relay-manager send-command 在 RPC 拒绝 (UTXO double-spend / anti-spam reject) 时仍返 `ok:true` 但加 `error` 字段. e2e batch 多并发同 UTXO 第 1 上链消耗后, 后续 4 RPC reject 但脚本以为成功. 真链路 broker 收 0 条, e2e 假 PASS / 假 FAIL. **必须 verify kaspa_tx_log 真有 tx_id 才算上链**.

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

## 如何扩充本档案

新陷阱踩过后**立即**追加，格式保持：
- 规则名（陈述句）
- 来源引语或日期（有源头更有说服力）
- **Wrong**（具体反例代码或设计）
- **Right**（正确做法 + 三问清单或代码骨架）
- **Why**（一两段，点出这条规则**防止的具体滥用**）

新陷阱不要和现有条冲突；如果新陷阱和旧条拉扯，说明一条需要更精细拆分，去改旧条。

---

*本档案在 v2 spec 第八章元教训基础上独立。spec 聚焦"这次怎么做"，本档案聚焦"下次别再犯"。*
