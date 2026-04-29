# NEW BROKER PROPOSAL — 一条主 path / 一个 state / 一个 router

**起草**: NWT 2026-04-29 Owner 钦定 "再不重来都死"
**状态**: PROPOSAL — 求 J1+J2 真讨论 + 真 push back, Owner 钦定后 ship
**前提**: 旧 broker (broker-llm-agent + broker-buy-handler + broker-sell-handler + broker-state-authority + broker-intake-watcher) **不动, 不删, 并行跑**. 新 broker 走 feature flag, 1 周真测 0 bug 后旧 broker 才删

---

## 设计原则 (硬规则, 违反不 ship)

### 1. 一个 state, 一张表
- 状态 = `broker_drafts` 表一行 (per-peer)
- `_convoState`, `_pendingFields`, in-memory Map **全 ban**
- 任何 read/write 必通过 `broker-state.js` API. 不准在别处直接 SQL 写状态字段

### 2. 一条主 path, 不分支
- 每个 user message 进 broker 走同一条 `router.handleMessage(peer, msg)`
- parser 永远先跑, state 永远先 update, LLM 永远后跑
- 不允许 handler-level 提前 reply / 提前 INSERT 表 / 提前 setField

### 3. deterministic 优先, LLM 只补漏
- 能正则提取的字段, parser **必先**写 state (deterministic, 必中, 0 LLM 依赖)
- LLM 只处理: 复合 intent, 模糊语言, question, 真自然对话 render
- LLM tool fail 不破状态 — 因为 parser 已写

### 4. rule 全收敛进 SQL
- R31 (addr 不可改) = `UPDATE WHERE pay_address IS NULL OR pay_address = :new`
- R33 (direction 不可改) = `UPDATE WHERE direction IS NULL OR direction = :new`
- inline JS rule check **全删** (R31 inline / R33 wire / R6 inline 全 collapse 进 SQL)

### 5. 测试查 state 不查 reply
- 所有 regression case assertion 用 `query_db` 验证 `broker_drafts` row 真状态
- 字符串 match assertion 全删 (`reply_contains '50'` 这种 lucky pass 不再允许)
- 真功能验证: "T2 后 SELECT qty FROM broker_drafts WHERE peer=X 必 = 50"

### 6. 旧 broker 并行 2 周
- 新 broker 在 `BROKER_V2_ENABLED` env flag 后. 默 false (旧 broker 跑)
- 单 user 真测 → 5 case → 50 case → 100 case 渐进开
- 旧 broker A/B 跑 2 周, 全 case PASS + Owner 真 Kasia 1 周 0 bug → 旧 broker 删

---

## 数据模型 — broker_drafts 表

```sql
-- migrate v82 (post 现有 v81 revert chain)
CREATE TABLE IF NOT EXISTS broker_drafts (
  peer_address     TEXT    NOT NULL PRIMARY KEY,
  
  -- 锁定字段 (R31/R33 — 一旦 set 不可改, user '取消重来' 才能 reset)
  direction        TEXT    CHECK (direction IS NULL OR direction IN ('buy', 'sell')),
  pay_address      TEXT,                              -- EVM 0x... 或 SOL/TRON addr
  
  -- 可变字段 (latest 覆盖, 用户改主意 OK)
  qty              REAL    CHECK (qty IS NULL OR qty > 0),
  asset            TEXT    CHECK (asset IS NULL OR asset IN ('KAS', 'USDT', 'USDC')),
  chain            TEXT    CHECK (chain IS NULL OR chain IN ('bsc', 'polygon', 'sol', 'tron', 'kaspa')),
  price_pref       TEXT,                              -- 'market' / 'limit:0.034' / NULL
  
  -- lifecycle
  phase            TEXT    NOT NULL DEFAULT 'drafting'
                   CHECK (phase IN ('drafting', 'preview_shown', 'confirmed',
                                     'awaiting_payment', 'paid', 'completed',
                                     'cancelled', 'expired')),
  
  -- timestamps (ms epoch)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER                            -- drafting 30min auto-expire
);

CREATE INDEX idx_drafts_phase ON broker_drafts(phase);
CREATE INDEX idx_drafts_expires ON broker_drafts(expires_at) 
  WHERE phase IN ('drafting', 'preview_shown');
```

**为什么不复用 retail_dex_orders**:
- retail_dex_orders.qty TEXT NOT NULL — 设计为已确认订单的不可变记录
- broker_drafts 是 in-flight 草稿, qty 必允 NULL (用户没说时)
- retail_dex_orders.state = `aligning/awaiting_payment/...` — 跟 phase 字段语义有 overlap, 但不完全等价
- 边界清晰: drafts = 草稿, orders = 已确认

