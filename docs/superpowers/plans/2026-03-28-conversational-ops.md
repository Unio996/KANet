# Conversational Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users query chain data, agent status, exchange info, and execute operations through natural conversation with their Agent.

**Architecture:** Intent parser (keyword-weight matching) in Mind layer intercepts user messages before Brain. Intents are loaded dynamically from registered skill packages (not hardcoded). On match: fetch real data from Console API → replace Brain's task with "summarize this data" → Brain interprets. On miss: existing reactive flow untouched.

**Tech Stack:** Node.js ESM, fetchJson (existing), Alpine.js (chat UI), Fastify/Eta (Console)

**Spec:** `docs/superpowers/specs/2026-03-28-conversational-ops-design.md`

---

## Skill Package Architecture

意图不硬编码，封装为可注册技能包。每个垂直领域一个独立包，互不干扰，按需加载。

### 技能包格式

```
agent-mind/src/skills/conversational-ops/
  skill.json       ← 技能元数据（名称、版本、权限）
  intents.json     ← 意图注册表（关键词、参数、维度）
  executor.mjs     ← executeQuery 实现
```

### skill.json 格式

```json
{
  "id": "conversational-ops",
  "version": "1.0.0",
  "name": "对话式操作",
  "description": "通过对话查询 Agent 状态、执行链上操作",
  "permissions": ["query:balance", "query:orders", "execute:send_kas"],
  "intents": "./intents.json",
  "executor": "./executor.mjs"
}
```

### 加载机制（统一入口：registry.mjs）

**registry.mjs 统一扫描，两种格式并存：**

```
skills/*.mjs           → 单文件技能（现有，Skill 子类）
skills/*/skill.json    → 包式技能（新增，intents.json + executor.mjs）
```

registry.mjs `autoDiscover()` 中加一段目录扫描：

```javascript
// 现有：扫 .mjs 单文件技能
for (const file of skillFiles) { ... }

// 新增：扫子目录包式技能
for (const dir of skillDirs) {
  const skillJsonPath = path.join(__dirname, dir, 'skill.json');
  try {
    const meta = JSON.parse(await fs.readFile(skillJsonPath, 'utf-8'));

    // 同样查 Console DB 激活状态（与单文件技能一致）
    const isActive = activeNames === null || activeNames.has(meta.id);
    if (!isActive) {
      console.log(`[skills] Skipped package (disabled): ${meta.id}`);
      continue;
    }

    // 加载意图注册到 intent-parser
    const intentsPath = path.resolve(__dirname, dir, meta.intents);
    const intents = JSON.parse(await fs.readFile(intentsPath, 'utf-8'));
    const executorPath = path.resolve(__dirname, dir, meta.executor);
    const executor = await import('file:///' + executorPath.replace(/\\/g, '/'));

    intentParser.registerIntents(intents, meta.id, executor);
    console.log(`[skills] Loaded package: ${meta.id} v${meta.version} (${Object.keys(intents).length} intents)`);
  } catch (err) {
    console.warn(`[skills] Package load failed, skipped: ${dir} — ${err.message}`);
  }
}
```

**关键：intent-parser.mjs 不扫描目录。** 它只暴露 `registerIntents()` 和 `parseIntent()`，由 registry.mjs 统一喂数据。

### 降级策略

**单个技能加载失败不影响 Mind 启动。** 文件损坏、格式错误、依赖缺失 → 记录 warning 日志 → 跳过该技能 → 其他技能正常运行 → 未命中意图照常走 Brain。单文件技能和包式技能的降级逻辑完全一致（都在 try/catch 里）。

### 激活/停用

包式技能与单文件技能共用 Console DB 的 `skills` 表。技能 `id`（如 `conversational-ops`）作为 name 注册到 DB，通过 Console `/skills` UI 管理开关。**Console 管理体系零改动。**

### 扩展路径

```
capital-market-ops/   → query_stock, query_futures
agent-collaboration/  → collaboration_delegate（填充现有预留）
goods-market-ops/     → query_listing, publish_goods
```

每个包独立发布，注册即生效，无需改核心代码。

---

## File Structure

| File | Responsibility | Phase |
|------|---------------|-------|
| `agent-mind/src/skills/conversational-ops/skill.json` | **New** — 技能元数据 | P1 |
| `agent-mind/src/skills/conversational-ops/intents.json` | **New** — 13个意图注册表 | P1 |
| `agent-mind/src/skills/conversational-ops/executor.mjs` | **New** — 8个查询执行器 | P1 |
| `agent-mind/src/intent-parser.mjs` | **New** — registerIntents() + parseIntent() + formatHint（不扫描目录） | P1 |
| `agent-mind/src/skills/registry.mjs` | **Modify** — autoDiscover() 加目录扫描分支 | P1 |
| `agent-mind/src/context-builder.mjs` | **Modify** — add buildQueryTask() method | P1 |
| `agent-mind/src/mind.mjs` | **Modify** — add parseIntent branch at top of handleMessage() | P1 |
| `agent-mind/src/confirm-store.mjs` | **New** — 确认 token 存储 | P2 |
| `kasia-console/src/ui/chat.eta` | **Modify** — render confirm cards + multi-dim cards | P2 |
| `kasia-console/src/api/chat.js` | **Modify** — confirm endpoint for execute intents | P2 |

---

## Phase 1: Query Skeleton (8 query intents, end-to-end)

