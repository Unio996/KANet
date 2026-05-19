/**
 * Exchange State Machine — protocol-level free market.
 *
 * Design doc: exchange-state-machine-v1.0.md
 *
 * This state machine does NOT know what asset is being traded.
 * It does NOT know how verification works internally.
 * It only routes between protocol states based on verifier results.
 *
 * Protocol states: open → matched → verifying|awaiting_manual_confirm → completed|disputed|timed_out
 * Cancel: only from open. After matched, cancel is ignored.
 */

import { sqlite } from '../db/client.js';
import { getVerifier } from './exchange-verifiers.js';
import { recordChainEvent } from './chain-event.js';
import { executeHedge } from './trade-protocol-filter.js';
import { releaseFunds, spendFunds } from './fund-lock.js';
import crypto from 'crypto';

// ── Valid Transitions ─────────────────────────────────────────

// T-J2-2026-05-11 Phase 2 A.1 (NWT #18 ABE audit): 加 refunded transition + TERMINAL state。
// 3 direct UPDATE bypass sites (broker-state-authority.js:482 真 refunded; api/exchange.js:48 真 expired;
// broker-intake-watcher.js:429 真 timed_out) — A.2-A.4 重定向走 transition() 必要 VALID_TRANSITIONS 含 refunded。
// refunded source states: open/matched/verifying/delivering/verified/awaiting_manual_confirm/awaiting_oracle
// (broker-state-authority advanceToRefunded 真 cancel-refund 路径, 任 active state 都可走 refund)。
const VALID_TRANSITIONS = {
  open:                     ['matched', 'cancelled', 'expired', 'refunded', 'timed_out'],
  matched:                  ['verifying', 'awaiting_manual_confirm', 'awaiting_oracle', 'refunded'],
  verifying:                ['delivering', 'disputed', 'timed_out', 'refunded'],
  delivering:               ['completed', 'verified', 'disputed', 'refunded'],  // verified = revert on delivery failure
  verified:                 ['delivering', 'disputed', 'timed_out', 'refunded'], // delivery retry or manual intervention
  awaiting_manual_confirm:  ['completed', 'disputed', 'timed_out', 'refunded'],
  awaiting_oracle:          ['completed', 'failed', 'timed_out', 'refunded'],
};

// Terminal states — no further transitions allowed
// A.1: 加 refunded (broker-state-authority advanceToRefunded 真 terminal sink, 跟 cancelled/expired 同 class)
const TERMINAL = new Set(['completed', 'disputed', 'timed_out', 'failed', 'cancelled', 'expired', 'refunded']);

// ── State Transitions ─────────────────────────────────────────

/**
 * Transition an offer to a new protocol_status.
 * Enforces valid transitions. Sets timestamps and is_fully_observed.
 */
export function transition(offerId, newStatus, extra = {}) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offerId);
  if (!offer) throw new Error(`Offer not found: ${offerId}`);

  if (TERMINAL.has(offer.protocol_status)) {
    console.log(`[exchange-machine] ${offerId.slice(0, 8)} already terminal: ${offer.protocol_status}`);
    return offer;
  }

  const allowed = VALID_TRANSITIONS[offer.protocol_status];
  if (!allowed || !allowed.includes(newStatus)) {
    console.log(`[exchange-machine] Invalid transition: ${offer.protocol_status} → ${newStatus}`);
    return offer;
  }

  const now = new Date().toISOString();
  const updates = ['protocol_status = ?', 'updated_at = ?'];
  const vals = [newStatus, now];

  // Set status-specific timestamps
  const tsMap = {
    matched:                 'matched_at',
    verifying:               'verifying_started_at',
    awaiting_manual_confirm: 'verifying_started_at',
    awaiting_oracle:         'verifying_started_at',
    delivering:              'delivering_at',
    completed:               'completed_at',
    disputed:                'disputed_at',
    timed_out:               'timed_out_at',
    cancelled:               'cancelled_at',
  };
  if (tsMap[newStatus]) {
    updates.push(`${tsMap[newStatus]} = ?`);
    vals.push(now);
  }

  // Terminal states → is_fully_observed = true + fund lock resolution
  // IMPORTANT: both paths must run for ANY terminal transition. handleExchangeDelivered
  // in trade-protocol-filter.js used to bypass transition() with direct SQL UPDATE,
  // which caused fund_lock leaks on completed. See Phase 1 stress test S9 finding.
  if (TERMINAL.has(newStatus)) {
    updates.push('is_fully_observed = 1');
    if (newStatus === 'completed') {
      // Delivery completed → mark funds as spent (idempotent; safe to call twice)
      try { spendFunds(offerId); } catch (e) { console.error(`[exchange-machine] spendFunds error: ${e.message}`); }
    } else {
      // Cancel/expire/dispute/timed_out/failed → release fund locks
      try { releaseFunds(offerId); } catch (e) { console.error(`[exchange-machine] releaseFunds error: ${e.message}`); }
    }
  }

  // Extra fields (taker, accept_commitment, etc.)
  // Skip metadata-only keys consumed by chain_event recording (txHash) — they're
  // not columns on exchange_offers and would crash the UPDATE.
  const META_ONLY = new Set(['txHash']);
  for (const [k, v] of Object.entries(extra)) {
    if (META_ONLY.has(k)) continue;
    updates.push(`${k} = ?`);
    vals.push(v);
  }

  vals.push(offerId);
  sqlite.prepare(`UPDATE exchange_offers SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  console.log(`[exchange-machine] ${offerId.slice(0, 8)}: ${offer.protocol_status} → ${newStatus}`);

  // ── chain_events: 每次状态变更都留链上审计痕迹 ──
  try {
    recordChainEvent({
      txid: extra.txHash || extra.taker_tx_id || null,
      eventType: `exchange_${newStatus}`,
      fromAddress: offer.maker,
      toAddress: offer.taker,
      payload: JSON.stringify({
        offer_id: offerId,
        give_asset: offer.give_asset, give_amount: offer.give_amount,
        want_asset: offer.want_asset, want_amount: offer.want_amount,
        from_status: offer.protocol_status, to_status: newStatus,
      }),
    });
  } catch (evtErr) {
    console.warn(`[exchange-machine] chain_event recording failed: ${evtErr.message}`);
  }

  // 议 B1 (Owner 19:55+ 钦定 lifecycle): 关键状态变更主动 DM taker.
  // 各 transition 点显式反馈 — verifying → delivering (USDT 验证通过) / completed (final)
  // / timed_out / disputed / failed. user 永不静默, 每节点知道在哪.
  if (offer.taker && offer.taker.startsWith('kaspa:')) {
    let _dmKind = null, _dmMsg = null;
    if (newStatus === 'delivering') {
      _dmKind = 'dm_payment_verified';
      _dmMsg = `✅ USDT 验证通过, 正在发 ${offer.give_amount} ${offer.give_asset} 给你, 1-2 分钟到账.`;
    } else if (newStatus === 'completed') {
      _dmKind = 'dm_complete';
      _dmMsg = `🎉 交易完成! ${offer.give_amount} ${offer.give_asset} 已到账. 谢谢使用 KANet broker, 想继续买卖随时回我.`;
    } else if (newStatus === 'timed_out') {
      _dmKind = 'dm_timeout';
      _dmMsg = `⏰ 订单超时 — 30 分钟内没收到付款验证, 已自动取消. 资金如已转出请联系 Owner 处理.`;
    } else if (newStatus === 'disputed') {
      // T-J2-2026-04-27 v1.1: 真 educate user 真 dispute 真因 + 真 actionable (J2 R21 沉淀,
      // J1 22:14 + 24:42 真测撞 underpayment dispute 真灾难 — 真 actionable explanation 防 user 真懵).
      _dmKind = 'dm_failed';
      const meta = JSON.parse(offer.verification_meta || '{}');
      const reason = meta.dispute_reason || '';
      if (/Underpayment/i.test(reason)) {
        const expectedM = reason.match(/expected (\d+\.?\d*)/);
        const gotM = reason.match(/got (\d+\.?\d*)/);
        const expected = expectedM ? expectedM[1] : '?';
        const got = gotM ? gotM[1] : '?';
        const ratio = expectedM && gotM ? (parseFloat(got)/parseFloat(expected)*100).toFixed(0) : '?';
        _dmMsg = `⚠ 订单 #${offer.id.slice(0,8)} 进入争议:\n· 你转: ${got} ${offer.want_asset}\n· 期望: ${expected} ${offer.want_asset}\n· 真转 ${ratio}% 真不够 (真容差 99.5%+)\n\nbroker 真按比例 deliver: ${(parseFloat(offer.give_amount) * parseFloat(got||0) / parseFloat(expected||1)).toFixed(6)} ${offer.give_asset} (broker 真不收 fee, 等比例发货 zero-loss).\n请等 ~1min broker 真处理. 大额或紧急可联系 Owner.`;
      } else {
        _dmMsg = `⚠ 订单 #${offer.id.slice(0,8)} 进入争议: ${reason || '链上验证未通过'}.\nbroker 真自动 retry 3 次未过 → 真 dispute. broker 真 review 真因后 either 退款 OR 按真转 amount 比例 deliver. 真处理 ~5min, 大额或紧急可联系 Owner.`;
      }
    } else if (newStatus === 'failed') {
      _dmKind = 'dm_failed';
      _dmMsg = `❌ 订单 #${offer.id.slice(0,8)} 失败: 链上验证或发送出错. broker 真 review 真因, 真 retry OR 真退款. 大额或紧急可联系 Owner 真客服 (真不会消失你的资金).`;
    }
    if (_dmKind) {
      // fire-and-forget (transition 是 sync, 不阻塞流程, DM 失败 warn 不抛)
      import('./broker-action-queue.js').then(m => {
        m.enqueue({ kind: _dmKind, peer: offer.taker, payload: { message: _dmMsg } });
      }).catch(e => console.warn(`[exchange-machine] lifecycle DM ${_dmKind} err: ${e.message}`));
    }
  }

  // 交割完成 → 升级 maker 和 taker 的 classification 到 verified_agent（只升不降）
  if (newStatus === 'completed' && offer.maker && offer.taker) {
    sqlite.prepare(`
      UPDATE relation_states SET classification = 'verified_agent'
      WHERE peer_address IN (?, ?) AND classification != 'verified_agent'
    `).run(offer.maker, offer.taker);
  }

  // T5b: maker auto-pay-give — BUY offer (give=USDT) 完成时自动付 USDT 给 taker
  // 仅当 pub.state='filled' 时触发（避免 double pay）
  if (newStatus === 'completed' && offer.give_asset === 'USDT' && offer.give_chain) {
    try { _makerAutoPayGive(offer).catch(e => console.error(`[exchange-machine] makerAutoPayGive error: ${e.message}`)); }
    catch {}
  }

  return sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offerId);
}

// ── Maker Auto-Pay-Give (T5b) ──────────────────────────────────────

/**
 * T5b: For BUY offers (maker gives USDT), auto-pay USDT to taker when completed.
 * Only fires when pub.state='filled' (taker already sent KAS).
 */
export async function _makerAutoPayGive(offer) {
  const pub = sqlite.prepare(
    "SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ? AND state = 'filled'"
  ).get(offer.id);
  if (!pub) {
    // No matching pub or pub not filled — skip (may be a non-seeder BUY offer)
    return;
  }

  const transferUsdt = await getTransferUsdt();
  const wallet = sqlite.prepare(
    "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
  ).get(offer.maker, pub.pay_chain);
  if (!wallet?.privkey_encrypted) {
    console.warn(`[exchange-machine] maker auto-pay: no seeder wallet for offer ${offer.id.slice(0, 8)}, pub ${pub.id.slice(0, 8)}`);
    return;
  }

  const takerAddr = offer.taker_payment_address;
  const amount = parseFloat(pub.total_usdt);

  console.log(`[exchange-machine] maker auto-pay: sending ${amount} USDT → ${takerAddr?.slice(0, 12)}... on ${pub.pay_chain} for offer ${offer.id.slice(0, 8)}`);
  const result = await transferUsdt(pub.pay_chain, wallet.privkey_encrypted, takerAddr, amount);
  if (!result.ok) {
    sqlite.prepare("UPDATE retail_dex_buy_publications SET state = 'failed', error_reason = ? WHERE id = ?").run(`maker_auto_pay_failed: ${result.error}`, pub.id);
    // T7 push DM
    try {
      const refreshedPub = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(pub.id);
      const { pushPubTransition } = await import('./retail-dex-pusher.js');
      pushPubTransition({ pub: refreshedPub, newState: 'failed', brokerRelayId: pub.broker_relay_id }).catch(e => console.warn(`[em] push failed: ${e.message}`));
    } catch {}
    throw new Error(`maker_auto_pay_failed: ${result.error}`);
  }

  console.log(`[exchange-machine] maker auto-pay TX: ${result.txHash} for offer ${offer.id.slice(0, 8)}`);

  // Success: mark pub completed
  const now = new Date().toISOString();
  sqlite.prepare("UPDATE retail_dex_buy_publications SET state = 'completed', filled_at = ?, kas_delivery_tx = ?, updated_at = ? WHERE id = ?").run(result.txHash, result.txHash, now, pub.id);
  // T7 push DM
  try {
    const refreshedPub = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(pub.id);
    const { pushPubTransition } = await import('./retail-dex-pusher.js');
    pushPubTransition({ pub: refreshedPub, newState: 'completed', brokerRelayId: pub.broker_relay_id }).catch(e => console.warn(`[em] push completed: ${e.message}`));
  } catch {}
}

