// _agent_base.mjs — Phase 5-4 KI 41 autonomous agent persona foundation
//
// NWT N19.72 spec, J2 ship Sub 1/6.
//
// Owner 5/20 04:30 钦定: KANet = agent-to-agent autonomous market (撤 Puppeteer / human-mimic direction).
// 现有 personas/real-chain 5 个全 scripted step sequence. 这文件加 Brain-LLM 决策 loop foundation.
//
// brainFn(state) → { action, payload }
//   action ∈ { 'send_dm' | 'transfer_usdt' | 'accept_offer' | 'publish_offer' | 'stop' }
//
// Phase 1 (this file): mock brain (deterministic regression-safe state machine).
// Phase 2 (later): real LLM brain via services/llm-caller.js (stress/UAT only).

import { sendDm, waitForReply, transferEvmUsdt, parseQuote } from '../../lib/real-chain-runner.mjs';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

/**
 * Run an autonomous agent loop until goal completed or max steps reached.
 * Each step asks brainFn for next action, executes, records to history.
 *
 * @param {Object} opts
 * @param {string} opts.id — persona id for logging
 * @param {Object} opts.persona — persona spec ({ id })
 * @param {Object} opts.context — { relayId, relayName, userKasia, brokerKasia, brokerEvmAddr, ... }
 * @param {Object} opts.goal — agent goal (e.g. { kind: 'buy_kas', qty: 50 })
 * @param {Object} opts.policy — agent policy (e.g. { maxSpreadPct: 2, maxStepUsdt: 10 })
 * @param {Function} opts.brainFn — async (state) => { action, payload }
 * @param {number} [opts.maxSteps=20] — hard upper bound on loop iterations
 * @returns {Promise<{ ok, step, history, finalState }>}
 */
export async function runAgentLoop({ id, persona, context, goal, policy, brainFn, maxSteps = 20 }) {
  if (!brainFn) throw new Error('runAgentLoop: brainFn required');
  if (!context?.relayId) throw new Error('runAgentLoop: context.relayId required');

  const state = {
    id, persona, goal, policy, context,
    history: [],
    completed: false,
    completionReason: null,
    lastReply: null,
    pendingOfferId: null,
    pendingPayment: null,
  };

  let step = 0;
  while (step < maxSteps && !state.completed) {
    step++;
    let decision;
    try {
      decision = await brainFn(state);
    } catch (err) {
      state.completionReason = `brain err: ${err.message}`;
      break;
    }
    if (!decision || decision.action === 'stop') {
      state.completionReason = decision?.reason || 'brain returned stop';
      break;
    }

    const stepLog = { step, action: decision.action, ts: Date.now() };

    try {
      if (decision.action === 'send_dm') {
        const text = decision.payload?.message;
        if (!text) throw new Error('send_dm requires payload.message');
        const startIso = new Date().toISOString();
        await sendDm(context.relayId, context.brokerKasia, text);
        const reply = await waitForReply(
          context.brokerKasia, context.userKasia, startIso,
          { timeoutMs: decision.payload.timeoutMs || 60_000 }
        );
        stepLog.sent = text;
        stepLog.reply = reply?.content_text || null;
        state.lastReply = reply?.content_text || null;
        if (reply?.content_text) {
          const q = parseQuote(reply.content_text);
          if (q) state.pendingPayment = q;  // { amount, address } from broker quote
        }
      } else if (decision.action === 'transfer_usdt') {
        const { chain = 'bnb', amount, to } = decision.payload || {};
        if (!amount || !to) throw new Error('transfer_usdt requires payload.amount + payload.to');
        const tx = await transferEvmUsdt(context.relayName, chain, amount, to);
        stepLog.tx = tx;
      } else if (decision.action === 'accept_offer') {
        const { offerId, chain = 'bnb', asset = 'USDT' } = decision.payload || {};
        if (!offerId) throw new Error('accept_offer requires payload.offerId');
        const res = await fetch(`${CONSOLE_URL}/api/exchange/accept`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relayNodeId: context.relayId, offer_id: offerId, selected_chain: chain, payment_asset: asset }),
          signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json().catch(() => ({}));
        stepLog.accept = { ok: res.ok, status: res.status, body: data };
        if (res.ok) state.pendingOfferId = offerId;
      } else if (decision.action === 'publish_offer') {
        const body = decision.payload || {};
        const res = await fetch(`${CONSOLE_URL}/api/exchange/publish`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relayNodeId: context.relayId, ...body }),
          signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json().catch(() => ({}));
        stepLog.publish = { ok: res.ok, status: res.status, body: data };
        if (data?.offer_id) state.pendingOfferId = data.offer_id;
      } else {
        stepLog.error = `unknown action: ${decision.action}`;
      }
    } catch (err) {
      stepLog.error = err.message;
    }

    state.history.push(stepLog);
    if (decision.completes) {
      state.completed = true;
      state.completionReason = decision.completes;
    }
  }

  return {
    ok: state.completed,
    step,
    history: state.history,
    finalState: state,
  };
}

