// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R33 / R31 (attacker) / Bug-Z24 (system msg)
// 关键历史: R33 sticky direction lock / R31 detectAddrChangeAttempt / R33 wire 371e4ca62 reintroduce
// blast radius: 整个 broker conversation state authority + addr change attack 防御
// ════════════════════════════════════════════════════════════════
//
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
//   recv_address       string   user EVM addr (SELL OR BUY USDT/USDC) — null for BUY KAS
//   evm_pay_address    string   BUY KAS user T1-supplied EVM addr (Phase D J1-D-1 lock 兜底
//                                给 R31 attacker swap detect; broker functionally 不依赖)
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
  // R33 b iter10 (NWT 556966ea trace 实证): existing 且 locked=false (post resetConvoState 'user_cancel'/'user_restart')
  // 真**真**直接 treat as fresh — 真**真**真 direction immutable check 误伤 legitimate restart.
  // resetConvoState sets locked=false 真**真 keep state for 30s audit, 但 setConvoStateLock 真**真**真 reuse stale direction.
  if (!existing || !existing.locked) {
    // First declaration OR post-reset (locked=false)
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
  if (!state) return null;

  // T-J2-2026-04-29 Phase E v2 第一原则 1 (Owner 21:40 钦定 4 铁律 #3 broker 不忘):
  // 之前 'if (!state.locked) return null' — state.locked=false (post R33 reset retain mode)
  // 时 LLM 看不到任何 state, hallucinate forget. 改: ANY field exists → inject 'KNOWN USER FIELDS'.
  // locked vs unlocked 仅影响 addendum framing (locked=hard rule, unlocked=soft hint).
  const hasAnyField = state.direction || state.qty != null || state.pay_chain ||
    state.recv_address || state.evm_pay_address || state.give_asset;
  if (!hasAnyField) return null;

  const fieldLines = [];
  if (state.direction) fieldLines.push(`direction=${state.direction}`);
  if (state.give_asset) fieldLines.push(`give_asset=${state.give_asset}`);
  if (state.qty != null) fieldLines.push(`qty=${state.qty}`);
  if (state.pay_chain) fieldLines.push(`pay_chain=${state.pay_chain}`);
  if (state.recv_address) fieldLines.push(`recv_address=${state.recv_address}`);
  if (state.evm_pay_address) fieldLines.push(`evm_pay_address=${state.evm_pay_address}`);
  if (state.lifecycle_phase) fieldLines.push(`phase=${state.lifecycle_phase}`);

  const lines = state.locked
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

  // Direction sanity — formal preview AND natural language coverage
  // R33 b iter5 (NWT 30940d86 Bug-Z13 trace 实证扩): LLM hallucinate 真**真 自然语言 '你想卖' /
  // '卖出' / '你是要卖' 形式不带 formal '方向:' prefix. 真**真**真 catch 必扩 regex.
  if (state?.locked) {
    const opposite = state.direction === 'buy' ? 'sell' : 'buy';
    const oppositeChinese = state.direction === 'buy' ? '卖' : '买';
    // formal preview
    const formalRe = new RegExp(`方向[:：]\\s*(${opposite}|${oppositeChinese})`, 'i');
    // 自然语言 broker hallucinate patterns (Bug-Z13 实证)
    const naturalChinese = new RegExp(`(?:你想|你是要|你要|想|准备)${oppositeChinese}|${oppositeChinese}(?:出|单|掉)|${oppositeChinese}\\s*\\d+\\s*KAS`, 'i');
    const naturalEn = new RegExp(`\\b(?:you\\s*(?:want\\s*to|are\\s*going\\s*to|wish\\s*to)\\s*${opposite}|${opposite}\\s*\\d+\\s*KAS)\\b`, 'i');
    if (formalRe.test(replyText)) violations.push(`R33-direction-formal: state=${state.direction}, reply formal '方向: ${opposite}'`);
    else if (naturalChinese.test(replyText)) violations.push(`R33-direction-natural-zh: state=${state.direction}, reply contains opposite-direction natural-language phrase`);
    else if (naturalEn.test(replyText)) violations.push(`R33-direction-natural-en: state=${state.direction}, reply contains opposite-direction English phrase`);
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

  // T-J1-2026-04-28 Layer 3 (phase 3 8-layer system fix): chain-truth check.
  // LLM reply 含 64-hex Kaspa TX hash 必在 kaspa_tx_log 真存在. 治 LLM hallucinate fake tx hash
  // (e.g. Z19 cancel ack '已退 87.9 KAS, TX abc123...', LLM 编 64-hex 用户没法分辨真假).
  // \b[a-f0-9]{64}\b 只匹配 bare hex (Kaspa style), 不匹配 EVM '0x...' (word boundary 在 x/a 之间无效).
  const hashMatches = (replyText.match(/\b[a-f0-9]{64}\b/gi) || []).map(h => h.toLowerCase());
  if (hashMatches.length) {
    const fakeHashes = [];
    for (const h of hashMatches) {
      try {
        const found = sqlite.prepare('SELECT 1 FROM kaspa_tx_log WHERE tx_id = ? LIMIT 1').get(h);
        if (!found) fakeHashes.push(h);
      } catch (e) {
        // kaspa_tx_log 不可读 (DB error) → 保守不拦, 避免 false positive 阻塞所有 reply
        console.warn(`[broker-state-authority Layer3] kaspa_tx_log lookup err: ${e.message}`);
        break;
      }
    }
    if (fakeHashes.length) {
      violations.push(`Layer3-chain-truth: reply 含 ${fakeHashes.length} 个 Kaspa TX hash 不在 kaspa_tx_log (LLM 可能编 fake): ${fakeHashes.map(h => h.slice(0, 16) + '...').join(', ')}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

// ── R31 attacker detection (J1 P1.b 7d031b67 attacker probes) ────
//
// 多 addr plant + r19-strip-replant probes 实证: user 真**真 locked addr 后, 真**真**真**真
// '改地址' literal OR 提 alternative 0x... 真**真 detect 真**真 R31 lifecycle-lock 拒.
//
// detectAddrChangeAttempt(peer, message) → {attempt: bool, reason: string}
//   true: user 真**真 try change locked addr (改地址 keyword OR 0x proposal differs from locked)
//   false: 真**真**真 addr-change 意图

// Phase D P1 真因 2 (NWT 8b848a95 Phase C Path 1 T4 真测 catch): regex 漏 '地址改成 0x...' word-order variant.
// 之前 仅 '改地址' literal substring, 不 cover '地址改成?/换成?/改为/改到' (字符顺序倒). attacker mid-flow swap silent 通过.
// 加补: 地址(改成?/换成?/改为/改到) + change to 0x + 地址.{0,4}0x 兜底 4-char proximity.
const _ADDR_CHANGE_KEYWORDS = /改地址|地址(?:改成?|换成?|改为|改到)|换地址|换\s*收款|改\s*收款|change\s*address|new\s*address|swap\s*address|change\s*to\s*0x|改\s*0x|地址.{0,4}0x/i;
const _ADDR_PROPOSAL_REGEX = /0x[a-zA-Z0-9_-]{6,}/;  // any 0x + 6+ char-ish — catches '0xATTACKER1'/'0x9405legit'/real 40-hex

// R33 b iter9 (J2 81f8f1d8 mid_flow_restart 实证): user 真**真 explicit cancel-and-restart
// (e.g. '不要了 重新下单 卖 X' OR 'cancel and restart' OR '取消重新') 真**真**真 reset state 真**真 fresh
// fields 处理. cancelWordsLocal 真**真 freshHasAny=false 时 fire (handleLlmDialog L645), 真**真
// 'cancel + new declaration' 真**真**真 cover. 真 R33 sticky direction lock 真 attack-rejection
// 误伤 真**legitimate restart**.
const _RESET_INTENT_KEYWORDS = /不要了|重新下单|取消重新|cancel\s*and\s*restart|restart\s*order|cancel\s*restart/i;
export function detectResetIntent(message) {
  return _RESET_INTENT_KEYWORDS.test(String(message || ''));
}

export function detectAddrChangeAttempt(peer, message) {
  const state = _convoState.get(peer);
  if (!state) return { attempt: false };
  // Phase D P1 真因 1 (NWT 8b848a95 Phase C Path 1 T4 真测): BUY KAS 路径 state.recv_address=null
  // (asset='KAS' user receives KAS 进 kasia, 不需 EVM recv addr) → R31 short-circuit silent. Attacker
  // mid-flow '改地址 0xDEADBEEF' 通过. 修补: widen check to recv_address || evm_pay_address.
  // BUY KAS 路径 user T1 supplied EVM addr 真 lock 进 evm_pay_address (broker functionally 不依赖, 但
  // R31 lock 提供 user-facing UX 'addr already locked, cancel + restart if you want to change'.
  const lockedAddr = state.recv_address || state.evm_pay_address;
  if (!lockedAddr) return { attempt: false };
  const msg = String(message || '');
  if (_ADDR_CHANGE_KEYWORDS.test(msg)) {
    return { attempt: true, reason: 'change_keyword', locked: lockedAddr };
  }
  // 真 0x proposal differs from locked addr (case-insensitive)
  const proposalMatches = msg.match(/0x[a-zA-Z0-9_-]{6,}/g) || [];
  for (const proposal of proposalMatches) {
    if (proposal.toLowerCase() !== lockedAddr.toLowerCase()) {
      return { attempt: true, reason: 'differing_addr_proposal', locked: lockedAddr, proposed: proposal };
    }
  }
  return { attempt: false };
}

// ── Test helpers (J2 unit tests use) ─────────────────────────────

export function _clearAllState() { _convoState.clear(); }
export function _exportSnapshot() { return Object.fromEntries(_convoState); }
export function _restoreSnapshot(snap) {
  _convoState.clear();
  for (const [k, v] of Object.entries(snap)) _convoState.set(k, v);
}

// R-NWT-2026-04-28 (d) lifecycle infra (J2 d6022b59 propose): force state.expires_at backdate
// for state-expire-boundary case testing. test-only export, env-gated by KANET_TEST_MODE in API.
export function _testForceExpire(peer) {
  const state = _convoState.get(peer);
  if (state) {
    state.expires_at = Date.now() - 1000;  // 1s past
    _convoState.set(peer, state);
    return { ok: true, peer, expires_at: state.expires_at };
  }
  return { ok: false, peer, reason: 'no state for peer' };
}

// ── Lint hook for R33 phase 2 strict mode ────────────────────────
// J1 lint-kanet checkR33 phase 2 真 strict 真 detect handler files import this module.
// 真 import { getConvoState } from './broker-state-authority.js' 真 grep-able.