### Task 1: Create conversational-ops skill package + intent-parser

**Files:**
- Create: `agent-mind/src/skills/conversational-ops/skill.json`
- Create: `agent-mind/src/skills/conversational-ops/intents.json`
- Create: `agent-mind/src/intent-parser.mjs`

- [ ] **Step 1: Create skill.json**

```json
// agent-mind/src/skills/conversational-ops/skill.json
{
  "id": "conversational-ops",
  "version": "1.0.0",
  "name": "对话式操作",
  "description": "通过对话查询 Agent 状态、执行链上操作",
  "permissions": ["query:balance", "query:price", "query:orders", "query:goals",
                   "query:system", "query:tx_history", "query:contacts", "query:network",
                   "execute:send_kas", "execute:publish_order", "execute:cancel_order",
                   "trigger:reflect", "reputation:query"],
  "intents": "./intents.json",
  "executor": "./executor.mjs"
}
```

- [ ] **Step 2: Create intents.json**

```json
// agent-mind/src/skills/conversational-ops/intents.json
{
  "query_balance": {
    "keywords": ["余额", "余额多少", "balance", "多少钱", "资产", "剩多少", "KAS多少", "钱包", "wallets", "地址余额"],
    "category": "query", "dimensions": "multi", "label": "资产余额",
    "params": []
  },
  "query_price": {
    "keywords": ["价格", "现价", "price", "多少钱一个", "行情", "涨跌"],
    "category": "query", "dimensions": "single", "label": "KAS 价格",
    "params": [{ "name": "token", "pattern": "(KAS|USDT|BTC)", "flags": "i" }]
  },
  "query_orders": {
    "keywords": ["挂单", "订单", "orders", "持仓", "活跃单", "open orders"],
    "category": "query", "dimensions": "multi", "label": "活跃订单",
    "params": []
  },
  "query_goals": {
    "keywords": ["目标", "goals", "任务", "计划", "进展"],
    "category": "query", "dimensions": "multi", "label": "目标列表",
    "params": []
  },
  "query_system": {
    "keywords": ["系统状态", "status", "健康", "运行", "系统", "system"],
    "category": "query", "dimensions": "multi", "label": "系统状态",
    "params": []
  },
  "query_tx_history": {
    "keywords": ["交易记录", "tx", "历史", "最近交易", "history", "花了多少"],
    "category": "query", "dimensions": "multi", "label": "交易历史",
    "params": [{ "name": "limit", "pattern": "(\\d+)\\s*(?:条|笔|个)", "flags": "i" }]
  },
  "query_contacts": {
    "keywords": ["通讯录", "联系人", "contacts", "谁联系", "最近联系", "消息"],
    "category": "query", "dimensions": "multi", "label": "联系人动态",
    "params": []
  },
  "query_network": {
    "keywords": ["网络", "发现", "活跃地址", "链上", "network", "节点"],
    "category": "query", "dimensions": "multi", "label": "网络活动",
    "params": []
  },
  "send_kas": {
    "keywords": ["转", "发送", "转账", "send", "给"],
    "category": "execute", "dimensions": "single", "label": "转账 KAS",
    "params": [
      { "name": "amount", "pattern": "(\\d+\\.?\\d*)\\s*KAS", "flags": "i" },
      { "name": "to", "pattern": "(kaspa:[a-z0-9]+)", "flags": "i" }
    ]
  },
  "publish_order": {
    "keywords": ["卖", "挂单", "sell", "publish", "出售"],
    "category": "execute", "dimensions": "single", "label": "发布订单",
    "params": [
      { "name": "amount", "pattern": "(\\d+\\.?\\d*)\\s*KAS", "flags": "i" },
      { "name": "price", "pattern": "(\\d+\\.?\\d*)\\s*(?:USDT|U|\\$)", "flags": "i" }
    ]
  },
  "cancel_order": {
    "keywords": ["取消", "撤单", "cancel"],
    "category": "execute", "dimensions": "single", "label": "取消订单",
    "params": [{ "name": "orderId", "pattern": "([a-f0-9]{6,})", "flags": "i" }]
  },
  "trigger_reflect": {
    "keywords": ["反思", "总结", "复盘", "reflect", "回顾"],
    "category": "trigger", "dimensions": "none", "label": "触发反思",
    "params": []
  },
  "query_reputation": {
    "keywords": ["信誉", "历史", "地址记录", "完成率", "靠谱", "reputation"],
    "category": "reputation", "dimensions": "single", "label": "地址信誉",
    "params": [{ "name": "address", "pattern": "(kaspa:[a-z0-9]+)", "flags": "i" }]
  }
}
```

Note: JSON cannot store RegExp, so params use `pattern` + `flags` strings, parser compiles them at load time.

- [ ] **Step 3: Create intent-parser.mjs (passive registry, no scanning)**