/**
 * Mock brain for a buyer agent — deterministic state machine mimicking broker DM flow.
 * No LLM call. Regression-safe.
 *
 * Decision tree (broker BUY KAS flow):
 *   step 1 (history.empty) → send 'back' (reset menu)
 *   step 2 (last includes '🎯' or 'KAS 买卖') → send '1' (BUY menu)
 *   step 3 (last includes 'chain' / '链') → send '1' (BSC)
 *   step 4 (last includes 'qty' / '数量') → send String(goal.qty)
 *   step 5 (last includes 'addr' / '地址') → send userEvmAddr
 *   step 6 (last includes 'price' / 'mid' / '中位') → send '1' (mid)
 *   step 7 (last includes 'confirm' / '确认') → send '1' (yes)
 *   step 8 (got quote — pendingPayment set) → transfer_usdt to quote address
 *   step 9 (after transfer) → stop (broker takes over via escrow)
 */
export function mockBuyerBrain(state) {
  const last = state.lastReply || '';
  const h = state.history;

  // Final: payment done → broker auto-handles escrow → stop
  if (h.some(s => s.action === 'transfer_usdt' && s.tx)) {
    return { action: 'stop', reason: 'usdt_paid', completes: 'buy_kas_pay_complete' };
  }

  // Got quote → transfer USDT
  if (state.pendingPayment?.amount && state.pendingPayment?.address) {
    return {
      action: 'transfer_usdt',
      payload: { chain: 'bnb', amount: state.pendingPayment.amount, to: state.pendingPayment.address },
    };
  }

  // Step 1: empty history → send 'back'
  if (h.length === 0) return { action: 'send_dm', payload: { message: 'back' } };

  // Step 2-7: scripted menu navigation
  if (/🎯|KAS\s*买卖|主菜单|main menu/i.test(last)) return { action: 'send_dm', payload: { message: '1' } };
  if (/选择.*链|chain|BSC|BNB/i.test(last)) return { action: 'send_dm', payload: { message: '1' } };
  if (/数量|qty|多少/i.test(last)) return { action: 'send_dm', payload: { message: String(state.goal?.qty ?? 50) } };
  if (/地址|address|0x/i.test(last) && !state.context?.userEvmAddrSent) {
    state.context.userEvmAddrSent = true;
    return { action: 'send_dm', payload: { message: state.context.userEvmAddr } };
  }
  if (/price|价格|mid|中位/i.test(last)) return { action: 'send_dm', payload: { message: '1' } };
  if (/confirm|确认|是否/i.test(last)) return { action: 'send_dm', payload: { message: '1' } };

  // Fallback: send '1' (advance most menus)
  if (h.length < 10) return { action: 'send_dm', payload: { message: '1' } };

  return { action: 'stop', reason: 'no_progress_after_10_steps' };
}

/**
 * Mock brain for an offer taker — accepts the first broker SELL offer matching policy.
 */
export async function mockTakerBrain(state) {
  // Already accepted → wait for completion or stop
  if (state.pendingOfferId) {
    return { action: 'stop', reason: 'offer_accepted', completes: 'accept_done' };
  }
  // Find broker SELL offer (give_asset=KAS) below maxPriceUsdt
  try {
    const res = await fetch(`${CONSOLE_URL}/api/exchange/offers?status=open`, { signal: AbortSignal.timeout(5_000) });
    const data = await res.json().catch(() => ({}));
    const offers = (data.offers || data.items || []).filter(o =>
      o.give_asset === 'KAS' && o.want_asset === 'USDT'
      && parseFloat(o.give_amount) <= (state.policy?.maxKasQty ?? 200)
      && parseFloat(o.want_amount) <= (state.policy?.maxUsdtPay ?? 10)
      && o.maker !== state.context?.userKasia
    );
    if (offers.length === 0) return { action: 'stop', reason: 'no_matching_offer' };
    // Pick best (lowest USDT per KAS)
    offers.sort((a, b) => (parseFloat(a.want_amount) / parseFloat(a.give_amount)) - (parseFloat(b.want_amount) / parseFloat(b.give_amount)));
    return { action: 'accept_offer', payload: { offerId: offers[0].id, chain: 'bnb', asset: 'USDT' } };
  } catch (err) {
    return { action: 'stop', reason: `offers_fetch_err: ${err.message}` };
  }
}

/**
 * Mock brain for a publisher (seller) — publishes one offer matching goal, then stops.
 */
export function mockSellerBrain(state) {
  if (state.history.some(s => s.action === 'publish_offer' && s.publish?.ok)) {
    return { action: 'stop', reason: 'offer_published', completes: 'publish_done' };
  }
  if (state.history.length > 2) return { action: 'stop', reason: 'publish_failed_3_attempts' };
  return {
    action: 'publish_offer',
    payload: {
      give_asset: 'KAS', give_amount: String(state.goal?.qty ?? 10), give_chain: 'kaspa',
      want_asset: 'USDT', want_amount: String((state.goal?.qty ?? 10) * (state.policy?.pricePerKas ?? 0.034)),
      want_chain: 'bsc',
      expires_minutes: state.policy?.expiresMin ?? 10,
      verification: 'manual',
      metadata: { source: 'multi-agent-test', tag: state.id },
    },
  };
}
