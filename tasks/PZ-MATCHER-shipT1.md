# Task: PZ-MATCHER-shipT1

**Version**: v1.0
**Phase**: T1 (per MATCHER-ARCHITECTURE.md v0.1 §7.2)
**Scope**: matcher v0.1 — listen + intent extract, 不动 retail_dex_orders, 不发 offer, 不动钱
**Owner**: J2 (implementor / Claude Code) — NWT 跨 hat cross-review
**Mode handoff**: architect (本任务起草) → implementor (T1.1-T1.7) + QA (T1.8) → operator (T1.9 12h 守)
**ETA**: ~2-3h dev + ~1h cross-review + 12h monitoring
**LOC budget**: ~200 LOC (per MATCHER-ARCHITECTURE.md v0.1 §9 v0.1 范围)

---

## 起源

Owner 钦定方向 (2026-05-01):

> "broker 是 KANet 的 broker, 忘记了吧" — broker 不能继续是独立子系统, 必须自然生长于 KANet building block.
> 
> "broker 先能跑通, 不出错, 或者少出错, 出错能补, 都已经很好了" — Phase 1 目标不追求功能完整, 追求架构哲学验证.

NWT 选项 (A) 钦定: T1 = listen + intent extract, ~200 LOC, 真 minimum derisk.
NWT 拒选项 (B): publish 后 awaiting_payment 没 verify 没 deliver = 半成品危险.
NWT 拒选项 (C): 单 ship 太大, cross-review cost 集中.

T1 不是为了让 broker 立即能用. T1 是为了**验证 matcher 能在 KANet 框架内自然生长 + 0 私有 state**. 哲学不通则后续 Phase 不必投入.

---

## T1 真目标 (3 个验收硬标准)

实施完 T1 后, 必须能 demo 这 3 件事:

### 验收硬标准 1: Trader-M Agent 真能 onboard 进 KANet
- Trader-M 钱包真生成, Agent Card 真发布上链
- matcher skill 真注册到 skills 表 (registerMindSkills 扫到)
- Mind registry.autoDiscover 真加载 matcher skill (isActive=1)
- Trader-M 进程真起来不崩, Mind reactive loop 真跑

### 验收硬标准 2: matcher 真能听懂 user
- user 真 DM "我要用 50 USDT 买 KAS, 用 BNB 链付款"
- matcher 真 reactive trigger
- matcher 真 SELECT messages 表读 user 24h 历史
- matcher 真喂 LLM 提炼 intent
- matcher 真返回结构化 intent: `{ side: 'buy', asset: 'KAS', qty_usdt: 50, pay_chain: 'BSC' }`

### 验收硬标准 3: matcher 真能跟 user 对话
- matcher 真根据 intent 生成回复 ("好的, 我看到你想买 50 USDT 的 KAS, 用 BNB 链付款. 让我确认一下...")
- 回复真通过 KANet Action Executor 发出 (不自造 send 路径)
- 真发送上链, user 真收到回复
- **matcher 真不动 retail_dex_orders, 真不发 offer, 真不动钱**

3 个验收硬标准都过 = T1 success. 这就是 T1 的"broker 真在工作"——只不过这个"工作"仅限于"听懂 + 对话", 不含撮合实际成交.

---

## Out of scope (T1 严禁做)

实施期间撞这些 = 暂停 + broadcast 求 architect mode:

1. ❌ **不写 retail_dex_orders 任何 row** — 不 INSERT, 不 UPDATE state, 不动 transition()
2. ❌ **不调 /api/exchange/publish** — 这是 T2 范围
3. ❌ **不调 trade-protocol-filter / cross-chain-verify.mjs** — 这是 T3 范围
4. ❌ **不动 KAS / USDT 任何资产** — 不调 Action Executor 的 send_kas / approve / withdraw
5. ❌ **不在 matcher 进程内持有任何 state** — 不 new Map(), 不 cache, 不 in-memory store
6. ❌ **不修 retail_dex_orders schema** — trim col 是 T3 范围
7. ❌ **不删任何 broker-* 文件** — 旧 broker 完整保留, 不动
8. ❌ **不动 STATE-MACHINES.md / MATCHER-ARCHITECTURE.md** — 这两份是 spec source
9. ❌ **不重构 Mind 五核** — Perception kernel API 不够用时, 任务卡里说怎么办 (T1.2 step)

---

## 9 Subtask 顺序表

| # | 名 | mode | LOC | depends |
|---|---|---|---|---|
| T1.0 | 语义校验 grep (confirming/refunding) | implementor | 0 (调研) | - |
| T1.1 | matcher class-based Skill 单 .mjs (per r109) | implementor | ~30-50 | T1.0 |
| T1.2 | loadPeerContext 函数实现 | implementor | ~50 | T1.1 |
| T1.3 | extractIntent 函数实现 (调 Adapter LLM) | implementor | ~40 | T1.2 |
| T1.4 | replyToUser 函数实现 (调 Action Executor) | implementor | ~30 | T1.3 |
| T1.5 | matcher.mjs formatForBrain 装配 (1.2-1.4) | implementor | ~30 | T1.4 |
| T1.6 | Trader-M Agent onboarding | implementor | ~20 (config) | T1.5 |
| T1.7 | 单元 + 集成测试 | QA | ~50 | T1.6 |
| T1.8 | invariant assertion (per MATCHER §11) | QA | ~30 | T1.7 |
| T1.9 | 12h cron 守 + Owner 验收 3 硬标准 | operator | 0 | T1.8 |

