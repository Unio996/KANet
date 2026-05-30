#!/usr/bin/env node
// scripts/regression-runner.mjs — Plan A real-chain orchestrator (NWT-tn r97 propose, Bettor r4 ACK)
// (A) v0.5 baseline snapshot — capture existing chain history as backward-compat baseline
//     run: node scripts/regression-runner.mjs --mode=baseline --out=baseline.v0.5.json
// (B) v0.6 compat verify — diff post-v0.6 chain state vs baseline (TODO, wait spec doc + ship)
// (C) autobet hybrid stress — measure cost diff pre/post hybrid (TODO, wait sub B ship)

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = 'D:/kanet-tn12/kasia-console/data/console.db';

const args = process.argv.slice(2);
function arg(name, def) {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

const mode = arg('mode', 'baseline');
const outPath = arg('out', 'baseline.v0.5.json');

if (mode !== 'baseline') {
  console.error(`Only --mode=baseline implemented. (B)(C) await v0.6 ship + spec doc.`);
  process.exit(1);
}

async function captureBaseline() {
  const db = new Database(DB_PATH, { readonly: true });

  // 1. Settle TX (= 1V1 + pool consensual dispatch)
  const settleEvents = db.prepare(`
    SELECT event_type, txid, observed_at, payload, from_address, to_address
    FROM chain_events
    WHERE event_type IN (
      'pool_settle_consensual_dispatched',
      'oracle_vote',
      'oracle_tx_sig'
    )
    ORDER BY observed_at DESC
  `).all();

  // 2. Bettor stake TX (= register-external broadcast, = per-bet cost samples)
  const betEvents = db.prepare(`
    SELECT event_type, txid, observed_at, payload, from_address, to_address
    FROM chain_events
    WHERE event_type = 'pool_oracle_deposit'
    ORDER BY observed_at DESC
  `).all();

  // 3. Fetch TX detail from kaspa_tx_log (= outputs_json)
  const txDetailStmt = db.prepare(`
    SELECT tx_id, block_hash, block_time, from_address, to_address, amount, outputs_json
    FROM kaspa_tx_log WHERE tx_id = ?
  `);

  function enrich(evt) {
    const payloadMeta = (() => {
      try { return JSON.parse(evt.payload); } catch { return null; }
    })();
    // chain_events.txid for prediction events is synthetic; real chain TX lives in payload
    const realTxid = payloadMeta?.deposit_tx
      || payloadMeta?.settle_tx
      || payloadMeta?.settle_txid
      || payloadMeta?.tx_id
      || (evt.txid && /^[0-9a-f]{64}$/.test(evt.txid) ? evt.txid : null);
    const detail = realTxid ? (txDetailStmt.get(realTxid) || null) : null;
    let outputs = null, outputsLen = null;
    if (detail?.outputs_json) {
      try {
        outputs = JSON.parse(detail.outputs_json);
        outputsLen = Array.isArray(outputs) ? outputs.length : null;
      } catch {}
    }
    return {
      event_type: evt.event_type,
      event_synthetic_id: evt.txid,
      real_chain_txid: realTxid,
      observed_at: evt.observed_at,
      from_address: evt.from_address,
      to_address: evt.to_address,
      block_hash: detail?.block_hash || null,
      block_time: detail?.block_time || null,
      amount_sompi: detail?.amount || null,
      outputs_length: outputsLen,
      outputs_sample: outputs?.slice(0, 3) || null,
      payload_meta: payloadMeta,
    };
  }

  // 4. Per-bet fee aggregate from kaspa_tx_log directly (= broader, not just chain_events)
  // Filter: TX to bettor relay addresses + reasonable bet size (= 0.5-5 KAS range from autobet config)
  const betTxStmt = db.prepare(`
    SELECT k.tx_id, k.amount, k.from_address, k.to_address, k.observed_at, k.outputs_json
    FROM kaspa_tx_log k
    WHERE k.observed_at >= ?
    ORDER BY k.observed_at DESC
    LIMIT 500
  `);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const recentTx = betTxStmt.all(since);

  // 5. Bond/fee summary stats
  const betSamples = betEvents.map(enrich);
  const settleSamples = settleEvents.map(enrich);

  // 6. Per-bet bond_amount (sompi) distribution (= from pool_oracle_deposit payload)
  const bondAmountsSompi = [];
  for (const b of betSamples) {
    const p = b.payload_meta;
    if (p?.bond_amount) bondAmountsSompi.push(Number(p.bond_amount));
  }
  // Settle TX fee/amount distribution (= from payload broker_fee + winner_amount)
  const settleBrokerFees = [];
  const settleWinnerAmounts = [];
  for (const s of settleSamples) {
    const p = s.payload_meta;
    if (s.event_type === 'pool_settle_consensual_dispatched') {
      if (p?.broker_fee_amount) settleBrokerFees.push(Number(p.broker_fee_amount));
      if (p?.winner_amount) settleWinnerAmounts.push(Number(p.winner_amount));
    }
  }

  const baseline = {
    schema_version: 'v0.5-baseline-r1',
    captured_at: new Date().toISOString(),
    captured_by: 'NWT-tn regression-runner Plan A (A)',
    summary: {
      settle_tx_count: settleSamples.length,
      bet_tx_count: betSamples.length,
      bond_amount_samples_sompi: bondAmountsSompi.length,
      bond_amount_sompi_min: bondAmountsSompi.length ? Math.min(...bondAmountsSompi) : null,
      bond_amount_sompi_max: bondAmountsSompi.length ? Math.max(...bondAmountsSompi) : null,
      bond_amount_sompi_avg: bondAmountsSompi.length ? Math.round(bondAmountsSompi.reduce((a, b) => a + b, 0) / bondAmountsSompi.length) : null,
      settle_broker_fee_samples: settleBrokerFees.length,
      settle_broker_fee_sompi_avg: settleBrokerFees.length ? Math.round(settleBrokerFees.reduce((a, b) => a + b, 0) / settleBrokerFees.length) : null,
      settle_winner_amount_sompi_avg: settleWinnerAmounts.length ? Math.round(settleWinnerAmounts.reduce((a, b) => a + b, 0) / settleWinnerAmounts.length) : null,
      total_recent_tx_7d: recentTx.length,
      settle_real_chain_tx_resolved: settleSamples.filter(s => s.real_chain_txid).length,
      bet_real_chain_tx_resolved: betSamples.filter(b => b.real_chain_txid).length,
    },
    v0_5_invariants: {
      // Lock these — v0.6 backward compat MUST preserve
      pool_settle_outputs_length_expected: 7,
      pool_settle_outputs_length_observed: [...new Set(settleSamples.filter(s => s.event_type === 'pool_settle_consensual_dispatched').map(s => s.outputs_length))],
      broker_fee_ratios_expected: [0.003, 0.005, 0.007],  // 0.3%/0.5%/0.7% per J2 r72
      ss_p2sh_format: 'P2SH 32-byte payload + OP_PUSHDATA2 for >520 byte redeem',
      dispute_path_expected: 'dispatch via voter v2 + 7 outputs + oracleFee/5 split',
    },
    settle_tx_baseline: settleSamples,
    bet_tx_baseline: betSamples,
    notes: [
      'v0.6 compat verify: post-ship rerun captureBaseline() + diff against this snapshot.',
      'Critical invariants for v0.5 markets (ADDITIVE design — v0.6 spec §7): bond_amount sompi/broker_fee_pct/winner_amount distribution MUST stay constant.',
      'Settle real chain TX hash not in pool_settle_consensual_dispatched payload (= dispatched intent only) — outputs.length validation falls back to NEW dispatched events post-v0.6 schema diff vs this snapshot.',
      'v0.6 ADDITIVE: protocol_version branch, v0.5 markets untouched. New paths (merkle proof / dispute reveal entrypoint) MUST NOT replace existing entrypoints.',
      'autobet hybrid (sub C) will re-capture bet_tx_baseline post-hybrid for cost diff (chain TX count/sompi fee/latency/oracle round time).',
    ],
  };

  db.close();
  return baseline;
}

const baseline = await captureBaseline();
const outAbs = path.resolve(outPath);
fs.writeFileSync(outAbs, JSON.stringify(baseline, null, 2));

console.log(`Baseline captured: ${outAbs}`);
console.log(`Settle TX events: ${baseline.summary.settle_tx_count} (real chain TX resolved: ${baseline.summary.settle_real_chain_tx_resolved})`);
console.log(`Bet TX events: ${baseline.summary.bet_tx_count} (real chain TX resolved: ${baseline.summary.bet_real_chain_tx_resolved})`);
console.log(`Bond amount sompi samples: ${baseline.summary.bond_amount_samples_sompi} (min=${baseline.summary.bond_amount_sompi_min} max=${baseline.summary.bond_amount_sompi_max} avg=${baseline.summary.bond_amount_sompi_avg})`);
console.log(`Settle broker_fee_sompi avg: ${baseline.summary.settle_broker_fee_sompi_avg} (samples=${baseline.summary.settle_broker_fee_samples})`);
console.log(`Settle winner_amount_sompi avg: ${baseline.summary.settle_winner_amount_sompi_avg}`);
console.log(`Recent 7d chain TX: ${baseline.summary.total_recent_tx_7d}`);
console.log(`Pool settle outputs.length observed: [${baseline.v0_5_invariants.pool_settle_outputs_length_observed.join(',')}] (expected 7 post-real-TX resolve)`);
