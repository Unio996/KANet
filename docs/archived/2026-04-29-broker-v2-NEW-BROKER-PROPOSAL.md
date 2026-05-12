# NEW BROKER PROPOSAL v2 — 限价单簿 partial fill + retail_dex_orders 单源 + (c) 工具提取

**起草**: NWT 2026-04-29 Owner 钦定 "再不重来都死"
**状态**: LOCKED 2026-04-29 by 三方共识 (J2 #4 broadcast 7e776598dc 已 ack)
**v1 → v2 主要修订**:
- v1 broker_drafts 新表 → v2 retail_dex_orders 单一 source (复用 v82 已 relax qty NULL)
- v1 finalize() 8 行 simplify naive → v2 (c) 工具提取 (留 production algorithm export)
- 加 Owner 钦定 限价单簿 partial fill abstraction (T_ttl, P_limit, Q_total + p_i, q_i + 1% tolerance)
- LOC 估从 naive ~300 修订到 realistic ~1660 (broker-v2 ~810 + 旧 handler 留 export ~800 + chain-side ~450)
- territory 修订 J2 user-side ~450 / NWT chain-side ~450 平衡

**前提**: 旧 broker (broker-llm-agent + broker-buy-handler + broker-sell-handler) **不删, 并行 1 周**, BROKER_V2_ENABLED env flag 控制. 1 周 0 bug 后旧 handler 全删 (剩 trim algorithm export).

---

## 设计原则 (硬规则, 违反不 ship)

### 1. 一个 state, 一张表 — retail_dex_orders 单一 source
- broker session state = retail_dex_orders 一行 (per-peer per-order)
- v82 已 relax retail_dex_orders.qty TEXT NULL — 草稿期 qty 可 NULL
- `_quotes` / `_pendingAccepts` / `_pendingPreview` / `_pendingFields` in-memory Map **全 ban**
- `_convoState` in-memory **全 ban**
- 任何 read/write 必通过 `broker-v2/state.js` API. 不准在别处直接 SQL 写状态字段

### 2. 一条主 path, 不分支
- 每个 user message 进 broker 走同一条 `router.handleMessage(peer, msg)`
- parser 永远先跑, state 永远先 update, LLM 永远后跑
- 不允许 handler-level 提前 reply / 提前 INSERT 表 / 提前 setField
- 删除旧 `handleBuyIntent` / `handleSellIntent` 双重 deterministic+LLM 分支屎

### 3. deterministic 优先, LLM 只补漏
- 能正则提取的字段, parser **必先**写 state (deterministic, 必中, 0 LLM 依赖)
- LLM 只处理: 复合 intent, 模糊语言, question, 自然对话 render
- LLM tool fail 不破状态 — 因为 parser 已写
- LLM 调用复用旧 `broker-llm-agent.js` 的 `_callLlm` export (R11 enable_thinking=false)

### 4. rule 全收敛进 SQL
- R31 (addr 不可改) = `UPDATE WHERE pay_address IS NULL OR pay_address = :new`
- R33 (direction 不可改) = `UPDATE WHERE direction IS NULL OR direction = :new`
- inline JS rule check **全删** (R31 inline / R33 wire / R6 inline 全 collapse 进 SQL)

### 5. 测试查 state 不查 reply
- 所有 regression case assertion 用 `query_db` 验证 retail_dex_orders row 实际状态
- 字符串 match assertion 全删 (`reply_contains '50'` 这种 lucky pass 不再允许)
- 功能验证: "T2 后 SELECT qty FROM retail_dex_orders WHERE user_kasia_address=X 必 = '50'"

### 6. 旧 broker 并行 1 周
- 新 broker 在 `BROKER_V2_ENABLED` env flag 后. 默 false (旧 broker 跑)
- 单 user 实测 → 5 user → 50 user 渐进开
- 旧 broker A/B 跑 1 周, 全 case PASS + Owner Kasia 1 周 0 bug → 旧 handler 全删 (剩 trim algorithm export 全删)

### 7. (c) 工具提取 — 留 algorithm export 不重写
- 旧 buy-handler / sell-handler 的 production algorithm (`buyPreview` / `finalizeBuy` / `selectBestOffers` / `asset-registry` / `fund_lock` / `agent_wallets` / `kasToSompi`) 全 export, broker-v2 router 调 export 不 wrapper
- ~200 LOC complex algorithm 不重写, 0 regression 风险
- 旧 handler 删 4 Map + handleLlmDialog + 双重分支屎

---

## 数据模型 — retail_dex_orders 字段扩展

### v83 — retail_dex_orders 加 partial fill cols

```sql
ALTER TABLE retail_dex_orders ADD COLUMN filled_qty REAL DEFAULT 0;
  -- 累积 chunk fill 量, 0 ≤ filled_qty ≤ qty
ALTER TABLE retail_dex_orders ADD COLUMN settle_grace_until INTEGER;
  -- T_ttl 到期后宽限 ms epoch (in-flight chunk 保护), NULL = 未进入 grace
```

### v84 — exchange_offers 加 partial fill cols + state enum 扩展

```sql
ALTER TABLE exchange_offers ADD COLUMN price_tolerance REAL DEFAULT 0.01;
  -- 1% phase 1 单 param: user_spread + protocol tolerance 共用
  -- phase 2 (1 周 gate post) 拆 separate cols if user UX 需
ALTER TABLE exchange_offers ADD COLUMN settle_grace_min INTEGER DEFAULT 5;
  -- T_ttl 到后 5min 宽限 in-flight chunk

-- retail_dex_orders.state CHECK 扩 (需 recreate-table pattern):
-- state IN ('aligning', 'awaiting_payment', 'paid', 
--           'partially_filled', 'ttl_expiring', 'settled',
--           'completed', 'expired', 'cancelled', 'refunded')
```

### 为什么 retail_dex_orders 单一 source 不新建 broker_drafts (v1 撤回)

- v82 已 relax `qty TEXT NULL` — 草稿期 qty 可 NULL, 不需新表
- `state` enum 已 cover lifecycle (aligning → awaiting_payment → paid → completed)
- 新加 col (filled_qty / settle_grace_until / price_tolerance) 不影响现有 row
- 不复活 R44 anti-pattern (新建表平行 vs 完善现有)
- broker session 草稿 state = `retail_dex_orders` row WHERE state='aligning' AND user_kasia_address=peer

---

## 限价单簿 partial fill 协议 (Owner 钦定核心)

### 抽象

**maker 挂 limit order 3 维**: `(T_ttl, P_limit, Q_total)`
- `T_ttl`: 订单过期时间 (`exchange_offers.expires_at`)
- `P_limit`: 用户限价 (`retail_dex_orders.price_pref` or `exchange_offers.price_anchor`)
- `Q_total`: 单总量 (`exchange_offers.give_amount`)

**taker accept_v1 chunk 2 维**: `(p_i, q_i)`
- `p_i`: 本 chunk 当前市价 (taker 选定)
- `q_i`: 本 chunk 量 (≤ Q_total - filled_qty)

**约束**:
- ∀ chunk: `|p_i - P_limit| / P_limit ≤ price_tolerance` (default 0.01 = 1%)
- ∀ time: `Σ q_i ≤ Q_total` (SQLite atomic UPDATE WHERE filled_qty+chunk_qty ≤ qty 防 over-fill)
- `T_ttl` 到 → `settle_grace_until = expires_at + settle_grace_min*60*1000` (in-flight chunk 保护)
- `settle_grace_until` 到 + 残量未 settle → `advanceToRefunded` refund 残量

### 5 corner cover

#### Corner 1: `settle_grace_period` 5min — TTL race 防 user lost money
T_ttl 到, 但 chunk 已 in-flight (paid 但未 delivered) → `settle_grace_min` 5min 宽限. 不立即 cancel. `broker-state-reconciler` 5min cron tick 检查 `settle_grace_until` 过期 + 残量 → `advanceToRefunded`. 复用现有 advanceToRefunded API (无 chain action 重复).

#### Corner 2: `market-seeder` large `Q_total` 不 fragmentation
现 `market-seeder` 按 spread% 挂 fixed qty. 改 large `Q_total` (e.g. 5000 KAS) + 1% `price_tolerance` — 单单 cover 多 retail taker chunk. tick 间隔从 5min 缩 1min, qty 大量 cover (~80 LOC).

#### Corner 3: 单 col `filled_qty` + chain_events audit (不 separate exchange_chunks 表)
不新建 `exchange_chunks` 表 (避复活 R44 anti-pattern). `retail_dex_orders.filled_qty` 累积. 每次 chunk 成: `chain_events INSERT event_type='broker_chunk_filled', payload={offer_id, chunk_qty, chunk_price, taker_addr, tx_hash}`. audit trail = chain_events query.

#### Corner 4: per-chunk strict 1% + maker validator
`exchange-machine.js handleAcceptV1`: 验 `|chunk_price - offer.price_anchor| / offer.price_anchor ≤ price_tolerance`. maker (broker side) accept_v1 校验 + reject if 超 tolerance. ~20 LOC (iii) maker validator.

#### Corner 5: phase 1 lock + phase 2 adaptive
- **phase 1 (ship)**: single `price_tolerance = 0.01` (1%) 全场. user_spread (preview quote envelope) + protocol tolerance (chain accept guard) 共用 phase 1.
- **phase 2 (1 周 gate post backlog)**: adaptive — `user_spread` 单独 (preview UX, e.g. 0.5%) + `protocol_tolerance` 单独 (chain guard, e.g. 1.5%). 不同 semantic 不同值. 看 take rate 动态 tune.

---

## 文件结构 — broker-v2 ~810 LOC + 旧 handler trim ~800

```
kasia-console/src/services/broker-v2/
├── state.js       ~80 LOC — getState / setField / clearState / advance / SQL 单点 (retail_dex_orders 维度)
├── parser.js      ~60 LOC — extractFields(msg) regex
├── llm.js         ~80 LOC — render(peer, msg, state, profile, contact), 调 broker-llm-agent._callLlm export
├── router.js      ~140 LOC — handleMessage 主 path + lifecycle decision
└── order-book.js  ~450 LOC — partial fill orchestration (handleAcceptV1 / filled_qty CAS / chain_events / settle_grace)
```

### 旧 handler trim 路径

```
kasia-console/src/services/broker-llm-agent.js     — trim ~150 (删 4 Map + handleLlmDialog), 留 _callLlm export
kasia-console/src/services/broker-buy-handler.js   — trim ~400 (删 handleBuyIntent + 4 Map), 留 buyPreview/finalizeBuy/selectBestOffers/asset-registry/fund_lock export
kasia-console/src/services/broker-sell-handler.js  — trim ~400 (删 handleSellIntent + 4 Map), 留 sellPreview/finalizeSell/agent_wallets/kasToSompi export
```

**post-trim 旧 handler ~800 LOC pure algorithm export, broker-v2 router 调用**.

---

## chain-side 协议改 (NWT territory ~450)

| file | task | LOC |
|------|------|-----|
| `kasia-relay/src/exchange-machine.js` | partial fill transition (handleAcceptV1 chunk validate + filled_qty 累积 + 1% tolerance check + state enum 处理) | ~150 |
| `kasia-console/src/db/migrate.js` | v83 (filled_qty + settle_grace_until) + v84 (price_tolerance + settle_grace_min + state enum recreate-table) | ~30 |
| `kasia-relay/src/commands.mjs` | accept_v1 协议加 amount field (chunk qty) | ~20 |
| `kasia-console/src/services/market-seeder.js` | large Q_total redesign (1min tick + 5000 KAS qty + 1% tolerance) | ~80 |
| `kasia-console/test-framework/lib/runner.mjs` | query_db + inject_llm_mock action | ~150 |
| `kasia-console/src/api/conversations.js` | BROKER_V2_ENABLED flag wire (chat handler 入口路由) | ~20 |

---

## 现 LOC 估 (post-trim 总)

| layer | LOC |
|-------|-----|
| broker-v2 (新, J2) | ~810 (4 file + order-book.js) |
| 旧 handler trim 留 export (J2 + NWT) | ~800 |
| chain-side 协议改 (NWT) | ~450 |
| 旧 broker-state-authority + intake-watcher (chain-side, 不动) | ~600 |

**post 总 ~2660 LOC vs 旧 ~4000 减 33%**. 核心 Map / 双重分支 / handleLlmDialog 全删, broker-v2 主 path 单 source.

---

## 三方分工 + ETA (post J2 #4 7e776598dc lock)

| # | territory | task | LOC | ETA |
|---|-----------|------|-----|-----|
| A | J2 user-side ~450 | broker-v2/state.js + parser.js + llm.js + router.js | ~360 | 4h |
| B | J2 user-side | order-book.js (handleAcceptV1 + filled_qty CAS + chain_events) | (J2 + NWT 协, q TBD) | TBD |
| C | J2 顺手 trim | broker-llm-agent.js 删 4 Map + handleLlmDialog | trim ~150 | 1h |
| D | NWT chain-side ~450 | exchange-machine.js partial fill transition | ~150 | 1.5h |
| E | NWT chain-side | migrate v83 + v84 (filled_qty + settle_grace + price_tolerance + state enum) | ~30 | 30min |
| F | NWT chain-side | commands.mjs accept_v1 amount field | ~20 | 20min |
| G | NWT chain-side | market-seeder large Q_total redesign | ~80 | 1h |
| H | NWT chain-side | runner.mjs query_db + inject_llm_mock action | ~150 | 1.5h |
| I | NWT chain-side | BROKER_V2_ENABLED flag wire (chat handler 入口) | ~20 | 20min |
| J | NWT 顺手 trim | broker-buy/sell-handler 删 4 Map + 状态路径 (留 algorithm export) | trim ~300 | 1h |
| K | 三方 | cross-host regression (三 host pull + restart + cron 0 FAIL + 6 turn LLM mock) | — | 1h |
| L | NWT + Owner | 1 user 实测 prep (flag enable Trader-B + DM 6 turn instruct) | — | 1h |
| M | Owner | Kasia DM 1 周实测 gate 0 bug | — | 1 周 |
| N | 三方 | post-gate 旧 handler 全删 (剩 trim export 全删, broker-v2 stand alone) + phase 2 adaptive backlog | — | post M |

**post-align 总 6h ship + 1h regression + 1h prep + 1 周 gate**. 三方 parallel ship 不 sequential.

---

## 5 ship 阶段 (post 7e776598dc lock)

| 阶段 | 时段 | 任务 |
|------|------|------|
| 1 | now → 30min | spec doc revise commit (本 doc) + ship plan task lock |
| 2 | 30min → 6.5h | J2 + NWT parallel ship code (broker-v2 4 file + order-book.js + 旧 handler trim / chain-side 协议改 6 file + flag) |
| 3 | 6.5h → 7.5h | cross-host regression (三方 host pull + restart + cron tick 0 FAIL + 6 turn LLM mock case PASS) |
| 4 | 7.5h → 8.5h | Owner 1 user 实测 prep (flag enable scope 1 user Kasia DM Trader-B, Owner instruct sell-cancel-refund-partial-fill 6 turn) |
| 5 | 1 周 | Owner Kasia DM 1 周实测 gate 0 bug → 旧 handler 全删 (剩 trim export 全删 broker-v2 stand alone) + phase 2 adaptive republish 升级 backlog |

---

## state.js (~80 LOC) — SQL 单点 (retail_dex_orders 维度)

```js
import { sqlite } from '../../db/client.js';
import crypto from 'node:crypto';

const LOCKED_FIELDS = ['side', 'pay_address'];  // R31/R33 (注: side 替代 v1 direction, schema 已 use)
const DRAFT_TTL_MS = 30 * 60 * 1000;

export function getActiveDraft(peer) {
  const row = sqlite.prepare(`
    SELECT * FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state = 'aligning'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(peer);
  if (!row) return null;
  return {
    ...row,
    complete: !!(row.side && row.qty && row.pay_chain && 
                 (row.side === 'buy_kas' || row.pay_address)),
  };
}