总: ~280 LOC (含测试). 主代码 ~200 LOC, 测试 ~50 LOC, config ~30 LOC.

---

## 详细实施 spec

### T1.0 — 语义校验 grep

**这是硬纪律, 不可跳过** (per STATE-MACHINES.md v0.3 §1 admonition + NWT 钦定).

#### Action

```bash
cd C:\kanet
# 找 confirming state 的真代码语义
grep -rn "'confirming'\|\"confirming\"" \
  kasia-console/src/ agent-mind/src/ kasia-relay/src/ \
  --include="*.js" --include="*.mjs" 2>/dev/null > /tmp/confirming-grep.txt

grep -rn "'refunding'\|\"refunding\"" \
  kasia-console/src/ agent-mind/src/ kasia-relay/src/ \
  --include="*.js" --include="*.mjs" 2>/dev/null > /tmp/refunding-grep.txt
```

#### 报告 (写进 git commit msg + broadcast)

每个 state 必报 3 件事:
1. **写入位置**: file:line 列表
2. **写入触发条件**: 什么 trigger 让 state 进 confirming / refunding (例: cross-chain confirmation pending? underpayment refund pending?)
3. **跟 v0.3 spec 比对**:
   - ✅ 一致 → T1 继续 (spec 描述对)
   - ⚠ 部分一致 → 暂停 + broadcast NWT (architect mode 修 v0.3 描述)
   - ❌ 完全不一致 → 暂停 + broadcast NWT (架构判断: spec 错还是代码错)

#### Verdict 判定

- ✅ `semantic_verified`: spec 描述跟代码语义一致, T1 继续
- ⚠ `semantic_mismatch_minor`: 描述需小修, NWT 改 v0.3 后继续
- ❌ `semantic_mismatch_major`: 严重不一致, 回 architect mode 重审

**T1.0 不耗 LOC, 但耗时间** (~15min). T1.1 之前必完成.

---

### T1.1 — matcher class-based Skill 单 .mjs (per NWT r109 verdict)

#### 目标

创建 matcher class-based Skill 单 file, 走 KANet 现有 reactive free-form 路径 (registry.mjs:47-73 + base.mjs Skill base class).

#### 背景 (per J2 r107 grep + NWT r109 verdict)

KANet skill 加载 2 路径:
- **class-based Skill** (registry.mjs:47-73): 单 .mjs + Skill subclass, canActivate / gatherContext / formatForBrain. 支持 reactive free-form (LLM-driven).
- **包式 skill** (registry.mjs:78-125 + intents.json): keyword-based, parseIntent 命中触发. 不 match matcher LLM-driven 哲学.

matcher 走 class-based Skill (a 选). 包式扩 (reactive package trigger) 后置 PZ-FRAMEWORK-EXT 任务卡, matcher v0.1 prod usage 后再决 ROI.

#### 文件结构

```
C:\kanet\agent-mind\src\skills\matcher.mjs   ← 单 file, class Matcher extends Skill
```

prompts 处理 (T1.3 决): 选 (i) inline string in matcher.mjs, OR (ii) `agent-mind\src\skills\matcher-prompts\` dir 含 .txt file (matcher.mjs `readFileSync` at runtime). T1.1 不阻, T1.3 实际 ship extractIntent 时确定.

#### matcher.mjs 骨架 (T1.1 ship)

```js
// agent-mind/src/skills/matcher.mjs
//
// 撮合官 (matcher) — KANet 上的撮合 Agent.
// class-based Skill, 走 registry.mjs:47-73 reactive free-form 路径.
// LLM-driven intent extraction, 不走 keyword-based parseIntent (per MATCHER-ARCHITECTURE §4 + r109 verdict).
//
// T1 范围: listen + intent extract + 跟 user 对话, 不发 offer 不动钱.

import { Skill } from './base.mjs';

export default class Matcher extends Skill {
  constructor() {
    super({
      id: 'matcher',
      name: 'matcher',
      version: '0.1.0',
      description: '撮合官 — KANet 上的撮合 Agent (T1 仅 listen + intent extract)',
      category: 'matcher',
      trust_level: 'peer',
    });
  }

  // 每 reactive message 都命中 (LLM-driven free-form)
  canActivate(triggerType) {
    return triggerType === 'reactive';
  }

  // 调 KANet kernels 拿 per-peer context (T1.2 实施 loadPeerContext)
  async gatherContext(kernels, config) {
    // T1.2 ship: 24h messages history + identities + retail_dex_orders + relation_states
    return { /* T1.2 fill */ };
  }

