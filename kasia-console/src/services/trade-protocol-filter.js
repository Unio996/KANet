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
import { createOrder, transition, getOrder, linkOrders } from './order-machine.js';
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
export { _executeHedge as executeHedge };
export { _autoPayExchange as triggerAutoPay, _autoSettleAsset, _autoSettleAsset as _autoSendKas };

export async function onBroadcastWritten(row) {
  // Pre-filter to skip non-protocol broadcasts cheaply (full JSON.parse only if prefix match).
  // Bettor r97 J2 consumer half: pool_oracle_vote_v1 payload starts with "pool_" not "kanet_",
  // so widen prefix check. Adds ~1ns cost per non-matching broadcast vs prevents silent skip
  // of the entire new pool flow (= KI 49 silent skip pattern that bit voter ingest before).
  if (!row.content) return;
  // J2-tn r301 Path A: add `oracle_` prefix for `oracle_stake_enroll_v1` envelope ingest.
  if (!row.content.startsWith('{"t":"kanet_')
      && !row.content.startsWith('{"t":"pool_')
      && !row.content.startsWith('{"t":"oracle_')) return;

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
      case 'kanet_sell_v1':
      case 'kanet_buy_v1':
        await handleOrder(msg); break;
      case 'kanet_accept_v1':
        await handleAccept(msg); break;
      case 'kanet_paid_v1':
        await handlePaid(msg); break;
      case 'kanet_delivered_v1':
        await handleDelivered(msg); break;
      case 'kanet_cancel_v1':
        await handleCancel(msg); break;
      case 'kanet_timeout_v1':
        await handleTimeout(msg); break;
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
      case 'kanet_prediction_params_v1':
        await handlePredictionParams(msg); break;
      case 'pool_oracle_vote_v1':
        await handlePoolOracleVote(msg); break;  // Bettor r97 J2 consumer: 跨节点 oracle vote ingest
      case 'pool_market_published_v1':
        await handlePoolMarketPublished(msg); break;  // Bettor r117/r118/r120 ② consumer: market_publish
      case 'pool_bet_registered_v1':
        await handlePoolBetRegistered(msg); break;  // Bettor r113/r117/r120 ② consumer: bet_register
      case 'pool_market_chunk_v1':
        await handlePoolMarketChunk(msg); break;  // Bettor r128/r129 + J1 e67c9328 chunked v1
      case 'pool_market_settled_v1':
        await handlePoolMarketSettled(msg); break;  // J2-tn r418 (Bettor r428 关1): cross-node settle sync push
      case 'oracle_stake_enroll_v1':
        await handleOracleStakeEnroll(msg); break;  // J2-tn r301 Path A: cross-node enrollment ingest
      case 'oracle_stake_withdraw_v1':
        await handleOracleStakeWithdraw(msg); break;  // 问3 (a): cross-node-convergent oracle 撤出 (active=0 on all nodes)
      case 'kanet_pool_oracle_tx_sign_resp_v1':
        await handlePoolOracleTxSignResp(msg); break;  // J2-tn r374 (Bettor 15:02 catch): cross-node sign_resp ingest
      case 'kanet_pool_oracle_tx_sign_req_v1':
        await handlePoolOracleTxSignReq(msg); break;  // J1tn r361 (Bettor 15:05 钦定): cross-node sign_req trigger
    }
  } catch (err) {
    console.error(`[trade-filter] Error processing ${msg.t}: ${err.message}`);
  }
}

// ── Handlers ──────────────────────────────────────────────────

// Bettor r95/r97 J2 consumer half: cross-node oracle vote ingest.
// Producer (J1 r166 bbaea95): voter broadcasts kanet-prediction channel w/ pool_oracle_vote_v1 payload
// + REAL Kaspa txid. Same producer node ALSO direct-INSERTs chain_events 'pool_oracle_vote'.
// Consumer (THIS handler): on ANY node receiving the broadcast, re-INSERT the same chain_event
// row (same txid → INSERT OR IGNORE 幂等), so settler decideConsensus on remote nodes picks
// up the vote identical to producer.
//
// Verification (跨节点防伪造):
// 1. market_id exists in local pool_markets (= skip if we don't know this market)
// 2. voter_pubkey 真在 market.oracle_relay_ids assigned oracle set
// 3. signature 真验 (kaspa.verifyMessage 跟 prediction-params-cache 同款)
//
// Same-node case (producer + consumer on same Console, broadcast fires onBroadcastWritten locally):
// the producer's direct INSERT already wrote the row; this handler's INSERT OR IGNORE no-ops.
// J2-tn r402 P0-#3 (Bettor r290b+r291b 关1 PASS): cross-node maker refund handler.
// settler broadcasts pool_refund_request_v1 for 0-bet cross-node markets when local maker is sentinel.
// Producer node (where real maker_relay_id lives) ingests this msg, verifies local maker_pk match,
// and triggers dispatchRefund using real local relay. Idempotent: skip if refund_dispatched_at set.
async function handlePoolRefundRequest(msg) {
  if (!msg.market_id || !msg.maker_pk) {
    console.warn(`[trade-filter:pool-refund-req] msg missing fields market=${msg.market_id?.slice(0,12)} maker_pk=${msg.maker_pk?.slice(0,12)}`);
    return;
  }
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(msg.market_id);
  if (!market) {
    console.warn(`[trade-filter:pool-refund-req] unknown market=${msg.market_id?.slice(0,12)} — skip`);
    return;
  }
  // Producer check: market.maker_relay_id must be real UUID (= local relay), not cross-node sentinel.
  const isCrossNode = typeof market.maker_relay_id === 'string' && market.maker_relay_id.startsWith('cross-node:');
  if (isCrossNode) {
    // 我也是 consumer 节点 (= 不是 producer). 我不能 refund. Drop.
    console.log(`[trade-filter:pool-refund-req] market=${msg.market_id.slice(0,12)} I am also cross-node consumer — drop`);
    return;
  }
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  if (meta.refund_dispatched_at) {
    console.log(`[trade-filter:pool-refund-req] market=${msg.market_id.slice(0,12)} already refund_dispatched_at=${meta.refund_dispatched_at} — skip idempotent`);
    return;
  }
  // Verify msg.maker_pk matches local market's maker (= producer authority check).
  try {
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address) {
      const { deriveXOnlyPubkey } = await import('../api/pool.js').catch(() => ({}));
      // deriveXOnlyPubkey is private; recompute inline via kaspa-wasm.
      const kaspa = await import('kaspa-wasm');
      const localMakerPk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(makerRow.address)).toString();
      if (String(localMakerPk).toLowerCase() !== String(msg.maker_pk).toLowerCase()) {
        console.warn(`[trade-filter:pool-refund-req] market=${msg.market_id.slice(0,12)} maker_pk mismatch local=${localMakerPk.slice(0,12)} msg=${String(msg.maker_pk).slice(0,12)} — drop`);
        return;
      }
    }
  } catch (e) {
    console.warn(`[trade-filter:pool-refund-req] verify maker_pk fail market=${msg.market_id.slice(0,12)}: ${e.message}`);
    return;
  }
  // Producer auth verified — dispatchRefund using real local maker_relay_id.
  try {
    const { dispatchRefund } = await import('./pool-market-settler.js');
    console.log(`[trade-filter:pool-refund-req] market=${msg.market_id.slice(0,12)} dispatchRefund 触发 (cross-node consumer request)`);
    await dispatchRefund(market, { action: 'refund', reason: 'cross-node consumer refund request (P0-#3)' });
  } catch (e) {
    console.warn(`[trade-filter:pool-refund-req] dispatchRefund fail market=${msg.market_id.slice(0,12)}: ${e.message}`);
  }
}

// Idempotency = chain_events.txid UNIQUE.
async function handlePoolOracleVote(msg) {
  const { randomUUID } = await import('crypto');
  const kaspa = await import('kaspa-wasm');

  if (!msg.market_id || !msg.voter_pubkey || !msg.outcome || !msg.signature) {
    console.warn(`[trade-filter:pool-vote] msg missing fields (market=${msg.market_id?.slice(0,12)} voter=${msg.voter_pubkey?.slice(0,12)} outcome=${msg.outcome} sig=${!!msg.signature})`);
    return;
  }

  // 1. Market exists on this node?
  // Cross-node-correct membership check: read oracle1/2/3_pk DIRECTLY (= protocol-truth on
  // market row, cross-node consistent via market_publish). KANet-UI r332 caught: original
  // code resolved relay_nodes WHERE id IN oracle_relay_ids (= local relay infra), which
  // fails on cross-node ingest when peer's relays unknown locally. relay_nodes is plumbing
  // not protocol membership. xpk recompute path obsoleted.
  const market = sqlite.prepare('SELECT id, oracle1_pk, oracle2_pk, oracle3_pk, protocol_version FROM pool_markets WHERE id = ?').get(msg.market_id);
  if (!market) {
    // Cross-node case: vote for a market this node hasn't seen yet. J1 #27d: this is the SIGNAL that a
    // market_publish was missed (LRU-evicted under chunk-flood / lost across restart). Fire the catch-up
    // re-ingest (NWT r1166 ④ signal-triggered, throttled, fire-and-forget — don't block vote handling).
    // Once catch-up rebuilds the row, the settler committee-sample + post-sample vote re-scan replay this vote.
    console.log(`[trade-filter:pool-vote] market ${msg.market_id.slice(0,12)} not in local DB (cross-node market_publish gap) — trigger #27d catch-up re-ingest`);
    catchUpUningestedMarkets({ windowHours: 24 }).catch(e => console.warn(`[trade-filter:pool-vote] catch-up trigger fail: ${e.message}`));
    return;
  }

  // 2. voter_pubkey is one of assigned oracles? Direct pk compare, no relay_nodes hop.
  // J2-tn r369 (Bettor 14:41 catch — 精确根因 vote-ingest 漏 v0.7 path):
  // v0.5: oracle1/2/3_pk on market row. v0.6/v0.7: NULL on market row (= committee
  // sampled at settle time stored in pool_committee.committee_pks). 之前只读 v0.5 路径
  // → v0.7 markets assignedPks=[] → 全 reject → chain_events 没写 → consensus 0 票.
  const voterPkNorm = String(msg.voter_pubkey || '').toLowerCase();
  let assignedPks;
  if (market.protocol_version === 'v0.6' || market.protocol_version === 'v0.7') {
    let committeePks = [];
    try {
      const commRow = sqlite.prepare('SELECT committee_pks FROM pool_committee WHERE market_id = ?').get(market.id);
      committeePks = JSON.parse(commRow?.committee_pks || '[]');
    } catch {}
    assignedPks = committeePks.map(p => String(p).toLowerCase());
    if (assignedPks.length === 0) {
      // Committee not yet sampled on this node; vote arrives before committee sample finishes.
      // chain_events.txid UNIQUE means a later replay (via on-chain TX) is safe. Skip-with-log.
      console.log(`[trade-filter:pool-vote] market=${market.id.slice(0,12)} pv=${market.protocol_version} committee not yet sampled (waiting), skip — settler tick will trigger re-process`);
      return;
    }
  } else {
    // v0.5 legacy path — oracle1/2/3_pk on market row.
    assignedPks = [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk]
      .filter(Boolean).map(p => String(p).toLowerCase());
  }
  if (!assignedPks.includes(voterPkNorm)) {
    console.warn(`[trade-filter:pool-vote] voter_pubkey ${voterPkNorm.slice(0,12)} not in assigned committee [${assignedPks.map(p=>p.slice(0,8)).join(',')}] for market ${msg.market_id.slice(0,12)} pv=${market.protocol_version} — reject`);
    return;
  }

  // 3. Verify signature (= reconstruct unsignedPayload, verifyMessage against voter_pubkey).
  // Producer signed: JSON.stringify({ t, market_id, voter_relay_id, voter_pubkey, outcome,
  // evidence_url, evidence_hash, vote_timestamp, epoch }) — keys MUST match producer field order
  // for canonical sig input. We rebuild by dropping `signature` from msg.
  const unsignedCopy = { ...msg };
  delete unsignedCopy.signature;
  // Drop trade-filter-added _tx/_from/_channel/_at meta too (added at L41-44 onBroadcastWritten).
  delete unsignedCopy._tx; delete unsignedCopy._from; delete unsignedCopy._channel; delete unsignedCopy._at;
  const messageToVerify = JSON.stringify(unsignedCopy);
  let sigValid = false;
  try {
    sigValid = kaspa.verifyMessage({ message: messageToVerify, signature: msg.signature, publicKey: msg.voter_pubkey });
  } catch (e) {
    console.warn(`[trade-filter:pool-vote] verifyMessage exception market=${msg.market_id.slice(0,12)}: ${e.message}`);
    return;
  }
  if (!sigValid) {
    console.warn(`[trade-filter:pool-vote] sig invalid voter=${msg.voter_pubkey.slice(0,12)} market=${msg.market_id.slice(0,12)} — reject`);
    return;
  }

  // 4. Idempotent INSERT (same shape as producer L417-419: INSERT OR IGNORE on UNIQUE(txid)).
  // observed_by 'scout-ingest' marks this came via cross-node ingest path; producer uses 'prediction-voter'.
  // settler.decideConsensus reads chain_events WHERE event_type='pool_oracle_vote' regardless of observed_by.
  try {
    const fromAddr = msg._from || null;
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = (SELECT maker_relay_id FROM pool_markets WHERE id = ?)').get(msg.market_id);
    sqlite.prepare(`
      INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'pool_oracle_vote', ?, ?, ?, 'scout-ingest', CURRENT_TIMESTAMP)
    `).run(randomUUID(), msg._tx, fromAddr, makerRow?.address || null, JSON.stringify(msg));
    console.log(`[trade-filter:pool-vote] ingested market=${msg.market_id.slice(0,12)} outcome=${msg.outcome} voter=${msg.voter_pubkey.slice(0,12)} tx=${msg._tx?.slice(0,16)}`);
  } catch (e) {
    console.warn(`[trade-filter:pool-vote] insert fail (likely dedup, ok): ${e.message}`);
  }
}

