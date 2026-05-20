/**
 * Trade Protocol Filter
 *
 * Bridge between on-chain protocol broadcasts and existing trade services.
 * Mounted at broadcast_messages INSERT points in chat.js.
 *
 * Chain is source of truth. This filter turns chain events into local index operations.
 * All business logic uses existing services — this file only routes.
 */

import { sqlite } from '../db/client.js';
import { releaseFunds } from './fund-lock.js';
import { quickStart } from './execution-state.js';
import { recordChainEvent } from './chain-event.js';
import { checkLimits } from './trade-limits.js';
import { placeOrder } from './exchange-orders.js';
import { decrypt } from './crypto.js';
// exchange-machine imports merged below at line ~352

/**
 * Called after every broadcast_messages INSERT.
 * Fast-rejects non-protocol messages via string prefix check.
 *
 * @param {object} row - { tx_hash, content, sender_address, channel_name, created_at }
 */
// J2 #520 / NWT N19.12 三方共识 5/19: wrap _executeHedge with hedge_failed emit guard.
// 防 KI 第 17 次 silent skip — 任何 throw (SQL bug / decrypt fail / API error) 必 emit chain_event,
// 而不是被 caller .catch(err => console.error) 静默吞掉. invariant: hedge attempt → chain_event emit.
async function _executeHedgeGuarded(offerId, agentName, side, qty, preferredCex = null) {
  try {
    return await _executeHedge(offerId, agentName, side, qty, preferredCex);
  } catch (err) {
    console.error(`[exchange-hedge] FAILED hedge for offer ${(offerId||'').slice(0,8)} side=${side} qty=${qty}: ${err.message}`);
    try {
      const { recordChainEvent } = await import('./chain-event.js');
      recordChainEvent({
        txid: `hedge_failed_${offerId}_${Date.now()}`,
        eventType: 'hedge_failed',
        fromAddress: null, toAddress: null, observedBy: 'system',
        payload: { offerId, agentName, side, qty, preferredCex, error: err.message?.slice(0, 200) },
      });
    } catch (emitErr) {
      console.error(`[exchange-hedge] hedge_failed emit err: ${emitErr.message}`);
    }
    throw err;
  }
}
export { _executeHedgeGuarded as executeHedge };
export { _autoPayExchange as triggerAutoPay, _autoSettleAsset, _autoSettleAsset as _autoSendKas };

export async function onBroadcastWritten(row) {
  if (!row.content || !row.content.startsWith('{"t":"kanet_')) return;

  let msg;
  try {
    msg = JSON.parse(row.content);
  } catch {
    return; // malformed JSON, skip
  }

  // Attach chain metadata
  msg._tx = row.tx_hash;
  msg._from = row.sender_address;
  msg._channel = row.channel_name;
  msg._at = row.created_at;

  try {
    switch (msg.t) {
      // NWT N14.5 Phase β Step 2 sub#3b (5/18): OTC 7 case (kanet_sell_v1/buy_v1/accept_v1/paid_v1/delivered_v1/cancel_v1/timeout_v1)
      // 全删. handler 全删. order-machine.js OTC heart 全删. chain_event protocol_deprecated_use audit 5h 0 production caller.
      case 'kanet_exchange_v1':
        await handleExchange(msg); break;
      case 'kanet_exchange_accept_v1':
        await handleExchangeAccept(msg); break;
      case 'kanet_exchange_cancel_v1':
        await handleExchangeCancel(msg); break;
      case 'kanet_confirm_v1':
        await handleManualConfirm(msg); break;
      case EXCHANGE_MSG.PAID:
        await handleExchangePaid(msg); break;
      case EXCHANGE_MSG.DELIVERED:
        await handleExchangeDelivered(msg); break;
      case EXCHANGE_MSG.TIMEOUT:
        await handleExchangeTimeout(msg); break;
      case EXCHANGE_MSG.DISPUTE:
        await handleExchangeDispute(msg); break;
      case EXCHANGE_MSG.RESOLVE:
        await handleExchangeResolve(msg); break;
    }
  } catch (err) {
    console.error(`[trade-filter] Error processing ${msg.t}: ${err.message}`);
  }
}

// ── Handlers ──────────────────────────────────────────────────

// NWT N14.5 Phase β Step 2 sub#3b (5/18 Owner 钦定 "OTC 融入 Exchange 不要停"):
// 6 OTC handler (handleOrder / handleAccept / handlePaid / handleDelivered / handleCancel / handleTimeout)
// + _alertOtcDeprecated audit helper 全删. chain_event protocol_deprecated_use 5h+ 0 production caller.
// order-machine.js OTC heart 一并删 (sub#3b same commit). exchange handlers (handleExchange/Accept/Cancel/
// ManualConfirm/Paid/Delivered/Timeout/Dispute/Resolve) 留 (单 source of truth).

// ── Exchange Protocol (v1.1 自由市场) ────────────────────────
// NWT N14.7 P0 hotfix 5/18: sub#3b 删 handler 时误删了下面 exchange-machine imports + EXCHANGE_MSG const
// (delete script boundary 误把这块吞了, P0 因 processPaymentSubmit + EXCHANGE_MSG undefined → exchange path
// verifier 跑不动 stuck). 还原到原位.

import { randomUUID } from 'crypto';
import { processAccept as machineAccept, processManualConfirm, processCancel as machineCancel, processPaymentSubmit, transition as exchangeTransition } from './exchange-machine.js';

// NWT N19.3 P0 hotfix 5/18: _deriveMarketKey 被 sub#3b deca1e74 delete script 边界吞 (类 N14.7 imports 吞 KI).
// N14.7 hotfix 72027b2d 还原 imports + EXCHANGE_MSG const 但漏 _deriveMarketKey, 5+ hr chain-broadcast offer
// silently fail (handleExchange L122 ReferenceError, exchange_offers 不 indexed, broker-internal publish
// 不走这 path 才没暴). 71 expired offer 部分根因 = 外部 chain maker broadcast 失败 not indexed.
function _deriveMarketKey(giveAsset, wantAsset) {
  return [giveAsset, wantAsset].sort().join('|');
}

// Exchange protocol v2 message type constants
const EXCHANGE_MSG = {
  PUBLISH:   'kanet_exchange_v1',
  ACCEPT:    'kanet_exchange_accept_v1',
  CANCEL:    'kanet_exchange_cancel_v1',
  CONFIRM:   'kanet_confirm_v1',
  PAID:      'kanet_exchange_paid_v1',
  DELIVERED: 'kanet_exchange_delivered_v1',
  TIMEOUT:   'kanet_exchange_timeout_v1',
  DISPUTE:   'kanet_exchange_dispute_v1',
  RESOLVE:   'kanet_exchange_resolve_v1',
};

/**
 * kanet_exchange_v1 — new offer broadcast
 *
 * msg: { t, id?, give_asset, give_amount, give_chain?,
 *         want_asset, want_amount, want_chain?,
 *         expires_at?, verification?, verification_meta?,
 *         _tx, _from, _channel, _at }
 */
async function handleExchange(msg) {
  if (!msg.give_asset || !msg.want_asset) return;

  let offerId = msg.id || randomUUID();
  const msgIndex = msg.message_index || 0;

  // NWT N19.30 P0 fix (KI 第 21 次 silent skip 复刻):
  // J2 #528 (commit f31d8eaf6) 在 /api/exchange/publish INSERT 后 dispatch onBroadcastWritten → handleExchange.
  // 旧逻辑: existing 时 silent return → autoTaker 永不 fire on direct-API-publish path.
  // 修法: existing 时**不** skip — 复用现 offer.id, 跳 INSERT, 继续 autoTaker dispatch (chain scanner path 也不破).
  const existing = sqlite.prepare(
    'SELECT id FROM exchange_offers WHERE broadcast_tx_id = ? AND message_index = ?'
  ).get(msg._tx, msgIndex);
  if (existing) {
    offerId = existing.id;
    // 跳 INSERT (idempotent), 但继 autoTaker dispatch (下方 setImmediate). external chain scanner 与
    // direct API publish 双 path 都 hit autoTaker, 守 trap #53 own_offer skip + KANET_TEST_MODE bypass.
  } else {
    const marketKey = _deriveMarketKey(msg.give_asset, msg.want_asset);
    const now = msg._at || new Date().toISOString();

    sqlite.prepare(`
      INSERT INTO exchange_offers (
        id, broadcast_tx_id, message_index,
        give_asset, give_amount, give_chain,
        want_asset, want_amount, want_chain,
        maker, broadcast_at, expires_at,
        verification, verification_meta,
        protocol_status, is_fully_observed, market_key,
        observed_by_node,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, ?, ?)
    `).run(
      offerId, msg._tx, msgIndex,
      msg.give_asset, String(msg.give_amount || '0'), msg.give_chain || null,
      msg.want_asset, String(msg.want_amount || '0'), msg.want_chain || null,
      msg._from, now, msg.expires_at || null,
      msg.verification || 'manual', JSON.stringify(msg.verification_meta || {}),
      marketKey, null,
      now, now
    );

    console.log(`[exchange] Offer indexed: ${offerId.slice(0, 8)} ${msg.give_amount} ${msg.give_asset} → ${msg.want_amount} ${msg.want_asset} by ${msg._from.slice(-12)}`);
  }

  // 2026-04-14 Q5 audit fix: replay orphan accepts that arrived before publish
  // (Kaspa DAG 内 block TX order 不保证, accept 可能早于 publish 到达 ingest)
  const pending = sqlite.prepare(
    'SELECT id, msg_json FROM pending_exchange_accepts WHERE offer_id = ? ORDER BY received_at ASC'
  ).all(offerId);
  for (const p of pending) {
    try {
      const pmsg = JSON.parse(p.msg_json);
      sqlite.prepare('DELETE FROM pending_exchange_accepts WHERE id = ?').run(p.id);
      console.log(`[exchange] replay orphan accept for offer ${offerId.slice(0,8)} from ${(pmsg._from || '').slice(-8)}`);
      await handleExchangeAccept(pmsg);
    } catch (e) {
      console.error(`[exchange] orphan accept replay failed: ${e.message}`);
    }
  }

  // AutoTaker: evaluate incoming offer for automatic acceptance
  setImmediate(() => _evaluateAutoTake(offerId, msg).catch(e =>
    console.error(`[autoTaker] evaluate error: ${e.message}`)
  ));
}