  // T1.3 实施 extractIntent + T1.4 实施 replyToUser
  async formatForBrain(gathered) {
    // T1.5 装配 — gathered → LLM extract intent → format reply
    return { /* T1.5 fill */ };
  }
}
```

#### Acceptance

- ✅ 1 个文件创建: agent-mind/src/skills/matcher.mjs (~30-50 LOC class skeleton)
- ✅ class Matcher extends Skill (import from base.mjs)
- ✅ canActivate('reactive') return true (LLM-driven free-form trigger)
- ✅ gatherContext / formatForBrain 暂为 stub (T1.2-T1.5 填实施)
- ✅ Console 重启后 registerMindSkills (skills.js:195-228 单 .mjs scan) 扫到 matcher skill
- ✅ Mind autoDiscover (registry.mjs:47-73) instantiate Matcher class
- ✅ skill 在 skills 表 active=1, category='matcher'

⚠ **chain reference for ANTI-PATTERNS 陷阱 #23**: category 不能传 null. constructor 设 `'matcher'` (新分类, registerMindSkills sibling lookup line 248-250 用 `category != 'other'` filter, 'matcher' 显式 set 不撞 null guard).

#### LOC: ~30-50 (class skeleton, 0 JSON 配置 file 0 prompts file)

---

### T1.2 — loadPeerContext 函数

#### 目标

复用 KANet messages 表 + identities 表 + retail_dex_orders 表, 不造新数据结构.

#### Spec

```js
// agent-mind/src/skills/matcher.mjs

import { db } from '../../../shared/db.mjs'; // KANet 标准 DB 接口

/**
 * 加载 peer 上下文 — 24h 对话历史 + 现有 active orders + relation_state
 * @param {string} peerAddress - kasia 地址
 * @returns {Object} { history, activeOrders, relationState }
 */
export async function loadPeerContext(peerAddress) {
  // 1. 24h DM 历史 (per audit-2 A3.4: top peer 44 msg = 1056 tokens, 安全 unlimited)
  const history = db.prepare(`
    SELECT m.id, m.created_at, m.content, m.message_type,
           CASE
             WHEN m.sender_identity_id = (SELECT id FROM identities WHERE kasia_address = ?) THEN 'user'
             ELSE 'matcher'
           END AS role
    FROM messages m
    WHERE (
      m.sender_identity_id = (SELECT id FROM identities WHERE kasia_address = ?) 
      OR m.receiver_identity_id = (SELECT id FROM identities WHERE kasia_address = ?)
    )
      AND m.message_type = 'text'
      AND m.created_at >= datetime('now', '-24 hours')
    ORDER BY m.created_at ASC
  `).all(peerAddress, peerAddress, peerAddress);

  // 2. 现有 active orders (per STATE-MACHINES.md v0.3, 5 active state)
  const activeOrders = db.prepare(`
    SELECT id, side, qty, state, pay_chain, created_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state IN ('aligning','awaiting_payment','confirming','paid','refunding')
    ORDER BY created_at DESC
  `).all(peerAddress);

  // 3. relation_state + trust
  const relationState = db.prepare(`
    SELECT relation_state, trust_level
    FROM relation_states
    WHERE peer_address = ?
  `).get(peerAddress) || { relation_state: 'unknown', trust_level: 0 };

  // 4. Safety net: 输入超过 6000 tokens 时降级 (per MATCHER-ARCHITECTURE §4.2 钦定)
  const totalChars = history.reduce((sum, m) => sum + (m.content || '').length, 0);
  const estimatedTokens = totalChars / 3;
  
  let trimmedHistory = history;
  if (estimatedTokens > 6000) {
    trimmedHistory = history.slice(-30); // 保留最近 30 条
    console.warn(`[matcher] loadPeerContext degraded: peer=${peerAddress}, tokens=${estimatedTokens}, trimmed to last 30 msgs`);
  }

  return {
    history: trimmedHistory,
    activeOrders,
    relationState,
    metadata: {
      historyCount: trimmedHistory.length,
      degraded: estimatedTokens > 6000,
      estimatedTokens
    }
  };
}
```

#### Anti-pattern (实施期间不许做)

- ❌ 不许 cache 任何结果到 module-level Map (per MATCHER §11 #1)
- ❌ 不许 INSERT 新表 (matcher 不持有私有 state)
- ❌ 不许写 retail_dex_orders (T1 严禁, per scope §)
- ❌ 不许 grep 查 broker_workflow_markers (那是旧 broker 私有, MATCHER §1.1 钦定不复用)

#### Acceptance

- ✅ loadPeerContext('kaspa:test_addr') 真返回 { history, activeOrders, relationState, metadata }
- ✅ history 真按 created_at ASC 排序 (老 → 新)
- ✅ activeOrders 真只含 5 active state (不含 terminal)
- ✅ degraded mode 真在 > 6000 tokens 时 trim 到 30 msg + console.warn
- ✅ 真 0 私有 state (执行函数前后, matcher 进程内存无任何 retail_dex_orders 缓存)

#### LOC: ~50

---

### T1.3 — extractIntent 函数

#### 目标

调 Adapter (KANet AI 桥接) 把 peer context 喂 LLM, 提炼结构化 intent.

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (continued)

import fs from 'node:fs/promises';
import path from 'node:path';

const PROMPT_DIR = path.join(import.meta.dirname || __dirname, 'prompts');

/**
 * 提炼 user 意图 — 调 Adapter LLM
 * @param {Object} peerContext - loadPeerContext 输出
 * @param {string} latestMessage - user 最新 DM 内容
 * @returns {Object} { side, asset, qty, qty_unit, pay_chain, confidence, missing_fields, raw_intent_text }
 */
export async function extractIntent(peerContext, latestMessage) {
  // 1. 加载 prompt 模板
  const promptTemplate = await fs.readFile(
    path.join(PROMPT_DIR, 'intent_extract.md'), 
    'utf-8'
  );

  // 2. 格式化对话历史
  const historyText = peerContext.history
    .map(m => `[${m.created_at}] ${m.role}: ${m.content}`)
    .join('\n');

  // 3. 注入 prompt
  const finalPrompt = promptTemplate
    .replace('{HISTORY}', historyText || '(no history)')
    .replace('{LATEST}', latestMessage);

  // 4. 调 Adapter (KANet 标准 AI 桥接, 不自造 LLM session)
  const adapterResponse = await callAdapter({
    skill: 'matcher.extractIntent',
    prompt: finalPrompt,
    expectJson: true,
    maxTokens: 500
  });

  // 5. 解析 JSON
  let intent;
  try {
    intent = JSON.parse(adapterResponse.content);
  } catch (e) {
    console.error('[matcher] extractIntent JSON parse failed:', adapterResponse.content);
    return {
      side: 'none',
      confidence: 'low',
      missing_fields: ['intent unclear'],
      raw_intent_text: latestMessage,
      _parse_error: true
    };
  }

  // 6. 验证必字段
  if (!['buy','sell','query','cancel','none'].includes(intent.side)) {
    intent.side = 'none';
    intent.confidence = 'low';
  }

  return intent;
}

// callAdapter 是 KANet 标准 Adapter 桥接 — J2 实施时确认调用方式
// 应该是 import 自 ../../adapter-bridge.mjs 或类似路径
// 如果 KANet 当前没有暴露给 skill 的 adapter API → 暂停 + broadcast (这是 MATCHER §C open question 1 的实证)
```