```javascript
// agent-mind/src/intent-parser.mjs
/**
 * Intent Parser — passive intent registry.
 *
 * Does NOT scan directories. Receives intents via registerIntents() from registry.mjs.
 * parseIntent(input) → { intent, params, config } or { intent: null }
 * Threshold: score < 0.15 → miss → falls through to Brain.
 */

// Merged registry: populated by registerIntents() calls from registry.mjs
const INTENTS = {};
const EXECUTORS = {}; // skillId → executor module

// Active categories (expanded per phase)
const ACTIVE_CATEGORIES = new Set(['query']);

/**
 * Register intents from a skill package.
 * Called by registry.mjs during autoDiscover().
 *
 * @param {object} intents - { intentName: { keywords, category, dimensions, label, params } }
 * @param {string} skillId - owning skill package id
 * @param {object} executor - executor module with executeQuery()
 */
export function registerIntents(intents, skillId, executor) {
  for (const [name, cfg] of Object.entries(intents)) {
    // Compile regex from JSON pattern+flags strings
    if (cfg.params) {
      cfg.params = cfg.params.map(p => ({
        ...p,
        regex: p.regex || new RegExp(p.pattern, p.flags || ''),
      }));
    }
    cfg._skillId = skillId;
    INTENTS[name] = cfg;
  }
  if (executor) EXECUTORS[skillId] = executor;
}

/**
 * Get the executor module for a skill.
 */
export function getExecutor(skillId) {
  return EXECUTORS[skillId] || null;
}

/**
 * Get count of registered intents.
 */
export function getIntentCount() {
  return Object.keys(INTENTS).length;
}

/**
 * Parse user input into an intent + extracted params.
 */
export function parseIntent(input, options = {}) {
  const enabled = options.enabledCategories || ACTIVE_CATEGORIES;
  let best = { intent: null, score: 0, config: null };

  for (const [name, cfg] of Object.entries(INTENTS)) {
    if (!enabled.has(cfg.category)) continue;
    const hits = cfg.keywords.filter(kw => input.includes(kw)).length;
    const score = hits / cfg.keywords.length;
    if (score > best.score) {
      best = { intent: name, score, config: cfg };
    }
  }

  if (best.score < 0.15 || !best.intent) {
    return { intent: null, params: {}, config: null };
  }

  const params = {};
  for (const p of (best.config.params || [])) {
    const match = input.match(p.regex);
    if (match) params[p.name] = match[1];
  }

  return { intent: best.intent, params, config: best.config };
}

/**
 * Build formatHint based on dimensions.
 */
export function getFormatHint(dimensions) {
  if (dimensions === 'single') return '格式：一句话，包含精确数值。';
  if (dimensions === 'multi')  return '格式：先列关键数字，再给一句总体判断。';
  return '';
}
```

- [ ] **Step 2: Verify module loads**

Run: `cd D:/Anthropic/agent-mind && node -e "import('./src/intent-parser.mjs').then(m => { const r = m.parseIntent('我的余额多少'); console.log(JSON.stringify(r)); })"`

Expected: `{"intent":"query_balance","params":{},"config":{...}}`

- [ ] **Step 3: Test edge cases**

Run: `cd D:/Anthropic/agent-mind && node -e "import('./src/intent-parser.mjs').then(m => { console.log(JSON.stringify(m.parseIntent('你觉得今天天气怎么样'))); console.log(JSON.stringify(m.parseIntent('帮我转100KAS给kaspa:qr4h5yd3ej7a'))); console.log(JSON.stringify(m.parseIntent('KAS现在什么价格'))); })"`

Expected:
- First: `{"intent":null,"params":{},"config":null}` (miss → Brain)
- Second: `{"intent":null,...}` (send_kas is execute, not in P1_CATEGORIES)
- Third: `{"intent":"query_price","params":{},...}` (hit)

- [ ] **Step 4: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/intent-parser.mjs src/skills/conversational-ops/skill.json src/skills/conversational-ops/intents.json
git commit -m "feat: intent parser + conversational-ops skill package (13 intents, JSON-driven)"
```

---

### Task 1b: Modify registry.mjs — add package skill scanning

**Files:**
- Modify: `agent-mind/src/skills/registry.mjs`

- [ ] **Step 1: Add import for intent-parser at top**

```javascript
import { registerIntents, getIntentCount } from '../intent-parser.mjs';
```

- [ ] **Step 2: Add directory scanning in autoDiscover(), after the existing .mjs file loop (after line 72)**

Insert after the `for (const file of skillFiles) { ... }` block:

```javascript
    // ── Package skills: scan subdirectories with skill.json ──
    const dirEntries = await fs.readdir(__dirname, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      const skillJsonPath = path.join(__dirname, entry.name, 'skill.json');
      try {
        await fs.access(skillJsonPath);
      } catch { continue; } // No skill.json → not a package skill, skip

      try {
        const meta = JSON.parse(await fs.readFile(skillJsonPath, 'utf-8'));
        if (!meta.id || !meta.intents) {
          console.warn(`[skills] Package missing id/intents, skipped: ${entry.name}`);
          continue;
        }

        // Same activation check as single-file skills
        const isActive = activeNames === null || activeNames.has(meta.id);
        if (!isActive) {
          console.log(`[skills] Skipped package (disabled in Console): ${meta.id}`);
          continue;
        }

        // Load intents JSON
        const intentsPath = path.resolve(__dirname, entry.name, meta.intents);
        const intents = JSON.parse(await fs.readFile(intentsPath, 'utf-8'));

        // Load executor module
        let executor = null;
        if (meta.executor) {
          const execPath = path.resolve(__dirname, entry.name, meta.executor);
          executor = await import('file:///' + execPath.replace(/\\/g, '/'));
        }

        // Register intents into the parser
        registerIntents(intents, meta.id, executor);
        console.log(`[skills] Loaded package: ${meta.id} v${meta.version || '?'} (${Object.keys(intents).length} intents)`);
      } catch (err) {
        console.warn(`[skills] Package load failed, skipped: ${entry.name} — ${err.message}`);
      }
    }

    if (getIntentCount() > 0) {
      console.log(`[skills] Intent parser: ${getIntentCount()} intents registered`);
    }
