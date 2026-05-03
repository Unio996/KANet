# Task: PZ-MATCHER-shipT3

**Version**: v1.0
**Phase**: Phase 2 P0 critical (broker 4 stage 真 missing piece)
**Scope**: matcher v0.3 — Stage 3 KI-19 真修 + Stage 4 settlement state machine event-sourced (per INVARIANTS §9 draft + Owner 5/3 9-state spec)
**Owner**: J2 (implementor) → NWT (reviewer hat) → operator (system self-verify)
**ETA**: ~5-8 hr ship + 1 hr cross-review + auto-verify
**LOC budget**: ~230 LOC (30 KI-19 + 40 subscribe + 40 emit + 30 projection + 40 反馈 + 50 test)

---

## 起源

per Owner 5/3 钦定 broker 4 stage 真核心 + 唯一评判:
1. ✓ 握手 + 即时 accept reply (Bug 1 fix)
2. ✓ 用户意图识别 (T1)
3. ⚠ **快速形成订单** (T2 publishOffer endpoint OK 但 shouldPublish gate 实战 too strict)
4. ❌ **订单执行过程 + 结果及时反馈** (T3 — broker 真 missing critical piece)

T3 真做: 修 Stage 3 真 trigger gap + ship Stage 4 完整 settlement。

per INVARIANTS v0.2 §9 draft (commit 6c9a195e5) event-sourced principle:
- chain_events = truth (immutable append-only ordered log)
- exchange_offers.protocol_status = derived projection (rebuildable from chain replay)
- matcher = stateless reactor (subscribe + react + emit, NOT R-M-W)

**5/2 上午旧 broker order-machine 漏水真因 = state owned by mutable process memory + DB cache**, T3 修法 = state ownership 移到 chain_events log。

---

## 真目标 + Acceptance (system auto-verify, KI-8 守)

**broker 真 ship target**: Owner DM Trader-M 真完整下单 → KAS 真发 → user 真收。

| # | check | metric |
|---|---|---|
| 1 | Stage 3 KI-19 fix: real-world publishOffer trigger | NWT DM Trader-M with natural intent ("我要 50 USDT 买 KAS, BSC, OK") → matcher publishOffer 真 trigger (NOT shouldPublish gate fail) → exchange_offers row from Trader-M maker |
| 2 | Stage 4 subscribe: matcher 真 react chain events | trade-protocol-filter 真 dispatch kanet_exchange_paid_v1 → matcher reactor 真 process → emit kanet_exchange_paid_v1 ack OR transition |
| 3 | Stage 4 emit: matcher 真 emit payment_verified + delivery_initiated | DB chain_events 真有 row event_type='kanet_exchange_paid_v1' + 'kanet_exchange_delivered_v1' from Trader-M post settlement flow |
| 4 | Stage 4 projection: protocol_status derive from chain_events | exchange_offers.protocol_status 真等于 latest event for offer_id (replay verify) |
| 5 | Stage 4 反馈 user: matcher reply 每 transition | DB messages from Trader-M to peer 真含 "已收到付款 / 验证 / 发 KAS" 等 transition feedback (KI-17 layer 3) |
| 6 | T1+T2 测试 全 pass + T3 测试 pass | node:test 全部 pass / 0 fail |
| 7 | 完整 broker e2e (Owner real DM)| Owner Kasia client DM Trader-M → 收 reply → confirm → publishOffer → 模拟 payment → matcher process → KAS 真到 user (test amount, 0.5 KAS) |

7/7 全过 = T3 真 done = broker 真 ship。

---

## Out of scope (T3 严禁)

撞这些立即暂停 + broadcast architect:

1. ❌ 不修 Bug A (cross-agent handshake decrypt, defer Phase 3)
2. ❌ 不修 KI-22 watchdog env (defer Phase 3, NOT broker 跑通障碍)
3. ❌ 不引入新 state machine framework (用 existing trade-protocol-filter + exchange_offers + chain_events)
4. ❌ 不直 SQL UPDATE protocol_status (event-sourced, derive from chain_events replay)
5. ❌ 不 own state in matcher process memory (per INVARIANTS §9.1 真 lesson)
6. ❌ 不超 LOC budget without anti-pattern justification (per KI-21 sediment)

