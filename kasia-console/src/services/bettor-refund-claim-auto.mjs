// bettor-refund-claim-auto.mjs — DoD C 收尾 (Bettor r393 钦点 自动领).
//
// 实用户不用手动调 endpoint: cron 扫 chain_events bettor_refund_available, 自动领未领的
// sides via deriveXOnlyPubkey(relay.address)==bettor_pk + relay 本节点 running. 不在本节点
// 的 skip 留给那节点 cron 自己 — 跨节点天然分担, 无需中心协调.
//
// 复用 POST /api/pool/market/:id/bettor-refund-claim 同 6 步逻辑 (= byte-size mass-aware fee
// + grace lockTime + IPC pool_side_refund_cancelled_tx). UPDATE pool_bettor_sides SET
// claim_txid 防重复领.

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';
import { isRelayAlive } from './relay-manager.js';
// J1tn r303 (Bettor 03:19 v3 approve): de-dup REFUND_GRACE_SEC hardcode → shared const.
import { REFUND_GRACE_SEC } from '../lib/pool-refund-grace.mjs';
// J1tn r303 P0-#1 sweep helper refactor (Bettor r346/r366b 钦定): KIP-9 storage_mass aware fee
// 抽 lib/kip9-mass.mjs. 5 call sites 不再各抄.
import { computeSingleOutputFee } from '../lib/kip9-mass.mjs';

const TICK_INTERVAL_MS = 5 * 60 * 1000;  // 5 min, 同 pool-market-settler
const STARTUP_GRACE_MS = 60 * 1000;

let timer = null;
let running = false;

async function _deriveXOnlyPubkey(address) {
  const kaspa = await import('kaspa-wasm');
  return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
}