```

- [ ] **Step 3: Verify Mind starts with package skill loaded**

Run: `cd D:/Anthropic && bash kanet-stop.sh 2>/dev/null; sleep 2; bash kanet-start.sh`

Check logs for: `[skills] Loaded package: conversational-ops v1.0.0 (13 intents)`

- [ ] **Step 4: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/skills/registry.mjs
git commit -m "feat: registry.mjs supports package skills — scan dirs with skill.json, same activation logic"
```

---

### Task 2: Create executor.mjs inside skill package

**Files:**
- Create: `agent-mind/src/skills/conversational-ops/executor.mjs`

- [ ] **Step 1: Create executor functions**

```javascript
// agent-mind/src/skills/conversational-ops/executor.mjs
/**
 * Intent Executors — one function per intent, each calls Console API.
 * All return { data, dimensions } ready for Brain injection.
 */

import { fetchJson } from '../../utils.mjs';

/**
 * Execute a matched intent by fetching real data.
 * @param {string} intent - intent name from INTENTS registry
 * @param {object} params - extracted params
 * @param {object} config - agent config (has consoleUrl, relayNodeId, address)
 * @returns {Promise<{ data: object, error?: string }>}
 */
export async function executeQuery(intent, params, config) {
  const base = config.consoleUrl || 'http://localhost:3100';
  const id = config.relayNodeId;

  const executors = {
    async query_balance() {
      const [bal, wallets] = await Promise.all([
        fetchJson(`${base}/api/relay/${id}/balance`).catch(() => ({ balance: null })),
        fetchJson(`${base}/api/relay/${id}/wallets`).catch(() => ({ kaspa: null, chains: [] })),
      ]);
      return {
        kaspa: { balance: bal.balance, address: config.address },
        chains: wallets.chains || [],
        kaspaWallet: wallets.kaspa || null,
      };
    },

    async query_price() {
      // Use CoinGecko — same as price_tracker skill
      try {
        const data = await fetchJson(
          'https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true'
        );
        const kas = data.kaspa || {};
        return {
          price: kas.usd,
          change24h: kas.usd_24h_change,
          volume24h: kas.usd_24h_vol,
          marketCap: kas.usd_market_cap,
        };
      } catch (err) {
        return { error: `Price fetch failed: ${err.message}` };
      }
    },

    async query_orders() {
      // Check MEXC open orders via trade_executor's existing path
      try {
        const data = await fetchJson(`${base}/api/trading/open-orders?relay_node_id=${id}`);
        return data;
      } catch {
        return { orders: [], error: 'Could not fetch orders' };
      }
    },

    async query_goals() {
      try {
        const goals = await fetchJson(`${base}/api/relay/${id}/goals`);
        return {
          active: goals.filter(g => g.status === 'active').sort((a, b) => b.priority - a.priority),
          retired: goals.filter(g => g.status === 'retired').slice(0, 3),
          total: goals.length,
        };
      } catch {
        return { active: [], retired: [], total: 0 };
      }
    },

    async query_system() {
      try {
        const health = await fetchJson(`${base}/api/health`);
        return health;
      } catch (err) {
        return { error: `System status unavailable: ${err.message}` };
      }
    },

    async query_tx_history() {
      const limit = parseInt(params.limit) || 10;
      try {
        const txs = await fetchJson(`${base}/api/agent/tx-history?relay_node_id=${id}&limit=${limit}`);
        return { transactions: txs, count: txs.length };
      } catch {
        return { transactions: [], count: 0 };
      }
    },

    async query_contacts() {
      try {
        const list = await fetchJson(`${base}/api/discovery/list?accountId=${id}&limit=20`);
        // Sort by most recent activity
        const sorted = list.sort((a, b) =>
          new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0)
        );
        return {
          contacts: sorted.slice(0, 15).map(c => ({
            name: c.display_name || c.address?.slice(-8),
            address: c.address,
            status: c.status,
            interactionCount: c.interaction_count,
            lastSeen: c.last_seen_at,
          })),
          total: list.length,
        };
      } catch {
        return { contacts: [], total: 0 };
      }
    },

    async query_network() {
      try {
        const data = await fetchJson(`${base}/api/discovery/activity?limit=50`);
        return {
          totalAddresses: data.stats?.totalAddresses || 0,
          active24h: data.stats?.activeThis24h || 0,
          profiles: (data.profiles || []).slice(0, 10).map(p => ({
            address: p.address,
            name: p.display_name || p.address?.slice(-8),
            activity: p.total,
            type: p.card_entity_type || 'unknown',
          })),
        };
      } catch {
        return { totalAddresses: 0, active24h: 0, profiles: [] };
      }
    },
  };

  const executor = executors[intent];
  if (!executor) return { error: `No executor for intent: ${intent}` };

  try {
    return await executor();
  } catch (err) {
    return { error: `Query failed: ${err.message}` };
  }
}
```

- [ ] **Step 2: Verify module loads**

