# R33 broker code 实施 design (J2 main, J1 review)

J1 R32+R33 sediment 已 ship 文档 (3b6911f3)。本 doc 是 broker code 实施 design, 给 J1 R33 lint phase 2 review 时参考一致性。

## R32+R33 trinity 真**回顾**

R32 (flow state lifecycle): direction/intent_asset/payment_chain/quoted_price 一旦 declared, sticky lock 直到 explicit reset (NO/取消/timeout)。fresh interpretation 只在 first commit 或 reset 后。

R33 (state authority): broker 6+ reply paths 都必须 consult 同一 conversation state authority, 不再各自 fragmented pattern-match。

## 实施 plan: broker-state-authority.js (新建 ~80 LOC)

```js
// kasia-console/src/services/broker-state-authority.js
const _convoState = new Map();  // peer → ConvoState
const TTL_MS = 30 * 60 * 1000;

export interface ConvoState {
  direction: 'buy' | 'sell' | null;
  intent_asset: 'KAS' | 'USDT' | 'USDC' | null;
  qty: number | null;
  payment_chain: 'bnb' | 'polygon' | 'sol' | 'tron' | null;
  receive_address: string | null;
  quoted_price: number | null;     // R32 sister, 价格 lock
  conditions: object | null;        // limit price / refund timeout 等 user 特殊条件
  lifecycle_phase: 'idle' | 'collecting' | 'previewed' | 'confirmed' | 'paid' | 'verifying' | 'delivering' | 'completed' | 'cancelled';
  lock_started_at: number;
  expires_at: number;
}

export function getConvoState(peer): ConvoState | null;
export function setConvoLock(peer, state): void;  // first commit set lock
export function transitionPhase(peer, new_phase): void;
export function shouldDeterministicFire(peer, candidate_direction): bool;  // R33 gate
export function resetConvoState(peer, reason): void;  // NO/取消/timeout
```

## 6+ paths 改造 (broker-buy-handler.js + broker-sell-handler.js + broker-llm-agent.js)

每 path 入口加 prologue:

```js
async function handleXIntent(peerAddr, message) {
  const convo = getConvoState(peerAddr);
  if (convo && !shouldDeterministicFire(peerAddr, /* this path's direction signal */)) {
    // R33 gate: state authority says no, defer
    return null;
  }
  // ... existing logic
}
```

具体 path:

| path | 改造 |
|------|------|
| BUY_REGEX (buy-handler) | 真 SELL flow active → return null defer |
| SELL_REGEX (sell-handler) | 真 BUY flow active → return null defer |
| PRICE_QUERY_REGEX (buy-handler:672) | 真 SELL flow active → 给 broker 收购视角价格 (买入价 = mid - spread), 不给 BUY 引导文案 |
| CONFIRM_WORDS (buy-handler:685) | 真 lifecycle ≠ 'previewed' → defer (e.g. paid 状态 'YES' 不 trigger 重复 finalize) |
| CANCEL_WORDS (buy-handler:846+853) | 任何 lifecycle 都接受, transitionPhase('cancelled') |
| PAID_REGEX (buy-handler) | 真 lifecycle ≠ 'confirmed/paid' → defer |
| handleLlmDialog (broker-llm-agent) | 真 fresh empty + state 已齐 → fall LLM 让 NLG 处理 (Bug-Z12 已修); LLM 第一轮 reply post-process 含 R33 invariants |

## R32 quoted_price lock (R32 sister rule, J2 (e))

broker reply 含 USDT/KAS 价格数字模式 (`/\d+\.\d{4,}\s*USDT/`) → 必经 fetchPrice oracle ±5% 校验:

```js
// 在 broker-action-queue.js OR conversations.js _r19Guard 之后加 _r32Guard:
async function _r32PriceGuard(replyText, peer) {
  const m = replyText.match(/(\d+\.\d{4,})\s*USDT/);
  if (!m) return replyText;
  const replyPrice = parseFloat(m[1]);
  const convo = getConvoState(peer);
  if (convo?.quoted_price) {
    // lock 已 set, broker reply 价 != lock → 拒
    if (Math.abs(replyPrice - convo.quoted_price) / convo.quoted_price > 0.001) {
      return '抱歉, broker 价格异常 (R32 拦), 请回 NO 取消重新下单。';
    }
  } else {
    // 没 lock, 校验 oracle ±5%
    const oracle = await fetchPrice('KAS', 'USDT');
    if (Math.abs(replyPrice - oracle.price) / oracle.price > 0.05) {
      return '抱歉, broker 价格偏离市价 5% 以上 (R32 拦), 请稍后重试。';
    }
  }
  return replyText;
}
```

## lifecycle phase 转换 hooks

| phase 转换 | trigger | hook |
|----------|---------|------|
| idle → collecting | user 发 intent message | _pendingFields set |
| collecting → previewed | _executeTool('preview_order') ok | setConvoLock + transitionPhase('previewed') |
| previewed → confirmed | CONFIRM_WORDS hit + finalizeBuy/Sell ok | transitionPhase('confirmed') |
| confirmed → paid | PAID_REGEX hit + chain verified | transitionPhase('paid') |
| paid → verifying | bsc-incoming-watcher detected | transitionPhase('verifying') |
| verifying → delivering | broker auto-deliver started | transitionPhase('delivering') |
| delivering → completed | tx confirmed | transitionPhase('completed') |
| 任何 → cancelled | CANCEL_WORDS hit + clear pending | resetConvoState('user_cancelled') |

## J2 ship sequence

1. (前置) NWT (d) v2 ship + #6 _exportSnapshot
2. ship broker-state-authority.js 新建
3. 改 broker-buy-handler.js 加 prologue (~6 path)
4. 改 broker-sell-handler.js 加 prologue (~1 path)
5. 改 broker-llm-agent.js handleLlmDialog 加 R33 invariant post-process (R32 quoted_price guard 也在这层)
6. 改 conversations.js _r19Guard 之后加 _r32PriceGuard
7. lifecycle phase 转换 hooks 加进各 path
8. 跑全 broker domain regression 必 100% PASS
9. 跑 (a) 12 个 P0 case (含 owner 88 KAS journey + lifecycle phase + price oracle deviation) 必 100% PASS
10. 反复 5x stability 必 PASS
11. Owner spot-check trace 接受

## J1 R33 lint phase 2 design 求一致

J1 lint 应该 enforce:
- 任何 broker reply path 入口必含 `getConvoState(peer)` consult
- broker reply 含 EVM addr / price 数字 / direction word → 必有对应 R31/R32/R33 guard
- 新加 broker reply path 必在 broker-state-authority.js registry 注册

## ETA

- broker-state-authority.js: 30min
- 6+ paths prologue: 30min
- R32 price guard: 15min
- lifecycle hooks: 20min
- regression + stability + spot-check: 1h

总 ~3h, 跟 NWT (d) v2 ship + Owner spot-check 串行。
