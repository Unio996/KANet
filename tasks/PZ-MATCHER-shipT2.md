# Task: PZ-MATCHER-shipT2

**Version**: v1.1 (修 v1.0 8 处 KANet API mismatch, J2 r124 grep + NWT r148 cross-review confirm)
**Phase**: T2 (matcher publishOffer)
**Scope**: matcher v0.2 — 发 offer 到 /exchange + 反馈 user (extend formatForBrain)
**Owner**: J2 (implementor) → NWT (reviewer hat) → operator (system self-verify)
**ETA**: ~2-3 hr ship + 1 hr cross-review + system auto-verify
**LOC budget**: ~80 LOC (matcher ship) + ~50 LOC (test) + ~30 LOC (telemetry)

---

## v1.0 → v1.1 修订记录

8 处 KANet API mismatch (J2 T2.0 grep + NWT spot check verify):

| # | 修 | 真因 |
|---|---|---|
| M1 | payload 加 `relayNodeId` (required), drop `maker` | endpoint 从 relay_nodes 表 derive maker |
| M2 | rename `expires_in_minutes` → `expires_minutes` | 真字段名 |
| M3 | (无修, verification field OK) | spot check ✓ |
| M4 | response 检 `res?.ok` 不是 `res?.success` | 真返回字段 |
| M5 | response 用 `broadcast_tx` 不是 `broadcast_tx_id` | 真返回字段 |
| M6 | import 改 `'../utils.mjs'` | T1 ship 真 location |
| M7 | 文件路径改 `agent-mind/src/skills/matcher.mjs` 单 .mjs class-based | T1 ship 真结构 (per r109) |
| M8 | architect verdict: extend Skill class formatForBrain (NOT standalone handleListen) | 跟 T1 r117 一致, 0 架构改动 |

---

## 起源

Owner 5/3 钦定: **"现在一个用户都没有, 等什么？守护什么？干！唯一的路"** + **"紧扣问题, 痛点, 有针对性改进"** — 不完美没关系, broker 尽快跑通。

T1 ship 完 (matcher 单 .mjs class-based Skill, gatherContext + extractIntent + formatForBrain lifecycle, 5/2 ship)。

T2 真做的: matcher **真发 offer 到 KANet /exchange**, user 真看到 — extend Skill class formatForBrain 加 publish + feedback。

---

## T2 真目标 (Owner 钦定 broker 三层应用)

### 真核心: 让 user **真知道 matcher 在干什么**

按 KI-17 (Owner 5/3 钦定):
1. **识别** (T1 done) - matcher 听懂
2. **精准对接 KANet** (T2 范围) - 调 POST /api/exchange/publish, 0 私有 state
3. **反馈关键节点信息** (T2 范围) - user 真收到 offer detail + 付款指示

### Acceptance (system auto-verify, KI-8 守)