Run: `cd D:/Anthropic/agent-mind && node -e "import('./src/skills/conversational-ops/executor.mjs').then(m => console.log(typeof m.executeQuery))"`

Expected: `function`

- [ ] **Step 3: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/skills/conversational-ops/
git commit -m "feat: conversational-ops skill package — 13 intents + 8 query executors"
```

---

### Task 3: Add buildQueryTask to context-builder.mjs

**Files:**
- Modify: `agent-mind/src/context-builder.mjs` (add method after line ~828, after buildReactiveTask)

- [ ] **Step 1: Add buildQueryTask method**

Add this method to the `ContextBuilder` class, right after `buildReactiveTask()`:

```javascript
  /**
   * Build a query-mode task: Brain's job is to summarize real data, not free-reply.
   * Used when intent parser matches a deterministic query.
   *
   * @param {string} intentLabel - human-readable intent name (e.g. '资产余额')
   * @param {object} queryResult - real data from executeQuery()
   * @param {string} formatHint - formatting instruction from getFormatHint()
   * @param {string} originalMessage - the user's original message
   * @returns {{ system: string, user: string, meta: object }}
   */
  async buildQueryTask(intentLabel, queryResult, formatHint, originalMessage) {
    // Reuse cached system prompt (identity + capabilities)
    const [self, intent, evolution, perception] = await Promise.all([
      this.kernels.self.buildSelfContext(),
      this.kernels.intent.buildIntentContext(),
      this.kernels.evolution.buildEvolutionContext(),
      this.kernels.perception.buildPerceptionContext(),
    ]);
    const { text: system } = this._getSystem('reactive', self, intent, evolution, perception);

    const user = [
      `用户明确查询了：${intentLabel}`,
      `用户原文：「${originalMessage}」`,
      '',
      '以下是系统返回的精确数据：',
      '',
      JSON.stringify(queryResult, null, 2),
      '',
      '你的任务：',
      '1. 用自然语言总结上述数据，直接回答用户的问题',
      '2. 只基于数据说话，不添加数据中没有的信息',
      '3. 如果数据显示异常（余额极低/目标失败/订单异常），可以提出关注',
      formatHint,
    ].join('\n');

    return {
      system,
      user,
      meta: { taskType: 'query', intent: intentLabel },
    };
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd D:/Anthropic/agent-mind && node -e "import('./src/context-builder.mjs').then(m => console.log('buildQueryTask' in m.ContextBuilder.prototype))"`

Expected: `true`

- [ ] **Step 3: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/context-builder.mjs
git commit -m "feat: buildQueryTask — Brain task replacement for deterministic queries"
```

---

### Task 4: Wire parseIntent into mind.mjs handleMessage

**Files:**
- Modify: `agent-mind/src/mind.mjs`

- [ ] **Step 1: Add imports at top of file (after line 10, with other imports)**

```javascript
import { parseIntent, getFormatHint, getExecutor } from './intent-parser.mjs';
```

Note: No `loadAllSkills()` needed — registry.mjs handles loading during `autoDiscover()`.

- [ ] **Step 2: Add intent parsing branch at start of handleMessage (after line 117, before `await kernels.perception.refresh()`)**

Insert this block right after `const startTime = Date.now();` (line 114) and before the existing `await kernels.perception.refresh();` (line 117):

```javascript
    // ── Conversational Ops: check for deterministic query intent ──
    const parsed = parseIntent(message);
    if (parsed.intent && parsed.config) {
      const intentLabel = parsed.config.label;
      const dims = parsed.config.dimensions;
      console.log(`[mind] ${config.name} intent matched: ${parsed.intent} (${intentLabel}) params=${JSON.stringify(parsed.params)}`);

      try {
        // Get executor from the skill that registered this intent
        const executor = getExecutor(parsed.config._skillId);
        if (!executor?.executeQuery) throw new Error(`No executor for skill: ${parsed.config._skillId}`);
        const queryData = await executor.executeQuery(parsed.intent, parsed.params, config);
        const formatHint = getFormatHint(dims);
        const task = await contextBuilder.buildQueryTask(intentLabel, queryData, formatHint, message);

        // Call Brain with query task (summarize data, not free-reply)
        const brainResponse = await fetchJson(`${config.adapterUrl}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            peer: sender,
            mindSystem: sanitize(task.system),
            mindUser: sanitize(task.user),
            mindTask: true,
          }),
          brainCall: true,
        });

        let reply = brainResponse?.reply || '';
        // Strip any stray action tags (Brain shouldn't produce them for query tasks)
        reply = reply.replace(/\[ACTION:[^\]]*\]/g, '').trim();

        if (reply) {
          kernels.memory.recordEvent({
            type: 'query_reply',
            from: sender,
            to: config.address,
            summary: `Query [${parsed.intent}]: "${reply.slice(0, 80)}"`,
          });
          kernels.memory.save().catch(() => {});
          const elapsed = Date.now() - startTime;
          console.log(`[mind] ${config.name} query replied in ${elapsed}ms: "${reply.slice(0, 80)}"`);
          return reply;
        }
      } catch (err) {
        console.log(`[mind] ${config.name} query intent failed: ${err.message}, falling through to Brain`);
        // Fall through to normal reactive flow
      }
    }
