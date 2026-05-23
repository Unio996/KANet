# Test Framework Parallel + Wait-Replies Action Spec (B)

**Status**: NWT (d) main draft, awaiting J1 review per dev-coord b0485cf3 三方 align.

**Context**: J2 313b9621 RFC + Owner 16:50 提醒 cross-peer state isolation. R33 keyed by peer 架构对 但 6 in-memory Map 没真测过 cross-peer 交错并发. J1 已写 30 adversarial probes (`kasia-console/test-framework/adversarial/probes.mjs`), 用 `type: 'parallel'` / `type: 'wait_replies'` schema, 但现 runner 不支持, probes 全 dormant.

本 spec = 让 runner 能跑 J1 30 probes + 任何 race condition case.

---

## Goal

让 framework 能表达并跑:
- N 个 peer 同时 DM broker (concurrent inbound)
- 每个 peer 应只收到自己 own 的 reply (no cross-talk)
- broker in-memory state (`_convoState` / `_quotes` / `_pendingPreview` / `_pendingFields`) Map.set/get 真并发不串

---

## Action Schema 加 2 个

### 1. `parallel` — 并发批 actions

```js
{
  action: 'parallel',
  actions: [
    { action: 'send_message', from_peer: peerA, to_relay_id: 'trader-b', message: '买 5 KAS, BSC' },
    { action: 'send_message', from_peer: peerB, to_relay_id: 'trader-b', message: '卖 10 KAS' },
    { action: 'send_message', from_peer: peerC, to_relay_id: 'trader-b', message: '买 1 KAS, POL' },
  ],
}
```

实现:
- `Promise.allSettled(actions.map(a => actions[a.action](a, ctx)))` — capture all results 含 reject (race 让某个 throw 不阻断剩余)
- return `{ results: [{ peer, reply, status, latency_ms, error? }], total_latency_ms }`
- 不 retry-on-transient (current `_sendOnce` retry 只在 single send_message; parallel 跑 race condition, retry 会掩盖 race)

### 2. `wait_replies` — poll for N replies in window

```js
{
  action: 'wait_replies',
  expected_peers: [peerA, peerB, peerC],
  count: 3,
  timeout_ms: 60000,
}
```

实现:
- 跟 `parallel` 配对用 — `parallel` 已 await all done, 真所有 reply 已在 result.results
- `wait_replies` 实际是 **post-parallel assertion** 而不是 polling action. 改名提案: `assert_all_replies_received` 更清晰
- 保留 J1 probe 原 schema `wait_replies` 名 (向后兼容), 内部映射

---

## State Assertion Vocabulary (跟 J1 probes expect 字段对齐)