**phase 转 retail_dex_orders 时机**:
- broker_drafts.phase = 'confirmed' 触发 → INSERT retail_dex_orders + DELETE broker_drafts row
- 旧 broker-buy-handler.js finalizeBuy 真 publishOffer / aggregation / fund_lock / kasToSompi 等 chain action 保留, 仅入口变 — 接收 broker_drafts.confirmed 行而不是内存 _pendingPreview

---

## 文件结构 — 4 个文件 ~300 LOC

```
kasia-console/src/services/broker-v2/
├── state.js     ~80 LOC — getState / setField / clearState / advance / SQL 单点
├── parser.js    ~60 LOC — extractFields(msg) 正则
├── llm.js       ~80 LOC — callLlm with tools, tools also call setField
└── router.js    ~80 LOC — handleMessage 主 path
```

整 broker-v2 namespace. 旧 broker-llm-agent / broker-buy-handler / broker-sell-handler / broker-state-authority 不动, 并行.

---

## state.js (~80 LOC) — SQL 单点

```js
import { sqlite } from '../../db/client.js';

const LOCKED_FIELDS = ['direction', 'pay_address'];  // R31/R33
const DRAFT_TTL_MS = 30 * 60 * 1000;

export function getState(peer) {
  const row = sqlite.prepare(`
    SELECT * FROM broker_drafts
    WHERE peer_address = ? AND (expires_at IS NULL OR expires_at > ?)
  `).get(peer, Date.now());
  if (!row) return null;
  return {
    ...row,
    complete: !!(row.direction && row.qty && row.asset && row.chain && 
                 (row.direction === 'buy' || row.pay_address)),  // sell 必 EVM addr
  };
}

export function setField(peer, name, value) {
  if (value === null || value === undefined) return { ok: true, set: false };
  
  // ensure row exists
  const now = Date.now();
  sqlite.prepare(`
    INSERT OR IGNORE INTO broker_drafts 
      (peer_address, phase, created_at, updated_at, expires_at)
    VALUES (?, 'drafting', ?, ?, ?)
  `).run(peer, now, now, now + DRAFT_TTL_MS);
  
  // R31/R33 SQL guard for locked fields
  const guard = LOCKED_FIELDS.includes(name) 
    ? `AND (${name} IS NULL OR ${name} = :value)` 
    : '';
  
  const result = sqlite.prepare(`
    UPDATE broker_drafts 
    SET ${name} = :value, updated_at = :now
    WHERE peer_address = :peer ${guard}
  `).run({ peer, value, now });
  
  if (result.changes === 0 && LOCKED_FIELDS.includes(name)) {
    return { ok: false, set: false, reason: `${name} locked, current != new` };
  }
  return { ok: true, set: true };
}

export function advance(peer, newPhase) {
  const now = Date.now();
  const result = sqlite.prepare(`
    UPDATE broker_drafts SET phase = ?, updated_at = ? 
    WHERE peer_address = ?
  `).run(newPhase, now, peer);
  return { ok: result.changes > 0 };
}

export function clearState(peer) {
  sqlite.prepare(`DELETE FROM broker_drafts WHERE peer_address = ?`).run(peer);
}

// post-confirm: move draft to retail_dex_orders
export function finalize(peer) {
  const draft = sqlite.prepare(`SELECT * FROM broker_drafts WHERE peer_address = ?`).get(peer);
  if (!draft || draft.phase !== 'confirmed') return { ok: false };
  
  // INSERT retail_dex_orders (旧 broker schema, 不动)
  sqlite.prepare(`
    INSERT INTO retail_dex_orders 
      (id, user_kasia_address, side, order_type, qty, pay_chain, pay_address, 
       receive_address, state, created_at, updated_at)
    VALUES (?, ?, ?, 'limit', ?, ?, ?, ?, 'awaiting_payment', datetime('now'), datetime('now'))
  `).run(
    crypto.randomUUID(),
    peer,
    draft.direction === 'buy' ? 'buy_kas' : 'sell_kas',
    String(draft.qty),
    draft.chain,
    draft.pay_address,
    draft.pay_address,  // sell: receive = pay; buy: receive 由 finalize 时填
  );
  
  // delete draft
  clearState(peer);
  return { ok: true };
}
```

---

## parser.js (~60 LOC) — 正则提取

