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
const SS_LIB_DIR = path.join(REPO_ROOT, 'kasia-console/src/lib');

// Auto-discover SS files in src/lib/. v0.5 = no _v06 suffix; v0.6 = _v06 anywhere in name.
function discoverSSFiles() {
  if (!fs.existsSync(SS_LIB_DIR)) return { v05: {}, v06: {} };
  const entries = fs.readdirSync(SS_LIB_DIR).filter(f => f.endsWith('.sil') && /^Pool/.test(f));
  const v05 = {};
  const v06 = {};
  for (const f of entries) {
    const name = f.replace(/\.sil$/, '');
    const full = path.join(SS_LIB_DIR, f);
    if (/_v06/.test(name)) v06[name] = full;
    else v05[name] = full;
  }
  return { v05, v06 };
}

const _discovered = discoverSSFiles();
const SS_FILES_V05 = _discovered.v05;
const SS_FILES_V06 = _discovered.v06;
// Backward compat single-path constants
const SS_V05 = SS_FILES_V05.PoolSpine || null;
const SS_V06 = SS_FILES_V06.PoolSpine_v06 || null;

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
      ss_files_v05: Object.fromEntries(
        Object.entries(SS_FILES_V05).map(([k, p]) => [k, { sha256: sha256File(p), entrypoints: extractEntrypoints(p) }])
      ),
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

  function check(name, pass, detail, severity = 'hard') {
    report.checks.push({ name, pass, detail, severity });
    if (pass) report.pass++;
    else if (severity === 'hard') report.fail++;
    else report.deploy_pending++;
  }
  report.deploy_pending = 0;

  // Check 1: All v0.5 SS files byte-identical (= ADDITIVE design 守, spec §7)
  const baselineV05Files = baseline.v0_5_invariants?.ss_files_v05 || {
    PoolSpine: { sha256: baseline.v0_5_invariants?.ss_v05_file_sha256, entrypoints: baseline.v0_5_invariants?.ss_v05_entrypoints || [] }
  };
  for (const [name, p] of Object.entries(SS_FILES_V05)) {
    const baselineEntry = baselineV05Files[name];
    if (!baselineEntry) continue;
    const currentHash = sha256File(p);
    check(
      `v0.5 ${name}.sil 字节不变 (spec §7 ADDITIVE)`,
      currentHash === baselineEntry.sha256,
      { current: currentHash, baseline: baselineEntry.sha256 }
    );
    const currentEps = extractEntrypoints(p);
    check(
      `v0.5 ${name} entrypoints 不变 (= ${baselineEntry.entrypoints.length} 件)`,
      JSON.stringify(currentEps.sort()) === JSON.stringify([...(baselineEntry.entrypoints || [])].sort()),
      { current: currentEps, baseline: baselineEntry.entrypoints }
    );
  }

  // Check v0.6 SS files exist + structural validity
  // Note: entrypoint names may evolve mid-design (e.g., J1 r119 path A pivot from settle_aggregate → 5-sig variant).
  // Verifier records observed entrypoints; soft check for known spec entrypoints if any match.
  const v06SpecEpsHints = {
    'PoolSpine': ['settle_aggregate', 'dispute_reveal', 'refund_maker_unjoined', 'settle_tofn', 'settle_5sig'],
    'PoolSide': ['settled_via_spine', 'claim_winner', 'refund_market_cancelled'],
  };
  function classifyV06(name) {
    if (/Side/i.test(name)) return 'PoolSide';
    if (/Spine/i.test(name)) return 'PoolSpine';
    return null;
  }
  for (const [name, p] of Object.entries(SS_FILES_V06)) {
    const hash = sha256File(p);
    const eps = extractEntrypoints(p);
    const cls = classifyV06(name);
    const expectedHints = cls ? v06SpecEpsHints[cls] : [];
    check(
      `v0.6 ${name}.sil 存在 + ≥1 entrypoint`,
      hash !== null && eps.length >= 1,
      { sha256: hash, entrypoints: eps, classification: cls }
    );
    if (expectedHints.length) {
      const overlap = eps.filter(e => expectedHints.includes(e));
      check(
        `v0.6 ${name} entrypoints 命中 spec hints (${cls})`,
        overlap.length >= 1,
        { matched: overlap, found: eps, hints: expectedHints },
        'soft'  // soft = name may evolve, surface不 hard fail
      );
    }
  }

  // v0.5 + v0.6 hashes differ (= protocol_version separation, 不同 P2SH 派生)
  const allV05Hashes = Object.values(SS_FILES_V05).map(sha256File);
  const allV06Hashes = Object.values(SS_FILES_V06).map(sha256File);
  const overlap = allV05Hashes.some(h => h && allV06Hashes.includes(h));
  check(
    'v0.5 ≠ v0.6 SS file hashes 全分 (= protocol_version branch 独立, 派生不同 P2SH)',
    !overlap,
    { v05_hashes: allV05Hashes, v06_hashes: allV06Hashes }
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

  // Check 8: v158 schema deploy state (= J1 r108 ship 的 pool_markets += protocol_version + pool_merkle_root)
  // NOT a hard fail — deploy gap is operational state. Verifier reports both true_pass + deploy_pending.
  const db = new Database(DB_PATH, { readonly: true });
  const poolCols = db.prepare('PRAGMA table_info(pool_markets)').all().map(c => c.name);
  const hasV06Cols = poolCols.includes('protocol_version') && poolCols.includes('pool_merkle_root');
  db.close();
  check(
    'v158 schema deployed (pool_markets has protocol_version + pool_merkle_root)',
    hasV06Cols,
    { has_protocol_version: poolCols.includes('protocol_version'), has_pool_merkle_root: poolCols.includes('pool_merkle_root'), note: hasV06Cols ? 'v0.6 ready' : 'DEPLOY_PENDING — Console need pull origin/j1tn/pred-menu-sab + restart for v158 migration to run' },
    'soft'
  );

  // Check 9: /api/pool/market/create-v06 endpoint live (= curl 401/200 vs 404)
  let createV06Status = null;
  try {
    const r = await fetch('http://127.0.0.1:3200/api/pool/market/create-v06', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    createV06Status = r.status;
  } catch (e) {
    createV06Status = `fetch_error:${e.message}`;
  }
  // 400 (missing required) or 401 (auth) = endpoint registered; 404 = deploy gap
  const endpointLive = createV06Status === 400 || createV06Status === 401 || createV06Status === 403;
  check(
    '/api/pool/market/create-v06 endpoint live (= Console 跑新代码)',
    endpointLive,
    { http_status: createV06Status, note: endpointLive ? 'endpoint registered' : (createV06Status === 404 ? 'DEPLOY_PENDING (404) — Console restart needed' : 'unexpected status') },
    'soft'
  );

  const total = report.pass + report.fail + report.deploy_pending;
  if (report.fail > 0) report.verdict = 'FAIL';
  else if (report.deploy_pending > 0) report.verdict = 'PASS_WITH_DEPLOY_PENDING';
  else report.verdict = 'PASS';
  report.summary = `${report.pass}/${total} PASS, ${report.fail} hard FAIL, ${report.deploy_pending} deploy pending — verdict ${report.verdict}`;
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
    const tag = c.pass ? 'PASS' : (c.severity === 'soft' ? 'DEPLOY_PENDING' : 'FAIL');
    console.log(`  [${tag}] ${c.name}`);
    if (!c.pass) console.log('    detail:', JSON.stringify(c.detail).slice(0, 200));
  }
  process.exit(report.fail === 0 ? 0 : 1);
}