| 字段 | 含义 | 实现 |
|------|------|------|
| `no_state_corruption` | 每个 peer 收到的 reply 跟自己 message 一致 (qty/方向/asset 匹) | parse reply → 跟 send 比对 each peer |
| `each_peer_distinct_offer` | 每个 peer 收到的 offer_id (or order #) 唯一 | extract '订单 #abcd' / 'offer_id' regex, set.size === N |
| `no_amount_swap` | peerA 不会收到含 peerB 数量的 reply | reply 含 peerA qty 不含 peerB qty for each peer |
| `no_address_swap` | peerA 不会收到含 peerB 地址的 reply | 同上, 地址维度 |

新加 reply parser helper `_parseBrokerReply(reply)` 拆 qty/方向/asset/chain/order_id.

---

## Probe Adaptation — alias 解析层

J1 probes 用 alias (`from: 'Sophie'`, `to: 'broker'`), 现 framework 用真 addr/relay_id. 加 `_resolveAlias` 层:

```js
const ALIASES = {
  Sophie: { peer: freshTestPeer('sophie-' + Date.now()), kind: 'peer' },
  Eric: { peer: freshTestPeer('eric-' + Date.now()), kind: 'peer' },
  Martin: { peer: freshTestPeer('martin-' + Date.now()), kind: 'peer' },
  broker: { relay_id: relayId('trader-b'), kind: 'relay' },
};
```

probes.mjs 跑前 alias resolve, 把 `from: 'Sophie'` → `from_peer: ALIASES.Sophie.peer`. ~10 LOC adapter.

---

## Cleanup Isolation

每个 race case 用 `freshTestPeer(...)` 已 unique. 但 broker in-memory state 不在 cleanup_peer 范围 (cleanup_peer 只删 messages 表行). 加 `cleanup_peer_broker_state` action:

```js
{ action: 'cleanup_peer_broker_state', peers: [peerA, peerB, peerC] }
```

实现: import `resetConvoState` from `broker-state-authority.js` + import broker handler `_pending`, `_quotes`, `_pendingAccepts` 等 Map 的 delete 接口 (TODO: handlers 暴露 `_resetForPeer(addr)` 给 test framework).

> 微妙点: 这要 broker handler 暴露内部 Map 给 test. 不是 production code 改, 是加 test-only export. ANTI-PATTERNS 写明 'production 不准 import _resetForPeer, 只 test framework 用'.

---

## 微妙点 (Subtle Considerations)

### 1. Promise.allSettled vs Promise.all
用 `allSettled` — 一个 send_message reject 不阻断其他, race condition 可能让某个 throw.

### 2. Retry-on-transient 不 apply parallel
parallel 跑 race, retry 会掩盖 race timing. parallel actions 内 send_message **不 retry**. 改 `_sendOnce(opts.no_retry=true)` 接口.

### 3. Reply ordering
parallel 后 result.results 顺序是 actions 数组顺序 (allSettled 保证), 不是 reply 到达顺序. 看 latency_ms 看真到达顺序.

### 4. Inter-test contamination
test A run 完 broker 内存里还有 _convoState/peerA. test B 用同 peerA addr 会撞 stale state. `freshTestPeer` 加 timestamp 已 unique 解决, 但 cleanup 仍需 reset broker Map.

### 5. State assertion timing
parallel done = 所有 reply 都拿到. 立即 assert OK. 不需要额外 sleep.

### 6. Trace
parallel result.results 全 dump 到 trace, 含 each peer message + reply + latency. trace 文件名 `<case_id>_parallel_<step_idx>.log` 加分隔.

### 7. Null reply handling (J1 21bac909 nudge #3)
broker 可能 decide 不 reply (e.g. sibling_broker / anti-spam fail-closed / R33 violation). parallel 拿到 `reply: null` OR empty string. state assertion 应 **skip null** 不算 fail (peer 没收 reply ≠ state 串话 bug). 实现:
```js
const validResults = results.filter(r => r.status === 'fulfilled' && r.reply);
const peerReplyMap = new Map(validResults.map(r => [r.peer, r.reply]));
// assertions only over peerReplyMap, null replies excluded
```

### 8. Async _qDm 路径测 (J1 21bac909 nudge #4)
parallel 不 cover async-queued DM (broker `_qDm` → broker-action-queue → relay sendCommandAsync). race case 如需测 async DM, 用现有 pattern:
```js
{ action: 'parallel', actions: [...] },
{ action: 'sleep', ms: 3000 },                     // 等 queue pump
{ action: 'query_db', sql: 'SELECT ... FROM messages WHERE ...', expect: { row_count: N } },
```
不是 parallel infra 责任, 但 race case 作者参考.

---

## Implementation Scope (NWT 估)

| 项 | LOC | 说明 |
|----|-----|------|
| `parallel` action | ~25 | Promise.allSettled wrapper |
| `wait_replies` 名向后兼容 | ~10 | 内部 alias to assert_all_replies_received |
| `_parseBrokerReply` helper | ~30 | regex 提 qty/方向/asset/order_id |
| state assertion 4 个 | ~40 | no_state_corruption / each_peer_distinct_offer / no_amount_swap / no_address_swap |
| alias 解析层 | ~15 | 跑 J1 probes 前转换 |
| `cleanup_peer_broker_state` action | ~10 | reset broker Maps |
| broker handlers 暴露 `_resetForPeer` | ~3 each × ~6 handlers = ~18 | test-only export |
| trace 适配 parallel | ~15 | dump format |
| **总** | **~163 LOC** | runner.mjs + handler exports |

---

## 测试 (B 自身的 dogfood)

ship 后立刻跑 J1 race-3peer-concurrent-buy probe 验:
- ✓ 3 peers 同时 BUY → 3 distinct offer_id, no amount swap
- ✓ trace 显示 3 个 reply latency 接近 (真 concurrent), 不是 sequential
- ✓ broker `_convoState` Map.size === 3 后

如发现真 race bug → R33 c iter 修.

---

## 不在本 spec scope

- broker code 改 (race 条件下 Map.set TOCTOU 修法) — 留 R33 c
- adversarial 30 probes 全跑过 — 第一阶段先 race-3peer-concurrent-buy + race-rapid-retry-anti-spam, 验 framework infra OK 后 J1 一次性 enable 余下 28 个

---

## J1 review verdict (21bac909 23:19): APPROVE

5 nudge applied:
1. ✓ alias keep — readable for 30 probes
2. ✓ `_resetForPeer` keep — matches `_testClearPendingFields` pattern
3. ✓ null reply handling 加 (微妙点 #7)
4. ✓ async _qDm test pattern note 加 (微妙点 #8)
5. ✓ implementation order — incremental: parallel ~25 LOC → 1 case test → assertions ~40 LOC → alias + cleanup ~25 LOC

## Implementation Plan (incremental)

| 阶段 | LOC | commit | 验证 |
|------|-----|--------|------|
| 1 | ~25 | parallel action 单独 | 跑一个 minimal 2-peer parallel send case |
| 2 | ~40 | + 4 state assertions | 加 cross-peer assertion case 跑 |
| 3 | ~15 | + alias 解析 | J1 race-3peer-concurrent-buy probe enable 跑 |
| 4 | ~10 | + cleanup_peer_broker_state | 多 case 跑不串 |
| 5 | ~18 | broker handler `_resetForPeer` × 6 | cleanup 真生效 |

每阶段 commit + bundle, J1+J2 增量 review/试用.

— NWT @ 2026-04-28 05:21 (UTC+7) B spec v2 — J1 review APPROVE w/ 5 nudge applied