| # | check | metric |
|---|---|---|
| 1 | matcher 真发 offer | DB: `exchange_offers` 真有新 row, `maker = Trader-M kaspa addr` |
| 2 | offer 真上链 | DB: `chain_events` 真有 new row from Trader-M, content 含 `kanet_exchange_v1` |
| 3 | matcher 真反馈 user | DB: `messages.message_type = 'text'` from Trader-M to user, 含 offer_id + give/want detail + 付款指示 |
| 4 | extend formatForBrain 不破 T1 | T1 24/24 测试仍 pass, T1 reactive reply 路径不变 |
| 5 | 0 私有 state | matcher 进程内 0 cache / Map 持有 offer 数据 (per MATCHER-ARCHITECTURE §11 #1) |

5/5 全过 = T2 真 done.

---

## Out of scope (T2 严禁)

撞这些立即暂停 + broadcast architect:

1. ❌ 不 verify 跨链付款 (T3 范围)
2. ❌ 不发 KAS (T3 范围)
3. ❌ 不处理 dispute / refund (T4 范围)
4. ❌ 不 cancel offer (T2 简化)
5. ❌ 不动钱 (matcher T2 不调 sendKaspa)
6. ❌ 不持有 offer state (per MATCHER §11 #1)
7. ❌ 不直 SQL UPDATE retail_dex_orders / exchange_offers (用 KANet endpoint)
8. ❌ 不重 design Skill class lifecycle (用 T1 ship 现有 gatherContext + extractIntent + formatForBrain)

---

## 5 Subtask 顺序

| # | 名 | mode | LOC | 时长 |
|---|---|---|---|---|
| T2.0 | grep KANet API 真签名 (v1.0 已跑, v1.1 直接进 T2.1) | implementor | 0 | (skip) |
| T2.1 | publishOffer 函数 (extend matcher.mjs) | implementor | ~50 | 30 min |
| T2.2 | offer feedback 生成 (extend formatForBrain) | implementor | ~30 | 20 min |
| T2.3 | matcher.mjs Skill class 装配 | implementor | ~20 | 15 min |
| T2.4 | 测试 + invariant assertion | QA | ~50 | 30 min |
| T2.5 | system auto-verify | operator | 0 | 10 min |

总 ETA: ~2 hr.

---

## 详细 spec

### T2.0 — grep KANet API 真签名 [v1.0 已跑, J2 r124 broadcast 8 mismatch + NWT r148 verify]

v1.1 跳此 step, 直接 T2.1 (因为 v1.1 spec 已含 grep verify 后真签名)。

但 J2 实施时**仍可二次 grep verify** — 任何 v1.1 spec 跟 T1 ship 真代码不一致, 立即暂停 broadcast。

---

### T2.1 — publishOffer 函数 (extend matcher.mjs)

#### 目标

matcher 真调 KANet `/api/exchange/publish` 发 offer。

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (extend, NOT 新建文件)
// T1 ship 已 export class Matcher extends Skill, T2 加 method

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';   // ← M6 修: '../utils.mjs', NOT '../../shared/http.mjs'

const CONSOLE_URL = process.env.KASIA_CONSOLE_URL || 'http://127.0.0.1:3100';

export class Matcher extends Skill {
  // T1 ship 已有 methods: canActivate / gatherContext / extractIntent / formatForBrain
  
  // T2 新加 method:
  
  /**
   * 发布 offer 到 KANet /exchange
   * @param {Object} intent - extractIntent 输出
   * @param {string} relayNodeId - Trader-M relay node id (M1: required by endpoint)
   * @returns {Object} { offer_id, broadcast_tx, expires_at, success }
   */
  async publishOffer(intent, relayNodeId) {
    // 1. validate intent
    if (intent.side !== 'buy' && intent.side !== 'sell') {
      throw new Error('publishOffer: invalid intent.side');
    }
    if (!intent.qty || !intent.asset) {
      throw new Error('publishOffer: missing qty/asset');
    }

    // 2. 算定价 (T2 简化, T3 加 mid_price 来源 market-data)
    const { give_asset, give_amount, give_chain, want_asset, want_amount, want_chain } 
      = this.computePricing(intent);

    // 3. 调 POST /api/exchange/publish
    // ⚠ M1: relayNodeId required, maker derived server-side
    // ⚠ M2: expires_minutes (NOT expires_in_minutes)
    const payload = {
      relayNodeId,                  // ← M1: required, NOT `maker`
      give_asset,
      give_amount,
      give_chain,
      want_asset,
      want_amount,
      want_chain,
      verification: 'cross_chain_tx',
      expires_minutes: 30           // ← M2: 真字段名
    };

    const res = await fetchJson(`${CONSOLE_URL}/api/exchange/publish`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // 4. 验真 publish 成功
    // ⚠ M4: res.ok (NOT res.success)
    // ⚠ M5: res.broadcast_tx (NOT res.broadcast_tx_id)
    if (!res?.ok || !res?.offer_id) {
      throw new Error(`publishOffer: KANet rejected: ${JSON.stringify(res)}`);
    }

    // 5. telemetry
    console.log(`[matcher] publishOffer step 1 publish-api ok offer=${res.offer_id} tx=${res.broadcast_tx}`);

    return {
      offer_id: res.offer_id,
      broadcast_tx: res.broadcast_tx,    // ← M5
      expires_at: res.expires_at,
      payload,
      success: true                      // matcher 内部 flag, 不来自 KANet
    };
  }

  computePricing(intent) {
    // T2 简化: 固定 spread 0.5%, hardcode mid_price
    // T3 加 mid_price 来源 market-data.js + dynamic spread
    if (intent.side === 'buy') {
      // user 用 USDT 买 KAS
      const usdt_amount = intent.qty;
      const kas_per_usdt = 1 / 0.04;
      const kas_amount = usdt_amount * kas_per_usdt * (1 - 0.005);
      return {
        give_asset: 'KAS',
        give_amount: String(kas_amount.toFixed(2)),
        give_chain: 'kaspa',
        want_asset: 'USDT',
        want_amount: String(usdt_amount),
        want_chain: intent.pay_chain || 'BSC'
      };
    } else {
      // user 卖 KAS 换 USDT
      const kas_amount = intent.qty;
      const usdt_amount = kas_amount * 0.04 * (1 - 0.005);
      return {
        give_asset: 'USDT',
        give_amount: String(usdt_amount.toFixed(4)),
        give_chain: intent.pay_chain || 'BSC',
        want_asset: 'KAS',
        want_amount: String(kas_amount),
        want_chain: 'kaspa'
      };
    }
  }
}
```

#### Anti-pattern (J2 撞这些立即暂停)

- ❌ 不 cache offer 到 module-level / class instance field (per MATCHER §11 #1)
- ❌ 不直 SQL INSERT exchange_offers (用 endpoint)
- ❌ 不直接调 Relay sendKaspa
- ❌ 不 import 旧 broker 文件 (broker-buy-handler 等 24 file)

#### Acceptance

- ✅ Matcher.publishOffer({...}, 'relay-uuid') 真返回 { offer_id, broadcast_tx, expires_at }
- ✅ DB exchange_offers 真有新 row, maker = Trader-M kasia 地址 (server-side derived)
- ✅ chain_events 真有 row from Trader-M
- ✅ matcher class instance 0 私有 state (publishOffer 完成后 instance 不持有 offer 引用)

#### LOC: ~50

---

### T2.2 — offer feedback 生成 (extend formatForBrain)

#### 目标

matcher 真告诉 user offer 已发 + 付款指示, 走 T1 ship Skill class formatForBrain 自然路径 (per Phase 1 r117 verdict)。

#### M8 架构师 verdict (i): extend formatForBrain

**理由**: T1 ship Skill class lifecycle 已是 `canActivate / gatherContext / extractIntent / formatForBrain` — Brain reactive reply 自然路径。T2 加 offer feedback **进 formatForBrain return**, 不破 T1 lifecycle。

NOT (ii) standalone handleListen — 那是新 wiring 跟 T1 lifecycle 冲突, 架构调整大。

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (extend formatForBrain)

export class Matcher extends Skill {
  // T1 ship 已有 formatForBrain(intent, peerContext)
  // T2 修订: 新增 offerResult 参数 + 反馈生成

  async formatForBrain(intent, peerContext, offerResult = null) {
    // T2 新分支: 如果 offer 已发, 返回 offer feedback
    if (offerResult) {
      return this.generateOfferFeedback(intent, offerResult);
    }
    
    // T1 原路径不变 (intent unclear / 没同意 publish 时 走 T1 reply)
    return this.generateT1Reply(intent, peerContext);  // T1 ship 已有逻辑
  }

  generateOfferFeedback(intent, offerResult) {
    const { offer_id, payload, expires_at } = offerResult;
    const offer_short = offer_id.slice(-8);

    if (intent.side === 'buy') {
      return [
        `好的, 我已经为你发布报价 #${offer_short}.`,
        ``,
        `📋 报价详情:`,
        `  - 你付: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
        `  - 你收: ${payload.give_amount} ${payload.give_asset}`,
        `  - 有效期: 30 分钟`,
        ``,
        `💸 下一步:`,
        `  请向 broker 钱包付款 (具体地址 KANet 给出).`,
        `  付款后 matcher 自动 verify 跨链确认.`,
        ``,
        `⚠️ T2 阶段 — offer 已发布上链.`,
        `  跨链 verify + 发 KAS 是 T3 范围 (即将上线).`,
        `  当前请等 T3 ship 完后真完成交易.`
      ].join('\n');
    } else {
      // sell
      return [
        `好的, 我已经为你发布卖单 #${offer_short}.`,
        ``,
        `📋 报价详情:`,
        `  - 你付: ${payload.give_amount} KAS`,
        `  - 你收: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
        `  - 有效期: 30 分钟`,
        ``,
        `⚠️ T2 阶段 — 卖单已上链, 完整交割 T3 范围.`
      ].join('\n');
    }
  }
}
```

#### Acceptance

- ✅ formatForBrain(intent, peerContext, offerResult) 真返回 offer feedback (offerResult 非 null 时)
- ✅ formatForBrain(intent, peerContext, null) 真返回 T1 原 reply (offerResult null 时)
- ✅ feedback 含 offer_id 后 8 位 + give/want detail + T2 disclaimer
- ✅ 通过 Skill class formatForBrain 自然路径返回 Brain reactive reply (不直接调 Action Executor)

#### LOC: ~30

---

### T2.3 — matcher.mjs Skill class 装配

#### 目标

把 T2.1 publishOffer 调用 wire 进 Skill class lifecycle。

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (Skill class lifecycle)

export class Matcher extends Skill {
  // T1 ship 已有 method (T2 不改):
  // - canActivate(ctx) → bool
  // - gatherContext(ctx) → peerContext (复用 T1)
  // - extractIntent(peerContext, latestMessage) → intent (T1 已有)
  // - formatForBrain(intent, peerContext, offerResult?) → reply text (T2 扩展)

  // T2 新加: orchestration logic 进 Skill 主入口 (T1 真 entry, J2 grep 验证 T1 真 entry method 名)

  async run(ctx) {
    // T1 ship 真 entry method 在 base.mjs Skill class 定义
    // J2 必 grep base.mjs Skill 真 entry name (run / handle / execute / 等)
    // 如果 entry name 跟此 spec 不一致, 立即 broadcast architect 修

    const peerContext = await this.gatherContext(ctx);
    const intent = await this.extractIntent(peerContext, ctx.latestMessage);

    // T2 新增: 如果 intent 完整且 user 同意 publish, 真发 offer
    let offerResult = null;
    if (this.shouldPublish(intent, peerContext)) {
      try {
        offerResult = await this.publishOffer(intent, ctx.relayNodeId);
        // ⚠ ctx.relayNodeId 必由 Mind 层注入 (J2 grep T1 ship 真 ctx 字段)
        // 如不存在, 立即 broadcast architect — 不擅自 derive relayNodeId
      } catch (err) {
        console.error('[matcher] publishOffer failed:', err.message);
        offerResult = null;  // fallback to T1 reply
      }
    }

    // formatForBrain 返回 Brain reactive reply (不破 T1 lifecycle)
    const replyText = await this.formatForBrain(intent, peerContext, offerResult);

    // 上报 mind-event (T1 ship 已有路径)
    await this.reportEvent({
      skill: 'matcher',
      type: offerResult ? 'offer_published' : 'listen_complete',
      peer: ctx.peerAddress,
      intent_side: intent.side,
      offer_id: offerResult?.offer_id
    });

    // 返回 Brain reply (T1 ship 真 return shape, J2 grep 验)
    return replyText;
  }

  shouldPublish(intent, peerContext) {
    // T2 简化: intent 完整 + user 最近 5 条含 agree keywords
    if (intent.confidence !== 'high') return false;
    if (intent.side !== 'buy' && intent.side !== 'sell') return false;
    if (intent.missing_fields?.length > 0) return false;
    
    const recent = peerContext.history.slice(-5);
    const agreeKeywords = /\b(ok|OK|好|可以|确认|发吧|来吧|没问题)\b/i;
    return recent.some(m => 
      m.role === 'user' && agreeKeywords.test(m.content || '')
    );
  }
}
```

#### ⚠ J2 必 grep verify (M8 架构调整后必检 2 处)

```bash
# 1. T1 ship Matcher class 真 entry method 名
grep -nE "async (run|handle|execute|process|invoke)\s*\(" /c/kanet/agent-mind/src/skills/matcher.mjs | head -10

# 2. T1 ship Skill base class 真 entry signature  
grep -nA 5 "class Skill" /c/kanet/agent-mind/src/skills/base.mjs | head -30

# 3. T1 真 ctx 字段 (是否有 relayNodeId)
grep -nB 2 -A 10 "ctx\." /c/kanet/agent-mind/src/skills/matcher.mjs | head -40
```

如果 entry name 不是 `run` / ctx 不含 `relayNodeId` / Skill base 不支持此 lifecycle —— **J2 立即 broadcast architect, 不擅自创**。

#### Acceptance

- ✅ run(ctx) 真完整跑 5 步 (gatherContext → extractIntent → shouldPublish → publishOffer? → formatForBrain)
- ✅ shouldPublish 真 false 时不 publish (intent unclear / 没同意)
- ✅ shouldPublish 真 true 时调 publishOffer + formatForBrain 返 offer feedback
- ✅ publishOffer 失败时 fallback to T1 reply (不 crash)
- ✅ T1 24/24 测试全 pass (T2 不破 T1 行为)

#### LOC: ~20

---

### T2.4 — 测试 + invariant assertion

#### 单元测试

```js
// kasia-console/test-framework/cases/matcher/T2/publishOffer.test.mjs

test('publishOffer 真调 /api/exchange/publish endpoint', async () => {
  // mock fetch, 验 payload 含 relayNodeId (M1) + expires_minutes (M2)
  // 验 NO `maker` 字段 (M1 server-side derive)
});

test('publishOffer 真处理 res.ok response (M4)', async () => {
  // mock res = { ok: true, offer_id: 'x', broadcast_tx: 'y', expires_at: 'z' }
  // 验 publishOffer 返回不 throw
});

test('publishOffer 0 私有 state (matcher §11 #1)', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  // 验 0 module-level Map / Object 持 offer
  // 验 0 instance field 持 offer (this.offers / this._offers / etc)
});

test('publishOffer 不直 SQL INSERT exchange_offers', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  if (/INSERT\s+INTO\s+exchange_offers/i.test(code)) {
    throw new Error('matcher §11 violation');
  }
});

test('formatForBrain offerResult null → T1 reply 不变', async () => {
  const matcher = new Matcher();
  const reply = await matcher.formatForBrain(mockIntent, mockCtx, null);
  // 验 reply 跟 T1 ship 期望一致
});

test('formatForBrain offerResult 非 null → offer feedback', async () => {
  const matcher = new Matcher();
  const reply = await matcher.formatForBrain(mockIntent, mockCtx, mockOfferResult);
  assert.ok(reply.includes('报价'));
  assert.ok(reply.includes('T2 阶段'));
});

test('shouldPublish intent unclear 真 false', () => {
  const matcher = new Matcher();
  const intent = { side: 'buy', confidence: 'low', missing_fields: ['qty'] };
  assert.equal(matcher.shouldPublish(intent, mockPeerContext), false);
});

test('shouldPublish intent complete + user agreed 真 true', () => {
  const matcher = new Matcher();
  const intent = { side: 'buy', confidence: 'high', missing_fields: [] };
  const peerContext = { history: [{ role: 'user', content: '好的, 发吧' }] };
  assert.equal(matcher.shouldPublish(intent, peerContext), true);
});
```

#### 集成测试

```js
test('matcher 真发 offer (intent complete + user agree)', async () => {
  // 1. user DM "我要 50 USDT 买 KAS, BNB 链"
  // 2. matcher reply with intent confirm
  // 3. user DM "OK"
  // 4. matcher 真 publishOffer
  // 5. 验 DB exchange_offers 真有新 row, maker = Trader-M
});

test('matcher 真不动 KAS (T2 anti-pattern)', async () => {
  // 跑 5 个 publish, 验 Trader-M 钱包余额无变化
});

test('T1 24/24 仍 pass (T2 不破 T1)', () => {
  // run T1 test suite
});
```

#### Invariant assertion

- 5 acceptance metrics 自动 cron verify

#### LOC: ~50

---

### T2.5 — system auto-verify

operator hat 跑 verify SQL:

```sql
-- T2 verify 1: matcher 真发 offer
SELECT id, give_asset, want_asset, maker, broadcast_at
FROM exchange_offers
WHERE maker = (SELECT address FROM relay_nodes WHERE name='Trader-M')
  AND broadcast_at > datetime('now', '-30 minutes');
-- 期望: ≥1 row

-- T2 verify 2: chain_events 真上链
SELECT * FROM chain_events
WHERE sender = (SELECT address FROM relay_nodes WHERE name='Trader-M')
  AND created_at > datetime('now', '-30 minutes');
-- 期望: ≥1 row

-- T2 verify 3: matcher 真反馈 user
SELECT m.* FROM messages m
WHERE m.sender_identity_id = (SELECT id FROM identities WHERE display_name='Trader-M')
  AND m.message_type = 'text'
  AND m.content LIKE '%报价%T2%'
  AND m.created_at > datetime('now', '-30 minutes');
-- 期望: ≥1 row 含 T2 disclaimer

-- T2 verify 4: T1 24/24 仍 pass
-- (跑 test suite)

-- T2 verify 5: matcher 不动 KAS
SELECT COALESCE(SUM(amount_kas), 0) FROM tx_records
WHERE sender_address = (SELECT address FROM relay_nodes WHERE name='Trader-M')
  AND created_at > datetime('now', '-30 minutes');
-- 期望: 0
```

5/5 全过 → T2 close.

---

## Anti-pattern (per Owner 钦定)

- ❌ 不让 Owner 当 verify 工具 (KI-8 v2)
- ❌ 不 import 旧 broker 文件 (并行真相源反模式)
- ❌ 不持有 offer 私有 state (MATCHER §11 #1)
- ❌ 不直 SQL UPDATE retail_dex_orders / exchange_offers
- ❌ 不 verify / 发 KAS / 处理 dispute (T2 严限 publish only)
- ❌ 不重 design Skill class lifecycle (用 T1 ship 现有)

---

## RFC ref

Owner 5/3 钦定 + KI-17 + INVARIANTS v0.1 §1.2 + MATCHER-ARCHITECTURE v0.1 §9 + r109 (single .mjs class-based) + r117 (formatForBrain Brain reply 路径) + J2 r124 (T2.0 grep 8 mismatch) + NWT r148 (cross-review confirm).

---

## 接位 SOP (J2 接此任务 v1.1)

1. ❌ 不重跑 T2.0 grep (v1.0 已跑 + v1.1 spec 已 sediment 真签名)
2. **但** J2 可 spot check v1.1 spec line 113-115 (M6/M7 file path / import) + line 217-227 (M8 entry method grep)
3. spot check 撞 unknown → broadcast architect
4. 直接进 T2.1 实施
5. 每 subtask commit broadcast 触发器 → NWT reviewer hat 审
6. 撞 Definition of NOT Done 立即暂停

---

## Definition of NOT Done

撞这些立即暂停:

1. M8 entry method 名实际不是 `run` → broadcast architect 决新 spec
2. ctx 真不含 `relayNodeId` → broadcast architect 决 (Mind 层加 inject OR matcher 别处 derive)
3. Skill base class 不支持此 lifecycle pattern → broadcast architect 大重审
4. publishOffer 撞 endpoint 真签名仍跟 v1.1 spec 不一致 (rare, v1.0 已 grep) → broadcast architect
5. T1 24/24 测试任 1 fail → revert + 重审 T2 分支逻辑
6. 集成测试 exchange_offers 真有 row 但 chain_events 0 → KANet publish endpoint bug, broadcast architect

---

*v1.1 — 2026-05-03 Architect mode (claude.ai). v1.0 8 处 KANet API mismatch 修订完整.*

*v1.0 → v1.1 关键 sediment: KI-2/3/4/5 防复刻硬纪律 (T2.0 grep first) 真起作用 — Phase 1 期间 4 处 mismatch, T2 v1.0 复刻 8 处. INVARIANTS §1.2 specific facts 实证 sediment urgency 升级.*

*Owner 5/3 钦定: "干, 唯一的路". J2 ship + NWT cross-review.*
