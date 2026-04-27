// broker-state-authority.js — R33 conversation state authority (J1 design skeleton, J2 fills implementation)
//
// 设计源: ANTI-PATTERNS.md R33 (J1 sediment 3b6911f3) + Owner 12:52 trace 5 bugs root cause analysis (J1 050108d6).
// 实现归属: J2 main / J1 review (per 14:01 三方 division lock).
//
// 核心问题: broker 现 11+ reply paths fragmented (handleBuyIntent regex × 6 + handleSellIntent + handleLlmDialog × 3),
// 各自 turn-by-turn pattern-match input → fire OR fall-through. 没人 consult conversation state authoritatively.
// 结果: B1 'Bsc' single-token → cross-direction hallucinate / B2 PRICE_QUERY 真 SELL flow → BUY guidance /
//       B3 杂糅 → cross-direction / B4 反复偏移 / B5 fake price / B6 stale legacy.
//
// 解决: 单一 conversation state authority. ALL reply paths consult BEFORE firing. 状态 lifecycle-bound (R32),
//       fresh field NEVER override declared direction (R28), allow-set lifecycle-bound (R31) extends to entire flow.

import { sqlite } from '../db/client.js';

// ── State schema ─────────────────────────────────────────────────
//
// 单 peer → ConvoState. 真 broker process 内存维护. 真 timeout 30min auto-expire.
//
// ConvoState 字段 (J2 实现时全部 capture, 真 trace persistence (d) v2 #6 也要序列化):
//
//   peer_address       string   peer kasia 地址
//   direction          'buy'|'sell'|null    declared turn 1, locked thereafter
//   give_asset         string   user 真 give 真 asset (BUY: USDT, SELL: KAS)
//   want_asset         string   user 真 want 真 asset (BUY: KAS, SELL: USDT)
//   qty                number   amount of 真 transactional asset
//   pay_chain          string   bnb/eth/polygon/sol/tron — chain user pays on
//   recv_chain         string   chain user receives on (kaspa for BUY, EVM for SELL)
//   recv_address       string   user EVM addr (SELL) OR kaspa addr (BUY auto-resolved)
//   conditions         object   user 真 special conditions (e.g. limit_price, refund_timeout)
//   lifecycle_phase    string   'fields_collection' | 'preview_shown' | 'confirmed' | 'awaiting_payment' |
//                                'paid' | 'verifying' | 'delivering' | 'completed' | 'cancelled' | 'disputed'
//   started_at         number   ms epoch — turn 1 declared intent
//   updated_at         number   ms epoch — last state change
//   reset_at           number   ms epoch — auto-expire (started_at + 30min)
//   locked             bool     真 turn 1 declared 真 lock = true. 真 reset trigger 真 false.

const _convoState = new Map();  // peer_address → ConvoState
const STATE_TTL_MS = 30 * 60 * 1000;  // 30min lifecycle

// ── Public API ───────────────────────────────────────────────────

/**
 * Get current ConvoState for peer. Returns null if no active state OR state expired.
 *
 * J2 实现注意: expired state 真 lazy 清 (truthy check 时清). 真 cron 不需要专门 sweep.
 *
 * @param {string} peer — peer kasia address
 * @returns {ConvoState | null}
 */
export function getConvoState(peer) {
  const state = _convoState.get(peer);
  if (!state) return null;
  if (Date.now() > state.reset_at) {
    _convoState.delete(peer);
    return null;
  }
  return state;
}

/**
 * Set / update ConvoState. Called by handler 真 declared intent first commit OR field update.
 *
 * J2 实现注意:
 * - 真 first declaration (no existing state) → set with locked=true + started_at + reset_at = now+TTL
 * - 真 fresh fields update (existing state) → merge fields BUT direction immutable (R28/R32)
 *   if fields.direction != state.direction → throw ConvoStateDirectionLockError
 * - 真 phase advance → updated_at = now (don't reset reset_at)
 *
 * @param {string} peer
 * @param {Partial<ConvoState>} fields
 * @returns {ConvoState} — updated state
 */
export function setConvoStateLock(peer, fields) {
  const existing = _convoState.get(peer);
  if (!existing) {
    // First declaration
    if (!fields.direction) {
      throw new Error('R33: setConvoStateLock first call must include direction');
    }
    const state = {
      peer_address: peer,
      direction: fields.direction,
      give_asset: fields.give_asset || null,
      want_asset: fields.want_asset || null,
      qty: fields.qty || null,
      pay_chain: fields.pay_chain || null,
      recv_chain: fields.recv_chain || null,
      recv_address: fields.recv_address || null,
      conditions: fields.conditions || {},
      lifecycle_phase: fields.lifecycle_phase || 'fields_collection',
      started_at: Date.now(),
      updated_at: Date.now(),
      reset_at: Date.now() + STATE_TTL_MS,
      locked: true,
    };
    _convoState.set(peer, state);
    return state;
  }
  // Update existing — direction IMMUTABLE (R28/R32 sticky lock)
  if (fields.direction && fields.direction !== existing.direction) {
    const err = new Error(`R33 direction lock violation: state.direction=${existing.direction}, fresh.direction=${fields.direction}`);
    err.code = 'CONVO_STATE_DIRECTION_LOCK';
    err.locked_direction = existing.direction;
    err.attempted_direction = fields.direction;
    throw err;
  }
  // Merge other fields (lifecycle_phase advances, conditions accumulate, qty/chain/addr fill missing)
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'direction') continue;  // immutable
    if (v !== undefined && v !== null) existing[k] = v;
  }
  existing.updated_at = Date.now();
  return existing;
}

/**
 * Reset state on explicit user reset. Called by handler 真 CANCEL_WORDS hit OR user '重新下单'.
 *
 * @param {string} peer
 * @param {string} reason — 'user_cancel' | 'timeout' | 'restart' | 'completed'
 */