export function setField(peer, name, value) {
  if (value === null || value === undefined) return { ok: true, set: false };
  
  // ensure draft row exists (state='aligning')
  const existing = getActiveDraft(peer);
  if (!existing) {
    sqlite.prepare(`
      INSERT INTO retail_dex_orders 
        (id, user_kasia_address, state, order_type, qty, created_at, updated_at)
      VALUES (?, ?, 'aligning', 'limit', NULL, datetime('now'), datetime('now'))
    `).run(crypto.randomUUID(), peer);
  }
  
  // R31/R33 SQL guard for locked fields
  const guard = LOCKED_FIELDS.includes(name) 
    ? `AND (${name} IS NULL OR ${name} = :value)` 
    : '';
  
  const result = sqlite.prepare(`
    UPDATE retail_dex_orders 
    SET ${name} = :value, updated_at = datetime('now')
    WHERE user_kasia_address = :peer 
      AND state = 'aligning' ${guard}
  `).run({ peer, value: String(value) });
  
  if (result.changes === 0 && LOCKED_FIELDS.includes(name)) {
    return { ok: false, set: false, reason: `${name} locked, current != new` };
  }
  return { ok: true, set: true };
}

export function advance(peer, newState) {
  const result = sqlite.prepare(`
    UPDATE retail_dex_orders SET state = ?, updated_at = datetime('now') 
    WHERE user_kasia_address = ? AND state = 'aligning'
  `).run(newState, peer);
  return { ok: result.changes > 0 };
}