#### ⚠ 实施警告 (J2 撞这个回 architect)

如果 J2 grep 发现 `callAdapter` 类似函数在 KANet 当前不存在 / 不暴露给 skill → **暂停 + broadcast**.

这是 MATCHER-ARCHITECTURE.md §C open question 1 的实证撞墙: "Mind Perception kernel 是否能给 broker skill 喂 per-peer context?". 如果撞墙, 架构师 mode 决定:
- (a) 扩 KANet adapter API → 加新任务 SA-T1.3a
- (b) 临时方案: matcher 直接调 OpenAI/Anthropic SDK → 但这违反 MATCHER §11 #4 反模式

**默认走 (a) 不走 (b)**. T1 范围扩大也比违反哲学好.

#### Anti-pattern

- ❌ 不许直接 import openai / anthropic SDK (违反 MATCHER §11 #4)
- ❌ 不许 cache LLM response (违反 §11 #1)
- ❌ 不许在 prompt 里 inject ASCII-unsafe 字符 (per ANTI-PATTERNS 陷阱 #3)

#### Acceptance

- ✅ extractIntent({history:[...], ...}, "买 50 USDT KAS BNB") 真返回结构化 intent
- ✅ side / asset / qty 字段真填对
- ✅ missing_fields 真识别 user 没说清的字段 (例: 没说价格 → ['price'])
- ✅ JSON parse 失败时真 graceful fallback (不 crash, 返回 confidence='low')

#### LOC: ~40

---

### T1.4 — replyToUser 函数

#### 目标

调 KANet Action Executor (不自造 send 路径) 发回复给 user.

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (continued)

/**
 * 回复 user — 走 KANet Action Executor 标准路径
 * @param {string} peerAddress
 * @param {string} replyText
 * @param {Object} actionExecutor - Mind 五核中 Action Executor 接口 (J2 确认 import 路径)
 */
export async function replyToUser(peerAddress, replyText, actionExecutor) {
  // 1. ASCII safety check (per ANTI-PATTERNS 陷阱 #3)
  const safeText = ensureAsciiSafe(replyText);

  // 2. 构造 send_message action
  const action = {
    type: 'send_message',
    to: peerAddress,
    content: safeText,
    skill: 'matcher',
    metadata: {
      mode: 'reactive_reply',
      phase: 'T1'
    }
  };

  // 3. enqueue 到 Action Executor (KANet 标准路径, Relay 接收 + 上链)
  return await actionExecutor.enqueue(action);
}

function ensureAsciiSafe(text) {
  // 用 KANet 已有 asciiSafeStringify 或类似工具 (J2 确认)
  // 处理 surrogate pairs + 中文 emoji
  return text; // J2 实施时填具体逻辑
}
```

#### ⚠ 实施警告

`actionExecutor` 是 Mind 五核中的 Action Executor. J2 实施时确认怎么从 skill 内访问. 应该是 skill `handleListen` 入口由 Mind framework 注入.

如果 KANet skill 框架不暴露 actionExecutor → 同 §T1.3 撞墙处理.

#### Anti-pattern

- ❌ 不许直接调 Relay sendKaspa (违反 MATCHER §11 #6)
- ❌ 不许写 messages 表自己 (违反 §11 — Mind framework 自动写)
- ❌ 不许在 skill 内 import kasia-relay 模块 (违反边界铁律: Console 不碰链)

#### Acceptance

- ✅ replyToUser('kaspa:test', 'hello', executor) 真 enqueue 成功
- ✅ 真 ASCII-safe (含中文测试 case 真不崩)
- ✅ 真不直接碰 Relay
- ✅ Mind 框架真处理后续 (action_executor → relay IPC → 上链)

#### LOC: ~30

---

### T1.5 — executor.mjs 主入口装配

#### 目标

把 T1.2 / T1.3 / T1.4 装配成 handleListen 主流程.

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (continued)

/**
 * matcher skill 主入口 — Mind 五核 reactive trigger 调用此函数
 * @param {Object} ctx - { peerAddress, latestMessage, actionExecutor, ... }
 */
export async function handleListen(ctx) {
  const { peerAddress, latestMessage, actionExecutor } = ctx;

  try {
    // Step 1: 加载 peer 上下文 (复用 KANet 表)
    const peerContext = await loadPeerContext(peerAddress);

    // Step 2: 提炼 intent (调 Adapter LLM)
    const intent = await extractIntent(peerContext, latestMessage);

    // Step 3: 根据 intent 生成回复
    const replyText = await generateReply(intent, peerContext);

    // Step 4: 发回复 (走 Action Executor)
    await replyToUser(peerAddress, replyText, actionExecutor);

    // Step 5: 上报 mind-event (KANet 标准事件流, Owner 可在 UI 看)
    await reportEvent({
      skill: 'matcher',
      type: 'listen_complete',
      peer: peerAddress,
      intent_side: intent.side,
      intent_confidence: intent.confidence,
      missing_fields: intent.missing_fields
    });

    return { success: true, intent };
  } catch (err) {
    console.error('[matcher] handleListen err:', err);
    await reportEvent({
      skill: 'matcher',
      type: 'listen_failed',
      peer: peerAddress,
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

/**
 * 根据 intent 生成回复 — T1 阶段固定模板, 不调 LLM 二次
 * (T2 之后可以扩成 LLM 个性化回复)
 */
async function generateReply(intent, peerContext) {
  // T1 阶段简化: 用固定模板. T2 之后可以加 LLM 二次调用.
  if (intent.side === 'none' || intent.confidence === 'low') {
    return '抱歉, 我没完全听懂你的意图. 你能更具体说一下你想做什么交易吗? 比如"我要用 50 USDT 买 KAS, 用 BNB 链付款".';
  }

  if (intent.missing_fields && intent.missing_fields.length > 0) {
    return `我明白你想${intent.side === 'buy' ? '购买' : '出售'} ${intent.asset || '资产'}. 我还需要确认: ${intent.missing_fields.join(', ')}. 你能补充一下吗?\n\n(注意: 我目前在 T1 验证阶段, 暂时不能完成实际撮合, 但我会准确记录你的需求.)`;
  }

  return `好的, 我看到你想${intent.side === 'buy' ? '用' : '卖'} ${intent.qty} ${intent.qty_unit} ${intent.side === 'buy' ? '买入' : '换取'} ${intent.asset}, 用 ${intent.pay_chain} 链. 我已记录你的意图.\n\n(注意: 我目前在 T1 验证阶段, 暂时不能完成实际撮合, 后续 Phase 会加上.)`;
}

async function reportEvent(event) {
  // 调 POST /api/agent/mind-event (DEVELOPER-GUIDE.md 第 15 章端点)
  // J2 确认 fetch URL + auth
}
```

#### Acceptance

- ✅ handleListen({...}) 真完整跑 5 步
- ✅ Mind framework reactive trigger 真调到 handleListen
- ✅ T1 阶段每个回复真显式说"暂时不能撮合"(防 user 误以为成交)
- ✅ mind-event 真上报 (Owner 在 UI /api/agent/mind-events 真看到)
- ✅ try-catch 真 graceful, error 真上报不崩进程

#### LOC: ~30 (剥掉 generateReply, 主流程很简洁)

---

### T1.6 — Trader-M Agent onboarding

#### 目标

创建一个新 Agent (代号 Trader-M, 撮合官), 配置 matcher skill, 启动跑.

#### Action 1: 创建 Agent

```bash
# 调 KANet 已有 onboarding API (DEVELOPER-GUIDE.md 第 15 章)
curl -X POST http://localhost:3100/api/agent/create-adapter \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trader-M",
    "provider": "openai",
    "ai_model": "gpt-4o"
  }'
```

#### Action 2: 配置 matcher skill 给 Trader-M

```sql
-- 在 skills 表 + agent_skills 关联表 (具体表名 J2 grep 确认)
-- 让 Trader-M 启用 matcher skill
INSERT INTO agent_skills (relay_node_id, skill_id, enabled)
VALUES ((SELECT id FROM relay_nodes WHERE name='Trader-M'), 'matcher', 1);
```

⚠ J2 实施时按 KANet 真 schema 执行. 这里 SQL 仅示意.

#### Action 3: Agent Card 配置

```json
{
  "name": "Trader-M",
  "role": "撮合官 (matcher)",
  "description": "KANet 上的 KAS / USDT 跨链撮合 Agent. 当前 T1 验证阶段, 仅支持意图理解, 暂未开放撮合.",
  "capabilities": ["matcher.listen"],
  "phase": "T1"
}
```

#### Acceptance

- ✅ Trader-M relay node 真创建, kasia 地址真生成
- ✅ Trader-M Adapter 真启动 (process running)
- ✅ Trader-M Mind reactive loop 真跑
- ✅ Agent Card 真发布上链 (POST /api/relay/:id/publish-card)
- ✅ Owner 在 KANet UI 真看到 Trader-M 在线
- ✅ matcher skill 在 Trader-M Mind registry 真加载 (查 GET /api/agent/mind-skills)

#### LOC: ~20 (主要 config + 1-2 行启动脚本)

---

### T1.7 — 单元 + 集成测试

#### 目标

验证 matcher 真在 KANet 框架内自然工作, 0 私有 state, 0 越界.

#### 测试文件

```
C:\kanet\test\skills\matcher\
├── unit\
│   ├── loadPeerContext.test.mjs
│   ├── extractIntent.test.mjs
│   └── replyToUser.test.mjs
└── integration\
    └── handleListen-end-to-end.test.mjs
```

#### 单元测试 (mock DB + mock LLM)

```js
// loadPeerContext.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { loadPeerContext } from '../../../agent-mind/src/skills/matcher.mjs';

test('loadPeerContext returns 24h history sorted ASC', async () => {
  // mock messages 表 - 用 in-memory sqlite
  const ctx = await loadPeerContext('kaspa:test_addr');
  assert.ok(Array.isArray(ctx.history));
  assert.ok(ctx.history.length >= 0);
  // 验证排序
  for (let i = 1; i < ctx.history.length; i++) {
    assert.ok(ctx.history[i].created_at >= ctx.history[i-1].created_at);
  }
});

test('loadPeerContext degrades when > 6000 tokens', async () => {
  // 注 30+ 条长消息进 mock messages
  const ctx = await loadPeerContext('kaspa:high_freq');
  if (ctx.metadata.estimatedTokens > 6000) {
    assert.ok(ctx.metadata.degraded === true);
    assert.ok(ctx.history.length === 30);
  }
});

test('loadPeerContext returns 0 active orders for new peer', async () => {
  const ctx = await loadPeerContext('kaspa:never_seen');
  assert.equal(ctx.activeOrders.length, 0);
});
```

#### 集成测试 (真 KANet 环境)

```js
// handleListen-end-to-end.test.mjs
test('matcher 真听懂 user 想买 KAS', async () => {
  // 1. 真 DM 一条 "我要用 50 USDT 买 KAS, BNB 链"
  await sendDmAsTestUser('kaspa:trader_m_addr', '我要用 50 USDT 买 KAS, BNB 链');
  
  // 2. 等 reactive trigger (~5s)
  await sleep(5000);
  
  // 3. 真验证: matcher 真返回结构化 intent (查 mind-events)
  const events = await fetch('http://localhost:3100/api/agent/mind-events?skill=matcher&type=listen_complete');
  const lastEvent = events.json().pop();
  
  assert.equal(lastEvent.intent_side, 'buy');
  assert.equal(lastEvent.intent_confidence, 'high');
  
  // 4. 真验证: matcher 真发了回复 (查 messages 表)
  const replies = db.prepare(`
    SELECT * FROM messages
    WHERE sender_identity_id = (SELECT id FROM identities WHERE name='Trader-M')
      AND receiver_identity_id = (SELECT id FROM identities WHERE kasia_address = ?)
    ORDER BY created_at DESC LIMIT 1
  `).all('kaspa:test_user');
  
  assert.ok(replies.length === 1);
  assert.ok(replies[0].content.includes('50') && replies[0].content.includes('KAS'));
});

test('matcher 真不动 retail_dex_orders (T1 anti-pattern verify)', async () => {
  // 1. 跑 100 次 listen
  for (let i = 0; i < 100; i++) {
    await sendDmAsTestUser('kaspa:trader_m', `测试 #${i}`);
  }
  
  // 2. 真验证: retail_dex_orders 真 0 新增
  const before = db.prepare('SELECT COUNT(*) as cnt FROM retail_dex_orders').get();
  await sleep(10000); // 等所有 reactive 跑完
  const after = db.prepare('SELECT COUNT(*) as cnt FROM retail_dex_orders').get();
  
  assert.equal(after.cnt, before.cnt, 'matcher T1 不许动 retail_dex_orders');
});
```

#### Acceptance

- ✅ 4 个单元测试真 pass
- ✅ 1 个集成测试真 pass
- ✅ retail_dex_orders 真 0 新增 (T1 anti-pattern enforce)
- ✅ messages 表 matcher 真发回复 (validates Action Executor 路径)
- ✅ mind-events 真上报 (validates Owner 可观测)

#### LOC: ~50

---

### T1.8 — invariant assertion (per MATCHER §11)

#### 目标

按 MATCHER-ARCHITECTURE.md §11 anti-pattern 列表, 每条建 runtime invariant assertion.

#### Spec — 9 条 anti-pattern 转 9 条 assertion

```js
// kasia-console/test-framework/cases/matcher/invariants/anti-patterns.test.mjs