// J2-tn r301 Path A consumer half: cross-node oracle enrollment ingest.
//
// Producer (api/oracle-pool.js _broadcastOracleStakeEnroll): owner relay ecdsa_sign over
// JSON.stringify({t, staker_pk_x, lock_until_daa, p2sh_addr, enrolled_at}) → sendBroadcastChunked
// on kanet-prediction. Sig 是 staker_pk_x 自家 wallet 签 (= 防伪造 enrollment).
//
// Consumer (THIS handler): on ANY node receiving the broadcast:
//   1. Recompute P2SH via computeStakeP2SH_v1(staker_pk_x, lock_until_daa) — must match
//      msg.p2sh_addr (= ctor anchor 跨节点同源 invariant).
//   2. Verify sig via kaspa.verifyMessage(message, signature, staker_pk_x).
//   3. INSERT OR IGNORE chain_events (event_type='oracle_stake_enroll', txid UNIQUE).
//   4. INSERT OR REPLACE oracle_stake_enrollments (source='chain_envelope'), preserve
//      outpoint_txid/index/amount_sompi if already scanned locally (= scanner cache survives).
//
// Same-node case (producer + consumer on same Console): producer's local INSERT (source='manual')
// 先写, broadcast 自己也 ingest, 这里 UPDATE source='chain_envelope' (= 表明已链上确权).
// Cross-node case: consumer 这里 INSERT new row, scanner 后续 RPC verify UTXO 验真实 stake.
//
// 不在此处 RPC verify UTXO: 留给 scanner 在 snapshotDaa 时点 RPC finality verify (= 跨节点
// 各自 RPC 同 finality 同结果). 这里只确权"声明" enrollment 存在 = chain_events 同步.
async function handleOracleStakeEnroll(msg) {
  const { randomUUID } = await import('crypto');
  const kaspa = await import('kaspa-wasm');

  // J2-tn r337 (Bettor 6/5 C1 终裁): relay_address required for cross-node settle DM.
  // Pre-r337 envelopes (= 5/30~6/5 已上链历史 envelopes) 无 relay_address — backward compat:
  // ingest 仍 accept, but relay_address null OK (= 后续 backfill 走 backfill script + new enroll
  // 自动带 address).
  const required = ['staker_pk_x', 'lock_until_daa', 'p2sh_addr', 'signature'];
  for (const k of required) {
    if (msg[k] === undefined || msg[k] === null) {
      console.warn(`[trade-filter:oracle-enroll] missing ${k} staker=${msg.staker_pk_x?.slice(0,12)} — reject`);
      return;
    }
  }

  const stakerPkX = String(msg.staker_pk_x).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(stakerPkX)) {
    console.warn(`[trade-filter:oracle-enroll] staker_pk_x invalid format ${stakerPkX.slice(0,12)} — reject`);
    return;
  }
  const lockUntilDaa = parseInt(msg.lock_until_daa, 10);
  if (!Number.isFinite(lockUntilDaa) || lockUntilDaa <= 0) {
    console.warn(`[trade-filter:oracle-enroll] lock_until_daa invalid ${msg.lock_until_daa} staker=${stakerPkX.slice(0,12)} — reject`);
    return;
  }

  // 1. Recompute P2SH (= ctor anchor 跨节点同源 invariant). Mismatch = forgery / version skew.
  const network = (msg.p2sh_addr || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
  let recomputed;
  try {
    const { computeStakeP2SH_v1 } = await import('../lib/oracle-stake-v1.mjs');
    recomputed = await computeStakeP2SH_v1({ stakerPkX, lockUntilDaa, network });
  } catch (e) {
    console.warn(`[trade-filter:oracle-enroll] computeStakeP2SH_v1 exception staker=${stakerPkX.slice(0,12)}: ${e.message}`);
    return;
  }
  if (recomputed.p2shAddr !== msg.p2sh_addr) {
    console.warn(`[trade-filter:oracle-enroll] p2sh_addr mismatch staker=${stakerPkX.slice(0,12)} expected=${msg.p2sh_addr?.slice(0,32)} got=${recomputed.p2shAddr.slice(0,32)} — reject (ctor anchor break)`);
    return;
  }

  // 2. Verify staker sig: rebuild unsignedPayload by stripping signature + meta (mirror producer).
  const unsignedCopy = { ...msg };
  delete unsignedCopy.signature;
  delete unsignedCopy._tx; delete unsignedCopy._from; delete unsignedCopy._channel; delete unsignedCopy._at;
  const messageToVerify = JSON.stringify(unsignedCopy);
  let sigValid = false;
  try {
    sigValid = kaspa.verifyMessage({ message: messageToVerify, signature: msg.signature, publicKey: stakerPkX });
  } catch (e) {
    console.warn(`[trade-filter:oracle-enroll] verifyMessage exception staker=${stakerPkX.slice(0,12)}: ${e.message}`);
    return;
  }
  if (!sigValid) {
    console.warn(`[trade-filter:oracle-enroll] sig invalid staker=${stakerPkX.slice(0,12)} — reject`);
    return;
  }

  // 3. Idempotent chain_events INSERT (UNIQUE on txid).
  try {
    const fromAddr = msg._from || null;
    sqlite.prepare(`
      INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'oracle_stake_enroll', ?, ?, ?, 'scout-ingest', CURRENT_TIMESTAMP)
    `).run(randomUUID(), msg._tx, fromAddr, msg.p2sh_addr, JSON.stringify(msg));
  } catch (e) {
    console.warn(`[trade-filter:oracle-enroll] chain_events insert fail (likely dedup, ok): ${e.message}`);
  }

  // 4. UPSERT oracle_stake_enrollments — chain-confirmed enrollment registry.
  //    Preserve outpoint/amount fields if scanner already populated (= 不洗 scanner cache).
  //    J2-tn r337 C1: relay_address 写入 (= cross-node DM target).
  const relayAddress = typeof msg.relay_address === 'string' && msg.relay_address.length > 0 ? msg.relay_address : null;
  try {
    const existing = sqlite.prepare(
      'SELECT outpoint_txid, outpoint_index, amount_sompi, last_scanned_at FROM oracle_stake_enrollments WHERE staker_pk_x = ?'
    ).get(stakerPkX);
    if (existing) {
      // Already in local table — only flip source to chain_envelope (= 链上确权了).
      sqlite.prepare(`
        UPDATE oracle_stake_enrollments
        SET lock_until_daa = ?, p2sh_addr = ?, p2sh_hash = ?, redeem_script_hex = ?,
            source = 'chain_envelope', active = 1, relay_address = COALESCE(?, relay_address)
        WHERE staker_pk_x = ?
      `).run(lockUntilDaa, recomputed.p2shAddr, recomputed.p2shHash, recomputed.redeemScript, relayAddress, stakerPkX);
    } else {
      sqlite.prepare(`
        INSERT INTO oracle_stake_enrollments
          (staker_pk_x, lock_until_daa, p2sh_addr, p2sh_hash, redeem_script_hex, source, active, relay_address)
        VALUES (?, ?, ?, ?, ?, 'chain_envelope', 1, ?)
      `).run(stakerPkX, lockUntilDaa, recomputed.p2shAddr, recomputed.p2shHash, recomputed.redeemScript, relayAddress);
    }
    console.log(`[trade-filter:oracle-enroll] ingested staker=${stakerPkX.slice(0,12)} lock=${lockUntilDaa} addr=${relayAddress?.slice(-12) || 'NULL'} tx=${msg._tx?.slice(0,16)}`);
  } catch (e) {
    console.warn(`[trade-filter:oracle-enroll] enrollments upsert fail: ${e.message}`);
  }
}

// 问3 (a) (Bettor 2026-06-15): cross-node-CONVERGENT oracle 撤出 ingest. The /withdraw endpoint broadcasts a
// staker-signed oracle_stake_withdraw_v1 envelope; EVERY node (incl producer) ingests it HERE → sets active=0.
// = the REAL pool removal via the convergent broadcast path so both nodes drop the oracle in lockstep — NOT a
// node-local endpoint UPDATE (which = #22 active-flag cross-node divergence: one node's pool ≠ the other's).
// Staker-sig auth (only the oracle can withdraw its own enrollment) + chain_events idempotency, mirroring enroll.
async function handleOracleStakeWithdraw(msg) {
  const { randomUUID } = await import('crypto');
  const kaspa = await import('kaspa-wasm');
  if (msg.staker_pk_x === undefined || msg.signature === undefined) {
    console.warn(`[trade-filter:oracle-withdraw] missing staker_pk_x/signature — reject`); return;
  }
  const stakerPkX = String(msg.staker_pk_x).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(stakerPkX)) {
    console.warn(`[trade-filter:oracle-withdraw] staker_pk_x invalid format ${stakerPkX.slice(0,12)} — reject`); return;
  }
  // Verify staker sig: only the staking oracle (private key) can withdraw its own enrollment (mirror enroll).
  const unsignedCopy = { ...msg };
  delete unsignedCopy.signature;
  delete unsignedCopy._tx; delete unsignedCopy._from; delete unsignedCopy._channel; delete unsignedCopy._at;
  let sigValid = false;
  try {
    sigValid = kaspa.verifyMessage({ message: JSON.stringify(unsignedCopy), signature: msg.signature, publicKey: stakerPkX });
  } catch (e) { console.warn(`[trade-filter:oracle-withdraw] verifyMessage exception staker=${stakerPkX.slice(0,12)}: ${e.message}`); return; }
  if (!sigValid) { console.warn(`[trade-filter:oracle-withdraw] sig invalid staker=${stakerPkX.slice(0,12)} — reject`); return; }

  // idempotent chain_events INSERT (UNIQUE on txid) — auditable withdraw record.
  try {
    sqlite.prepare(`
      INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'oracle_stake_withdraw', ?, ?, ?, 'scout-ingest', CURRENT_TIMESTAMP)
    `).run(randomUUID(), msg._tx, msg._from || null, null, JSON.stringify(msg));
  } catch (e) { console.warn(`[trade-filter:oracle-withdraw] chain_events insert fail (dedup ok): ${e.message}`); }

  // CROSS-NODE-CONVERGENT active removal: every node ingests the SAME broadcast → every node sets active=0 →
  // the oracle leaves the chain-derived committee-sampling pool (scanAndDerivePool WHERE active=1) in lockstep.
  try {
    const r = sqlite.prepare('UPDATE oracle_stake_enrollments SET active = 0 WHERE staker_pk_x = ?').run(stakerPkX);
    console.log(`[trade-filter:oracle-withdraw] staker=${stakerPkX.slice(0,12)} → active=0 (cross-node convergent, changes=${r.changes}) tx=${msg._tx?.slice(0,16)}`);
  } catch (e) { console.warn(`[trade-filter:oracle-withdraw] active=0 update fail: ${e.message}`); }
}

