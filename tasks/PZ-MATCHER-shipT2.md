# Task: PZ-MATCHER-shipT2

**Version**: v1.2 (修 v1.1 4+ 处深层 Skill lifecycle / ctx / schema mismatch, J2 r125 grep + NWT r150 cross-review)
**Phase**: T2 (matcher publishOffer)
**Scope**: matcher v0.2 — 发 offer 到 /exchange + 反馈 user (extend formatForBrain + extractIntent, NO run() orchestrator)
**Owner**: J2 (implementor) → NWT (reviewer hat) → operator (system self-verify)
**ETA**: ~2-3 hr ship + 1 hr cross-review + system auto-verify
**LOC budget**: ~80 LOC (matcher ship) + ~50 LOC (test) + ~30 LOC (telemetry)

---

## v1.0 → v1.1 → v1.2 修订记录

**v1.0 → v1.1** (J2 r124 grep + NWT r148 verify, 8 处 mismatch):
- M1-M2 endpoint payload (relayNodeId required, expires_minutes)
- M4-M5 response shape (res.ok, res.broadcast_tx)
- M6 import path
- M7 file path (单 .mjs class-based)
- M8 architectural: extend formatForBrain (NOT standalone handleListen)

**v1.1 → v1.2** (J2 r125 grep + NWT r150 verify, 4+ 处深层结构 mismatch):

| # | issue | v1.1 凭印象 | v1.2 真代码 |
|---|---|---|---|
| A | Skill lifecycle entry | `run(ctx)` orchestrator | NO `run()` — registry.mjs orchestrate `gatherContext + formatForBrain` pair |
| B | Skill base methods | `run` 是 lifecycle entry | base.mjs 真 lifecycle: `canActivate / gatherContext / formatForBrain` |
| C | relayNodeId source | `ctx.relayNodeId` | `this._config.relayNodeId` (T1.5 sediment, matcher.mjs:35 `this._config = config \|\| {}`) |
| D | history shape | `{role, content}` | `{dir, text, ts}` (conversations.js:548+554, 'in' 是 dir, content_text 是 text, received_at 是 ts) |

**关键 sediment**: v1.0/v1.1 试加 orchestrator entry 偏离 Phase 1 r117 sediment "matcher 经 Brain 自然 reply 路径"。J2 grep verify catch 回正轨。

---

## 起源

Owner 5/3 钦定: **"现在一个用户都没有, 等什么？守护什么？干！唯一的路"** + **"紧扣问题, 痛点, 有针对性改进"**

T1 ship 完 (matcher 单 .mjs class-based Skill, `canActivate / gatherContext / extractIntent / formatForBrain` lifecycle, 5/2 ship)。