```

- [ ] **Step 3: Verify Mind still starts**

Run: `cd D:/Anthropic && bash kanet-stop.sh 2>/dev/null; sleep 2; bash kanet-start.sh`

Wait 8 seconds, then check:
```bash
curl -s http://localhost:3100/api/health | head -5
```

Expected: Console responds (Mind loaded without errors).

- [ ] **Step 4: End-to-end test — send "余额多少" via chat API**

Run:
```bash
# Get first relay node ID
RELAY_ID=$(curl -s http://localhost:3100/api/agent/profile | node -e "process.stdin.on('data',d=>{const a=JSON.parse(d);console.log(a[0]?.id)})")
echo "Relay ID: $RELAY_ID"

# Send message through Mind
curl -s -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"余额多少\"}" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).reply?.slice(0,200)"
```

Expected: A reply containing actual KAS balance number (not hallucinated).

- [ ] **Step 5: Test fallthrough — send non-matching message**

Run:
```bash
curl -s -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"你好，最近怎么样\"}" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).reply?.slice(0,200)"
```

Expected: Normal conversational reply (intent parser missed, Brain replied freely).

- [ ] **Step 6: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/mind.mjs
git commit -m "feat: wire intent parser into handleMessage — query intents get real data before Brain"
```

---

### Task 5: Test all 8 query intents end-to-end

**Files:** None (testing only)

- [ ] **Step 1: Test each intent with a representative message**

```bash
RELAY_ID=$(curl -s http://localhost:3100/api/agent/profile | node -e "process.stdin.on('data',d=>{const a=JSON.parse(d);console.log(a[0]?.id)})")

for msg in "余额多少" "KAS现在什么价格" "我有什么活跃订单" "我的目标" "系统状态怎么样" "最近交易记录" "谁最近跟我联系了" "链上有什么活跃地址"; do
  echo "--- $msg ---"
  curl -s -X POST http://localhost:3100/api/agent/reply \
    -H 'Content-Type: application/json' \
    -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"$msg\"}" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).reply?.slice(0,150) || 'NO REPLY'"
  echo ""
done
```

Expected: Each query returns a response based on real data (not hallucinated). Check console logs for `[mind] ... intent matched:` lines.

- [ ] **Step 2: Verify fallthrough still works**

```bash
curl -s -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"帮我分析一下现在的市场趋势\"}"
```

Expected: Brain free-form reply (no intent match — this is an analysis question, not a data query).

---

## Phase 2: Execute Intents + Confirm Cards

### Task 6: Enable execute category + confirm token

**Files:**
- Modify: `agent-mind/src/intent-parser.mjs`
- Create: `agent-mind/src/confirm-store.mjs`

- [ ] **Step 1: Create confirm-store.mjs**

```javascript
// agent-mind/src/confirm-store.mjs
/**
 * In-memory store for confirmation tokens.
 * Token = one-time, 30s expiry, per-agent.
 */

import { randomBytes } from 'node:crypto';

const _store = new Map(); // token → { intent, params, config, agentId, expiresAt }

export function createConfirmToken(intent, params, config, agentId) {
  const token = randomBytes(16).toString('hex');
  _store.set(token, {
    intent, params, config, agentId,
    expiresAt: Date.now() + 30_000,
  });
  // Auto-cleanup after 35s
  setTimeout(() => _store.delete(token), 35_000);
  return token;
}

export function consumeConfirmToken(token, agentId) {
  const entry = _store.get(token);
  if (!entry) return null;
  if (entry.agentId !== agentId) return null;
  if (Date.now() > entry.expiresAt) { _store.delete(token); return null; }
  _store.delete(token); // one-time use
  return entry;
}
```

- [ ] **Step 2: Update intent-parser to support execute category**

In `intent-parser.mjs`, change the default enabled categories:

```javascript
// Change from:
const P1_CATEGORIES = new Set(['query']);
// To:
const ACTIVE_CATEGORIES = new Set(['query', 'execute']);
```

And update the `parseIntent` function default:

```javascript
export function parseIntent(input, options = {}) {
  const enabled = options.enabledCategories || ACTIVE_CATEGORIES;
```

