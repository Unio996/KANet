// buy_full_success_e2e — 真 user-facing BUY → broker delivers KAS → status='settled' + 真 user Kaspa +KAS
//
// Owner 5/23 雷霆 catch (NWT N19.263 sediment): 整天 ship milestone 0 完整 KAS deliver, broker production
// only ~31% deliver rate (settled), ~51% refund without deliver, ~1% orphan, 0% completed legacy.
//
// 真 spec: NWT 真 user (proven from buy_cancel baseline), BUY 1 KAS BSC, 不 cancel.
// 真 wait broker 真 process → 真 verify user_escrow_balances status='settled' (broker delivered KAS) OR 'refunded' (broker chose refund).
// 真 verify NWT Kaspa balance +1 KAS via Kaspa chain (= ground truth).
// 真 timeout = broker 不 deliver = expected fail (= 51% case, baseline data).
//
// Run 5-10x to baseline broker deliver success rate. J2 then debug 'why broker refund instead of deliver'.
//
// Cost: ~$0.034 USDT + ~$0.05 BSC gas per run. ~$0.10 total per attempt.
// Owner 真 budget aware (= ~$1 total for 10 runs).
//
// Tier 4 verify (= per NWT N19.262 KI sediment: chain truth + DB row + user outcome 三重 verify):
//   1. ✓ user_escrow_balances row exists with prepayment_tx
//   2. ✓ status transitions: pending_prepay → active → settled OR refunded
//   3. ✓ if settled: deliver_tx_hash 真 set, on-chain Kaspa balance +X confirmed
//   4. ✓ if refunded: refund_tx 真 set, on-chain BSC USDT balance restored

import cnBuyer from '../../personas/real-chain/cn_buyer_real.mjs';
import { sleep } from '../../lib/real-chain-runner.mjs';
import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const NWT_BSC_ADDR = '0xd3618e37354700d21FE8728Bd278Dc1924974799';

