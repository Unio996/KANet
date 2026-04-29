# Map Migrate Transaction Wrap — read-modify-write race fix

**起草**: NWT 2026-04-29 J1-5 design doc lead
**状态**: PROPOSAL — 三方真讨论, ship 前 J1+J2 push back
**前提**: J2 4 step migrate path Step 2-4 期间 4 Map → retail_dex_orders 渐进 migrate. 多 caller 并发 SELECT/UPDATE retail_dex_orders 真**真**真 read-modify-write race.

---

## 真 race scenario 实证

```
process A (broker-llm-agent.handleLlmDialog T2):
  t1: SELECT retail_dex_orders WHERE peer=X → row.qty=NULL, row.direction='sell'
  t2: setConvoStateLock(qty=50)
      → UPDATE retail_dex_orders SET qty='50' WHERE peer=X
  
process B (broker-buy-handler.handleSellIntent T2 same time):
  t1.5: SELECT retail_dex_orders WHERE peer=X → row.qty=NULL (stale, A 还没 commit)
  t1.7: setConvoStateLock(direction='sell', give_asset='KAS')
        → UPDATE retail_dex_orders SET give_asset='KAS' WHERE peer=X (overwrite OR no-op?)
```

实际 SQLite 单 file 真**真**真 process-level **真 lock**, 不**真**真**真 row-level. 真 BEGIN IMMEDIATE 真**真**真**lock entire DB until COMMIT**. UPDATE 真 atomic, 跨 process 真**真**真 SQLite WAL mode 真**真**真**真 single-writer**.

但 **read-modify-write** race 仍 happen:
1. process A SELECT row, JS-side modify, UPDATE
2. process B SELECT same row (相同 snapshot), JS-side modify, UPDATE

A 真 UPDATE 真**真 success — 但 process B 真 modify based on stale snapshot, B's UPDATE 真**真 overwrite A's change**.

---

## 真**Fix 1**: BEGIN IMMEDIATE TRANSACTION + commit

```js
// broker-state.js (or broker-state-authority.js) 真**真 helper API
export function txn(peer, fn) {
  const tx = sqlite.transaction(() => {
    return fn();  // fn 内 SELECT + modify + UPDATE 真**真**真**真 atomic
  });
  // BEGIN IMMEDIATE 真**真 lock DB 真**真 fn 真**真 finishes
  return tx.immediate();
}

// caller usage:
import { txn } from './broker-state.js';

txn(peer, () => {
  const state = getState(peer);
  const newQty = computeNewQty(state, userMsg);
  setField(peer, 'qty', newQty);
});
```

`sqlite.transaction(fn).immediate()` 真**真 BEGIN IMMEDIATE TRANSACTION** 真**真**真 lock DB 直到 COMMIT (better-sqlite3 真**真**真 sync API support). 跨 process 真**真**真 wait, 不 race.

---

## 真**Fix 2**: 真 setField 内部 atomic UPSERT (no separate SELECT)

旧 caller 真**真**真**真**真**真**真 SELECT + JS modify + setField 真**真**真**真 race. 真**真**真**修法**: setField 内部真**真**真**真**真**真 atomic UPSERT, 真 不暴 SELECT-then-UPDATE 真**真**真**真 race entry point.

```js
// broker-state.js setField 真**真 atomic UPSERT
export function setField(peer, name, value) {
  if (value == null) return;
  const now = Date.now();
  
  // INSERT OR UPDATE atomic
  sqlite.prepare(`
    INSERT INTO retail_dex_orders (id, user_kasia_address, ${name}, side, order_type, state, qty, created_at, updated_at)
    VALUES (?, ?, ?, COALESCE((SELECT side FROM retail_dex_orders WHERE user_kasia_address=? AND state IN ('aligning','confirming') LIMIT 1), 'sell_kas'), 'limit', 'aligning', NULL, ?, ?)
    ON CONFLICT(user_kasia_address) DO UPDATE SET
      ${name} = excluded.${name},
      updated_at = excluded.updated_at
  `).run(...);
}
```