// ── AutoTaker — auto-accept profitable incoming offers ──────────────────

let _lastAutoTakeAt = 0;
let _autoTakeLock = false;

/**
 * Evaluate an incoming offer for automatic acceptance.
 * 双向 KAS↔USDT (J2 #523 / NWT N19.17/N19.18 三方共识 5/19):
 * - SELL direction (maker give KAS, want USDT): broker BUY KAS at offer (broker pays USDT, gets KAS)
 * - BUY direction (maker give USDT, want KAS): broker SELL KAS at offer (broker pays KAS, gets USDT)
 * 前 30+ 天 hardcoded 单向 (L211-212), qqjdp=kzc2tgz4cchh 40d/770 broadcast 全 silent return.
 * Default mode is 'approval' — creates a proposal in execution_states for Owner to confirm.
 */
async function _evaluateAutoTake(offerId, msg) {
  // NWT N8.1 5/18: autoTaker observability — 12 silent return 各 log gate + context.
  // J2 #523 / NWT N19.18 P0c: autotake_skip chain_event emit (合 Path A commit, surface KI 18 silent skip).
  const _p = async (gate) => {
    console.log(`[autoTaker.probe] offer=${offerId.slice(0,12)} from=${msg._from?.slice(-12)} EXIT gate=${gate}`);
    try {
      const { recordChainEvent } = await import('./chain-event.js');
      recordChainEvent({
        txid: `autotake_skip_${offerId}_${gate.split(/[\s=<>]/)[0]}`,  // gate prefix avoid collision
        eventType: 'autotake_skip',
        payload: JSON.stringify({ offer_id: offerId, reason: gate, peer: msg._from, give: `${msg.give_amount}${msg.give_asset}`, want: `${msg.want_amount}${msg.want_asset}` }),
      });
    } catch (err) { /* don't break probe on emit fail */ }
  };
  console.log(`[autoTaker.entry] offer=${offerId.slice(0,12)} from=${msg._from?.slice(-12)} verification=${msg.verification} give=${msg.give_amount}${msg.give_asset}→${msg.want_amount}${msg.want_asset}`);
  if (_autoTakeLock) { await _p('lock'); return; }

  // 1. Check enabled
  const { getConfig } = await import('../data/settings/configs.js');
  const enabled = await getConfig('autotake_enabled');
  if (enabled !== 'true') { await _p(`enabled=${enabled}`); return; }

  // 2. Skip own offers (trap #53)
  // NWT N19.25 / Owner 钦定 5/19 "干!!!": KANET_TEST_MODE=1 bypass for multi-actor real-chain test.
  // Production 默认 (无 var) 保持 skip own_offer 不变 (trap #53 防 self-deal).
  const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
  if (process.env.KANET_TEST_MODE !== '1' && localAddrs.includes(msg._from)) { await _p('own_offer'); return; }

  // 3. Only auto-verifiable offers
  if (msg.verification === 'manual') { await _p('verification_manual'); return; }

  // 4. Skip expired
  if (msg.expires_at && new Date(msg.expires_at) < new Date()) { await _p('expired'); return; }

  // 5. Direction: 双向 KAS↔USDT (J2 #523 / NWT N19.17 三方共识 5/19)
  // 真凶 (NWT N19.17 audit): hardcoded 单向 SELL → qqjdp=kzc2tgz4cchh 40d/770 broadcast BUY 全 silent return.
  const giveU = msg.give_asset?.toUpperCase();
  const wantU = msg.want_asset?.toUpperCase();
  const isSellKas = giveU === 'KAS' && wantU === 'USDT';  // broker BUY KAS at offer (broker pay USDT)
  const isBuyKas = giveU === 'USDT' && wantU === 'KAS';   // broker SELL KAS at offer (broker pay KAS)
  if (!isSellKas && !isBuyKas) { await _p(`direction give=${msg.give_asset} want=${msg.want_asset}`); return; }
  const direction = isSellKas ? 'SELL' : 'BUY';

  // 5b. Check accepted_chains includes a chain we can pay on (NWT N19.18 真 attack: direction-aware).
  // SELL direction: broker pays USDT → needs USDT chain wallet (bnb default + eth/sol/tron)
  // BUY direction: broker pays KAS → needs kaspa relay (broker pool 通过 relay send)
  const meta = msg.verification_meta || {};
  const acceptedChains = meta.accepted_chains || [];
  const supported = isSellKas ? ['bnb', 'eth', 'sol', 'tron'] : ['kaspa'];
  const match = acceptedChains.find(c => c && supported.includes(String(c.chain || c).toLowerCase()));
  const defaultChain = isSellKas ? 'bnb' : 'kaspa';
  const payChain = (match && (match.chain || match)) || (acceptedChains.length === 0 ? defaultChain : null);
  if (!payChain) { await _p(`payChain_null acceptedChains=${JSON.stringify(acceptedChains).slice(0,80)} dir=${direction}`); return; }

  // 6. Price evaluation
  // Bug NWT-13:30 A1 fix (Owner production autoTaker 真测 silent disabled):
  // getCachedKasPrice 单 source 返 0 当 cache cold/idle/TTL 超 → autoTaker silent dead.
  // broker quote 用 exchange-client.getKasPrice() (live oracle), autoTaker 应同源.
  // 修法: try cache first (fast path), fallback live oracle (cold cache 也能 evaluate).
  const { getCachedKasPrice } = await import('./market-data.js');
  let marketPrice = getCachedKasPrice();
  if (!marketPrice) {
    try {
      const { getKasPrice } = await import('./broker-v3/exchange-client.js');
      marketPrice = await getKasPrice();
    } catch (err) { console.warn(`[autoTaker] getKasPrice fallback err: ${err.message}`); }
  }
  if (!marketPrice) { await _p('marketPrice_null'); return; }

  const giveAmt = parseFloat(msg.give_amount);
  const wantAmt = parseFloat(msg.want_amount);
  if (!giveAmt || !wantAmt) { await _p(`amounts give=${giveAmt} want=${wantAmt}`); return; }

  // offerPrice 双向 normalize 到 USDT/KAS (NWT N19.18 Q1 attack downstream #2):
  // SELL: maker give=KAS want=USDT → price = wantAmt/giveAmt (USDT/KAS) ✓ 正向
  // BUY:  maker give=USDT want=KAS → price = giveAmt/wantAmt (USDT/KAS) 反向公式
  const offerPrice = isSellKas ? (wantAmt / giveAmt) : (giveAmt / wantAmt);
  // discount 双向 sign flip (NWT N19.18 Q1 attack downstream #3):
  // SELL: broker BUY KAS @ offer, profit if offer < market → discount = (market - offer) / market
  // BUY:  broker SELL KAS @ offer, profit if offer > market → discount = (offer - market) / market
  const discount = isSellKas ? ((marketPrice - offerPrice) / marketPrice) : ((offerPrice - marketPrice) / marketPrice);
  const minDiscount = parseFloat(await getConfig('autotake_min_discount_pct') || '0.5') / 100;
  if (discount < minDiscount) { await _p(`discount ${(discount*100).toFixed(2)}%<${(minDiscount*100).toFixed(2)}% market=${marketPrice} offerPrice=${offerPrice.toFixed(6)} dir=${direction}`); return; }

  // 7. Amount cap — normalize 双向到 USD value
  // SELL: wantAmt 是 USDT (broker pay) → direct USD
  // BUY:  wantAmt 是 KAS (broker pay) → USD = wantAmt × marketPrice
  const wantUsd = isSellKas ? wantAmt : wantAmt * marketPrice;
  const maxUsdt = parseFloat(await getConfig('autotake_max_amount_usdt') || '50');
  if (wantUsd > maxUsdt) { await _p(`maxUsdt wantUsd=${wantUsd.toFixed(2)}>${maxUsdt} dir=${direction}`); return; }

  // 8. Daily limit
  const today = new Date().toISOString().slice(0, 10);
  const dailyCount = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM chain_events WHERE event_type = 'autotake_accepted' AND observed_at >= ?"
  ).get(today + 'T00:00:00Z')?.cnt || 0;
  const dailyLimit = parseInt(await getConfig('autotake_daily_limit') || '3');
  if (dailyCount >= dailyLimit) { await _p(`dailyLimit ${dailyCount}>=${dailyLimit}`); return; }

  // 9. Cooldown (configurable, default 30s, UTXO conflict prevention)
  const cooldownMs = (parseInt(await getConfig('autotake_cooldown_sec') || '30')) * 1000;
  if (_lastAutoTakeAt && Date.now() - _lastAutoTakeAt < cooldownMs) { await _p(`cooldown ${Date.now()-_lastAutoTakeAt}ms<${cooldownMs}ms dir=${direction}`); return; }

  // 10. Find best local agent (NWT N19.18 Q1 attack downstream #4 — direction-aware wallet search):
  // SELL: broker pays USDT → needs EVM wallet matching payChain (bnb/eth/sol/tron)
  // BUY:  broker pays KAS → uses relay directly (Kaspa pool, no agent_wallets EVM row needed)
  let bestRelay = null;
  for (const addr of localAddrs) {
    const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(addr);
    if (!relay) continue;
    if (isSellKas) {
      const wallet = sqlite.prepare(
        "SELECT * FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1"
      ).get(relay.id, payChain);
      if (!wallet) continue;
      bestRelay = relay.id;
      break;
    } else {
      // BUY: broker pays KAS via Kaspa relay; no EVM wallet needed. First relay with valid id wins.
      bestRelay = relay.id;
      break;
    }
  }
  if (!bestRelay) { await _p(`bestRelay_null localAddrs.length=${localAddrs.length} dir=${direction}`); return; }

  console.log(`[autoTaker] opportunity: ${giveAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market ${marketPrice})`);

  // 10b. ── Tier-based amount cap (P1 v4, NWT N19.2 Owner 钦定 5/18 自主运营) ──
  // 真因: pre-v4 reputation gate 0-completed → high risk → fail-closed → autoTaker 0 production fire
  // (kzc2tgz4cchh 40d/770 broadcast/0 accept). v4: amount-tier + per-peer 24h sybil cap 替 reputation 硬 block.
  // worst case 100 sybil × $50 = $5k/day exposure, broker treasury (P2) 防.
  // tier 顺序在 rep check 前 (rep 仅 advisory + dispute-block).
  try {
    const TIER_CAPS = {
      1: { amount: 10, perPeerCount: 3, perPeerTotal: 5 },
      2: { amount: 25, perPeerCount: 5, perPeerTotal: 50 },
      3: { amount: 75, perPeerCount: 20, perPeerTotal: 500 },
    };

    // 1. peer 数据: age, has_card, completed_count
    // NWT N19.5 P0 hotfix: identities column is `card_timestamp`, NOT `card_observed_at` (J2 typo from earlier
    // grep misread "undefined" return = missing col, not null val). T0 grep cousin lesson.
    const peerRow = sqlite.prepare(
      'SELECT discovered_at, card_timestamp FROM identities WHERE address = ?'
    ).get(msg._from);
    const completedCount = sqlite.prepare(
      "SELECT COUNT(*) AS cnt FROM exchange_offers WHERE taker = ? AND protocol_status = 'completed'"
    ).get(msg._from)?.cnt || 0;
    const ageMs = peerRow?.discovered_at
      ? Date.now() - new Date(peerRow.discovered_at).getTime()
      : 0;
    const ageDays = ageMs / 86400000;
    const hasCard = !!peerRow?.card_timestamp;

    // 2. tier determination (v3 OR-condition, NWT N19.2 ack)
    let tier;
    if (ageDays >= 30 && completedCount >= 3) tier = 3;
    else if (ageDays >= 7 || hasCard || completedCount >= 1) tier = 2;
    else tier = 1;
    const caps = TIER_CAPS[tier];

    // 3. amount cap check (双向 normalize USD — wantUsd 算上面 L#)
    if (wantUsd > caps.amount) {
      console.log(`[autoTaker] TIER ${tier} AMOUNT CAP: wantUsd $${wantUsd.toFixed(2)} > $${caps.amount} (peer age=${ageDays.toFixed(1)}d card=${hasCard} completed=${completedCount} dir=${direction}) — skipping`);
      try {
        const { recordChainEvent } = await import('./chain-event.js');
        recordChainEvent({
          txid: `autotake_tier_cap_${offerId}`,
          eventType: 'autotake_tier_cap',
          payload: JSON.stringify({ offer_id: offerId, peer: msg._from, tier, wantUsd, cap: caps.amount, direction, ageDays: ageDays.toFixed(1), hasCard, completedCount }),
        });
      } catch (err) { console.warn(`[autoTaker] tier_cap audit err: ${err.message}`); }
      return;
    }

    // 4. per-peer 24h cumulative cap (anti-sybil)
    const dayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
    const peerTakes = sqlite.prepare(
      "SELECT payload FROM chain_events WHERE event_type = 'autotake_accepted' AND to_address = ? AND observed_at >= ?"
    ).all(msg._from, dayStart);
    let peerDayTotal = 0;
    for (const r of peerTakes) {
      try {
        const p = JSON.parse(r.payload);
        const m = p.want?.match(/^([\d.]+)/);
        if (m) peerDayTotal += parseFloat(m[1]);
      } catch {}
    }
    if (peerTakes.length >= caps.perPeerCount) {
      console.log(`[autoTaker] TIER ${tier} PEER 24H COUNT CAP: ${peerTakes.length} ≥ ${caps.perPeerCount} (peer ${msg._from?.slice(-12)}) — sybil防 skipping`);
      try {
        const { recordChainEvent } = await import('./chain-event.js');
        recordChainEvent({
          txid: `autotake_peer_count_cap_${offerId}`,
          eventType: 'autotake_peer_count_cap',
          payload: JSON.stringify({ offer_id: offerId, peer: msg._from, tier, peerDayCount: peerTakes.length, cap: caps.perPeerCount }),
        });
      } catch (err) { console.warn(`[autoTaker] peer_count_cap audit err: ${err.message}`); }
      return;
    }
    if (peerDayTotal + wantUsd > caps.perPeerTotal) {
      console.log(`[autoTaker] TIER ${tier} PEER 24H TOTAL CAP: ${peerDayTotal.toFixed(2)} + ${wantUsd.toFixed(2)} > $${caps.perPeerTotal} (dir=${direction}) — sybil防 skipping`);
      try {
        const { recordChainEvent } = await import('./chain-event.js');
        recordChainEvent({
          txid: `autotake_peer_total_cap_${offerId}`,
          eventType: 'autotake_peer_total_cap',
          payload: JSON.stringify({ offer_id: offerId, peer: msg._from, tier, peerDayTotal, wantUsd, direction, cap: caps.perPeerTotal }),
        });
      } catch (err) { console.warn(`[autoTaker] peer_total_cap audit err: ${err.message}`); }
      return;
    }

    console.log(`[autoTaker] TIER ${tier} PASS: peer age=${ageDays.toFixed(1)}d card=${hasCard} completed=${completedCount} wantUsd=$${wantUsd.toFixed(2)} dir=${direction} dayTotal=$${peerDayTotal.toFixed(2)}/${caps.perPeerTotal} count=${peerTakes.length}/${caps.perPeerCount}`);
  } catch (e) {
    console.error(`[autoTaker] tier check error: ${e.message} — fail-closed skip`);
    return;
  }

  // 11. Mode: approval (default) or auto
  const mode = await getConfig('autotake_mode') || 'approval';
  if (mode === 'auto') {
    _autoTakeLock = true;
    try {
      await _executeAutoTake(offerId, bestRelay, payChain, direction);
    } finally {
      _autoTakeLock = false;
    }
  } else {
    // Approval mode: create proposal in execution_states
    const { createExecution } = await import('./execution-state.js');
    createExecution({
      orderId: offerId,
      type: 'autotake_proposal',
      source: 'auto-taker',
      agentAddress: localAddrs[0],
      displaySummary: `AutoTake: ${isSellKas ? 'BUY' : 'SELL'} ${isSellKas ? giveAmt : wantAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% ${isSellKas ? 'below' : 'above'} market $${marketPrice})`,
      actionDetails: JSON.stringify({ offerId, offerPrice, marketPrice, discount, direction, chain: payChain, relayId: bestRelay }),
    });
    console.log(`[autoTaker] proposal created for offer ${offerId.slice(0, 8)}`);
  }
}