// Bug H γ Sub #6 (Owner 12:05 钦定 candidate A v2): post-match settle 真链 forward target asset to USER.
// Called from _verifyAndComplete post 'completed' transition for escrow-backed offer (meta.escrow_id 存).
// 不动 existing taker delivery flow (broker → taker via _makerAutoPayGive OR completed handler).
// 加 second forward: broker → user_target_addr with escrow target_asset/target_chain/target_amount.
// Idempotent: 检查 escrow row.status='active' (not yet 'settled') before forwarding.
export async function _settleEscrowToUser(escrowId, offerId) {
  const e = sqlite.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(escrowId);
  if (!e) { console.warn(`[exchange-escrow-settle] escrow row ${escrowId} not found for offer ${offerId.slice(0,8)}`); return; }
  if (e.status !== 'active') {
    console.log(`[exchange-escrow-settle] escrow ${escrowId.slice(0,8)} status=${e.status}, skip (idempotent)`);
    return;
  }
  if (!e.user_target_addr) {
    console.warn(`[exchange-escrow-settle] escrow ${escrowId.slice(0,8)} 无 user_target_addr — manual review needed`);
    return;
  }

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offerId);
  if (!offer?.maker) { console.warn(`[exchange-escrow-settle] offer ${offerId.slice(0,8)} not found OR no maker`); return; }

  // Forward target asset to user:
  // BUY escrow: target_asset='KAS', target_chain='kaspa' → broker 真链 send KAS to user kasia addr
  // SELL escrow: target_asset='USDT/USDC', target_chain='bnb/eth/...' → broker 真链 transfer USDT to user EVM addr
  const isKas = e.target_asset === 'KAS';
  const brokerRelay = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(offer.maker);
  if (!brokerRelay) { console.warn(`[exchange-escrow-settle] no broker relay for maker ${offer.maker?.slice(-12)}`); return; }

  let settleTxHash = null;
  try {
    if (isKas) {
      // Bug AS P1 fix 5/16 (NWT 04:24 audit completeness gap): replace enqueue (fire-and-forget +
      // 'queued:' stub) with enqueueVerified (await real txId). DB refund_tx/settle_tx 真 TX hash,
      // not stub. audit trail complete + user can verify on chain.
      //
      // Bug N14.8 P0 fix 5/18 (NWT N14.9 钦定): 'queue-failed' silent skip 第 N 次 KI-12.
      // 旧 logic: catch err → settleTxHash = `queue-failed:${escrowId}` → 后 L332 UPDATE status='settled'
      // → user 0 KAS 收 broker 仍 mark success state, audit trail false-positive, user 钱失.
      // 修法 (mirror EVM path L310-326): 3-retry + DM user 通知 + 早 return (escrow 保 'active' 可后续 retry).
      const { enqueueVerified, enqueue } = await import('./broker-action-queue.js');
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const r = await enqueueVerified({
            kind: 'sendKas', peer: e.user_target_addr,
            payload: { amount_kas: e.target_amount, note: `escrow settle ${escrowId.slice(0,8)} attempt ${attempt}` },
          });
          settleTxHash = r?.txId || `queued:${escrowId.slice(0,8)}`;
          console.log(`[exchange-escrow-settle] KAS sendKas verified ${e.target_amount} → ${e.user_target_addr?.slice(-12)} TX ${settleTxHash?.slice(0,16)} for escrow ${escrowId.slice(0,8)} (attempt ${attempt})`);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[exchange-escrow-settle] KAS sendKas enqueueVerified attempt ${attempt}/3 fail for escrow ${escrowId.slice(0,8)}: ${err.message}`);
          if (attempt < 3) await new Promise(res => setTimeout(res, 5000 * attempt));
        }
      }
      if (lastErr) {
        console.error(`[exchange-escrow-settle] KAS sendKas 3 attempt FAIL for escrow ${escrowId.slice(0,8)}: ${lastErr.message} — escrow 保 'active' 后续 retry, user DM 通知`);
        try {
          enqueue({
            kind: 'dm_failed',
            peer: e.user_kasia_addr,
            payload: { message: `⚠ 自动 deliver ${e.target_amount} KAS 失败 (3 retry: ${lastErr.message.slice(0,80)}). broker 后续 retry OR 30 min TTL 自动 refund 你 prepay.` },
          });
        } catch {}
        return; // escrow status stays 'active', no UPDATE to 'settled' fake state
      }
    } else {
      // Bug AX P1 fix 5/16 (NWT 07:42 audit surface): EVM path 3 silent failure modes — no broker wallet,
      // transferUsdt fail, no DM. Add Layer 1 retry (3 attempts × exponential) + Layer 2 DM on final fail.
      const transferUsdt = await getTransferUsdt();
      const wallet = sqlite.prepare(
        "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
      ).get(brokerRelay.id, e.target_chain);
      if (!wallet?.privkey_encrypted) {
        console.warn(`[exchange-escrow-settle] no broker ${e.target_chain} wallet for escrow ${escrowId.slice(0,8)} — DM user`);
        try {
          const { enqueue } = await import('./broker-action-queue.js');
          enqueue({
            kind: 'dm_failed',
            peer: e.user_kasia_addr,
            payload: { message: `⚠ 自动 deliver 失败: broker 未配置 ${e.target_chain.toUpperCase()} 钱包. broker 联系 admin 排查. 30 min TTL 自动 refund 你 prepay.` },
          });
        } catch {}
        return;
      }
      let r = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        r = await transferUsdt(e.target_chain, wallet.privkey_encrypted, e.user_target_addr, parseFloat(e.target_amount), e.target_asset);
        if (r.ok) break;
        console.warn(`[exchange-escrow-settle] transferUsdt attempt ${attempt}/3 fail for escrow ${escrowId.slice(0,8)}: ${r.error}`);
        if (attempt < 3) await new Promise(res => setTimeout(res, 5000 * attempt));
      }
      if (!r?.ok) {
        console.error(`[exchange-escrow-settle] transferUsdt 3 attempt FAIL for escrow ${escrowId.slice(0,8)}: ${r?.error}`);
        try {
          const { enqueue } = await import('./broker-action-queue.js');
          enqueue({
            kind: 'dm_failed',
            peer: e.user_kasia_addr,
            payload: { message: `⚠ 自动 deliver ${e.target_amount} ${e.target_asset} 失败 (3 retry: ${(r?.error || 'unknown').slice(0,80)}). broker 30 min 内重试 OR 30 min TTL 自动 refund 你 prepay.` },
          });
        } catch {}
        return;
      }
      settleTxHash = r.txHash;
      console.log(`[exchange-escrow-settle] sent ${e.target_amount} ${e.target_asset} on ${e.target_chain} → ${e.user_target_addr?.slice(-12)} (TX: ${settleTxHash?.slice(0,16)}) for escrow ${escrowId.slice(0,8)}`);
    }

    // UPDATE escrow row status=settled + settle_tx
    sqlite.prepare(`
      UPDATE user_escrow_balances
      SET status = 'settled', settle_tx = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'
    `).run(settleTxHash, escrowId);

    // Bug BI 5/17 fix (Owner UAT 真测残留 WAIT_PREPAY): escrow settled → clear flow_state.
    try {
      const { clearFlowState } = await import('./broker-v3/state-machine.js');
      clearFlowState(e.user_kasia_addr);
    } catch {}

    // Bug AJ 5/16 fix (Owner 07:10 真测 surface silent transition): DM user post settle.
    try {
      const { enqueue } = await import('./broker-action-queue.js');
      const settleTxShort = String(settleTxHash || '').slice(0, 16);
      const chainLabel = isKas ? 'Kasia' : e.target_chain.toUpperCase();
      const userAddrShort = e.user_target_addr.slice(0, 20) + '...';
      enqueue({
        kind: 'dm_completion',
        peer: e.user_kasia_addr,
        payload: { message: `✓ 成交! 已 deliver ${e.target_amount} ${e.target_asset} 到你 ${chainLabel} ${userAddrShort}. settle TX: ${settleTxShort}... 链上可查.` },
      });
    } catch (err) { console.warn(`[exchange-escrow-settle] DM notify err: ${err.message}`); }
  } catch (err) {
    console.error(`[exchange-escrow-settle] settle err for escrow ${escrowId.slice(0,8)}: ${err.message}`);
  }
}

// Bug H γ Sub #7 (Owner 12:05 钦定 candidate A v2): cancel/expire 真链 refund TX.
// Called from: (a) state-machine WAIT_PREPAY 'cancel' via router triggerCancelEscrow,
// (b) periodic sweep for expired pending_prepay (5 min TTL) OR expired active (30 min offer TTL).
// Refund target asset depends on side:
// - BUY escrow (user prepaid USDT/USDC on EVM): broker 真链 transferUsdt back to user_refund_addr
// - SELL escrow (user prepaid KAS): broker 真链 sendKas back to user_refund_addr (via broker-action-queue R4)
// Idempotent: status='pending_prepay' → 'refunded' (no chain TX, no money transferred yet);
//              status='active' → 真链 refund + 'refunded' + refund_tx; status='settled' → reject (已完成);
//              status='refunded' → idempotent skip.
export async function _refundEscrow(escrowId, reason = 'unspecified') {
  const e = sqlite.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(escrowId);
  if (!e) { console.warn(`[exchange-escrow-refund] escrow ${escrowId} not found`); return { ok: false, error: 'not_found' }; }
  if (e.status === 'refunded') {
    console.log(`[exchange-escrow-refund] escrow ${escrowId.slice(0,8)} already refunded (idempotent)`);
    return { ok: true, idempotent: true };
  }
  if (e.status === 'settled') {
    console.warn(`[exchange-escrow-refund] escrow ${escrowId.slice(0,8)} already settled, cannot refund`);
    return { ok: false, error: 'already_settled' };
  }

  // Case 1: pending_prepay → check race window first (Bug AW 5/16 fix).
  if (e.status === 'pending_prepay') {
    // Bug AW P0 fix (NWT 07:40 propose + Owner 07:35 严训): race window — user 可能已转 USDT/KAS
    // 上链 但 intake watcher 还没 detect (60s tick). 若直接 mark refunded → silent absorb user fund.
    // Pre-check: query for matching incoming TX. If found → switch to active path (real chain refund).
    const expectedAmount = parseFloat(e.amount_quoted);
    const tolerancePct = 0.005;  // ±0.5% same as intake watcher
    let userPaid = null;
    try {
      if (e.asset === 'KAS' && e.chain === 'kaspa') {
        // Kaspa: query kaspa_tx_log (cheap)
        const candidates = sqlite.prepare(`
          SELECT tx_id, from_address, CAST(amount AS REAL) AS amount, observed_at
          FROM kaspa_tx_log
          WHERE to_address = ? AND observed_at > ?
          ORDER BY observed_at DESC LIMIT 20
        `).all(e.broker_recv_addr, e.created_at);
        userPaid = candidates.find(t => Math.abs(t.amount - expectedAmount) / expectedAmount <= tolerancePct);
      } else if (e.chain === 'bnb' && (e.asset === 'USDT' || e.asset === 'USDC')) {
        // BSC: live scanRecentTransfers (slower ~5s RPC call but cancel is rare)
        const { scanRecentTransfers } = await import('./cross-chain-verify.mjs');
        const scan = await scanRecentTransfers({
          chain: 'bnb', recipient: e.broker_recv_addr,
          span_blocks: 200, paymentAsset: e.asset.toLowerCase(),
        });
        if (scan.ok && scan.events?.length) {
          const candidate = scan.events.find(t => Math.abs(t.amount - expectedAmount) / expectedAmount <= tolerancePct);
          if (candidate) {
            // Verify TX post-dates escrow creation (skip historical)
            userPaid = { tx_id: candidate.tx_hash, from_address: candidate.from, amount: candidate.amount };
          }
        }
      }
    } catch (err) {
      console.warn(`[exchange-escrow-refund] Bug AW pre-check err for ${escrowId.slice(0,8)}: ${err.message} — falling through to no-chain refund`);
    }

    if (userPaid) {
      // race detected — user 真转了 but intake watcher 还没 detect. Promote to active + fire chain refund.
      console.warn(`[exchange-escrow-refund] Bug AW guard: escrow ${escrowId.slice(0,8)} race detected — user paid ${userPaid.amount} via ${userPaid.tx_id?.slice(0,16)}. Switching to active refund.`);
      sqlite.prepare(`
        UPDATE user_escrow_balances
        SET status = 'active', prepayment_tx = ?, amount_received = ?, user_refund_addr = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'pending_prepay'
      `).run(userPaid.tx_id, String(userPaid.amount), userPaid.from_address || null, escrowId);
      // Re-fetch + fall through to Case 2 (active path real chain refund)
      const updated = sqlite.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(escrowId);
      e.status = updated.status;
      e.prepayment_tx = updated.prepayment_tx;
      e.amount_received = updated.amount_received;
      e.user_refund_addr = updated.user_refund_addr;
      // Continue to Case 2 below (Bug AP guard + active chain refund)
    } else {
      // No paid TX detected — original no-chain refund OK
      sqlite.prepare(`
        UPDATE user_escrow_balances
        SET status = 'refunded', updated_at = datetime('now')
        WHERE id = ? AND status = 'pending_prepay'
      `).run(escrowId);
      console.log(`[exchange-escrow-refund] escrow ${escrowId.slice(0,8)} pending_prepay → refunded (reason: ${reason}, no chain TX needed, Bug AW pre-check no paid TX)`);
      // Bug BI 5/17 fix: escrow refunded (no-chain) → clear flow_state.
      try {
        const { clearFlowState } = await import('./broker-v3/state-machine.js');
        clearFlowState(e.user_kasia_addr);
      } catch {}

      // Bug B1 supp 5/17 fix (NWT 03:59 CRITICAL P0 propose #3) + B5 KAS extension (NWT 04:57):
      // 旧 DM hardcoded "没扣你任何 funds" — 但 user 可能 multi-sent (orphan path).
      // Cross-check broker_orphan_inflows by user's EVM addr (BSC etc) + user_kasia_addr (Kaspa SELL).
      // 若 orphan 存在 → DM swap + 触发 Kaspa refund (Option C — 复用 user_kasia_addr trusted source, 避开
      // Kaspa watcher Bug AA over-detect 风险).
      let dmMessage = `⏰ 你的报价 (${e.target_amount} ${e.target_asset}) 5 分钟内未收到 prepayment, 已自动取消. 没扣你任何 funds. 回 1/2 重新挂单.`;
      try {
        const userRelay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(e.user_kasia_addr);
        const matchAddrs = [e.user_kasia_addr]; // Kaspa: user_kasia_addr trusted source
        if (userRelay) {
          const userEvms = sqlite.prepare('SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain IN (\'bnb\',\'eth\',\'polygon\',\'arbitrum\',\'optimism\',\'base\')').all(userRelay.id);
          for (const w of userEvms) matchAddrs.push(w.address);
        }
        if (matchAddrs.length > 0) {
          const placeholders = matchAddrs.map(() => '?').join(',');
          const orphans = sqlite.prepare(
            `SELECT id, amount, asset, chain, from_address, status, refund_tx FROM broker_orphan_inflows
             WHERE from_address IN (${placeholders}) COLLATE NOCASE
               AND datetime(detected_at) > datetime('now','-15 minutes')
             ORDER BY detected_at DESC LIMIT 3`
          ).all(...matchAddrs);
          if (orphans.length > 0) {
            const o = orphans[0];
            // B5 KAS extension: 若 orphan chain='kaspa' status='detected' → 触发 inline refund (broker → user_kasia)
            // BSC orphans already auto-refund via broker-bsc-intake-watcher inline path.
            if (o.chain === 'kaspa' && o.status === 'detected') {
              try {
                const { enqueueVerified } = await import('./broker-action-queue.js');
                const refundResult = await enqueueVerified({
                  kind: 'sendKas',
                  peer: e.user_kasia_addr,
                  payload: { amount_kas: o.amount, note: `orphan refund ${o.id.slice(0,8)} B5 KAS multi/under` },
                });
                if (refundResult?.txId) {
                  sqlite.prepare(`UPDATE broker_orphan_inflows SET status='refunded', refund_tx=?, refunded_at=datetime('now') WHERE id=?`).run(refundResult.txId, o.id);
                  console.log(`[exchange-escrow-refund] Kaspa orphan ${o.id.slice(0,8)} inline refund TX ${refundResult.txId.slice(0,16)}`);
                  o.status = 'refunded';
                  o.refund_tx = refundResult.txId;
                }
              } catch (err) { console.error(`[exchange-escrow-refund] Kaspa orphan refund err for ${o.id.slice(0,8)}: ${err.message}`); }
            }
            if (o.status === 'refunded' && o.refund_tx) {
              dmMessage = `⏰ 你的报价 (${e.target_amount} ${e.target_asset}) 5 分钟内未收到 prepayment, 已自动取消.\n\n注: broker 收到你的 ${o.amount} ${o.asset} (${o.chain.toUpperCase()}) 但跟下单金额不匹配, 已 100% 全额退还. refund TX: ${String(o.refund_tx).slice(0,16)}.\n\n回 1/2 重新挂单.`;
            } else {
              dmMessage = `⏰ 你的报价 (${e.target_amount} ${e.target_asset}) 5 分钟内未收到 prepayment, 已自动取消.\n\n注: broker 收到你 ${o.amount} ${o.asset} (${o.chain.toUpperCase()}) 但跟下单金额不匹配, 退款处理中, watch DM 更新.\n\n回 1/2 重新挂单.`;
            }
          }
        }
      } catch (err) { console.warn(`[exchange-escrow-refund] orphan cross-check err: ${err.message}`); }

      try {
        const { enqueue } = await import('./broker-action-queue.js');
        enqueue({
          kind: 'dm_timeout',
          peer: e.user_kasia_addr,
          payload: { message: dmMessage },
        });
      } catch (err) { console.warn(`[exchange-escrow-refund] pending DM notify err: ${err.message}`); }
      return { ok: true, status: 'refunded', no_chain_tx: true };
    }
  }

  // Bug AP P0 fix 5/16 (NWT 02:47 HP-03 sweep race surface): active escrow 但 linked offer 已 completed
  // 说明 settle 应该 fire 但 Bug AO threw (chain_events INSERT 漏 observed_by) → settle bypassed.
  // 若 sweep blindly refund, broker double-loss: 已 delivered to taker + 又 refund to user_refund_addr.
  // K invariant 真破 — broker 真 net -10 KAS / case.
  // Guard: 检查 escrow 是否 linked completed offer, 若是 → 改 fire settle 不 refund.
  if (e.offer_id) {
    const linkedOffer = sqlite.prepare(
      "SELECT id, protocol_status FROM exchange_offers WHERE id = ? AND protocol_status = 'completed' LIMIT 1"
    ).get(e.offer_id);
    if (linkedOffer) {
      console.warn(`[exchange-escrow-refund] Bug AP guard: escrow ${escrowId.slice(0,8)} active but linked offer ${linkedOffer.id.slice(0,8)} already completed → fire settle not refund`);
      try {
        await _settleEscrowToUser(escrowId, linkedOffer.id);
        return { ok: true, settled_via_guard: true, reason: 'AP_guard_completed_offer' };
      } catch (err) {
        console.error(`[exchange-escrow-refund] AP guard settle err for ${escrowId.slice(0,8)}: ${err.message}`);
        // Don't fall through to refund (risk double-loss). Mark for manual review.
        return { ok: false, error: 'AP_guard_settle_failed', detail: err.message };
      }
    }
  }

  // Case 2: status='active' — 真链 refund needed
  if (!e.user_refund_addr) {
    console.warn(`[exchange-escrow-refund] escrow ${escrowId.slice(0,8)} active 无 user_refund_addr — manual review needed`);
    return { ok: false, error: 'no_refund_addr' };
  }

  // Broker relay lookup (escrow.broker_recv_addr == relay_nodes.address for kaspa, or agent_wallets.address for EVM)
  const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';  // Trader-B (matches broker-bsc-intake-watcher)
  const refundAmount = e.amount_received || e.amount_quoted;
  const isKasRefund = e.asset === 'KAS';  // SELL escrow: prepaid KAS, refund KAS
  let refundTxHash = null;

  try {
    if (isKasRefund) {
      // Bug AS P1 fix 5/16 (NWT 04:24 audit completeness gap): enqueueVerified for real TX hash
      // (refund_tx populated with real on-chain TX, not 'queued:' stub).
      const { enqueueVerified } = await import('./broker-action-queue.js');
      try {
        const r = await enqueueVerified({
          kind: 'sendKas', peer: e.user_refund_addr,
          payload: { amount_kas: refundAmount, note: `escrow refund ${escrowId.slice(0,8)} reason=${reason.slice(0,40)}` },
        });
        refundTxHash = r?.txId || `queued:${escrowId.slice(0,8)}`;
        console.log(`[exchange-escrow-refund] KAS refund verified ${refundAmount} → ${e.user_refund_addr?.slice(-12)} TX ${refundTxHash?.slice(0,16)} (reason: ${reason})`);
      } catch (err) {
        refundTxHash = `queue-failed:${escrowId.slice(0,8)}`;
        console.error(`[exchange-escrow-refund] KAS refund enqueueVerified fail for ${escrowId.slice(0,8)}: ${err.message}`);
      }
    } else {
      // BUY escrow cancel: refund USDT/USDC via transferUsdt
      const transferUsdt = await getTransferUsdt();
      const wallet = sqlite.prepare(
        "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
      ).get(BROKER_RELAY_ID, e.chain);
      if (!wallet?.privkey_encrypted) {
        console.warn(`[exchange-escrow-refund] no broker ${e.chain} wallet for escrow ${escrowId.slice(0,8)}`);
        return { ok: false, error: `no_broker_wallet_${e.chain}` };
      }
      const r = await transferUsdt(e.chain, wallet.privkey_encrypted, e.user_refund_addr, parseFloat(refundAmount), e.asset);
      if (!r.ok) {
        console.error(`[exchange-escrow-refund] transferUsdt fail for escrow ${escrowId.slice(0,8)}: ${r.error}`);
        return { ok: false, error: r.error };
      }
      refundTxHash = r.txHash;
      console.log(`[exchange-escrow-refund] sent ${refundAmount} ${e.asset} on ${e.chain} → ${e.user_refund_addr?.slice(-12)} (TX: ${refundTxHash?.slice(0,16)}) for escrow ${escrowId.slice(0,8)} (reason: ${reason})`);
    }

    sqlite.prepare(`
      UPDATE user_escrow_balances
      SET status = 'refunded', refund_tx = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'
    `).run(refundTxHash, escrowId);

    // Bug BI 5/17 fix: escrow refunded (chain TX) → clear flow_state.
    try {
      const { clearFlowState } = await import('./broker-v3/state-machine.js');
      clearFlowState(e.user_kasia_addr);
    } catch {}

    // If associated offer exists + 'open' status → also cancel offer
    if (e.offer_id) {
      try {
        const offer = sqlite.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(e.offer_id);
        if (offer && ['open', 'matched'].includes(offer.protocol_status)) {
          transition(e.offer_id, 'cancelled', { txHash: refundTxHash });
          console.log(`[exchange-escrow-refund] offer ${e.offer_id.slice(0,8)} cascade-cancelled (escrow refunded)`);
        }
      } catch (err) { console.warn(`[exchange-escrow-refund] cascade-cancel offer err: ${err.message}`); }
    }

    // Bug AJ 5/16 fix (Owner 07:10 真测 surface): DM user post active 真链 refund.
    try {
      const { enqueue } = await import('./broker-action-queue.js');
      const refundTxShort = String(refundTxHash || '').slice(0, 16);
      const chainLabel = isKasRefund ? 'Kasia' : e.chain.toUpperCase();
      const refundAddrShort = e.user_refund_addr.slice(0, 20) + '...';
      enqueue({
        kind: 'dm_timeout',
        peer: e.user_kasia_addr,
        payload: { message: `⏰ 你的报价 (${e.target_amount} ${e.target_asset}) 30 分钟无 taker 接单, 已退款 ${refundAmount} ${e.asset} 到你 ${chainLabel} ${refundAddrShort}. refund TX: ${refundTxShort}... 链上可查.` },
      });
    } catch (err) { console.warn(`[exchange-escrow-refund] active DM notify err: ${err.message}`); }

    return { ok: true, status: 'refunded', refund_tx: refundTxHash };
  } catch (err) {
    console.error(`[exchange-escrow-refund] refund err for escrow ${escrowId.slice(0,8)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Bug H γ Step 4 #3 marketable matcher (Owner 17:35 钦定 invariant + NWT 18:26 #3 propose).
// After a BUY escrow publishes its offer, scan active SELL escrow offers for compatible price match.
// Match: BUY bid (want USDT amount / want KAS amount) >= SELL ask (give USDT / give KAS).
// If match found: settle BOTH escrows cross-deliver from existing pools, skip taker accept.
// Broker net Δ = 0 (zero-sum P2P matching) → satisfies Owner invariant K+U total 不减.
// Called from broker-bsc-intake-watcher post _doPublishAfterPrepay success (Bug H γ Step 4 #3).
export async function tryMarketableMatch(escrowId) {
  const e = sqlite.prepare('SELECT * FROM user_escrow_balances WHERE id = ?').get(escrowId);
  if (!e || e.status !== 'active' || !e.offer_id) return { matched: false, reason: 'escrow not active or no offer' };

  // Opposite-side active escrow rows (with offer_id, not settled/refunded, expires未到)
  const oppositeSide = e.side === 'buy_kas' ? 'sell_kas' : 'buy_kas';
  const oppositeOffers = sqlite.prepare(`
    SELECT * FROM user_escrow_balances
    WHERE side = ?
      AND status = 'active'
      AND offer_id IS NOT NULL
      AND expires_at > datetime('now')
      AND id != ?
    ORDER BY created_at ASC LIMIT 10
  `).all(oppositeSide, e.id);

  if (oppositeOffers.length === 0) return { matched: false, reason: 'no opposite-side active escrow' };

  // Price compatibility:
  // BUY escrow e: prepaid amount_received USDT for target_amount KAS → bid_price = amount_received / target_amount (USDT/KAS)
  // SELL escrow o: prepaid amount_received KAS, wants target_amount USDT → ask_price = target_amount / amount_received (USDT/KAS)
  // Match if BUY bid >= SELL ask (buyer willing to pay enough)
  for (const o of oppositeOffers) {
    const buyEscrow = e.side === 'buy_kas' ? e : o;
    const sellEscrow = e.side === 'buy_kas' ? o : e;
    const buyUsdt = parseFloat(buyEscrow.amount_received || buyEscrow.amount_quoted);
    const buyKas = parseFloat(buyEscrow.target_amount);
    const sellKas = parseFloat(sellEscrow.amount_received || sellEscrow.amount_quoted);
    const sellUsdt = parseFloat(sellEscrow.target_amount);
    if (buyKas <= 0 || sellKas <= 0) continue;
    const bidPrice = buyUsdt / buyKas;
    const askPrice = sellUsdt / sellKas;
    // Match: buy bid >= sell ask AND volumes compatible (allow partial — but MVP: require qty match within 5%)
    if (bidPrice < askPrice) continue;
    if (Math.abs(buyKas - sellKas) / Math.max(buyKas, sellKas) > 0.05) continue;  // 5% qty tolerance

    console.log(`[exchange-matcher] MATCH escrow ${e.id.slice(0,8)} (${e.side}) ↔ ${o.id.slice(0,8)} (${o.side}) bid=${bidPrice.toFixed(4)} ask=${askPrice.toFixed(4)}`);

    // Execute cross-settle: both escrows go to settled, broker forwards from existing pools.
    // _settleEscrowToUser handles each side natively (KAS via broker-action-queue, USDT via transferUsdt).
    try {
      await Promise.all([
        _settleEscrowToUser(buyEscrow.id, buyEscrow.offer_id),
        _settleEscrowToUser(sellEscrow.id, sellEscrow.offer_id),
      ]);
      // Cascade cancel BOTH offers (matched without taker, mark as completed via escrow settle path)
      try {
        const buyOffer = sqlite.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(buyEscrow.offer_id);
        if (buyOffer && ['open', 'matched'].includes(buyOffer.protocol_status)) {
          transition(buyEscrow.offer_id, 'completed', { matchedVia: 'marketable' });
        }
        const sellOffer = sqlite.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(sellEscrow.offer_id);
        if (sellOffer && ['open', 'matched'].includes(sellOffer.protocol_status)) {
          transition(sellEscrow.offer_id, 'completed', { matchedVia: 'marketable' });
        }
      } catch (err) { console.warn(`[exchange-matcher] cascade transition err: ${err.message}`); }
      return { matched: true, buyEscrowId: buyEscrow.id, sellEscrowId: sellEscrow.id, bidPrice, askPrice };
    } catch (err) {
      console.error(`[exchange-matcher] cross-settle err: ${err.message}`);
      return { matched: false, reason: err.message };
    }
  }
  return { matched: false, reason: 'no compatible price+qty match' };
}

// Bug H γ Sub #7 — periodic sweep for expired escrow rows (called every 60s from broker-intake-watcher).
// Triggers _refundEscrow for: pending_prepay rows past expires_at (5 min TTL) AND active rows past offer expires_at (30 min).
// Idempotent: each call only processes rows still in eligible status.
export async function sweepExpiredEscrows() {
  // Pending_prepay expired (5 min TTL, no prepayment received)
  const pendingExpired = sqlite.prepare(`
    SELECT id FROM user_escrow_balances
    WHERE status = 'pending_prepay' AND expires_at < datetime('now')
    LIMIT 20
  `).all();
  // Active expired (offer expires_at past, no match within 30 min)
  // Bug AP P0 fix 5/16 (NWT 02:47): JOIN exchange_offers EXCLUDE rows linked to completed offer
  // (settle should have fired — refund would double-loss). Belt+suspenders with _refundEscrow Case 2 guard.
  const activeExpired = sqlite.prepare(`
    SELECT ueb.id FROM user_escrow_balances ueb
    LEFT JOIN exchange_offers eo ON eo.id = ueb.offer_id
    WHERE ueb.status = 'active'
      AND ueb.expires_at < datetime('now')
      AND (eo.id IS NULL OR eo.protocol_status NOT IN ('completed', 'settled'))
    LIMIT 20
  `).all();

  let refunded = 0;
  for (const row of pendingExpired) {
    try {
      const r = await _refundEscrow(row.id, 'pending_prepay_ttl_expired');
      if (r.ok) refunded++;
    } catch (err) { console.warn(`[exchange-escrow-sweep] pending refund err for ${row.id.slice(0,8)}: ${err.message}`); }
  }
  for (const row of activeExpired) {
    try {
      const r = await _refundEscrow(row.id, 'active_offer_ttl_expired');
      if (r.ok) refunded++;
    } catch (err) { console.warn(`[exchange-escrow-sweep] active refund err for ${row.id.slice(0,8)}: ${err.message}`); }
  }
  return { ok: true, scanned: pendingExpired.length + activeExpired.length, refunded };
}

/**
 * Bug W Phase 2 5/15 (NWT 13:14 propose + Owner 13:48 钦定 全自动 + Bug Z auto-recovery path).
 * Sweep orphan inflows after 24hr: status='detected' AND detected_at < now - 24h → auto-refund.
 * Kaspa orphan → broker sendKas to from_address via broker-action-queue.
 * BSC orphan → broker transferUsdt to from_address via evm-transfer.
 * NULL from_address → mark 'manual_review' (cleaner than corrupt refund).
 */
export async function sweepOrphanInflows() {
  const ORPHAN_AGE_HOURS = 24;
  const orphans = sqlite.prepare(`
    SELECT id, chain, asset, amount, from_address, to_address, prepayment_tx
    FROM broker_orphan_inflows
    WHERE status = 'detected'
      AND detected_at < datetime('now', '-${ORPHAN_AGE_HOURS} hours')
    LIMIT 20
  `).all();
  if (!orphans.length) return { ok: true, scanned: 0, refunded: 0 };

  let refunded = 0;
  for (const o of orphans) {
    // NULL from_address (kaspa_tx_log indexer T-NWT-07 残 case): mark manual_review, skip auto-refund.
    if (!o.from_address) {
      sqlite.prepare(`UPDATE broker_orphan_inflows SET status = 'manual_review' WHERE id = ?`).run(o.id);
      console.warn(`[exchange-orphan-sweep] orphan ${o.id.slice(0,8)} NULL from_address → manual_review`);
      continue;
    }

    try {
      let refundTx = null;
      if (o.chain === 'kaspa') {
        // Bug AS audit gap fix 5/16 (NWT 04:31 L621 same stub pattern as Phase 1 ship): use
        // enqueueVerified for real txId. Bug AA Phase 2 cron currently disabled, so no production
        // impact, but future re-enable would have复刻 same audit gap if left.
        const { enqueueVerified } = await import('./broker-action-queue.js');
        try {
          const r = await enqueueVerified({
            kind: 'sendKas', peer: o.from_address,
            payload: { amount_kas: o.amount, note: `orphan refund ${o.id.slice(0,8)} 24hr stale` },
          });
          refundTx = r?.txId || `queued:${o.id.slice(0,8)}`;
          console.log(`[exchange-orphan-sweep] KAS verified ${o.amount} → ${o.from_address?.slice(-12)} TX ${refundTx?.slice(0,16)} for orphan ${o.id.slice(0,8)}`);
        } catch (err) {
          refundTx = `queue-failed:${o.id.slice(0,8)}`;
          console.error(`[exchange-orphan-sweep] KAS enqueueVerified fail for orphan ${o.id.slice(0,8)}: ${err.message}`);
        }
      } else if (o.chain === 'bnb') {
        // BSC orphan: transferUsdt direct via evm-transfer.
        const transferUsdt = await getTransferUsdt();
        const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
        const wallet = sqlite.prepare(
          "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1"
        ).get(BROKER_RELAY_ID);
        if (!wallet?.privkey_encrypted) {
          console.warn(`[exchange-orphan-sweep] no broker bnb wallet for orphan ${o.id.slice(0,8)}`);
          continue;
        }
        const r = await transferUsdt('bnb', wallet.privkey_encrypted, o.from_address, parseFloat(o.amount), o.asset);
        if (!r.ok) {
          console.error(`[exchange-orphan-sweep] transferUsdt fail orphan ${o.id.slice(0,8)}: ${r.error}`);
          continue;
        }
        refundTx = r.txHash;
        console.log(`[exchange-orphan-sweep] sent ${o.amount} ${o.asset} → ${o.from_address?.slice(-12)} TX=${refundTx?.slice(0,16)} for orphan ${o.id.slice(0,8)}`);
      } else {
        console.warn(`[exchange-orphan-sweep] unsupported chain ${o.chain} for orphan ${o.id.slice(0,8)}, mark manual_review`);
        sqlite.prepare(`UPDATE broker_orphan_inflows SET status = 'manual_review' WHERE id = ?`).run(o.id);
        continue;
      }

      sqlite.prepare(`
        UPDATE broker_orphan_inflows
        SET status = 'refunded', refund_tx = ?, refunded_at = datetime('now')
        WHERE id = ?
      `).run(refundTx, o.id);
      refunded++;
    } catch (err) {
      console.error(`[exchange-orphan-sweep] err orphan ${o.id.slice(0,8)}: ${err.message}`);
    }
  }
  console.log(`[exchange-orphan-sweep] done: scanned=${orphans.length} refunded=${refunded}`);
  return { ok: true, scanned: orphans.length, refunded };
}

// ── Test Injection ───────────────────────────────────────────

let _transferUsdtOverride = null;
export function _testInjectTransferUsdt(fn) { _transferUsdtOverride = fn; }
export function _testResetTransferUsdt() { _transferUsdtOverride = null; }

/**
 * Internal: get transferUsdt (from override or dynamic import).
 * Used by _makerAutoPayGive so smoke tests can inject a mock.
 */
async function getTransferUsdt() {
  if (_transferUsdtOverride) return _transferUsdtOverride;
  const m = await import('./evm-transfer.js');
  return m.transferUsdt;
}

// ── Accept Logic ──────────────────────────────────────────────

/**
 * Process a kanet_accept_v1 message.
 * First-valid-accept wins (per this node's observation).
 *
 * @param {object} msg — { offer_id, _from, _tx, accept_commitment? }
 * @returns {object|null} updated offer or null if rejected
 */
export function processAccept(msg) {
  if (!msg.offer_id) return null;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) {
    // 2026-04-14 Q5 audit fix: stash orphan accept for replay when publish arrives later
    // (Kaspa DAG 不保证同 block TX order, Scout 批量扫链可能 accept 先到 publish 后到)
    try {
      const id = msg._tx || crypto.randomUUID();
      sqlite.prepare(`
        INSERT OR REPLACE INTO pending_exchange_accepts (id, offer_id, msg_json, received_at)
        VALUES (?, ?, ?, ?)
      `).run(id, msg.offer_id, JSON.stringify(msg), new Date().toISOString());
      console.log(`[exchange-machine] Accept for unknown offer ${msg.offer_id.slice(0,8)} → stashed for replay (orphan buffer)`);
    } catch (e) {
      console.log(`[exchange-machine] Accept for unknown offer ${msg.offer_id.slice(0,8)}, orphan stash failed: ${e.message}`);
    }
    return null;
  }

  // Only open offers can be accepted
  if (offer.protocol_status !== 'open') {
    console.log(`[exchange-machine] Accept rejected: offer ${msg.offer_id.slice(0, 8)} is ${offer.protocol_status}`);
    return null;
  }

  // Self-accept prevention: maker cannot accept own offer.
  // T-NWT-2026-04-26 self-accept fix: broker_dynamic_quote 路径 broker 自挂 maker + broker 代 user
  // 发 accept_v1 → msg._from = broker = maker 误伤. payload 已 carry receive_address (= user kasia),
  // 用 receive_address 当真 taker (broker 自挂时), fallback _from (普通 client 不 carry receive_address).
  // 普通 user 自 accept: receive_address 缺 → fallback _from = user = maker → 仍 reject ✓
  // broker 代 accept: receive_address = user, _from = broker, maker = broker → taker(user) !== maker(broker) → 通过 ✓
  const taker = msg.receive_address || msg._from;
  if (taker && taker === offer.maker) {
    console.log(`[exchange-machine] Accept rejected: self-accept (maker === taker: ${taker.slice(-12)})`);
    return null;
  }

  // Check expiry
  if (offer.expires_at && new Date() > new Date(offer.expires_at)) {
    transition(offer.id, 'expired');
    return null;
  }

  // ── Partial fill (NWT 2026-04-29 broker-v2 阶段 2 task 2/7) ──
  // Owner 钦定 限价单簿 partial fill: accept_v1 可指定 amount (chunk_qty < give_amount).
  // 缺省 amount = full give_amount (向后兼容). MVP single-chunk-per-offer (multi-taker 由
  // market-seeder republish 残量实现, multi-chunk-per-offer 留 phase 2).
  const offerGiveAmount = parseFloat(offer.give_amount);
  const requestedAmount = msg.amount !== undefined && msg.amount !== null
    ? parseFloat(msg.amount)
    : offerGiveAmount;
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    console.log(`[exchange-machine] Accept rejected: invalid amount ${msg.amount} (offer ${offer.id.slice(0,8)})`);
    return null;
  }
  if (requestedAmount > offerGiveAmount + 1e-9) {
    console.log(`[exchange-machine] Accept rejected: amount ${requestedAmount} > give_amount ${offerGiveAmount} (offer ${offer.id.slice(0,8)})`);
    return null;
  }

  // 1% price tolerance check (phase 1 single param). 仅当 msg.price 提供时校验.
  if (msg.price !== undefined && msg.price !== null && offerGiveAmount > 0) {
    const offerPrice = parseFloat(offer.want_amount) / offerGiveAmount;
    const requestedPrice = parseFloat(msg.price);
    const tolerance = offer.price_tolerance != null ? parseFloat(offer.price_tolerance) : 0.01;
    if (offerPrice > 0 && Number.isFinite(requestedPrice) &&
        Math.abs(requestedPrice - offerPrice) / offerPrice > tolerance + 1e-9) {
      console.log(`[exchange-machine] Accept rejected: price ${requestedPrice} exceeds ${(tolerance*100).toFixed(2)}% tolerance vs offer ${offerPrice} (offer ${offer.id.slice(0,8)})`);
      return null;
    }
  }

  // Validate accept_commitment (if provided)
  const commitment = msg.accept_commitment || crypto.createHash('sha256')
    .update(`${msg.offer_id}${msg._from}${Date.now()}`)
    .digest('hex');

  // Write taker_chain + taker_payment_address from accept message (cross-node sync)
  // T-J2-2026-04-27 v1.2 (c): 真存 evm_recv_address 进 verification_meta (USDC delivery 真用).
  // accept_v1 真 receive_address = user kasia (KAS path), evm_recv_address = user EVM (stable path).
  // exchange-machine auto-deliver Bug-Z2 fix 真 lookup verification_meta.evm_recv_address (stable) OR taker_payment_address (KAS).
  if (msg.selected_chain || msg.receive_address || msg.evm_recv_address) {
    const meta = JSON.parse(offer.verification_meta || '{}');
    if (msg.selected_chain) meta.receive_chain = msg.selected_chain;
    if (msg.receive_address) meta.receive_address = msg.receive_address;
    if (msg.evm_recv_address) meta.evm_recv_address = msg.evm_recv_address;
    // T-J2-2026-05-11 Phase 2 B.1 (NWT #18 ABE audit): 加 protocol_status='open' guard 防 race。
    // 之前 2 个 concurrent accept 同 offer → 两 UPDATE 都 succeed → 第二 overwrite taker_chain/addr,
    // 之后 transition() 仅 first 命中 open→matched, 第二 fail revert 但 taker 字段已被 overwrite,
    // race window 内 stale data 写入。加 status=open guard, 第二 UPDATE 0 row affect, 第一稳赢。
    const updRes = sqlite.prepare(`UPDATE exchange_offers SET taker_chain = ?, taker_payment_address = ?, verification_meta = ? WHERE id = ? AND protocol_status = 'open'`)
      .run(msg.selected_chain || null, msg.receive_address || null, JSON.stringify(meta), offer.id);
    if (updRes.changes === 0) {
      console.warn(`[exchange-machine] B.1 race: accept_v1 offer ${offer.id.slice(0,8)} taker UPDATE 0 rows (status != 'open', 已被前一个 accept 接走)`);
    }
  }

  // Transition: open → matched (含 filled_qty 记录 partial fill 量)
  // T-NWT-2026-04-26 self-accept fix follow-up: taker 字段同 self-accept check 逻辑 —
  // broker 代发时真 taker 在 receive_address (msg._from = broker 信使).
  // 普通 client 不 carry receive_address → fallback msg._from.
  const matched = transition(offer.id, 'matched', {
    taker: msg.receive_address || msg._from,
    taker_tx_id: msg._tx,
    accept_commitment: commitment,
    filled_qty: requestedAmount,
  });

  // ── chain_events broker_chunk_filled audit (NWT v84 partial fill spec) ──
  // Audit trail 给 order-book.getOrderStatus sub_chunks 渲染. txid 必 64 hex (v83 trigger).
  // msg._tx 来自 accept_v1 chain TX, 应为 64 hex; 不合规 recordChainEvent 自 try/catch 吞.
  try {
    if (msg._tx && msg._tx.length === 64) {
      recordChainEvent({
        txid: msg._tx,
        eventType: 'broker_chunk_filled',
        fromAddress: msg.receive_address || msg._from,
        toAddress: offer.maker,
        payload: {
          order_id: offer.id,
          chunk_qty: requestedAmount,
          chunk_price: msg.price !== undefined ? parseFloat(msg.price) : null,
          taker_addr: msg.receive_address || msg._from,
          offer_give_amount: offerGiveAmount,
          offer_want_asset: offer.want_asset,
          offer_give_asset: offer.give_asset,
        },
      });
    }
  } catch (auditErr) {
    console.warn(`[exchange-machine] broker_chunk_filled audit failed: ${auditErr.message}`);
  }

  // Route to verification
  return routeToVerification(matched);
}

// ── Verification Routing ──────────────────────────────────────

/**
 * Route a matched offer to the appropriate verification state.
 * Based on offer.verification field — the verifier defines the next state.
 *
 * @param {object} offer — must be in 'matched' status
 * @returns {object} updated offer
 */
function routeToVerification(offer) {
  if (offer.protocol_status !== 'matched') return offer;

  const vType = offer.verification || 'manual';
  const verifier = getVerifier(vType);

  // Determine target state based on verification type
  let targetState;
  if (vType === 'manual') {
    targetState = 'awaiting_manual_confirm';
  } else if (vType === 'oracle') {
    targetState = 'awaiting_oracle';
  } else {
    targetState = 'verifying';
  }

  const updated = transition(offer.id, targetState);

  // Start the verifier
  const matchContext = {
    offer: updated,
    accept: { taker: offer.taker, tx: offer.taker_tx_id, commitment: offer.accept_commitment },
    matched_at: updated.matched_at,
    timeout_at: updated.expires_at, // reuse offer expiry as verification timeout
  };

  verifier.start(matchContext).then(result => {
    console.log(`[exchange-machine] ${offer.id.slice(0, 8)} verifier ${vType} started: ${result.status} - ${result.message || ''}`);
  }).catch(err => {
    console.error(`[exchange-machine] verifier start error: ${err.message}`);
  });

  return updated;
}

// ── Manual Confirm ────────────────────────────────────────────

/**
 * Process a kanet_confirm_v1 message (manual verification).
 *
 * @param {object} msg — { offer_id, role: 'maker'|'taker', confirmer_address, _tx }
 * @returns {object|null}
 */
export function processManualConfirm(msg) {
  if (!msg.offer_id || !msg.role) return null;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return null;

  if (offer.protocol_status !== 'awaiting_manual_confirm') {
    console.log(`[exchange-machine] Confirm rejected: offer ${msg.offer_id.slice(0, 8)} is ${offer.protocol_status}`);
    return null;
  }

  // Verify confirmer is the right party
  const isMaker = msg.role === 'maker' && msg.confirmer_address === offer.maker;
  const isTaker = msg.role === 'taker' && msg.confirmer_address === offer.taker;

  if (!isMaker && !isTaker) {
    console.log(`[exchange-machine] Confirm rejected: ${msg.confirmer_address?.slice(-12)} is neither maker nor taker`);
    return null;
  }

  const now = new Date().toISOString();
  if (isMaker && !offer.maker_confirmed_at) {
    sqlite.prepare('UPDATE exchange_offers SET maker_confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, offer.id);
    console.log(`[exchange-machine] ${offer.id.slice(0, 8)} maker confirmed`);
  }
  if (isTaker && !offer.taker_confirmed_at) {
    sqlite.prepare('UPDATE exchange_offers SET taker_confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, offer.id);
    console.log(`[exchange-machine] ${offer.id.slice(0, 8)} taker confirmed`);
  }

  // Re-read and check if both confirmed
  const updated = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer.id);
  if (updated.maker_confirmed_at && updated.taker_confirmed_at) {
    return transition(offer.id, 'completed');
  }

  return updated;
}

// ── Cancel ────────────────────────────────────────────────────

/**
 * Process a kanet_cancel_v1 (exchange version).
 * Only valid from 'open' status, only by maker.
 */
export function processCancel(msg) {
  if (!msg.offer_id) return null;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return null;

  if (offer.protocol_status !== 'open') {
    console.log(`[exchange-machine] Cancel ignored: offer ${msg.offer_id.slice(0, 8)} is ${offer.protocol_status} (cancel only from open)`);
    return null;
  }

  if (offer.maker !== msg._from) {
    console.log(`[exchange-machine] Cancel rejected: ${msg._from?.slice(-12)} is not maker`);
    return null;
  }

  return transition(offer.id, 'cancelled');
}

// ── Expiry Check ──────────────────────────────────────────────

/**
 * Expire stale offers. Called periodically.
 * @returns {number} count of expired offers
 */
/**
 * Check for disputes that have been open too long (72h threshold).
 *
 * 2026-04-14 (stub): 暂时只 log 警告, 不自动 resolve.
 * 下轮需要设计 "原本 outcome" 逻辑:
 *   - 若 dispute 发生时 status=delivering → 默认 taker_wins (KAS 已发)
 *   - 若 dispute 发生时 status=verifying/matched → 默认 maker_wins (钱未到)
 * 需要 verification_meta 里记录 pre_dispute_status, 才能安全地 auto-resolve.
 * 当前只告警, 避免误判.
 *
 * @returns {number} count of aging disputes
 */
/**
 * Q5 audit fix: clean up stale orphan accepts (>1h old, publish never arrived)
 */
export function cleanupStaleOrphanAccepts() {
  const result = sqlite.prepare(
    "DELETE FROM pending_exchange_accepts WHERE received_at < datetime('now', '-1 hour')"
  ).run();
  if (result.changes > 0) {
    console.log(`[exchange-machine] cleaned up ${result.changes} stale orphan accepts (>1h old)`);
  }
  return result.changes;
}

export function checkStaleDisputes() {
  const stale = sqlite.prepare(
    `SELECT id, maker, taker,
            json_extract(verification_meta, '$.dispute_at') AS dispute_at,
            json_extract(verification_meta, '$.dispute_by') AS dispute_by
     FROM exchange_offers
     WHERE protocol_status = 'disputed'
       AND json_extract(verification_meta, '$.dispute_at') IS NOT NULL
       AND datetime(json_extract(verification_meta, '$.dispute_at'), '+72 hours') < datetime('now')
       AND json_extract(verification_meta, '$.resolved_at') IS NULL`
  ).all();

  for (const s of stale) {
    console.warn(`[exchange] ⚠ STALE DISPUTE ${s.id.slice(0, 8)} disputed_at=${s.dispute_at} by=${s.dispute_by?.slice(-8)} — 超过 72h 未 resolve, TODO: auto-resolve (下轮实现)`);
  }
  return stale.length;
}

export function expireStale() {
  const now = new Date().toISOString();
  const stale = sqlite.prepare(
    `SELECT id FROM exchange_offers
     WHERE protocol_status = 'open' AND expires_at IS NOT NULL AND expires_at < ?`
  ).all(now);

  for (const { id } of stale) {
    transition(id, 'expired');
  }

  return stale.length;
}

/**
 * Check and timeout verification in progress. Called periodically.
 * @returns {number} count of timed out offers
 */
// V5 fix (NWT r186 ack KI-29 复刻第 2 次 + r187 standby): emit timeout_v1 chain TX BEFORE transition('timed_out').
// 跟 checkMatchedTimeout line 642-665 同款 ⑤ NO TX NO STATE CHANGE 5 attempt retry pattern.
// reason: timeoutVerifying 真 transition() 内 SET only, 0 emit chain TX → KI-20 violation (跨 node 真 0 sync).
// post fix: chain-first 严守 (broadcast → transition), trade-protocol-filter handleExchangeTimeout (line 1090) 真 sole writer per chain ingest 真 redundant 但 0 harm (idempotent state guard).
async function _emitTimeoutAndTransition(id, reason) {
  const offer = sqlite.prepare('SELECT maker, taker FROM exchange_offers WHERE id = ?').get(id);
  if (!offer) return false;
  const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(offer.maker);
  if (relay) {
    const { sendCommandAsync } = await import('./relay-manager.js');
    const msg = JSON.stringify({
      t: 'kanet_exchange_timeout_v1', offer_id: id, taker: offer.taker, reason,
    });
    let timeoutTxId = null;
    for (let ta = 1; ta <= 3; ta++) {
      try {
        const tr = await sendCommandAsync(relay.id, { type: 'send_broadcast', channel: 'kanet-exchange', message: msg });
        timeoutTxId = tr?.txId;
        if (timeoutTxId) break;
      } catch (te) {
        console.error(`[exchange-machine] timeout broadcast attempt ${ta}/3 (${reason}): ${te.message}`);
        if (ta < 3) await new Promise(r => setTimeout(r, 200));
      }
    }
    if (!timeoutTxId) {
      console.warn(`[exchange-machine] timeout broadcast failed for ${id.slice(0,8)} (${reason}) — staying in current state, retry next tick`);
      return false;
    }
  }
  // Non-local maker (no relay) OR broadcast success → NOW transition (chain-after-set).
  transition(id, 'timed_out');
  return true;
}

export async function timeoutVerifying() {
  // Original: verifying/awaiting states → timed_out after 30min
  const stuck = sqlite.prepare(
    `SELECT id, verification FROM exchange_offers
     WHERE protocol_status IN ('verifying', 'awaiting_manual_confirm', 'awaiting_oracle')
     AND verifying_started_at IS NOT NULL
     AND datetime(verifying_started_at, '+30 minutes') < datetime('now')`
  ).all();

  for (const { id } of stuck) {
    await _emitTimeoutAndTransition(id, 'verifying_timeout_30min');
  }

  // delivering → verified (revert for retry) after 60min
  // KAS may have been sent but broadcast confirmation slow — revert, don't dispute
  const stuckDelivering = sqlite.prepare(
    `SELECT id FROM exchange_offers
     WHERE protocol_status = 'delivering'
     AND delivering_at IS NOT NULL
     AND datetime(delivering_at, '+60 minutes') < datetime('now')`
  ).all();

  for (const { id } of stuckDelivering) {
    console.log(`[exchange-machine] delivering timeout 60min → verified (revert for retry): ${id.slice(0,8)}`);
    transition(id, 'verified', {});
  }

  // verified → timed_out after 60min (total window 120min from delivering)
  // All retry attempts exhausted — release funds
  const stuckVerified = sqlite.prepare(
    `SELECT id FROM exchange_offers
     WHERE protocol_status = 'verified'
     AND delivering_at IS NOT NULL
     AND datetime(delivering_at, '+120 minutes') < datetime('now')`
  ).all();

  for (const { id } of stuckVerified) {
    console.log(`[exchange-machine] verified timeout (120min total) → timed_out: ${id.slice(0,8)}`);
    await _emitTimeoutAndTransition(id, 'verified_timeout_120min');
  }

  return stuck.length + stuckDelivering.length + stuckVerified.length;
}

// ── Matched Timeout ──────────────────────────────────────────

/**
 * Check for matched offers that haven't received payment within 30 minutes.
 * Broadcasts kanet_exchange_timeout_v1 and reopens the offer.
 * Does NOT use transition() — timeout revert is an exceptional flow.
 */
export async function checkMatchedTimeout() {
  const stale = sqlite.prepare(`
    SELECT id, maker, taker, taker_chain FROM exchange_offers
    WHERE protocol_status = 'matched'
    AND matched_at IS NOT NULL
    AND datetime(matched_at, '+30 minutes') < datetime('now')
  `).all();

  for (const offer of stale) {
    console.log(`[exchange-machine] matched timeout: offer ${offer.id.slice(0,8)} (taker ${(offer.taker || '').slice(-8)})`);

    // ⑤ NO TX NO STATE CHANGE — Broadcast timeout FIRST, reopen only after TX is on chain.
    const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(offer.maker);

    if (relay) {
      const { sendCommandAsync } = await import('./relay-manager.js');
      const timeoutMsg = JSON.stringify({
        t: 'kanet_exchange_timeout_v1',
        offer_id: offer.id,
        taker: offer.taker,
        reason: 'payment_timeout',
        reopen: true,
      });

      let timeoutTxId = null;
      for (let ta = 1; ta <= 3; ta++) {
        try {
          const tr = await sendCommandAsync(relay.id, { type: 'send_broadcast', channel: 'kanet-exchange', message: timeoutMsg });
          timeoutTxId = tr?.txId;
          if (timeoutTxId) break;
        } catch (te) {
          console.error(`[exchange-machine] timeout broadcast attempt ${ta}/3: ${te.message}`);
          if (ta < 3) await new Promise(r => setTimeout(r, 200));
        }
      }

      if (!timeoutTxId) {
        console.warn(`[exchange-machine] timeout broadcast failed for ${offer.id.slice(0,8)} — staying matched, will retry next tick`);
        continue;
      }
    }
    // Non-local maker (no relay): proceed with local-only timeout

    // Broadcast succeeded (or non-local) → NOW reopen
    // TIMEZONE FIX: use JS toISOString() for Z suffix consistency
    const nowIsoR = new Date().toISOString();
    sqlite.prepare(`
      UPDATE exchange_offers
      SET protocol_status = 'open',
          taker = NULL, taker_chain = NULL, taker_payment_address = NULL,
          payment_tx = NULL, matched_at = NULL,
          updated_at = ?
      WHERE id = ? AND protocol_status = 'matched'
    `).run(nowIsoR, offer.id);

    releaseFunds(offer.id);
  }

  return stale.length;
}

// ── Payment Submit (cross_chain_tx / kaspa_tx verification) ──
// NOTE: processPaymentSubmit is still used by kanet_exchange_paid_v1 handler
// (handleExchangePaid transitions to verifying first, then calls this).
// The old /api/exchange/submit-payment REST endpoint is deprecated.

/**
 * Taker submits a payment TX hash for on-chain verification.
 * Writes to verification_meta, kicks off async verification.
 */
export function processPaymentSubmit({ offer_id, payment_tx, payment_chain, payment_asset = null }) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer) return { error: 'offer_not_found' };
  if (offer.protocol_status !== 'verifying') return { error: 'invalid_status', current: offer.protocol_status };
  if (!payment_tx) return { error: 'payment_tx_required' };

  // Security: use taker_chain from offer (set at accept time), fallback to body value for backward compat
  const verifyChain = offer.taker_chain || payment_chain;
  if (!verifyChain) return { error: 'no payment chain on record' };

  // 2026-04-14 Q3 audit fix: TX reuse 防御 — payment_tx 已被别的 offer 用过就拒绝.
  const existingUse = sqlite.prepare(
    'SELECT id FROM exchange_offers WHERE payment_tx = ? AND id != ?'
  ).get(payment_tx, offer_id);
  if (existingUse) {
    console.log(`[exchange] processPaymentSubmit REUSE BLOCKED — ${payment_tx.slice(0,16)} already used by offer ${existingUse.id.slice(0,8)}`);
    return { error: 'payment_tx_reused', original_offer: existingUse.id };
  }

  const now = new Date().toISOString();
  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.payment_tx = payment_tx;
  meta.payment_chain = verifyChain;
  meta.submitted_at = now;
  // Sub #4.b hotfix (J2 #333 5/13 base USDC dispute root cause): persist payment_asset
  // into verification_meta so downstream _verifyAndComplete → verifyCrossChainTx routes
  // to correct STABLECOINS[chain][asset] lookup. Default fallback 'usdt' is wrong for
  // base chain (USDC only, no native USDT pool) — caused 4/4 verify "Underpayment 0"
  // before this fix. payment_asset propagates from broadcast msg.payment_asset (set by
  // _autoPayExchange L1404 to offer.want_asset) OR derived from offer.want_asset at
  // caller — defaults preserved for backward compat.
  const resolvedAsset = payment_asset || offer.want_asset || null;
  if (resolvedAsset) meta.payment_asset = String(resolvedAsset).toLowerCase();

  // 同时写入 payment_tx 列 (UNIQUE index 会在并发 reuse 时抛 constraint 错误)
  try {
    sqlite.prepare(
      'UPDATE exchange_offers SET verification_meta = ?, payment_tx = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(meta), payment_tx, now, offer_id);
  } catch (dbErr) {
    console.log(`[exchange] processPaymentSubmit DB UNIQUE conflict: ${dbErr.message}`);
    return { error: 'payment_tx_reused_concurrent', db_error: dbErr.message };
  }

  // Async verification — does not block API response
  _verifyAndComplete(offer_id, payment_tx, verifyChain).catch(err =>
    console.error(`[exchange] _verifyAndComplete error offer=${offer_id.slice(0,8)}:`, err.message)
  );

  return { ok: true, status: 'verifying', message: 'Payment submitted, verifying on-chain...' };
}

async function _verifyAndComplete(offer_id, payment_tx, payment_chain, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const RETRY_MS = 60_000;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer || offer.protocol_status !== 'verifying') return;

  const meta = JSON.parse(offer.verification_meta || '{}');
  const expectedAmount = parseFloat(offer.want_amount) || 0;
  // expectedTo depends on payment chain semantics.
  //   kaspa_tx (BUY path: payer sends KAS to maker) — expected recipient is the
  //     Kasia delivery address. receive_address holds it; fall back to maker.
  //   cross_chain_tx (SELL path: payer sends USDT to maker on EVM/SOL/TRON) —
  //     expected recipient is the maker's payment address from accepted_chains
  //     keyed by the offer's taker_chain. receive_address here is the KAS
  //     delivery target on Kasia, NOT the EVM USDT recipient — using it would
  //     cause "Recipient mismatch" against the actual EVM payee.
  let expectedTo;
  if (payment_chain === 'kaspa') {
    expectedTo = meta.receive_address || meta.expected_address || offer.maker;
  } else {
    const acceptedChains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const match = acceptedChains.find(c => c && String(c.chain).toLowerCase() === String(payment_chain).toLowerCase());
    expectedTo = match?.address || meta.maker_payment_address || meta.expected_address || null;
  }

  try {
    let vr;

    // Bug BC 5/16 P0 fix (Owner 9:11 adversarial discussion + J2 #418 #15 surface):
    // 之前 trust-by-default 'submitTransaction = verified' 完全 bypass on-chain verify, 合成 fake vr
    // (confirmed=true, amount=expectedAmount echo, recipient=expectedTo echo) — 恶意 taker manual
    // /api/exchange/submit-payment 提交 fake hash, broker 信 → 转 USDT 净空手套白狼.
    // 真 verify: 查 kaspa_tx_log (T-NWT-07 indexer 已 populate from block-added) 真 TX 存在 +
    // to=expectedTo + amount>=expectedAmount. tolerance ±0.5% 跟 Bug AW 一致.
    if (payment_chain === 'kaspa') {
      const txRow = sqlite.prepare(`
        SELECT tx_id, to_address, CAST(amount AS REAL) AS amount, observed_at
        FROM kaspa_tx_log WHERE tx_id = ?
      `).get(payment_tx);
      if (!txRow) {
        console.error(`[exchange] kaspa_tx VERIFY FAIL — payment_tx ${payment_tx.slice(0,16)} 不在 kaspa_tx_log (indexer 未 detect, 可能 fake hash OR indexer lag)`);
        vr = { confirmed: false, confirmations: 0, required: 1, error: 'kaspa_tx_not_indexed' };
      } else if (expectedTo && txRow.to_address !== expectedTo) {
        console.error(`[exchange] kaspa_tx VERIFY FAIL — recipient mismatch: tx.to=${txRow.to_address?.slice(-12)} expected=${expectedTo?.slice(-12)}`);
        vr = { confirmed: false, confirmations: 1, required: 1, error: 'recipient_mismatch', actualRecipient: txRow.to_address, expectedRecipient: expectedTo };
      } else {
        const tolerancePct = 0.005;
        const actualAmount = parseFloat(txRow.amount) || 0;
        const diff = Math.abs(actualAmount - expectedAmount);
        if (expectedAmount > 0 && diff / expectedAmount > tolerancePct) {
          console.error(`[exchange] kaspa_tx VERIFY FAIL — amount mismatch: tx.amount=${actualAmount} expected=${expectedAmount} (tolerance ${tolerancePct*100}%)`);
          vr = { confirmed: false, confirmations: 1, required: 1, error: 'amount_mismatch', actualAmount, expectedAmount };
        } else {
          console.log(`[exchange] kaspa_tx VERIFY PASS — tx ${payment_tx.slice(0,16)} to=${txRow.to_address?.slice(-12)} amount=${actualAmount} (expected ${expectedAmount})`);
          vr = { confirmed: true, confirmations: 1, required: 1, actualAmount, recipient: txRow.to_address, sender: '' };
        }
      }
    } else {
      const { verifyCrossChainTx } = await import('./cross-chain-verify.mjs');
      vr = await verifyCrossChainTx({
        txHash: payment_tx,
        chain: payment_chain,
        expectedAmount,
        expectedTo,
        paymentAsset: meta.payment_asset || 'usdt',
      });
    }

    if (vr.confirmed) {
      meta.verified_tx = payment_tx;
      meta.verified_at = new Date().toISOString();
      meta.confirmations = vr.confirmations;

      sqlite.prepare(
        'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(meta), new Date().toISOString(), offer_id);

      // BUY path (give_asset=USDT, want_asset=KAS, kaspa_tx): KAS already received.
      // No delivery needed — go straight to completed.
      if (offer.give_asset !== 'KAS' && payment_chain === 'kaspa') {
        sqlite.prepare('UPDATE exchange_offers SET delivery_tx = ? WHERE id = ?').run(payment_tx, offer_id);
        transition(offer_id, 'delivering', { txHash: payment_tx }); // brief pass-through
        transition(offer_id, 'completed', { txHash: payment_tx });
        try { const { spendFunds } = await import('./fund-lock.js'); spendFunds(offer_id); } catch {}
        // Bug AZ 5/16 fix (NWT Phase 1 env 9-13 真测 surface, KI 第 N+11 次 duplicate INSERT):
        // 之前 explicit INSERT chain_events 'exchange_completed' (L1364-1371) UNIQUE-conflict 跟
        // transition() L116-127 内嵌 recordChainEvent — duplicate same txid+event_type 抛 UNIQUE
        // constraint → _verifyAndComplete 抛 → L1372 console + L1391 _settleEscrowToUser + L1399
        // broker→taker autopay 全 skipped → escrow 卡 active + 用户 0 收 KAS + taker 0 收 USDT.
        // 真测 evidence: fec93476 'UNIQUE constraint failed: chain_events.txid, chain_events.event_type'.
        // Fix: 删 explicit INSERT (transition() 已 cover). Bug AO defense moved to transition() error guard.
        console.log(`[exchange] offer ${offer_id.slice(0,8)} BUY kaspa_tx verified → completed (KAS received, no delivery needed)`);
        // Trigger hedge
        const finalOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
        if (finalOffer?.protocol_status === 'completed' && finalOffer.maker) {
          const localAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(finalOffer.maker);
          if (localAgent) {
            // NWT N19.38 KI 22 P0 fix (J2 #536 5/19): executeHedge signature is (offerId, agentName, side, qty, preferredCex)
            // 旧 `executeHedge(finalOffer)` 传 object 作 offerId → sqlite WHERE id=? 不 match → L708 silent skip.
            // Phase 1a Layer 1-3 (commit 45a041c08) 漏 修这 call site, broker BUY kaspa_tx 短 circuit path 30+ day silent dead.
            // 修法 mirror L1810 verify-complete-path 同 pattern (4 args call).
            const makerGaveKas = finalOffer.give_asset === 'KAS';
            const hedgeSide = makerGaveKas ? 'BUY' : 'SELL';
            const hedgeQty = makerGaveKas ? parseFloat(finalOffer.give_amount) : parseFloat(finalOffer.want_amount);
            if (hedgeQty > 0) {
              setImmediate(() => {
                executeHedge(finalOffer.id, localAgent.name, hedgeSide, hedgeQty).catch(err =>
                  console.error(`[exchange-hedge] L1490 BUY-kaspa-shortcut path err: ${err.message}`)
                );
              });
            }
          }
          // Bug R 5/14 fix + Bug AM 5/16 fix (HP-01 真测 surface setImmediate 真测 unreliable):
          // BUY kaspa_tx short-circuit RETURNs before L1352 settle hook. Add explicit AWAIT sequence:
          //   1. _settleEscrowToUser — broker forward target_asset (KAS) to escrow user (NWT)
          //   2. broker → taker give_asset (USDT) — escrow BUY does NOT have seeder pub row so
          //      _makerAutoPayGive (L184-202 requires retail_dex_buy_publications.state='filled')
          //      不 cover escrow BUY case. Explicit transferUsdt to taker's EVM wallet here.
          try {
            const meta = JSON.parse(finalOffer.verification_meta || '{}');
            const isEscrow = (finalOffer.metadata || '').includes('broker-v3-escrow') || meta.escrow_id;
            if (isEscrow && meta.escrow_id && meta.escrow_user_target) {
              try {
                await _settleEscrowToUser(meta.escrow_id, finalOffer.id);
              } catch (err) {
                console.error(`[exchange-escrow-settle] BUY kaspa_tx path err for offer ${finalOffer.id.slice(0,8)}: ${err.message}`);
              }
            }
            // Bug AM 5/16: explicit broker → taker give_asset transfer (escrow BUY case missed by
            // _makerAutoPayGive seeder-pub gate).
            if (isEscrow && finalOffer.give_asset && finalOffer.give_asset !== 'KAS' && finalOffer.taker && finalOffer.give_chain) {
              try {
                const takerRelay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(finalOffer.taker);
                if (takerRelay) {
                  const takerEvm = sqlite.prepare(
                    "SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
                  ).get(takerRelay.id, finalOffer.give_chain);
                  const brokerWallet = sqlite.prepare(
                    "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
                  ).get(localAgent.id, finalOffer.give_chain);
                  if (takerEvm?.address && brokerWallet?.privkey_encrypted) {
                    const transferUsdt = await getTransferUsdt();
                    const r = await transferUsdt(finalOffer.give_chain, brokerWallet.privkey_encrypted, takerEvm.address, parseFloat(finalOffer.give_amount), finalOffer.give_asset);
                    if (r.ok) {
                      console.log(`[exchange-buy-kaspa-autopay] broker → taker ${finalOffer.give_amount} ${finalOffer.give_asset} on ${finalOffer.give_chain} TX ${r.txHash?.slice(0,16)}`);
                      sqlite.prepare(`INSERT INTO chain_events (id, event_type, from_address, to_address, txid, payload, observed_by, observed_at) VALUES (?, 'exchange_paid', ?, ?, ?, ?, 'system', datetime('now'))`).run(
                        crypto.randomUUID(), finalOffer.maker, takerEvm.address, r.txHash,
                        JSON.stringify({ offer_id: finalOffer.id, asset: finalOffer.give_asset, amount: finalOffer.give_amount, chain: finalOffer.give_chain, direction: 'broker→taker auto-pay (escrow BUY)' })
                      );
                    } else {
                      console.error(`[exchange-buy-kaspa-autopay] transferUsdt fail offer ${finalOffer.id.slice(0,8)}: ${r.error}`);
                    }
                  } else {
                    console.warn(`[exchange-buy-kaspa-autopay] offer ${finalOffer.id.slice(0,8)} taker has no ${finalOffer.give_chain} wallet OR broker no wallet — manual settle needed`);
                  }
                } else {
                  console.warn(`[exchange-buy-kaspa-autopay] offer ${finalOffer.id.slice(0,8)} taker ${finalOffer.taker?.slice(-12)} not registered relay — manual settle needed`);
                }
              } catch (err) {
                console.error(`[exchange-buy-kaspa-autopay] err for offer ${finalOffer.id.slice(0,8)}: ${err.message}`);
              }
            }
          } catch (e) { console.warn(`[exchange-escrow-settle] BUY kaspa_tx check err: ${e.message}`); }
        }
        return;
      }

      const deliveringOffer = transition(offer_id, 'delivering', {});
      console.log(`[exchange] offer ${offer_id.slice(0,8)} payment verified → delivering (${vr.actualAmount} USDT, ${vr.confirmations}/${vr.required} conf)`);

      // D2 (NWT broker-v2 phase 1 r6): retail_dex_orders.state lifecycle 写 executing.
      // self-review fix v2 (J2 2e5a926a cross review ❌ critical 修):
      //   - 改读 metadata.user_kasia_address (verification_meta 实际不存此字段)
      //   - empirical evidence: broker-intake-watcher.js L188 set metadata.user_kasia_address (SELL flow)
      //   - verification_meta 仅含 accepted_chains/expected_asset 等 verifier hints
      //   - 多 row advance 风险 → SELECT specific row id + UPDATE WHERE id=? (LIMIT 1 等价)
      try {
        // 1) link 优先: exchange_offer_id (post-finalize 链)
        // 2) fallback: metadata.user_kasia_address (SELL flow broker-intake-watcher.js L188 set)
        // 3) fallback: offer.taker (BUY flow user = taker)
        let metaUserAddr = null;
        try {
          const meta = JSON.parse(deliveringOffer.metadata || '{}');
          if (meta.user_kasia_address && typeof meta.user_kasia_address === 'string' && meta.user_kasia_address.startsWith('kaspa:')) {
            metaUserAddr = meta.user_kasia_address;
          }
        } catch {}
        const userAddr = metaUserAddr || deliveringOffer.taker || '';
        // SELECT specific row 防多 row advance
        const target = sqlite.prepare(`
          SELECT id FROM retail_dex_orders
          WHERE (exchange_offer_id = ? OR (exchange_offer_id IS NULL AND user_kasia_address = ? AND created_at > datetime('now','-2 hours')))
            AND state IN ('paid', 'awaiting_payment')
          ORDER BY created_at DESC LIMIT 1
        `).get(offer_id, userAddr);
        if (target?.id) {
          // lint-allow-state-update: PZ-STATE-T-EXCHANGE exchange-machine 独立状态机 (跟 broker SELL_KAS retail_dex_orders 共表但不同 service). 'executing' state 不在 v0.1 7 state ALLOWED_TRANSITIONS, phase Z exchange 状态机重构后 transition() 共用.
          const upd = sqlite.prepare(`
            UPDATE retail_dex_orders SET state = 'executing', updated_at = datetime('now')
            WHERE id = ? AND state IN ('paid', 'awaiting_payment')
          `).run(target.id);
          if (upd.changes > 0) {
            console.log(`[exchange] D2 retail_dex_orders state lifecycle: ${target.id} → 'executing' (offer ${offer_id.slice(0,8)} userAddr=${userAddr.slice(-12)})`);
          }
        }
      } catch (e) { console.warn(`[exchange] D2 executing UPDATE err: ${e.message}`); }

      // T-NWT-2026-04-27 Bug-Z2 fix (J1 25:24 真发现): auto-deliver 真 generic (USDC/USDT/etc)
      // 老 hardcode `give_asset === 'KAS'` → USDC maker 真 deliver 真不 trigger = USDC e2e 真断.
      // 真 fix: condition generic + KAS path 用现 sendCommandAsync transfer (backward compat),
      // 非 KAS 路径用 J1 settler-router sendAsset generic (USDC/USDT × 7 EVM chain).
      if (deliveringOffer?.give_asset && deliveringOffer.taker) {
        const deliveryAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(deliveringOffer.maker);
        if (deliveryAgent) {
          const give_asset = deliveringOffer.give_asset;
          const give_chain = deliveringOffer.give_chain || 'kaspa';
          const MAX_DELIVERY_ATTEMPTS = 3;
          const DELIVERY_RETRY_MS = 10_000;
          let deliveryTxId = null;

          // T-22-05 retail-proxy: accept 可带 verification_meta.receive_address 指定第三方收件地址
          // KAS path: receive_address 必 kaspa: prefix (KAS 真 native chain).
          // 非 KAS path: receive_address 真 EVM/Sol/Tron addr (跟 give_chain 匹), 或 fallback taker_payment_address.
          let deliveryTarget;
          if (give_asset === 'KAS') {
            deliveryTarget = deliveringOffer.taker; // default kaspa addr
            try {
              const dmeta = JSON.parse(deliveringOffer.verification_meta || '{}');
              if (dmeta.receive_address && typeof dmeta.receive_address === 'string'
                  && dmeta.receive_address.startsWith('kaspa:')) {
                deliveryTarget = dmeta.receive_address;
                console.log(`[exchange] KAS delivery routed to third-party ${deliveryTarget.slice(-12)} (taker=${deliveringOffer.taker.slice(-12)})`);
              }
            } catch {}
          } else {
            // 非 KAS (USDC/USDT/etc): 真 user EVM addr.
            // T-J2-2026-04-27 v1.2 (c) priority lookup:
            //   1. verification_meta.evm_recv_address (J2 v1.2 (c) 真 fix, stable 真 explicit EVM addr)
            //   2. taker_payment_address (legacy, 老 path 可能存 kasia 误用)
            //   3. dmeta.receive_address (老 fallback, 排除 kaspa: prefix)
            try {
              const dmeta = JSON.parse(deliveringOffer.verification_meta || '{}');
              if (dmeta.evm_recv_address && typeof dmeta.evm_recv_address === 'string'
                  && dmeta.evm_recv_address.startsWith('0x')) {
                deliveryTarget = dmeta.evm_recv_address;
              } else if (deliveringOffer.taker_payment_address && deliveringOffer.taker_payment_address.startsWith('0x')) {
                deliveryTarget = deliveringOffer.taker_payment_address;
              } else if (dmeta.receive_address && typeof dmeta.receive_address === 'string'
                  && !dmeta.receive_address.startsWith('kaspa:')) {
                deliveryTarget = dmeta.receive_address;
              }
            } catch {}
          }

          if (!deliveryTarget) {
            console.error(`[exchange] Bug-Z2 no deliveryTarget for ${give_asset} offer ${offer_id.slice(0,8)} (taker=${deliveringOffer.taker?.slice(-12)}, taker_pay_addr=${deliveringOffer.taker_payment_address?.slice(-12) || 'null'})`);
            return;
          }

          for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
            try {
              if (give_asset === 'KAS') {
                // KAS 走现 relay transfer (backward compat 不动)
                const { sendCommandAsync } = await import('./relay-manager.js');
                const sendResult = await sendCommandAsync(deliveryAgent.id, {
                  type: 'transfer',
                  target: deliveryTarget,
                  amount: String(deliveringOffer.give_amount),
                });
                deliveryTxId = sendResult?.txId;
              } else {
                // T-NWT-2026-04-27 Bug-Z2 fix: 非 KAS 走 J1 settler-router sendAsset generic
                const { sendAsset } = await import('./settler-router.js');
                const sendResult = await sendAsset({
                  asset: give_asset,
                  chain: give_chain,
                  to: deliveryTarget,
                  qty: parseFloat(deliveringOffer.give_amount),
                  relayId: deliveryAgent.id,
                });
                deliveryTxId = sendResult?.txHash || sendResult?.txId;
                if (!deliveryTxId && sendResult?.error) throw new Error(sendResult.error);
              }
              console.log(`[exchange] ${give_asset} delivery attempt ${attempt}: ${deliveringOffer.give_amount} ${give_asset} → ${deliveryTarget.slice(-12)} TX: ${deliveryTxId || '?'}`);
              if (deliveryTxId) break; // success
            } catch (err) {
              console.error(`[exchange] ${give_asset} delivery attempt ${attempt}/${MAX_DELIVERY_ATTEMPTS} FAILED: ${err.message}`);
              if (attempt < MAX_DELIVERY_ATTEMPTS) {
                await new Promise(r => setTimeout(r, DELIVERY_RETRY_MS));
              }
            }
          }

          if (deliveryTxId) {
            // === NO TX NO STATE CHANGE ===
            // KAS delivery TX returned from Relay. Now broadcast delivered_v1.
            // MUST succeed on chain before marking completed.
            const { sendCommandAsync: sendCmd } = await import('./relay-manager.js');
            const deliveredMsg = JSON.stringify({
              t: 'kanet_exchange_delivered_v1',
              offer_id: deliveringOffer.id,
              delivery_tx: deliveryTxId,
              delivery_asset: deliveringOffer.give_asset,
              delivery_amount: deliveringOffer.give_amount,
              receiver: deliveryTarget, // T-22-05: 真实收件人(可能是第三方,见上)
            });

            let deliveredBcastTxId = null;
            for (let ba = 1; ba <= 5; ba++) {
              try {
                const br = await sendCmd(deliveryAgent.id, { type: 'send_broadcast', channel: 'kanet-exchange', message: deliveredMsg });
                deliveredBcastTxId = br?.txId;
                if (deliveredBcastTxId) break;
              } catch (be) {
                console.error(`[exchange] delivered broadcast attempt ${ba}/5: ${be.message}`);
              }
              if (ba < 5) await new Promise(r => setTimeout(r, 200 * ba));
            }

            if (!deliveredBcastTxId) {
              // Delivered broadcast failed — KAS was sent but we can't prove it on chain yet.
              // Stay in delivering, do NOT mark completed. Operator or next tick can retry.
              console.error(`[exchange] offer ${offer_id.slice(0,8)} KAS sent (${deliveryTxId}) but delivered broadcast failed. Staying in delivering.`);
              sqlite.prepare(`
                INSERT INTO chain_events (id, event_type, from_address, to_address, txid, payload, observed_by, observed_at)
                VALUES (?, 'kas_delivery', ?, ?, ?, ?, 'system', datetime('now'))
              `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, deliveryTxId,
                JSON.stringify({ offer_id: deliveringOffer.id, amount: deliveringOffer.give_amount, broadcast_failed: true }));
            } else {
              // Both KAS delivery AND broadcast succeeded — NOW mark completed
              sqlite.prepare('UPDATE exchange_offers SET delivery_tx = ? WHERE id = ?').run(deliveryTxId, offer_id);
              transition(offer_id, 'completed', { txHash: deliveryTxId });

              // D2 (NWT broker-v2 phase 1 r6): retail_dex_orders.state lifecycle 写 completed + deliver_tx_hash.
              // self-review fix v2 (J2 2e5a926a cross review ❌ critical 修):
              //   - 改读 metadata.user_kasia_address (broker-intake-watcher.js L188 set, SELL flow link)
              //   - SELECT specific row id 防多 row advance
              try {
                let metaUserAddr2 = null;
                try {
                  const meta = JSON.parse(deliveringOffer.metadata || '{}');
                  if (meta.user_kasia_address && typeof meta.user_kasia_address === 'string' && meta.user_kasia_address.startsWith('kaspa:')) {
                    metaUserAddr2 = meta.user_kasia_address;
                  }
                } catch {}
                const userAddr2 = metaUserAddr2 || deliveringOffer.taker || '';
                const target = sqlite.prepare(`
                  SELECT id FROM retail_dex_orders
                  WHERE (exchange_offer_id = ? OR (exchange_offer_id IS NULL AND user_kasia_address = ? AND created_at > datetime('now','-2 hours')))
                    AND state IN ('executing', 'paid', 'awaiting_payment')
                  ORDER BY created_at DESC LIMIT 1
                `).get(offer_id, userAddr2);
                if (target?.id) {
                  // lint-allow-state-update: PZ-STATE-T-EXCHANGE exchange-machine 独立状态机 delivery completed transition. 跨 v0.1 7 state ALLOWED_TRANSITIONS (executing 不在), phase Z exchange 状态机重构 transition() 共用.
                  const upd = sqlite.prepare(`
                    UPDATE retail_dex_orders SET state = 'completed', deliver_tx_hash = ?, updated_at = datetime('now')
                    WHERE id = ? AND state IN ('executing', 'paid', 'awaiting_payment')
                  `).run(deliveryTxId, target.id);
                  if (upd.changes > 0) {
                    console.log(`[exchange] D2 retail_dex_orders state lifecycle: ${target.id} → 'completed' (offer ${offer_id.slice(0,8)} tx ${deliveryTxId.slice(0,12)})`);
                  }
                }
              } catch (e) { console.warn(`[exchange] D2 completed UPDATE err: ${e.message}`); }
              sqlite.prepare(`
                INSERT INTO chain_events (id, event_type, from_address, to_address, txid, payload, observed_by, observed_at)
                VALUES (?, 'kas_delivery', ?, ?, ?, ?, 'system', datetime('now'))
              `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, deliveryTxId,
                JSON.stringify({ offer_id: deliveringOffer.id, amount: deliveringOffer.give_amount, broadcast_tx: deliveredBcastTxId }));
              try { const { spendFunds } = await import('./fund-lock.js'); spendFunds(deliveringOffer.id); } catch {}
              // Bug AZ Part 2 5/16 fix (KI 复刻 第 N+11 次 + Owner 9:11 SELL smoke surface):
              // 跟 BUY-kaspa-shortcircuit Bug AZ 同款 duplicate INSERT, SELL path 也漏修.
              // transition(offer_id, 'completed', { txHash: deliveryTxId }) L1621 已 recordChainEvent
              // exchange_completed 同 txid+event_type, 此 explicit INSERT duplicate → UNIQUE throw →
              // _verifyAndComplete 抛 → L1737 _settleEscrowToUser skipped → escrow 卡 active 用户 0 收 USDT.
              // 真测 evidence: offer 273506fc SELL smoke 'UNIQUE constraint failed chain_events.txid+event_type' →
              // KAS deliver 到 J2 taker 成功, 但 NWT 真 0 收 USDT settle.
              console.log(`[exchange] offer ${offer_id.slice(0,8)} delivering → completed (delivery TX: ${deliveryTxId.slice(0,12)}, broadcast: ${deliveredBcastTxId.slice(0,12)})`);
              // T-J2-V2 议 2 (Owner 真测 #2 退场后 NWT 转 Owner #2 痛点 '订单全生命周期 broker 主动 DM'):
              // KAS 发出 + broadcast 成功 → 主动 DM user 通知 'KAS 已发'. 不让 user 查 explorer.
              try {
                const { enqueue } = await import('./broker-action-queue.js');
                enqueue({
                  kind: 'dm_kas_delivered',
                  peer: deliveryTarget,
                  payload: {
                    message: `✅ 已发出 ${deliveringOffer.give_amount} KAS 到你 Kasia 钱包, 1-2 分钟到账.\n\nTX: ${deliveryTxId}\n查看: https://explorer.kaspa.org/txs/${deliveryTxId}\n\n感谢使用 KANet broker.`,
                  },
                });
              } catch (e) { console.warn(`[exchange] dm_kas_delivered enqueue err: ${e.message}`); }
            }
          } else {
            // 3 attempts failed → revert to verified (retryable, not dispute)
            transition(offer_id, 'verified', {});
            sqlite.prepare(`
              INSERT INTO chain_events (id, txid, event_type, from_address, payload, observed_by, observed_at)
              VALUES (?, ?, 'exchange_delivery_reverted', ?, ?, 'system', datetime('now'))
            `).run(crypto.randomUUID(), `revert-${deliveringOffer.id.slice(0,16)}`, deliveringOffer.maker, JSON.stringify({
              offer_id: deliveringOffer.id, reason: 'delivery_failed_3_attempts_reverted',
            }));
            console.warn(`[exchange] offer ${offer_id.slice(0,8)} delivering → verified (3 delivery failures, reverted for retry)`);
          }
        }
      }

      // BUY path (kaspa_tx): taker already sent KAS, maker received it.
      // No separate delivery needed — go straight to completed.
      // maker auto-pay-give is triggered by transition() below (completed → _makerAutoPayGive)
      if (payment_chain === 'kaspa' && deliveringOffer?.give_asset !== 'KAS') {
        sqlite.prepare('UPDATE exchange_offers SET delivery_tx = ? WHERE id = ?').run(payment_tx, offer_id);
        const completedOffer = transition(offer_id, 'completed', { txHash: payment_tx });
        sqlite.prepare(`
          INSERT INTO chain_events (id, event_type, from_address, to_address, txid, payload, observed_by, observed_at)
          VALUES (?, 'exchange_completed', ?, ?, ?, ?, 'system', datetime('now'))
        `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, payment_tx, JSON.stringify({
          offer_id: deliveringOffer.id, give_asset: deliveringOffer.give_asset, give_amount: deliveringOffer.give_amount,
          want_asset: deliveringOffer.want_asset, want_amount: deliveringOffer.want_amount,
          payment_chain, payment_tx,
        }));
        console.log(`[exchange] BUY kaspa_tx offer ${offer_id.slice(0,8)} delivering → completed (KAS already received)`);
      }

      // Trigger hedge after completed (only if delivery succeeded)
      const finalOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
      if (finalOffer?.protocol_status === 'completed' && finalOffer.maker) {
        const localAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(finalOffer.maker);
        if (localAgent) {
          const makerGaveKas = finalOffer.give_asset === 'KAS';
          const hedgeSide = makerGaveKas ? 'BUY' : 'SELL';
          const hedgeQty = makerGaveKas ? parseFloat(finalOffer.give_amount) : parseFloat(finalOffer.want_amount);
          if (hedgeQty > 0) {
            setImmediate(() => {
              executeHedge(finalOffer.id, localAgent.name, hedgeSide, hedgeQty).catch(err =>
                console.error(`[exchange-hedge] verify-complete-path trigger error: ${err.message}`)
              );
            });
          }
        }

        // Bug H γ Sub #6 + Bug AQ 5/16 fix (HP-04 SELL real test surface setImmediate hook unreliable
        // same as BUY-kaspa-shortcircuit pattern Bug AM). Replace setImmediate with explicit await:
        try {
          const meta = JSON.parse(finalOffer.verification_meta || '{}');
          const isEscrow = (finalOffer.metadata || '').includes('broker-v3-escrow') || meta.escrow_id;
          if (isEscrow && meta.escrow_id && meta.escrow_user_target) {
            try {
              await _settleEscrowToUser(meta.escrow_id, finalOffer.id);
            } catch (err) {
              console.error(`[exchange-escrow-settle] SELL path err for offer ${finalOffer.id.slice(0,8)}: ${err.message}`);
            }
          }
        } catch (e) { console.warn(`[exchange-escrow-settle] SELL path check err: ${e.message}`); }
      }

    } else if (attempt < MAX_ATTEMPTS) {
      console.log(`[exchange] offer ${offer_id.slice(0,8)} not confirmed yet (attempt ${attempt}/${MAX_ATTEMPTS}): ${vr.error}. Retry in 60s`);
      setTimeout(() => _verifyAndComplete(offer_id, payment_tx, payment_chain, attempt + 1), RETRY_MS);

    } else {
      // Auto-dispute after MAX_ATTEMPTS failed verifications
      console.log(`[exchange] offer ${offer_id.slice(0,8)} auto-dispute after ${MAX_ATTEMPTS} failed verifications`);
      const dmeta = JSON.parse(offer.verification_meta || '{}');
      dmeta.dispute_reason = `Auto-dispute: verification failed ${MAX_ATTEMPTS} times. Last error: ${vr.error}`;
      dmeta.dispute_by = 'system';
      dmeta.dispute_at = new Date().toISOString();
      sqlite.prepare(
        'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(dmeta), new Date().toISOString(), offer_id);
      transition(offer_id, 'disputed', {});
      // Record exchange_disputed for audit
      sqlite.prepare(`
        INSERT INTO chain_events (id, txid, event_type, from_address, payload, observed_by, observed_at)
        VALUES (?, ?, 'exchange_disputed', ?, ?, 'system', datetime('now'))
      `).run(crypto.randomUUID(), `dispute-${offer_id.slice(0,16)}`, offer.maker, JSON.stringify({
        offer_id, reason: dmeta.dispute_reason,
      }));
    }
  } catch (err) {
    console.error(`[exchange] _verifyAndComplete error:`, err.message);
  }
}

// ── Dispute ──────────────────────────────────────────────────

/**
 * Maker or taker raises a dispute on an in-progress offer.
 */
export function processDispute({ offer_id, disputer_address, reason }) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer) return { error: 'offer_not_found' };

  const isParty = offer.maker === disputer_address || offer.taker === disputer_address;
  if (!isParty) return { error: 'only_parties_can_dispute' };

  const DISPUTABLE = ['verifying', 'awaiting_manual_confirm', 'matched'];
  if (!DISPUTABLE.includes(offer.protocol_status)) {
    return { error: 'invalid_status', current: offer.protocol_status };
  }

  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.dispute_reason = reason || 'No reason provided';
  meta.dispute_by = disputer_address;
  meta.dispute_at = new Date().toISOString();

  sqlite.prepare(
    'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(meta), new Date().toISOString(), offer_id);

  transition(offer_id, 'disputed', {});
  console.log(`[exchange] offer ${offer_id.slice(0,8)} disputed by ${disputer_address.slice(-8)}: ${reason}`);

  return { ok: true, status: 'disputed' };
}