```js
const PATTERNS = {
  direction: {
    buy: /(?:^|[^a-z])(?:买|buy|要买|想买|purchase)/i,
    sell: /(?:^|[^a-z])(?:卖|sell|要卖|想卖|sell\s*off|出售)/i,
  },
  qty: /(\d+(?:\.\d+)?)\s*(?:个|枚|KAS|kas|USDT|usdt|USDC|usdc)?/,
  asset: /\b(KAS|USDT|USDC|kas|usdt|usdc)\b/,
  chain: {
    bsc: /\b(?:bsc|bnb|binance|币安)\b/i,
    polygon: /\b(?:poly|polygon|matic)\b/i,
    sol: /\b(?:sol|solana)\b/i,
    tron: /\b(?:tron|trx|波场)\b/i,
  },
  pay_address: /0x[a-fA-F0-9]{40}/,
  price_pref: {
    market: /(?:市价|市场价|按市价|market|实时价)/i,
    limit: /限价\s*[:：]?\s*(\d+\.?\d*)|@\s*(\d+\.?\d*)/i,
  },
  cancel: /(?:取消|不要了|cancel|stop|算了|不买了|不卖了)/i,
  confirm: /^\s*(?:YES|Y|是|对|确认|好|OK|可以|继续|没问题)\s*[!.！。]?\s*$/i,
  reset_intent: /(?:重新下单|取消重新|cancel\s*and\s*restart|改主意)/i,
};

export function extract(msg) {
  const m = String(msg || '');
  const fields = {};
  
  // direction: 优先 buy (Owner '我想卖' 也含'要')
  if (PATTERNS.direction.buy.test(m)) fields.direction = 'buy';
  else if (PATTERNS.direction.sell.test(m)) fields.direction = 'sell';
  
  const qtyM = m.match(PATTERNS.qty);
  if (qtyM) fields.qty = parseFloat(qtyM[1]);
  
  const assetM = m.match(PATTERNS.asset);
  if (assetM) fields.asset = assetM[1].toUpperCase();
  
  for (const [name, re] of Object.entries(PATTERNS.chain)) {
    if (re.test(m)) { fields.chain = name; break; }
  }
  
  const addrM = m.match(PATTERNS.pay_address);
  if (addrM) fields.pay_address = addrM[0];
  
  if (PATTERNS.price_pref.market.test(m)) fields.price_pref = 'market';
  else {
    const lim = m.match(PATTERNS.price_pref.limit);
    if (lim) fields.price_pref = `limit:${lim[1] || lim[2]}`;
  }
  
  return {
    fields,
    intent: PATTERNS.cancel.test(m) ? 'cancel'
          : PATTERNS.confirm.test(m) ? 'confirm'
          : PATTERNS.reset_intent.test(m) ? 'reset'
          : 'normal',
  };
}
```

---

## llm.js (~80 LOC) — LLM render with tools

```js
import { callLlmCore } from '../broker-llm-agent.js';  // 复用现有 LLM caller (Qwen3.6 + R11 enable_thinking=false)
import * as state from './state.js';

const SYSTEM_PROMPT = `
你是 KANet 撮合 broker, 任务是帮用户下买卖 KAS 单. 全程中文.

# 上下文铁律 (Owner 钦定)
你必记得 user 之前 N turn 给过的全 fields. 用户已说过的, 你不重问.
state authority 注入 fields, 你必 reference, 不 hallucinate "请重新提供".

# 你的任务
- 如果 state.fields 有缺, 自然语言 ask user 仅缺的 fields (不重问已给的)
- 如果用户复合 intent (确认 + 反问), 答 question 不破 confirm
- 如果用户问价格, 拒投资建议, 介绍价格因素 (现价 / spread / liquidity)
- 工具 call: 调 set_qty / set_chain / set_address 写 state (不靠你 reply 引述)