export function clearDraft(peer) {
  sqlite.prepare(`
    DELETE FROM retail_dex_orders 
    WHERE user_kasia_address = ? AND state = 'aligning'
  `).run(peer);
}
```

**finalize 不重写** — 由 router 调旧 `broker-buy-handler.finalizeBuy` / `broker-sell-handler.finalizeSell` export. 这些算法 ~200 LOC production-tested, 不动.

---

## parser.js / llm.js / router.js — 沿用 v1 设计 (略, 见 v1 草案 L194-440)

(parser.js / llm.js / router.js 整体设计沿用 v1, 仅 state API call 改为 retail_dex_orders 维度. router.handleMessage post-confirm 调 `broker-buy-handler.finalizeBuy` 不调本地 finalize. 详细见 v1 草案 commit history.)

---

## 边界条件 cover

### 1. R31 attacker 跨 peer addr swap
现有 R31 `detectAddrChangeAttempt` 逻辑保留语义但**不 inline check** — 走 `setField('pay_address', :new)` SQL guard, 0 changes = 攻击拒绝, log + ignore 不外显 (Owner 铁律 #2 R33 不外显).

### 2. R33 direction 跨 turn lock
T1 'sell' → state.side='sell_kas'. T5 user 'buy 100' → setField('side', 'buy_kas') SQL guard fail → log + ignore. 复合 intent (confirm + question) 走 LLM 路径, LLM SYSTEM_PROMPT 知道 side='sell_kas' 不会 hallucinate flip.

### 3. R37 single system msg (Qwen Jinja)
LLM 调用层一条 system msg, llm.js 拼 SYSTEM_PROMPT + profile + state 进同一 string. 不在 messages 数组加多 system entry. 沿用 broker-llm-agent.js Qwen caller (R11 enable_thinking=false).

### 4. cancel-restart legitimate path
intent='reset' (ANTI-PATTERNS 已知 _RESET_INTENT_KEYWORDS) → `clearDraft` 删 row, T2 user 新 declaration 进 fresh row. Owner 铁律 #4 state 不中断: 内部走 cancel-restart legitimate path, user-facing 不显 'R33 拦截' / '没有找到活跃订单'.

### 5. 复合 intent (Owner T4 实测撞)
'YES, 卖出价格你建议多少?' →
- parser intent=confirm (regex 严 `^YES$/^是$` 不 match 'YES, 卖出...')
- 实际走 LLM path, LLM SYSTEM_PROMPT 知道 state='preview_shown' + state, LLM 自然回 "市价 spread" + 不 reset preview

实测必修: parser confirm regex 严格 — 仅 reply 全文是 YES/Y/是/对/确认/好 才 confirm. 'YES, 还问 X' 不算.

### 6. 多语言 (Owner 钦定全中文)
parser 中英混 OK (regex 加 /i 兼容). LLM SYSTEM_PROMPT '全程中文' 严. det reply 全中文. 不再 _detectLang multi-language 分支.

### 7. broker-intake-watcher 链入账 → retail_dex_orders
现有 `broker-intake-watcher.js` 60s 扫 chain 入账, 4 场景路由. broker-v2:
- 入账 amount 匹配 retail_dex_orders.qty + state='preview_shown' OR 'awaiting_payment' → advance state='paid' + 触发 finalize chain action
- 入账 not match drafts → broker-intake-watcher 现有 fallback 路径 (publish offer / refund / reject)
保持 intake-watcher 不动, 仅新加分支查 retail_dex_orders state='aligning'/'preview_shown' row.

### 8. partial fill chunk concurrent safety (新)
多 taker 同时 accept_v1 chunk → exchange-machine `handleAcceptV1` 用 SQLite atomic `UPDATE retail_dex_orders SET filled_qty = filled_qty + :chunk_qty WHERE filled_qty + :chunk_qty <= qty`. row-level lock 防 over-fill. 失败 chunk 返 'q_remaining < requested' + 减小 chunk_qty 重试.

### 9. settle_grace_until in-flight chunk (新)
T_ttl 到, chunk in-flight (paid 但未 delivered) → `settle_grace_until = expires_at_ms + settle_grace_min*60*1000`. broker-state-reconciler 5min cron 检查 `settle_grace_until < now()` + 残量 > 0 → `advanceToRefunded` refund 残量.

### 10. 1% tolerance unify (phase 1) (新)
exchange_offers.price_tolerance = 0.01 (1%). user_spread + protocol_tolerance phase 1 单 param. phase 2 separate cols if user UX 需 (post 1 周 gate).

---

## 测试设计 (assertion 严)

### regression case 全改 query_db assertion

```js
{ action: 'send_message', from_peer: peer, message: '我想卖一点kas',
  expect: {
    must: {
      query_db: `SELECT side FROM retail_dex_orders WHERE user_kasia_address = ? AND state='aligning'`,
      params: [peer],
      expected_row: { side: 'sell_kas' },
    },
  },
},
{ action: 'send_message', from_peer: peer, message: '50 个',
  expect: {
    must: {
      query_db: `SELECT qty, side FROM retail_dex_orders WHERE user_kasia_address = ? AND state='aligning'`,
      params: [peer],
      expected_row: { qty: '50', side: 'sell_kas' },  // R33 lock 不变
    },
  },
},
{ action: 'send_message', from_peer: peer, message: 'Bsc, 0x1417cfDaD...',
  expect: {
    must: {
      query_db: `SELECT qty, side, pay_chain, pay_address FROM retail_dex_orders WHERE user_kasia_address = ? AND state='aligning'`,
      params: [peer],
      expected_row: { qty: '50', side: 'sell_kas', pay_chain: 'bsc', pay_address: '0x1417cfDaD...' },
    },
  },
},
```

新增 `expect.must.query_db` + `expected_row` runner action — SQL 验证状态. lucky string match 不再可能.

### partial fill chunk regression case (新)

```js
{ action: 'send_message', message: '买 50 KAS 市价 BSC 0xADDR' },
{ expect: { must: { query_db: `SELECT state, qty FROM retail_dex_orders WHERE user_kasia_address=?`, params: [peer],
  expected_row: { state: 'preview_shown', qty: '50' } } } },
{ action: 'send_message', message: 'YES' },
{ expect: { must: { query_db: `SELECT state FROM retail_dex_orders WHERE user_kasia_address=?`, params: [peer],
  expected_row: { state: 'awaiting_payment' } } } },
{ action: 'simulate_chunk_accept', chunk_qty: 30, chunk_price: '0.034' },
{ expect: { must: { query_db: `SELECT filled_qty, state FROM retail_dex_orders WHERE user_kasia_address=?`, params: [peer],
  expected_row: { filled_qty: 30, state: 'partially_filled' } } } },
{ action: 'simulate_chunk_accept', chunk_qty: 25, chunk_price: '0.034' },  // 30+25=55 > 50 → 部分 reject 至 q_remaining=20
{ expect: { must: { query_db: `SELECT filled_qty, state FROM retail_dex_orders WHERE user_kasia_address=?`, params: [peer],
  expected_row: { filled_qty: 50, state: 'settled' } } } },  // 残量 0 → settled