// J2-tn r374 (Bettor 15:02 catch): cross-node oracle TX sign_resp ingest.
// Producer (J1 d5e2f26 pool-sign-handler OR voter bettor-prediction-voter.js L538): committee
// oracle 收 sign_req → 签 spine input → 广播 kanet_pool_oracle_tx_sign_resp_v1 含 voter_pubkey
// + signature + input_index. settler handleCollectingSigs L1640 读 chain_events
// event_type='pool_oracle_tx_sig' 聚集. Consumer (THIS handler): 写 chain_events 让 settler
// 读到跨节点 sig. Verification: voter_pubkey ∈ pool_committee.committee_pks (= 跨节点 canonical).
// Same idempotency pattern as oracle vote (chain_events.txid UNIQUE).
async function handlePoolOracleTxSignResp(msg) {
  const { randomUUID } = await import('crypto');
  const required = ['market_id', 'voter_pubkey', 'signature', 'input_index'];
  for (const k of required) {
    if (msg[k] === undefined || msg[k] === null) {
      console.warn(`[trade-filter:sign-resp] missing ${k} market=${msg.market_id?.slice(0,12)} — reject`);
      return;
    }
  }
  const voterPkNorm = String(msg.voter_pubkey || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(voterPkNorm)) {
    console.warn(`[trade-filter:sign-resp] voter_pubkey invalid format market=${msg.market_id?.slice(0,12)} — reject`);
    return;
  }
  // 1. Verify voter_pubkey ∈ committee_pks (= canonical 跨节点 anti-spoof).
  let committeePks = [];
  try {
    const commRow = sqlite.prepare('SELECT committee_pks FROM pool_committee WHERE market_id = ?').get(msg.market_id);
    committeePks = JSON.parse(commRow?.committee_pks || '[]').map(p => String(p).toLowerCase());
  } catch {}
  if (committeePks.length === 0) {
    console.log(`[trade-filter:sign-resp] market=${msg.market_id?.slice(0,12)} committee not yet sampled (waiting), skip — settler per-tick re-scan will replay`);
    return;
  }
  if (!committeePks.includes(voterPkNorm)) {
    console.warn(`[trade-filter:sign-resp] voter_pubkey ${voterPkNorm.slice(0,12)} not in committee [${committeePks.map(p=>p.slice(0,8)).join(',')}] for market ${msg.market_id.slice(0,12)} — reject`);
    return;
  }
  // 2. Idempotent INSERT chain_events 'pool_oracle_tx_sig'.
  try {
    const fromAddr = msg._from || null;
    sqlite.prepare(`
      INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'pool_oracle_tx_sig', ?, ?, ?, 'scout-ingest', CURRENT_TIMESTAMP)
    `).run(randomUUID(), msg._tx, fromAddr, null, JSON.stringify(msg));
    console.log(`[trade-filter:sign-resp] ingested market=${msg.market_id.slice(0,12)} voter=${voterPkNorm.slice(0,12)} input=${msg.input_index} tx=${msg._tx?.slice(0,16)}`);
  } catch (e) {
    console.warn(`[trade-filter:sign-resp] chain_events INSERT fail (likely dedup, ok): ${e.message}`);
  }
}

// J1tn r361 (Bettor 15:05 钦定): cross-node sign_req broadcast trigger.
// Producer (J2 5a06b31 dispatchPhase2): organizer broadcasts kanet_pool_oracle_tx_sign_req_v1
// containing {market_id, winner, unanimous, silent_oracle_index, input_count, spine_input_count}.
// Consumer (THIS handler): for each local is_oracle relay whose pubkey ∈ committee_pks for this
// market → call sign_input_for_settle IPC per spine input → broadcast kanet_pool_oracle_tx_sign_resp_v1.
// Same broadcast-symmetric pattern as oracle vote (replaces obsolete DM-based pool-sign-handler.js).
//
// Requires local phase2_tx_obj in pool_markets.metadata (= produced by local dispatchPhase2).
// If absent (= cross-node maker), settler's per-tick replay + cross-node market_publish ingest
// must materialize phase2_tx_obj first. For now, skip with warning if missing.
async function handlePoolOracleTxSignReq(msg) {
  const required = ['market_id', 'winner', 'input_count', 'spine_input_count'];
  for (const k of required) {
    if (msg[k] === undefined || msg[k] === null) {
      console.warn(`[trade-filter:sign-req] missing ${k} market=${msg.market_id?.slice(0,12)} — reject`);
      return;
    }
  }
  // 1. Load market + phase2_tx_obj (needed to sign).
  //    J2-tn r377 (48960f6): sign_req broadcast now carries phase2_tx_obj cross-node.
  //    Prefer payload-supplied tx_obj (cross-node canonical); fallback to local meta for
  //    same-node path where dispatchPhase2 wrote local metadata first.
  const market = sqlite.prepare(
    'SELECT id, protocol_status, metadata FROM pool_markets WHERE id = ?'
  ).get(msg.market_id);
  if (!market) {
    console.log(`[trade-filter:sign-req] market ${msg.market_id?.slice(0,12)} not in local DB — skip`);
    return;
  }
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  const phase2TxObj = msg.phase2_tx_obj || meta.phase2_tx_obj;
  if (!phase2TxObj) {
    console.log(`[trade-filter:sign-req] market ${market.id.slice(0,12)} no phase2_tx_obj (neither msg nor local meta) — skip`);
    return;
  }
  // 2. Load committee_pks (canonical cross-node identity).
  let committeePks = [];
  try {
    const commRow = sqlite.prepare('SELECT committee_pks FROM pool_committee WHERE market_id = ?').get(msg.market_id);
    committeePks = JSON.parse(commRow?.committee_pks || '[]').map(p => String(p).toLowerCase());
  } catch {}
  if (committeePks.length === 0) {
    console.log(`[trade-filter:sign-req] market=${msg.market_id?.slice(0,12)} committee not sampled locally — skip`);
    return;
  }
  // 3. Find local is_oracle relays whose pubkey ∈ committee_pks.
  const localOracles = sqlite.prepare(
    'SELECT id, name, address FROM relay_nodes WHERE is_oracle = 1'
  ).all();
  if (localOracles.length === 0) {
    return; // no local oracles, nothing to sign
  }
  const { sendCommandAsync } = await import('./relay-manager.js');
  const spineInputCount = Number(msg.spine_input_count) || 1;
  // J1tn r361 (Bettor): forfeit_1 path — silent oracle does not sign.
  const silentIdx = (msg.unanimous === false || msg.unanimous === 'false') && typeof msg.silent_oracle_index === 'number'
    ? msg.silent_oracle_index : -1;
  let signedTotal = 0;
  for (const oracle of localOracles) {
    // Get oracle's pubkey via IPC, check membership.
    let voterPubkey;
    try {
      const pkRes = await sendCommandAsync(oracle.id, { type: 'get_pubkey' }, undefined, 'internal');
      if (!pkRes?.x_only_pubkey) continue;
      voterPubkey = String(pkRes.x_only_pubkey).toLowerCase();
    } catch { continue; }
    const myIdx = committeePks.indexOf(voterPubkey);
    if (myIdx === -1) continue; // not in committee for this market
    if (silentIdx === myIdx) {
      console.log(`[trade-filter:sign-req] oracle=${oracle.name} forfeit_1 silent (idx=${myIdx}) — skip sign`);
      continue;
    }
    // 4. Sign each spine input + broadcast sign_resp.
    for (let inputIdx = 0; inputIdx < spineInputCount; inputIdx++) {
      // Idempotent: skip if already signed (chain_events local)
      const existing = sqlite.prepare(`
        SELECT id FROM chain_events
        WHERE event_type = 'pool_oracle_tx_sig'
          AND payload LIKE ? AND payload LIKE ? AND payload LIKE ?
        LIMIT 1
      `).get(`%"market_id":"${market.id}"%`, `%"input_index":${inputIdx}%`, `%"voter_pubkey":"${voterPubkey}"%`);
      if (existing) continue;

      let signResult;
      try {
        // 🔴 第三签名站点 safe_json 补修(2026-07-18 J1tn, jepu1 重签设计步1, NWT 红队 751eaa07):
        // c8188d98 修 bettor-prediction-voter.js 两站点时漏了本站点——这里原样发裸
        // JSON.stringify(phase2TxObj) = relay 走 plain 路径 → spk 不进 sighash → 签名必坏
        // (jepu1 401 次 verify-failed 的半根因)。改与另两站点同款: 单源 helper 转 safe_json
        // (../lib/settle-safe-json.mjs, 函数体 = c8188d98 原版逐字节) + safe_json:true。
        // bshard 盘不经本 handler(消息 type 隔离, 见设计稿 §1.5), bshard-close-voter 已是同形态。
        const { toSettleSafeJsonTxHex } = await import('../lib/settle-safe-json.mjs');
        const _safeTxHex = await toSettleSafeJsonTxHex(phase2TxObj);
        signResult = await sendCommandAsync(oracle.id, {
          type: 'sign_input_for_settle',
          tx_hex: _safeTxHex,
          input_index: inputIdx,
          safe_json: true,
        }, undefined, 'internal');
      } catch (e) {
        console.warn(`[trade-filter:sign-req] sign IPC fail market=${market.id.slice(0,12)} oracle=${oracle.name} input=${inputIdx}: ${e.message}`);
        continue;
      }
      if (!signResult?.ok || !signResult.signature) {
        console.warn(`[trade-filter:sign-req] sign fail market=${market.id.slice(0,12)} oracle=${oracle.name} input=${inputIdx}: ${signResult?.error || 'no sig'}`);
        continue;
      }
      const respPayload = {
        t: 'kanet_pool_oracle_tx_sign_resp_v1',
        market_id: market.id,
        voter_pubkey: voterPubkey,
        input_index: inputIdx,
        winner: msg.winner,
        signature: signResult.signature,
        epoch: 1,
      };
      try {
        const bcastRes = await sendCommandAsync(oracle.id, {
          type: 'send_broadcast',
          channel: 'kanet-prediction',
          message: JSON.stringify(respPayload),
        }, undefined, 'internal');
        if (!bcastRes?.txId) {
          console.warn(`[trade-filter:sign-req] broadcast no txId market=${market.id.slice(0,12)} oracle=${oracle.name} input=${inputIdx}`);
          continue;
        }
        console.log(`[trade-filter:sign-req] SIGNED+BROADCAST market=${market.id.slice(0,12)} oracle=${oracle.name} input=${inputIdx} tx=${bcastRes.txId.slice(0,16)} voter_pubkey=${voterPubkey.slice(0,12)}`);
        signedTotal++;
      } catch (e) {
        console.warn(`[trade-filter:sign-req] broadcast IPC fail market=${market.id.slice(0,12)} oracle=${oracle.name} input=${inputIdx}: ${e.message}`);
      }
    }
  }
  if (signedTotal > 0) {
    console.log(`[trade-filter:sign-req] DONE market=${market.id.slice(0,12)} signed=${signedTotal} across local oracles`);
  }
}

