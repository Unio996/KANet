# Atomic 3-Table Sync — 单一状态机核心 design

**起草**: NWT 2026-04-29 (Owner 02:53 钦定深入研究)
**状态**: PROPOSAL — 求 J1+J2 深入 review, J2 lead Track B 真 input

---

## 3 表角色

| 表 | 职责 | 关键字段 |
|---|------|---------|
| **retail_dex_orders** | broker 内部 order lifecycle | state, refund_tx_hash, qty, peer |
| **exchange_offers** | chain 上 publish 状态 | protocol_status, taker, broadcast_at |
| **chain_events** | chain TX audit trail | txid (chain hash), event_type, payload |

3 表 atomic update = chain TX hash + DB state 全表对齐, 不 partial 不 placeholder 不 race.

---

## 真核心 design challenge — chain TX async + 3 表同步

### Challenge 1: chain TX 是 async, 不可瞬间 atomic
- sendKas broadcast → wait txId resolve (RPC sync 30s+ typical)
- 持 BEGIN IMMEDIATE 真整 chain broadcast 期间 → 跨 process block 30s+
- 不持 lock → race (caller A 真 commit 前 caller B SELECT stale snapshot)

### Challenge 2: chain TX 不可回滚
- 一旦 broadcast 真 not rollback (链上不可逆)
- sendKas resolve 失败 (无 txId) → 真**真**真 chain 可能已 broadcast 真 not seen
- 不该 rely sendKas resolve return value 真 source-of-truth — 真 chain query (kaspa_tx_log) 才是

### Challenge 3: process crash 中间 → state 跨 phase 残留
- Phase 2 chain TX 已 broadcast 真 Phase 3 DB UPDATE 没 fire (process crash)
- restart 后 retail_dex_orders 真'refund_pending' state row + refund_tx_hash NULL → 怎么 reconcile?

---

## 真 propose — 3-Phase atomic pattern (non-blocking)

### Phase 1: Pre-commit (short txn, CAS lock)

```sql
BEGIN IMMEDIATE;
UPDATE retail_dex_orders
SET state = 'refund_pending', updated_at = datetime('now')
WHERE id = :order_id
  AND state IN ('expired', 'awaiting_payment', 'paid')   -- valid pre-condition
  AND refund_tx_hash IS NULL;                            -- idempotency invariant
COMMIT;
```

`rowsAffected=1` → caller 拿到 ownership lock, 进 Phase 2
`rowsAffected=0` → 另 caller 已拿 lock OR 已 refunded → return `{ alreadyRefunded: true, raced: true }`

DB lock 仅 held 真 SQL update (μs-level), Phase 2 chain TX 期间不持 lock.

### Phase 2: Chain TX broadcast (no txn)

```js
const txHash = await enqueueVerified({
  kind: 'sendKas',
  peer: orderPeer,
  payload: { amount_kas: refundAmt, note: `refund ${reason} ${order.id.slice(0,8)}` },
});
if (!txHash) {
  // sendKas fail — chain 真不 broadcast OR 真 broadcast 但 txId not seen
  // Phase 3 真 reconcile cron 真**真 chain query (kaspa_tx_log) 真 verify
  return { ok: false, txHashMissing: true, leaveInPending: true };
}
```

无 DB lock 期间. caller B 真 Phase 1 truthful — 'refund_pending' state 真**真 caller A 已拿 lock**, caller B 不 fire chain TX.

### Phase 3: Post-commit (short txn, 3 表 atomic)

```sql
BEGIN IMMEDIATE;

-- 3.1 retail_dex_orders 'refund_pending' → 'refunded'
UPDATE retail_dex_orders
SET state = 'refunded', refund_tx_hash = :tx_hash, updated_at = datetime('now')
WHERE id = :order_id
  AND state = 'refund_pending'
  AND refund_tx_hash IS NULL;
-- rowsAffected=1 → success, =0 → race (concurrent reconciler 已 fire) → no harm

-- 3.2 exchange_offers protocol_status 真 transition 'refunded' (terminal, idempotent)
UPDATE exchange_offers
SET protocol_status = 'refunded', updated_at = datetime('now')
WHERE id = (SELECT exchange_offer_id FROM retail_dex_orders WHERE id = :order_id)
  AND protocol_status IN ('open', 'expired', 'timed_out');
-- 'cancelled'/'matched' 真 leave alone (terminal OR 已被 taker 接 dispute path)

-- 3.3 chain_events 真 chain hash, 不 placeholder, 不重复
INSERT INTO chain_events (id, txid, event_type, payload, observed_by, observed_at)
SELECT lower(hex(randomblob(16))), :tx_hash, 'broker_kas_refunded', :payload_json, 'state-machine', datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM chain_events WHERE txid = :tx_hash AND event_type = 'broker_kas_refunded'
);
-- 真 already chain_events 'broker_kas_refunded' 真 same txid → no-op (idempotent INSERT)

COMMIT;
```

3 SQL same txn = atomic 3 表 update. chain_events.txid 真 chain hash, retail_dex_orders.refund_tx_hash 同 hash, exchange_offers 真 align.

---

## Recovery path (process crash 中间)

### Reconciler cron (broker-state-reconciler.js, 5min tick)

```sql
-- pending refund 真**真 stuck > 5min → 真 chain query 真 reconcile
SELECT id, qty, peer, exchange_offer_id, updated_at
FROM retail_dex_orders
WHERE state = 'refund_pending'
  AND refund_tx_hash IS NULL
  AND updated_at < datetime('now', '-5 minutes');
```

每 row:
1. **chain query verify**: kaspa_tx_log SELECT outbound TX 真 peer + amount + timestamp range (last 1h)
   - 找到 → Phase 3 backfill (txHash from kaspa_tx_log)
   - 没找到 → 真 chain 没 broadcast → Phase 2 retry
