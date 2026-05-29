// r177 Phase 2c (detect+mark) + Phase 2b (state-machine 集成) — prediction_outcome_share
// settlement settler.
//
// Owner 5/19 "go phase 2 直 fire 2c 不 UAT" + Bettor r197 0 push back (2c initial)
// Owner 5/19 "一气呵成 不停" + #286 立 fire (2b state-machine integration).
//
// 5min cron tick (prediction lifecycle 用 verifying/delivering — 都 in DB CHECK 约束):
//   matched → verifying (settler 一拿到 matched 立 transition; 表 oracle 验证中)
//   verifying (未 resolve) → 留 verifying 下次 tick
//   verifying (resolved) → delivering → completed (同 tick 串 transition, prediction 无真链 delivery)
// awaiting_oracle/awaiting_manual_confirm/verified 在 VALID_TRANSITIONS 但 DB CHECK 缺,
// 需 migration 加入 → 留 Phase 2b' 一起加 (跟 fund_lock prediction 分类 + 真链 payout 同步).
//
// transition() to 'completed' 触发 exchange-machine 内 spendFunds(offerId) (idempotent 安全;
// prediction Phase 1 publish 没 lock fund 所以 no-op) + DM taker (= UX 闭环 提示).
//
// 真链 KAS payout 真转账 (delivering→completed 钩 sendKas 给 winner) 留 Phase 2b' (~120 LOC
// stake escrow + fund_lock prediction 分类 + chain TX 真转), 跟 detect 解耦.

import { sqlite } from '../db/client.js';
import { randomUUID, createHash } from 'node:crypto';
import { verifyPredictionOutcome } from './bettor-prediction-verifier.js';
import { transition } from './exchange-machine.js';
import { sendCommandAsync } from './relay-manager.js';
import { getConfig } from '../data/settings/configs.js';

const TICK_INTERVAL_MS = 5 * 60 * 1000;  // 5 min
const STARTUP_GRACE_MS = 30 * 1000;       // 30s grace 让 Console boot 其他 cron 先稳

let timer = null;
let running = false;