---

## 8 Subtask 顺序

| # | 名 | mode | LOC | 时长 |
|---|---|---|---|---|
| T3.0 | grep KANet 现有 settlement infra 真签名 (KI-2/3/4/5 防复刻硬纪律 7th cycle) | implementor | 0 | 15 min |
| T3.1 | Stage 3 fix — KI-19 LLM intent classify replace shouldPublish keyword regex | implementor | ~30 | 1 hr |
| T3.2 | Stage 4 subscribe — matcher reactor for trade-protocol-filter exchange events | implementor | ~40 | 1 hr |
| T3.3 | Stage 4 emit — matcher emit payment_verified + delivery_initiated | implementor | ~40 | 1.5 hr |
| T3.4 | Stage 4 projection — exchange_offers.protocol_status derive from chain_events replay | implementor | ~30 | 1 hr |
| T3.5 | Stage 4 反馈 — matcher reply user 每 transition (KI-17 layer 3) | implementor | ~40 | 1 hr |
| T3.6 | tests + invariant assertion | QA | ~50 | 1 hr |
| T3.7 | system auto-verify e2e (Owner real DM Trader-M, 0.5 KAS test amount) | operator | 0 | 30 min |

总 ETA: ~5-8 hr ship + 1 hr cross-review + 30 min verify

---

## 详细 spec

### T3.0 — grep KANet 现有 settlement infra 真签名 (硬纪律)

per Phase 1 + T2 v1.0..v1.3 + §9 draft 5 cycles 实证 KI-2/3/4/5 防复刻硬纪律 + INVARIANTS §1.2 specific facts 必基于实证。

#### Action

```bash
cd /c/kanet

# 1. trade-protocol-filter 真 subscribe 模式 (event handlers)
grep -nE "case 'kanet_exchange_(paid|delivered|dispute|timeout)" /c/kanet/kasia-console/src/services/trade-protocol-filter.js | head -10

# 2. chain_events INSERT path (event emit 真 mechanism)
grep -nA 5 "INSERT INTO chain_events" /c/kanet/kasia-console/src/services/exchange-machine.js | head -30

# 3. exchange_offers.protocol_status 现 write path (要修成 derive 不 直 UPDATE)
grep -rn "UPDATE exchange_offers.*protocol_status\|protocol_status.*=" /c/kanet/kasia-console/src 2>/dev/null | head -10

# 4. matcher.mjs 真 entry path for event subscription (T3 reactor wiring)
grep -nE "registry|trade-protocol-filter|on.*event|subscribe" /c/kanet/agent-mind/src/skills/matcher.mjs | head -10

# 5. broker-state-machine.js transition() 真 implementation (event-sourced 比对)
grep -nA 30 "function transition" /c/kanet/kasia-console/src/services/broker-state-machine.js | head -40

# 6. Adapter LLM intent classify pattern (T3.1 KI-19 fix 用 reference)
grep -rn "callAdapter\|adapter.*reply\|/reply" /c/kanet/agent-mind/src/skills/matcher.mjs /c/kanet/agent-mind/src/utils.mjs 2>/dev/null | head -10
```

#### 报告

每条 grep 真结果列:
- file:line 真 endpoint / function / signature
- 真 expected fields (event_type / payload shape / API signature)
- 跟此任务卡 spec 比对 (一致 / 部分 / 不一致)

#### Verdict

- ✅ `api_verified` → T3.1 进
- ⚠ `partial_mismatch` → architect 修任务卡 spec
- ❌ `major_mismatch` → 暂停, architect 重审

---

### T3.1 — Stage 3 真 fix: KI-19 LLM intent classify replace shouldPublish keyword regex

#### 目标

替 T2 ship 的 keyword regex `/\b(ok|OK)\b|好|可以|.../i` (实战 too strict + CJK boundary 问题)。 用 Adapter LLM intent classify 判断 user 是否 ready publish。

#### Spec