- [ ] **Step 3: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/confirm-store.mjs src/intent-parser.mjs
git commit -m "feat: confirm token store + enable execute intents"
```

---

### Task 7: Handle execute intents in mind.mjs

**Files:**
- Modify: `agent-mind/src/mind.mjs`

- [ ] **Step 1: Add import for confirm store**

```javascript
import { createConfirmToken } from './confirm-store.mjs';
```

- [ ] **Step 2: Add execute branch in the intent handling block**

In the intent parsing block (added in Task 4), after `if (parsed.intent && parsed.config) {`, before the `try` block, add:

```javascript
      // Execute intents: don't run, generate confirm card
      if (parsed.config.category === 'execute') {
        const token = createConfirmToken(
          parsed.intent, parsed.params, parsed.config, config.relayNodeId
        );
        const confirmCard = {
          type: 'confirm',
          token,
          intent: parsed.intent,
          label: parsed.config.label,
          params: parsed.params,
          expiresIn: 30,
        };
        console.log(`[mind] ${config.name} execute intent → confirm card: ${parsed.intent}`);
        // Return JSON-encoded confirm card (chat.eta will render it)
        return JSON.stringify(confirmCard);
      }
```

- [ ] **Step 3: Add confirm execution endpoint in mind-manager**

In `kasia-console/src/services/mind-manager.js`, add after the `askMind` function:

```javascript
// Exported: confirm and execute a pending action
async function confirmAction(relayNodeId, token) {
  const { consumeConfirmToken } = await import('file:///D:/Anthropic/agent-mind/src/confirm-store.mjs');
  const entry = consumeConfirmToken(token, relayNodeId);
  if (!entry) return { error: 'Token expired or invalid' };

  const mind = await getMind(relayNodeId);
  if (!mind) return { error: 'Mind not available' };

  // Execute the action via Mind's existing action executor
  const { executeTradeAction } = mind;
  // Map intent to ACTION type
  const ACTION_MAP = {
    send_kas: { type: 'SEND_KAS', params: { amount: entry.params.amount, to: entry.params.to } },
    publish_order: { type: 'CREATE_MM_ORDER', params: { amount: entry.params.amount, price: entry.params.price } },
    cancel_order: { type: 'CANCEL_ORDER', params: { orderId: entry.params.orderId } },
  };

  const action = ACTION_MAP[entry.intent];
  if (!action) return { error: `Unknown execute intent: ${entry.intent}` };

  try {
    const result = await executeTradeAction(action, mind.config);
    return { ok: true, result };
  } catch (err) {
    return { error: err.message };
  }
}
```

Export `confirmAction` from the module.

- [ ] **Step 4: Add confirm API endpoint in chat.js**

In `kasia-console/src/api/chat.js`, add:

```javascript
  fastify.post('/api/chat/confirm', async (request, reply) => {
    const { relayNodeId, token } = request.body;
    if (!relayNodeId || !token) return reply.code(400).send({ error: 'Missing relayNodeId or token' });
    const { confirmAction } = await import('../services/mind-manager.js');
    const result = await confirmAction(relayNodeId, token);
    return reply.send(result);
  });
```

- [ ] **Step 5: Test execute flow**

```bash
# Send transfer intent
curl -s -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"转 10 KAS 给 kaspa:qr4h5yd3ej7a\"}"
```

Expected: JSON string with `type: "confirm"`, `token`, `params: { amount: "10", to: "kaspa:qr4h5yd3ej7a" }`.

(Do NOT confirm — this would actually transfer KAS.)

- [ ] **Step 6: Commit**

```bash
cd D:/Anthropic/agent-mind && git add src/mind.mjs src/confirm-store.mjs
cd D:/Anthropic/kasia-console && git add src/api/chat.js src/services/mind-manager.js
git commit -m "feat: execute intents with confirm token — no direct execution without user click"
```

---

### Task 8: Render confirm cards in chat.eta

**Files:**
- Modify: `kasia-console/src/ui/chat.eta`

- [ ] **Step 1: Add confirm card rendering in the message display template**

In chat.eta, find where messages are rendered. Add logic to detect confirm card JSON and render as a card with buttons:

```javascript
// In Alpine.js x-data, add:
pendingConfirm: null,
confirmLoading: false,

isConfirmCard(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed.type === 'confirm' && parsed.token;
  } catch { return false; }
},

parseConfirm(content) {
  try { return JSON.parse(content); } catch { return null; }
},

async doConfirm(token) {
  this.confirmLoading = true;
  try {
    const res = await fetch('/api/chat/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: this.selectedAccount, token }),
    });
    const data = await res.json();
    if (data.ok) {
      // Replace confirm card with success message
      this.messages.push({
        sender_address: 'system',
        content: `✓ 已执行: ${JSON.stringify(data.result)}`,
        created_at: new Date().toISOString(),
      });
    } else {
      this.messages.push({
        sender_address: 'system',
        content: `✗ 失败: ${data.error}`,
        created_at: new Date().toISOString(),
      });
    }
  } catch (e) { alert(e.message); }
  this.confirmLoading = false;
},
```

In the message rendering template, add a branch for confirm cards:

```html
<template x-if="isConfirmCard(msg.content)">
  <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 my-2">
    <div class="text-sm font-medium text-amber-800 mb-2" x-text="'待确认：' + parseConfirm(msg.content)?.label"></div>
    <div class="text-xs text-amber-700 space-y-1 mb-3">
      <template x-for="[k,v] in Object.entries(parseConfirm(msg.content)?.params || {})" :key="k">
        <div><span class="font-medium" x-text="k"></span>: <span class="font-mono" x-text="v"></span></div>
      </template>
    </div>
    <div class="flex gap-2">
      <button @click="doConfirm(parseConfirm(msg.content)?.token)"
        :disabled="confirmLoading"
        class="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
        确认执行
      </button>
      <button @click="msg.content = '已取消'"
        class="px-4 py-1.5 text-xs font-medium text-amber-700 bg-white border border-amber-300 rounded-lg hover:bg-amber-50">
        取消
      </button>
    </div>
    <div class="text-[10px] text-amber-400 mt-2">30秒后过期</div>
  </div>
</template>
```

- [ ] **Step 2: Test in browser**

Open http://localhost:3100/chat, type "转 10 KAS 给 kaspa:qr4h5yd3ej7a", verify confirm card appears with amount and address.

- [ ] **Step 3: Commit**

```bash
cd D:/Anthropic/kasia-console
git add src/ui/chat.eta
git commit -m "feat: render confirm cards for execute intents in chat UI"
```

---

## Phase 3: Permission Layer + Reputation + Reflect

### Task 9: Add permission check to intent parser

**Files:**
- Modify: `agent-mind/src/intent-parser.mjs`
- Modify: `agent-mind/src/mind.mjs`

- [ ] **Step 1: Add checkPermission to intent-parser.mjs**

```javascript
/**
 * Check if sender has permission for this intent category.
 * @param {string} senderRelation - 'owner'|'trusted'|'normal'|'stranger'|'blocked'
 * @param {string} category - intent category
 * @returns {'allow'|'deny'|'silent_deny'}
 */