export function startPredictionSettlerCron() {
  if (timer) return;
  console.log('[prediction-settler] started — 5min cron, settle expired prediction_outcome_share offers (Phase 2c detect+mark+log, payout 真链 Phase 2b)');
  setTimeout(() => {
    settlePredictionOutcomes().catch(e => console.error('[prediction-settler] startup catch-up:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    settlePredictionOutcomes().catch(e => console.error('[prediction-settler] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPredictionSettlerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function settlePredictionOutcomes() {
  if (running) {
    console.log('[prediction-settler] tick skipped (previous still running)');
    return { skipped: true };
  }
  running = true;
  try {
    // r177 Phase 2b: prediction lifecycle = matched → verifying → delivering → completed.
    // 用 verifying/delivering 都 in DB CHECK 约束 (跟 awaiting_oracle 不同, 后者 CHECK 缺失,
    // 需 v122 migration 才能 enable — 留 Phase 2b' 真链 payout 一起加).
    //   matched → verifying: settler 首次 tick detect (= "已 detect 过期, oracle 验证中")
    //   verifying (未 resolve) → 留 verifying 下次 tick
    //   verifying (resolved) → delivering → completed: 同 tick 串 transition (prediction 无真链 delivery)
    const offers = sqlite.prepare(`
      SELECT id, maker, maker_kaspa_addr, maker_relay_id, give_asset, give_amount, want_asset, want_amount, taker,
             outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
             outcome_end_date, outcome_oracle_hook, outcome_max_deviation_pp,
             outcome_oracle_relay_id, outcome_oracle_relay_ids, escrow_p2sh, resolution_rule_spec,
             broadcast_tx_id, taker_escrow_lock_tx, revote_round,
             published_price, protocol_status, metadata
      FROM exchange_offers
      WHERE (give_asset = 'prediction_outcome_share' OR want_asset = 'prediction_outcome_share')
        AND protocol_status IN ('matched','verifying','collecting_sigs')
        AND outcome_end_date IS NOT NULL
        AND datetime(outcome_end_date) <= datetime('now')
    `).all();
    if (!offers.length) return { ok: true, processed: 0 };

    let settled = 0, pending = 0, errored = 0;
    for (const offer of offers) {
      try {
        // matched → verifying 立 transition (= settler 已认领, 表 oracle 验证中)
        // Sub 8.3 Bug 18: refresh in-memory offer.protocol_status after transition (= dispatchPhase2OrCheckSigs checks it).
        if (offer.protocol_status === 'matched') {
          try {
            transition(offer.id, 'verifying');
            offer.protocol_status = 'verifying';  // in-memory refresh post DB transition
          } catch (e) {
            console.warn(`[prediction-settler] transition matched→verifying fail ${offer.id.slice(0,8)}: ${e.message}`);
          }
        }

        // r211 O-7 multi-oracle aggregation path (= Path D maker 自选 oracle):
        //   若 outcome_oracle_relay_id (legacy singular) OR outcome_oracle_relay_ids (Phase 4a plural) 设,
        //   走 collectMultiOracleVotes (= 收 5 vote DM from voter daemon, 5-of-5 unanimous).
        //   否则 fallback legacy verifyPredictionOutcome (= polymarket_uma_mirror 直接 Polymarket gamma)
        let r;
        if (offer.outcome_oracle_relay_id || offer.outcome_oracle_relay_ids) {
          r = await collectMultiOracleVotes(offer);
        } else {
          // r177 Phase 2a hotfix PB4: offer.maker_relay_id 直 from DB col (v122).
          // verifyPredictionOutcome 只用 outcome_* fields, 不查 whitelist — 这里 alias 已 cleanup.
          r = await verifyPredictionOutcome(offer);
        }
        if (!r.ok) {
          console.warn(`[prediction-settler] verify fail ${offer.id.slice(0, 8)}: ${r.reason}`);
          errored++;
          continue;
        }
        if (!r.resolved) { pending++; continue; }

        // r242 Phase 4a Sub 8 step 4 — Phase 2 dispatch if escrow_p2sh set (= SS trustless path).
        // 区分 Phase 3a 老 path (= trust-based escrow, 直 sendKaspa) vs Phase 4a path (= SS settle TX with 5 oracle sigs).
        if (offer.escrow_p2sh) {
          const phase2Result = await dispatchPhase2OrCheckSigs(offer, r.winner, sqlite);
          if (phase2Result.handled) {
            if (phase2Result.completed) settled++;
            else pending++;
            continue;
          }
          // Fall through 到 legacy path if dispatchPhase2OrCheckSigs returned not-handled (= 不期望, log)
          console.warn(`[settler] Phase 4a path fell through for offer ${offer.id.slice(0,12)}, fallback legacy`);
        }

        const winner = r.winner;  // 'YES' or 'NO'
        const makerWon = (offer.outcome_side === winner);
        const metaPrev = (() => {
          try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; }
        })();
        // r177 Phase 2b'.1 stake = (1 - price) × shares × (1/KAS_USD) (真 prediction math).
        // Phase 1 / 2 / 2a / 2b 时期写的 offer 没 metadata.stake_locked_kas, fallback want_amount (= wager math, legacy compat).
        const stakeKas = parseFloat(metaPrev.stake_locked_kas) || parseFloat(offer.want_amount) || 0;
        const settleKasDelta = makerWon ? stakeKas : -stakeKas;
        const metaAfterDetect = {
          ...metaPrev,
          settle_winner: winner,
          maker_outcome_side: offer.outcome_side,
          maker_won: makerWon,
          settle_kas_delta: settleKasDelta,
          settled_at: new Date().toISOString(),
        };

        // r177 Phase 2b'.2 真 KAS payout chain TX (Owner 5/19 "一气呵成" + Bettor r205/r206 共识 A1.a/A2.b):
        // verifying → delivering (settler 准 payout) → 真链 sendKas → completed.
        // winner_addr: maker_won = offer.maker_kaspa_addr (v123 双 col) || offer.maker (legacy fallback)
        //            : taker_won = offer.taker (kaspa addr, transition('matched') 时 set)
        // escrow_addr config + reverse-lookup relay_id (= relay 控 escrow 私钥) 走 sendCommandAsync transfer.
        try {
          transition(offer.id, 'delivering');
        } catch (e) {
          console.error(`[prediction-settler] transition verifying→delivering fail ${offer.id.slice(0,8)}: ${e.message}`);
          errored++;
          continue;
        }

        const winnerAddr = makerWon
          ? (offer.maker_kaspa_addr || offer.maker)
          : offer.taker;
        // r216 Bug surfaced: 之前 `startsWith('kaspa:')` 拒 testnet `kaspatest:` (= Phase 3a 真 round-trip 撞).
        // accept mainnet kaspa: + testnet-12 kaspatest: 双 prefix.
        if (!winnerAddr || !(String(winnerAddr).startsWith('kaspa:') || String(winnerAddr).startsWith('kaspatest:'))) {
          console.error(`[prediction-settler] payout target missing or invalid ${offer.id.slice(0,8)}: maker_won=${makerWon} winnerAddr=${winnerAddr}`);
          errored++;
          continue;  // 留 delivering, 下次 tick retry (Owner 介入 可能)
        }

        const escrowAddr = await getConfig('kanet_prediction_escrow_addr');
        const escrowRelay = escrowAddr ? sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(escrowAddr) : null;
        if (!escrowRelay) {
          console.error(`[prediction-settler] escrow config missing OR relay row not found ${offer.id.slice(0,8)}: escrowAddr=${escrowAddr}. Stay delivering, Owner action required.`);
          errored++;
          continue;
        }

        let payoutTxId = null;
        const PAYOUT_MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= PAYOUT_MAX_ATTEMPTS; attempt++) {
          try {
            const result = await sendCommandAsync(escrowRelay.id, {
              type: 'transfer',
              target: winnerAddr,
              amount: stakeKas.toFixed(8),  // KI-30: Kaspa sompi max 8 decimal precision
            });
            payoutTxId = result?.txId || null;
            if (payoutTxId) break;
            if (attempt < PAYOUT_MAX_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 5000));
          } catch (err) {
            console.error(`[prediction-settler] payout attempt ${attempt}/${PAYOUT_MAX_ATTEMPTS} fail ${offer.id.slice(0,8)}: ${err.message}`);
            if (attempt < PAYOUT_MAX_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 5000));
          }
        }
        if (!payoutTxId) {
          console.error(`[prediction-settler] payout chain TX exhausted 3 attempts ${offer.id.slice(0,8)} winner=${winnerAddr.slice(-12)} stake=${stakeKas.toFixed(4)} — stay delivering, next tick retry`);
          errored++;
          continue;  // 留 delivering, retry next tick (= 跟 exchange auto-deliver Bug-Z2 pattern 一致)
        }

        const metaFinal = JSON.stringify({
          ...metaAfterDetect,
          payout_tx: payoutTxId,
          payout_target: winnerAddr,
          settle_outcome_phase: 'paid',
        });
        try {
          transition(offer.id, 'completed', { metadata: metaFinal });
        } catch (e) {
          console.error(`[prediction-settler] transition delivering→completed fail (after payout TX ${payoutTxId.slice(0,12)}) ${offer.id.slice(0,8)}: ${e.message} — manual DB cleanup needed (chain TX done)`);
          errored++;
          continue;
        }
        // r177 Phase 2a hotfix PB4: 用 maker_relay_id (UUID) 写 reputation log.
        // r177 Phase 2b'.2: event_type='paid' 区分 detect-only vs 真链已 payout. (= 'settled' deprecated Phase 2b'.2 后)
        const makerRelayForLog = offer.maker_relay_id || offer.maker;
        if (makerRelayForLog) {
          sqlite.prepare(`INSERT INTO prediction_reputation_log (id, maker_relay_id, event_type, settled_kas_delta, dispute_outcome, recorded_at) VALUES (?, ?, 'paid', ?, NULL, CURRENT_TIMESTAMP)`)
            .run(randomUUID(), makerRelayForLog, settleKasDelta);
        }
        console.log(`[prediction-settler] PAYOUT ${offer.id.slice(0, 8)}: winner=${winner} addr=${winnerAddr.slice(-12)} stake=${stakeKas.toFixed(4)} KAS payout_tx=${payoutTxId.slice(0,12)}`);
        settled++;
        console.log(`[prediction-settler] settled ${offer.id.slice(0, 8)}: winner=${winner} maker_side=${offer.outcome_side} maker_won=${makerWon} delta=${settleKasDelta.toFixed(4)} KAS`);
      } catch (e) {
        console.error(`[prediction-settler] settle fail ${offer.id?.slice(0, 8)}: ${e.message}`);
        errored++;
      }
    }
    console.log(`[prediction-settler] tick: ${offers.length} expired, settled=${settled} pending=${pending} errored=${errored}`);
    return { ok: true, processed: offers.length, settled, pending, errored };
  } finally {
    running = false;
  }
}

// r242 Phase 4a Sub 8 step 4 — Phase 2 dispatch + check 10 TX sigs collected.
//   First call (= offer in 'verifying' state): dispatch Phase 2 DM 5 oracle TX-sig req → transition collecting_sigs.
//   Subsequent calls (= offer in 'collecting_sigs' state): check chain_events oracle_tx_sig rows for current round.
//   When 10 sigs collected (= 5 oracle × 2 inputs): assemble + submit settle TX via IPC.
//   Returns: { handled: bool, completed: bool }
async function dispatchPhase2OrCheckSigs(offer, winnerStr, db) {
  const winner = winnerStr === 'YES' ? 0 : (winnerStr === 'NO' ? 1 : null);
  if (winner === null) return { handled: false };  // DISPUTE not supported in settle (= 走 refund_both)
  const currentRound = offer.revote_round || 0;

  let meta;
  try { meta = JSON.parse(offer.metadata || '{}'); } catch { meta = {}; }

  // Sub 10.x SPOF recovery (J2 r53 NWT r64 align): same recovery wire as dispatchPhase2Consensual.
  // Apply before reading meta.redeem_script_hex which downstream uses.
  if (!meta.redeem_script_hex || !offer.escrow_p2sh) {
    try {
      const { recoverPredictionParams } = await import('./prediction-params-cache.js');
      const recovered = await recoverPredictionParams(offer.id);
      if (!recovered) {
        console.error(`[settler:dispute] SPOF recovery fail offer=${offer.id.slice(0, 12)} — no chain_event + no local cache`);
        return { handled: true, completed: false };
      }
      meta = { ...meta, ...recovered.ctor_params };
      // NWT r68 fix: recovered carries silverc-recompiled redeem_script_hex separately (= not in canonical payload)
      if (recovered.redeem_script_hex) meta.redeem_script_hex = recovered.redeem_script_hex;
      if (!offer.escrow_p2sh && (recovered.p2sh_addr || recovered.ctor_params.p2sh_addr)) {
        offer.escrow_p2sh = recovered.p2sh_addr || recovered.ctor_params.p2sh_addr;
      }
      try {
        db.prepare(`UPDATE exchange_offers SET metadata = ?, escrow_p2sh = COALESCE(escrow_p2sh, ?) WHERE id = ?`)
          .run(JSON.stringify(meta), offer.escrow_p2sh, offer.id);
      } catch (e) { console.warn(`[settler:dispute] recovered meta persist fail: ${e.message}`); }
      console.log(`[settler:dispute] SPOF recovery OK offer=${offer.id.slice(0, 12)} source=${recovered.source}`);
    } catch (e) {
      console.error(`[settler:dispute] SPOF recovery exception offer=${offer.id.slice(0, 12)}: ${e.message}`);
      return { handled: true, completed: false };
    }
  }

  if (offer.protocol_status === 'verifying') {
    // First Phase 2 dispatch — build preimage + DM 5 oracle TX-sig req + transition collecting_sigs
    // Sub 5b (Oracle v0.3 J1 #21 critical gap fix): outputs.length 2→7 align NWT sub 4 PredictionEscrowUnanimous5
    // settle_dispute: winner + broker + 5 oracle fee outputs + winner-binding explicit verify.
    try {
      const { sendCommandAsync } = await import('./relay-manager.js');
      const makerStake = parseInt(meta.maker_stake_sompi, 10) || 0;
      const takerStake = parseInt(meta.taker_stake_sompi, 10) || 0;
      const minerFee = parseInt(meta.miner_fee_sompi, 10) || 1_000_000;
      const brokerFeePct = parseInt(meta.broker_fee_pct, 10) || 0;
      const oracleFeePct = parseInt(meta.oracle_fee_pct, 10) || 100;  // sub 5b: default 1% (per Bettor r17 truth matrix)
      const spendable = BigInt(makerStake + takerStake - minerFee);
      const brokerFeeAmount = (spendable * BigInt(brokerFeePct)) / 10000n;
      const oracleFeeTotal = (spendable * BigInt(oracleFeePct)) / 10000n;
      const oraclePerSig = oracleFeeTotal / 5n;  // 5 oracle each gets oracleFeeTotal/5 (= floor)
      // J2 cross audit fix (sub 5b-1 vs NWT sub 4 SS): NWT SS distributableAmount = spendable - brokerFeeAmount - oracleFeeAmount (= 含余数, 余数 implicit minerFee).
      // 必跟 NWT SS 一致 (= SS require(tx.outputs[0].value == distributableAmount), J2 emit winnerAmount 必 byte-exact match).
      // oracleFeeTotal % 5 余数 (0-4 sompi) 不显式 output → kaspad 算 implicit minerFee (= 跟 W3 余数 maker pattern 不同, 这里余数 → miner 而非 stakeholder).
      const winnerAmount = spendable - brokerFeeAmount - oracleFeeTotal;
      const winnerAddr = winner === 0 ? offer.maker_kaspa_addr : offer.taker;
      const brokerRelayId = meta.broker_relay_id;
      const brokerRow = brokerRelayId ? db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(brokerRelayId) : null;
      const brokerAddr = brokerRow?.address;
      if (!winnerAddr || !brokerAddr) {
        console.error(`[settler] Phase 2 dispatch: missing winnerAddr or brokerAddr offer=${offer.id.slice(0,12)}`);
        return { handled: true, completed: false };
      }

      // Sub 5b: lookup 5 oracle addresses for oracle fee outputs (= sub 4 SS settle_dispute outputs[2..6])
      const oracleIds = JSON.parse(offer.outcome_oracle_relay_ids || '[]');
      if (oracleIds.length !== 5) {
        console.error(`[settler] Phase 2 dispatch: expected 5 oracle ids, got ${oracleIds.length} offer=${offer.id.slice(0,12)}`);
        return { handled: true, completed: false };
      }
      const oracleRows = db.prepare(`SELECT id, address FROM relay_nodes WHERE id IN (${oracleIds.map(() => '?').join(',')})`).all(...oracleIds);
      // Order oracle outputs by oracleIds (= match SS ctor oracleNPk[1..5] sequence per NWT sub 4)
      const oracleAddrsOrdered = oracleIds.map(oid => oracleRows.find(r => r.id === oid)?.address).filter(Boolean);
      if (oracleAddrsOrdered.length !== 5) {
        console.error(`[settler] Phase 2 dispatch: oracle address lookup incomplete, got ${oracleAddrsOrdered.length}/5 offer=${offer.id.slice(0,12)}`);
        return { handled: true, completed: false };
      }

      // Sub 5b outputs 7 (= NWT sub 4 settle_dispute outputs ordering):
      //   [0] winner + winnerAmount
      //   [1] broker + brokerFeeAmount
      //   [2..6] oracle 1..5 + oraclePerSig each
      const outputs = [
        { address: winnerAddr, amountSompi: winnerAmount.toString() },
        { address: brokerAddr, amountSompi: brokerFeeAmount.toString() },
        ...oracleAddrsOrdered.map(addr => ({ address: addr, amountSompi: oraclePerSig.toString() })),
      ];

      // Build preimage via relay IPC
      const preimage = await sendCommandAsync(offer.maker_relay_id, {
        type: 'prediction_settle_build_preimage',
        p2sh_address: offer.escrow_p2sh,
        required_input_outpoints: [
          { outpointTxid: offer.broadcast_tx_id, outpointIndex: 0 },
          { outpointTxid: offer.taker_escrow_lock_tx, outpointIndex: 0 },
        ],
        outputs,
      });
      if (!preimage?.ok || !preimage.tx_obj) {
        console.error(`[settler] Phase 2 build_preimage fail offer=${offer.id.slice(0,12)}: ${preimage?.error}`);
        return { handled: true, completed: false };
      }

      // Stash preimage + winner in metadata (= voter handler reads via offer scan)
      const newMeta = { ...meta, phase2_tx_obj: preimage.tx_obj, phase2_winner: winner, phase2_dispatched_at: new Date().toISOString() };
      db.prepare(`UPDATE exchange_offers SET metadata=? WHERE id=?`).run(JSON.stringify(newMeta), offer.id);

      // DM 5 oracle with kanet_oracle_tx_sign_req_v1 (= async, non-blocking)
      // NOTE: oracleIds already declared L272 above (= same fn scope). Reuse 不 redeclare.
      // Hotfix 5/26 13:00 KANet-UI — console boot SyntaxError 'Identifier oracleIds already declared'.
      const oracleAddrs = oracleIds.length > 0
        ? db.prepare(`SELECT id, address FROM relay_nodes WHERE id IN (${oracleIds.map(()=>'?').join(',')})`).all(...oracleIds)
        : [];
      const reqPayload = JSON.stringify({
        t: 'kanet_oracle_tx_sign_req_v1',
        offer_id: offer.id,
        revote_round: currentRound,
        winner,
        redeem_script_hash: createHash('sha256').update(meta.redeem_script_hex || '', 'hex').digest('hex'),
      });
      Promise.allSettled(oracleAddrs.map(o =>
        sendCommandAsync(offer.maker_relay_id, { type: 'send_message', target: o.address, message: reqPayload })
      )).catch(() => {});

      // Transition to collecting_sigs
      transition(offer.id, 'collecting_sigs');
      console.log(`[settler] Phase 4a Sub 8 Phase 2 dispatched offer=${offer.id.slice(0,12)} winner=${winnerStr} round=${currentRound}`);
      return { handled: true, completed: false };
    } catch (e) {
      console.error(`[settler] Phase 2 dispatch fail offer=${offer.id?.slice(0,12)}: ${e.message}`);
      return { handled: true, completed: false };
    }
  }

  if (offer.protocol_status === 'collecting_sigs') {
    // Check chain_events oracle_tx_sig rows for current round, assemble + submit if 10 collected
    const sigRows = db.prepare(`SELECT payload FROM chain_events WHERE event_type='oracle_tx_sig' AND to_address=? AND payload LIKE ?`)
      .all(offer.maker_kaspa_addr, `%"offer_id":"${offer.id}"%`);
    // Sigs MUST be ordered to match the redeem-script oracle pubkey order
    // (= outcome_oracle_relay_ids), NOT DB-row / voter-processing order. assembleScriptSig
    // (p2sh.mjs) concatenates the 5 sigs positionally and the silverc settle entrypoint checks
    // sig[i] against oracle pubkey[i]. Collecting in arrival order silently passes only when the
    // oracles' processing order happens to match the set order; a maker-invited oracle whose set
    // position differs from its row order breaks verification ("script ran, but verification failed").
    let oracleOrder = [];
    try { oracleOrder = JSON.parse(offer.outcome_oracle_relay_ids || '[]'); } catch {}
    const sigByOracleForInput = [new Map(), new Map()];
    for (const row of sigRows) {
      try {
        const p = JSON.parse(row.payload || '{}');
        if (p.t !== 'kanet_oracle_tx_sign_resp_v1') continue;
        const r = parseInt(p.revote_round, 10) || 0;
        if (r !== currentRound) continue;
        const inputIdx = parseInt(p.input_index, 10);
        if (inputIdx !== 0 && inputIdx !== 1) continue;
        if (sigByOracleForInput[inputIdx].has(p.voter_relay_id)) continue;
        sigByOracleForInput[inputIdx].set(p.voter_relay_id, p.signature);
      } catch {}
    }
    // Emit each input's sigs in redeem-script oracle order (undefined if any missing).
    const sigsByInput = [0, 1].map(i => oracleOrder.map(rid => sigByOracleForInput[i].get(rid)));
    if (oracleOrder.length !== 5 || sigsByInput.some(arr => arr.length !== 5 || arr.some(s => !s))) {
      // TODO Sub 8.1: timeout fallback (= 5 min no progress → refund_both eligible)
      return { handled: true, completed: false };
    }

    try {
      const { sendCommandAsync } = await import('./relay-manager.js');
      // Reconstruct outputs in {address, amountSompi} format (= unlockP2SHMultiSig expects this shape,
      // 不是 wasm-serialized {value, scriptPublicKey}. phase2_tx_obj.outputs 是 TransactionOutput 序列化 form 不通用).
      const makerStake = parseInt(meta.maker_stake_sompi, 10) || 0;
      const takerStake = parseInt(meta.taker_stake_sompi, 10) || 0;
      const minerFee = parseInt(meta.miner_fee_sompi, 10) || 1_000_000;
      const brokerFeePct = parseInt(meta.broker_fee_pct, 10) || 0;
      const spendable = BigInt(makerStake + takerStake - minerFee);
      const brokerFeeAmount = (spendable * BigInt(brokerFeePct)) / 10000n;
      const winnerAmount = spendable - brokerFeeAmount;
      const winnerAddr = meta.phase2_winner === 0 ? offer.maker_kaspa_addr : offer.taker;
      const brokerRow = meta.broker_relay_id ? sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(meta.broker_relay_id) : null;
      const brokerAddr = brokerRow?.address;
      if (!winnerAddr || !brokerAddr) {
        console.error(`[settler] Phase 4a Sub 8 settle: missing winnerAddr or brokerAddr offer=${offer.id.slice(0,12)}`);
        return { handled: true, completed: false };
      }
      const submitResult = await sendCommandAsync(offer.maker_relay_id, {
        type: 'prediction_settle_tx',
        p2sh_address: offer.escrow_p2sh,
        redeem_script_hex: meta.redeem_script_hex,
        required_input_outpoints: [
          { outpointTxid: offer.broadcast_tx_id, outpointIndex: 0 },
          { outpointTxid: offer.taker_escrow_lock_tx, outpointIndex: 0 },
        ],
        outputs: [
          { address: winnerAddr, amountSompi: winnerAmount.toString() },
          { address: brokerAddr, amountSompi: brokerFeeAmount.toString() },
        ],
        sigs_by_input: sigsByInput,
        winner: meta.phase2_winner,
        tx_obj_preimage: meta.phase2_tx_obj,  // Sub 8.2 Bug 14: voter's exact tx_obj for byte-identical sighash
      });
      if (!submitResult?.ok || !submitResult.txId) {
        console.error(`[settler] Phase 4a Sub 8 settle submit fail offer=${offer.id.slice(0,12)}: ${submitResult?.error}`);
        return { handled: true, completed: false };
      }

      db.prepare(`UPDATE exchange_offers SET settle_txid=? WHERE id=?`).run(submitResult.txId, offer.id);
      transition(offer.id, 'completed');
      console.log(`[settler] Phase 4a Sub 8 SETTLE COMPLETED offer=${offer.id.slice(0,12)} settle_txid=${submitResult.txId.slice(0,16)} winner=${meta.phase2_winner}`);
      return { handled: true, completed: true };
    } catch (e) {
      console.error(`[settler] Phase 4a Sub 8 settle assemble fail offer=${offer.id?.slice(0,12)}: ${e.message}`);
      return { handled: true, completed: false };
    }
  }

  return { handled: false };
}

/**
 * Sub 5b-2 (Oracle v0.3 R7 J1 #21 critical gap) — settle_consensual dispatch path.
 *
 * Per NWT sub 4 SS settle_consensual entry shape (= PredictionEscrowUnanimous5.sil):
 *   - signed by maker + taker (= 2 sig, 0 oracle涉)
 *   - outputs.length 2: [winner, broker] (= 跟 settle_dispute 7 outputs 区分)
 *   - winner-binding explicit verify (= J1 #2 C1 fix)
 *   - broker fee 1% per truth matrix (= NOT carved from broker, 是 user 付 fee)
 *
 * Trigger: broker DM 收双方 confirm → broker calls this OR direct API.
 * Emits chain_event 'pool_settle_consensual_dispatched' → sub 3 voter v2 skip detect 真依赖.
 *
 * Per J2-tn r9 + J1 #2 C2: 0 oracle work, 0 oracle reward, audit_mode='consensual' row in oracle_history.
 *
 * @param {object} offer — exchange_offers row (= 1V1 escrow)
 * @param {number} winner — 0=maker won OR 1=taker won (= both party signed agreement)
 * @param {Database} db
 * @returns {{handled, completed, txId?}}
 */
export async function dispatchPhase2Consensual(offer, winner, db = sqlite) {
  let meta;
  try { meta = JSON.parse(offer.metadata || '{}'); } catch { meta = {}; }

  // Sub 10.x SPOF recovery (J2 r53 NWT r64 align): if meta.redeem_script_hex missing OR escrow_p2sh missing,
  // attempt recovery from chain_event (canonical) → local_cache (fallback). Recovered params recompile via
  // silverc and assert P2SH match before continuing. Skip if all params present (= normal hot path).
  if (!meta.redeem_script_hex || !offer.escrow_p2sh) {
    try {
      const { recoverPredictionParams } = await import('./prediction-params-cache.js');
      const recovered = await recoverPredictionParams(offer.id);
      if (!recovered) {
        console.error(`[settler:consensual] SPOF recovery fail offer=${offer.id.slice(0, 12)} — no chain_event + no local cache`);
        return { handled: true, completed: false };
      }
      // Merge recovered fields into meta + offer.escrow_p2sh for downstream code
      meta = { ...meta, ...recovered.ctor_params };
      // NWT r68 fix: recovered carries silverc-recompiled redeem_script_hex separately (= not in canonical payload)
      if (recovered.redeem_script_hex) meta.redeem_script_hex = recovered.redeem_script_hex;
      if (!offer.escrow_p2sh && (recovered.p2sh_addr || recovered.ctor_params.p2sh_addr)) {
        offer.escrow_p2sh = recovered.p2sh_addr || recovered.ctor_params.p2sh_addr;
      }
      // Persist recovered meta back to offer (= future ticks 不 重 recover)
      try {
        db.prepare(`UPDATE exchange_offers SET metadata = ?, escrow_p2sh = COALESCE(escrow_p2sh, ?) WHERE id = ?`)
          .run(JSON.stringify(meta), offer.escrow_p2sh, offer.id);
      } catch (e) { console.warn(`[settler:consensual] recovered meta persist fail: ${e.message}`); }
      console.log(`[settler:consensual] SPOF recovery OK offer=${offer.id.slice(0, 12)} source=${recovered.source}`);
    } catch (e) {
      console.error(`[settler:consensual] SPOF recovery exception offer=${offer.id.slice(0, 12)}: ${e.message}`);
      return { handled: true, completed: false };
    }
  }

  // Sub 5d hotfix (J2 r45 NWT catch): state machine requires matched → verifying → collecting_sigs path.
  // VALID_TRANSITIONS: matched → [verifying,...]; verifying → [...collecting_sigs...]; matched → collecting_sigs FAILS.
  // Hop through verifying if currently in matched.
  if (offer.protocol_status === 'matched') {
    try {
      transition(offer.id, 'verifying');
      offer.protocol_status = 'verifying';
    } catch (e) {
      console.error(`[settler:consensual] matched → verifying transition fail offer=${offer.id.slice(0,12)}: ${e.message}`);
      return { handled: true, completed: false };
    }
  }

  try {
    const { sendCommandAsync } = await import('./relay-manager.js');
    const makerStake = parseInt(meta.maker_stake_sompi, 10) || 0;
    const takerStake = parseInt(meta.taker_stake_sompi, 10) || 0;
    const minerFee = parseInt(meta.miner_fee_sompi, 10) || 1_000_000;
    const brokerFeePct = parseInt(meta.broker_fee_pct, 10) || 100;  // default 1%
    const spendable = BigInt(makerStake + takerStake - minerFee);
    const brokerFeeAmount = (spendable * BigInt(brokerFeePct)) / 10000n;
    const winnerAmount = spendable - brokerFeeAmount;
    const winnerAddr = winner === 0 ? offer.maker_kaspa_addr : offer.taker;
    const brokerRelayId = meta.broker_relay_id;
    const brokerRow = brokerRelayId ? db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(brokerRelayId) : null;
    const brokerAddr = brokerRow?.address;

    if (!winnerAddr || !brokerAddr) {
      console.error(`[settler:consensual] missing winnerAddr or brokerAddr offer=${offer.id.slice(0,12)}`);
      return { handled: true, completed: false };
    }

    // settle_consensual outputs (= 2, 跟 settle_dispute 7 区分):
    const outputs = [
      { address: winnerAddr, amountSompi: winnerAmount.toString() },
      { address: brokerAddr, amountSompi: brokerFeeAmount.toString() },
    ];

    // Build preimage via relay IPC (= settle_consensual entry sighash)
    const preimage = await sendCommandAsync(offer.maker_relay_id, {
      type: 'prediction_settle_consensual_build_preimage',  // NEW handler — pending kasia-relay impl (= sub 5b-2 follow-up)
      p2sh_address: offer.escrow_p2sh,
      required_input_outpoints: [
        { outpointTxid: offer.broadcast_tx_id, outpointIndex: 0 },
        { outpointTxid: offer.taker_escrow_lock_tx, outpointIndex: 0 },
      ],
      outputs,
      winner,  // 0 or 1, signed by both parties per settle_consensual entry param
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[settler:consensual] build_preimage fail offer=${offer.id.slice(0,12)}: ${preimage?.error}`);
      return { handled: true, completed: false, step: 'build_preimage', error: preimage?.error || 'no error in response' };
    }

    // Stash preimage + winner in metadata (= maker_sign + taker_sign handler reads via offer scan)
    const newMeta = { ...meta, consensual_tx_obj: preimage.tx_obj, consensual_winner: winner, consensual_dispatched_at: new Date().toISOString() };
    db.prepare(`UPDATE exchange_offers SET metadata=? WHERE id=?`).run(JSON.stringify(newMeta), offer.id);

    // Emit chain_event 'pool_settle_consensual_dispatched' → sub 3 voter v2 skip detect 真依赖 + sub 5 oracle_history consensual row write trigger
    try {
      const { recordChainEvent } = await import('./chain-event.js');
      recordChainEvent({
        txid: `consensual_dispatched:${offer.id.slice(0,12)}:${Date.now()}`,
        eventType: 'pool_settle_consensual_dispatched',
        fromAddress: offer.maker_kaspa_addr || null,
        toAddress: offer.taker || null,
        payload: JSON.stringify({
          offer_id: offer.id,
          market_id: offer.id,  // 1V1 escrow uses offer.id as market_id key (= cross-product unified key)
          winner,
          winner_addr: winnerAddr,
          broker_fee_amount: brokerFeeAmount.toString(),
          winner_amount: winnerAmount.toString(),
          dispatched_at: new Date().toISOString(),
          epoch: 1,
        }),
      });
    } catch (e) {
      console.warn(`[settler:consensual] chain_event emit fail for offer ${offer.id.slice(0,12)}: ${e.message}`);
    }

    transition(offer.id, 'collecting_sigs');  // reuse status state machine (= 2 sig vs 5+5+5+5+5 sig, transition same)
    console.log(`[settler:consensual] dispatched offer=${offer.id.slice(0,12)} winner=${winner}`);

    // Sub 5d (J2 r43 ship) — sign exchange + settle TX submit in-process for same-host case.
    // Both maker_relay + taker_relay 在 same Console host → IPC sign 同步 collect + assemble + submit.
    // Cross-host (= taker_relay on different Console) 留 v2 next cycle (= DM via chain_event).
    const takerRelayId = meta.taker_relay_id;
    if (!takerRelayId) {
      console.log(`[settler:consensual] no taker_relay_id in metadata — sub 5d v1 requires same-host. v2 cross-host DM 留 next cycle. offer=${offer.id.slice(0,12)}`);
      return { handled: true, completed: false };
    }

    try {
      // Sign each input with maker_relay + taker_relay (= 2 sigs per input, 2 inputs = 4 sig IPC)
      const sigsByInput = [[], []];
      for (let inputIdx = 0; inputIdx < 2; inputIdx++) {
        // maker sig
        const makerSigRes = await sendCommandAsync(offer.maker_relay_id, {
          type: 'sign_input_for_settle',
          tx_hex: JSON.stringify(preimage.tx_obj),  // schema requires tx_hex, handler L538 parses back
          input_index: inputIdx,
        });
        if (!makerSigRes?.ok || !makerSigRes.signature) {
          console.error(`[settler:consensual] maker sign input ${inputIdx} fail offer=${offer.id.slice(0,12)}: ${makerSigRes?.error}`);
          return { handled: true, completed: false, step: `maker_sign_${inputIdx}`, error: makerSigRes?.error || 'no error in response' };
        }
        // taker sig
        const takerSigRes = await sendCommandAsync(takerRelayId, {
          type: 'sign_input_for_settle',
          tx_hex: JSON.stringify(preimage.tx_obj),
          input_index: inputIdx,
        });
        if (!takerSigRes?.ok || !takerSigRes.signature) {
          console.error(`[settler:consensual] taker sign input ${inputIdx} fail offer=${offer.id.slice(0,12)}: ${takerSigRes?.error}`);
          return { handled: true, completed: false, step: `taker_sign_${inputIdx}`, error: takerSigRes?.error || 'no error in response' };
        }
        // Order: maker_sig first then taker_sig (= .sil source order: checkSig(makerSig) before checkSig(takerSig))
        sigsByInput[inputIdx] = [makerSigRes.signature, takerSigRes.signature];
      }

      // Assemble + submit settle_consensual TX via prediction_settle_consensual_tx IPC
      const submitRes = await sendCommandAsync(offer.maker_relay_id, {
        type: 'prediction_settle_consensual_tx',
        p2sh_address: offer.escrow_p2sh,
        redeem_script_hex: meta.redeem_script_hex,
        required_input_outpoints: [
          { outpointTxid: offer.broadcast_tx_id, outpointIndex: 0 },
          { outpointTxid: offer.taker_escrow_lock_tx, outpointIndex: 0 },
        ],
        outputs: [
          { address: winnerAddr, amountSompi: winnerAmount.toString() },
          { address: brokerAddr, amountSompi: brokerFeeAmount.toString() },
        ],
        sigs_by_input: sigsByInput,
        winner,
        tx_obj_preimage: preimage.tx_obj,
      });
      if (!submitRes?.ok || !submitRes.txId) {
        console.error(`[settler:consensual] settle TX submit fail offer=${offer.id.slice(0,12)}: ${submitRes?.error}`);
        return { handled: true, completed: false, step: 'submit', error: submitRes?.error || 'no error in response' };
      }

      db.prepare(`UPDATE exchange_offers SET settle_txid=? WHERE id=?`).run(submitRes.txId, offer.id);
      transition(offer.id, 'completed');
      console.log(`[settler:consensual] SETTLE COMPLETED offer=${offer.id.slice(0,12)} settle_txid=${submitRes.txId.slice(0,16)} winner=${winner}`);
      return { handled: true, completed: true, txId: submitRes.txId };
    } catch (e) {
      console.error(`[settler:consensual] sign+submit fail offer=${offer.id.slice(0,12)}: ${e.message}`);
      return { handled: true, completed: false, step: 'sign_submit_catch', error: e.message };
    }
  } catch (e) {
    console.error(`[settler:consensual] dispatch fail offer=${offer.id?.slice(0,12)}: ${e.message}`);
    return { handled: true, completed: false, step: 'outer_catch', error: e.message };
  }
}

// r234 Sub 5 collectMultiOracleVotes — 5-of-5 unanimous + revote + misbehave + auto-pause.
//
// v2 (= Phase 4a r234): Path D + PB-D consensus + Owner 钦定 5-of-5 unanimous (= 一票否决).
//   收 voter daemon DM (= kanet_oracle_vote_v1) via chain_events 'oracle_vote' to maker_kaspa_addr.
//   REQUIRED_SIGS=5 + outcomes 必一致 → declare winner (= 不再 3-of-5 majority).
//   分歧 (= 任 1 oracle 不一致) → trigger revote (= round < MAX) OR 留 verifying (= round 满 → deadline 后 refund).
//   misbehave_count++ on non-majority voters + auto-pause at 3.
//
// dependency: payload 必含 revote_round field (= Sub 6 voter sign 时加, filter 当前 round votes).
//
// Bettor r234 reviewer 加固 默认 (= J1 implementation):
//   - majority tie-break: DISPUTE (= 不 arbitrary 选 YES, 平票 = ambiguous)
//   - misbehave++ scope: 仅 non-majority voters (= dissenting from consensus)
//   - MAX_REVOTE_ROUNDS=2 (= J1 #343 PB-1)
//   - auto-pause threshold: misbehave_count >= 3 (= J1 #343 PB-5)
export async function collectMultiOracleVotes(offer, db = sqlite) {
  if (!offer.maker_kaspa_addr) {
    return { ok: false, reason: 'missing maker_kaspa_addr (= aggregator target)' };
  }
  const votes = db.prepare(`
    SELECT id, from_address, payload, observed_at
    FROM chain_events
    WHERE event_type = 'oracle_vote'
      AND to_address = ?
      AND payload LIKE ?
  `).all(offer.maker_kaspa_addr, `%"offer_id":"${offer.id}"%`);

  if (!votes.length) {
    return { ok: false, reason: 'no oracle votes received yet' };
  }

  // Parse + filter votes for current revote round (= 防 旧 round vote 蒙混 进新 round tally)
  // r235 PB-S6-3 加: ECDSA sig verify (= 防 attacker 注假 oracle_vote chain_events row).
  const REQUIRED_SIGS = 5;
  const MAX_REVOTE_ROUNDS = 2;
  const currentRound = offer.revote_round || 0;
  const tally = { YES: 0, NO: 0, DISPUTE: 0 };
  const voters = new Map();  // voter_relay_id → outcome
  let kaspa = null;  // lazy load
  for (const v of votes) {
    try {
      const p = JSON.parse(v.payload || '{}');
      if (p.t !== 'kanet_oracle_vote_v1') continue;
      // r234 加: filter by revote_round (= 旧 round vote 不算 当前 round)
      const voteRound = parseInt(p.revote_round, 10) || 0;
      if (voteRound !== currentRound) continue;
      // dedupe per voter (= same voter multi-vote in same round, take first)
      if (voters.has(p.voter_relay_id)) continue;

      // r235 PB-S6-3 sig verify: reject vote 假 sig OR placeholder (= Phase 3a "phase3a_skeleton" 不接受 Phase 4a).
      if (!p.signature || p.signature === 'phase3a_skeleton') {
        console.warn(`[settler] vote rejected: missing or placeholder sig, voter=${p.voter_relay_id?.slice(0,8)} offer=${offer.id.slice(0,8)}`);
        continue;
      }
      if (!p.voter_pubkey || p.voter_pubkey.length !== 64) {
        console.warn(`[settler] vote rejected: invalid voter_pubkey, voter=${p.voter_relay_id?.slice(0,8)}`);
        continue;
      }
      try {
        if (!kaspa) kaspa = await import('kaspa-wasm');
        // Reconstruct canonical message (= voter signed JSON without signature field)
        const { signature, ...unsigned } = p;
        const message = JSON.stringify(unsigned);
        // verifyMessage expects PublicKey or hex string; x-only is 32-byte hex
        const valid = kaspa.verifyMessage({ message, signature, publicKey: p.voter_pubkey });
        if (!valid) {
          console.warn(`[settler] vote sig INVALID voter=${p.voter_relay_id?.slice(0,8)} offer=${offer.id.slice(0,8)}`);
          continue;
        }
      } catch (verifyErr) {
        console.warn(`[settler] vote sig verify error voter=${p.voter_relay_id?.slice(0,8)}: ${verifyErr.message}`);
        continue;
      }

      voters.set(p.voter_relay_id, p.outcome);
      if (tally[p.outcome] !== undefined) tally[p.outcome]++;
    } catch {}
  }

  // 5-of-5 unanimous check (= Owner 钦定 一票否决)
  if (voters.size < REQUIRED_SIGS) {
    return { ok: true, resolved: false, reason: 'waiting more votes', voters: voters.size, required: REQUIRED_SIGS, round: currentRound };
  }
  const outcomes = new Set([...voters.values()]);
  if (outcomes.size === 1) {
    const winner = [...outcomes][0];
    return { ok: true, resolved: true, winner, votes_yes: tally.YES, votes_no: tally.NO, total_voters: voters.size, round: currentRound };
  }

  // Dissent (= 不一致) → 触发 revote round + misbehave 累加 + auto-pause
  // Majority outcome (= 多数派, tie → DISPUTE default = ambiguous flag)
  let majority = 'DISPUTE';
  const maxCount = Math.max(tally.YES, tally.NO, tally.DISPUTE);
  const topCount = [tally.YES, tally.NO, tally.DISPUTE].filter(c => c === maxCount).length;
  if (topCount === 1) {
    majority = tally.YES === maxCount ? 'YES' : (tally.NO === maxCount ? 'NO' : 'DISPUTE');
  }
  // misbehave_count++ for non-majority voters (= dissent from consensus). Tie → 全 dissent (= 无 majority).
  for (const [voterRelayId, outcome] of voters) {
    if (outcome === majority) continue;
    db.prepare(`UPDATE relay_nodes SET voter_misbehave_count = voter_misbehave_count + 1 WHERE id = ?`).run(voterRelayId);
    const newCount = db.prepare(`SELECT voter_misbehave_count FROM relay_nodes WHERE id = ?`).get(voterRelayId)?.voter_misbehave_count;
    if (newCount >= 3) {
      // [ABE-A.6] is_oracle 是 relay attribute 不是 protocol_status, 直 UPDATE allowed.
      db.prepare(`UPDATE relay_nodes SET is_oracle = 0 WHERE id = ?`).run(voterRelayId);
      console.warn(`[settler] voter ${voterRelayId.slice(0,8)} auto-paused (misbehave_count=${newCount} >= 3, dissent on offer ${offer.id.slice(0,12)} round ${currentRound})`);
    }
  }

  if (currentRound < MAX_REVOTE_ROUNDS) {
    // 触发 next revote round (= UPDATE revote_round++, voter daemon scan 下 tick 自然 catch)
    db.prepare(`UPDATE exchange_offers SET revote_round = revote_round + 1 WHERE id = ?`).run(offer.id);
    console.log(`[settler] dissent on offer ${offer.id.slice(0,12)} round ${currentRound} → trigger revote round ${currentRound + 1}, majority=${majority}, dissenters=${voters.size - tally[majority] || 0}`);

    // r236 Sub 7 dispatchRevoteDM (= cross-host scenario, maker_relay → 5 oracle 主动通知).
    // 同一 console: voter cron 下 tick 自动 scan 新 revote_round → 重 vote. DM 是冗余但 useful for cross-host.
    // Single-tx 不重复发: 仅在 revote_round 真 changed 时 dispatch (= 跟 settler 的 UPDATE 同一时机).
    try {
      const oracleRelayIdsStr = offer.outcome_oracle_relay_ids;
      if (oracleRelayIdsStr && offer.maker_relay_id) {
        const oracleRelayIds = JSON.parse(oracleRelayIdsStr);
        const placeholders = oracleRelayIds.map(() => '?').join(',');
        const oracles = db.prepare(`SELECT id, address FROM relay_nodes WHERE id IN (${placeholders})`).all(...oracleRelayIds);
        const revotePayload = JSON.stringify({
          t: 'kanet_oracle_revote_v1',
          offer_id: offer.id,
          new_round: currentRound + 1,
          previous_round_tally: tally,
          deadline_warning: offer.outcome_end_date,
        });
        // dispatch via maker_relay (= async, non-blocking). 不 sendCommandAsync 阻塞 settler tick.
        // Use Promise.allSettled — 失 oracle DM 不影响 settler 继续.
        Promise.allSettled(oracles.map(o =>
          sendCommandAsync(offer.maker_relay_id, { type: 'send_message', target: o.address, message: revotePayload })
        )).then(results => {
          const okCount = results.filter(r => r.status === 'fulfilled').length;
          console.log(`[settler] revote DM dispatched offer=${offer.id.slice(0,12)} round=${currentRound + 1}: ${okCount}/${oracles.length} sent`);
        }).catch(e => console.error(`[settler] revote DM dispatch fail: ${e.message}`));
      }
    } catch (dmErr) {
      console.warn(`[settler] revote DM build fail (revote_round still bumped, voter cron next tick will catch): ${dmErr.message}`);
    }

    return { ok: true, resolved: false, dissent: true, round: currentRound, next_round: currentRound + 1, majority, tally };
  }

  // Round 满 (= MAX_REVOTE_ROUNDS done) 仍分歧 → 留 verifying, deadline 后 refund_both
  console.log(`[settler] dissent on offer ${offer.id.slice(0,12)} round ${currentRound} max done → deadline refund_both`);
  return { ok: true, resolved: false, dissent_max_rounds: true, round: currentRound, reason: 'oracle 分歧 max revote rounds 仍未一致, 等 deadline → refund_both', majority, tally };
}
