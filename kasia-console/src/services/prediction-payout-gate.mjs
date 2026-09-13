// prediction-payout-gate.mjs — (c) NO-TX-NO-STATE F2 · 预测派彩的 submit-intent + landed 门 (J2 2026-09-13,
// 设计 docs/2026-09-13-j2-no-tx-no-state-two-violations-and-landed-reconciler-design-v0.1.md v0.3 NWT PASS 29959d41 · Bettor 1044)。
//
// 之前(V2): settler 拿到 relay transfer 的 txId(= mempool submit 即回)就 transition('completed') + reputation 'paid' —— 无任何落链核实,
//   且 'delivering' 的 offer 不在 settler 的 SELECT 里, "留 delivering 下次 tick retry" 从未成立。
// 现在: submitPayoutIntent(幂等键 'payout:'+offer_id, 两阶段, 同字节重播) → completeIfLanded(check_utxo_landed minDepth=REORG_SAFE_MIN_DEPTH)
//   才 completed + 'paid'; sweepDeliveringPayouts 每 tick 扫 delivering 的预测 offer: submitted 的核落链, pending/prepared 的续发。
//
// 依赖注入(sendCmd / transitionFn): 本文件不 import relay-manager(M0a 门), 离线向量用假 sendCmd + 假 transition。
import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { transferWithIntent, checkIntentLanded, activeIntentForOffer, alertIntent } from '../lib/submit-intent.mjs';

const PAYOUT_NOT_LANDED_ALERT_AFTER_MS = 30 * 60 * 1000;
const PAYOUT_NOT_LANDED_ALERT_EVERY_MS = 60 * 60 * 1000;