/**
 * Execute auto-take by calling the internal accept API endpoint.
 * Reuses the full exchange.js accept path — broadcast, meta writes, auto-pay trigger.
 */
async function _executeAutoTake(offerId, relayId, selectedChain = 'bnb', direction = 'SELL') {
  // Verify offer still open
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ? AND protocol_status = ?').get(offerId, 'open');
  if (!offer) {
    console.log(`[autoTaker] offer ${offerId.slice(0, 8)} no longer open, skipping`);
    return;
  }

  // Internal HTTP to POST /api/exchange/accept — reuse full validated path (trap #51 compliant)
  const http = await import('node:http');
  const body = JSON.stringify({
    relayNodeId: relayId,
    offer_id: offerId,
    selected_chain: selectedChain,
    channel: 'kanet-exchange',
  });

  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3100, path: '/api/exchange/accept', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });

  if (result.status !== 200) {
    console.error(`[autoTaker] accept failed for ${offerId.slice(0, 8)}: ${JSON.stringify(result.data)}`);
    return;
  }

  // Record chain_event for audit + Brain awareness
  recordChainEvent({
    txid: result.data?.txId || offerId,
    eventType: 'autotake_accepted',
    fromAddress: sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayId)?.address || '',
    toAddress: offer.maker,
    payload: JSON.stringify({
      offer_id: offerId,
      give: offer.give_amount + ' ' + offer.give_asset,
      want: offer.want_amount + ' ' + offer.want_asset,
    }),
  });

  _lastAutoTakeAt = Date.now();
  console.log(`[autoTaker] accepted offer ${offerId.slice(0, 8)} — auto-pay will trigger via handleExchangeAccept`);
}

/**
 * kanet_exchange_accept_v1 — someone accepts an offer.
 * Delegates to exchange-machine.js: first-valid-accept → matched → verification routing.
 * After matching, triggers CEX hedge if maker is a local agent with hedge config.
 */