export async function claimAutoDispatcherTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    // Bettor r394 catch: market.protocol_status='cancelled' 是 transient (= cancelled →
    // refunding → refunded after maker 退款落链). 5min cron 跑时多半已 refunded → 永抓不到.
    // 该按真实信号 bettor_refund_available chain_event 过滤 (= 一旦 emitted 永久 audit 不变).
    // JOIN chain_events: event_type='bettor_refund_available' AND payload like '%"market_id":"X"%'
    // AND payload like '%"bettor_pk":"P"%' → side claim_txid IS NULL.
    const sides = sqlite.prepare(`
      SELECT s.id, s.market_id, s.bettor_pk, s.side_p2sh, s.side_lock_tx, s.side_redeem_script_hex,
             s.stake_amount, s.direction, m.deadline, m.protocol_status
      FROM pool_bettor_sides s
      JOIN pool_markets m ON m.id = s.market_id
      WHERE s.claim_txid IS NULL
        AND s.side_lock_tx IS NOT NULL
        AND s.side_redeem_script_hex IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM chain_events ce
          WHERE ce.event_type = 'bettor_refund_available'
            AND ce.payload LIKE '%"market_id":"' || s.market_id || '"%'
            AND ce.payload LIKE '%"bettor_pk":"' || s.bettor_pk || '"%'
        )
    `).all();
    if (sides.length === 0) return { ok: true, processed: 0 };

    const relayCandidates = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE address IS NOT NULL').all();
    let dispatched = 0, skippedRemote = 0, errored = 0;

    for (const side of sides) {
      try {
        // Resolve signing relay (= deriveXOnlyPubkey match, 同 endpoint 逻辑).
        let signingRelay = null;
        for (const row of relayCandidates) {
          try {
            const pk = await _deriveXOnlyPubkey(row.address);
            if (String(pk).toLowerCase() === String(side.bettor_pk).toLowerCase()) {
              signingRelay = row;
              break;
            }
          } catch {}
        }
        if (!signingRelay) {
          // Bettor not on this node — skip, leave for the node that hosts this bettor relay.
          skippedRemote++;
          continue;
        }
        // Verify relay process alive (= IPC可达).
        const aliveCheck = isRelayAlive(signingRelay.id);
        if (!aliveCheck?.alive) {
          console.warn(`[claim-auto] relay ${signingRelay.id.slice(0,8)} not alive (${aliveCheck?.reason || 'unknown'}), defer side=${side.id}`);
          continue;
        }

        // Byte-size mass-aware fee + KIP-9 storage_mass (= helper refactor lib/kip9-mass.mjs).
        // J1tn r303 P0-#1 sweep (Bettor r341+r346/r366b 钦定 helper refactor): 5 site 收一处.
        const redeemBytes = Buffer.from(side.side_redeem_script_hex, 'hex');
        const sigScriptSize = 70 + redeemBytes.length;
        const txByteEstimate = 45 + sigScriptSize + 50 + 80;
        const computeMassEst = Math.ceil(txByteEstimate * 2.5);
        const sideStakeInt = parseInt(side.stake_amount, 10) || 1_000_000_000;
        const feeResult = computeSingleOutputFee(computeMassEst, sideStakeInt, 1000, 100_000_000);
        const fee = feeResult.dynamicFee;

        const stakeSompi = BigInt(side.stake_amount);
        const outAmount = stakeSompi - BigInt(fee);
        if (outAmount <= 1000n) {
          console.warn(`[claim-auto] side=${side.id} output ${outAmount} <= dust, fee=${fee} too high vs stake ${stakeSompi}, skip`);
          continue;
        }

        const lockTime = (BigInt(side.deadline) + BigInt(REFUND_GRACE_SEC)) * 1000n;

        const submitResult = await sendCommandAsync(signingRelay.id, {
          type: 'pool_side_refund_cancelled_tx',
          side_p2sh_address: side.side_p2sh,
          side_redeem_script_hex: side.side_redeem_script_hex,
          required_input_outpoint: { outpointTxid: side.side_lock_tx, outpointIndex: 0 },
          output: { address: signingRelay.address, amountSompi: outAmount.toString() },
          lock_time: lockTime.toString(),
        });
        if (!submitResult?.ok || !submitResult.txId) {
          // Bettor r400 catch: 'No UTXOs at side P2SH' = 已花 (= 已领 但 DB claim_txid 没 set).
          // 自愈 mark side as claimed via sentinel (= prevent forever retry).
          const errStr = String(submitResult?.error || '').toLowerCase();
          if (errStr.includes('no utxos at side p2sh')) {
            console.log(`[claim-auto] side=${side.id} bettor=${side.bettor_pk.slice(0,12)} side UTXO already spent (= manually claimed off-band), mark side as claimed via sentinel.`);
            sqlite.prepare("UPDATE pool_bettor_sides SET claim_txid = 'utxo_already_spent', refund_attempted_at = CURRENT_TIMESTAMP WHERE id = ?")
              .run(side.id);
            continue;
          }
          console.warn(`[claim-auto] side=${side.id} relay submit fail: ${submitResult?.error || 'no txId'}`);
          errored++;
          continue;
        }
        sqlite.prepare('UPDATE pool_bettor_sides SET claim_txid = ?, refund_attempted_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(submitResult.txId, side.id);
        console.log(`[claim-auto] CLAIMED side=${side.id} bettor=${side.bettor_pk.slice(0,12)} claim_txid=${submitResult.txId.slice(0,16)} stake=${stakeSompi} fee=${fee} out=${outAmount}`);
        dispatched++;
      } catch (e) {
        console.error(`[claim-auto] side=${side.id} exception: ${e.message}`);
        errored++;
      }
    }

    console.log(`[claim-auto] tick: ${sides.length} unclaimed, dispatched=${dispatched} skippedRemote=${skippedRemote} errored=${errored}`);
    return { ok: true, processed: sides.length, dispatched, skippedRemote, errored };
  } finally {
    running = false;
  }
}

export function startBettorRefundClaimAutoCron() {
  if (timer) return;
  console.log('[claim-auto] started — 5min cron, auto-dispatch unclaimed bettor refunds for cancelled markets (DoD C 收尾 Bettor r393).');
  setTimeout(() => {
    claimAutoDispatcherTick().catch(e => console.error('[claim-auto] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    claimAutoDispatcherTick().catch(e => console.error('[claim-auto] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopBettorRefundClaimAutoCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