function readMeta(offer) { try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; } }
function writeMeta(offerId, meta) {
  sqlite.prepare('UPDATE exchange_offers SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), new Date().toISOString(), offerId);
}

/** 递交派彩: intent 表先有行, 再 IPC; 回来的 txId 只是 submitted。metadata 记 payout_tx/payout_target/settle_outcome_phase='submitted'(UI 展示副本, 不作重试判据)。 */
export async function submitPayoutIntent({ sendCmd, relayId, offer, winnerAddr, amountKas, metaAfterDetect = null, origin = 'internal', log = console }) {
  const t = await transferWithIntent({ sendCmd, relayId, intentKind: 'payout', offerId: offer.id, targetAddress: winnerAddr, amountKas, origin, log });
  const meta = { ...(metaAfterDetect || readMeta(offer)), payout_tx: t.txId, payout_target: winnerAddr, payout_intent_key: t.intent.intent_key, settle_outcome_phase: 'submitted' };
  writeMeta(offer.id, meta);
  return { txId: t.txId, intent: t.intent, reused: !!t.reused, replayed: !!t.replayed };
}

/** landed 门: 落到 minDepth 才 completed + reputation 'paid' 恰一行(以 metadata.settle_outcome_phase 防重)。 */
export async function completeIfLanded({ sendCmd, transitionFn, offer, intent, minDepth, origin = 'internal', log = console }) {
  const cur = sqlite.prepare('SELECT id, protocol_status, metadata, maker_relay_id, maker FROM exchange_offers WHERE id = ?').get(offer.id);
  if (!cur) return { completed: false, reason: 'offer gone' };
  const meta = readMeta(cur);
  if (meta.settle_outcome_phase === 'paid' || cur.protocol_status === 'completed') return { completed: true, already: true };
  const r = await checkIntentLanded({ sendCmd, relayId: intent.relay_id, intent, minDepth, origin });
  if (!r.landed) {
    const submittedAgeMs = Date.now() - new Date(intent.updated_at).getTime();
    const lastAlert = meta.payout_not_landed_alerted_at ? new Date(meta.payout_not_landed_alerted_at).getTime() : 0;
    if (submittedAgeMs > PAYOUT_NOT_LANDED_ALERT_AFTER_MS && Date.now() - lastAlert > PAYOUT_NOT_LANDED_ALERT_EVERY_MS) {
      alertIntent('payout_not_landed', `payout ${intent.intent_key} txid ${String(intent.submitted_txid).slice(0, 12)} not landed after ${Math.round(submittedAgeMs / 60000)} min (depth ${r.depth ?? 'null'} < ${minDepth})`, { offer_id: offer.id, intent_key: intent.intent_key, txid: intent.submitted_txid, depth: r.depth });
      writeMeta(offer.id, { ...meta, payout_not_landed_alerted_at: new Date().toISOString() });
    }
    return { completed: false, depth: r.depth };
  }
  // landed ⇒ completed (protocol_status 只经 transition(), ABE-A.6) + reputation 'paid'
  const metaFinal = { ...meta, settle_outcome_phase: 'paid', payout_landed_depth: r.depth, payout_landed_at: new Date().toISOString() };
  transitionFn(offer.id, 'completed', { metadata: JSON.stringify(metaFinal) });
  const after = sqlite.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(offer.id);
  if (after?.protocol_status !== 'completed') {
    log.error(`[payout-gate] transition delivering→completed did not apply for ${offer.id.slice(0, 8)} (status ${after?.protocol_status}) — landed tx ${String(intent.submitted_txid).slice(0, 12)} recorded in submit_intents, manual DB review`);
    return { completed: false, reason: 'transition rejected' };
  }
  const makerRelayForLog = cur.maker_relay_id || cur.maker;
  const delta = Number(meta.settle_kas_delta);
  if (makerRelayForLog && Number.isFinite(delta)) {
    sqlite.prepare(`INSERT INTO prediction_reputation_log (id, maker_relay_id, event_type, settled_kas_delta, dispute_outcome, recorded_at) VALUES (?, ?, 'paid', ?, NULL, CURRENT_TIMESTAMP)`)
      .run(randomUUID(), makerRelayForLog, delta);
  }
  log.log(`[payout-gate] PAYOUT LANDED ${offer.id.slice(0, 8)}: txid ${String(intent.submitted_txid).slice(0, 12)} depth ${r.depth} ≥ ${minDepth} → completed + reputation 'paid'`);
  return { completed: true, depth: r.depth };
}

/**
 * 每 tick 扫 delivering 的预测 offer(legacy transfer 路, escrow_p2sh IS NULL):
 *   intent submitted ⇒ completeIfLanded; intent pending/prepared(进程在 IPC 中途死) ⇒ 续发(transferWithIntent 自己走 mempool/landed/重播判据)再核落链;
 *   无 intent(本补丁之前进入 delivering 的老行) ⇒ 只计数, 不动(没有幂等键就没有安全重发的依据)。
 */
export async function sweepDeliveringPayouts({ sendCmd, transitionFn, minDepth, origin = 'internal', log = console, limit = 50 }) {
  const rows = sqlite.prepare(`
    SELECT id, maker, maker_relay_id, metadata FROM exchange_offers
    WHERE (give_asset = 'prediction_outcome_share' OR want_asset = 'prediction_outcome_share')
      AND protocol_status = 'delivering' AND escrow_p2sh IS NULL
    ORDER BY updated_at ASC LIMIT ?
  `).all(limit);
  const out = { scanned: rows.length, completed: 0, waiting: 0, resent: 0, noIntent: 0, errored: 0 };
  for (const offer of rows) {
    try {
      let intent = activeIntentForOffer(offer.id, 'payout');
      if (!intent) { out.noIntent++; continue; }
      if (intent.status === 'pending' || intent.status === 'prepared') {
        const t = await transferWithIntent({ sendCmd, relayId: intent.relay_id, intentKind: 'payout', offerId: offer.id, targetAddress: intent.target_address, amountKas: intent.amount_kas, origin, log });
        intent = t.intent;
        if (!t.reused) out.resent++;
        const meta = readMeta(offer);
        writeMeta(offer.id, { ...meta, payout_tx: t.txId, payout_target: intent.target_address, payout_intent_key: intent.intent_key, settle_outcome_phase: 'submitted' });
      }
      const g = await completeIfLanded({ sendCmd, transitionFn, offer, intent, minDepth, origin, log });
      if (g.completed) out.completed++; else out.waiting++;
    } catch (e) {
      out.errored++;
      log.log(`[payout-gate] sweep ${offer.id.slice(0, 8)}: ${e.message}`);
    }
  }
  return out;
}