test('matcher §11 #1: 进程内 0 私有 state', () => {
  // 检 matcher executor.mjs 不 export 任何 module-level Map/Object 持有 retail_dex_orders 数据
  const fs = require('fs');
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  
  // 不许有 module-level mutable state
  const forbidden = [
    /^const\s+\w+\s*=\s*new Map\(\)/m,
    /^const\s+\w+\s*=\s*\{\s*\}/m,
    /^let\s+\w+/m
  ];
  
  for (const pattern of forbidden) {
    if (pattern.test(code)) {
      throw new Error(`matcher 违反 §11 #1: ${pattern}`);
    }
  }
});

test('matcher §11 #2: 不直 SQL UPDATE retail_dex_orders.state', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  if (/UPDATE\s+retail_dex_orders/i.test(code)) {
    throw new Error('matcher §11 #2 violation: 直 UPDATE retail_dex_orders');
  }
});

test('matcher §11 #6: 不直接调 Relay sendKaspa', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  if (/sendKaspa\s*\(/.test(code) || /from.*kasia-relay/.test(code)) {
    throw new Error('matcher §11 #6 violation: 直接碰 Relay');
  }
});

// ... 6 条以此类推
```

#### Acceptance

- ✅ 9 条 anti-pattern 真都有 assertion
- ✅ 当前 T1 实施真 pass 全 9 条
- ✅ assertion 真在 cron 集成 (next baseline keep + 9 invariant pass)

#### LOC: ~30

---

### T1.9 — 12h cron 守 + Owner 验收

#### 目标

按 MATCHER-ARCHITECTURE.md §10 验收 3 硬标准 + 12h 监控.

#### Owner 验收 SOP

T1.7 集成测试通过后, Owner 跑 3 个手工 demo:

**Demo 1**: matcher onboard 验证
- 打开 KANet UI, 看到 Trader-M 在 Agent 列表
- 点 Trader-M, 看到 matcher skill 在 Active Skills 列表
- 看 Trader-M Agent Card 真发布上链 (查 chain explorer 或 GET /api/relay/:id/card)

**Demo 2**: matcher 听懂验证 (3 个 user 消息测试)

| 测试消息 | 期望 matcher 行为 |
|---|---|
| "我要用 50 USDT 买 KAS, BNB 链" | 提炼 side=buy, asset=KAS, qty=50 USDT, pay_chain=BSC. 回复确认. |
| "卖 100 KAS" | 提炼 side=sell, asset=KAS, qty=100. missing_fields=[pay_chain, qty_unit]. 回复请求补充. |
| "你能撮合吗?" | 提炼 side=query. 回复说 T1 验证阶段不撮合. |

**Demo 3**: matcher 真不动 retail_dex_orders 验证
- 跑 5 个不同 user 真 DM
- 跑完后 SQL: `SELECT COUNT(*) FROM retail_dex_orders WHERE created_at > <test_start_time>`
- 真 0 新增

#### 12h 监控

12h 期间 operator (NWT 或 J2) 守:

```bash
# 每 2h 跑一次:
sqlite3 C:\kanet\data\console.db <<EOF
-- 1. matcher 真触发次数
SELECT COUNT(*) FROM events 
WHERE source = 'matcher' AND type = 'listen_complete'
AND created_at > datetime('now', '-2 hours');