```js
// agent-mind/src/skills/matcher.mjs (replace shouldPublish + add asyncShouldPublish)

const SHOULD_PUBLISH_SYSTEM = `你是 broker 助手, 判断 user 是否准备好提交 offer 上链.

判断标准 (binary):
- ready=true: user 明确同意 publish (含: 完整意图 + 用户最近消息含 同意/确认/可以/发吧/OK 等), AND user 已提供 evm_address (EVM/BSC 链 buy/sell scenarios required)
- ready=false: 缺任一条件

返 JSON: { ready: true|false, reason: "..." }`;

async function asyncShouldPublish(intent, peerHistory, config) {
  // 严 gates first (cheap check, 0 LLM call needed if obvious not-ready)
  if (intent.confidence !== 'high') return false;
  if (intent.side !== 'buy' && intent.side !== 'sell') return false;
  if (intent.missing_fields?.length > 0) return false;
  
  // LLM classify (replaces keyword regex, KI-19 fix)
  if (!config?.adapterUrl) return false;  // graceful: NO adapter → fall back to false
  
  const recentText = (peerHistory || []).slice(-5).map(m => `${m.dir}: ${m.text}`).join('\n');
  const userMsg = `intent: ${JSON.stringify(intent)}\nrecent history (last 5):\n${recentText}`;
  
  try {
    const response = await fetchJson(`${config.adapterUrl}/reply`, {
      method: 'POST',
      body: JSON.stringify({
        mindSystem: SHOULD_PUBLISH_SYSTEM,
        mindUser: userMsg,
        mindTask: 'shouldPublish_classify',
      }),
    });
    const cleaned = (response?.reply || '').replace(/^```(?:json)?\s*|\s*```\s*$/gs, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed?.ready === true;
  } catch {
    return false;  // fail-closed (per KI-22 fail-closed pattern)
  }
}

// extractIntent wrapper (T2 path, 改 await async)
async extractIntent(gathered, latestMessage, config) {
  const intent = await this._extractIntentT1(gathered, latestMessage, config);
  
  intent.should_publish = await this.asyncShouldPublish(intent, gathered.history || [], config);  // T3.1 fix
  
  if (intent.should_publish) {
    try {
      const offerResult = await this.publishOffer(intent);
      intent._offerResult = offerResult;
    } catch (err) {
      console.error('[matcher] publishOffer failed:', err.message);
      intent._publishError = err.message;
    }
  }
  return intent;
}
```

#### Anti-pattern

- ❌ 不删 cheap gates (intent.confidence/side/missing_fields), keep before LLM call (省 LLM cost)
- ❌ 不 LLM call 0 timeout (用 AbortSignal OR fetchJson default timeout)
- ❌ 不 silent failure on adapter unavailable (fail-closed return false)

#### Acceptance

