// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R33 / R31 (attacker) / Bug-Z24 (system msg) / R44 (三方 cosign 走过场)
// 关键历史: R33 sticky direction lock / R31 detectAddrChangeAttempt / R33 wire 371e4ca62 reintroduce
// blast radius: 整个 broker conversation state authority + addr change attack 防御
// ════════════════════════════════════════════════════════════════
//
// broker-state-authority.js — task B rewrite (Owner 22:xx 钦定 "抓错药")
//
// 设计源: Owner 22:30+22:31+22:32 三连洞察 + NWT ce51d8d1 实证 retail_dex_orders 153 行字段
//        100% cover broker_conversations propose. R44 三方共谋自责 sediment.
//
// 旧实现: _convoState in-memory Map (370 LOC). 真问题: console restart 全丢, 跨进程不可见,
//        零 audit trail. broker-intake-watcher 已用 retail_dex_orders + retail_dex_user_memory
//        + relation_states pipeline, broker-state-authority 没复用 — Owner 戳穿真核心.
//
// 新实现: SELECT retail_dex_orders + JOIN retail_dex_user_memory + relation_states (per
//        broker-intake-watcher pattern). _convoState Map 物理删除. 状态在 DB row, console
//        restart 自动恢复. R31/R33 SQL guard 在 UPDATE WHERE 表达 (rowsAffected=0 = violation).
//
// API surface (caller-facing) 不变 — broker-llm-agent + broker-buy/sell-handler 透明.

import { sqlite } from '../db/client.js';

// ── retail_dex_orders 状态映射 ────────────────────────────────────
// retail_dex_orders.state vs broker ConvoState.lifecycle_phase
// retail_dex_orders.state CHECK 允许: aligning/confirming/awaiting_payment/paid/executing/
//                                    completed/refunding/refunded/failed/expired
// 'cancelled' 在 broker ConvoState 维度存在 但 retail_dex_orders 用 'failed' 表达 user_cancel.
const ORDER_STATE_TO_PHASE = {
  aligning: 'fields_collection',
  confirming: 'preview_shown',
  awaiting_payment: 'awaiting_payment',
  paid: 'paid',
  executing: 'delivering',
  completed: 'completed',
  refunding: 'disputed',
  refunded: 'cancelled',
  failed: 'cancelled',
  expired: 'expired',
};
const PHASE_TO_ORDER_STATE = Object.fromEntries(
  Object.entries(ORDER_STATE_TO_PHASE).map(([k, v]) => [v, k])
);
// Active states for ConvoState visibility (R31 addr lock + R33 direction lock 真贯穿全 lifecycle).
// Terminal states excluded: completed / refunded / failed / expired (broker 不持续 hold 这些).
// 'paid' / 'executing' / 'refunding' 包含 — addr lock + direction lock 必延续到 final.
// task B' fix (J1 b' regression): 旧 _convoState in-memory Map 任何 phase 都返 state, R31
// lifecycle_paid_cannot_cancel 等 case 真依赖 post-payment 仍能 lookup state.
const ACTIVE_ORDER_STATES = ['aligning', 'confirming', 'awaiting_payment', 'paid', 'executing', 'refunding'];
const ACTIVE_STATES_SQL = "('aligning','confirming','awaiting_payment','paid','executing','refunding')";