// Bettor r117/r118/r120 ② consumer half — cross-node market_publish ingest.
// Producer (J1 a3565bf _broadcastMarketPublished pool.js:36-95): maker_relay ecdsa_sign over
// JSON.stringify(unsignedPayload) + send_broadcast kanet-prediction. Schema 22 fields + sig.
// Consumer: verify metadata_hash (3-way命门 producer/consumer/spine ctor anchor) + verify maker sig
// (kaspa.verifyMessage via maker_relay_pk from payload, NOT relay_nodes lookup) + INSERT OR IGNORE
// pool_markets. Cross-node-correct identity via maker_relay_pk in protocol payload (= ① c2c84d1
// same lesson: protocol membership lives in protocol fields not local relay_nodes infra).
async function handlePoolMarketPublished(msg) {
  const { randomUUID, createHash } = await import('crypto');
  const kaspa = await import('kaspa-wasm');

  const required = ['market_id', 'spine_p2sh', 'market_metadata_hash', 'maker_relay_pk', 'signature',
    'outcome_market_source', 'outcome_condition_id', 'outcome_token_id', 'outcome_side',
    'resolution_rule_spec', 'deadline'];
  for (const k of required) {
    if (msg[k] === undefined || msg[k] === null) {
      console.warn(`[trade-filter:market-pub] missing ${k} market=${msg.market_id?.slice(0,12)} — reject`);
      return;
    }
  }

  // Idempotent: already on this node? (= same-node producer-direct INSERT pre-empted, or prior consumer)
  const existing = sqlite.prepare('SELECT id FROM pool_markets WHERE id = ?').get(msg.market_id);
  if (existing) {
    console.log(`[trade-filter:market-pub] market ${msg.market_id.slice(0,12)} already in local DB — skip`);
    return;
  }

  // 1. Recompute market_metadata_hash (3-way命门: producer pool.js:283-291 == consumer == spine ctor anchor)
  //    Formula a3565bf: end=deadline (int unix sec), NOT outcome_end_date. r123 fix landed.
  const metaInput = JSON.stringify({
    source: msg.outcome_market_source,
    condition: msg.outcome_condition_id,
    token: msg.outcome_token_id,
    side: msg.outcome_side,
    end: msg.deadline,
    rule: msg.resolution_rule_spec,
  });
  const recomputedHash = createHash('sha256').update(metaInput).digest('hex');
  if (recomputedHash !== msg.market_metadata_hash) {
    console.warn(`[trade-filter:market-pub] metadata_hash mismatch market=${msg.market_id.slice(0,12)} expected=${msg.market_metadata_hash.slice(0,16)} got=${recomputedHash.slice(0,16)} — reject (3-way anchor break)`);
    return;
  }

  // 2. Verify maker sig: rebuild unsignedPayload by stripping signature + meta (mirror producer L73 spread)
  const unsignedCopy = { ...msg };
  delete unsignedCopy.signature;
  delete unsignedCopy._tx; delete unsignedCopy._from; delete unsignedCopy._channel; delete unsignedCopy._at;
  const messageToVerify = JSON.stringify(unsignedCopy);
  let sigValid = false;
  try {
    sigValid = kaspa.verifyMessage({ message: messageToVerify, signature: msg.signature, publicKey: String(msg.maker_relay_pk).toLowerCase() });
  } catch (e) {
    console.warn(`[trade-filter:market-pub] verifyMessage exception market=${msg.market_id.slice(0,12)}: ${e.message}`);
    return;
  }
  if (!sigValid) {
    console.warn(`[trade-filter:market-pub] sig invalid maker=${msg.maker_relay_pk?.slice(0,12)} market=${msg.market_id.slice(0,12)} — reject`);
    return;
  }

  // Bettor r135 H1 close-gate: verify spine_lock_tx UTXO on chain at spine_p2sh BEFORE INSERT.
  // Without this, a valid maker sig over a fabricated payload (no actual on-chain stake) would
  // get ingested — market listed everywhere, bets attempted, all fail because the spine never
  // really existed. Same pattern as bet handler getUtxosByAddresses + outpoint match.
  try {
    const { getWorkingRpc } = await import('./rpc-health.js');
    const { url: rpcUrl } = await getWorkingRpc();
    if (!rpcUrl) {
      console.warn(`[trade-filter:market-pub] no working RPC — skip (will replay on next broadcast)`);
      return;
    }
    const { RpcClient, Encoding, Address } = await import('kaspa-wasm');
    const network = msg.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: network });
    let utxos;
    try {
      await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 4000))]);
      ({ entries: utxos } = await rpc.getUtxosByAddresses([new Address(msg.spine_p2sh)]));
    } finally {
      try { await rpc.disconnect(); } catch {}
    }
    utxos = utxos || [];
    const spineMatch = utxos.find(u => {
      const op = u.outpoint || u.entry?.outpoint;
      const txid = op && (op.transactionId || op.transaction_id);
      return txid === msg.spine_lock_tx;
    });
    if (!spineMatch) {
      console.warn(`[trade-filter:market-pub] spine_lock_tx ${msg.spine_lock_tx.slice(0,16)} not UNSPENT at spine_p2sh ${msg.spine_p2sh.slice(0,20)} (fake market or already settled) — reject`);
      return;
    }
  } catch (e) {
    console.warn(`[trade-filter:market-pub] spine UTXO verify fail market=${msg.market_id.slice(0,12)}: ${e.message} — skip (replay later)`);
    return;
  }

  // 3. INSERT OR IGNORE pool_markets — cols mirror create-v06 path (pool.js:399-413).
  //    Local-only cols (maker_relay_id / broker_relay_id / oracle_relay_ids) = NULL — we don't know
  //    peer's relay IDs (protocol membership lives in pubkey fields). updated_at / sides_merkle_root
  //    default. metadata flagged cross_node_origin for forensic clarity.
  const oraclePks = Array.isArray(msg.oracle_relay_pks) ? msg.oracle_relay_pks : [];
  const metadata = JSON.stringify({
    cross_node_origin: true, source_tx: msg._tx, source_addr: msg._from,
    published_at: msg.published_at,
  });
  // maker_relay_id is NOT NULL on the table but cross-node ingest doesn't know peer's UUID.
  // Use `cross-node:<maker_relay_pk>` sentinel — unique per peer maker + makes origin obvious
  // in queries. UI and settler treat unknown relay_ids as remote (already handle null relay
  // lookup gracefully — `relay_nodes WHERE id = ?` returns nothing, callers fall back to
  // protocol fields like maker_pk on the row).
  const sentinelRelayId = `cross-node:${msg.maker_relay_pk}`;
  try {
    const insertResult = sqlite.prepare(`INSERT OR IGNORE INTO pool_markets (
      id, maker_relay_id, spine_p2sh, spine_lock_tx, market_metadata_hash,
      oracle1_pk, oracle2_pk, oracle3_pk, broker_pk, maker_pk,
      deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
      outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
      protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata, category,
      protocol_version, pool_merkle_root, deadline_daa
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      msg.market_id, sentinelRelayId, msg.spine_p2sh, msg.spine_lock_tx, msg.market_metadata_hash,
      oraclePks[0] || null, oraclePks[1] || null, oraclePks[2] || null, msg.broker_pk,
      msg.maker_relay_pk,  // 问2 (NWT review): chain-anchor maker_pk from the sig-verified payload (L623) so the
                           // committee maker-exclude is byte-equal cross-node (producer also sets it, see pool.js).
      msg.deadline, msg.miner_fee, msg.broker_fee_pct, msg.oracle_bond_amount, msg.maker_stake_amount,
      msg.outcome_market_source, msg.outcome_condition_id, msg.outcome_token_id, msg.outcome_side, msg.resolution_rule_spec,
      'pending_bettors', '', '[]', sentinelRelayId, metadata, msg.category,
      msg.protocol_version || 'v0.5', msg.pool_merkle_root,
      msg.deadline_daa || null,  // J2-tn r323: 跨节点 endBlock 锚, NWT+J1 合解.
    );
    // Bettor r135 close-gate #2: silent-skip guard — INSERT OR IGNORE returns changes=0 if
    // either dedup (= row existed, ok) or constraint violation (= bug). Distinguish via
    // SELECT after for forensic clarity. Bare INSERT OR IGNORE returning 0 hid f7f1af2 bug.
    if (insertResult.changes === 0) {
      const stillMissing = !sqlite.prepare('SELECT 1 FROM pool_markets WHERE id = ?').get(msg.market_id);
      if (stillMissing) {
        console.warn(`[trade-filter:market-pub] INSERT OR IGNORE changes=0 AND row still missing market=${msg.market_id.slice(0,12)} — constraint violation? (KI 49 silent-skip)`);
        return;
      }
      // else: row exists from prior INSERT (e.g. same-node producer-direct), ok.
    }
    console.log(`[trade-filter:market-pub] ingested market=${msg.market_id.slice(0,12)} maker_pk=${msg.maker_relay_pk.slice(0,12)} tx=${msg._tx?.slice(0,16)}`);
  } catch (e) {
    console.warn(`[trade-filter:market-pub] insert fail market=${msg.market_id.slice(0,12)}: ${e.message}`);
    return;
  }

  // Bettor §5.3 F-S3 cross-node snapshot bake: settler-tick committee sample requires
  // pool_snapshots row. On producer node ensurePoolSnapshot is called at create-v0X.
  // J2-tn r360 (J1 r337 catch + Bettor 12:41 锁定): v0.7 cross-node ingest 也必 bake snapshot
  // (= 之前只 v0.6 → :3300 ingest q8m8t v0.7 后 snapshot 空 → settler sample 缺前置 → committee
  // 永 [] → voter 0 match → settle 永卡). 真源 = chain_view row where merkle_root ==
  // msg.pool_merkle_root (= 跨节点同步 by chain envelope), 取对应 snapshot_daa baked.
  if ((msg.protocol_version === 'v0.6' || msg.protocol_version === 'v0.7') && msg.pool_merkle_root) {
    try {
      const { ensurePoolSnapshot } = await import('./pool-market-settler-v06.mjs');
      // Find chain_view row matching the ctor pool_merkle_root (= envelope baked).
      const cv = sqlite.prepare(
        'SELECT snapshot_daa FROM oracle_pool_chain_view WHERE merkle_root = ? ORDER BY snapshot_daa DESC LIMIT 1'
      ).get(msg.pool_merkle_root.toLowerCase());
      const snapshotDaa = cv?.snapshot_daa || null;  // null fallback = legacy 7d grace path
      ensurePoolSnapshot(msg.market_id, msg.pool_merkle_root, snapshotDaa);
      console.log(`[trade-filter:market-pub] snapshot baked market=${msg.market_id.slice(0,12)} pv=${msg.protocol_version} snapshot_daa=${snapshotDaa || 'NULL_legacy'}`);
    } catch (snapErr) {
      // Mismatch = remote chain_view differs from envelope root (= shouldn't happen post-r337
      // chain-derived consistency). Market row still ingested but settler-tick will skip
      // committee sampling — operator can backfill later via scripts/_j2tn_backfill_snapshot_v2.mjs.
      console.warn(`[trade-filter:market-pub] snapshot bake skip market=${msg.market_id.slice(0,12)}: ${snapErr.message}`);
    }
  }

  // Bettor r132 H2 critical upgrade: chunked market ~50s vs bet 单 TX 瞬到 → bet 必 first → race is
  // norm not edge. Post-market-ingest: re-scan broadcast_messages for orphaned pool_bet_registered_v1
  // referencing this market_id and re-run their handler. Idempotent via UNIQUE side_lock_tx.
  try {
    const orphanedBets = sqlite.prepare(`
      SELECT tx_hash, sender_address, channel_name, content, created_at
      FROM broadcast_messages
      WHERE channel_name = 'kanet-prediction'
        AND content LIKE '%pool_bet_registered_v1%'
        AND content LIKE ?
      ORDER BY created_at ASC
    `).all(`%"market_id":"${msg.market_id}"%`);
    if (orphanedBets.length > 0) {
      console.log(`[trade-filter:market-pub] H2 rescan: ${orphanedBets.length} orphan bet(s) for market=${msg.market_id.slice(0,12)} — replaying`);
      for (const row of orphanedBets) {
        try {
          await onBroadcastWritten({
            tx_hash: row.tx_hash, content: row.content, sender_address: row.sender_address,
            channel_name: row.channel_name, created_at: row.created_at,
          });
        } catch (replayErr) {
          console.warn(`[trade-filter:market-pub] H2 bet replay fail tx=${row.tx_hash.slice(0,16)}: ${replayErr.message}`);
        }
      }
    }
  } catch (rescanErr) {
    console.warn(`[trade-filter:market-pub] H2 rescan fail market=${msg.market_id.slice(0,12)}: ${rescanErr.message}`);
  }
}

// Bettor r113/r117/r120 ② consumer half — cross-node bet_register ingest.
// Producer (J1 _broadcastBetRegistered pool.js:97-115): NO signature. Schema 9 fields.
// Consumer verifies via CHAIN truth not sig: recompute side_p2sh from bettor_pk + market.spine + protocol_version,
// then RPC getUtxosByAddresses(side_p2sh) finds UTXO with amount===stake_amount AND outpoint.txid===side_lock_tx
// AND UTXO still UNSPENT (Bettor r113 refine: UNSPENT = open position; spent = already settled, skip).
// Idempotent via UNIQUE side_lock_tx index on pool_bettor_sides.
// Bettor r128 + J1 r188 (e67c9328) chunked v1 reassembler. Producer pool.js _sendBroadcastChunked
// splits market_publish payload > 450 chars into ord 0..total-1 chunks, envelope
// {t:'pool_market_chunk_v1', hash, ord, total, data} per chunk. hash = sha256(full payloadStr) is
// the dedup + integrity anchor. Consumer accumulates in-mem (cheap, market publishes are rare +
// idempotent — dedup by hash), reassembles when complete, verifies hash byte-identical, then
// recursively dispatches the reassembled JSON through the full pre-filter + switch path (= same
// route a single-shot pool_market_published_v1 would take, no special-casing).
const POOL_CHUNK_CACHE = new Map();  // key=hash → { total, parts: Map<ord,data>, firstAt }
// Bettor r135 close-gate #3: chunk cache TTL. Incomplete reassembly (= producer crashed mid-broadcast,
// or chunks lost on chain) would leak entries forever. Eviction: TTL since firstAt — generous
// since chunked envelope takes ~50s+ end-to-end + chain propagation delays. Run lazy on each new chunk
// (= O(cache_size), tiny for our scale).
//
// J2-tn r426 (Bettor r453 / J1 r417 钉死 wghdr 根因): 5min TTL 太短 for 55-chunk envelope
// (= settle sign_req with embedded phase2_tx_obj). chunks ord 44-54 arrive after first batch ord
// 0-43 expired → eternal incomplete. 改 30 min TTL — chain re-broadcast retry 2 rounds 时间够.
//
// J2-tn r430 (Bettor r468 OOM 根治): 30min TTL × 大 envelope (= 55-chunk × 340B = 18.7KB) 累积
// 触发 OOM. 加 max-size LRU 兜底: > MAX_CACHE_ENTRIES (= 200) 时 evict 最旧条目 (= firstAt asc).
const POOL_CHUNK_TTL_MS = 30 * 60 * 1000;
const POOL_CHUNK_MAX_ENTRIES = 200;
function _evictExpiredChunks(now = Date.now()) {
  for (const [hash, entry] of POOL_CHUNK_CACHE) {
    if (now - entry.firstAt > POOL_CHUNK_TTL_MS) {
      console.warn(`[trade-filter:chunk] evict expired hash=${hash.slice(0,12)} age=${Math.round((now - entry.firstAt)/1000)}s have=${entry.parts.size}/${entry.total} (incomplete reassembly, dropped)`);
      POOL_CHUNK_CACHE.delete(hash);
    }
  }
  // r430: max-size LRU eviction (OOM 兜底). 超 200 → evict 最旧 N 个直到 <= 200.
  if (POOL_CHUNK_CACHE.size > POOL_CHUNK_MAX_ENTRIES) {
    const sorted = Array.from(POOL_CHUNK_CACHE.entries()).sort((a, b) => a[1].firstAt - b[1].firstAt);
    const toEvict = POOL_CHUNK_CACHE.size - POOL_CHUNK_MAX_ENTRIES;
    for (let i = 0; i < toEvict; i++) {
      const [hash, entry] = sorted[i];
      console.warn(`[trade-filter:chunk] evict over-cap hash=${hash.slice(0,12)} firstAt=${new Date(entry.firstAt).toISOString()} have=${entry.parts.size}/${entry.total} (cache size > ${POOL_CHUNK_MAX_ENTRIES}, dropped LRU)`);
      POOL_CHUNK_CACHE.delete(hash);
    }
  }
}

// J2-tn r418 (Bettor r428 关1 方案 C 路径 A push): consumer ingest pool_market_settled_v1.
// Idempotent: 仅当 protocol_status='verifying' or 'collecting_sigs' 时 UPDATE → 'completed'.
// Defends 重复 broadcast (= cron retry / chain replay). 不动 settle_txid 若 already 设.
async function handlePoolMarketSettled(msg) {
  const required = ['market_id', 'settle_txid', 'winner'];
  for (const k of required) {
    if (msg[k] === undefined || msg[k] === null) {
      console.warn(`[trade-filter:settled] missing ${k} market=${msg.market_id?.slice(0,12)} — reject`);
      return;
    }
  }
  const row = sqlite.prepare('SELECT id, protocol_status, settle_txid FROM pool_markets WHERE id = ?').get(msg.market_id);
  if (!row) {
    console.log(`[trade-filter:settled] market ${msg.market_id?.slice(0,12)} not in local DB — skip (cross-node race)`);
    return;
  }
  if (row.protocol_status === 'completed' && row.settle_txid) {
    console.log(`[trade-filter:settled] market ${msg.market_id.slice(0,12)} already completed (txid=${row.settle_txid.slice(0,16)}) — skip idempotent`);
    return;
  }
  // Only advance from verifying/collecting_sigs — refuse to overwrite refunded/cancelled.
  if (row.protocol_status !== 'verifying' && row.protocol_status !== 'collecting_sigs') {
    console.warn(`[trade-filter:settled] market ${msg.market_id.slice(0,12)} status=${row.protocol_status} not eligible to settle → ignore (protected)`);
    return;
  }
  sqlite.prepare('UPDATE pool_markets SET settle_txid = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(msg.settle_txid, 'completed', msg.market_id);
  console.log(`[trade-filter:settled] cross-node sync market=${msg.market_id.slice(0,12)} settle_txid=${msg.settle_txid.slice(0,16)} winner=${msg.winner} (was ${row.protocol_status})`);
}

async function handlePoolMarketChunk(msg) {
  const { createHash } = await import('crypto');
  _evictExpiredChunks();  // lazy GC every chunk
  if (!msg.hash || msg.ord === undefined || !msg.total || msg.data === undefined) {
    console.warn(`[trade-filter:chunk] missing fields hash=${msg.hash?.slice(0,12)} ord=${msg.ord} total=${msg.total} — reject`);
    return;
  }
  const total = Number(msg.total);
  const ord = Number(msg.ord);
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(ord) || ord < 0 || ord >= total) {
    console.warn(`[trade-filter:chunk] bad ord=${ord} total=${total} hash=${msg.hash.slice(0,12)} — reject`);
    return;
  }

  let entry = POOL_CHUNK_CACHE.get(msg.hash);
  if (!entry) {
    entry = { total, parts: new Map(), firstAt: Date.now() };
    POOL_CHUNK_CACHE.set(msg.hash, entry);
  } else if (entry.total !== total) {
    console.warn(`[trade-filter:chunk] total mismatch hash=${msg.hash.slice(0,12)} cached=${entry.total} new=${total} — reject`);
    return;
  }
  entry.parts.set(ord, msg.data);
  console.log(`[trade-filter:chunk] cached hash=${msg.hash.slice(0,12)} ord=${ord}/${total - 1} have=${entry.parts.size}/${total} tx=${msg._tx?.slice(0,12)}`);
  if (entry.parts.size < total) return;

  // Reassemble in ord order
  const ordered = [];
  for (let i = 0; i < total; i++) {
    const part = entry.parts.get(i);
    if (part === undefined) {
      console.warn(`[trade-filter:chunk] internal inconsistency: size=${total} but ord=${i} missing hash=${msg.hash.slice(0,12)}`);
      return;
    }
    ordered.push(part);
  }
  const reassembled = ordered.join('');
  const computedHash = createHash('sha256').update(reassembled).digest('hex');
  if (computedHash !== msg.hash) {
    console.warn(`[trade-filter:chunk] hash mismatch reassembled hash=${msg.hash.slice(0,12)} got=${computedHash.slice(0,12)} — reject corrupted chunks`);
    POOL_CHUNK_CACHE.delete(msg.hash);
    return;
  }
  POOL_CHUNK_CACHE.delete(msg.hash);
  console.log(`[trade-filter:chunk] reassembled ${total} chunks hash=${msg.hash.slice(0,12)} payload_len=${reassembled.length} — dispatching to handler`);

  let inner;
  try {
    inner = JSON.parse(reassembled);
  } catch (e) {
    console.warn(`[trade-filter:chunk] reassembled JSON parse fail hash=${msg.hash.slice(0,12)}: ${e.message}`);
    return;
  }
  // Carry chain meta from any chunk (= same TX context, all chunks share sender). Use the LAST chunk's
  // meta as anchor (= the one that completed reassembly).
  inner._tx = msg._tx;
  inner._from = msg._from;
  inner._channel = msg._channel;
  inner._at = msg._at;
  // Direct switch dispatch (mirror onBroadcastWritten switch path). J2-tn r337 fix: 加
  // oracle_stake_enroll_v1 (= v2 envelope 含 relay_address 后超 450 char SAFE_CHUNK_BUDGET,
  // chunked broadcast 进 此 path. 之前只 dispatch pool_market_published_v1 → 我 v2 enroll
  // envelope 静默 drop, 跨节点 settle DM 仍 NULL address).
  switch (inner.t) {
    case 'pool_market_published_v1':
      await handlePoolMarketPublished(inner); break;
    case 'oracle_stake_enroll_v1':
      await handleOracleStakeEnroll(inner); break;
    case 'oracle_stake_withdraw_v1':
      await handleOracleStakeWithdraw(inner); break;  // 问3 (a): cross-node-convergent oracle 撤出
    case 'pool_oracle_vote_v1':
      await handlePoolOracleVote(inner); break;
    case 'pool_bet_registered_v1':
      await handlePoolBetRegistered(inner); break;
    case 'kanet_pool_oracle_tx_sign_req_v1':
      await handlePoolOracleTxSignReq(inner); break;  // J2-tn r377: chunked sign_req (phase2_tx_obj 超 SAFE_CHUNK_BUDGET)
    case 'kanet_pool_oracle_tx_sign_resp_v1':
      await handlePoolOracleTxSignResp(inner); break;
    case 'pool_refund_request_v1':
      await handlePoolRefundRequest(inner); break;  // J2-tn r402 P0-#3: cross-node maker refund
    default:
      console.warn(`[trade-filter:chunk] reassembled unknown type t=${inner.t} hash=${msg.hash.slice(0,12)} — drop`);
  }
}

// J1 #27d (Owner public-testnet hardening sprint 2026-06-14): catch-up re-ingest for market_publishes
// whose in-mem chunk reassembly was MISSED. Root cause (demo lwrcl): a sign_req re-broadcast flood
// (stuck settles re-broadcasting chunked sign_req every ~5s) filled the in-mem POOL_CHUNK_CACHE
// (LRU max 200) → evicted a market_publish's in-progress chunks before they completed → no reassembly
// → no pool_markets row → :3300 committee members never knew they were sampled → liveness blocker.
// broadcast_messages is the DURABLE store (chunks persist there regardless of in-mem eviction). This
// reassembles from it for any market_publish whose market_id is not yet in pool_markets, then dispatches
// to handlePoolMarketPublished (idempotent: it skips if the row already exists, and verifies
// metadata_hash + maker sig → a corrupt/forged reassembly is rejected, never overwrites a correct row).
// = cross-node market-row arrival self-heals (the bshard foundation: every node reliably gets the row).
//
// NWT r1166 review points honored: ② only COMPLETE chunk-sets reassemble (sha256-verify; no half rows)
// ③ idempotent never overwrites (handler L591-595 skip-if-exists) ④ SIGNAL-TRIGGERED (called from
// orphan bet/vote handlers when market_id ∉ pool_markets) + throttled + bounded window — NOT a full
// scan every tick.
let _lastCatchUpMs = 0;
const CATCHUP_THROTTLE_MS = 30_000;   // at most one pass per 30s (orphan bets can arrive in bursts)
export async function catchUpUningestedMarkets({ windowHours = 24, force = false } = {}) {
  const now = Date.now();
  if (!force && (now - _lastCatchUpMs) < CATCHUP_THROTTLE_MS) return { scanned: 0, rebuilt: 0, throttled: true };
  _lastCatchUpMs = now;
  const sinceIso = new Date(now - windowHours * 3600 * 1000).toISOString();
  let scanned = 0, rebuilt = 0;
  const tryDispatch = async (inner, meta) => {
    if (inner?.t !== 'pool_market_published_v1' || !inner.market_id) return;
    scanned++;
    if (sqlite.prepare('SELECT 1 FROM pool_markets WHERE id = ?').get(inner.market_id)) return;  // ③ already have it
    inner._tx = meta.tx_hash; inner._from = meta.sender_address; inner._channel = meta.channel_name; inner._at = meta.created_at;
    try {
      await handlePoolMarketPublished(inner);  // idempotent + verifies metadata_hash/sig
      if (sqlite.prepare('SELECT 1 FROM pool_markets WHERE id = ?').get(inner.market_id)) {
        rebuilt++;
        console.log(`[catch-up-markets] rebuilt missed market=${inner.market_id.slice(0,12)} (was LRU-evicted/lost)`);
      }
    } catch (e) { console.warn(`[catch-up-markets] dispatch fail market=${inner.market_id?.slice(0,12)}: ${e.message}`); }
  };
  try {
    // 1. Single (unchunked) pool_market_published_v1 not yet ingested
    const singles = sqlite.prepare(
      "SELECT content, tx_hash, sender_address, channel_name, created_at FROM broadcast_messages WHERE channel_name = 'kanet-prediction' AND content LIKE '%pool_market_published_v1%' AND content NOT LIKE '%pool_market_chunk%' AND created_at > ? ORDER BY created_at DESC"
    ).all(sinceIso);
    for (const row of singles) { let inner; try { inner = JSON.parse(row.content); } catch { continue; } await tryDispatch(inner, row); }
    // 2. Chunked: group pool_market_chunk_v1 by hash, reassemble ONLY complete sets (② no half rows)
    const { createHash } = await import('crypto');
    const chunkRows = sqlite.prepare(
      "SELECT content, tx_hash, sender_address, channel_name, created_at FROM broadcast_messages WHERE channel_name = 'kanet-prediction' AND content LIKE '%pool_market_chunk_v1%' AND created_at > ? ORDER BY created_at ASC"
    ).all(sinceIso);
    const byHash = new Map();
    for (const row of chunkRows) {
      let c; try { c = JSON.parse(row.content); } catch { continue; }
      if (c?.t !== 'pool_market_chunk_v1' || !c.hash || c.ord === undefined || !c.total) continue;
      let e = byHash.get(c.hash); if (!e) { e = { total: Number(c.total), parts: new Map(), meta: row }; byHash.set(c.hash, e); }
      e.parts.set(Number(c.ord), c.data);
    }
    for (const [hash, e] of byHash) {
      if (!Number.isInteger(e.total) || e.parts.size < e.total) continue;   // ② incomplete in durable store too — real loss, skip
      const ordered = []; let complete = true;
      for (let i = 0; i < e.total; i++) { const p = e.parts.get(i); if (p === undefined) { complete = false; break; } ordered.push(p); }
      if (!complete) continue;
      const reassembled = ordered.join('');
      if (createHash('sha256').update(reassembled).digest('hex') !== hash) continue;   // corrupt — skip
      let inner; try { inner = JSON.parse(reassembled); } catch { continue; }
      await tryDispatch(inner, e.meta);   // tryDispatch filters to pool_market_published_v1 (sign_req etc. skipped)
    }
  } catch (err) { console.warn(`[catch-up-markets] scan fail: ${err.message}`); }
  if (scanned > 0 || rebuilt > 0) console.log(`[catch-up-markets] pass done: scanned=${scanned} rebuilt=${rebuilt} (window ${windowHours}h)`);
  return { scanned, rebuilt };
}

// Bettor r158 §5.3c layer 2 — anti-bot policy floor defends against malicious node directly
// broadcasting <POLICY bet to bypass producer (NWT r121 #1 命门). Hardcoded here matches
// pool.js BETTOR_MIN_STAKE_POLICY constant (= 1 KAS = 1e8 sompi). DO NOT lower without
// coordinated spec round — affects cross-node consensus.
const BETTOR_MIN_STAKE_POLICY_SOMPI = 100_000_000n;

/**
 * captureSideLockDaa — single canonical source for a bet's side_lock UTXO accepting-block daaScore.
 * (J1 #27a v2, NWT r1181 single-source mandate.) Called by BOTH the live bet-register ingest AND the
 * deploy-time backfill script (scripts/backfill-side-lock-daa.mjs) so a backfilled daa is byte-equal to
 * the daa a fresh ingest would have written — zero cross-node divergence in the committee bettor-exclude set.
 *
 * Chain truth: getUtxosByAddresses(side_p2sh) returns the UNSPENT UTXO for an OPEN position; we match it by
 * stake_amount + side_lock_tx.
 *
 * 🔴 method switch (Bettor 2026-07-08 22:04, #b75exc, 四条件批): 原实现靠查 side_p2sh 上"未花费 UTXO"反推
 * DAA, 但一笔 bet 一落地就可能被 register-v07 自己吸收进 shard 聚合 leaf(pool_value 更新), UTXO 不再"未花费"
 * → 假阴性(uqmp8 两笔真实 bet 实测撞到, 不是边角场景)。改用 kaspa_tx_log.block_hash(indexer 落链时写入的
 * 真实 accepting block) → RPC getBlock(hash).header.daaScore(链真相, rpc-listener.mjs:223-226 同款调用)——
 * 对"未花费"和"已被吸收"两态通用, 单一路径不分叉(3o6cs 当时手动 UPDATE 3 行绕过的正是这同一个洞, 这次把
 * 一次性绕路升级成生产修复)。
 *
 * ① 链锚纯度: DAA 只能来自 getBlock(block_hash).header.daaScore, block_hash 只能来自 kaspa_tx_log —
 *    禁任何 DB 猜测值/时间换算值。
 * ② fail-loud 不降级: kaspa_tx_log 查无该 tx 的 block_hash = 拒(null), 不静默回退瞎猜——side_lock_daa
 *    定的是 betsRoot canonical 序, attest 承重字段, 错值比拒绝更危险。
 *
 * @returns {Promise<{daa:number|null, reason:'ok'|'daa-unresolved'|'no-block-hash'|'not-yet-finality-safe...'|'rpc-fail: ...'}>}
 *   NEVER guesses — null over a non-canonical value.
 */
// 🔴 finality 门(2026-07-17,治本卡①第一条+K-17 发现 A 同一个洞,docs/2026-07-17-bshard-recapture-
// side-lock-daa-port-design.md): 复用 pool-market-settler-v06.mjs:43 DEFAULT_FINALITY_DEPTH 同一个
// F-S1 anti-reorg 场景(不同时间点查询收敛到同一 hash),不新拍数字——本文件不静态 import 那个模块
// (它反过来动态 import 本文件,避免制造循环依赖的静态方向),本地声明同值。
const CAPTURE_FINALITY_DEPTH = 50;
export async function captureSideLockDaa({ side_p2sh, side_lock_tx, stake_amount, network, approxDaaHint }) {
  const row = sqlite.prepare('SELECT block_hash FROM kaspa_tx_log WHERE tx_id = ?').get(side_lock_tx);
  const { getWorkingRpc } = await import('./rpc-health.js');
  const { url: rpcUrl } = await getWorkingRpc();
  if (!rpcUrl) return { daa: null, reason: 'no-rpc' };
  const { RpcClient, Encoding } = await import('kaspa-wasm');
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: network });

  // 🔴 fix (2026-07-12, 第六件大考 a4343 撞出, #gry4yj.2·ESCALATIONS 已挂账缺口): kaspa_tx_log 是本地
  // indexer, 有已知完整性缺口(reference-kaspa-tx-log-indexer-completeness-gap——同族问题今晚已在
  // checkUtxoLanded level2-B/claim1 两处撞过)——原实现命中缺口就直接 {daa:null, reason:'no-block-hash'}
  // 永久放弃, 无重试无退化, 是 a4343 propose 被卡住的根因。**不走"查 side_p2sh 未花费 UTXO 反推"那条
  // 路**(2026-07-08 method switch 注释里明确记录的历史假阴性: bet 落地后可能被 register-v07 吸收进
  // shard 聚合 leaf, UTXO 不再"未花费"——对已吸收的合法 bet 会误判查无此 tx)。改用今晚已验证的方法论:
  // indexer 未命中时, 从一个尽量近的锚点沿 selectedParentHash 有界回走(读 block 内容, 非 UTXO 集合
  // 状态, 不受"是否已花费"影响), 逐块核对 verboseData.transactionId 匹配 side_lock_tx。
  //
  // 锚点选择(复用今晚 v183 backward-walk-daa-index 基建, 同一个 DB, 不新起一套):
  //   若调用方给了 approxDaaHint(例如市场 deadline_daa——bet 必然发生在 deadline 之前, 是天然的
  //   "≥ 真实 daa"上界), 先查 spc_daa_index_coverage 有没有覆盖到这个区间, 有就直接从索引查表拿到
  //   一个非常靠近的锚块 hash 开始走(几十到几百步内必中, 不看 tip 到 deadline 之间隔了多久)。
  //   没有 hint 或索引没覆盖 → 退化到从当前 tip 走(同 §原方案), 但那样对"registration 到 recapture
  //   之间隔了很久"的市场(今晚验证局连环修复正撞上这个)会力不从心——诚实反映在 MAX_STEPS 里, 不假装
  //   兜得住所有情况。
  // 实测校准(2026-07-12, a4343 现场验证): 从 v183 索引锚点(≈deadline_daa)回走到真实 bet 落链块
  // 实测 5839 步(≈11600 DAA, ~2 DAA/步实测速率)——bet 通常在 deadline 前"一段时间"下注, 具体多久
  // 取决于市场生命周期长度。10000 步留出安全余量(约两倍实测距离), 覆盖典型验证盘/短生命周期市场;
  // 极端长生命周期市场若 bet 下得早、deadline 拖得晚, 仍可能落在此界外(fail-loud, 不是无界搜索)。
  const MAX_STEPS = 10000;
  async function _resolveStartCursor() {
    if (approxDaaHint != null && Number.isFinite(Number(approxDaaHint))) {
      try {
        const cov = sqlite.prepare('SELECT block_hash FROM spc_daa_index WHERE daa_score >= ? ORDER BY daa_score ASC LIMIT 1').get(Number(approxDaaHint));
        const covRange = sqlite.prepare('SELECT 1 FROM spc_daa_index_coverage WHERE start_daa <= ? AND end_daa >= ? LIMIT 1').get(Number(approxDaaHint), Number(approxDaaHint));
        if (cov?.block_hash && covRange) return cov.block_hash;
      } catch { /* spc_daa_index tables may not exist pre-v183 DBs — fall through to tip */ }
    }
    const info = await rpc.getBlockDagInfo();
    return info?.sink || null;
  }
  async function _scanBackwardForTx() {
    let cursor = await _resolveStartCursor();
    if (!cursor) return null;
    for (let i = 0; i < MAX_STEPS; i++) {
      const blkResp = await rpc.getBlock({ hash: cursor, includeTransactions: true });
      const blk = blkResp?.block || blkResp;
      const txs = blk?.transactions || [];
      const hit = txs.find(t => (t?.verboseData?.transactionId || t?.id) === side_lock_tx);
      if (hit) return blk;
      const sp = blk?.verboseData?.selectedParentHash;
      if (!sp || sp === '0'.repeat(64)) return null;
      cursor = sp;
    }
    return null;
  }

  let blk;
  let tipDaaScore = null;
  try {
    await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 4000))]);
    if (row?.block_hash) {
      const blkResp = await rpc.getBlock({ hash: row.block_hash, includeTransactions: false });
      blk = blkResp?.block || blkResp;
    } else {
      blk = await _scanBackwardForTx();
      // reason 字符串保持 'no-block-hash'(向后兼容既有调用方/测试的精确匹配, 语义仍是"无法解出
      // block hash"——只是现在多了一条 fallback 路径没找到, 不是历史那种"根本没试第二条路")。
      if (!blk) { try { await rpc.disconnect(); } catch {} return { daa: null, reason: 'no-block-hash' }; }
    }
    // 🔴 finality 门数据源(fetch while still connected — rpc.disconnect() fires in `finally`
    // below, before daa is even computed): current tip, compared against the resolved block's
    // daaScore after the connection closes.
    const tipInfo = await rpc.getBlockDagInfo();
    tipDaaScore = Number(BigInt(tipInfo.virtualDaaScore));
  } catch (e) {
    try { await rpc.disconnect(); } catch {}
    return { daa: null, reason: `rpc-fail: ${e.message}` };
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
  let daa = null;
  try {
    const rawDaa = blk?.header?.daaScore;
    if (rawDaa !== undefined && rawDaa !== null) daa = Number(BigInt(rawDaa));  // daa ~55M fits Number safely
  } catch { daa = null; }
  if (daa === null) return { daa: null, reason: 'daa-unresolved' };
  // 🔴 finality 门(2026-07-17,治本卡①第一条+K-17 发现 A 同一个洞): 只有 accepting-block 已过
  // CAPTURE_FINALITY_DEPTH(50)才写值——finality 前的值可能被 reorg 换成别的规范链, 写进去比留
  // NULL 更危险(NULL 至少诚实"不知道", 错值带假自信直接过 C1 guard)。
  if (tipDaaScore !== null && (tipDaaScore - daa) < CAPTURE_FINALITY_DEPTH) {
    return { daa: null, reason: `not-yet-finality-safe (tip=${tipDaaScore}, block=${daa}, depth=${tipDaaScore - daa} < ${CAPTURE_FINALITY_DEPTH})` };
  }
  return { daa, reason: 'ok' };
}

async function handlePoolBetRegistered(msg) {
  const { createHash } = await import('crypto');
  const required = ['market_id', 'bettor_pk', 'direction', 'stake_amount', 'side_p2sh', 'side_lock_tx'];
  for (const k of required) {
    if (msg[k] === undefined || msg[k] === null) {
      console.warn(`[trade-filter:bet-reg] missing ${k} market=${msg.market_id?.slice(0,12)} — reject`);
      return;
    }
  }

  // Layer 2 floor check (NWT r121 #1): defense-in-depth against malicious producer.
  let stakeSompi;
  try { stakeSompi = BigInt(msg.stake_amount); }
  catch { console.warn(`[trade-filter:bet-reg] stake_amount not integer market=${msg.market_id.slice(0,12)} val=${msg.stake_amount} — reject`); return; }
  if (stakeSompi < BETTOR_MIN_STAKE_POLICY_SOMPI) {
    console.warn(`[trade-filter:bet-reg] stake ${stakeSompi} < POLICY floor ${BETTOR_MIN_STAKE_POLICY_SOMPI} market=${msg.market_id.slice(0,12)} bettor=${msg.bettor_pk.slice(0,12)} — reject (anti-bot)`);
    return;
  }

  // Idempotent: side_lock_tx UNIQUE index → INSERT OR IGNORE handles dedup. Cheap pre-check skips
  // entire RPC roundtrip if already ingested.
  const existing = sqlite.prepare('SELECT id FROM pool_bettor_sides WHERE side_lock_tx = ?').get(msg.side_lock_tx);
  if (existing) {
    console.log(`[trade-filter:bet-reg] side_lock_tx ${msg.side_lock_tx.slice(0,16)} already ingested — skip`);
    return;
  }

  // 1. Market must exist on this node (cross-node market_publish gap → skip until market_publish lands).
  const market = sqlite.prepare(`SELECT id, spine_p2sh, market_metadata_hash, pool_merkle_root, deadline, protocol_version
    FROM pool_markets WHERE id = ?`).get(msg.market_id);
  if (!market) {
    // J1 #27d: orphan bet = signal a market_publish was missed. Fire catch-up re-ingest (throttled,
    // fire-and-forget). Once it rebuilds the row, handlePoolMarketPublished's H2 rescan replays this bet.
    console.log(`[trade-filter:bet-reg] market ${msg.market_id.slice(0,12)} not in local DB — trigger #27d catch-up re-ingest (H2 rescan then replays this bet)`);
    catchUpUningestedMarkets({ windowHours: 24 }).catch(e => console.warn(`[trade-filter:bet-reg] catch-up trigger fail: ${e.message}`));
    return;
  }

  // 2. Recompute side_p2sh + verify == payload. Path differs v0.5/v0.6/v0.7.
  // J2-tn r345 (J1 r320 catch): v0.7 path 漏 → 跨节点 bet ingest 全栈 silent skip → settle 路径
  // 0 bettors visible 跨节点 → committee 抽样后 fund-lock 错 → settle 出账失败. fix mirror api/pool.js
  // _extStakeDeriveSide_v07 (= 4 args: bettorPk + spineP2shHash + poolMerkleRoot + marketMetadataHash
  // + direction + deadline, 无 stakeAmount).
  let recomputedSideP2sh, recomputedRedeem;
  try {
    const ver = msg.protocol_version || market.protocol_version;
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');
    const network = market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    if (ver === 'v0.7') {
      const { computeSideP2SH_v07 } = await import('../lib/pool-p2sh-v07.mjs');
      const r = await computeSideP2SH_v07({
        bettorPk: msg.bettor_pk, spineP2shHash, poolMerkleRoot: market.pool_merkle_root,
        marketMetadataHash: market.market_metadata_hash, direction: msg.direction,
        deadline: market.deadline, network,
      });
      recomputedSideP2sh = r.p2shAddr; recomputedRedeem = r.redeemScript;
    } else if (ver === 'v0.6') {
      const { computeSideP2SH_v06 } = await import('../lib/pool-p2sh-v06.mjs');
      const r = await computeSideP2SH_v06({
        bettorPk: msg.bettor_pk, spineP2shHash, poolMerkleRoot: market.pool_merkle_root,
        marketMetadataHash: market.market_metadata_hash, direction: msg.direction,
        stakeAmount: msg.stake_amount, deadline: market.deadline, network,
      });
      recomputedSideP2sh = r.p2shAddr; recomputedRedeem = r.redeemScript;
    } else {
      console.warn(`[trade-filter:bet-reg] v0.5 path not implemented yet market=${msg.market_id.slice(0,12)} — skip`);
      return;
    }
  } catch (e) {
    console.warn(`[trade-filter:bet-reg] side_p2sh recompute fail market=${msg.market_id.slice(0,12)}: ${e.message}`);
    return;
  }
  if (recomputedSideP2sh !== msg.side_p2sh) {
    console.warn(`[trade-filter:bet-reg] side_p2sh mismatch market=${msg.market_id.slice(0,12)} expected=${msg.side_p2sh?.slice(0,20)} got=${recomputedSideP2sh?.slice(0,20)} — reject (spoofed bettor_pk or wrong derivation)`);
    return;
  }

  // 3. Chain truth (single-source #27a v2, NWT r1181): captureSideLockDaa does getUtxosByAddresses(side_p2sh),
  //    matches the UNSPENT UTXO by stake_amount + side_lock_tx (Bettor r113: spent = settled, skip), and reads
  //    its CANONICAL accepting-block daaScore. The SAME fn the backfill script calls → backfill daa == new-bet
  //    daa, zero divergence. The committee bettor-exclude set chain-anchors to side_lock_daa <= deadline_daa.
  const cap = await captureSideLockDaa({
    side_p2sh: msg.side_p2sh, side_lock_tx: msg.side_lock_tx, stake_amount: msg.stake_amount,
    network: market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet',
  });
  if (cap.reason === 'no-rpc' || cap.reason.startsWith('rpc-fail')) {
    console.warn(`[trade-filter:bet-reg] ${cap.reason} market=${msg.market_id.slice(0,12)} — skip (replay later)`);
    return;
  }
  if (cap.reason === 'no-unspent-utxo') {
    // Position never paid, already spent (settled), or wrong amount. Skip without INSERT —
    // settled positions don't belong in pool_bettor_sides on this remote node (settler local truth wins).
    console.log(`[trade-filter:bet-reg] no UNSPENT UTXO matching tx=${msg.side_lock_tx.slice(0,16)} amount=${msg.stake_amount} at ${msg.side_p2sh.slice(0,20)} (settled/unpaid/wrong) — skip`);
    return;
  }
  const sideLockDaa = cap.daa;  // CANONICAL accepting-block daaScore (chain consensus fact, byte-equal across nodes), or null
  if (sideLockDaa === null) console.warn(`[trade-filter:bet-reg] side_lock_daa unresolved from UTXO market=${msg.market_id.slice(0,12)} tx=${msg.side_lock_tx.slice(0,16)} — stored NULL (#27a fail-loud at sample)`);

  // 4. INSERT OR IGNORE pool_bettor_sides (UNIQUE side_lock_tx WHERE NOT NULL dedup anchor).
  //    bettor_relay_id NULL = external 0-key bettor on remote node (no local relay knows the privkey).
  try {
    const insertResult = sqlite.prepare(`INSERT OR IGNORE INTO pool_bettor_sides
      (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, side_lock_daa)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        msg.market_id, msg.bettor_pk, null, msg.direction, msg.stake_amount,
        msg.side_p2sh, msg.side_lock_tx, msg.merkle_index || null, recomputedRedeem, sideLockDaa,
      );
    if (insertResult.changes === 0) {
      const stillMissing = !sqlite.prepare('SELECT 1 FROM pool_bettor_sides WHERE side_lock_tx = ?').get(msg.side_lock_tx);
      if (stillMissing) {
        console.warn(`[trade-filter:bet-reg] INSERT OR IGNORE changes=0 AND row still missing side_lock_tx=${msg.side_lock_tx.slice(0,16)} — constraint violation? (KI 49 silent-skip)`);
        return;
      }
    }
    console.log(`[trade-filter:bet-reg] ingested market=${msg.market_id.slice(0,12)} bettor=${msg.bettor_pk.slice(0,12)} dir=${msg.direction} stake=${msg.stake_amount} tx=${msg.side_lock_tx.slice(0,16)}`);
  } catch (e) {
    console.warn(`[trade-filter:bet-reg] insert fail (likely UNIQUE dedup, ok): ${e.message}`);
  }
}

async function handleOrder(msg) {
  const orderId = msg.id;
  if (!orderId) return;

  // Check if order already exists locally (we published it ourselves)
  const existing = sqlite.prepare('SELECT id, broadcast_txid FROM mm_orders WHERE id = ?').get(orderId);

  if (existing) {
    // Local order — backfill chain anchor if missing
    if (!existing.broadcast_txid && msg._tx) {
      sqlite.prepare('UPDATE mm_orders SET broadcast_txid = ? WHERE id = ?').run(msg._tx, orderId);
      console.log(`[trade-filter] Backfilled broadcast_txid for ${orderId.slice(0, 8)}`);
    }
    return;
  }

  // Remote order — create local index
  const side = msg.t === 'kanet_sell_v1' ? 'sell' : 'buy';
  const relayNodeId = _findLocalRelay(msg._from);

  createOrder({
    id: orderId,
    relayNodeId: relayNodeId || '__remote__',
    agentAddress: msg._from,
    side,
    kasAmount: msg.amt || 0,
    price: msg.price || 0,
    chain: msg.chain || 'bnb',
    broadcastTxid: msg._tx,
  });

  // Fill addresses
  const updates = [];
  const vals = [];
  if (side === 'sell' && msg.recv) {
    updates.push('mm_receive_address = ?');
    vals.push(msg.recv);
  }
  if (side === 'buy' && msg.pay_from) {
    updates.push('customer_pay_address = ?');
    vals.push(msg.pay_from);
  }
  if (updates.length) {
    vals.push(orderId);
    sqlite.prepare(`UPDATE mm_orders SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  }

  console.log(`[trade-filter] Remote order indexed: ${orderId.slice(0, 8)} ${side} ${msg.amt} KAS @ ${msg.price}`);
}

async function handleAccept(msg) {
  const orderId = msg.ref;
  if (!orderId) return;

  const order = getOrder(orderId);
  if (!order) {
    console.log(`[trade-filter] Accept for unknown order ${orderId.slice(0, 8)}, skipping`);
    return;
  }

  if (order.status !== 'published') {
    console.log(`[trade-filter] Accept for ${orderId.slice(0, 8)} but status=${order.status}, keeping as candidate`);
    return; // Order already accepted — this accept stays on chain as candidate
  }

  // Limit check
  const usdtAmt = order.kas_amount * (order.price || 0);
  const limitCheck = checkLimits(msg._from, order.kas_amount, usdtAmt, order.mode || 'manual');
  if (!limitCheck.ok) {
    console.log(`[trade-filter] Accept rejected for ${orderId.slice(0, 8)}: ${limitCheck.error}`);
    return; // Conditions not met, order stays published for next candidate
  }

  // Transition
  const result = transition(orderId, 'accepted', { txHash: msg._tx });
  if (!result.ok) {
    console.log(`[trade-filter] Accept transition failed: ${result.error}`);
    return;
  }

  // Update peer address
  sqlite.prepare('UPDATE mm_orders SET peer_address = ? WHERE id = ?').run(msg._from, orderId);
  if (msg.kas_addr) {
    sqlite.prepare('UPDATE mm_orders SET customer_address = ? WHERE id = ?').run(msg.kas_addr, orderId);
  }

  // Execution tracking
  quickStart({
    type: 'accept_order',
    source: 'peer',
    agentAddress: order.agent_address,
    orderId,
  });

  // Create counterparty order if counter_id provided
  if (msg.counter_id) {
    const counterSide = order.side === 'sell' ? 'buy' : 'sell';
    const relayNodeId = _findLocalRelay(msg._from);

    createOrder({
      id: msg.counter_id,
      relayNodeId: relayNodeId || '__remote__',
      agentAddress: msg._from,
      side: counterSide,
      kasAmount: order.kas_amount,
      price: order.price,
      chain: msg.chain || order.chain || 'bnb',
      peerAddress: order.agent_address,
      counterpartyOrderId: orderId,
      broadcastTxid: msg._tx,
    });

    // Fill pay_from on buyer's order
    if (msg.pay_from) {
      const buyerId = counterSide === 'buy' ? msg.counter_id : orderId;
      sqlite.prepare('UPDATE mm_orders SET customer_pay_address = ? WHERE id = ?').run(msg.pay_from, buyerId);
    }

    linkOrders(orderId, msg.counter_id);

    // Accept counterparty order too
    transition(msg.counter_id, 'accepted', { txHash: msg._tx, force: true });
    quickStart({
      type: 'accept_order',
      source: 'peer',
      agentAddress: msg._from,
      orderId: msg.counter_id,
    });
  }

  console.log(`[trade-filter] Accept: ${orderId.slice(0, 8)} by ${msg._from.slice(-12)}`);
}

async function handlePaid(msg) {
  const orderId = msg.id;
  if (!orderId || !msg.tx) return;

  const order = getOrder(orderId);
  if (!order) return;

  // Only process if not already paid
  if (['paid', 'verified', 'delivering', 'completed'].includes(order.status)) return;

  transition(orderId, 'paid', { txHash: msg.tx });

  recordChainEvent({
    txid: msg.tx,
    eventType: 'payment',
    fromAddress: msg._from,
    toAddress: msg.to,
    amount: msg.amt,
    observedBy: 'protocol',
    payload: { orderId, chain: msg.chain },
  });

  console.log(`[trade-filter] Paid: ${orderId.slice(0, 8)} TX=${msg.tx.slice(0, 16)}`);
}

// Oracle v0.3 sub 10.x — SS SPOF Path A ingest (NWT r66 + r67 + Bettor r118 hash-anchor model).
// 5/28 Bettor r118: chain payload = hash-anchor minimal (= no ctor_params inline). Sig verify deferred
// to recovery time when local cache provides ctor_params. Ingest only verifies hash + sigs present.
async function handlePredictionParams(msg) {
  if (!msg.offer_id || !msg.params_hash || !msg.maker_sig || !msg.taker_sig) {
    console.warn(`[trade-filter] kanet_prediction_params_v1 missing required fields (offer_id/params_hash/maker_sig/taker_sig) tx=${msg._tx?.slice(0,12)}`);
    return;
  }
  // Hash format sanity check (= 64 hex chars sha256)
  if (!/^[0-9a-f]{64}$/i.test(msg.params_hash)) {
    console.warn(`[trade-filter] kanet_prediction_params_v1 invalid hash format offer=${msg.offer_id.slice(0,12)} — REJECT ingest`);
    return;
  }
  // v2 hash-anchor: skip dual-sig verify here (= no ctor_params for pubkey derive). Recovery time verify.
  // v1 legacy (ctor_params inline) — still supported via dual-sig verify path.
  if (msg.ctor_params) {
    try {
      const { verifyParamsDualSig, computeParamsHash } = await import('./prediction-params-cache.js');
      const recomputedHash = computeParamsHash(msg.ctor_params);
      if (recomputedHash !== msg.params_hash) {
        console.warn(`[trade-filter] kanet_prediction_params_v1 v1 hash mismatch offer=${msg.offer_id.slice(0,12)} — REJECT ingest`);
        return;
      }
      const sigCheck = await verifyParamsDualSig(msg);
      if (!sigCheck.valid) {
        console.warn(`[trade-filter] kanet_prediction_params_v1 v1 dual-sig REJECT offer=${msg.offer_id.slice(0,12)}: ${sigCheck.reason}`);
        return;
      }
    } catch (e) {
      console.warn(`[trade-filter] kanet_prediction_params_v1 v1 verify exception: ${e.message}`);
      return;
    }
  }
  recordChainEvent({
    txid: msg._tx,
    eventType: 'kanet_prediction_params_v1',
    fromAddress: msg._from,
    toAddress: null,
    observedBy: 'protocol',
    payload: msg,
  });
  console.log(`[trade-filter] kanet_prediction_params_v1 ingest offer=${msg.offer_id.slice(0,12)} tx=${msg._tx?.slice(0,12)} model=${msg.v === 2 ? 'hash-anchor' : 'v1-legacy'}`);
}

async function handleDelivered(msg) {
  const orderId = msg.id;
  if (!orderId || !msg.tx) return;

  const order = getOrder(orderId);
  if (!order) return;

  if (order.status === 'completed') return;

  transition(orderId, 'completed', { txHash: msg.tx });

  recordChainEvent({
    txid: msg.tx,
    eventType: 'kas_delivery',
    fromAddress: msg._from,
    toAddress: msg.to,
    amount: msg.amt,
    observedBy: 'protocol',
    payload: { orderId },
  });

  console.log(`[trade-filter] Delivered: ${orderId.slice(0, 8)} TX=${msg.tx.slice(0, 16)}`);
}

async function handleCancel(msg) {
  const orderId = msg.id;
  if (!orderId) return;

  const order = getOrder(orderId);
  if (!order) return;

  // Only the publisher can cancel their own order
  if (order.agent_address !== msg._from) {
    console.log(`[trade-filter] Cancel rejected: sender ${msg._from.slice(-12)} is not the publisher`);
    return;
  }

  const result = transition(orderId, 'cancelled', {
    reason: msg.reason || 'Cancelled via protocol broadcast',
  });
  if (result.ok) {
    console.log(`[trade-filter] Cancelled: ${orderId.slice(0, 8)}`);
  }
}

async function handleTimeout(msg) {
  const orderId = msg.id;
  if (!orderId) return;

  const order = getOrder(orderId);
  if (!order) return;

  // Revert to published
  transition(orderId, 'published', {
    reason: `Timeout: ${msg.reason} (${msg.who})`,
    force: true,
  });

  console.log(`[trade-filter] Timeout revert: ${orderId.slice(0, 8)} → published (was: ${msg.at_status})`);

  // Try next accept candidate from chain
  await tryNextAccept(orderId);
}

/**
 * After a timeout revert, scan the order's channel for other kanet_accept_v1
 * messages that weren't processed (because the order was already accepted).
 */
async function tryNextAccept(orderId) {
  const order = getOrder(orderId);
  if (!order || order.status !== 'published') return;

  // Find all accept broadcasts in this order's channel
  const accepts = sqlite.prepare(`
    SELECT * FROM broadcast_messages
    WHERE channel_name = ?
      AND content LIKE '%"t":"kanet_accept_v1"%'
    ORDER BY created_at ASC
  `).all(orderId);

  // Find timed-out addresses (skip them)
  const timedOut = new Set();
  const timeouts = sqlite.prepare(`
    SELECT content FROM broadcast_messages
    WHERE channel_name = ?
      AND content LIKE '%"t":"kanet_timeout_v1"%'
  `).all(orderId);
  for (const t of timeouts) {
    try {
      const p = JSON.parse(t.content);
      if (p.who) timedOut.add(p.who);
    } catch {}
  }

  for (const row of accepts) {
    if (timedOut.has(row.sender_address)) continue;

    // Try this candidate
    const msg = JSON.parse(row.content);
    msg._tx = row.tx_hash;
    msg._from = row.sender_address;
    msg._channel = row.channel_name;
    msg._at = row.created_at;

    await handleAccept(msg);

    // Check if it worked
    const updated = getOrder(orderId);
    if (updated && updated.status === 'accepted') {
      console.log(`[trade-filter] Next candidate accepted: ${row.sender_address.slice(-12)}`);
      break;
    }
  }
}

// ── Exchange Protocol (v1.1 自由市场) ────────────────────────

import { randomUUID } from 'crypto';
import { processAccept as machineAccept, processManualConfirm, processCancel as machineCancel, processPaymentSubmit, transition as exchangeTransition } from './exchange-machine.js';

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
 * Derive market_key: alphabetical sort ensures KAS|USDT === USDT|KAS
 */
function _deriveMarketKey(giveAsset, wantAsset) {
  return [giveAsset, wantAsset].sort().join('|');
}

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

  const offerId = msg.id || randomUUID();
  const msgIndex = msg.message_index || 0;

  // Idempotent: skip if already indexed
  const existing = sqlite.prepare(
    'SELECT id FROM exchange_offers WHERE broadcast_tx_id = ? AND message_index = ?'
  ).get(msg._tx, msgIndex);
  if (existing) return;

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
 * Single-side first: only accept BUY offers (maker gives KAS, wants USDT → we pay USDT, get KAS).
 * Default mode is 'approval' — creates a proposal in execution_states for Owner to confirm.
 */
async function _evaluateAutoTake(offerId, msg) {
  if (_autoTakeLock) return;

  // 1. Check enabled
  const { getConfig } = await import('../data/settings/configs.js');
  const enabled = await getConfig('autotake_enabled');
  if (enabled !== 'true') return;

  // 2. Skip own offers (trap #53)
  const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
  if (localAddrs.includes(msg._from)) return;

  // 3. Only auto-verifiable offers
  if (msg.verification === 'manual') return;

  // 4. Skip expired
  if (msg.expires_at && new Date(msg.expires_at) < new Date()) return;

  // 5. Direction: only BUY (maker gives KAS, wants USDT)
  if (msg.give_asset?.toUpperCase() !== 'KAS' || msg.want_asset?.toUpperCase() !== 'USDT') return;

  // 5b. Check accepted_chains includes a chain we can pay on (bnb default)
  const meta = msg.verification_meta || {};
  const acceptedChains = meta.accepted_chains || [];
  const payChain = acceptedChains.find(c => ['bnb', 'eth', 'sol', 'tron'].includes(c)) || (acceptedChains.length === 0 ? 'bnb' : null);
  if (!payChain) return;

  // 6. Price evaluation
  const { getCachedKasPrice } = await import('./market-data.js');
  const marketPrice = getCachedKasPrice();
  if (!marketPrice) return; // price=0 protection — cache expired, skip

  const giveAmt = parseFloat(msg.give_amount);
  const wantAmt = parseFloat(msg.want_amount);
  if (!giveAmt || !wantAmt) return;

  const offerPrice = wantAmt / giveAmt; // USDT per KAS
  const discount = (marketPrice - offerPrice) / marketPrice;
  const minDiscount = parseFloat(await getConfig('autotake_min_discount_pct') || '0.5') / 100;
  if (discount < minDiscount) return; // not cheap enough

  // 7. Amount cap
  const maxUsdt = parseFloat(await getConfig('autotake_max_amount_usdt') || '50');
  if (wantAmt > maxUsdt) return;

  // 8. Daily limit
  const today = new Date().toISOString().slice(0, 10);
  const dailyCount = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM chain_events WHERE event_type = 'autotake_accepted' AND observed_at >= ?"
  ).get(today + 'T00:00:00Z')?.cnt || 0;
  const dailyLimit = parseInt(await getConfig('autotake_daily_limit') || '3');
  if (dailyCount >= dailyLimit) return;

  // 9. Cooldown (configurable, default 30s, UTXO conflict prevention)
  const cooldownMs = (parseInt(await getConfig('autotake_cooldown_sec') || '30')) * 1000;
  if (_lastAutoTakeAt && Date.now() - _lastAutoTakeAt < cooldownMs) return;

  // 10. Find best local agent (has BNB wallet with most USDT)
  let bestRelay = null;
  for (const addr of localAddrs) {
    const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(addr);
    if (!relay) continue;
    const wallet = sqlite.prepare(
      "SELECT * FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1"
    ).get(relay.id);
    if (!wallet) continue;
    // No cached_balance column — accept first wallet with privkey, actual balance checked at pay time
    bestRelay = relay.id;
    break;
  }
  if (!bestRelay) return;

  console.log(`[autoTaker] opportunity: ${giveAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market ${marketPrice})`);

  // 10b. ── Reputation gate ──
  // Wire existing reputation.js into the autoTaker decision path.
  // Previously isAutoTradeAllowed() existed but was never called.
  try {
    const { assessReputation, isAutoTradeAllowed } = await import('./reputation.js');
    const myAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(bestRelay)?.address;
    if (myAddr) {
      const rep = assessReputation(myAddr, msg._from);
      const gate = isAutoTradeAllowed(rep);
      if (!gate.allowed) {
        console.log(`[autoTaker] REPUTATION BLOCK: ${gate.reason} (peer risk=${rep.risk}) — skipping offer ${offerId.slice(0, 8)}`);
        // Record a chain event so this decision is audit-visible
        try {
          const { recordChainEvent } = await import('./chain-event.js');
          recordChainEvent({
            txid: 'autotake_rep_block_' + offerId.slice(0, 12),
            eventType: 'autotake_reputation_block',
            payload: JSON.stringify({ offer_id: offerId, peer: msg._from, risk: rep.risk, reason: gate.reason, warnings: rep.warnings }),
          });
        } catch {}
        return;
      }
      // Medium risk: halve the effective size cap for this trade
      if (gate.limitMultiplier && gate.limitMultiplier < 1) {
        const reducedCap = maxUsdt * gate.limitMultiplier;
        if (wantAmt > reducedCap) {
          console.log(`[autoTaker] REPUTATION CAP: peer risk=${rep.risk}, effective cap $${reducedCap.toFixed(2)} < wantAmt $${wantAmt} — skipping`);
          return;
        }
        console.log(`[autoTaker] reputation=${rep.risk} — proceeding with ${(gate.limitMultiplier * 100).toFixed(0)}% limit multiplier`);
      }
    }
  } catch (e) {
    console.error(`[autoTaker] reputation check failed: ${e.message} — proceeding conservatively (block)`);
    return;  // fail-closed: if rep check errors, don't auto-trade
  }

  // 11. Mode: approval (default) or auto
  const mode = await getConfig('autotake_mode') || 'approval';
  if (mode === 'auto') {
    _autoTakeLock = true;
    try {
      await _executeAutoTake(offerId, bestRelay, payChain);
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
      displaySummary: `AutoTake: BUY ${giveAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market $${marketPrice})`,
      actionDetails: JSON.stringify({ offerId, offerPrice, marketPrice, discount, chain: 'bnb', relayId: bestRelay }),
    });
    console.log(`[autoTaker] proposal created for offer ${offerId.slice(0, 8)}`);
  }
}