-- 2. matcher 真 error 次数
SELECT COUNT(*) FROM events
WHERE source = 'matcher' AND type = 'listen_failed'
AND created_at > datetime('now', '-2 hours');

-- 3. matcher 真没动 retail_dex_orders (12h 总验)
SELECT COUNT(*) FROM retail_dex_orders 
WHERE updated_at > datetime('now', '-12 hours')
AND id IN (
  SELECT order_id FROM execution_states 
  WHERE agent_address = (SELECT kasia_address FROM relay_nodes WHERE name='Trader-M')
);
-- 期望: 0
EOF
```

#### Acceptance

- ✅ 12h 真 0 retail_dex_orders 改动 by Trader-M
- ✅ matcher listen_complete 真 > 0 (真有 user 测试触发)
- ✅ matcher listen_failed 真 < listen_complete * 10% (错误率 < 10%)
- ✅ Owner 真签 3 demo 都 pass
- ✅ 9 anti-pattern invariant 真 12h 持续 pass

---

## Cross-review schedule (NWT 跨 hat)

| Subtask | Reviewer hat | 检什么 |
|---|---|---|
| T1.0 | architect | 语义校验报告: spec/code 一致性 |
| T1.1 | reviewer | skill.json category != null + 包式结构对 |
| T1.2 | reviewer | 0 module-level state + degraded mode 真触发 |
| T1.3 | architect | adapter 调用方式真符合 KANet 框架 (撞墙时 broadcast) |
| T1.4 | reviewer | ASCII safe + 不直接碰 Relay |
| T1.5 | reviewer | 主流程真简洁 + T1 阶段每条回复真说 "验证阶段不撮合" |
| T1.6 | reviewer | Trader-M 真上线 + Agent Card 真上链 |
| T1.7 | QA | 4+1 测试真 pass + retail_dex_orders 真 0 新增 |
| T1.8 | QA | 9 anti-pattern 真都有 assertion |
| T1.9 | operator | Owner 3 demo + 12h 监控 + 验收 3 硬标准 |

---

## Definition of NOT Done (撞这些立即暂停)

任 subtask 撞下面之一 = 暂停 + broadcast NWT (architect mode):

1. **T1.3 撞 adapter API 不存在** → MATCHER §C #1 实证. 决策扩 KANet 还是临时方案 (倾向扩 KANet)
2. **T1.5 撞 actionExecutor 不暴露给 skill** → MATCHER §C #3 实证. 同 #1 决策路径
3. **T1.6 撞 Agent Card 上链失败** → 是 KANet onboarding bug 还是 spec 错误
4. **T1.7 撞 retail_dex_orders 真有新增** → matcher 违反 anti-pattern. revert + 重审 §11
5. **T1.8 任 invariant 真 fail** → matcher 违反某条 §11 anti-pattern. revert
6. **撞 STATE-MACHINES.md v0.3 spec/code 不一致** (T1.0 grep verdict 是 ⚠ 或 ❌) → 暂停 + NWT 修 v0.3 / v0.4

---

## commit msg 模板

每个 subtask commit:

```
feat(matcher T1.X): <subtask 名>