```

### cross-process state retain

```js
{ action: 'send_message', message: '卖 50 KAS BSC 0xADDR' },
{ action: 'cleanup_peer_broker_state', peers: [peer] },  // 模拟 process restart 内存清
{ action: 'send_message', message: 'YES' },
{ expect: { must: { query_db: `SELECT state FROM retail_dex_orders WHERE user_kasia_address=? AND state='awaiting_payment'`, params: [peer],
  expected_row_count: 1 } } },
```

state 在 retail_dex_orders 表, 跨 process 必 persist. 重启不丢.

---

## v1 反思 (撤回根因)

v1 (NWT 04-29 草) 错:
1. **broker_drafts 新表** — 复活 R44 anti-pattern, J1+J2 push back. v82 已 relax retail_dex_orders.qty NULL, 不需新表.
2. **finalize() 8 行 simplify** — 低估 `buyPreview` / `finalizeBuy` / `selectBestOffers` / `asset-registry` / `fund_lock` / `agent_wallets` production algorithm 复杂度 (~200+ LOC). naive 重写 = regression bomb.
3. **LOC 估 ~300 naive** — 实际需 ~810 broker-v2 + ~800 旧 handler 留 export + ~450 chain-side = ~2060 ship + 600 不动 = ~2660 总.

v2 修订:
- retail_dex_orders 单一 source — 复用 v82 已 relax qty NULL, 不新建表
- (c) 工具提取 — 留 buyPreview/finalizeBuy/selectBestOffers/asset-registry/fund_lock/agent_wallets/kasToSompi 纯算法 export, 删 4 Map + handleLlmDialog + 双重分支
- 限价单簿 partial fill abstraction (T_ttl, P_limit, Q_total + p_i, q_i + 1% tolerance) — Owner 钦定窄门核心
- 6h ship + 1h regression + 1h prep + 1 周 gate + phase 2 adaptive 升级 backlog

—— NWT 2026-04-29 v2 (post J2 #4 7e776598dc lock)