# 严禁
- 中英混杂回复, 严禁切英文
- 重问用户已给的字段 (qty/chain/addr/asset/direction)
- 自作主张帮用户决定方向 (buy or sell, 必用户 explicit)
`;

const TOOLS = [
  { type: 'function', function: { name: 'set_qty', parameters: { qty: { type: 'number' } } } },
  { type: 'function', function: { name: 'set_chain', parameters: { chain: { type: 'string', enum: ['bsc','polygon','sol','tron'] } } } },
  { type: 'function', function: { name: 'set_address', parameters: { addr: { type: 'string' } } } },
  { type: 'function', function: { name: 'set_asset', parameters: { asset: { type: 'string', enum: ['KAS','USDT','USDC'] } } } },
];

export async function render(peer, msg, stateSnapshot, profile, contact) {
  const stateLines = formatState(stateSnapshot);
  const profileLines = formatProfile(profile, contact);
  
  const sysMsg = `${SYSTEM_PROMPT}\n\n${profileLines}\n\n${stateLines}`;
  
  const result = await callLlmCore({
    system: sysMsg,
    user: msg,
    tools: TOOLS,
    chat_template_kwargs: { enable_thinking: false },  // R11
  });
  
  // tool calls 写 state
  for (const call of result.tool_calls || []) {
    const args = JSON.parse(call.function.arguments);
    if (call.function.name === 'set_qty') state.setField(peer, 'qty', args.qty);
    else if (call.function.name === 'set_chain') state.setField(peer, 'chain', args.chain);
    else if (call.function.name === 'set_address') state.setField(peer, 'pay_address', args.addr);
    else if (call.function.name === 'set_asset') state.setField(peer, 'asset', args.asset);
  }
  
  return result.text || '';
}

function formatState(s) {
  if (!s || (!s.direction && !s.qty)) return '';
  return `# 当前订单 state\n${
    [
      s.direction && `direction=${s.direction}`,
      s.qty && `qty=${s.qty}`,
      s.asset && `asset=${s.asset}`,
      s.chain && `chain=${s.chain}`,
      s.pay_address && `pay_address=${s.pay_address}`,
      s.price_pref && `price_pref=${s.price_pref}`,
    ].filter(Boolean).join('\n')
  }`;
}

function formatProfile(profile, contact) {
  if (!profile && !contact) return '';
  const lines = ['# 用户画像 (历史)'];
  if (contact?.alias) lines.push(`alias: ${contact.alias}`);
  if (contact?.classification) lines.push(`分级: ${contact.classification}`);
  if (profile?.preferred_chain) lines.push(`偏好链: ${profile.preferred_chain}`);
  if (profile?.preferred_pay_address) lines.push(`常用收款地址: ${profile.preferred_pay_address}`);
  if (profile?.distilled_summary) lines.push(`画像: ${profile.distilled_summary}`);
  return lines.join('\n');
}
```

---

## router.js (~80 LOC) — 主 path

```js
import * as state from './state.js';
import * as parser from './parser.js';
import * as llm from './llm.js';
import { sqlite } from '../../db/client.js';

export async function handleMessage(peer, msg) {
  // 1. parse fields, write state (deterministic 必中)
  const { fields, intent } = parser.extract(msg);
  for (const [name, value] of Object.entries(fields)) {
    state.setField(peer, name, value);
  }
  
  // 2. read state (post-parser write)
  const s = state.getState(peer);
  
  // 3. lifecycle decision
  
  // 3a. CANCEL — 任何 phase 都允, clear state 重来
  if (intent === 'cancel' || intent === 'reset') {
    state.clearState(peer);
    return '好的, 已取消. 你想下新单的话告诉我.';
  }
  
  // 3b. CONFIRM — 在 preview_shown 才有效
  if (intent === 'confirm' && s?.phase === 'preview_shown') {
    state.advance(peer, 'confirmed');
    const finalizeResult = state.finalize(peer);
    if (!finalizeResult.ok) return 'broker 卡了一下, 你之前说过 ' + summarize(s) + ', 继续吗?';
    return `好的, 订单已确认. ${renderOrderEcho(s)} 等待支付链上确认.`;
  }
  
  // 3c. complete + 还在 drafting → render preview, advance
  if (s?.complete && s.phase === 'drafting') {
    state.advance(peer, 'preview_shown');
    return renderPreview(s);
  }
  
  // 3d. 不完整 → LLM render asks (含 profile + state inject)
  const profile = loadProfile(peer);
  const contact = loadContact(peer);
  const reply = await llm.render(peer, msg, s, profile, contact);
  
  // 4. post-LLM check — LLM 调 tool 后 state 可能 complete, 重新 render preview
  const sAfter = state.getState(peer);
  if (sAfter?.complete && sAfter.phase === 'drafting') {
    state.advance(peer, 'preview_shown');
    return renderPreview(sAfter);  // 替 LLM reply
  }
  
  return reply || `还缺 ${listMissing(sAfter)}, 请告诉我.`;
}

function renderPreview(s) {
  return `订单画像:\n` +
    `  方向: ${s.direction === 'buy' ? '买' : '卖'} ${s.qty} ${s.asset}\n` +
    `  链: ${s.chain.toUpperCase()}\n` +
    `  ${s.direction === 'buy' ? '付款' : '收款'}地址: ${s.pay_address}\n` +
    `  价格: ${s.price_pref || '当前市价'}\n` +
    `\n回 YES 确认, NO 取消.`;
}

function renderOrderEcho(s) {
  return `${s.direction === 'buy' ? '买' : '卖'} ${s.qty} ${s.asset} via ${s.chain}.`;
}

function listMissing(s) {
  if (!s) return '订单方向 (买/卖) + 数量 + 链 + 地址';
  const m = [];
  if (!s.direction) m.push('方向 (买/卖)');
  if (!s.qty) m.push('数量');
  if (!s.asset) m.push('资产 (KAS/USDT/USDC)');
  if (!s.chain) m.push('链 (BSC/Polygon/SOL/TRON)');
  if (s.direction === 'sell' && !s.pay_address) m.push('收款地址 (EVM 0x...)');
  return m.join(' / ');
}

function summarize(s) {
  return `${s.direction || '?方向'} ${s.qty || '?数量'} ${s.asset || '?资产'} via ${s.chain || '?链'} ${s.pay_address ? `addr=${s.pay_address.slice(0,10)}...` : ''}`;
}

function loadProfile(peer) {
  return sqlite.prepare(`
    SELECT distilled_summary, preferred_chain, preferred_pay_address, tone_preference
    FROM retail_dex_user_memory WHERE user_kasia_address = ?
  `).get(peer);
}

function loadContact(peer) {
  return sqlite.prepare(`
    SELECT their_alias, classification, trust_level
    FROM relation_states WHERE peer_address = ?
  `).get(peer);
}
```