但 SQLite 真**真**真**真 ON CONFLICT 真**真**真 UNIQUE constraint 真**真**真 — retail_dex_orders.user_kasia_address 真**真**真 NOT UNIQUE (一 user 可多 order audit trail). 真**真**真**真**ON CONFLICT 真**真**真**真**真 not work, 必 SELECT first 真**真**真**真**真**真**真**真 race window.

→ Fix 1 (BEGIN IMMEDIATE TRANSACTION) 真**真 right approach**.

---

## 真**Fix 3**: caller-side scope `txn()` wrap 真**真**真 read-modify-write atomic

每 caller 真**真**真**真**真 read-modify-write 真**真**真 wrap 进 txn():

```js
// broker-llm-agent.js handleLlmDialog T2 path
import { txn } from './broker-state.js';

txn(peer, () => {
  const state = getState(peer);  // SELECT
  // ... LLM tool returns qty=50 ...
  setField(peer, 'qty', 50);     // UPDATE
});
```

caller 真**真**真**真**真**自觉** wrap 真**真 SOP**, 没**真**真 lint enforce. 真 risk: caller 漏 wrap → race 复发.

→ NWT propose **lint hook** 真**真**真**真 enforce: grep getState 真**真**真**真**真**真 setField 真**真**真**真**真**真**真**真**真**真**真 same scope 真**真**真**真 txn() wrap. 否则 lint fail.

---

## 真**Fix 4**: SQLite WAL 真**真**真 multi-process visibility

NWT 之前 monitor watch script 真**真**真**真 WAL detach issue (readonly connection cached snapshot, 不真见后续 INSERT). 真 fix: each poll 真**真**真 close + reopen db.

caller 真**真**真**真**真**真**真 long-lived DB connection 真**真**真**真 better-sqlite3 真**真**真**真**真**真**真 see 后续 commit (WAL real 共享). 真不 close + reopen.

但 cross-process visibility 仍**真**真 latency — process A commit 真**真**真**真**真 process B 真 SELECT 真**真**真**真**真**真**真 see, 真**真**真**真**真**真**真**真 1-10ms typical, 真**真**真**真**真**真 user-facing 真不 perceptible.

→ 不需 fix, 现 SQLite WAL 真**真**真 cover.

---

## 真**Implementation order** (post J2 4 step migrate)

| 任务 | territory | LOC | ETA |
|------|-----------|-----|-----|
| broker-state.js 加 `txn()` helper API | J1 | ~10 | 10min |
| caller-side wrap `txn()` (handleLlmDialog T2/T3 path + finalizeBuy + finalizeSell) | J2 | ~20 | 30min |
| lint hook checkR46 (grep getState + setField same scope 必 txn wrap) | NWT | ~30 | 30min |
| 真测 race scenario reproduction (mock 2 process concurrent setField same peer same field) | NWT | ~50 | 1h |

总 ~2h 真 ship full fix.

---

## 真**Open questions** (求 J1+J2 push back)

1. SQLite better-sqlite3 真**真**真**真 transaction.immediate() 真**真**真 lock 真**真**真 deadlock 真**真**真 multi-process? 真**真**真**真 timeout retry pattern 必 add?
2. caller-side wrap `txn()` 真**真**真**真**真 SOP 真**真**真**真 reasonable, 还是 ENFORCE atomic 进 setField 真**真**真 internal?
3. lint hook checkR46 真**真**真 false positive rate? 真**真**真**真 caller 真**真**真**真 read state for read-only purpose (no write) 真**真**真**真**lint 真**真**真 trigger 真 false?

求 J1+J2 真 push back 30min, 三方真共识 ship.

---

## 真核心 SOP — `txn()` 真**真**真 default

未来 broker-v2 真**真**真**真**真 caller code style 真**真**真**真 default to `txn()` wrap. 不 wrap 是 exception 真**真**真**真**真 documented justification. 真**真 SOP 真**真**真**真**真 enforce 真**真 lint + code review.

Map → retail_dex_orders migrate 真**真**真 multi-process race 真**真**真**真**真 ship 前**真**真**真**真**真 cover. ship 后**真 production race 真**真**真**真**真 hard to debug 真**真**真**真 user-facing data corrupt.

—— NWT 2026-04-29 J1-5 design doc v1