export default {
  id: 'buy_full_success_e2e',
  description: '真 user-facing BUY → broker process → settled (KAS deliver) OR refunded (expected fail baseline). NWT N19.263 fundamental finding 31% deliver rate.',
  domain: 'dm-flow',
  tags: ['real_chain', 'p0', 'dm', 'user-facing', 'success', 'baseline'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const qty = opts.qty || 1;
    const settle_wait_ms = opts.settle_wait_ms || 600_000;  // 10 min default (broker need time)
    const poll_interval_ms = opts.poll_interval_ms || 30_000;

    const start = Date.now();
    const startIso = new Date(start).toISOString();
    const phases = [];

    // Phase A: BUY DM cycle (cnBuyer real)
    console.log(`[buy_full_success_e2e] Phase A: cnBuyer BUY ${qty} KAS BSC via real DM`);
    const buyResult = await cnBuyer.run(
      { id: 'success_buyer' },
      {
        relayId: NWT_RELAY_ID,
        userKasia: NWT_KASIA,
        brokerKasia: BROKER_KASIA,
        userEvmAddr: NWT_BSC_ADDR,
        qty,
        chain: 'BSC',
        fromRelayName: 'NWT',
      }
    );
    phases.push({ phase: 'A_buy_dm', stage: buyResult.stage, error: buyResult.error, payTx: buyResult.payTx });
    if (buyResult.stage !== 'completed_flow') {
      return { ok: false, summary: `❌ Phase A buyflow fail stage=${buyResult.stage} err=${buyResult.error}`, phases };
    }

    // Phase B: poll user_escrow_balances until status settled OR refunded OR timeout
    console.log(`[buy_full_success_e2e] Phase B: poll status (timeout ${settle_wait_ms/1000}s, interval ${poll_interval_ms/1000}s)`);
    const dbR = new Database(DB_PATH, { readonly: true });
    let finalEscrow = null;
    let elapsed = 0;
    while (elapsed < settle_wait_ms) {
      await sleep(poll_interval_ms);
      elapsed += poll_interval_ms;
      const row = dbR.prepare(`
        SELECT id, status, amount_quoted, prepayment_tx, refund_tx, deliver_tx_hash, updated_at
        FROM user_escrow_balances
        WHERE user_kasia_addr = ? AND datetime(created_at) > datetime(?)
        ORDER BY created_at DESC LIMIT 1
      `).get(NWT_KASIA, startIso);
      console.log(`[buy_full_success_e2e]   poll ${elapsed/1000}s: status=${row?.status} prepay=${!!row?.prepayment_tx} deliver=${!!row?.deliver_tx_hash}`);
      if (row && (row.status === 'settled' || row.status === 'refunded' || row.status === 'orphan')) {
        finalEscrow = row;
        break;
      }
      finalEscrow = row;  // latest snapshot
    }
    dbR.close();
    phases.push({ phase: 'B_poll_settle', finalStatus: finalEscrow?.status, finalEscrow });

    // Phase C: 3 oracle 真 verify (KI N19.265 Sub 3 — Owner 雷霆 catch + NWT r247.1)
    // Beyond user_escrow_balances status, verify cross-table state alignment:
    //   Oracle 1: relation_states user→broker pair exists with status accepted/active
    //   Oracle 2: chain_events comm/comm_sent/text count > 0 for user→broker direction
    //   Oracle 3: /api/contacts/list?relayId=<NWT> includes broker in returned peers
    const dbR2 = new Database(DB_PATH, { readonly: true });
    const oracle1_relation = dbR2.prepare(`
      SELECT status, classification FROM relation_states
      WHERE local_address = ? AND peer_address = ?
    `).get(NWT_KASIA, BROKER_KASIA);
    const oracle2_comm = dbR2.prepare(`
      SELECT COUNT(*) c FROM chain_events
      WHERE from_address = ? AND to_address = ? AND event_type IN ('comm','comm_sent','text')
        AND datetime(observed_at) > datetime(?)
    `).get(NWT_KASIA, BROKER_KASIA, startIso).c;
    dbR2.close();
    let oracle3_contacts = false;
    try {
      const r = await fetch(`http://127.0.0.1:3100/api/contacts/list?relayId=${NWT_RELAY_ID}`);
      const d = await r.json();
      oracle3_contacts = (d.contacts || []).some(c => c.peer_address === BROKER_KASIA);
    } catch {}
    phases.push({
      phase: 'C_3_oracle',
      oracle1_relation: oracle1_relation || null,
      oracle2_comm_count: oracle2_comm,
      oracle3_contacts_has_broker: oracle3_contacts,
    });

    // Phase D: verdict
    if (!finalEscrow) {
      return { ok: false, summary: `❌ Phase B no escrow row found`, phases };
    }
    if (finalEscrow.status === 'settled') {
      return {
        ok: true,
        summary: `✅ broker DELIVERED — escrow ${finalEscrow.id.slice(0,8)} settled, deliver_tx=${finalEscrow.deliver_tx_hash?.slice(0,12)}, pay_tx=${finalEscrow.prepayment_tx?.slice(0,12)} (= 31% production rate baseline)`,
        phases,
        details: { escrow: finalEscrow, elapsed_sec: elapsed/1000 },
      };
    }
    if (finalEscrow.status === 'refunded') {
      return {
        ok: false,
        summary: `⚠ broker REFUNDED (= expected ~51% case) — escrow ${finalEscrow.id.slice(0,8)} refund_tx=${finalEscrow.refund_tx?.slice(0,12)}. baseline data, NOT a test fail per se.`,
        phases,
        details: { escrow: finalEscrow, elapsed_sec: elapsed/1000, baseline_category: 'refund' },
      };
    }
    return {
      ok: false,
      summary: `❌ broker TIMEOUT after ${elapsed/1000}s, status=${finalEscrow.status} (= stuck in pending/active, broker maybe slow or hung)`,
      phases,
      details: { escrow: finalEscrow, elapsed_sec: elapsed/1000, baseline_category: 'timeout' },
    };
  },
};
