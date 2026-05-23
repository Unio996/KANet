// kasia-console/src/services/broker-state-machine.js
//
// 状态机唯一 transition owner. retail_dex_orders.state 任何变化必经此函数.
// 直 SQL UPDATE state → lint hard fail (R-NWT-STATE-MACHINE, SA-3 加).
//
// Owner 2026-04-30 钦定:
//   "我们花了那么多资源, 一直没有 '每个链上动作对应一个数据状态转换' 这条最基本原则
//   — 因为没人在做架构, 全在做 patches."
//
// 来源: docs/STATE-MACHINES.md v0.2 (NWT architect mode)
// Task: tasks/PZ-STATE-MACHINE-shipA.md SA-1 (5 const) + SA-2 (3 真函数 + 1 stub)
//
// 函数 export:
//   transition({orderId, expectedFromState, toState, opts, db}) — 唯一 transition entry (SA-2 真实施)
//   getOrderState(orderId, db)                                  — 强 latest read (SA-2 真实施)
//   findActiveOrder(peerAddr, db)                               — 仅返非 terminal state row (SA-2 真实施)
//   reconcileStaleOrders(db)                                    — SA-2 合法 stub (SA-5b 替真实施)
//
// db 参数 optional default sqlite (prod). test 传 in-memory testDb (per task v1.2 SA-5a 同模式).

import crypto from 'node:crypto';
import { sqlite as defaultDb } from '../db/client.js';

// ── 7 states ──
//   active (3): aligning / awaiting_payment / paid
//   terminal (4): completed / refunded / failed / expired
export const STATES = new Set([
  'aligning',
  'awaiting_payment',
  'paid',
  'completed',
  'refunded',
  'failed',
  'expired',
]);

export const ACTIVE_STATES = new Set([
  'aligning',
  'awaiting_payment',
  'paid',
]);

export const TERMINAL_STATES = new Set([
  'completed',
  'refunded',
  'failed',
  'expired',
]);

// ── 9 allowed transitions ── (per STATE-MACHINES.md v0.2 转换表)
// terminal state value 必为 empty Set (assert_1 守门).
export const ALLOWED_TRANSITIONS = {
  aligning: new Set(['awaiting_payment', 'expired', 'failed']),
  awaiting_payment: new Set(['paid', 'refunded', 'failed', 'expired']),
  paid: new Set(['completed', 'failed']),
  completed: new Set(),
  refunded: new Set(),
  failed: new Set(),
  expired: new Set(),
};

// ── chain TX hash 配对要求 (per toState) ──
// null = 不需 chain tx (e.g. aligning→awaiting_payment workflow marker only)
// 'paymentTxHash' / 'refundTxHash' / 'deliveryTxHash' = required field key in opts
// '_or_no_escrow' = refundTxHash OR opts.no_escrow=true (failed publish_failed before broker held funds)
// '_or_aligning' = aligning→expired 不需; awaiting_payment→expired 必 refundTxHash
export const TX_REQUIRED = {
  awaiting_payment: null,
  paid: 'paymentTxHash',
  refunded: 'refundTxHash',
  failed: 'refundTxHash_or_no_escrow',
  expired: 'refundTxHash_or_aligning',
  completed: 'deliveryTxHash',
};

// ── SA-2 真实施 (3 函数) + SA-2 合法 stub (1 函数) ──

/**
 * 唯一 transition entry. retail_dex_orders.state 任何变化必经此.
 *
 * CAS 双重语义 (per STATE-MACHINES.md v0.2 expectedFromState section):
 *   1. 查转换表 from 边: ALLOWED_TRANSITIONS[expectedFromState].has(toState) — 决定合法性
 *   2. CAS race protection: SQL UPDATE WHERE state=expectedFromState — race/stale read 时 changes=0 → ok:false
 *
 * @param {object} args
 * @param {string} args.orderId - retail_dex_orders.id
 * @param {string} args.expectedFromState - 当前状态 (caller 声明 "我以为它在 X")
 * @param {string} args.toState - 目标状态
 * @param {object} [args.opts] - {
 *   paymentTxHash?, refundTxHash?, deliveryTxHash?,  // chain TX evidence (64-hex)
 *   reason?,           // 'user_cancel' | 'self_deal' | 'TTL' | 'retry_exhausted' | ...
 *   no_escrow?,        // failed 时若 broker 未真收到 KAS 可标 (跳 refundTxHash 要求)
 *   triggeredBy?,      // caller name for audit log
 * }
 * @param {object} [args.db] - optional db handle (default sqlite from prod, test 传 testDb)
 * @returns {{ ok: boolean, transitionedAt?: string, error?: string }}
 * @throws if illegal transition OR required tx hash missing
 */