export function checkPermission(senderRelation, category) {
  if (senderRelation === 'blocked') return 'deny';
  if (senderRelation === 'owner') return 'allow';
  if (senderRelation === 'trusted') {
    if (category === 'execute') return 'silent_deny';
    return 'allow';
  }
  // stranger / normal
  if (category === 'query') {
    // Only public queries allowed for strangers
    const PUBLIC_INTENTS = new Set(['query_price', 'query_network']);
    return 'allow'; // For now allow all queries; narrow later if needed
  }
  return 'silent_deny';
}
```

- [ ] **Step 2: Wire permission check into mind.mjs**

In the intent parsing block, add permission check after `parseIntent()`:

```javascript
    if (parsed.intent && parsed.config) {
      const senderRelation = senderMeta?.relation || 'stranger';
      const perm = checkPermission(senderRelation, parsed.config.category);
      if (perm === 'deny' || perm === 'silent_deny') {
        console.log(`[mind] ${config.name} intent ${parsed.intent} blocked: ${senderRelation} → ${perm}`);
        parsed.intent = null; // Fall through to normal Brain
      }
    }
```

- [ ] **Step 3: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/intent-parser.mjs src/mind.mjs
git commit -m "feat: permission layer — execute intents owner-only, strangers silent deny"
```

---

### Task 10: Enable trigger_reflect + query_reputation

**Files:**
- Modify: `agent-mind/src/intent-parser.mjs`
- Modify: `agent-mind/src/intent-executors.mjs`
- Modify: `agent-mind/src/mind.mjs`

- [ ] **Step 1: Enable trigger and reputation categories**

In `intent-parser.mjs`, update:

```javascript
const ACTIVE_CATEGORIES = new Set(['query', 'execute', 'trigger', 'reputation']);
```

- [ ] **Step 2: Add trigger_reflect handler in mind.mjs**

In the intent parsing block, add before the execute check:

```javascript
      // Trigger intents: execute internal Mind function
      if (parsed.config.category === 'trigger') {
        if (parsed.intent === 'trigger_reflect') {
          console.log(`[mind] ${config.name} trigger_reflect requested`);
          // Run reflection in background, return acknowledgment
          runReflection().catch(err =>
            console.log(`[mind] ${config.name} reflection failed: ${err.message}`)
          );
          return `好的，我开始反思最近的行为和决策。结果会更新到我的进化记录里。`;
        }
      }
```

- [ ] **Step 3: Add query_reputation executor**

In `intent-executors.mjs`, add:

```javascript
    async query_reputation() {
      const addr = params.address;
      if (!addr) return { error: '需要提供 kaspa 地址' };
      try {
        // Check relation_states for this address
        const relations = await fetchJson(`${base}/api/discovery/list?accountId=${id}&limit=200`);
        const match = relations.find(r => r.address === addr);
        // Check interaction records
        const interactions = await fetchJson(
          `${base}/api/discovery/interaction?addressA=${config.address}&addressB=${addr}`
        );
        return {
          address: addr,
          known: !!match,
          status: match?.status || 'unknown',
          name: match?.display_name || null,
          interactionCount: interactions?.count || 0,
          hasCard: !!(match?.card_entity_type),
          entityType: match?.card_entity_type || null,
          lastSeen: match?.last_seen_at || null,
        };
      } catch {
        return { address: addr, known: false, error: 'Could not query reputation' };
      }
    },
```

- [ ] **Step 4: Test**

```bash
curl -s -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"帮我反思一下\"}"
```

Expected: Immediate reply "好的，我开始反思..."

```bash
curl -s -X POST http://localhost:3100/api/agent/reply \
  -H 'Content-Type: application/json' \
  -d "{\"relayNodeId\":\"$RELAY_ID\",\"peer\":\"owner:test\",\"message\":\"kaspa:qptg465n4jedfu 这个地址靠谱吗\"}"
```

Expected: Reply based on real relation_states data.

- [ ] **Step 5: Commit**

```bash
cd D:/Anthropic/agent-mind
git add src/intent-parser.mjs src/intent-executors.mjs src/mind.mjs
git commit -m "feat: trigger_reflect + query_reputation — all 13 intents active"
```

---

## Verification Checklist

After all phases:

- [ ] "余额多少" → returns real KAS balance + wallet data
- [ ] "KAS 价格" → returns real CoinGecko price
- [ ] "我的目标" → returns goals from DB
- [ ] "系统状态" → returns Console health
- [ ] "转 10 KAS 给 kaspa:xxx" → shows confirm card, NOT direct execution
- [ ] "你觉得现在适合买吗" → Brain free-form reply (intent miss)
- [ ] Non-owner sends "转 100 KAS" → silent deny, Brain replies normally
- [ ] "帮我反思一下" → triggers reflection cycle
- [ ] Console logs show `[mind] ... intent matched:` for every hit
- [ ] Console logs show normal flow for every miss
