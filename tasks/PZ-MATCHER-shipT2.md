# Task: PZ-MATCHER-shipT2

**Version**: v1.0
**Phase**: T2 (matcher publishOffer)
**Scope**: matcher v0.2 — 发 offer 到 /exchange + 反馈 user
**Owner**: J2 (implementor) → NWT (reviewer hat) → operator (system self-verify)
**ETA**: ~2-3 hr ship + 1 hr cross-review + system auto-verify
**LOC budget**: ~80 LOC (matcher ship) + ~50 LOC (test) + ~30 LOC (telemetry)

---

## 起源

Owner 5/3 钦定: **"现在一个用户都没有, 等什么？守护什么？干！唯一的路"** — 不完美没关系, broker 尽快跑通。

T1 ship 完 (matcher 听懂 + intent extract + 跟 user 对话, 5/2 ship)。
Phase 1 监控期 12h 在跑 (5/3 13:00 UTC = 20:00 Bangkok 晚上 close, 但**不阻 T2 ship**).

T2 真做的: matcher **真发 offer 到 KANet /exchange**, user 真看到, 不只是听懂。

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
| 2 | offer 真上链 | DB: `chain_events.event_type = 'comm_sent'` from Trader-M, content 含 `kanet_exchange_v1` |
| 3 | matcher 真反馈 user | DB: `messages.message_type = 'text'` from Trader-M to user, 含 offer_id + give/want detail + 付款指示 |
| 4 | retail_dex_orders state correct | `state = 'aligning'` 或 `'awaiting_payment'`, 不直 SQL UPDATE (用 transition()) |
| 5 | 0 私有 state | matcher 进程内 0 cache / Map 持有 offer 数据 (per MATCHER-ARCHITECTURE §11 #1) |

5/5 全过 = T2 真 done.

---

## Out of scope (T2 严禁)

撞这些立即暂停 + broadcast architect:

1. ❌ 不 verify 跨链付款 (T3 范围)
2. ❌ 不发 KAS (T3 范围)
3. ❌ 不处理 dispute / refund (T4 范围)
4. ❌ 不 cancel offer (T2 不范围, 简化)
5. ❌ 不动钱 (matcher T2 不调 sendKaspa)
6. ❌ 不持有 offer state (per MATCHER §11 #1, 0 私有)
7. ❌ 不直 SQL UPDATE retail_dex_orders (用 transition() helper)

---

## 5 Subtask 顺序

| # | 名 | mode | LOC | 时长 |
|---|---|---|---|---|
| T2.0 | grep 现有 KANet API 真签名 | implementor | 0 | 15 min |
| T2.1 | publishOffer 函数实现 | implementor | ~50 | 30 min |
| T2.2 | 反馈生成 (KI-17 layer 3) | implementor | ~30 | 20 min |
| T2.3 | matcher executor.mjs 装配 | implementor | ~20 | 15 min |
| T2.4 | 测试 + invariant assertion | QA | ~50 | 30 min |
| T2.5 | system auto-verify | operator | 0 | 10 min |

总 ETA: ~2 hr.

---

## 详细 spec

### T2.0 — grep KANet API 真签名 (KI-2/3/4/5 防 rule)

**硬纪律, 不可跳过**。Phase 1 KI-2/3/4/5 真因: architect 凭印象 spec, J2 grep 真代码发现不一致。T2 必先 grep。

#### Action

```bash
cd /c/kanet

# 1. /api/exchange/publish 真 endpoint signature
grep -n "exchange/publish" kasia-console/src/api/exchange.js | head -20

# 2. publishOffer 真期望 payload 字段
grep -nA 30 "publish.*async\|/publish" kasia-console/src/api/exchange.js | head -50

# 3. exchange_offers 真 schema (含 maker / give / want / verification 字段)
grep -nA 30 "CREATE TABLE.*exchange_offers\|exchange_offers" kasia-console/src/db/migrate.js | head -50

# 4. transition() helper 真 signature
grep -nA 10 "function transition\|transition.*function" kasia-console/src/services/broker-state-machine.js | head -30

# 5. matcher 当前 import 真路径 (T1 ship)
grep -n "import\|require" agent-mind/src/skills/matcher/executor.mjs | head -20
```

#### 报告 (broadcast 含)

每条 grep 真结果列:
- file:line 真 endpoint / function / table schema
- 真 expected fields (publish payload / transition opts / message structure)
- 跟此任务卡 spec 比对 (一致 / 部分一致 / 不一致)

撞 ⚠/❌ → broadcast architect 决策, 不擅自实施。

#### Verdict

- ✅ `api_verified` → T2.1 进
- ⚠ `partial_mismatch` → architect 修任务卡 spec
- ❌ `major_mismatch` → 暂停, architect 重审

---

### T2.1 — publishOffer 函数实现

#### 目标

matcher 真调 KANet `/api/exchange/publish` 发 offer, 不自建 publish 逻辑。

#### Spec

```js
// agent-mind/src/skills/matcher/executor.mjs

import { fetchJson } from '../../shared/http.mjs'; // T1 已有 import

const CONSOLE_URL = process.env.KASIA_CONSOLE_URL || 'http://127.0.0.1:3100';

/**
 * 发布 offer 到 KANet /exchange
 * @param {Object} intent - T1 extractIntent 输出
 * @param {string} myMatcherAddress - Trader-M kasia 地址 (multi-instance ready, per MATCHER §6)
 * @returns {Object} { offer_id, broadcast_tx_id, success }
 */
export async function publishOffer(intent, myMatcherAddress) {
  // 1. validate intent (T1 输出对接)
  if (intent.side !== 'buy' && intent.side !== 'sell') {
    throw new Error('publishOffer: invalid intent.side');
  }
  if (!intent.qty || !intent.asset) {
    throw new Error('publishOffer: missing qty/asset');
  }

  // 2. 算定价 (T2 阶段固定 spread, T3 加 mid_price + dynamic spread)
  const { give_asset, give_amount, want_asset, want_amount } = computePricing(intent);

  // 3. 调 POST /api/exchange/publish (KANet 现有 endpoint)
  const payload = {
    give_asset,
    give_amount,
    give_chain: intent.side === 'sell' ? 'kaspa' : intent.pay_chain,
    want_asset,
    want_amount,
    want_chain: intent.side === 'buy' ? 'kaspa' : intent.pay_chain,
    maker: myMatcherAddress,
    verification: 'cross_chain_tx',
    expires_in_minutes: 30
  };

  const res = await fetchJson(`${CONSOLE_URL}/api/exchange/publish`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // 4. 验真 publish 成功
  if (!res?.success || !res?.offer_id) {
    throw new Error(`publishOffer: KANet rejected publish: ${JSON.stringify(res)}`);
  }

  // 5. telemetry (T1 pattern 复用)
  console.log(`[matcher] publishOffer step 1 publish-api ok offer=${res.offer_id}`);

  return {
    offer_id: res.offer_id,
    broadcast_tx_id: res.broadcast_tx_id,
    payload,
    success: true
  };
}

function computePricing(intent) {
  // T2 简化: 固定 spread 0.5%
  // T3 加 mid_price 来源 market-data.js + dynamic spread
  if (intent.side === 'buy') {
    // user 用 USDT 买 KAS
    const usdt_amount = intent.qty;
    const kas_per_usdt = 1 / 0.04; // T2 hardcode mid_price 0.04 USDT/KAS
    const kas_amount = usdt_amount * kas_per_usdt * (1 - 0.005); // matcher 留 0.5%
    return {
      give_asset: 'KAS',
      give_amount: String(kas_amount.toFixed(2)),
      want_asset: 'USDT',
      want_amount: String(usdt_amount)
    };
  } else {
    // user 卖 KAS 换 USDT
    const kas_amount = intent.qty;
    const usdt_amount = kas_amount * 0.04 * (1 - 0.005);
    return {
      give_asset: 'USDT',
      give_amount: String(usdt_amount.toFixed(4)),
      want_asset: 'KAS',
      want_amount: String(kas_amount)
    };
  }
}
```

#### Anti-pattern (J2 撞这些立即暂停)

- ❌ 不 cache offer 到 module-level (per MATCHER §11 #1)
- ❌ 不直 SQL INSERT exchange_offers (用 /api/exchange/publish endpoint)
- ❌ 不直接调 Relay sendKaspa (publish 上链是 KANet 内部)
- ❌ 不 import 旧 broker 文件 (broker-buy-handler 等 24 file)

#### Acceptance

- ✅ publishOffer({...}, 'kaspa:...') 真返回 { offer_id, broadcast_tx_id }
- ✅ DB exchange_offers 真有新 row
- ✅ chain_events 真有 'comm_sent' from Trader-M
- ✅ matcher 进程 0 私有 state

#### LOC: ~50

---

### T2.2 — 反馈生成 (KI-17 layer 3)

#### 目标

matcher 真告诉 user offer 已发 + 付款指示。

#### Spec

```js
/**
 * 生成 user 反馈消息 (T2 阶段固定模板, 不调 LLM)
 * @param {Object} intent - T1 输出
 * @param {Object} offerResult - publishOffer 返回
 * @returns {string} 反馈文本
 */
export function generateOfferFeedback(intent, offerResult) {
  const { offer_id, payload } = offerResult;

  if (intent.side === 'buy') {
    // user 买 KAS
    return [
      `好的, 我已经为你发布报价 #${offer_id.slice(-8)}.`,
      ``,
      `📋 报价详情:`,
      `  - 你付: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
      `  - 你收: ${payload.give_amount} ${payload.give_asset}`,
      ``,
      `💸 付款方式:`,
      `  请在 30 分钟内向 broker 钱包付款 (具体地址将由 KANet 给出).`,
      `  付款后我会自动 verify 跨链确认 + 发 KAS 给你.`,
      ``,
      `⚠️ T2 阶段 — matcher 已发 offer, 但跨链 verify + 发 KAS 是 T3 范围 (即将上线).`,
      `  当前请等 T3 ship 完后真完成交易.`
    ].join('\n');
  } else {
    return [
      `好的, 我已经为你发布卖单 #${offer_id.slice(-8)}.`,
      ``,
      `📋 报价详情:`,
      `  - 你付: ${payload.give_amount} KAS`,
      `  - 你收: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
      ``,
      `⚠️ T2 阶段 — 卖单已上链, 完整交割 T3 范围.`
    ].join('\n');
  }
}
```

#### Acceptance

- ✅ 反馈含 offer_id (后 8 位) + give/want detail
- ✅ 反馈含 T2 disclaimer (不暗示已交易完成)
- ✅ 反馈通过 Action Executor 路径发出 (T1 已有 replyToUser)

#### LOC: ~30

---

### T2.3 — executor.mjs 装配

#### 目标

把 T2.1 + T2.2 装进 matcher reactive 流程。

#### Spec

```js
// agent-mind/src/skills/matcher/executor.mjs (扩展 T1 handleListen)

export async function handleListen(ctx) {
  const { peerAddress, latestMessage, actionExecutor, myAddress } = ctx;

  try {
    // T1 部分 (已 ship)
    const peerContext = await loadPeerContext(peerAddress);
    const intent = await extractIntent(peerContext, latestMessage);

    // T2 新增: 如果 intent 完整且 user 同意 publish, 真发 offer
    let offerResult = null;
    if (intent.confidence === 'high' && 
        intent.side !== 'none' && 
        intent.missing_fields?.length === 0 &&
        peerAgreed(peerContext, intent)) {
      // user 真同意 publish
      offerResult = await publishOffer(intent, myAddress);
    }

    // 生成反馈 (T1 generateReply 扩展, 含 T2 offer feedback)
    let replyText;
    if (offerResult) {
      replyText = generateOfferFeedback(intent, offerResult);
    } else {
      replyText = await generateReply(intent, peerContext); // T1 已有
    }

    // 发回复 (T1 已有)
    await replyToUser(peerAddress, replyText, actionExecutor);

    // 上报 mind-event
    await reportEvent({
      skill: 'matcher',
      type: offerResult ? 'offer_published' : 'listen_complete',
      peer: peerAddress,
      intent_side: intent.side,
      offer_id: offerResult?.offer_id
    });

    return { success: true, intent, offerResult };
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

function peerAgreed(peerContext, intent) {
  // T2 简化: 看 user 最近 5 条消息含 "OK" / "好" / "可以" / "确认"
  const recent = peerContext.history.slice(-5);
  const agreeKeywords = /\b(ok|OK|好|可以|确认|发吧|来吧|没问题)\b/i;
  return recent.some(m => 
    m.role === 'user' && agreeKeywords.test(m.content || '')
  );
}
```

#### Acceptance

- ✅ handleListen 真分支: intent complete + user agreed → publishOffer
- ✅ intent incomplete OR user 没同意 → 走 T1 generateReply 不 publish
- ✅ T2 新加分支不破 T1 行为 (回归测试 24/24 仍 pass)
- ✅ mind-event 真上报 type='offer_published'

#### LOC: ~20

---

### T2.4 — 测试 + invariant assertion

#### 单元测试

```js
// kasia-console/test-framework/cases/matcher/T2/publishOffer.test.mjs

test('publishOffer 真调 /api/exchange/publish endpoint', async () => {
  // mock fetch, 验 payload 字段对
});

test('publishOffer 0 私有 state (matcher §11 #1)', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher/executor.mjs', 'utf-8');
  // 验 0 module-level Map / Object 持有 offer 数据
});

test('publishOffer 不直 SQL INSERT exchange_offers', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher/executor.mjs', 'utf-8');
  if (/INSERT\s+INTO\s+exchange_offers/i.test(code)) {
    throw new Error('matcher §11 violation: 直 SQL INSERT exchange_offers');
  }
});

test('generateOfferFeedback 含 T2 disclaimer', () => {
  const fb = generateOfferFeedback(mockIntent, mockOfferResult);
  assert.ok(fb.includes('T2 阶段'));
  assert.ok(fb.includes('T3'));
});

test('handleListen T2 分支不破 T1 (intent incomplete 不 publish)', async () => {
  const ctx = { ...mockCtx, latestMessage: '你好' };
  const res = await handleListen(ctx);
  assert.equal(res.offerResult, null); // 不 publish
});
```

#### 集成测试

```js
test('matcher 真发 offer 到 KANet (intent complete + user agree)', async () => {
  // 1. user DM "我要 50 USDT 买 KAS, BNB 链"
  // 2. matcher reply with intent confirm
  // 3. user DM "OK"
  // 4. matcher 真 publishOffer
  // 5. 验 DB exchange_offers 真有新 row
});

test('matcher 真不动 KAS (T2 anti-pattern)', async () => {
  // 跑 5 个 publish, 验 Trader-M 钱包余额无变化
});
```

#### Invariant assertion (5 条)

- 5/5 acceptance metrics 自动 cron verify

#### LOC: ~50

---

### T2.5 — system auto-verify

operator hat 跑 verify SQL:

```sql
-- T2 verify 1: matcher 真发 offer
SELECT id, give_asset, want_asset, maker, broadcast_at
FROM exchange_offers
WHERE maker = (SELECT kasia_address FROM relay_nodes WHERE name='Trader-M')
  AND broadcast_at > datetime('now', '-30 minutes');
-- 期望: ≥1 row

-- T2 verify 2: chain_events 真上链
SELECT * FROM chain_events
WHERE sender = (SELECT kasia_address FROM relay_nodes WHERE name='Trader-M')
  AND event_type = 'comm_sent'
  AND created_at > datetime('now', '-30 minutes');
-- 期望: ≥1 row

-- T2 verify 3: matcher 真反馈 user
SELECT m.* FROM messages m
WHERE m.sender_identity_id = (SELECT id FROM identities WHERE name='Trader-M')
  AND m.message_type = 'text'
  AND m.content LIKE '%offer%T2%'
  AND m.created_at > datetime('now', '-30 minutes');
-- 期望: ≥1 row 含 T2 disclaimer

-- T2 verify 4: matcher 0 私有 state
-- (静态分析, 不 SQL)

-- T2 verify 5: matcher 不动 KAS
SELECT SUM(amount_kas) FROM tx_records
WHERE sender_address = (SELECT kasia_address FROM relay_nodes WHERE name='Trader-M')
  AND created_at > datetime('now', '-30 minutes');
-- 期望: 0 (matcher T2 不发 KAS)
```

5/5 全过 → T2 close.

---

## Anti-pattern (per Owner 钦定)

- ❌ 不让 Owner 当 verify 工具 (KI-8 v2: system auto-verify)
- ❌ 不 import 旧 broker 文件 (并行真相源反模式)
- ❌ 不持有 offer 私有 state (MATCHER §11 #1)
- ❌ 不直 SQL UPDATE retail_dex_orders state (用 transition() 或 KANet endpoint)
- ❌ 不 verify / 发 KAS / 处理 dispute (T2 严限 publish only)

---

## RFC ref

Owner 5/3 钦定 "broker 跑通最重要 + 一个用户都没有等什么干" + KI-17 broker 三层 (识别/对接/反馈) + MATCHER-ARCHITECTURE.md v0.1 §9 路线图 (T2 范围) + INVARIANTS v0.1 §8.

---

## 接位 SOP (Claude Code 接此任务)

1. 读 docs/INVARIANTS.md v0.1
2. 读 docs/MATCHER-ARCHITECTURE.md v0.1 §11 anti-pattern
3. 读本任务卡
4. **先跑 T2.0 grep, broadcast 验 KANet API 真签名**
5. NWT cross-review verdict 后进 T2.1
6. 每 subtask commit 后等 cross-review

撞 Definition of NOT Done → 暂停 + broadcast architect.

---

## Definition of NOT Done

撞这些立即暂停:

1. T2.0 grep 发现 KANet API spec 跟任务卡严重不一致 → architect 修
2. publishOffer 撞 KANet 路径不存在 → architect 决策 (扩 KANet OR 临时方案)
3. 集成测试 exchange_offers 真有 row 但 chain_events 0 → KANet publish endpoint bug
4. matcher 真持私有 state → revert + 重审 §11 #1
5. T2 改动破 T1 24/24 测试 → revert + 重审分支逻辑

---

*v1.0 — 2026-05-03 Architect mode (claude.ai). Owner 5/3 钦定 "broker 跑通最重要", T2 ship 即便不完善. ETA 2-3 hr ship + cross-review. 不阻 Phase 1 12h 监控期 (并行).*