async function handleExchangeAccept(msg) {
  if (!msg.offer_id) return;
  const result = machineAccept(msg);
  if (!result) return;
  if (result.protocol_status !== 'awaiting_manual_confirm' &&
      result.protocol_status !== 'verifying') return;

  // Record chain_event for Brain awareness + audit trail
  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_matched',
    fromAddress: result.taker,
    toAddress: result.maker,
    payload: JSON.stringify({
      offer_id: result.id,
      give_asset: result.give_asset, give_amount: result.give_amount,
      want_asset: result.want_asset, want_amount: result.want_amount,
      taker: result.taker, taker_chain: result.taker_chain,
      verification: result.verification,
    }),
  });

  // manual 验证：等待手动确认，不触发对冲
  if (result.protocol_status === 'awaiting_manual_confirm') {
    console.log(`[exchange] manual confirm pending offer=${result.id.slice(0,8)} maker=${result.maker.slice(-8)} taker=${result.taker?.slice(-8)}`);
    return;
  }

  // verifying（cross_chain_tx / kaspa_tx）：不在此阶段触发对冲
  // Hedge 必须等 completed（交割确认后）才触发，否则 Taker 不履约 = 裸空仓

  // === Auto-pay: if taker is a local Agent, automatically pay USDT (cross_chain_tx) ===
  // TASK 2.4 非托管门控: is_dex_broker=1 的 relay 只代发广播不碰钱, 跳过 auto-pay
  if (result.taker && result.taker_chain && result.verification === 'cross_chain_tx') {
    const localRelay = sqlite.prepare('SELECT id, is_dex_broker FROM relay_nodes WHERE address = ?').get(result.taker);
    if (localRelay && !localRelay.is_dex_broker) {
      console.log(`[exchange] local taker detected, triggering auto-pay for offer ${result.id.slice(0,8)}`);
      setImmediate(() => _autoPayExchange(result, localRelay.id).catch(e =>
        console.error(`[exchange] auto-pay error: ${e.message}`)
      ));
    } else if (localRelay?.is_dex_broker) {
      console.log(`[exchange] DEX broker taker — skip auto-pay (non-custodial) offer=${result.id.slice(0,8)}`);
    }
  }

  // === Auto-settle-asset: if taker is a local Agent and offer wants any registered asset ===
  // T-J1-2026-04-27 v1.1 Phase A 协议层 step 3 (Owner 23:05 钦定 '全自动推进 真人能用'):
  // trigger condition KAS-only → 任意 isSupported(want_asset, want_chain). _autoSettleAsset
  // 内部 isSupported guard 真二次 verify, 不 over-trigger non-asset offer.
  // TASK 2.4 同样门控: DEX broker 也不做 auto-settle (非托管)
  // verification 类型分流: 'kaspa_tx' = native chain (KAS) / 'cross_chain_tx' = USDT 已 _autoPayExchange
  // 处理 — 此处只接 native chain transfer (跟原 _autoSendKas 同语义, 但 generic 任意 native asset).
  if (result.taker && result.verification === 'kaspa_tx' && result.want_asset && result.want_chain) {
    const { isSupported } = await import('./asset-registry.js');
    if (isSupported(result.want_asset, result.want_chain)) {
      const localRelay = sqlite.prepare('SELECT id, is_dex_broker FROM relay_nodes WHERE address = ?').get(result.taker);
      if (localRelay && !localRelay.is_dex_broker) {
        console.log(`[exchange] local taker detected, triggering auto-settle-asset (${result.want_asset}/${result.want_chain}) for offer ${result.id.slice(0,8)}`);
        setImmediate(() => _autoSettleAsset(result, localRelay.id).catch(e =>
          console.error(`[exchange] auto-settle-asset error: ${e.message}`)
        ));
      } else if (localRelay?.is_dex_broker) {
        console.log(`[exchange] DEX broker taker — skip auto-settle (non-custodial) offer=${result.id.slice(0,8)}`);
      }
    } else {
      console.log(`[exchange] auto-settle skip: ${result.want_asset}/${result.want_chain} not in asset-registry, offer=${result.id.slice(0,8)}`);
    }
  }
  console.log(`[exchange] offer ${result.id.slice(0,8)} entered verifying — hedge deferred to completed`);
}

/**
 * kanet_exchange_cancel_v1 — maker cancels their offer.
 * Delegates to exchange-machine.js: only valid from 'open' status.
 */
async function handleExchangeCancel(msg) {
  if (!msg.offer_id) return;
  machineCancel(msg);
}

/**
 * kanet_confirm_v1 — manual verification confirmation (maker or taker).
 * Delegates to exchange-machine.js.
 */
async function handleManualConfirm(msg) {
  if (!msg.offer_id) return;
  processManualConfirm(msg);
}

// ── CEX Hedge ────────────────────────────────────────────────

const EXCHANGE_REGISTRY = [
  { id: 'mexc',    authStyle: 'binance-like', headerName: 'X-MEXC-APIKEY', kasPair: 'KASUSDT', baseUrl: 'https://api.mexc.com/api/v3' },
  { id: 'gateio',  authStyle: 'gateio',       kasPair: 'KAS_USDT',         baseUrl: 'https://api.gateio.ws/api/v4' },
  { id: 'kucoin',  authStyle: 'kucoin',       kasPair: 'KAS-USDT',         baseUrl: 'https://api.kucoin.com' },
  { id: 'bybit',   authStyle: 'bybit',        kasPair: 'KASUSDT',          baseUrl: 'https://api.bybit.com' },
  { id: 'bitget',  authStyle: 'bitget',       kasPair: 'KASUSDT',          baseUrl: 'https://api.bitget.com' },
  { id: 'htx',     authStyle: 'htx',          kasPair: 'kasusdt',          baseUrl: 'https://api.huobi.pro' },
  { id: 'kraken',  authStyle: 'kraken',       kasPair: 'KASUSDT',          baseUrl: 'https://api.kraken.com' },
];

// Circuit breaker: 1h window, ≥3 failures → stop hedging
let _hedgeFailures = [];
const HEDGE_CIRCUIT_WINDOW_MS = 60 * 60 * 1000;
const HEDGE_CIRCUIT_THRESHOLD = 3;

function _isHedgeCircuitOpen() {
  const cutoff = Date.now() - HEDGE_CIRCUIT_WINDOW_MS;
  _hedgeFailures = _hedgeFailures.filter(t => t > cutoff);
  return _hedgeFailures.length >= HEDGE_CIRCUIT_THRESHOLD;
}

// hedge_cex 名称映射（scanner 显示名 → DB exchange 字段）
const HEDGE_CEX_MAP = {
  'gate': 'gateio', 'gateio': 'gateio',
  'mexc': 'mexc', 'bybit': 'bybit', 'kucoin': 'kucoin',
  'bitget': 'bitget', 'htx': 'htx', 'huobi': 'htx',
  'binance': 'binance', 'kraken': 'kraken',
};

/**
 * Fetch best bid/ask from the target exchange's public ticker API.
 * Returns aggressive limit price (BUY → ask*1.002, SELL → bid*0.998) or null on failure.
 */