/**
 * Execute auto-take by calling the internal accept API endpoint.
 * Reuses the full exchange.js accept path — broadcast, meta writes, auto-pay trigger.
 */
async function _executeAutoTake(offerId, relayId, selectedChain = 'bnb') {
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
  const _hedgeGateOffer = sqlite.prepare(
    "SELECT meta FROM exchange_offers WHERE id = ? LIMIT 1"
  ).get(offerId);
  if (!_hedgeGateOffer) {
    console.log(`[exchange-hedge] offer ${offerId.slice(0, 8)} not found — skip`);
    return;
  }
  let _hedgeGateMeta = {};
  try { _hedgeGateMeta = JSON.parse(_hedgeGateOffer.meta || '{}'); } catch {}
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

  // Get best available exchange account (prefer specified CEX, fallback to default)
  let account = null;
  if (preferredCex) {
    const normalized = HEDGE_CEX_MAP[preferredCex.toLowerCase()] || preferredCex.toLowerCase();
    account = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ?').get(normalized);
  }
  if (!account) {
    account = sqlite.prepare(
      'SELECT * FROM exchange_accounts WHERE is_default = 1 LIMIT 1'
    ).get() || sqlite.prepare('SELECT * FROM exchange_accounts LIMIT 1').get();
  }

  if (!account) {
    console.log(`[exchange-hedge] No exchange account configured — cannot hedge ${offerId.slice(0, 8)}`);
    return;
  }

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
      try { return JSON.parse(_hedgeGateOffer.meta || '{}').user_kasia_address || null; } catch { return null; }
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
  const chain = offer.taker_chain || msg.payment_chain;
  processPaymentSubmit({ offer_id: msg.offer_id, payment_tx: msg.payment_tx, payment_chain: chain });

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

  const result = await transferUsdt(chain, wallet.privkey_encrypted, receiveAddress, amount);
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

  let paidTxId = null;
  const MAX_BCAST_RETRIES = 5;
  const BCAST_RETRY_MS = 200; // Kaspa 10 BPS (0.1s blocks) — 200ms between retries is generous
  for (let attempt = 1; attempt <= MAX_BCAST_RETRIES; attempt++) {
    try {
      const bcastResult = await sendCommandAsync(takerRelayNodeId, {
        type: 'send_broadcast',
        channel: 'kanet-exchange',
        message: paidMsg,
      }, undefined, 'internal');
      if (bcastResult?.error) {
        // sendCommandAsync resolves with {error} instead of rejecting
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
      await new Promise(r => setTimeout(r, BCAST_RETRY_MS * attempt));
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

  processPaymentSubmit({ offer_id: offer.id, payment_tx: result.txHash, payment_chain: chain });
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

    let paidBroadcastOk = false;
    for (let pa = 1; pa <= 5; pa++) {
      try {
        const pr = await sendCommandAsync(takerRelayNodeId, {
          type: 'send_broadcast',
          channel: 'kanet-exchange',
          message: paidMsg,
        }, undefined, 'internal');
        if (pr?.txId) { paidBroadcastOk = true; break; }
      } catch (err) {
        console.error(`[exchange-autosend] paid broadcast attempt ${pa}/5: ${err.message}`);
      }
      if (pa < 5) await new Promise(r => setTimeout(r, 200 * pa));
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