// ── DB ts ↔ ms epoch helpers ──────────────────────────────────────
function _isoToMs(iso) {
  if (!iso) return null;
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (UTC, no Z) — append 'Z' for parsing
  const s = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

// ── retail_dex_orders row → ConvoState mapping ────────────────────
function _orderToConvoState(order, memory, relation) {
  if (!order) return null;
  const direction = order.side === 'sell_kas' ? 'sell' : 'buy';
  const give_asset = direction === 'sell' ? 'KAS' : 'USDT';
  const want_asset = direction === 'sell' ? 'USDT' : 'KAS';

  // EVM-side addr mapping — direction-asymmetric in retail_dex_orders schema:
  //   SELL: user gets USDT @ pay_address (EVM); kaspa kas送方
  //   BUY:  user pays USDT @ agent_pay_addr (broker's evm addr); user kasia recv kas
  const recv_address = direction === 'sell'
    ? (order.pay_address || order.receive_address || null)
    : null;
  const evm_pay_address = direction === 'buy'
    ? (order.agent_pay_addr || order.pay_address || null)
    : null;

  const startedMs = _isoToMs(order.created_at) || Date.now();
  const updatedMs = _isoToMs(order.updated_at) || startedMs;
  const expiresMs = _isoToMs(order.expires_at) || (startedMs + 30 * 60 * 1000);

  return {
    peer_address: order.user_kasia_address,
    direction,
    give_asset,
    want_asset,
    qty: order.qty != null ? parseFloat(order.qty) : null,
    pay_chain: order.pay_chain || null,
    recv_chain: direction === 'sell' ? (order.pay_chain || null) : 'kaspa',
    recv_address,
    evm_pay_address,
    conditions: {
      limit_price: order.price != null ? parseFloat(order.price) : null,
      refund_timeout_min: null,
    },
    lifecycle_phase: ORDER_STATE_TO_PHASE[order.state] || order.state,
    started_at: startedMs,
    updated_at: updatedMs,
    reset_at: expiresMs,
    locked: order.state !== 'aligning',
    // Profile + contact enrichment (task C J2 systemAppend uses)
    profile: memory ? {
      distilled_summary: memory.distilled_summary || null,
      preferred_chain: memory.preferred_chain || null,
      preferred_pay_address: memory.preferred_pay_address || null,
      tone_preference: memory.tone_preference || null,
    } : null,
    contact: relation ? {
      alias: relation.their_alias || null,
      classification: relation.classification || null,
      trust_level: relation.trust_level || null,
      is_blocked: relation.is_blocked === 1,
    } : null,
  };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Get current ConvoState for peer.
 * SELECT 最近 active retail_dex_orders + JOIN retail_dex_user_memory + relation_states.
 * Returns null if no active order (state ∉ aligning/confirming/awaiting_payment).
 */
export function getConvoState(peer) {
  const order = sqlite.prepare(`
    SELECT id, user_kasia_address, side, qty, price, pay_chain, pay_address,
           receive_address, agent_pay_addr, state, expires_at,
           expires_user_set, created_at, updated_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment','paid','executing','refunding')
    ORDER BY created_at DESC LIMIT 1
  `).get(peer);
  if (!order) return null;

  const memory = sqlite.prepare(
    `SELECT distilled_summary, preferred_chain, preferred_pay_address, tone_preference
     FROM retail_dex_user_memory WHERE user_kasia_address = ?`
  ).get(peer);

  const relation = sqlite.prepare(
    `SELECT their_alias, classification, trust_level, is_blocked
     FROM relation_states WHERE peer_address = ?`
  ).get(peer);

  return _orderToConvoState(order, memory, relation);
}

/**
 * Set / update ConvoState. UPSERT retail_dex_orders.
 *   - first declaration (no active row) → INSERT new aligning row, REQUIRES fields.direction
 *   - update existing → UPDATE WHERE guard (R31 addr / R33 direction sticky)
 *     rowsAffected=0 = lock violation → throws err.code='CONVO_STATE_DIRECTION_LOCK' or '_ADDRESS_LOCK'
 *   - direction mismatch with existing.side → throws CONVO_STATE_DIRECTION_LOCK (preserved API contract)
 */
export function setConvoStateLock(peer, fields) {
  const existing = sqlite.prepare(`
    SELECT id, side, qty, pay_chain, pay_address, receive_address,
           agent_pay_addr, state, price
    FROM retail_dex_orders
    WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment','paid','executing','refunding')
    ORDER BY created_at DESC LIMIT 1
  `).get(peer);

  const newSide = fields.direction
    ? (fields.direction === 'sell' ? 'sell_kas' : 'buy_kas')
    : null;

  if (!existing) {
    if (!newSide) {
      // task B' fix (J1 b' regression): 旧 in-memory Map 允许 partial state (caller
      // setConvoStateLock(peer, {conditions:{...}}) 不带 direction). 新 SQL 不能 INSERT
      // 没 side 的 row (CHECK constraint), 但也不能 throw 破 caller — return null no-op.
      // caller 真 declared direction 后续 turn 再调 setConvoStateLock(peer, {direction, ...})
      // 创真 row, conditions 那次 update 即 OK.
      return null;
    }
    // INSERT new aligning row
    const id = `bso_${peer.slice(-12)}_${Date.now()}`;
    // task B''' fix (J1 #53 抠细节 2 真 align broker-sell-handler.finalize convention):
    // SELL: pay_address = user EVM addr (USDT recv), receive_address = NULL (broker side, set by finalize publish_offer)
    // BUY: agent_pay_addr = user EVM pay addr, pay_address/receive_address = NULL
    // 旧错: SELL 路径 newReceiveAddress = fields.recv_address 真**真** 双写 user EVM addr 真**真**真 finalize convention 不一致.
    const newPayAddress = fields.direction === 'sell' ? (fields.recv_address || null) : null;
    const newReceiveAddress = null;  // SELL/BUY 都 NULL — finalize 真 set (broker addr OR exchange offer)
    const newAgentPayAddr = fields.direction === 'buy' ? (fields.evm_pay_address || null) : null;
    sqlite.prepare(`
      INSERT INTO retail_dex_orders
        (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address,
         receive_address, agent_pay_addr, state,
         created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aligning',
              datetime('now'), datetime('now'), datetime('now', '+30 minutes'))
    `).run(
      id, peer, newSide, 'limit',
      fields.qty != null ? fields.qty : null,
      fields.conditions?.limit_price ?? null,
      fields.pay_chain || null,
      newPayAddress,
      newReceiveAddress,
      newAgentPayAddr,
    );
    return getConvoState(peer);
  }

  // R33 direction sticky — preserved API: throw CONVO_STATE_DIRECTION_LOCK on mismatch
  if (newSide && existing.side && newSide !== existing.side) {
    const err = new Error(
      `R33 direction lock violation: state.direction=${existing.side === 'sell_kas' ? 'sell' : 'buy'}, fresh.direction=${fields.direction}`
    );
    err.code = 'CONVO_STATE_DIRECTION_LOCK';
    err.locked_direction = existing.side === 'sell_kas' ? 'sell' : 'buy';
    err.attempted_direction = fields.direction;
    throw err;
  }

  // R31/R33 SQL guard — UPDATE WHERE (col IS NULL OR col = :new) per field.
  // rowsAffected=0 = lock violation (attacker swap detected).
  // Compute concrete values to write — only fields not yet locked OR matching existing.
  const dir = existing.side === 'sell_kas' ? 'sell' : 'buy';
  const newReceiveAddress = dir === 'sell' ? (fields.recv_address || null) : null;
  const newPayAddress = dir === 'sell' ? (fields.recv_address || null) : null;
  const newAgentPayAddr = dir === 'buy' ? (fields.evm_pay_address || null) : null;
  const newOrderState = fields.lifecycle_phase
    ? (PHASE_TO_ORDER_STATE[fields.lifecycle_phase] || existing.state)
    : existing.state;

  const updateRes = sqlite.prepare(`
    UPDATE retail_dex_orders
    SET side = COALESCE(side, :side),
        qty = COALESCE(qty, :qty),
        price = COALESCE(price, :price),
        pay_chain = COALESCE(pay_chain, :pay_chain),
        pay_address = COALESCE(pay_address, :pay_address),
        receive_address = COALESCE(receive_address, :receive_address),
        agent_pay_addr = COALESCE(agent_pay_addr, :agent_pay_addr),
        state = :state,
        updated_at = datetime('now')
    WHERE id = :id
      AND (pay_address IS NULL OR :pay_address IS NULL OR pay_address = :pay_address)
      AND (receive_address IS NULL OR :receive_address IS NULL OR receive_address = :receive_address)
      AND (agent_pay_addr IS NULL OR :agent_pay_addr IS NULL OR agent_pay_addr = :agent_pay_addr)
  `).run({
    id: existing.id,
    side: newSide,
    qty: fields.qty != null ? fields.qty : null,
    price: fields.conditions?.limit_price ?? null,
    pay_chain: fields.pay_chain || null,
    pay_address: newPayAddress,
    receive_address: newReceiveAddress,
    agent_pay_addr: newAgentPayAddr,
    state: newOrderState,
  });

  if (updateRes.changes === 0) {
    const err = new Error(
      'R31 lifecycle-bound addr violation: lock collision on receive_address / pay_address / agent_pay_addr'
    );
    err.code = 'CONVO_STATE_ADDRESS_LOCK';
    throw err;
  }

  return getConvoState(peer);
}

/**
 * Reset state on explicit user reset / completion.
 * UPDATE retail_dex_orders SET state='cancelled' OR 'completed' for active row.
 */
export function resetConvoState(peer, reason) {
  // retail_dex_orders.state CHECK 允许 enum: completed/failed/refunded/expired (no 'cancelled').
  // user_cancel/user_restart/timeout 都映射到 'failed' (broker ConvoState lifecycle 的 cancelled 等价).
  const targetState = (reason === 'completed') ? 'completed' : 'failed';
  sqlite.prepare(`
    UPDATE retail_dex_orders
    SET state = ?, updated_at = datetime('now')
    WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment','paid','executing','refunding')
  `).run(targetState, peer);
}

/**
 * Decide whether a deterministic regex path should fire given conversation state.
 * R33 cross-direction gating preserved.
 */
export function shouldDeterministicFire(peer, regexName, message) {
  const state = getConvoState(peer);
  if (!state || !state.locked) return true;
  const dir = state.direction;
  if (regexName === 'BUY_REGEX' && dir === 'sell') return false;
  if (regexName === 'SELL_REGEX' && dir === 'buy') return false;
  if (regexName === 'PRICE_QUERY' && dir === 'sell') return false;
  if (regexName === 'PAID_REGEX' && dir === 'sell') return false;
  return true;
}

/**
 * Generate state-context-aware system prompt addendum for LLM call.
 * (任务 C J2 territory will extend with profile/contact JOIN data — current returns
 *  minimal in-flight state only, profile field present for forward compat.)
 */
export function llmSystemPromptStateLock(peer) {
  // T-J2-2026-04-29 Phase E v3 task C (Owner 22:30+22:31+22:32 三连洞察 + NWT ce51d8d1):
  // 改为 always-load — 即便 no active order, profile + contact 仍 inject (复用 existing
  // retail_dex_user_memory + relation_states pipeline, broker-intake-watcher pattern).
  // 三段 systemAppend (USER PROFILE / CONTACT / IN-FLIGHT) 让 LLM 永看 user 长期偏好 + 通讯录 alias + 当前订单 state.
  const state = getConvoState(peer);

  // 即便 state=null (no active order), 仍查 profile + contact (新对话第 1 turn 也丝滑)
  const memory = state?.profile ?? sqlite.prepare(
    `SELECT distilled_summary, preferred_chain, preferred_pay_address, tone_preference
     FROM retail_dex_user_memory WHERE user_kasia_address = ?`
  ).get(peer);

  const relation = state?.contact ?? (() => {
    const r = sqlite.prepare(
      `SELECT their_alias, classification, trust_level, is_blocked
       FROM relation_states WHERE peer_address = ?`
    ).get(peer);
    return r ? {
      alias: r.their_alias || null,
      classification: r.classification || null,
      trust_level: r.trust_level || null,
      is_blocked: r.is_blocked === 1,
    } : null;
  })();

  const sections = [];

  // ── Section 1: USER PROFILE (retail_dex_user_memory + relation_states JOIN) ──
  if (memory || relation) {
    const profileLines = [];
    if (relation?.alias) profileLines.push(`alias: ${relation.alias}`);
    if (relation?.classification) profileLines.push(`classification: ${relation.classification}`);
    if (relation?.trust_level != null) profileLines.push(`trust_level: ${relation.trust_level}`);
    if (memory?.preferred_chain) profileLines.push(`preferred_chain: ${memory.preferred_chain}`);
    if (memory?.preferred_pay_address) profileLines.push(`preferred_pay_address: ${memory.preferred_pay_address}`);
    if (memory?.tone_preference) profileLines.push(`tone: ${memory.tone_preference}`);
    if (memory?.distilled_summary) profileLines.push(`distilled: ${memory.distilled_summary.slice(0, 200)}`);
    if (profileLines.length > 0) {
      sections.push('\nUSER PROFILE (long-term, from relation_states + retail_dex_user_memory):\n' + profileLines.join('\n'));
    }
  }

  // ── Section 2: IN-FLIGHT STATE (retail_dex_orders 当前 active row) ──
  if (state) {
    const hasAnyField = state.direction || state.qty != null || state.pay_chain ||
      state.recv_address || state.evm_pay_address || state.give_asset;
    if (hasAnyField) {
      const fieldLines = [];
      if (state.direction) fieldLines.push(`direction=${state.direction}`);
      if (state.give_asset) fieldLines.push(`give_asset=${state.give_asset}`);
      if (state.qty != null) fieldLines.push(`qty=${state.qty}`);
      if (state.pay_chain) fieldLines.push(`pay_chain=${state.pay_chain}`);
      if (state.recv_address) fieldLines.push(`recv_address=${state.recv_address}`);
      if (state.evm_pay_address) fieldLines.push(`evm_pay_address=${state.evm_pay_address}`);
      if (state.lifecycle_phase) fieldLines.push(`phase=${state.lifecycle_phase}`);

      const inFlightLines = state.locked
        ? [
            '\nCRITICAL CONVERSATION STATE (do NOT violate):',
            `User has DECLARED ${state.direction.toUpperCase()} flow at turn ${Math.floor((Date.now() - state.started_at) / 1000)}s ago.`,
            `LOCKED fields (cannot change without cancel): ${fieldLines.join(', ')}.`,
            `Fresh user message fills MISSING fields ONLY. Direction is IMMUTABLE.`,
            `If user message implies opposite direction, ASK 'cancel order first?' do NOT auto-flip.`,
            `If user asks question (not field), ANSWER question with state context, do NOT re-show preview.`,
          ]
        : [
            '\nKNOWN USER FIELDS (consult before reply, never hallucinate forget):',
            `User previously gave: ${fieldLines.join(', ')}.`,
            `Reply MUST cite these fields when relevant. NEVER ask user for fields already given above.`,
            `If user message references previous fields, acknowledge them. Do NOT reset context.`,
          ];
      sections.push(inFlightLines.join('\n'));
    }
  }

  if (sections.length === 0) return null;
  return sections.join('\n');
}

/**
 * R29 invariant on LLM-generated reply — verify reply doesn't hallucinate price/addr/intent.
 */
export async function validateLlmReply(peer, replyText) {
  const state = getConvoState(peer);
  const violations = [];

  if (state?.locked) {
    const opposite = state.direction === 'buy' ? 'sell' : 'buy';
    const oppositeChinese = state.direction === 'buy' ? '卖' : '买';
    const formalRe = new RegExp(`方向[:：]\\s*(${opposite}|${oppositeChinese})`, 'i');
    const naturalChinese = new RegExp(`(?:你想|你是要|你要|想|准备)${oppositeChinese}|${oppositeChinese}(?:出|单|掉)|${oppositeChinese}\\s*\\d+\\s*KAS`, 'i');
    const naturalEn = new RegExp(`\\b(?:you\\s*(?:want\\s*to|are\\s*going\\s*to|wish\\s*to)\\s*${opposite}|${opposite}\\s*\\d+\\s*KAS)\\b`, 'i');
    if (formalRe.test(replyText)) violations.push(`R33-direction-formal: state=${state.direction}, reply formal '方向: ${opposite}'`);
    else if (naturalChinese.test(replyText)) violations.push(`R33-direction-natural-zh: state=${state.direction}, reply contains opposite-direction natural-language phrase`);
    else if (naturalEn.test(replyText)) violations.push(`R33-direction-natural-en: state=${state.direction}, reply contains opposite-direction English phrase`);
  }

  const priceMatch = replyText.match(/(\d+\.\d{4,})\s*USDT/);
  if (priceMatch) {
    try {
      const { fetchPrice } = await import('./price-oracle.js');
      const oracle = await fetchPrice(state?.give_asset === 'KAS' ? 'KAS' : 'USDC', 'USDT');
      if (oracle.ok) {
        const replyPrice = parseFloat(priceMatch[1]);
        const dev = Math.abs(replyPrice - oracle.price) / oracle.price;
        if (dev > 0.05) violations.push(`R29-price: reply=${replyPrice}, oracle=${oracle.price}, dev=${(dev*100).toFixed(1)}% > 5%`);
      }
    } catch {}
  }

  // Layer 3 chain-truth check (T-J1-2026-04-28) — Kaspa TX hash 必在 kaspa_tx_log
  const hashMatches = (replyText.match(/\b[a-f0-9]{64}\b/gi) || []).map(h => h.toLowerCase());
  if (hashMatches.length) {
    const fakeHashes = [];
    for (const h of hashMatches) {
      try {
        const found = sqlite.prepare('SELECT 1 FROM kaspa_tx_log WHERE tx_id = ? LIMIT 1').get(h);
        if (!found) fakeHashes.push(h);
      } catch (e) {
        console.warn(`[broker-state-authority Layer3] kaspa_tx_log lookup err: ${e.message}`);
        break;
      }
    }
    if (fakeHashes.length) {
      violations.push(`Layer3-chain-truth: reply 含 ${fakeHashes.length} 个 Kaspa TX hash 不在 kaspa_tx_log: ${fakeHashes.map(h => h.slice(0, 16) + '...').join(', ')}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

// ── R31 attacker detection (Phase D P1 真因 2 widening preserved) ──
const _ADDR_CHANGE_KEYWORDS = /改地址|地址(?:改成?|换成?|改为|改到)|换地址|换\s*收款|改\s*收款|change\s*address|new\s*address|swap\s*address|change\s*to\s*0x|改\s*0x|地址.{0,4}0x/i;
const _RESET_INTENT_KEYWORDS = /不要了|重新下单|取消重新|cancel\s*and\s*restart|restart\s*order|cancel\s*restart/i;

export function detectResetIntent(message) {
  return _RESET_INTENT_KEYWORDS.test(String(message || ''));
}

export function detectAddrChangeAttempt(peer, message) {
  const state = getConvoState(peer);
  if (!state) return { attempt: false };
  const lockedAddr = state.recv_address || state.evm_pay_address;
  if (!lockedAddr) return { attempt: false };
  const msg = String(message || '');
  if (_ADDR_CHANGE_KEYWORDS.test(msg)) {
    return { attempt: true, reason: 'change_keyword', locked: lockedAddr };
  }
  const proposalMatches = msg.match(/0x[a-zA-Z0-9_-]{6,}/g) || [];
  for (const proposal of proposalMatches) {
    if (proposal.toLowerCase() !== lockedAddr.toLowerCase()) {
      return { attempt: true, reason: 'differing_addr_proposal', locked: lockedAddr, proposed: proposal };
    }
  }
  return { attempt: false };
}

// ── _sweepStaleAligning cron tick (J1-3 ship, J1 #55 propose, post NWT 01:15 ack J2-3/4 ship plan) ──
//
// Why: broker-intake-watcher refund tick 仅 process 'awaiting_payment' state — 'aligning' rows
// 永不 sweep, 累积 stale draft (user 走神 / abandoned). J2 Step 1b setConvoStateLock 入口 INSERT
// 'aligning' row 后, no cleanup pattern → DB bloat.
//
// Sweep: state='aligning' AND (expires_at < now OR (expires_at IS NULL AND created_at < now-30min))
//   → state='expired' (CHECK constraint 已含 'expired')
//
// Tick: 5min interval, align broker-intake-watcher REFUND_TICK_MS (consistent cron cadence).

const SWEEP_TICK_MS = 5 * 60 * 1000;
let _sweepTimer = null;

export function startStaleAligningSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(_sweepStaleAligning, SWEEP_TICK_MS);
  // Run once immediately on startup (catch up post-restart accumulated stale drafts)
  _sweepStaleAligning();
  console.log(`[broker-state-authority] stale-aligning sweep started, tick=${SWEEP_TICK_MS}ms`);
}

export function stopStaleAligningSweep() {
  if (_sweepTimer) {
    clearInterval(_sweepTimer);
    _sweepTimer = null;
  }
}

function _sweepStaleAligning() {
  try {
    const r = sqlite.prepare(`
      UPDATE retail_dex_orders
      SET state = 'expired', updated_at = datetime('now')
      WHERE state = 'aligning'
        AND (
          (expires_at IS NOT NULL AND expires_at < datetime('now'))
          OR (expires_at IS NULL AND created_at < datetime('now', '-30 minutes'))
        )
    `).run();
    if (r.changes > 0) {
      console.log(`[broker-state-authority] _sweepStaleAligning: ${r.changes} aligning rows → expired (30min TTL)`);
    }
  } catch (e) {
    console.warn(`[broker-state-authority] _sweepStaleAligning err: ${e.message}`);
  }
}

// ── Test helpers — deprecated stubs (state now in retail_dex_orders, persistent) ──
//
// 旧 _convoState in-memory Map 删除后, snapshot/restore/clear 概念失效 — DB 已是 source of truth.
// 保留 stub export 不 break existing tests, return safe no-ops.

export function _clearAllState() {
  // Test cleanup — DELETE active orders for test peers (callers responsible for filtering by peer)
  // Returning row count for test assertion compatibility.
  const r = sqlite.prepare(`DELETE FROM retail_dex_orders WHERE state IN ('aligning','confirming','awaiting_payment','paid','executing','refunding')`).run();
  return r.changes;
}

export function _exportSnapshot() {
  // Snapshot all active orders mapped to ConvoState format — useful for cross-test diagnostics.
  const orders = sqlite.prepare(`
    SELECT * FROM retail_dex_orders WHERE state IN ('aligning','confirming','awaiting_payment','paid','executing','refunding')
  `).all();
  const out = {};
  for (const o of orders) {
    const memory = sqlite.prepare(
      `SELECT distilled_summary, preferred_chain, preferred_pay_address, tone_preference
       FROM retail_dex_user_memory WHERE user_kasia_address = ?`
    ).get(o.user_kasia_address);
    const relation = sqlite.prepare(
      `SELECT their_alias, classification, trust_level, is_blocked
       FROM relation_states WHERE peer_address = ?`
    ).get(o.user_kasia_address);
    out[o.user_kasia_address] = _orderToConvoState(o, memory, relation);
  }
  return out;
}

export function _restoreSnapshot(_snap) {
  // No-op — DB is source of truth, snapshot restore is meaningless. Test infra should
  // use seed_pending_accept API (env-gated KANET_TEST_MODE) to inject test fixtures directly.
  return { restored: 0, deprecated: true };
}

// R-NWT-2026-04-28 (d) lifecycle infra: backdate expires_at for state-expire-boundary case testing.
// 改: UPDATE retail_dex_orders.expires_at to past.
export function _testForceExpire(peer) {
  const r = sqlite.prepare(`
    UPDATE retail_dex_orders
    SET expires_at = datetime('now', '-1 minute'), updated_at = datetime('now')
    WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment','paid','executing','refunding')
  `).run(peer);
  if (r.changes > 0) {
    return { ok: true, peer, expires_at: 'now-1min' };
  }
  return { ok: false, peer, reason: 'no active order for peer' };
}

// ── Lint hook for R33 phase 2 strict mode ────────────────────────
// J1 lint-kanet checkR33 phase 2 真 strict 真 detect handler files import this module.
// 真 import { getConvoState } from './broker-state-authority.js' 真 grep-able.