async function _fetchHedgePrice(exchange, side) {
  const TICKER_MAP = {
    mexc:    { url: 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol=KASUSDT',                   parse: d => ({ ask: d.askPrice, bid: d.bidPrice }) },
    gateio:  { url: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=KAS_USDT',               parse: d => ({ ask: (Array.isArray(d) ? d[0] : d).lowest_ask, bid: (Array.isArray(d) ? d[0] : d).highest_bid }) },
    bybit:   { url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=KASUSDT',            parse: d => ({ ask: d.result.list[0].ask1Price, bid: d.result.list[0].bid1Price }) },
    kucoin:  { url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=KAS-USDT',           parse: d => ({ ask: d.data.bestAsk, bid: d.data.bestBid }) },
    bitget:  { url: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=KASUSDT',                parse: d => ({ ask: d.data[0].askPr, bid: d.data[0].bidPr }) },
    htx:     { url: 'https://api.huobi.pro/market/detail/merged?symbol=kasusdt',                       parse: d => ({ ask: d.tick.ask[0], bid: d.tick.bid[0] }) },
    binance: { url: 'https://api.binance.com/api/v3/ticker/bookTicker?symbol=KASUSDT',                 parse: d => ({ ask: d.askPrice, bid: d.bidPrice }) },
  };

  const entry = TICKER_MAP[exchange];
  if (!entry) {
    console.log(`[exchange-hedge] No ticker for ${exchange}, fallback to MEXC`);
    const fb = TICKER_MAP.mexc;
    try {
      const data = await fetch(fb.url, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
      const { ask, bid } = fb.parse(data);
      const price = side === 'BUY' ? parseFloat(ask) * 1.002 : parseFloat(bid) * 0.998;
      console.log(`[exchange-hedge] price from mexc (fallback): ask=${ask} bid=${bid}`);
      return price;
    } catch {
      console.log(`[exchange-hedge] Price fetch failed (fallback MEXC) — aborting hedge`);
      return null;
    }
  }

  try {
    const data = await fetch(entry.url, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    const { ask, bid } = entry.parse(data);
    const price = side === 'BUY' ? parseFloat(ask) * 1.002 : parseFloat(bid) * 0.998;
    console.log(`[exchange-hedge] price from ${exchange}: ask=${ask} bid=${bid}`);
    return price;
  } catch (err) {
    console.log(`[exchange-hedge] Price fetch failed from ${exchange}: ${err.message} — aborting hedge`);
    return null;
  }
}

/**
 * Execute a hedge order on the best available CEX.
 * If preferredCex specified, try that first; otherwise use default account.
 */
async function _executeHedge(offerId, agentName, side, qty, preferredCex = null) {
  // T-22-05 Step G — Opt-in hedge gate（安全门控）
  // 默认不对冲。只有 offer.meta.hedge_enabled === true 才触发对冲。
  // 防止 retail-proxy / bounty / auction 等 non-hedgeable offer 类型误触发 CEX 反向下单。
  // 3 个调用点（api/exchange.js / exchange-machine.js x2）全部自动受保护。
  // KI 第 16 次 silent skip 修 (J2 #520 / NWT N19.12 三方共识 5/19):
  // 旧 SQL "SELECT meta" 30 天 throw "no such column: meta" → executeHedge .catch 静默吞 →
  // 0 chain_events hedge_*, 0 trade_log hedge-source, 配 5 家 CEX 凭据全废.
  // exchange_offers 真字段名是 `metadata`, 不是 `meta`. 同款 KI silent skip (15 次).
  const _hedgeGateOffer = sqlite.prepare(
    "SELECT metadata FROM exchange_offers WHERE id = ? LIMIT 1"
  ).get(offerId);
  if (!_hedgeGateOffer) {
    console.log(`[exchange-hedge] offer ${offerId.slice(0, 8)} not found — skip`);
    return;
  }
  let _hedgeGateMeta = {};
  try { _hedgeGateMeta = JSON.parse(_hedgeGateOffer.metadata || '{}'); } catch {}
  if (_hedgeGateMeta.hedge_enabled !== true) {
    console.log(`[exchange-hedge] offer ${offerId.slice(0, 8)} hedge_enabled!=true → skip (default opt-in safety)`);
    return;
  }

  // Idempotency guard — prevent double-hedge if both API and chain paths fire
  const _existingHedge = sqlite.prepare(
    "SELECT id FROM chain_events WHERE txid = ? AND event_type LIKE 'hedge%' LIMIT 1"
  ).get(offerId);
  if (_existingHedge) {
    console.log(`[exchange-hedge] Duplicate suppressed for offer ${offerId.slice(0, 8)}`);
    return;
  }

  if (_isHedgeCircuitOpen()) {
    console.log(`[exchange-hedge] CIRCUIT OPEN — ${_hedgeFailures.length} failures in 1h, skipping hedge for ${offerId.slice(0, 8)}`);
    recordChainEvent({
      txid: offerId, eventType: 'hedge_skipped',
      fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { reason: 'circuit_breaker', failures: _hedgeFailures.length },
    });
    return;
  }

  // Phase 5-2.5 KI 35 (NWT N19.69): hedge-router 替换原 picker, knob-driven CEX 分流.
  // Backward compat: hedge_router_enabled=false → 行为同原 picker (Phase 1a 不破).
  // Peek price via bybit for orderValueUsdt routing decision (CEX-independent oracle defer):
  const { selectHedgeAccount } = await import('./hedge-router.js');
  const peekPrice = await _fetchHedgePrice('bybit', side).catch(() => null);
  const orderValueUsdt = peekPrice && qty ? Number(peekPrice) * Number(qty) : null;
  const { account, route } = await selectHedgeAccount({
    preferredCex, orderValueUsdt, side,
    mode: process.env.KANET_HEDGE_MODE || 'production',
  });

  if (!account) {
    console.log(`[exchange-hedge] No exchange account configured — cannot hedge ${offerId.slice(0, 8)}`);
    return;
  }
  console.log(`[exchange-hedge] router pick: ${account.exchange} (route=${route}) for offer ${offerId.slice(0,8)}`);

  const def = EXCHANGE_REGISTRY.find(e => e.id === account.exchange);
  if (!def) {
    console.log(`[exchange-hedge] Unknown exchange: ${account.exchange}`);
    return;
  }

  let apiKey, apiSecret, extra;
  try {
    apiKey = account.api_key_encrypted ? decrypt(account.api_key_encrypted) : null;
    apiSecret = account.api_secret_encrypted ? decrypt(account.api_secret_encrypted) : null;
    extra = account.extra_encrypted ? JSON.parse(decrypt(account.extra_encrypted)) : {};
  } catch (err) {
    console.log(`[exchange-hedge] Credential decrypt failed: ${err.message}`);
    return;
  }

  // Fetch current market price from the target exchange (not hardcoded MEXC)
  const hedgePrice = await _fetchHedgePrice(account.exchange, side);
  if (!hedgePrice) {
    _hedgeFailures.push(Date.now());
    return;
  }
  const price = hedgePrice;

  console.log(`[exchange-hedge] ${agentName} ${side} ${qty} KAS @ ${price.toFixed(5)} on ${account.exchange} (hedge for offer ${offerId.slice(0, 8)})`);

  const result = await placeOrder({
    authStyle: def.authStyle,
    baseUrl: account.base_url || def.baseUrl,
    headerName: def.headerName,
    apiKey, apiSecret, extra,
    symbol: def.kasPair, kasPair: def.kasPair,
    side, price, qty,
  });

  if (result.ok) {
    console.log(`[exchange-hedge] SUCCESS orderId=${result.orderId} for offer ${offerId.slice(0, 8)}`);
    recordChainEvent({
      txid: offerId, eventType: 'hedge_placed',
      fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { exchange: account.exchange, side, qty, price, orderId: result.orderId },
    });
    // T-J2-2026-05-09 r203 T2.5b (Reading D P2P path): poll fill + user_ledger + DM user.
    // KANet taker 接 SELL offer + paid + delivered + completed → _executeHedge fire (hedge_placed line 924).
    // 加: 30s inline poll cex-bridge.getCexOrder until filled OR timeout. filled → ledger entry + DM via
    // broker-action-queue dm_completion. timeout → chain_event hedge_pending_fill, reconciler 5min retry.
    // user_kasia_address 来自 metadata (broker-intake-watcher.js:255 + broker-v3/router.js:109/119 写).
    // ref: NWT r270 PASS Reading D ship sequence.
    const userKasia = (() => {
      try { return JSON.parse(_hedgeGateOffer.metadata || '{}').user_kasia_address || null; } catch { return null; }
    })();
    if (userKasia && typeof userKasia === 'string' && userKasia.startsWith('kaspa:')) {
      setImmediate(async () => {
        try {
          const { getCexOrder } = await import('./cex-bridge.js');
          const POLL_TIMEOUT_MS = 30_000;
          const POLL_INTERVAL_MS = 3_000;
          const start = Date.now();
          let filled = null;
          while (Date.now() - start < POLL_TIMEOUT_MS) {
            const orderState = await getCexOrder({ cex: account.exchange, orderId: result.orderId });
            if (orderState.filled) { filled = orderState; break; }
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          }
          if (filled) {
            const proceedsUsdt = parseFloat((filled.executedQty * price).toFixed(4));
            const cur = sqlite.prepare(
              `SELECT COALESCE(SUM(balance_change), 0) AS balance FROM user_ledger
               WHERE user_kasia_address = ? AND asset = 'USDT'`
            ).get(userKasia);
            const balanceAfter = parseFloat(((cur?.balance || 0) + proceedsUsdt).toFixed(4));
            const ledgerId = `ledger_hedge_${offerId.slice(0, 12)}_${Date.now()}`;
            sqlite.prepare(`
              INSERT INTO user_ledger (id, user_kasia_address, asset, chain, balance_change, balance_after, reason, ref_order_id, ref_tx_hash, created_at)
              VALUES (?, ?, 'USDT', NULL, ?, ?, ?, ?, NULL, datetime('now'))
            `).run(ledgerId, userKasia, proceedsUsdt, balanceAfter, `hedge_filled:${result.orderId}`, offerId);
            recordChainEvent({
              txid: offerId, eventType: 'hedge_completed',
              fromAddress: null, toAddress: null, observedBy: 'system',
              payload: { exchange: account.exchange, side, qty: filled.executedQty, proceeds_usdt: proceedsUsdt, cex_order_id: result.orderId, balance_after: balanceAfter },
            });
            const { enqueue } = await import('./broker-action-queue.js');
            enqueue({ kind: 'dm_completion', peer: userKasia, payload: {
              message: `KAS 卖出成交 ${filled.executedQty} KAS → ${proceedsUsdt} USDT 入账\n账户余额: ${balanceAfter} USDT (broker IOU)\n回 "余额" 查账户 / "提 N USDT TRC20" 提币`,
            } });
            console.log(`[exchange-hedge] T2.5b ledger ${userKasia.slice(-12)} +${proceedsUsdt} USDT (offer ${offerId.slice(0,8)})`);
          } else {
            recordChainEvent({
              txid: offerId, eventType: 'hedge_pending_fill',
              fromAddress: null, toAddress: null, observedBy: 'system',
              payload: { exchange: account.exchange, cex_order_id: result.orderId, side, qty, price, polled_ms: POLL_TIMEOUT_MS },
            });
            console.log(`[exchange-hedge] T2.5b poll timeout offer=${offerId.slice(0,8)} cex_order=${result.orderId} → reconciler retry`);
          }
        } catch (err) {
          console.error(`[exchange-hedge] T2.5b ledger err: ${err.message}`);
        }
      });
    }
  } else {
    console.log(`[exchange-hedge] FAILED: ${result.error} for offer ${offerId.slice(0, 8)}`);
    _hedgeFailures.push(Date.now());
    recordChainEvent({
      txid: offerId, eventType: 'hedge_failed',
      fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { exchange: account.exchange, side, qty, price, error: result.error },
    });
  }
}

// ── Exchange v2 protocol handlers ─────────────────────────────

/**
 * kanet_exchange_paid_v1 — taker broadcasts payment proof.
 * Transitions matched → verifying → triggers _verifyAndComplete.
 */
async function handleExchangePaid(msg) {
  if (!msg.offer_id || !msg.payment_tx) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) { console.log(`[exchange] paid: offer ${msg.offer_id} not found`); return; }

  // Gate 1: payment_tx already set → duplicate, skip
  if (offer.payment_tx) { console.log(`[exchange] paid: offer ${msg.offer_id.slice(0,8)} already has payment_tx, skip`); return; }

  // Gate 1.5 (2026-04-14 Q3 audit fix): payment_tx 已被别的 offer 用过 → reuse 攻击
  // 防止攻击者拿一笔真实付款的 txHash 去 "兑换" 多个 offer 的交割.
  // DB 层也有 UNIQUE index 作为 belt-and-suspenders, 但应用层先挡省一次 DB error.
  if (msg.payment_tx) {
    const existingUse = sqlite.prepare(
      'SELECT id, maker, taker FROM exchange_offers WHERE payment_tx = ? AND id != ?'
    ).get(msg.payment_tx, msg.offer_id);
    if (existingUse) {
      console.log(`[exchange] paid: REUSE BLOCKED — ${msg.payment_tx.slice(0,16)} already used by offer ${existingUse.id.slice(0,8)}`);
      recordChainEvent({
        txid: msg._tx || null,
        eventType: 'exchange_paid_reuse_rejected',
        fromAddress: msg._from || null,
        toAddress: offer.maker,
        payload: JSON.stringify({
          offer_id: msg.offer_id,
          reused_tx: msg.payment_tx,
          original_offer: existingUse.id,
          original_taker: existingUse.taker,
          attacker: msg._from || null,
        }),
      });
      return;
    }
  }

  // Gate 2: must be in matched or verifying (cross_chain_tx routes to verifying on accept)
  if (!['matched', 'verifying'].includes(offer.protocol_status)) {
    console.log(`[exchange] paid: offer ${msg.offer_id.slice(0,8)} status=${offer.protocol_status}, expected matched/verifying`);
    return;
  }

  // Write payment_tx (UNIQUE index 作为 fail-safe; 若并发插入冲突此处会抛, try 捕获降级)
  try {
    sqlite.prepare('UPDATE exchange_offers SET payment_tx = ? WHERE id = ?').run(msg.payment_tx, msg.offer_id);
  } catch (dbErr) {
    // UNIQUE constraint violation — 并发 reuse 从 DB 层被拦
    console.log(`[exchange] paid: DB UNIQUE conflict on payment_tx ${msg.payment_tx.slice(0,16)} for offer ${msg.offer_id.slice(0,8)}: ${dbErr.message}`);
    recordChainEvent({
      txid: msg._tx || null,
      eventType: 'exchange_paid_reuse_rejected',
      fromAddress: msg._from || null,
      toAddress: offer.maker,
      payload: JSON.stringify({
        offer_id: msg.offer_id,
        reused_tx: msg.payment_tx,
        source: 'db_unique_constraint',
      }),
    });
    return;
  }
  if (msg.payment_chain && !offer.taker_chain) {
    sqlite.prepare('UPDATE exchange_offers SET taker_chain = ? WHERE id = ?').run(msg.payment_chain, msg.offer_id);
  }

  // Transition to verifying if still matched; already verifying = skip transition
  let verifyingOffer;
  if (offer.protocol_status === 'matched') {
    verifyingOffer = exchangeTransition(msg.offer_id, 'verifying', {});
    if (!verifyingOffer || verifyingOffer.protocol_status !== 'verifying') {
      console.log(`[exchange] paid: transition to verifying failed for ${msg.offer_id.slice(0,8)}`);
      return;
    }
  } else {
    verifyingOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  }

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_paid',
    fromAddress: msg.payer || offer.taker,
    toAddress: offer.maker,
    payload: JSON.stringify({ offer_id: msg.offer_id, payment_tx: msg.payment_tx, chain: msg.payment_chain }),
  });

  // Trigger verification via existing processPaymentSubmit (it handles _verifyAndComplete)
  // Sub #4.b hotfix: forward payment_asset so verifyCrossChainTx routes to correct STABLECOINS[chain][asset]
  // (base chain USDC route, was defaulting to 'usdt' → "Underpayment 0" → auto-dispute).
  const chain = offer.taker_chain || msg.payment_chain;
  processPaymentSubmit({ offer_id: msg.offer_id, payment_tx: msg.payment_tx, payment_chain: chain, payment_asset: msg.payment_asset });

  console.log(`[exchange] paid: offer ${msg.offer_id.slice(0,8)} → verifying, TX=${msg.payment_tx.slice(0,16)}`);
}

/**
 * kanet_exchange_delivered_v1 — maker broadcasts KAS delivery proof.
 * Taker node updates local state to completed.
 */
async function handleExchangeDelivered(msg) {
  if (!msg.offer_id || !msg.delivery_tx) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return;

  // Idempotent: already completed/disputed/etc → skip
  if (['completed', 'disputed', 'cancelled', 'expired'].includes(offer.protocol_status)) return;

  // T-J2-2026-05-11 Phase 2 A.5 (NWT #18 ABE audit) — bypass 保留 + comment 更新:
  // BYPASS reason: buyer node receiving delivery_v1 真 protocol_status 可能 matched/verifying/delivering 任一
  // (cross-node sync 异步)。VALID_TRANSITIONS 'matched' targets [verifying/awaiting_manual_confirm/awaiting_oracle/refunded] 不含
  // 'completed' — transition('matched', 'completed') 真 reject。direct UPDATE with status IN (..) guard 是 buyer-state-
  // agnostic 唯一路径。A.6 lint rule 真 whitelist 此 site (注释 marker 'lint-allow-protocol-status-direct: ABE-A.5')。
  // lint-allow-protocol-status-direct: ABE-A.5-buyer-state-agnostic-completion
  // TIMEZONE FIX: bind JS toISOString() instead of SQLite datetime('now') to ensure Z suffix.
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (naive) which JS Date() parses as LOCAL,
  // causing "completed 7h ago" bug on P2-01 for Owner in +7 timezone. Phase 2 first finding.
  const nowIso = new Date().toISOString();
  // Round 1 真测发现 Bug 5: 漏 UPDATE delivery_tx → 买家端 offer.delivery_tx 永远 null →
  // broker-buy-completion-watcher fallback 取 taker_tx_id (= accept_v1 broadcast tx) →
  // DM 给用户的"Maker 发的 tx"引错. msg.delivery_tx 是 maker 真发 KAS 的 tx.
  const result = sqlite.prepare(`
    UPDATE exchange_offers SET delivery_tx = ?, protocol_status = 'completed', completed_at = ?, is_fully_observed = 1, updated_at = ?
    WHERE id = ? AND protocol_status IN ('matched', 'verifying', 'delivering')
  `).run(msg.delivery_tx, nowIso, nowIso, msg.offer_id);

  // FIX: when the direct UPDATE moves offer to completed, fund_lock must also transition locked → spent.
  // Without this, Phase 1 stress test S9 showed fund_locks permanently stuck (leak).
  if (result.changes > 0) {
    try {
      const { spendFunds } = await import('./fund-lock.js');
      spendFunds(msg.offer_id);
    } catch (e) {
      console.error(`[exchange] handleExchangeDelivered spendFunds error: ${e.message}`);
    }
  }

  recordChainEvent({
    txid: msg.delivery_tx,
    eventType: 'exchange_delivered',
    fromAddress: offer.maker,
    toAddress: offer.taker,
    payload: JSON.stringify({ offer_id: msg.offer_id, delivery_tx: msg.delivery_tx, amount: msg.delivery_amount }),
  });

  console.log(`[exchange] delivered: offer ${msg.offer_id.slice(0,8)} → completed (was ${offer.protocol_status})`);
}

/**
 * kanet_exchange_timeout_v1 — maker broadcasts payment timeout.
 * Reverts matched → open, clears taker fields, releases fund lock.
 * Does NOT use transition() — timeout revert is an exceptional flow.
 */
async function handleExchangeTimeout(msg) {
  if (!msg.offer_id) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return;
  if (offer.protocol_status !== 'matched') return;

  // Direct SQL UPDATE: matched → open, clear taker fields
  // TIMEZONE FIX: use JS toISOString() for updated_at (Phase 2 P2-01 finding)
  const nowIso = new Date().toISOString();
  sqlite.prepare(`
    UPDATE exchange_offers
    SET protocol_status = 'open',
        taker = NULL, taker_chain = NULL, taker_payment_address = NULL,
        payment_tx = NULL, matched_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(nowIso, msg.offer_id);

  releaseFunds(msg.offer_id);

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_timeout',
    fromAddress: offer.maker,
    payload: JSON.stringify({ offer_id: msg.offer_id, taker: msg.taker || offer.taker, reason: msg.reason }),
  });

  console.log(`[exchange] timeout: offer ${msg.offer_id.slice(0,8)} reopened (was matched with ${(offer.taker || '').slice(-8)})`);
}

/**
 * kanet_exchange_dispute_v1 — peer raised a dispute on an offer.
 *
 * 2026-04-14 Q4 audit fix: 之前 DISPUTE 消息类型定义了但没 handler, 导致跨节点状态不同步.
 * 本地节点收到其他节点广播的 dispute, 推进本地 offer 到 disputed 状态.
 *
 * 幂等: 重复处理已在 disputed 的消息不会 double-apply.
 */
async function handleExchangeDispute(msg) {
  if (!msg.offer_id) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) {
    console.log(`[exchange] dispute: unknown offer ${msg.offer_id.slice(0,8)}, skip`);
    return;
  }

  // 幂等: 已是 disputed 或更后的 terminal 状态就跳过
  if (offer.protocol_status === 'disputed') {
    console.log(`[exchange] dispute: offer ${msg.offer_id.slice(0,8)} already disputed, idempotent skip`);
    return;
  }
  const TERMINAL_AFTER_DISPUTE = ['completed', 'cancelled', 'timed_out', 'failed', 'expired'];
  if (TERMINAL_AFTER_DISPUTE.includes(offer.protocol_status)) {
    console.log(`[exchange] dispute: offer ${msg.offer_id.slice(0,8)} already terminal (${offer.protocol_status}), skip`);
    return;
  }

  // Verify disputer is party to the offer (防止随机地址广播假 dispute)
  const isParty = msg.disputer === offer.maker || msg.disputer === offer.taker;
  if (!isParty) {
    console.log(`[exchange] dispute: rejected — ${(msg.disputer || '').slice(-8)} is not maker/taker of offer ${msg.offer_id.slice(0,8)}`);
    return;
  }

  // 写入 dispute meta + transition
  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.dispute_reason = msg.reason || 'no_reason_given';
  meta.dispute_by = msg.disputer;
  meta.dispute_at = msg.raised_at || new Date().toISOString();

  sqlite.prepare(
    'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(meta), new Date().toISOString(), msg.offer_id);

  exchangeTransition(msg.offer_id, 'disputed', {});

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_disputed',
    fromAddress: msg.disputer || null,
    toAddress: offer.maker === msg.disputer ? offer.taker : offer.maker,
    payload: JSON.stringify({
      offer_id: msg.offer_id,
      disputer: msg.disputer,
      reason: msg.reason,
      from_status: offer.protocol_status,
    }),
  });

  console.log(`[exchange] dispute: offer ${msg.offer_id.slice(0,8)} → disputed (by ${(msg.disputer || '').slice(-8)}: ${msg.reason || '-'})`);
}

/**
 * kanet_exchange_resolve_v1 — dispute resolved (concede-only).
 *
 * 2026-04-14 Q4 audit fix: resolve 消息类型之前不存在 handler. 现在支持跨节点同步 resolve 结果.
 *
 * Concede-only 语义: maker 调 resolve → outcome=taker_wins (maker 认输);
 * taker 调 → outcome=maker_wins. 接收端也校验这个约束, 防止伪造"我判对方输".
 *
 * 幂等: 已 resolve 过的 offer 不会重复应用.
 */
async function handleExchangeResolve(msg) {
  if (!msg.offer_id || !msg.outcome) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) {
    console.log(`[exchange] resolve: unknown offer ${msg.offer_id.slice(0,8)}, skip`);
    return;
  }

  // 幂等: 已 resolve 过 (non-disputed terminal) → 跳过
  if (offer.protocol_status !== 'disputed') {
    console.log(`[exchange] resolve: offer ${msg.offer_id.slice(0,8)} status=${offer.protocol_status}, not disputed, skip`);
    return;
  }

  // Verify resolver is maker or taker
  const resolver = msg.resolver;
  if (!resolver || (resolver !== offer.maker && resolver !== offer.taker)) {
    console.log(`[exchange] resolve: rejected — ${(resolver || '').slice(-8)} is not maker/taker`);
    return;
  }

  // Concede-only check: maker only concede → taker_wins; taker only → maker_wins
  const expectedOutcome = resolver === offer.maker ? 'taker_wins' : 'maker_wins';
  if (msg.outcome !== expectedOutcome) {
    console.log(`[exchange] resolve: rejected — concede-only violation: ${resolver === offer.maker ? 'maker' : 'taker'} must concede (${expectedOutcome}), got ${msg.outcome}`);
    return;
  }

  const newStatus = msg.outcome === 'maker_wins' ? 'completed' : 'cancelled';
  const now = new Date().toISOString();

  // T-J2-2026-05-11 Phase 2 A.5 (NWT #18 ABE audit) — bypass 保留 + comment verified accurate:
  // disputed 在 TERMINAL Set (exchange-machine.js:34, A.1 加 refunded 后 ['completed','disputed','timed_out',
  // 'failed','cancelled','expired','refunded'])。transition() L46-48 真 TERMINAL 时 return offer unchanged
  // 不 transition — 真 confirmed reject。dispute resolution 真必走 bypass (terminal escape)。
  // A.6 lint rule 真 whitelist 此 site (注释 marker 'lint-allow-protocol-status-direct: ABE-A.5')。
  // lint-allow-protocol-status-direct: ABE-A.5-dispute-resolution-terminal-escape
  sqlite.prepare(`
    UPDATE exchange_offers
    SET protocol_status = ?, updated_at = ?,
        verification_meta = json_patch(COALESCE(verification_meta, '{}'), ?)
    WHERE id = ?
  `).run(newStatus, now, JSON.stringify({
    resolved_at: now,
    resolve_outcome: msg.outcome,
    resolved_by: resolver,
    resolve_tx: msg._tx || null,
    resolve_source: 'remote_broadcast',
  }), msg.offer_id);

  // Fund lock resolution (同 resolve endpoint 的逻辑)
  const { releaseFunds, spendFunds } = await import('./fund-lock.js');
  if (msg.outcome === 'maker_wins') {
    try { spendFunds(msg.offer_id); } catch (e) { console.error(`[resolve-remote] spendFunds: ${e.message}`); }
  } else {
    try { releaseFunds(msg.offer_id); } catch (e) { console.error(`[resolve-remote] releaseFunds: ${e.message}`); }
  }

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_resolved',
    fromAddress: resolver,
    toAddress: resolver === offer.maker ? offer.taker : offer.maker,
    payload: JSON.stringify({
      offer_id: msg.offer_id,
      outcome: msg.outcome,
      resolver,
      from_status: 'disputed',
      to_status: newStatus,
      source: 'remote_broadcast',
    }),
  });

  console.log(`[exchange] resolve: offer ${msg.offer_id.slice(0,8)} disputed → ${newStatus} (${msg.outcome}, resolver=${resolver.slice(-8)})`);
}

// ── Auto-pay for Exchange offers ──────────────────────────────

/**
 * Local taker auto-pays USDT after accepting an exchange offer.
 * Mirrors OTC pay_usdt logic but uses shared evm-transfer.js.
 */
async function _autoPayExchange(offer, takerRelayNodeId) {
  const chain = offer.taker_chain;
  if (!chain) {
    console.log(`[exchange-autopay] No taker_chain on offer ${offer.id.slice(0,8)}, skip`);
    return;
  }

  // Check if chain is supported for auto-pay (BNB/ETH/SOL/TRON)
  const { isChainSupported, transferUsdt } = await import('./evm-transfer.js');
  if (!isChainSupported(chain)) {
    console.log(`[exchange-autopay] Chain ${chain} not supported for auto-pay, skip`);
    return;
  }

  // Get taker's wallet for this chain
  const wallet = sqlite.prepare(
    'SELECT id, address, privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1'
  ).get(takerRelayNodeId, chain);
  if (!wallet?.privkey_encrypted) {
    console.log(`[exchange-autopay] No ${chain} wallet with private key for taker ${takerRelayNodeId.slice(0,8)}, skip`);
    return;
  }

  // Receive address = maker's address for the selected chain (from verification_meta or taker_payment_address)
  const receiveAddress = offer.taker_payment_address;
  if (!receiveAddress) {
    console.log(`[exchange-autopay] No receive address on offer ${offer.id.slice(0,8)}, skip`);
    return;
  }

  const amount = parseFloat(offer.want_amount);
  if (!amount || amount <= 0) {
    console.log(`[exchange-autopay] Invalid amount ${offer.want_amount}, skip`);
    return;
  }

  console.log(`[exchange-autopay] Paying ${amount} USDT → ${receiveAddress.slice(0,12)}... on ${chain} for offer ${offer.id.slice(0,8)}`);

  const result = await transferUsdt(chain, wallet.privkey_encrypted, receiveAddress, amount, offer.want_asset || 'USDT');
  if (!result.ok) {
    console.error(`[exchange-autopay] Payment failed: ${result.error}`);
    recordChainEvent({
      eventType: 'exchange_pay_failed',
      fromAddress: offer.taker,
      payload: JSON.stringify({ offer_id: offer.id, chain, error: result.error }),
    });
    return;
  }

  console.log(`[exchange-autopay] Payment TX: ${result.txHash}`);

  // Write payment_tx to offer (USDT already sent, record the fact)
  sqlite.prepare('UPDATE exchange_offers SET payment_tx = ? WHERE id = ?').run(result.txHash, offer.id);

  // === NO TX NO STATE CHANGE ===
  // No delay needed: transaction.mjs now tracks pending spent UTXOs in memory,
  // so consecutive sendKaspa calls use different UTXOs automatically.
  // Broadcast kanet_exchange_paid_v1 — MUST succeed before advancing state.
  // If broadcast fails (UTXO conflict etc), retry with backoff.
  // Only after TX is on chain do we processPaymentSubmit.
  const { sendCommandAsync } = await import('./relay-manager.js');
  const paidMsg = JSON.stringify({
    t: 'kanet_exchange_paid_v1',
    offer_id: offer.id,
    payment_tx: result.txHash,
    payment_chain: chain,
    payment_asset: offer.want_asset || 'USDT',
    payment_amount: offer.want_amount,
    payer: offer.taker,
  });

  // Bug AN 5/16 fix (NWT 02:30 HP-01 surface): 5 retries × 200ms backoff ~2s 太短 for Kaspa
  // mempool / UTXO contention scenarios. USDT autopay path 同 KAS autosettle 同款 short retry
  // 不 robust. Increase 15 retries × 1000ms linear + 5s extra every 5 attempts.
  let paidTxId = null;
  const MAX_BCAST_RETRIES = 15;
  const BCAST_RETRY_MS = 1000;
  for (let attempt = 1; attempt <= MAX_BCAST_RETRIES; attempt++) {
    try {
      const bcastResult = await sendCommandAsync(takerRelayNodeId, {
        type: 'send_broadcast',
        channel: 'kanet-exchange',
        message: paidMsg,
      });
      if (bcastResult?.error) {
        console.error(`[exchange-autopay] Paid broadcast attempt ${attempt}/${MAX_BCAST_RETRIES}: ${bcastResult.error}`);
      } else {
        paidTxId = bcastResult?.txId;
        if (paidTxId) {
          console.log(`[exchange-autopay] Broadcast kanet_exchange_paid_v1 TX: ${paidTxId} (attempt ${attempt})`);
          break;
        }
      }
    } catch (err) {
      console.error(`[exchange-autopay] Paid broadcast attempt ${attempt}/${MAX_BCAST_RETRIES} failed: ${err.message}`);
    }
    if (attempt < MAX_BCAST_RETRIES) {
      const extraMs = attempt % 5 === 0 ? 5000 : 0;
      await new Promise(r => setTimeout(r, BCAST_RETRY_MS + extraMs));
    }
  }

  if (!paidTxId) {
    // All retries failed — DO NOT advance state. USDT was sent but paid broadcast didn't land.
    // Record the failure so system can retry later or operator can intervene.
    console.error(`[exchange-autopay] CRITICAL: paid broadcast failed after ${MAX_BCAST_RETRIES} attempts. Offer ${offer.id.slice(0,8)} stays at current state. USDT TX ${result.txHash} was sent but maker node will not know.`);
    recordChainEvent({
      txid: result.txHash,
      eventType: 'exchange_paid_broadcast_failed',
      fromAddress: offer.taker,
      payload: JSON.stringify({ offer_id: offer.id, chain, amount, payment_tx: result.txHash, error: 'broadcast_failed_all_retries' }),
    });
    return;
  }

  // Broadcast succeeded — TX is on chain. NOW advance local state.
  recordChainEvent({
    txid: result.txHash,
    eventType: 'exchange_paid',
    fromAddress: offer.taker,
    toAddress: offer.maker,
    payload: JSON.stringify({ offer_id: offer.id, chain, amount, payment_tx: result.txHash, broadcast_tx: paidTxId }),
  });

  // Sub #4.b hotfix: forward payment_asset (offer.want_asset) to processPaymentSubmit so
  // verifyCrossChainTx routes to correct STABLECOINS[chain][asset] (base USDC route fix).
  processPaymentSubmit({ offer_id: offer.id, payment_tx: result.txHash, payment_chain: chain, payment_asset: offer.want_asset });
  console.log(`[exchange-autopay] verification triggered for offer ${offer.id.slice(0,8)}`);
}

/**
 * Auto-settle asset for offers where taker is local Agent (KAS or any registered asset).
 * Mirror of _autoPayExchange but for the want_asset side (taker delivers what offer wants).
 *
 * T-J1-2026-04-27 v1.1 Phase A 协议层 step 2 (NWT 23:42 + Owner '自决, 赶紧的'):
 * rename _autoSendKas → _autoSettleAsset, guard 从 KAS-only 改 isSupported (asset-registry),
 * 调 J1 Phase B settler-router.sendAsset 真路由 (KAS 走 kasia settler / USDT/USDC 走 evm settler).
 *
 * 现行为兼容: 现 trigger condition (line 711) 仍 'kaspa_tx + want_asset==KAS', 函数被调时
 * want_asset 真就是 'KAS', isSupported('KAS', 'kaspa') = true, 调 sendAsset 经 'kasia' settler
 * 内部走 sendCommandAsync({type:'send_kas', target, amount_kas}) — relay 行为同前.
 *
 * v1.1 Phase A step 3 (后续): trigger condition (line 711) 改 isSupported(want_asset, want_chain),
 * 任意 asset_pair 都触发 _autoSettleAsset. 那时 USDT/USDC offer 真自动 settle.
 */
async function _autoSettleAsset(offer, takerRelayNodeId) {
  const { isSupported } = await import('./asset-registry.js');
  const { sendAsset } = await import('./settler-router.js');
  // Bug BA 5/16 fix (Phase 1 re-test surface): sendCommandAsync 在 _autoPayExchange L1400 imported
  // 但 _autoSettleAsset 不同 function scope, L1566 paid_v1 broadcast 用时 'sendCommandAsync is not
  // defined' 抛 30/30 retry — Bug AY 加 retry width 治标不治本, 真因 = JS scope 漏 import.
  const { sendCommandAsync } = await import('./relay-manager.js');

  const wantAsset = offer.want_asset;
  const wantChain = offer.want_chain || (wantAsset?.toUpperCase() === 'KAS' ? 'kaspa' : null);
  if (!wantAsset || !wantChain) {
    console.log(`[exchange-autosettle] Offer ${offer.id.slice(0,8)} missing want_asset/chain (${wantAsset}/${wantChain}), skip`);
    return;
  }
  if (!isSupported(wantAsset, wantChain)) {
    console.log(`[exchange-autosettle] Offer ${offer.id.slice(0,8)} ${wantAsset}/${wantChain} not in asset-registry, skip`);
    return;
  }

  const amount = parseFloat(offer.want_amount);
  if (!amount || amount <= 0) {
    console.log(`[exchange-autosettle] Invalid amount ${offer.want_amount} for ${wantAsset}, skip`);
    return;
  }

  // Recipient = maker's expected address from verification_meta
  const meta = JSON.parse(offer.verification_meta || '{}');
  const recipientAddress = meta.expected_address || offer.maker;
  if (!recipientAddress) {
    console.log(`[exchange-autosettle] No recipient address for offer ${offer.id.slice(0,8)}, skip`);
    return;
  }

  console.log(`[exchange-autosettle] Sending ${amount} ${wantAsset}/${wantChain} → ${recipientAddress.slice(-12)} for offer ${offer.id.slice(0,8)}`);

  // Wait for UTXO to settle — accept broadcast just consumed a UTXO (Kaspa) or nonce confirm (EVM)
  await new Promise(r => setTimeout(r, 5000));

  try {
    // 调 J1 Phase B settler-router (commit 6b7b35a) 真路由
    const sendResult = await sendAsset({
      asset: wantAsset, chain: wantChain, to: recipientAddress, qty: amount, relayId: takerRelayNodeId,
    });

    const txId = sendResult?.txHash || sendResult?.txId;
    if (!sendResult?.ok || !txId) {
      console.error(`[exchange-autosettle] ${wantAsset}/${wantChain} send failed: ${sendResult?.error || 'no txId'}`);
      recordChainEvent({
        eventType: 'exchange_settle_failed',
        fromAddress: offer.taker,
        payload: JSON.stringify({ offer_id: offer.id, asset: wantAsset, chain: wantChain, error: sendResult?.error || 'no txId' }),
      });
      return;
    }

    console.log(`[exchange-autosettle] ${wantAsset}/${wantChain} sent TX: ${txId}`);

    // Write payment_tx to offer
    sqlite.prepare('UPDATE exchange_offers SET payment_tx = ? WHERE id = ?').run(txId, offer.id);

    // === NO TX NO STATE CHANGE (P1-C consensus: 铁律不分场景) ===
    // Broadcast kanet_exchange_paid_v1 — must succeed before processPaymentSubmit.
    // T-J1-2026-04-27 v1.1 Phase A 协议层 step 2: payment_asset + payment_chain 全 DB 真值
    // (兼容 KAS path = offer.want_asset='KAS', want_chain='kaspa', 同前; multi-asset 后真带
    // USDT/USDC + bnb/eth 等真值 from DB).
    const paidMsg = JSON.stringify({
      t: 'kanet_exchange_paid_v1',
      offer_id: offer.id,
      payment_tx: txId,
      payment_chain: wantChain,
      payment_asset: wantAsset,
      payment_amount: offer.want_amount,
      payer: offer.taker,
    });

    // Bug AY 5/16 fix (NWT Phase 1 env 9 真测 surface, KI 第 N+10 次 retry-window-too-tight):
    // 15 retries × 1000ms (~30s) still too tight when J2 just spent UTXOs for KAS payment AND needs
    // fresh UTXO for paid_v1 broadcast (Kaspa coinbase maturity ~10s + propagation + mempool clear).
    // 真测 evidence: offer fec93476 sendKas 08:03:28 → paid_v1 broadcast 08:03:33 start →
    // 08:03:50 fail 15 attempts → offer stuck verifying. J2 UTXOs not mature within 15s window.
    // Fix: 30 retries × 2000ms base + 5s extra every 3rd = ~90s total (3x Kaspa maturity + buffer).
    let paidBroadcastOk = false;
    const MAX_BCAST_RETRIES = 30;
    for (let pa = 1; pa <= MAX_BCAST_RETRIES; pa++) {
      try {
        const pr = await sendCommandAsync(takerRelayNodeId, {
          type: 'send_broadcast',
          channel: 'kanet-exchange',
          message: paidMsg,
        });
        if (pr?.txId) { paidBroadcastOk = true; break; }
      } catch (err) {
        console.error(`[exchange-autosend] paid broadcast attempt ${pa}/${MAX_BCAST_RETRIES}: ${err.message}`);
      }
      if (pa < MAX_BCAST_RETRIES) {
        const baseMs = 2000;
        const extraMs = pa % 3 === 0 ? 5000 : 0;
        await new Promise(r => setTimeout(r, baseMs + extraMs));
      }
    }

    recordChainEvent({
      txid: txId,
      eventType: 'exchange_kas_sent',
      fromAddress: offer.taker,
      toAddress: offer.maker,
      payload: JSON.stringify({ offer_id: offer.id, amount, payment_tx: txId }),
    });

    if (!paidBroadcastOk) {
      // KAS sent but paid broadcast failed — do NOT advance state.
      // Maker node won't know about payment. Next proactive cycle or manual trigger can retry.
      console.error(`[exchange-autosend] paid broadcast failed after 5 attempts for offer ${offer.id.slice(0,8)} — state NOT advanced`);
      recordChainEvent({
        txid: txId,
        eventType: 'exchange_paid_broadcast_failed',
        fromAddress: offer.taker,
        payload: JSON.stringify({ offer_id: offer.id, payment_tx: txId, reason: 'broadcast_failed_5_attempts' }),
      });
      return;
    }

    console.log(`[exchange-autosettle] Broadcast kanet_exchange_paid_v1 for ${wantAsset}/${wantChain} payment`);

    // Broadcast succeeded — NOW safe to trigger verification
    processPaymentSubmit({ offer_id: offer.id, payment_tx: txId, payment_chain: wantChain });
    console.log(`[exchange-autosettle] verification triggered for offer ${offer.id.slice(0,8)}`);

  } catch (err) {
    console.error(`[exchange-autosend] Failed: ${err.message}`);
    recordChainEvent({
      eventType: 'exchange_kas_send_failed',
      fromAddress: offer.taker,
      payload: JSON.stringify({ offer_id: offer.id, error: err.message }),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Check if a KAS address belongs to a local relay node.
 */
function _findLocalRelay(kasAddress) {
  if (!kasAddress) return null;
  const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(kasAddress);
  return relay?.id || null;
}