export function transition({ orderId, expectedFromState, toState, opts = {}, db = defaultDb }) {
  // 1. Validate fromState → toState in ALLOWED_TRANSITIONS
  const allowed = ALLOWED_TRANSITIONS[expectedFromState];
  if (!allowed) {
    throw new Error(`[state-machine] unknown fromState: ${expectedFromState}`);
  }
  if (!allowed.has(toState)) {
    throw new Error(`[state-machine] illegal transition: ${expectedFromState} → ${toState}`);
  }

  // 2. Validate required tx hash (per TX_REQUIRED)
  const required = TX_REQUIRED[toState];
  if (required === 'paymentTxHash' && !opts.paymentTxHash) {
    throw new Error(`[state-machine] paymentTxHash required for ${toState}`);
  }
  // SA-2.fix (NWT r79 reviewer hat): refunded TX_REQUIRED='refundTxHash' 不允许 no_escrow escape.
  // 仅 failed (TX_REQUIRED='refundTxHash_or_no_escrow') allowed no_escrow=true.
  if (required === 'refundTxHash' && !opts.refundTxHash) {
    throw new Error(`[state-machine] refundTxHash required for ${toState}`);
  }
  if (required === 'refundTxHash_or_no_escrow' && !opts.refundTxHash && !opts.no_escrow) {
    throw new Error(`[state-machine] refundTxHash or no_escrow required for failed`);
  }
  if (required === 'refundTxHash_or_aligning' && expectedFromState === 'awaiting_payment' && !opts.refundTxHash) {
    throw new Error(`[state-machine] refundTxHash required for awaiting_payment→expired`);
  }
  if (required === 'deliveryTxHash' && !opts.deliveryTxHash) {
    throw new Error(`[state-machine] deliveryTxHash required for ${toState}`);
  }

  // 3. SQL UPDATE atomic with CAS (WHERE state=expectedFromState)
  // schema column 名: pay_tx_hash / refund_tx_hash / deliver_tx_hash
  // COALESCE: opts 不传时不动现有列
  const result = db.prepare(`
    UPDATE retail_dex_orders
    SET state = ?,
        pay_tx_hash = COALESCE(?, pay_tx_hash),
        refund_tx_hash = COALESCE(?, refund_tx_hash),
        deliver_tx_hash = COALESCE(?, deliver_tx_hash),
        updated_at = datetime('now')
    WHERE id = ? AND state = ?
  `).run(
    toState,
    opts.paymentTxHash || null,
    opts.refundTxHash || null,
    opts.deliveryTxHash || null,
    orderId,
    expectedFromState
  );

  if (result.changes === 0) {
    return { ok: false, error: `state mismatch: expected ${expectedFromState}, row not in this state OR not exists` };
  }

  // 4. INSERT audit row
  // 真 chain TX (64-hex) → chain_events with 'broker_state_<to>' (撞 trigger 守 64-hex)
  // workflow marker (无 chain TX) → broker_workflow_markers with 'state_<to>'
  const txHash = opts.refundTxHash || opts.paymentTxHash || opts.deliveryTxHash || null;
  const isRealHash = txHash && /^[a-fA-F0-9]{64}$/.test(txHash);
  const auditPayload = JSON.stringify({
    order_id: orderId,
    from: expectedFromState,
    to: toState,
    reason: opts.reason || null,
    triggered_by: opts.triggeredBy || null,
    no_escrow: opts.no_escrow || false,
  });

  if (isRealHash) {
    db.prepare(`
      INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
      VALUES (?, ?, NULL, NULL, ?, ?, ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      txHash,
      `broker_state_${toState}`,
      auditPayload,
      'broker-state-machine.transition'
    );
  } else {
    db.prepare(`
      INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      `transition_${orderId.slice(0, 16)}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      `state_${toState}`,
      orderId,
      auditPayload
    );
  }

  return { ok: true, transitionedAt: new Date().toISOString() };
}

/**
 * 查 order 当前 state. v2 router / handlers 必经此读, 不许直 SQL SELECT state.
 * 强制 latest read (避免 stale cache).
 *
 * @param {string} orderId
 * @param {object} [db] - optional db handle (default sqlite, test 传 testDb)
 * @returns {object|null} - { state, pay_tx_hash, refund_tx_hash, deliver_tx_hash, updated_at } OR null
 */
export function getOrderState(orderId, db = defaultDb) {
  const row = db.prepare(`
    SELECT state, pay_tx_hash, refund_tx_hash, deliver_tx_hash, updated_at
    FROM retail_dex_orders
    WHERE id = ?
  `).get(orderId);
  return row || null;
}

/**
 * 从 peer 找 active order. 替 broker-v2/state.getActiveOrder.
 * v0.1 限制: 仅返非 terminal state row. 多 row → 返 most recent created.
 *
 * @param {string} peerAddr
 * @param {object} [db] - optional db handle
 * @returns {object|null} - { id, side, qty, state, pay_chain, pay_address, exchange_offer_id, created_at, updated_at } OR null
 */
export function findActiveOrder(peerAddr, db = defaultDb) {
  return db.prepare(`
    SELECT id, side, qty, state, pay_chain, pay_address, exchange_offer_id, created_at, updated_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state IN ('aligning', 'awaiting_payment', 'paid')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(peerAddr) || null;
}

/**
 * SA-5a — 检 broker (Trader-B) 钱包是否真持 N KAS 对应某 user 的 escrow.
 *
 * 实施: 不查实时 RPC balance (耗时), 用 kaspa_tx_log 历史推算.
 *   1. 查入金: peer→broker, observed_at>=orderCreatedAt, amount qty±0.5 KAS tolerance
 *   2. 查出金: broker→peer, observed_at>=orderCreatedAt (含 partial refund)
 *   3. 余额 = sum(入金) - sum(出金)
 *   4. 余额 >= qty - 0.5 (含 fee buffer) → escrowed=true
 *   5. 否则 escrowed=false (broker 真没收 OR 已退)
 *
 * **false negative 安全** (kaspa_tx_log.from_address 100% NULL 实证 — T-NWT-07 indexer 漏抓 sender,
 * outbound 匹配几乎全 miss). false neg (broker 真已退但仍判 escrow → 不 force-fail) 比
 * false pos (broker 没退但判已退 → force-fail 误退 active row) 安全得多. T-NWT-07 indexer 修后真精准.
 *
 * @param {string} peerAddr - user kasia 地址
 * @param {number} qty - 期望 escrow 数量 KAS (retail_dex_orders.qty)
 * @param {string} orderCreatedAt - retail_dex_orders.created_at (ISO string), 时间窗起点
 * @param {object} [db] - optional db handle (default sqlite, test 传 testDb)
 * @returns {boolean} - true=escrowed / false=no escrow OR 已退
 */
const TRADER_B_KAS_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

export function checkBrokerEscrow(peerAddr, qty, orderCreatedAt, db = defaultDb) {
  // 1. 入金: peer→broker, qty±0.5 KAS tolerance, observed_at>=orderCreatedAt
  const inbound = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM kaspa_tx_log
    WHERE to_address = ?
      AND observed_at >= ?
      AND amount BETWEEN ? AND ?
  `).get(TRADER_B_KAS_ADDR, orderCreatedAt, qty - 0.5, qty + 0.5);
  const inAmt = Number(inbound?.total || 0);
  if (inAmt === 0) return false;  // 真没入金

  // 2. 出金: broker→peer, observed_at>=orderCreatedAt
  // 注: kaspa_tx_log.from_address 100% NULL (T-NWT-07 indexer 漏抓), outbound 匹配几乎全 miss.
  const outbound = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM kaspa_tx_log
    WHERE from_address = ?
      AND to_address = ?
      AND observed_at >= ?
  `).get(TRADER_B_KAS_ADDR, peerAddr, orderCreatedAt);
  const outAmt = Number(outbound?.total || 0);

  // 3. 余额 >= qty - 0.5 (含 fee buffer) → escrowed
  return (inAmt - outAmt) >= (qty - 0.5);
}

/**
 * SA-5b — Cron sweep 找 stale awaiting_payment + 强转 'failed' (no_escrow=true).
 *
 * 替 SA-2 stub. 真实施: 查 DB + 调 checkBrokerEscrow + 调 transition() + (separately) cron schedule.
 *
 * 1h startup grace (跳 process_start + 1h 内的 row): 防 5 Agent stagger restart 期 第 1 cycle 误扫
 *   重启前 historical 'awaiting_payment' row (broker-intake-watcher 还没及处理).
 *
 * @param {object} [db] - optional db handle (default sqlite, test 传 testDb)
 * @returns {Promise<{ stale: number, forceFailed: number }>}
 */
export async function reconcileStaleOrders(db = defaultDb) {
  // 1h startup grace cutoff
  const graceCutoff = new Date(PROCESS_START_TIME + STARTUP_GRACE_MS).toISOString();

  // 找 awaiting_payment 30min+ 老 + 无 paymentTxHash + 无 broker_workflow_markers paid evidence
  // grace: 跳 process_start + 1h 内的 row (重启前历史 row 等下次 cycle)
  const stale = db.prepare(`
    SELECT id, user_kasia_address, qty, created_at FROM retail_dex_orders
    WHERE state = 'awaiting_payment'
      AND julianday('now') - julianday(created_at) > 30.0/1440.0
      AND id NOT IN (SELECT src_event_id FROM broker_workflow_markers WHERE event_type LIKE '%paid%')
      AND (datetime('now') > ? OR created_at >= ?)
    LIMIT 10
  `).all(graceCutoff, graceCutoff);

  let staleCount = stale.length, forceFailedCount = 0;
  for (const row of stale) {
    const escrowed = checkBrokerEscrow(row.user_kasia_address, parseFloat(row.qty), row.created_at, db);
    if (!escrowed) {
      const result = transition({
        orderId: row.id,
        expectedFromState: 'awaiting_payment',
        toState: 'failed',
        opts: {
          no_escrow: true,
          reason: 'reconcile_no_escrow',
          triggeredBy: 'reconcileStaleOrders',
        },
        db,
      });
      if (result.ok) forceFailedCount++;
    }
  }
  if (staleCount > 0 || forceFailedCount > 0) {
    console.log(`[broker-reconcile] ${staleCount} stale, ${forceFailedCount} force-failed (grace 1h post-restart)`);
  }
  return { stale: staleCount, forceFailed: forceFailedCount };
}

// SA-5b cron schedule + module-level cronStarted guard 防 setInterval 重注 (5 Agent 共享 console module)
const PROCESS_START_TIME = Date.now();
const STARTUP_GRACE_MS = 60 * 60 * 1000;  // 1h
let cronStarted = false;
let cronIntervalId = null;

/**
 * Start reconcileStaleOrders 15min cron tick.
 * Module-level guard 防多次 import 重复注册. caller 重复调 startReconcileCron() warn + skip.
 */
export function startReconcileCron() {
  if (cronStarted) {
    console.warn('[broker-reconcile] cron 已 started, skip 重复注册');
    return;
  }
  cronStarted = true;
  cronIntervalId = setInterval(async () => {
    try {
      await reconcileStaleOrders();
    } catch (e) {
      console.warn(`[broker-reconcile] tick err: ${e.message}`);
    }
  }, 15 * 60 * 1000);  // 15min
  console.log('[broker-reconcile] cron started, interval=15min, startup_grace=1h');
}

/**
 * Stop cron — 单元测试 cleanup; production 不调.
 */
export function stopReconcileCron() {
  if (cronIntervalId) {
    clearInterval(cronIntervalId);
    cronIntervalId = null;
    cronStarted = false;
  }
}