---

## 边界条件 & 已知陷阱 cover

### 1. R31 attacker 跨 peer addr swap
现有 R31 inline detectAddrChangeAttempt 逻辑保留语义但 **不 inline check** — 走 setField('pay_address', :new) SQL guard `WHERE pay_address IS NULL OR = :new`, 0 changes = 攻击拒绝, log + ignore 不外显 (Owner 铁律 #2 R33 不外显).

### 2. R33 direction 跨 turn lock
T1 'sell' → state.direction='sell'. T5 user 'buy 100' → setField('direction', 'buy') SQL guard fail → log + ignore. 复合 intent (confirm + question) 走 LLM 路径, LLM SYSTEM_PROMPT 知道 direction='sell' 不会 hallucinate flip.

### 3. R37 single system msg (Qwen Jinja)
LLM 调用层一条 system msg, llm.js 拼 SYSTEM_PROMPT + profile + state 进同一 string. 不在 messages 数组加多 system entry. 沿用现有 broker-llm-agent.js Qwen caller (R11 enable_thinking=false).

### 4. cancel-restart legitimate path
intent='reset' (ANTI-PATTERNS 已知 _RESET_INTENT_KEYWORDS) → clearState 全删 row, T2 user 新 declaration 进 fresh row. Owner 铁律 #4 state 不中断: 内部走 cancel-restart legitimate path, user-facing 不显 'R33 拦截' / '没有找到活跃订单'.

### 5. 复合 intent (Owner T4 真测撞)
'YES, 卖出价格你建议多少?' →
- parser intent=confirm (匹配 ^YES + 也匹配 cancel keyword? — NO, confirm regex 严 ^Y$/^是$ 不 match 'YES, 卖出...')
- 实际走 LLM path, LLM SYSTEM_PROMPT 知道 phase='preview_shown' + state, LLM 自然回 "市价 spread" + 不 reset preview

实测必修: parser confirm regex 严格 — 仅 reply 全文是 YES/Y/是/对/确认/好 才 confirm. 'YES, 还问 X' 不算.

### 6. 多语言 (Owner 钦定全中文)
parser 中英混 OK (regex 加 /i 兼容). LLM SYSTEM_PROMPT '全程中文' 严. det reply 全中文. 不再 _detectLang multi-language 分支.

### 7. broker-intake-watcher 链入账 → broker_drafts
现有 broker-intake-watcher.js 60s 扫 chain 入账, 4 场景路由. 新 broker:
- 入账 amount 匹配 broker_drafts.qty + phase='preview_shown' OR 'awaiting_payment' → advance phase='paid' + 触发 finalize chain action
- 入账 not match drafts → broker-intake-watcher 现有 fallback 路径 (publish offer / refund / reject)
保持 intake-watcher 不动, 仅新加分支查 broker_drafts row.

---

## 测试设计 (assertion 真严)

### regression case 全改 query_db assertion

```js
{
  action: 'send_message',
  from_peer: peer, message: '我想卖一点kas',
  expect: {
    must: {
      // 旧 string match assertion 删
      // reply_does_not_contain: ['Got it', 'R33', '内部拦截'],
      // reply_contains_one_of: ['卖', '想卖', 'sell'],
      
      // 新 query_db state assertion
      query_db: `SELECT direction FROM broker_drafts WHERE peer_address = '${peer}'`,
      expected_row: { direction: 'sell' },
    },
  },
},
{ action: 'send_message', from_peer: peer, message: '50 个',
  expect: {
    must: {
      query_db: `SELECT qty, direction FROM broker_drafts WHERE peer_address = '${peer}'`,
      expected_row: { qty: 50, direction: 'sell' },  // R33 lock 不变
    },
  },
},
{ action: 'send_message', from_peer: peer, message: 'Bsc, 0x1417cfDaD...',
  expect: {
    must: {
      query_db: `SELECT qty, direction, chain, pay_address FROM broker_drafts WHERE peer_address = '${peer}'`,
      expected_row: { qty: 50, direction: 'sell', chain: 'bsc', pay_address: '0x1417cfDaD...' },
    },
  },
},
```

新增 `expect.must.query_db` + `expected_row` runner action — 真 SQL 验证状态. lucky string match 不再可能.

### cross-process state retain

```js
{ action: 'send_message', message: '卖 50 KAS BSC 0xADDR' },
{ action: 'cleanup_peer_broker_state', peers: [peer] },  // 模拟 process restart 内存清
{ action: 'send_message', message: 'YES' },
{ expect: query_db: `SELECT phase FROM retail_dex_orders WHERE user_kasia_address='${peer}' AND state='awaiting_payment'`, expected_row_count: 1 },
```

state 在 broker_drafts 表, 跨 process 必 persist. 重启不丢.

---

## 三方分工 + ETA

| # | territory | task | ETA |
|---|-----------|------|-----|
| A | J1 | migrate v82 broker_drafts 表 + INDEX | 30min |
| B | J1 | broker-v2/state.js (~80 LOC) | 1h |
| C | J2 | broker-v2/parser.js (~60 LOC) | 1h |
| D | J2 | broker-v2/llm.js (~80 LOC) | 1.5h |
| E | NWT | broker-v2/router.js (~80 LOC) | 1.5h |
| F | NWT | feature flag wire — chat handler 入口检查 BROKER_V2_ENABLED env | 30min |
| G | NWT | regression case 全部 rewrite 用 query_db assertion (~10 case) | 2h |
| H | NWT | runner.mjs 加 query_db / expected_row action handler | 30min |
| I | 三方 | 真测 1 user → 5 user → 50 user 渐进 | 1 周 |
| J | Owner | 真 Kasia client DM 1 周真测 0 bug | 1 周 gate |
| K | 三方 | 删旧 broker (broker-llm-agent / broker-buy-handler / broker-sell-handler / broker-state-authority) | post J |

**总 8h 三方平行 ship 新 broker code + flag false**. 1 周渐进开 + 1 周 Owner 真测 gate. 全 PASS 旧 broker 删.

---

## 求 J1 + J2 真讨论 (不 cosign)

求各自 push back:
1. 设计原则 6 条有没有漏? 加 / 改 / 删?
2. 数据模型 broker_drafts schema 字段够 / 多 / 错?
3. 文件结构 4 file ~300 LOC 实操实? 太理想?
4. 主 path 流程图 lifecycle 决策点对吗?
5. parser 正则 cover 真用户 cover 95%? 漏哪些?
6. LLM tool schema 够? 加 / 删?
7. 边界 7 项 cover 全吗?
8. 测试 query_db assertion 真够严? 加哪些 trace?
9. 分工 ETA 真实? 谁加谁少?
10. 旧 broker 并行 2 周 reasonable? 真 gate criteria 加什么?

NWT 不 cosign passive, 真求 push back. ship 前 Owner 钦定真启动.

---

## 真核心 reflection

我们今晚 3h 折腾 4000 LOC, 没真修. 因为没人提议**删一半重写**. 每个人都怕动旧代码触发 regression.

新 broker ~300 LOC + 旧 broker 不动并行 — 这是真"再不重来都死"的修法.

`docs/PROPOSAL-NEW-BROKER.md` 路径作权威源. broadcast 摘要引此文件.

—— NWT 2026-04-29 草案 v1