2. **age > 1h + chain 真没 TX** → alert Owner (events 表 source='reconciler', level='alert'). 真 manual review.

### kaspa_tx_log 真 source-of-truth

J1 4/13 ship Kaspa TX indexer (memory `project_kaspa_indexer`). broker 真 outbound TX 必先 indexed kaspa_tx_log → reconciler 真 verify chain truth. 不 rely sendKas resolve return.

---

## Idempotency invariant — multi-layer

| Phase | Invariant | SQL guard |
|-------|-----------|-----------|
| Phase 1 | refund_tx_hash IS NULL AND state pre_refund | UPDATE WHERE clause CAS |
| Phase 2 | sendKas resolve 真 idempotent (broker-action-queue dedup by note?) | 待 J2 verify |
| Phase 3.1 | state='refund_pending' AND refund_tx_hash IS NULL | UPDATE WHERE CAS |
| Phase 3.3 | NOT EXISTS chain_events.txid match | INSERT WHERE NOT EXISTS |

任 1 phase 真 race 检测 → return early. 真 idempotent 跨 process + 跨 caller (cron + cancel handler).

---

## 7 真 open question — 求 J1+J2 review

### Q1: enqueueVerified sendKas 真 idempotent 吗?

`broker-action-queue.js enqueueVerified` 真 caller 重复 enqueue 真 same { kind: 'sendKas', peer, amount } → 真**真**真 dedup? OR fire 多次 chain TX? 待 J2 grep verify.

如果不 idempotent → Phase 1 CAS lock 真 sufficient (caller B 真 Phase 1 fail return early, 不 enqueue), 真 J2 verify 真**真 critical**.

### Q2: BEGIN IMMEDIATE 真 multi-process deadlock 真 timeout retry?

better-sqlite3 真 BEGIN IMMEDIATE 真 lock-wait timeout default? 真**真 deadlock detect 真 retry?

如 timeout 短 → caller B 真**真 false-fail** (Phase 1 真 timeout error 真**不 lock**) → 真**真**真**真**真**真 confused state. 真 retry pattern 必加.

### Q3: Phase 2 chain TX 真 timeout policy

sendKas 真 resolve timeout (e.g. RPC 30s)? broker-action-queue Layer 2 真**真 retry policy**. 真**真 sync wait Phase 2 真 caller block 30s+** 真**真 caller 真 user-facing reply latency**? OR async detach 真 reconciler 真 backfill?

J2 territory verify.

### Q4: chain_events.txid UNIQUE constraint 真存在?

NOT EXISTS subquery 真**真 race window** — caller A 真 SELECT NOT EXISTS true, caller B 真 SELECT NOT EXISTS true, 同时 INSERT → 真两条记录. 真 chain_events.txid 真**真 UNIQUE constraint** 必加 (DDL 真**真 schema verify**), 否则 INSERT WHERE NOT EXISTS 真**真 enough.

J1 territory verify schema + ALTER if needed.

### Q5: exchange_offers.protocol_status 真 'refunded' 真 enum 真**真 valid?

current CHECK constraint 真**真 includes 'refunded' value 吗? 真**真 CHECK 真 reject INSERT/UPDATE → Phase 3.2 fail. 真 schema verify + ALTER if missing.

### Q6: Multi-order per peer 真 cancel 真 routing

user 'cancel' DM 真 multi orders active (e.g. peer 真 2 个 awaiting_payment 真 historical offer + 1 个 aligning current draft):
- 真 routing 真 ALL → 真 双重退款 风险**真 again**
- 真 routing 真 latest only → 真 historical 永留 stale (cron 真 reconcile 真 backfill)
- 真 routing 真 ask user → user 真**真 confused

NWT propose: 'aligning'/'confirming' 真 current draft 真 clear 真不 fire chain TX. 'awaiting_payment'/'paid'/'expired' 真 historical 真 routing 真 ALL (each 走 advanceToRefunded API single-fire idempotent).

### Q7: cron 真 5min tick 真 reconciler frequency

reconciler cron 真**真 5min tick 真**真 frequent (broker-intake-watcher 同 5min). 真**真 stuck refund_pending row 真 5min recovery 真 acceptable. 真 user-facing 真 'refund 1-5min 内到账' 真 promised SLA.

如 reconciler tick 太长 → 真 stuck refund_pending row 长期 visible 真 frontend → user 真 anxiety.

---

## 三方分工 propose (post design 三方共识)

| # | task | territory | LOC | ETA |
|---|------|-----------|-----|-----|
| A | broker-state-machine.js advanceToRefunded API ship | J2 lead Track B | ~150 | 2h |
| B | broker-cancel-refund.js refactor 真 advanceToRefunded route | J2 | ~50 | 1h |
| C | broker-intake-watcher.js _scanExpiredBrokerOffers refactor | J2 | ~30 | 30min |
| D | broker-state-reconciler.js cron ship (Phase 2 crash recovery) | J1 | ~80 | 1.5h |
| E | migrate v83 chain_events.txid UNIQUE + exchange_offers.protocol_status 'refunded' enum 加 | J1 | ~30 | 30min |
| F | NWT double_refund_idempotency runner action ship | NWT | ~50 | 30min |
| G | NWT cross-host pull + restart + 测 verify post A-E | NWT | run | 30min |

总 ~5h ship 真 atomic 3-table sync. Fix D kill switch (J2 5min) 真 stop bleeding 期间.

---

## 求 J1+J2 review 真深度

求 J1+J2 30min review 真 7 question + 3-Phase pattern + 真 reconciler crash recovery 真 covered? 漏 corner case? 修订 design?

不**真**直接分工开干. design align 后再 ship.

—— NWT 2026-04-29 atomic 3-table sync design v1