T2 真做的: matcher **真发 offer 到 KANet /exchange**, user 真看到 — extend `extractIntent + formatForBrain`, 走 registry.mjs orchestrate 自然路径, NO 新 entry method。

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
| 2 | offer 真上链 | DB: `chain_events` 真有 new row from Trader-M |
| 3 | matcher 真反馈 user | matcher.formatForBrain 返回含 offer_id + give/want detail + 付款指示, Brain 自然 reply 走 registry orchestrate 路径 |
| 4 | extend 不破 T1 | T1 24/24 测试仍 pass, T1 reactive reply 路径 (registry.mjs:155+160) 不变 |
| 5 | 0 私有 state | matcher class instance 0 cache / Map 持有 offer 数据 (per MATCHER §11 #1) |

5/5 全过 = T2 真 done.

---

## Out of scope (T2 严禁)

撞这些立即暂停 + broadcast architect:

1. ❌ 不 verify 跨链付款 (T3)
2. ❌ 不发 KAS (T3)
3. ❌ 不处理 dispute / refund (T4)
4. ❌ 不 cancel offer (T2 简化)
5. ❌ 不动钱 (T2 不调 sendKaspa)
6. ❌ 不持有 offer state (per §11 #1)
7. ❌ 不直 SQL UPDATE retail_dex_orders / exchange_offers
8. ❌ 不重 design Skill class lifecycle (用 T1 ship 现有 4 method)
9. ❌ **不加 run() / handle() / execute() orchestrator** (回归 r117 自然 reply 路径) ← v1.2 新加
10. ❌ **不加 reportEvent / mind-event 新机制** (T1 ship 0, T2 沿用) ← v1.2 新加

---

## 5 Subtask 顺序

| # | 名 | mode | LOC | 时长 |
|---|---|---|---|---|
| T2.0 | grep KANet API + Skill lifecycle (v1.0/v1.1 已跑, v1.2 spec 已 sediment) | implementor | 0 | (skip, J2 spot check 即可) |
| T2.1 | publishOffer method (extend Matcher class) | implementor | ~50 | 30 min |
| T2.2 | extractIntent extend (T2 加 publish trigger detection) | implementor | ~20 | 15 min |
| T2.3 | formatForBrain extend (T2 加 offer feedback) | implementor | ~30 | 20 min |
| T2.4 | 测试 + invariant assertion | QA | ~50 | 30 min |
| T2.5 | system auto-verify | operator | 0 | 10 min |

总 ETA: ~2 hr.

---

## 详细 spec

### T2.0 — Skip (v1.0/v1.1 已 grep, v1.2 spec 已 sediment 真签名 + 真 lifecycle)

J2 仍可 spot check v1.2 真代码 (~5 min):

```bash
# 1. Skill base 真 lifecycle method
grep -nE "^\s*(async )?(canActivate|gatherContext|extractIntent|formatForBrain|run|handle|execute)\s*\(" \
  /c/kanet/agent-mind/src/skills/base.mjs

# 2. registry.mjs 真 orchestrate
grep -nB 2 -A 5 "gatherContext\|formatForBrain" /c/kanet/agent-mind/src/skills/registry.mjs

# 3. T1 matcher 真 _config (T1.5 sediment)
grep -n "this._config\|this\._config" /c/kanet/agent-mind/src/skills/matcher.mjs

# 4. history schema (conversations.js)
grep -nE "dir|text|received_at" /c/kanet/kasia-console/src/api/conversations.js | head -20
```

任何 spot check 撞 v1.2 spec 不一致 → J2 立即暂停 broadcast architect。

---

### T2.1 — publishOffer method (extend Matcher class)

#### 目标

matcher 真调 KANet `/api/exchange/publish` 发 offer, **method on Matcher class**, NOT standalone export。

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (extend, NOT 新建文件)

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

const CONSOLE_URL = process.env.KASIA_CONSOLE_URL || 'http://127.0.0.1:3100';

export class Matcher extends Skill {
  // T1 ship 已有 (T2 不改):
  // - constructor(config) → this._config = config || {}    [T1.5 line 35 sediment]
  // - canActivate(ctx)
  // - gatherContext(ctx) → returns { peerHistory, intent, ... }
  // - extractIntent(peerHistory, latestMessage) → intent
  // - formatForBrain(...) → reply text

  // T2 新加 method:

  /**
   * 发布 offer 到 KANet /exchange
   * @param {Object} intent - extractIntent 输出
   * @returns {Object} { offer_id, broadcast_tx, expires_at, success }
   */
  async publishOffer(intent) {
    // 1. validate intent
    if (intent.side !== 'buy' && intent.side !== 'sell') {
      throw new Error('publishOffer: invalid intent.side');
    }
    if (!intent.qty || !intent.asset) {
      throw new Error('publishOffer: missing qty/asset');
    }

    // 2. 真 source: this._config.relayNodeId (T1.5 sediment, NOT ctx.relayNodeId)
    const relayNodeId = this._config?.relayNodeId;
    if (!relayNodeId) {
      throw new Error('publishOffer: this._config.relayNodeId missing');
    }

    // 3. 算定价 (T2 简化)
    const { give_asset, give_amount, give_chain, want_asset, want_amount, want_chain } 
      = this.computePricing(intent);

    // 4. POST /api/exchange/publish
    // ⚠ M1: relayNodeId required, maker derived server-side
    // ⚠ M2: expires_minutes (NOT expires_in_minutes)
    const payload = {
      relayNodeId,
      give_asset, give_amount, give_chain,
      want_asset, want_amount, want_chain,
      verification: 'cross_chain_tx',
      expires_minutes: 30
    };

    const res = await fetchJson(`${CONSOLE_URL}/api/exchange/publish`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // 5. 验真 publish
    // ⚠ M4: res.ok (NOT res.success)
    // ⚠ M5: res.broadcast_tx (NOT res.broadcast_tx_id)
    if (!res?.ok || !res?.offer_id) {
      throw new Error(`publishOffer: KANet rejected: ${JSON.stringify(res)}`);
    }

    // 6. telemetry
    console.log(`[matcher] publishOffer ok offer=${res.offer_id} tx=${res.broadcast_tx}`);

    return {
      offer_id: res.offer_id,
      broadcast_tx: res.broadcast_tx,
      expires_at: res.expires_at,
      payload,
      success: true
    };
  }

  computePricing(intent) {
    // T2 简化: 固定 spread 0.5%, hardcode mid_price 0.04 USDT/KAS
    if (intent.side === 'buy') {
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

#### Anti-pattern

- ❌ 不 cache offer 到 instance field (this._lastOffer / this._offers / etc) — per §11 #1
- ❌ 不直 SQL INSERT exchange_offers
- ❌ 不直接调 Relay sendKaspa
- ❌ 不 import 旧 broker 24 file
- ❌ **不读 ctx.relayNodeId** (真 source this._config.relayNodeId)

#### Acceptance

- ✅ matcher.publishOffer({...}) 真返回 { offer_id, broadcast_tx, expires_at }
- ✅ DB exchange_offers 真有新 row
- ✅ chain_events 真有 row from Trader-M
- ✅ matcher class instance 0 私有 state (publishOffer 完成后 instance 不持有 offer)
- ✅ this._config.relayNodeId 真用 (NOT ctx.relayNodeId)

#### LOC: ~50

---

### T2.2 — extractIntent extend (publish trigger detection)

#### 目标

matcher 在 extractIntent 阶段判断: user 是否同意 publish。判断结果 stash 进 intent return value, 后续 formatForBrain 读。

走 registry.mjs orchestrate 自然路径 (NO run() entry)。

#### Spec

```js
export class Matcher extends Skill {
  // T1 ship extractIntent 已有逻辑 (听懂 + return intent)
  // T2 修订: 加 should_publish 字段判断

  async extractIntent(peerHistory, latestMessage) {
    // T1 原 logic 不变 (LLM 提炼 intent)
    const intent = await this._extractIntentT1(peerHistory, latestMessage);  // T1 真 method 名 J2 grep 确认

    // T2 新加: should_publish 判断 + publishOffer 触发
    intent.should_publish = this.shouldPublish(intent, peerHistory);

    // T2 新加: 如果 should_publish 真 + 完整, 真发 offer
    if (intent.should_publish) {
      try {
        const offerResult = await this.publishOffer(intent);
        intent._offerResult = offerResult;  // stash 给 formatForBrain
      } catch (err) {
        console.error('[matcher] publishOffer failed:', err.message);
        intent._offerResult = null;
        intent._publishError = err.message;
      }
    }

    return intent;
  }

  shouldPublish(intent, peerHistory) {
    // T2 简化: intent 完整 + user 最近 5 条含 agree keywords
    if (intent.confidence !== 'high') return false;
    if (intent.side !== 'buy' && intent.side !== 'sell') return false;
    if (intent.missing_fields?.length > 0) return false;

    // ⚠ history shape 真: {dir, text, ts} (J2 r125 finding)
    const recent = peerHistory.slice(-5);
    const agreeKeywords = /\b(ok|OK|好|可以|确认|发吧|来吧|没问题)\b/i;
    return recent.some(m => 
      m.dir === 'in' && agreeKeywords.test(m.text || '')   // ← dir/text NOT role/content
    );
  }
}
```

#### ⚠ J2 必 spot check

```bash
# T1 ship extractIntent 真 method body — v1.2 spec 是 extend 不是 replace
grep -nB 2 -A 30 "async extractIntent" /c/kanet/agent-mind/src/skills/matcher.mjs
```

如果 T1 ship extractIntent 内部不能 extend (例如 T1 已有 logic 跟 v1.2 expansion 冲突) → J2 暂停 broadcast architect。

#### Anti-pattern

- ❌ 不直接 call publishOffer 在 formatForBrain (太晚, 应在 extractIntent)
- ❌ 不读 history m.role / m.content (真 m.dir / m.text)

#### Acceptance

- ✅ extractIntent 真返回 intent + should_publish + _offerResult (publish 成功时)
- ✅ extractIntent _offerResult 真 null + _publishError 真有 (publish 失败时)
- ✅ shouldPublish 用 m.dir==='in' + m.text (history 真 schema)
- ✅ T1 24/24 测试 pass (T1 _extractIntentT1 内部不变)

#### LOC: ~20

---

### T2.3 — formatForBrain extend (offer feedback)

#### 目标

matcher 真告诉 user offer 已发 + 付款指示, 走 registry.mjs:155+160 orchestrate 自然 reply 路径。

#### Spec

```js
export class Matcher extends Skill {
  // T1 ship formatForBrain 已有逻辑 (return intent + history → reply text)
  // T2 修订: 检 intent._offerResult, 不同分支

  async formatForBrain(intent, peerHistory) {
    // T2 新分支: offer 已发 → return offer feedback
    if (intent._offerResult) {
      return this.generateOfferFeedback(intent, intent._offerResult);
    }

    // T2 新分支: publish 失败 → return error feedback
    if (intent._publishError) {
      return `抱歉, 发布报价时出错了 (${intent._publishError}). 我会反馈给开发者. 你可以稍后再试.`;
    }

    // T1 原路径不变 (intent unclear / 没同意 publish 时)
    return this._formatForBrainT1(intent, peerHistory);  // T1 真 method 名 J2 grep 确认
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
        `  跨链 verify + 发 KAS 是 T3 范围.`
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

#### ⚠ J2 必 spot check

```bash
# T1 ship formatForBrain 真 method body — v1.2 spec 是 extend
grep -nB 2 -A 40 "async formatForBrain" /c/kanet/agent-mind/src/skills/matcher.mjs
```

如果 T1 ship formatForBrain 内部不能 extend OR T1 真不分 _formatForBrainT1 helper → J2 broadcast architect 重审。

#### Acceptance

- ✅ formatForBrain intent._offerResult 非 null → 返 offer feedback
- ✅ formatForBrain intent._publishError 非 null → 返 error feedback
- ✅ formatForBrain 都 null → 走 T1 原路径
- ✅ 通过 registry.mjs:155+160 orchestrate 自然 reply 路径 (NO run() / handle())

#### LOC: ~30

---

### T2.4 — 测试 + invariant assertion

#### 单元测试

```js
test('publishOffer 真用 this._config.relayNodeId (T1.5 sediment)', async () => {
  const matcher = new Matcher({ relayNodeId: 'test-uuid' });
  // mock fetch
  await matcher.publishOffer(mockIntent);
  // 验 fetch 调用真用 'test-uuid'
});

test('publishOffer 0 私有 state (§11 #1)', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  // 验 0 instance field 持 offer (this.offers / this._lastOffer / this._offerCache 等)
  const forbiddenFields = /this\.(offers|_offers|_lastOffer|_offerCache|offerMap)/;
  if (forbiddenFields.test(code)) {
    throw new Error('§11 violation: matcher instance 持 offer state');
  }
});

test('shouldPublish 用 m.dir + m.text (NOT m.role + m.content)', () => {
  const matcher = new Matcher({ relayNodeId: 'x' });
  const intent = { side: 'buy', confidence: 'high', missing_fields: [] };
  const history = [{ dir: 'in', text: '好的', ts: '2026-05-03' }];
  assert.equal(matcher.shouldPublish(intent, history), true);
});

test('formatForBrain offerResult null → T1 原路径', async () => {
  const matcher = new Matcher({ relayNodeId: 'x' });
  const reply = await matcher.formatForBrain({ /* no _offerResult */ }, []);
  // 验跟 T1 原 reply 一致
});

test('formatForBrain offerResult 非 null → offer feedback', async () => {
  const matcher = new Matcher({ relayNodeId: 'x' });
  const intent = { side: 'buy', _offerResult: mockOfferResult };
  const reply = await matcher.formatForBrain(intent, []);
  assert.ok(reply.includes('报价'));
  assert.ok(reply.includes('T2 阶段'));
});

test('extractIntent 真 wire publishOffer (intent complete + user agree)', async () => {
  // mock fetch returning ok + offer_id
  const matcher = new Matcher({ relayNodeId: 'x' });
  const history = [{ dir: 'in', text: '好的', ts: '2026-05-03' }];
  const intent = await matcher.extractIntent(history, '我要 50 USDT 买 KAS BNB');
  assert.ok(intent.should_publish);
  assert.ok(intent._offerResult);
});

test('extractIntent publish 失败时 _publishError stash', async () => {
  // mock fetch throwing
  const matcher = new Matcher({ relayNodeId: 'x' });
  const intent = await matcher.extractIntent(/* ... */);
  assert.equal(intent._offerResult, null);
  assert.ok(intent._publishError);
});
```

#### 集成测试

```js
test('matcher 真发 offer end-to-end (registry orchestrate path)', async () => {
  // 1. user DM "我要 50 USDT 买 KAS, BNB 链"
  // 2. matcher reply (T1 disclaimer)
  // 3. user DM "OK"
  // 4. registry orchestrate: gatherContext → extractIntent (含 publishOffer) → formatForBrain (offer feedback)
  // 5. 验 DB exchange_offers 真有 row
  // 6. 验 Brain 真发出 offer feedback (messages 表)
});

test('T1 24/24 测试 pass (T2 不破 T1)', () => {
  // run T1 test suite
});
```

#### LOC: ~50

---

### T2.5 — system auto-verify

```sql
-- T2 verify 1: matcher 真发 offer
SELECT id, give_asset, want_asset, maker, broadcast_at
FROM exchange_offers
WHERE maker = (SELECT address FROM relay_nodes WHERE name='Trader-M')
  AND broadcast_at > datetime('now', '-30 minutes');

-- T2 verify 2: chain_events 真上链
SELECT * FROM chain_events
WHERE sender = (SELECT address FROM relay_nodes WHERE name='Trader-M')
  AND created_at > datetime('now', '-30 minutes');

-- T2 verify 3: matcher 真 reply 含 offer detail
SELECT m.* FROM messages m
WHERE m.sender_identity_id = (SELECT id FROM identities WHERE display_name='Trader-M')
  AND m.message_type = 'text'
  AND m.content LIKE '%报价%T2%'
  AND m.created_at > datetime('now', '-30 minutes');

-- T2 verify 4: T1 24/24 仍 pass (run test suite)

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
- ❌ 不 import 旧 broker 文件
- ❌ 不持有 offer 私有 state
- ❌ 不直 SQL UPDATE retail_dex_orders / exchange_offers
- ❌ 不 verify / 发 KAS / 处理 dispute (T2 严限 publish)
- ❌ 不重 design Skill class lifecycle (用 T1 ship 现有)
- ❌ **不加 run() / handle() / execute() 新 entry method** (回归 r117 自然 reply 路径)
- ❌ **不加 reportEvent / mind-event 新机制** (T1 ship 0, T2 沿用)
- ❌ **不读 ctx.relayNodeId** (真 source this._config.relayNodeId)
- ❌ **不读 history m.role / m.content** (真 m.dir / m.text)

---

## RFC ref

Owner 5/3 钦定 + KI-17 + INVARIANTS v0.1 §1.2 (specific facts) + MATCHER-ARCHITECTURE v0.1 §9 + r109 (single .mjs class-based) + r117 (formatForBrain Brain reply 路径) + r124 (T2.0 grep 8 mismatch v1.0→v1.1) + r148 (NWT cross-review v1.1) + r125 (T2.0 spot check 4+ mismatch v1.1→v1.2) + r150 (NWT cross-review v1.2).

---

## INVARIANTS §1.2 sediment urgency 二次升级

v1.0 → v1.1: 8 处 mismatch (浅层 endpoint/payload/file/import)
v1.1 → v1.2: 4+ 处 mismatch (深层 Skill lifecycle / ctx 模型 / schema field names)

**INVARIANTS §1.2 surface area v0.2 候选扩**:
- API signature (v0.1 已含)
- Class lifecycle structure (v0.2 新加, T2 v1.1 撞)
- Schema shape / object field names (v0.2 新加, T2 v1.2 撞)
- Config / state 真 source (v0.2 新加, T2 v1.2 撞 ctx vs this._config)

**v0.2 触发条件 #2** (任何 KI 复刻 ≥2 次) **真满**:
- KI-2/3/4/5 → T2 v1.0/v1.1 复刻 = 2 次

INVARIANTS v0.2 起草 trigger 真到 (Phase 1 close + Phase 2 第一 ship 后)。

---

## 接位 SOP (J2 接此任务 v1.2)

1. ❌ 不重跑 T2.0 完整 grep (v1.0/v1.1 已跑)
2. **必** spot check v1.2 spec 真代码 (~5 min):
   - Skill base.mjs 真 lifecycle methods (canActivate/gatherContext/formatForBrain, NO run)
   - registry.mjs orchestrate gatherContext+formatForBrain pair
   - matcher.mjs T1 真 _config / extractIntent / formatForBrain method bodies (能 extend?)
   - history schema (m.dir / m.text)
3. spot check 撞 unknown → broadcast architect, 不擅自实施
4. 直接进 T2.1
5. 每 subtask commit broadcast 触发器 → NWT reviewer hat 审
6. 撞 Definition of NOT Done 立即暂停

---

## Definition of NOT Done

撞这些立即暂停:

1. T1 ship matcher.mjs 真 lifecycle method 跟 v1.2 spec 任 1 处不一致 → broadcast architect (KI-2/3/4/5 sediment 第 3 轮)
2. T1 extractIntent / formatForBrain 内部不能 extend (T1 hardcoded 死 logic 不留 hook) → broadcast architect (架构改动大)
3. registry.mjs:155+160 真 orchestrate path 跟 J2 r125 finding 不一致 → broadcast architect 重审
4. publishOffer endpoint 真签名仍跟 v1.2 spec 不一致 (rare) → broadcast architect
5. T1 24/24 测试任 1 fail → revert + 重审 T2 extend 逻辑
6. 集成测试 exchange_offers 真有 row 但 chain_events 0 → KANet publish endpoint bug, broadcast architect

---

*v1.2 — 2026-05-03 Architect mode (claude.ai). 修 v1.1 4+ 处深层 Skill lifecycle / ctx / schema mismatch. 回归 Phase 1 r117 sediment "matcher 经 Brain 自然 reply 路径".*

*v1.0 → v1.1 → v1.2 sediment: KI-2/3/4/5 防复刻硬纪律真起作用 — Phase 1 期间 4 处 mismatch, T2 v1.0 复刻 8 处 (浅层), T2 v1.1 复刻 4+ 处 (深层). INVARIANTS §1.2 v0.2 触发条件 #2 真满, 必扩 surface area: API signature + Class lifecycle structure + Schema shape + Config 真 source.*

*Owner 5/3 钦定: "干, 唯一的路". J2 ship + NWT cross-review.*
