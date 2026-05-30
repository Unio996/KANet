#!/usr/bin/env node
// scripts/regression-runner.mjs — Plan A real-chain orchestrator (NWT-tn r97 propose, Bettor r4 ACK)
// (A) v0.5 baseline snapshot — capture existing chain history as backward-compat baseline
//     run: node scripts/regression-runner.mjs --mode=baseline --out=baseline.v0.5.json
// (B) v0.6 compat verify — diff post-v0.6 chain state vs baseline (TODO, wait spec doc + ship)
// (C) autobet hybrid stress — measure cost diff pre/post hybrid (TODO, wait sub B ship)

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DB_PATH = 'D:/kanet-tn12/kasia-console/data/console.db';
const REPO_ROOT = 'D:/kanet-tn12';
const SS_V05 = path.join(REPO_ROOT, 'kasia-console/src/lib/PoolSpine.sil');
const SS_V06 = path.join(REPO_ROOT, 'kasia-console/src/lib/PoolSpine_v06.sil');

const args = process.argv.slice(2);
function arg(name, def) {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

const mode = arg('mode', 'baseline');
const outPath = arg('out', mode === 'baseline' ? 'baseline.v0.5.json' : 'verify-v06.report.json');
const baselineIn = arg('baseline', 'baseline.v0.5.json');

if (!['baseline', 'verify-v06'].includes(mode)) {
  console.error(`mode must be 'baseline' or 'verify-v06'. (C) autobet hybrid awaits sub C trigger.`);
  process.exit(1);
}

function sha256File(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function extractEntrypoints(silPath) {
  if (!fs.existsSync(silPath)) return [];
  const txt = fs.readFileSync(silPath, 'utf8');
  const re = /entrypoint\s+function\s+(\w+)\s*\(/g;
  const names = [];
  let m;
  while ((m = re.exec(txt))) names.push(m[1]);
  return names;
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
      ss_v05_file_sha256: sha256File(SS_V05),
      ss_v05_entrypoints: extractEntrypoints(SS_V05),
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

async function verifyV06(baselinePath) {
  const baselineAbs = path.resolve(baselinePath);
  if (!fs.existsSync(baselineAbs)) {
    throw new Error(`baseline not found: ${baselineAbs} — run --mode=baseline first`);
  }
  const baseline = JSON.parse(fs.readFileSync(baselineAbs, 'utf8'));

  const report = {
    schema_version: 'v0.6-compat-verify-r1',
    verified_at: new Date().toISOString(),
    baseline_ref: { path: baselineAbs, schema: baseline.schema_version, captured_at: baseline.captured_at },
    checks: [],
    pass: 0,
    fail: 0,
  };

  function check(name, pass, detail) {
    report.checks.push({ name, pass, detail });
    if (pass) report.pass++; else report.fail++;
  }

  // Check 1: v0.5 SS file byte-identical (= ADDITIVE design守, v0.5 老市场零影响 spec §7)
  const currentV05Hash = sha256File(SS_V05);
  const baselineV05Hash = baseline.v0_5_invariants?.ss_v05_file_sha256;
  check(
    'v0.5 PoolSpine.sil 字节不变 (spec §7 ADDITIVE)',
    currentV05Hash === baselineV05Hash,
    { current: currentV05Hash, baseline: baselineV05Hash }
  );

  // Check 2: v0.5 entrypoints unchanged
  const currentV05Eps = extractEntrypoints(SS_V05);
  const baselineV05Eps = baseline.v0_5_invariants?.ss_v05_entrypoints || [];
  check(
    'v0.5 entrypoints 不变 (= 5: settle_unanimous/settle_majority_forfeit_1/refund_*×3)',
    JSON.stringify(currentV05Eps.sort()) === JSON.stringify([...baselineV05Eps].sort()),
    { current: currentV05Eps, baseline: baselineV05Eps }
  );

  // Check 3: v0.6 SS file exists + valid entrypoints (spec §1 = settle_aggregate + dispute_reveal + refund_maker_unjoined)
  const v06Hash = sha256File(SS_V06);
  const v06Eps = extractEntrypoints(SS_V06);
  const v06ExpectedEps = ['settle_aggregate', 'dispute_reveal', 'refund_maker_unjoined'];
  check(
    'v0.6 PoolSpine_v06.sil 存在 + 3 entrypoint',
    v06Hash !== null && v06Eps.length === 3,
    { v06_sha256: v06Hash, v06_entrypoints: v06Eps, expected: v06ExpectedEps }
  );
  check(
    'v0.6 entrypoints 包含 spec §1 锁定 3 件 (settle_aggregate/dispute_reveal/refund_maker_unjoined)',
    v06ExpectedEps.every(e => v06Eps.includes(e)),
    { missing: v06ExpectedEps.filter(e => !v06Eps.includes(e)), found: v06Eps }
  );

  // Check 4: v0.5 + v0.6 hashes differ (= protocol_version separation, 不同 P2SH 派生)
  check(
    'v0.5 ≠ v0.6 SS file hash (= protocol_version branch 独立, 派生不同 P2SH)',
    currentV05Hash !== v06Hash,
    { v05: currentV05Hash, v06: v06Hash }
  );

  // Check 5: v0.5 chain invariants 现链 state vs baseline (= 老市场 bond/broker_fee 分布不飘)
  // Re-snapshot current chain state + compare summary
  const currentSnapshot = await captureBaseline();
  const baselineSummary = baseline.summary;
  const currentSummary = currentSnapshot.summary;

  check(
    'bond_amount sompi distribution 不变 (= 100M uniform = 1 KAS register-external default)',
    currentSummary.bond_amount_sompi_min === baselineSummary.bond_amount_sompi_min
      && currentSummary.bond_amount_sompi_max === baselineSummary.bond_amount_sompi_max,
    {
      baseline: { min: baselineSummary.bond_amount_sompi_min, max: baselineSummary.bond_amount_sompi_max },
      current: { min: currentSummary.bond_amount_sompi_min, max: currentSummary.bond_amount_sompi_max },
    }
  );

  // Check 6: bet TX count 单调不减 (= 历史不丢)
  check(
    'bet TX 历史不丢 (current ≥ baseline)',
    currentSummary.bet_tx_count >= baselineSummary.bet_tx_count,
    { baseline: baselineSummary.bet_tx_count, current: currentSummary.bet_tx_count }
  );

  // Check 7: settle TX events 单调不减
  check(
    'settle TX events 历史不丢',
    currentSummary.settle_tx_count >= baselineSummary.settle_tx_count,
    { baseline: baselineSummary.settle_tx_count, current: currentSummary.settle_tx_count }
  );

  report.verdict = report.fail === 0 ? 'PASS' : 'FAIL';
  report.summary = `${report.pass}/${report.pass + report.fail} checks PASS — verdict ${report.verdict}`;
  return report;
}

if (mode === 'baseline') {
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
  console.log(`v0.5 SS sha256: ${baseline.v0_5_invariants.ss_v05_file_sha256}`);
  console.log(`v0.5 SS entrypoints: [${(baseline.v0_5_invariants.ss_v05_entrypoints || []).join(', ')}]`);
} else {
  const report = await verifyV06(baselineIn);
  const outAbs = path.resolve(outPath);
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2));
  console.log(`v0.6 compat verify report: ${outAbs}`);
  console.log(report.summary);
  for (const c of report.checks) {
    console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}`);
    if (!c.pass) console.log('    detail:', JSON.stringify(c.detail).slice(0, 200));
  }
  process.exit(report.fail === 0 ? 0 : 1);
}