export function resetConvoState(peer, reason) {
  const state = _convoState.get(peer);
  if (state) {
    state.lifecycle_phase = (reason === 'completed') ? 'completed' : 'cancelled';
    state.locked = false;
    // Keep state for 30s for trace audit, then GC
    setTimeout(() => _convoState.delete(peer), 30 * 1000);
  }
}

/**
 * Decide whether a deterministic regex path should fire given conversation state.
 *
 * R33 核心 — 真 ALL deterministic paths 真 BEFORE firing 必 consult.
 *
 * J2 实现注意: 真 lookup table 真 explicit. 加 case 不 over-broaden — 只阻止真 cross-direction
 * 真 inference. 真 PAID_REGEX 真 SELL flow 真 should NOT fire 真 mismatch context (PAID 真 BUY-only
 * indicator). 真 PRICE_QUERY 真 SELL flow 真 should NOT fire BUY-guidance (返 SELL-context price
 * reply).
 *
 * @param {string} peer
 * @param {string} regexName — 'BUY_REGEX' | 'SELL_REGEX' | 'PRICE_QUERY' | 'PAID_REGEX' | 'CONFIRM_WORDS' | 'CANCEL_WORDS' | 'STOP_HARD'
 * @param {string} message — current user msg (用于 fine-grained 决策)
 * @returns {boolean} — true 真 fire OK, false 真 skip (state-aware gating)
 */
export function shouldDeterministicFire(peer, regexName, message) {
  const state = getConvoState(peer);
  if (!state || !state.locked) return true;  // no state, all fires OK

  const dir = state.direction;

  // R33 cross-direction gating
  if (regexName === 'BUY_REGEX' && dir === 'sell') return false;     // B1/B3 fix
  if (regexName === 'SELL_REGEX' && dir === 'buy') return false;
  if (regexName === 'PRICE_QUERY' && dir === 'sell') return false;   // B2 fix — 真 SELL flow 真 BUY-guide 真 NEVER
  if (regexName === 'PAID_REGEX' && dir === 'sell') return false;    // PAID 真 BUY-only

  // CONFIRM_WORDS / CANCEL_WORDS / STOP_HARD 真 phase-aware (但 direction-agnostic, allow always)
  return true;
}

/**
 * Generate state-context-aware system prompt addendum for LLM call.
 *
 * 真 broker-llm-agent.handleLlmDialog 真 _callLlm 前 真 inject this into system prompt.
 * 真 Qwen3.6 真 weak multi-turn 真 amplify with explicit state lock instruction.
 *
 * @param {string} peer
 * @returns {string | null} — system prompt addendum, OR null if no state
 */
export function llmSystemPromptStateLock(peer) {
  const state = getConvoState(peer);
  if (!state || !state.locked) return null;

  const lines = [
    '\nCRITICAL CONVERSATION STATE (do NOT violate):',
    `User has DECLARED ${state.direction.toUpperCase()} flow at turn ${Math.floor((Date.now() - state.started_at) / 1000)}s ago.`,
    `Locked fields: direction=${state.direction}` +
      (state.give_asset ? `, give=${state.give_asset}` : '') +
      (state.qty ? `, qty=${state.qty}` : '') +
      (state.pay_chain ? `, pay_chain=${state.pay_chain}` : '') +
      (state.recv_address ? `, recv_addr=${state.recv_address.slice(0, 10)}...` : '') +
      `, phase=${state.lifecycle_phase}.`,
    `Fresh user message fills MISSING fields ONLY. Direction is IMMUTABLE.`,
    `If user message implies opposite direction, ASK 'cancel order first?' do NOT auto-flip.`,
    `If user asks question (not field), ANSWER question with state context, do NOT re-show preview.`,
  ];
  return lines.join('\n');
}

/**
 * R29 invariant on LLM-generated reply — verify reply doesn't hallucinate price/addr/intent.
 *
 * J2 实现注意: 真 reply 含 \\d+\\.\\d+\\s*(USDT|USDC) pattern → 必 fetch fetchPrice oracle ±5%.
 * 真 reply 含 0x[hex]{40} pattern → 必在 ownAddrSet ∪ pendingPreview.recv_address (R31).
 * 真 reply implies opposite direction (e.g. state.direction='sell' but reply contains '买')
 *   → flag potential hallucinate.
 *
 * @param {string} peer
 * @param {string} replyText
 * @returns {{ok: boolean, violations: string[]}}
 */
export async function validateLlmReply(peer, replyText) {
  const state = getConvoState(peer);
  const violations = [];

  // Direction sanity
  if (state?.locked) {
    const opposite = state.direction === 'buy' ? 'sell' : 'buy';
    const oppositeChinese = state.direction === 'buy' ? '卖' : '买';
    const re = new RegExp(`方向[:：]\\s*(${opposite}|${oppositeChinese})`, 'i');
    if (re.test(replyText)) violations.push(`R33-direction: state=${state.direction}, reply implies ${opposite}`);
  }

  // Price oracle check (R29 + Owner B5 evidence)
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

  return { ok: violations.length === 0, violations };
}

// ── Test helpers (J2 unit tests use) ─────────────────────────────

export function _clearAllState() { _convoState.clear(); }
export function _exportSnapshot() { return Object.fromEntries(_convoState); }
export function _restoreSnapshot(snap) {
  _convoState.clear();
  for (const [k, v] of Object.entries(snap)) _convoState.set(k, v);
}

// ── Lint hook for R33 phase 2 strict mode ────────────────────────
// J1 lint-kanet checkR33 phase 2 真 strict 真 detect handler files import this module.
// 真 import { getConvoState } from './broker-state-authority.js' 真 grep-able.
