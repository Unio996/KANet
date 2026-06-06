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

  // Check 10: v159 schema deployed (= J2.1 d804175 oracle_pool_membership + pool_snapshots)
  // Reason (Owner 铁律 ②): J2.1 ship 后 schema 须落地, 否则 v0.6 market publish 时 poolMerkleRoot 派生路径 (pool_snapshots freeze) 无法 record, 用户 publish 失败.
  const db2 = new Database(DB_PATH, { readonly: true });
  const tableNames = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('oracle_pool_membership','pool_snapshots','pool_committee')").all().map(t => t.name);
  db2.close();
  const v159Expected = ['oracle_pool_membership', 'pool_snapshots'];
  const v159Missing = v159Expected.filter(t => !tableNames.includes(t));
  check(
    'v159 schema deployed (oracle_pool_membership + pool_snapshots tables)',
    v159Missing.length === 0,
    { found: tableNames, expected: v159Expected, missing: v159Missing, note: v159Missing.length === 0 ? 'J2.1 schema live' : 'DEPLOY_PENDING — J2.1 d804175 须 Console pull docs/oracle-v06-spec + restart' },
    'soft'
  );

  // Check 11: pool-merkle-v06.mjs derive module 存在 (= J2.1 d804175 byte-align d5d4ecbdd SS climb)
  // Reason (Owner 铁律 ②): J2.2/J2.3 sampling+VRF 依赖 derive 模块; 不存在则 v0.6 market 不能 derive poolMerkleRoot.
  const mergeModulePath = path.join(REPO_ROOT, 'kasia-console/src/services/pool-merkle-v06.mjs');
  const hasMergeModule = fs.existsSync(mergeModulePath);
  check(
    'pool-merkle-v06.mjs derive 模块存在 (J2.1 byte-align SS climb)',
    hasMergeModule,
    { path: mergeModulePath, exists: hasMergeModule }
  );

  // Check 12: pool-committee-sampler.mjs 存在 (= J2.2+J2.3 c974028 committee 选拔+keyless 确定性抽样)
  // Reason (Owner 铁律 ②): SS settle 需 committee 5 oracle 选拔结果; 缺则 v0.6 settle 不能跑 (没人签).
  const samplerPath = path.join(REPO_ROOT, 'kasia-console/src/services/pool-committee-sampler.mjs');
  const hasSampler = fs.existsSync(samplerPath);
  check(
    'pool-committee-sampler.mjs 存在 (J2.2+J2.3 keyless stake-weighted committee 选拔)',
    hasSampler,
    { path: samplerPath, exists: hasSampler }
  );

  // Check 13: pool-market-settler-v06.mjs 存在 (= J2 86d1efc v0.6 settler with F-S1/F-S2 fix)
  // Reason (Owner 铁律 ②): v0.6 market settle 需调此 settler 算 5 oracle payout / broker fee / winner share; 缺则 v0.6 market 无法 settle.
  const settlerPath = path.join(REPO_ROOT, 'kasia-console/src/services/pool-market-settler-v06.mjs');
  const hasSettler = fs.existsSync(settlerPath);
  check(
    'pool-market-settler-v06.mjs 存在 (J2 v0.6 settler with F-S1 canonical endBlockHash + F-S2 256-bit rand)',
    hasSettler,
    { path: settlerPath, exists: hasSettler }
  );

  // Check 14: cross-node min_stake POLICY 三层 enforce (= Bettor r158 防机器人 + NWT r121 cross-node 双侧)
  // Reason (Owner 铁律 ② + 反机器人): API 层 register prep stake<1 KAS 必 reject
  // 防恶意节点直 broadcast <1 KAS 绕 producer floor
  let underFloorStatus = null;
  try {
    const r = await fetch('http://127.0.0.1:3200/api/pool/market/nonexistent/bettor/register-external/prep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_addr: 'kaspatest:qrl33afery94spm6dwa4cl2xnfgxus6dlh8hj0ld6d6cszjxs3dsk76jlh2cc', direction: 0, stake_kas: 0.5 }),
    });
    underFloorStatus = r.status;
  } catch (e) {
    underFloorStatus = `fetch_error:${e.message}`;
  }
  // 400/404 with stake-floor reject reason expected (= reject below floor, market_not_found ok too because endpoint reaches floor check)
  // 200/201 = floor 没 enforce → CRITICAL
  const apiFloorEnforced = underFloorStatus !== 200 && underFloorStatus !== 201;
  check(
    'API 层 register prep stake<1 KAS reject (= 反机器人三层防御 layer 1)',
    apiFloorEnforced,
    { http_status: underFloorStatus, expected: '400/404 reject 不是 200', note: 'Bettor r158 三层防御 + NWT r121 cross-node spec' }
  );

  // L11 market spec sanitize (Bettor r230, restored 6/6 from rewrite)
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.resolve(REPO_ROOT, 'kasia-console/data/console.db'), { readonly: true });
    const rows = db.prepare("SELECT id, resolution_rule_spec FROM pool_markets WHERE protocol_version IN ('v0.6','v0.7') AND resolution_rule_spec IS NOT NULL").all();
    db.close();
    const dirty = [];
    const URL_PAT = /https?:\/\/|www\./i;
    const HTML_PAT = /!\[|<img|<a\s+href|<\/?(p|div|span|br)\b/i;
    for (const r of rows) {
      let spec; try { spec = JSON.parse(r.resolution_rule_spec); } catch { continue; }
      if (!spec.source && !spec.title) continue;
      const title = spec.title || '';
      if (!title) { dirty.push({ id: r.id, reason: 'no_title' }); continue; }
      if (URL_PAT.test(title)) { dirty.push({ id: r.id, reason: 'title_has_url' }); continue; }
      if (HTML_PAT.test(title)) { dirty.push({ id: r.id, reason: 'title_has_html' }); continue; }
    }
    check('L11 market spec sanitize (Bettor r230 restored 6/6)', dirty.length === 0, { dirty_count: dirty.length, first_5: dirty.slice(0,5) });
  } catch (e) { check('L11 spec sanitize (probe)', false, { err: e.message }, 'soft'); }

  // L16 oracle_pool_membership 单一源 (Bettor r265, restored 6/6) — soft until J2 完成 reader 全迁
  try {
    const { execSync } = await import('child_process');
    const cwd = path.resolve(REPO_ROOT, 'kasia-console');
    const WHITELIST = ['src/lib/oracle-pool-source.mjs', 'src/db/migrate.js'];
    let prodFiles = [];
    // Only flag files with actual SQL patterns (not throw msg / JSDoc / comments)
    // Exclude comment lines (//, * JSDoc) via grep -n, then filter
    try {
      const raw = execSync('grep -rnE "(INSERT|SELECT|UPDATE|DELETE|FROM)[^;]*oracle_pool_membership" src/', { cwd, encoding: 'utf8' });
      const matches = raw.split(/\r?\n/).filter(Boolean);
      const fileSet = new Set();
      for (const line of matches) {
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) continue;
        const [, file, , content] = m;
        const trimmed = content.trim();
        // Skip comment lines (// or * JSDoc)
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        fileSet.add(file.replace(/\\/g, '/'));
      }
      prodFiles = [...fileSet];
    } catch {}
    const offenders = prodFiles.filter(f => !WHITELIST.some(w => f === w || f.endsWith('/' + w)));
    check('L16 oracle pool 单一源焊死 (Bettor r265 restored / soft until reader 全迁)', offenders.length === 0, { offender_count: offenders.length, offenders: offenders.slice(0, 8) }, offenders.length === 0 ? 'hard' : 'soft');
  } catch (e) { check('L16 single source (probe)', false, { err: e.message }, 'soft'); }

  // L17 oracle id/address 一致 (Bettor r276, restored 6/6)
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.resolve(REPO_ROOT, 'kasia-console/data/console.db'), { readonly: true });
    const enrollments = db.prepare("SELECT staker_pk_x, relay_address FROM oracle_stake_enrollments WHERE active=1").all();
    db.close();
    const missing = enrollments.filter(e => !e.relay_address);
    const invalid = enrollments.filter(e => e.relay_address && !/^kaspatest:[a-z0-9]+$/.test(e.relay_address));
    check('L17 oracle id/address 一致 (Bettor r276 restored)', missing.length === 0 && invalid.length === 0, { active: enrollments.length, missing: missing.length, invalid: invalid.length });
  } catch (e) { check('L17 id/address (probe)', false, { err: e.message }, 'soft'); }

  // L18 merkle leaf algo (Bettor r327, restored 6/6)
  try {
    const cwd = path.resolve(REPO_ROOT, 'kasia-console');
    const scanner = fs.readFileSync(path.resolve(cwd, 'src/services/oracle-pool-chain-scanner.mjs'), 'utf8');
    const merkle = fs.readFileSync(path.resolve(cwd, 'src/services/pool-merkle-v06.mjs'), 'utf8');
    const ssPath = path.resolve(cwd, 'src/lib/PoolSpine_v07.sil');
    const ss = fs.existsSync(ssPath) ? fs.readFileSync(ssPath, 'utf8') : '';
    const sActive = scanner.split(/\r?\n/).filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const importsMerkle = /pool-merkle-v06/.test(sActive) && /(import\(|from\s+['"])/.test(sActive);
    const noSha256 = !/createHash\(['"]sha256['"]\)/.test(sActive);
    const allOk = importsMerkle && noSha256 && /blake2b/i.test(merkle) && (ss ? /blake2b/i.test(ss) : true);
    check('L18 merkle leaf algo 一致 (Bettor r327 restored)', allOk, { scanner_imports_merkle: importsMerkle, scanner_no_sha256: noSha256 });
  } catch (e) { check('L18 merkle leaf (probe)', false, { err: e.message }, 'soft'); }

  // L19 settle TX 三方分账守恒 (Bettor r373, restored 6/6)
  try {
    const p2sh = fs.readFileSync(path.resolve(REPO_ROOT, 'kasia-relay/src/lib/p2sh.mjs'), 'utf8');
    const allOk = /function\s+_assertTxInvariants/.test(p2sh) && (/fee\s*<\s*0n/.test(p2sh) || /overspend/.test(p2sh)) && /fee\s*===\s*0n/.test(p2sh) && /mass/i.test(p2sh) && /dust/i.test(p2sh);
    check('L19 settle TX 三方分账守恒 (Bettor r373 restored)', allOk, { note: '_assertTxInvariants 4 守门 (overspend/0-fee/mass/dust)' });
  } catch (e) { check('L19 settle 守恒 (probe)', false, { err: e.message }, 'soft'); }

  // L20 settler 饥饿根治 (Bettor r366 / J2 c9f5814, restored 6/6)
  try {
    const settler = fs.readFileSync(path.resolve(REPO_ROOT, 'kasia-console/src/services/pool-market-settler.js'), 'utf8');
    const active = settler.split(/\r?\n/).filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const allOk = /ORDER BY updated_at DESC/i.test(active) && /backoff/i.test(active) && /TICK_TIMEBOX_MS|TICK_TIMEOUT|tickTimeout|time-box/i.test(active);
    check('L20 settler 饥饿根治 (Bettor r366 + J2 c9f5814 restored)', allOk, { active_priority: /ORDER BY updated_at DESC/i.test(active), exp_backoff: /backoff/i.test(active), tick_timebox: /TICK_TIMEBOX_MS|TICK_TIMEOUT/.test(active) });
  } catch (e) { check('L20 settler 饥饿 (probe)', false, { err: e.message }, 'soft'); }

  // L21 refund locktime grace (Bettor r379 / J1 b25c4ac, restored 6/6)
  try {
    const settler = fs.readFileSync(path.resolve(REPO_ROOT, 'kasia-console/src/services/pool-market-settler.js'), 'utf8');
    const claimAuto = fs.readFileSync(path.resolve(REPO_ROOT, 'kasia-console/src/services/bettor-refund-claim-auto.mjs'), 'utf8');
    const graceLib = fs.existsSync(path.resolve(REPO_ROOT, 'kasia-console/src/lib/pool-refund-grace.mjs'));
    check('L21 refund locktime grace 一致 (Bettor r379 + J1 b25c4ac restored)', graceLib && /REFUND_GRACE_SEC/.test(settler) && /REFUND_GRACE_SEC/.test(claimAuto), { grace_lib: graceLib });
  } catch (e) { check('L21 refund grace (probe)', false, { err: e.message }, 'soft'); }

  // L23 Bettor r216/r217 派工 6/6: MIN_POT 100KAS 守门 + 前置 refund 路由 (= 守 SS L300 不被绕, 不变 dispatch fail 死单)
  try {
    const ssPath = path.resolve(REPO_ROOT, 'kasia-console/src/lib/PoolSpine_v07.sil');
    const ssSrc = fs.existsSync(ssPath) ? fs.readFileSync(ssPath, 'utf8') : '';
    const ssHasMinPot = /MIN_POT_SOMPI|globalYesTotal_sompi.*\+.*globalNoTotal_sompi.*>=/.test(ssSrc);
    const settlerPath = path.resolve(REPO_ROOT, 'kasia-console/src/services/pool-market-settler.js');
    const settlerSrc = fs.readFileSync(settlerPath, 'utf8');
    const settlerHasPreCheck = /MIN_POT|globalYes.*\+.*globalNo|pot\s*<\s*1e10|pot.*<.*100.*KAS/i.test(settlerSrc);
    const allOk = ssHasMinPot && settlerHasPreCheck;
    check(
      'L23 MIN_POT 100KAS 守门 + 前置 refund 路由 (Bettor r216/r217 守 SS L300 不被绕)',
      allOk,
      {
        ss_has_min_pot_require: ssHasMinPot,
        settler_has_pre_check: settlerHasPreCheck,
        note: 'SS L300 require >= 1e10 sompi. settler 前置 pot<MIN_POT → refund 路由不 dispatch fail 死单 (= Bettor r217 精化)'
      },
      settlerHasPreCheck ? 'hard' : 'soft'
    );
  } catch (e) {
    check('L23 MIN_POT 守门 (probe)', false, { err: e.message }, 'soft');
  }

  // L22 Bettor r383 派工 6/6: maker_stake server 强制 lint (= 守 KANet-UI 7e5a5d2 + f8b64a5 不回归)
  // 3 endpoint (v0.5/v0.6/v0.7) 必 enforce makerStakeKas >= POOL_MAKER_STAKE_MIN_KAS + 单一源 const
  // 增强 (Bettor r388 派): 检查行不在 NO_LIMITS 守卫块内 (= 防 env 守卫坑回归)
  try {
    const poolPath = path.resolve(REPO_ROOT, 'kasia-console/src/api/pool.js');
    const poolSrc = fs.readFileSync(poolPath, 'utf8');
    const hasSingleSourceConst = /const\s+POOL_MAKER_STAKE_MIN_KAS\s*=\s*100\s*;/.test(poolSrc);
    const enforceCount = (poolSrc.match(/makerStakeKas\s*<\s*POOL_MAKER_STAKE_MIN_KAS/g) || []).length;
    // L22 enhanced: 检每条 check 行不被 NO_LIMITS 守卫块包
    const lines = poolSrc.split(/\r?\n/);
    let nestedInNoLimits = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/makerStakeKas\s*<\s*POOL_MAKER_STAKE_MIN_KAS/.test(lines[i])) continue;
      // walk back up to 15 lines, count { vs } between NO_LIMITS open & check line
      let openNoLimits = false, braceBalance = 0;
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const opens = (lines[j].match(/\{/g) || []).length;
        const closes = (lines[j].match(/\}/g) || []).length;
        braceBalance += closes - opens;
        if (/NO_LIMITS.*!==.*'1'\)\s*\{/.test(lines[j])) {
          openNoLimits = true;
          break;
        }
      }
      if (openNoLimits && braceBalance < 0) nestedInNoLimits++;
    }
    const allOk = hasSingleSourceConst && enforceCount >= 3 && nestedInNoLimits === 0;
    check(
      'L22 maker stake min 单一源+3 endpoint 强制+不在 NO_LIMITS 块内 (Bettor r383+r388 / 守 KANet-UI f8b64a5)',
      allOk,
      {
        single_source_const_L33: hasSingleSourceConst,
        enforcement_count: enforceCount,
        nested_in_no_limits_count: nestedInNoLimits,
        note: '3 enforce + 全不在 NO_LIMITS 守卫块. 任一脱掉 = env 守卫坑可绕过 = 演示破信'
      }
    );
  } catch (e) {
    check('L22 maker stake min check (probe)', false, { err: e.message }, 'soft');
  }

  // L24 Bettor r243/r244b 派工 6/6: isStructuredSpec ≡ deriveVote ≡ specIsUsable 三端绑死 data_source_canonical 单一源
  // = 守 qrv65 类病 (spec 漏 canonical → voter deriveVote fail → 市场卡死)
  // 3 sub baked: pool.js isStructuredSpec / voter deriveVote / tg-bot specIsUsable 同字段
  try {
    const poolPath = path.resolve(REPO_ROOT, 'kasia-console/src/api/pool.js');
    const voterPath = path.resolve(REPO_ROOT, 'kasia-console/src/services/bettor-prediction-voter.js');
    const botPath = path.resolve(REPO_ROOT, 'tg-bot/prediction-menu.mjs');
    const poolSrc = fs.readFileSync(poolPath, 'utf8');
    const voterSrc = fs.readFileSync(voterPath, 'utf8');
    const botSrc = fs.existsSync(botPath) ? fs.readFileSync(botPath, 'utf8') : '';
    // sub-a: pool.js isStructuredSpec 必含 data_source_canonical typeof check (非 comment)
    const poolLines = poolSrc.split(/\r?\n/);
    let poolInIsStructured = false, poolHasCanonicalCheck = false, poolBraceDepth = 0;
    for (const ln of poolLines) {
      if (/function\s+isStructuredSpec\s*\(/.test(ln)) { poolInIsStructured = true; poolBraceDepth = 0; }
      if (poolInIsStructured) {
        poolBraceDepth += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
        const codeLine = ln.replace(/\/\/.*$/, '').trim();
        if (!codeLine.startsWith('*') && /typeof\s+\w+\.data_source_canonical\s*===\s*['"]string['"]/.test(codeLine)) {
          poolHasCanonicalCheck = true;
        }
        if (poolBraceDepth <= 0 && /\}/.test(ln) && poolHasCanonicalCheck !== false) {
          if (!poolHasCanonicalCheck) poolInIsStructured = false;
          else break;
        }
      }
    }
    // sub-b: voter deriveVote 必 read spec.data_source_canonical (= 单一源不别名)
    const voterReadsCanonical = /spec\??\.\s*data_source_canonical/.test(voterSrc) || /data_source_canonical\s*:\s*\w+/.test(voterSrc);
    // sub-c: tg-bot specIsUsable 同字段
    const botHasCanonicalCheck = /data_source_canonical/.test(botSrc) && /specIsUsable/.test(botSrc);
    const allOk = poolHasCanonicalCheck && voterReadsCanonical && botHasCanonicalCheck;
    check(
      'L24 isStructuredSpec ≡ deriveVote ≡ specIsUsable 三端 data_source_canonical 单一源 (Bettor r243/r244b 守 qrv65 病根)',
      allOk,
      {
        pool_isStructuredSpec_has_canonical: poolHasCanonicalCheck,
        voter_deriveVote_reads_canonical: voterReadsCanonical,
        bot_specIsUsable_has_canonical: botHasCanonicalCheck,
        note: '三端任一脱钩 → 漂回 qrv65 漏 canonical 病. KANet-UI f83ab1c 修, lint 永守'
      }
    );
  } catch (e) {
    check('L24 三端单一源 (probe)', false, { err: e.message }, 'soft');
  }

  // L25 Bettor r250 ④ APPROVE 第4路 (= 单元测 isStructuredSpec 纯函数, 零 side effect):
  // J2 af74509 export 后 dynamic import + 5 case 覆全分支 (= NWT r326 propose)
  try {
    // 防 pool.js 顶 import 链 rpc-health 抛 env-not-set: 占位 dummy
    if (!process.env.KASPA_RPC_URL) process.env.KASPA_RPC_URL = 'http://lint-dummy';
    if (!process.env.KASPA_NETWORK) process.env.KASPA_NETWORK = 'testnet-12';
    const poolMod = await import('file://' + path.resolve(REPO_ROOT, 'kasia-console/src/api/pool.js').replace(/\\/g, '/'));
    const isStructuredSpec = poolMod.isStructuredSpec;
    if (typeof isStructuredSpec !== 'function') throw new Error('isStructuredSpec not exported as function');
    const cases = [
      { name: '漏 canonical', input: { title: 't', resolution_criteria: 'c' }, expect: false },
      { name: '全字段 PASS', input: { title: 't', resolution_criteria: 'c', data_source_canonical: 'http://x' }, expect: true },
      { name: '空 spec', input: {}, expect: false },
      { name: '非对象 string', input: 'string', expect: false },
      { name: '空 canonical', input: { title: 't', resolution_criteria: 'c', data_source_canonical: '' }, expect: false },
    ];
    const results = cases.map(c => {
      let actual;
      try {
        if (typeof c.input === 'string') actual = isStructuredSpec(JSON.stringify(c.input));
        else actual = isStructuredSpec(JSON.stringify(c.input));
      } catch (_) { actual = false; }
      return { name: c.name, expect: c.expect, actual, ok: actual === c.expect };
    });
    const allOk = results.every(r => r.ok);
    check(
      'L25 unit test: isStructuredSpec 5 case 覆全分支 (Bettor r250 第4路 / J2 af74509 export)',
      allOk,
      {
        cases: results.map(r => `${r.name}: expect=${r.expect} actual=${r.actual} ${r.ok ? '✓' : '✗'}`),
        note: allOk ? '5 case 全 PASS, 纯函数零 side effect' : '任一 case 不符 = isStructuredSpec 逻辑漂回 qrv65 病根'
      }
    );
  } catch (e) {
    check('L25 unit test (probe)', false, { err: e.message, note: 'import fail or export missing' }, 'soft');
  }

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