- ✅ asyncShouldPublish('intent complete + user 含 "OK 发吧 BSC 0x...") → ready=true
- ✅ asyncShouldPublish('intent missing fields') → false (cheap gate)
- ✅ asyncShouldPublish('adapter unavailable') → false (fail-closed)
- ✅ 实战: NWT DM Trader-M with natural intent → publishOffer triggers

#### LOC: ~30

---

### T3.2 — Stage 4 subscribe: matcher reactor for trade-protocol-filter

#### 目标

matcher 接 trade-protocol-filter 4 关键 events (kanet_exchange_paid/delivered/dispute/timeout)。 react 后 dispatch state-specific handler。

#### Spec

trade-protocol-filter 现 handler-style switch on `t` field — matcher 加 hook OR Skill subscription。 J2 grep verify 真 pattern (T3.0 finding)。

候选 path:
- (a) trade-protocol-filter 加 hook export (matcher subscribe via callback)
- (b) matcher poll chain_events 表 last N events (~5s interval, simpler)
- (c) registry.mjs orchestrate 加 chain_events event 维度

NWT 倾 (b) — simplest, 跟 KANet HTTP API 一致 (per skill HTTP-only convention KI-4)。 matcher 加 reactive cycle 查 /api/exchange/events?since=X periodic poll。

J2 grep 验真 best path post T3.0。

#### Acceptance

- ✅ matcher 真 react: chain_events 含 kanet_exchange_paid_v1 → matcher process → emit kanet_exchange_verified_v1 (post EVM proof) OR error event
- ✅ 0 own state (per INVARIANTS §9.5 anti-pattern #1)

#### LOC: ~40

---

### T3.3 — Stage 4 emit: matcher emit payment_verified + delivery_initiated

#### 目标

matcher 真 emit 2 chain events (post settlement):
- payment_verified: post EVM cross-chain proof verify (跨链确认 paid)
- delivery_initiated: post sendKaspa (KAS 真发 user)

#### Spec

```js
// matcher.mjs 加 method

async emitPaymentVerified(offerId, paymentTx, evmAddress) {
  // EVM cross-chain proof verify (per existing exchange-machine.js paid handler reference)
  // emit chain event via /api/exchange/verify (new endpoint OR existing)
  const payload = {
    relayNodeId: this._config?.relayNodeId,
    t: 'kanet_exchange_paid_v1',  // verify event name per T3.0 grep
    offer_id: offerId,
    payment_tx: paymentTx,
    evm_address: evmAddress,
  };
  // chain TX emit via Console endpoint (NOT direct sqlite)
  return await fetchJson(`${this._config?.consoleUrl}/api/exchange/verify`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async emitDeliveryInitiated(offerId, kasAmount, userAddress) {
  // sendKaspa via existing path (T2 ship reference)
  // emit kanet_exchange_delivered_v1 chain event
  // ...
}
```

具体 endpoint name + payload shape per T3.0 grep result (architect 修 spec post J2 grep)。

#### Anti-pattern

- ❌ 不直 SQL UPDATE protocol_status (per INVARIANTS §9.5 anti-pattern #2)
- ❌ 不直 chain TX from matcher (用 Console endpoint, per skill HTTP-only KI-4)
- ❌ 不 own offer state in matcher process (per §9.5 #1)

#### Acceptance

- ✅ emit 真 chain TX (broadcast_messages 真有 row + chain_events 真有 row)
- ✅ event_type 真符 trade-protocol-filter dispatch (handler 真 pick up)
- ✅ matcher 0 own state (instance 0 holds offer reference)

#### LOC: ~40

---

### T3.4 — Stage 4 projection: protocol_status derive from chain_events replay

#### 目标

exchange_offers.protocol_status 真 derive from chain_events latest event for offer_id, NOT 直 SQL UPDATE。

per INVARIANTS §9.2 (Truth = chain_events / Projection = DB cache rebuildable)。

#### Spec

```js
// kasia-console/src/services/projection.js (NEW OR extend exchange-machine.js)

// Rebuild protocol_status from chain_events replay (single offer)
async function deriveProtocolStatus(offerId) {
  const events = sqlite.prepare(`
    SELECT event_type, payload, observed_at
    FROM chain_events
    WHERE event_type LIKE 'kanet_exchange_%'
      AND payload LIKE '%' || ? || '%'
    ORDER BY observed_at ASC
  `).all(offerId);
  
  // State machine: published → matched → paid → verified → delivering → completed
  let state = 'open';
  for (const e of events) {
    if (e.event_type === 'kanet_exchange_v1') state = 'open';
    else if (e.event_type === 'kanet_exchange_accept_v1') state = 'matched';
    else if (e.event_type === 'kanet_exchange_paid_v1') state = 'verifying';
    else if (e.event_type === 'kanet_exchange_delivered_v1') state = 'delivering';
    else if (e.event_type === 'kanet_exchange_completed_v1') state = 'completed';
    else if (e.event_type === 'kanet_exchange_dispute_v1') state = 'disputed';
    else if (e.event_type === 'kanet_exchange_cancel_v1') state = 'cancelled';
    else if (e.event_type === 'kanet_exchange_timeout_v1') state = 'timed_out';
  }
  return state;
}
```

J2 implementer authoritative: 真 event_type names per T3.0 grep + state mapping per existing exchange-machine.js logic 比对。

#### Anti-pattern

- ❌ 不 UPDATE protocol_status 直 (per §9.5 #2)
- ❌ 不 cache projection in matcher process (per §9.5 #1)
- ❌ 不 multi-writer to projection (single writer = projection rebuilder)

#### Acceptance

- ✅ deriveProtocolStatus(offerId) 真 returns state per chain_events replay
- ✅ exchange_offers.protocol_status 真 == deriveProtocolStatus(offerId) (consistency)
- ✅ Recovery: matcher process die → restart → state replay 真 重建 (NO process memory dependency)

#### LOC: ~30

---

### T3.5 — Stage 4 反馈: matcher reply user 每 transition (KI-17 layer 3)

#### 目标

per Owner KI-17 broker 三层 + Stage 4 "结果及时反馈": user 真知道每 transition (paid → verified → delivered → completed)。

#### Spec

matcher reactor (T3.2) detect new event for offer_id with peer = current user → format friendly reply → send via action-executor。

```js
// matcher.mjs 加

async notifyTransition(offerId, peerAddress, oldState, newState) {
  const messages = {
    'open→matched': '✓ 已匹配 taker, 等付款 (30 分钟内).',
    'matched→verifying': '💰 付款已收到, 验证跨链确认中...',
    'verifying→delivering': '✓ 付款验证通过, 发 KAS 中...',
    'delivering→completed': '🎉 KAS 已发出, 交易完成! 请查询钱包确认收款.',
    'open→timed_out': '⏰ 30 分钟无 taker, 订单已 timeout. 退款已发.',
    'matched→disputed': '⚠ 争议产生, 进入 dispute 流程. 等 resolver.',
  };
  const key = `${oldState}→${newState}`;
  const msg = messages[key];
  if (!msg || !peerAddress || !this._actionExecutor) return;
  return await this._actionExecutor.executeOne({
    target: peerAddress,
    message: this.stripMarkdown(msg),  // T2 ship stripMarkdown reuse
  });
}
```

#### Anti-pattern

- ❌ 不 throttle reply (broker 用户 expect immediate feedback per Stage 4 spec)
- ❌ 不 silent skip transition (every state change = 反馈 — KI-17 layer 3)
- ❌ 不 markdown leak (per KI-18, stripMarkdown apply)

#### Acceptance

- ✅ matcher 真 reply user 每 transition with appropriate message
- ✅ DB messages 真有 row event_type='text' from Trader-M to peer at each transition timestamp
- ✅ stripMarkdown apply (per KI-18 platform-agnostic)

#### LOC: ~40

---

### T3.6 — tests + invariant assertion

#### 单元测试 (~30 LOC)

```js
test('asyncShouldPublish LLM classify 真 ready (T3.1 KI-19 fix)', async () => {
  // mock adapter, intent complete + agree text → ready=true
});

test('asyncShouldPublish fail-closed on adapter err', async () => {
  // mock adapter throw → ready=false
});

test('matcher 0 own state (§9 anti-pattern #1)', () => {
  // source-level: 0 instance Map/Set holds offer
});

test('emitPaymentVerified 真 emit chain_events row', async () => {
  // mock /api/exchange/verify, verify chain_events INSERT path
});

test('deriveProtocolStatus replay 真 重建 state', async () => {
  // insert mock events sequence → deriveProtocolStatus returns correct state
});

test('notifyTransition stripMarkdown apply', async () => {
  // verify reply 真 stripped + sent via action-executor
});
```

#### Source-level invariants (~20 LOC)

```js
test('matcher.mjs 0 直 SQL UPDATE exchange_offers (per §9 anti-pattern #2)', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  assert.notMatch(code, /UPDATE\s+exchange_offers/i);
});

test('matcher.mjs 0 直 chain TX emit (per §9 + KI-4 skill HTTP-only)', () => {
  const code = fs.readFileSync('agent-mind/src/skills/matcher.mjs', 'utf-8');
  assert.notMatch(code, /sendKaspa\s*\(/);  // matcher 不直 sendKaspa, 经 endpoint
});
```

#### LOC: ~50

---

### T3.7 — system auto-verify e2e (Owner real DM Trader-M, 0.5 KAS test)

NWT operator hat 跑 真 e2e:

```
1. Console restart (load T3 ship code)
2. NWT relay DM Trader-M: "我要 0.02 USDT 买 0.5 KAS, BSC, 我 EVM 0x742...bEb1, OK 发吧"
3. matcher 真 publishOffer (T3.1 LLM classify ready=true)
4. exchange_offers row 真有
5. broadcast_messages kanet_exchange_v1 真有
6. NWT 模拟 taker accept (curl /api/exchange/accept)
7. 模拟 cross-chain payment (test EVM TX OR mock proof)
8. matcher T3.2 reactor 真 process payment_received event
9. matcher T3.3 真 emit kanet_exchange_paid_v1 + verifyEVM proof + emit kanet_exchange_delivered_v1
10. sendKaspa 真发 0.5 KAS to NWT
11. matcher T3.5 反馈 NWT 每 transition (text DM)
12. exchange_offers.protocol_status 真 = 'completed' (T3.4 projection derive)
13. NWT relay 真收 0.5 KAS (Trader-M wallet -0.5 KAS verify)
```

7/7 acceptance verify pass → T3 ☆ CLOSE ☆ = broker 真 ship。

---

## Anti-pattern (per Owner 钦定 + INVARIANTS §9 + Phase 1 sediment)

- ❌ 不 own state in matcher process (§9.5 #1)
- ❌ 不直 SQL UPDATE protocol_status (§9.5 #2 + KI-4 skill HTTP-only)
- ❌ 不 read-modify-write transition (§9.5 #3)
- ❌ 不 silent failure on settlement err (KI-9 + 反馈 user)
- ❌ 不 markdown leak in reply (KI-18 stripMarkdown apply)
- ❌ 不 LLM call 0 fail-closed (per KI-22 sediment fail-closed pattern)
- ❌ 不超 LOC budget without anti-pattern justification (per KI-21 sediment)

---

## RFC ref

- Owner 5/3 钦定 broker 4 stage 真核心 + 唯一评判
- Owner 5/3 9-state event-sourced spec
- INVARIANTS v0.1 §4.1 (alive vs functioning) + §6.3 任务卡颗粒度
- INVARIANTS v0.2 §9 draft (event-sourced state machine, commit 6c9a195e5)
- KI-17 broker 三层 (识别 + 对接 + **反馈**)
- KI-19 CJK regex + shouldPublish gate strict (T3.1 真修)
- KI-23 NWT 优先级 trap + Phase 2 priority 真定义 (T3 P0 critical)

---

## 接位 SOP (J2 接此任务)

1. 读 INVARIANTS v0.1 §4.1 + §6.3
2. 读 INVARIANTS v0.2 §9 draft event-sourced principles
3. 读 KI-17/19/23 sediment 进 retro doc
4. 读本任务卡
5. **先跑 T3.0 grep, broadcast 验 KANet API 真签名** (KI-2/3/4/5 防复刻 7th cycle)
6. NWT cross-review verdict 后进 T3.1
7. 每 subtask commit 后等 cross-review

撞 Definition of NOT Done → 暂停 + broadcast architect.

---

## Definition of NOT Done

撞这些立即暂停:

1. T3.0 grep 发现 KANet API spec 跟任务卡严重不一致 → architect 修
2. T3.1 LLM classify 撞 adapter unavailable / response 不 parse → architect 决 fallback
3. T3.2 trade-protocol-filter subscribe path 真 unclear (a/b/c 候选) → architect 决终
4. T3.3 emit 撞 endpoint 不存在 OR signature mismatch → architect 修 spec
5. T3.4 projection derive 撞 event_type 不匹配 → architect 修 mapping
6. T3.5 反馈 撞 action-executor 不可用 → architect 决路径 (per T2 ship pattern)
7. T1+T2 测试任 1 fail → revert + 重审
8. T3.7 e2e Owner DM 撞 broker stage 1/2/3 任 1 fail → architect 决 (Bug A handshake / shouldPublish strict / etc)

---

*v1.0 — 2026-05-03 NWT cross-hat architect (per Owner 5/3 全自动 0 干预 authorize + KI-23 priority 真定义 P0 critical). broker 真 ship target = Owner DM → 完整下单 → KAS 真发. Phase 2 第二 ship.*