mode: implementor (T1.0/T1.6/T1.7/T1.8: implementor; T1.9: operator)
RFC ref: tasks/PZ-MATCHER-shipT1.md
acknowledged invariants: matcher-zero-private-state, no-parallel-truth-source, kanet-natural-growth
ships invariants: <每个 SA 加什么 invariant>
breaks invariants: NONE

Tests: <列实施后真跑过的测试>

Reviewed-by: NWT (reviewer mode)
```

---

## 接位 SOP (Claude Code 接本任务)

1. 读 `docs/DEV-ROLES.md` v1.0 (6 角色 + hat 切换纪律)
2. 读 `docs/STATE-MACHINES.md` v0.3 (注意 §1 admonition: T1.0 必跑)
3. 读 `docs/MATCHER-ARCHITECTURE.md` v0.1 (尤其 §1 哲学 + §2 资源映射 + §11 anti-pattern + §C open questions)
4. 读本任务 `tasks/PZ-MATCHER-shipT1.md`
5. **先跑 T1.0 语义校验 grep, broadcast 报告给 NWT**
6. NWT 跨 hat verdict 后, 进 T1.1
7. 每 subtask commit 后等 cross-review verdict, 不连续跑下一 subtask
8. 撞 Definition of NOT Done → 暂停 + broadcast

---

## 不需要 Claude Code 做的事

- ❌ 不需要起草 INVARIANTS.md (NWT 架构师 backlog, 12h 监控期满后做)
- ❌ 不需要起草 T2 / T3 任务卡 (T1 通过后下次 architect 会话起)
- ❌ 不需要修旧 broker 任何 file (旧 broker 完整保留, T5 才删)
- ❌ 不需要 trim retail_dex_orders col (T3 范围)
- ❌ 不需要补 INVARIANTS.md / DEV-ROLES.md (本 ship 不动这两份)

---

## 时长预算

| 项 | mode | ETA |
|---|---|---|
| T1.0 grep | implementor | 15min |
| T1.1 skill 结构 | implementor | 20min |
| T1.2 loadPeerContext | implementor | 30min |
| T1.3 extractIntent | implementor | 30min |
| T1.4 replyToUser | implementor | 20min |
| T1.5 executor 装配 | implementor | 20min |
| T1.6 Trader-M onboarding | implementor | 20min |
| T1.7 测试 | QA | 45min |
| T1.8 invariant assertion | QA | 20min |
| Cross-review (8 节点) | NWT 跨 hat | ~60min total |
| T1.9 12h 守 + Owner 验收 | operator + Owner | 12h passive + 30min active |

总: ~4.5h dev + 12h passive monitoring.

---

*v1.0 — 2026-05-01 NWT (architect mode 起草). T1 success = matcher 真在 KANet 框架内自然工作 + 0 私有 state + 真听懂 user. 不追求撮合实际成交 (T2-T3 范围). 任意越界回 architect mode.*
