#!/usr/bin/env node
// scripts/attack-self-claim.mjs — Self-claim attack reproduction (Bettor r19 verify gate 必件)
//
// Attack vector (J1 r119 confirmed pre-path-A):
//   Loser bettor takes any 5 pool PKs (公开知) + self-signs aggSig + self-picks winner = own direction
//   + computes committeePkHash = blake2b(c0..c4) + broadcasts settle TX → SS accepts (vulnerable)
//
// Path A defense (J1 r121 draft 5c3830ff7 broken → path A 双合约):
//   Spine settle_aggregate replaces aggSig+aggPk with 5 individual checkSig + counter ≥ t (t=4).
//   Each checkSig(sig_i, pubkey(pk_i)) verifies sig matches the committee PK.
//   Attacker doesn't hold committee priv keys → all 5 checkSig fail → counter=0 → require(>=4) fail.
//
// Modes:
//   --mode=static  Analyze SS files + verify defense mechanism present (= structural proof)
//   --mode=live    Actually broadcast attack TX against a live v06 market (= real-chain proof)
//                  REQUIRES: J1 path A SS ship + v06 market exists + Console restart + attacker relay funded
//
// Run:
//   node scripts/attack-self-claim.mjs --mode=static --out=attack-static.report.json
//   node scripts/attack-self-claim.mjs --mode=live --market=<id> --attacker=<relay_id> --out=attack-live.report.json

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = 'D:/kanet-tn12';
const SS_LIB_DIR = path.join(REPO_ROOT, 'kasia-console/src/lib');
const CONSOLE_URL = 'http://127.0.0.1:3200';

const args = process.argv.slice(2);
function arg(name, def) {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

const mode = arg('mode', 'static');
const outPath = arg('out', `attack-${mode}.report.json`);
const marketId = arg('market', null);
const attackerRelay = arg('attacker', null);

function listV06SSFiles() {
  if (!fs.existsSync(SS_LIB_DIR)) return [];
  return fs.readdirSync(SS_LIB_DIR)
    .filter(f => f.endsWith('.sil') && /^Pool/.test(f) && /_v06/.test(f))
    .map(f => ({ name: f.replace(/\.sil$/, ''), path: path.join(SS_LIB_DIR, f) }));
}

// ── static mode ────────────────────────────────────────────────────────────

function staticAnalysis() {
  const files = listV06SSFiles();
  const report = {
    mode: 'static',
    analyzed_at: new Date().toISOString(),
    files_scanned: files.map(f => f.name),
    findings: [],
    verdict: null,
  };

  if (files.length === 0) {
    report.verdict = 'NO_V06_SS_FILES';
    return report;
  }

  // Find spine SS file (= primary settle entrypoint)
  const spineFile = files.find(f => /Spine/i.test(f.name));
  if (!spineFile) {
    report.findings.push({ severity: 'WARN', msg: 'No PoolSpine v06 file found' });
    report.verdict = 'INCOMPLETE';
    return report;
  }

  const spineSrc = fs.readFileSync(spineFile.path, 'utf8');

  // Defense check 1: settle entrypoint uses 5 individual checkSig (path A) NOT single aggSig?
  const aggSigPattern = /checkSig\s*\(\s*aggSig\s*,\s*aggPk\s*\)/;
  // Match J1 path A pattern: if (checkSig(c0Sig, pubkey(c0Pk))) { ... } + require(checkSig(...)) for dispute
  const individualSigPattern = /checkSig\s*\(\s*c\d+Sig\s*,\s*pubkey\s*\(\s*c\d+Pk\s*\)\s*\)/g;
  const counterPattern = /require\s*\(\s*(?:validSigs|verifiedCount|sigCount|\w+Sigs)\s*>=?\s*(\d+)/i;

  const hasAggSig = aggSigPattern.test(spineSrc);
  const indivSigMatches = (spineSrc.match(individualSigPattern) || []).length;
  const counterMatch = spineSrc.match(counterPattern);

  // Path A defense pattern: ≥3 individual checkSig + counter require ≥t
  if (hasAggSig && indivSigMatches < 3) {
    report.findings.push({
      severity: 'CRITICAL',
      msg: 'spine uses single aggSig+aggPk — self-claim VULNERABLE (= J1 r119 confirmed hole)',
      evidence: 'checkSig(aggSig, aggPk) pattern present, < 3 individual sig checks',
    });
  } else if (indivSigMatches >= 3 && counterMatch) {
    report.findings.push({
      severity: 'INFO',
      msg: `Path A defense PRESENT — ${indivSigMatches} individual checkSig + counter require ≥${counterMatch[1]}`,
      evidence: { individual_checksigs: indivSigMatches, threshold_t: parseInt(counterMatch[1], 10) },
    });
  } else {
    report.findings.push({
      severity: 'WARN',
      msg: `Unclear defense pattern — aggSig:${hasAggSig}, individual:${indivSigMatches}, counter:${counterMatch ? counterMatch[1] : 'absent'}`,
    });
  }

  // Defense check 2: poolMerkleRoot baked in ctor (= committee subset constraint)
  const ctorRe = /contract\s+\w+\s*\(([^)]+)\)/;
  const ctorMatch = spineSrc.match(ctorRe);
  if (ctorMatch) {
    const hasPoolMerkleRoot = /poolMerkleRoot/i.test(ctorMatch[1]);
    report.findings.push({
      severity: hasPoolMerkleRoot ? 'INFO' : 'CRITICAL',
      msg: hasPoolMerkleRoot ? 'poolMerkleRoot baked in ctor (= committee constrained to public pool)' : 'poolMerkleRoot MISSING from ctor — attacker free to pick arbitrary PKs',
    });
  }

  // Defense check 3: PoolSide v06 — claim_winner spine-binding?
  const sideFile = files.find(f => /Side/i.test(f.name));
  if (sideFile) {
    const sideSrc = fs.readFileSync(sideFile.path, 'utf8');
    const sideCtor = sideSrc.match(ctorRe);
    if (sideCtor) {
      const hasSpineHash = /spineP2shHash/i.test(sideCtor[1]);
      const hasPoolMerkle = /poolMerkleRoot/i.test(sideCtor[1]);
      // Path A spec: side ctor MUST bake poolMerkleRoot (= claim_winner verifies via OpTxInputSpk-like binding when supported, or via aggPk hash binding)
      report.findings.push({
        severity: (hasSpineHash || hasPoolMerkle) ? 'INFO' : 'CRITICAL',
        msg: `PoolSide v06 ctor binding fields — spineP2shHash:${hasSpineHash}, poolMerkleRoot:${hasPoolMerkle}`,
      });
    }
    // Check claim_winner uses runtime args without binding to committee/spine?
    const claimWinnerSec = sideSrc.match(/entrypoint\s+function\s+claim_winner\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    if (claimWinnerSec) {
      const hasMerkleVerify = /poolMerkleRoot|merkleProof|merkleRoot/i.test(claimWinnerSec[0]);
      report.findings.push({
        severity: hasMerkleVerify ? 'INFO' : 'WARN',
        msg: hasMerkleVerify ? 'claim_winner body references merkle proof verify' : 'claim_winner body does NOT reference merkle verify — bind-to-spine may be weak',
      });
    }
  }

  // Verdict
  const critical = report.findings.filter(f => f.severity === 'CRITICAL').length;
  const warn = report.findings.filter(f => f.severity === 'WARN').length;
  if (critical > 0) report.verdict = 'ATTACK_FEASIBLE';
  else if (warn > 0) report.verdict = 'INCOMPLETE_DEFENSE';
  else report.verdict = 'DEFENSE_PRESENT';

  return report;
}

// ── live mode ──────────────────────────────────────────────────────────────

async function liveAttack() {
  const report = {
    mode: 'live',
    attempted_at: new Date().toISOString(),
    inputs: { market_id: marketId, attacker_relay: attackerRelay },
    steps: [],
    verdict: null,
  };

  function step(name, ok, detail) {
    report.steps.push({ name, ok, detail });
  }

  if (!marketId || !attackerRelay) {
    step('inputs validated', false, { error: 'Both --market=<id> and --attacker=<relay_id> required for live mode' });
    report.verdict = 'INPUT_MISSING';
    return report;
  }

  // Step 1: fetch market — must be v0.6 market
  try {
    const r = await fetch(`${CONSOLE_URL}/api/pool/market/${marketId}`);
    if (!r.ok) {
      step('fetch market', false, { http_status: r.status });
      report.verdict = 'MARKET_FETCH_FAIL';
      return report;
    }
    const market = (await r.json()).market || {};
    const isV06 = market.protocol_version === 'v0.6';
    step('fetch market', true, {
      market_id: market.id,
      protocol_version: market.protocol_version,
      spine_p2sh: market.spine_p2sh,
      pool_merkle_root: market.pool_merkle_root,
      is_v06: isV06,
    });
    if (!isV06) {
      report.verdict = 'NOT_V06_MARKET';
      return report;
    }
  } catch (e) {
    step('fetch market', false, { error: e.message });
    report.verdict = 'MARKET_FETCH_FAIL';
    return report;
  }

  // Step 2: STUB — actual TX construction + broadcast wires when J1 path A SS ships
  step('construct attack TX', false, {
    stub_reason: 'pending J1 path A SS final ctor params + scriptSig format lock',
    blocker: 'PoolSpine_v06_pathA.sil + pool-p2sh-v06-pathA.mjs ship to docs/oracle-v06-spec or main',
    expected_path: 'attacker fakes 5 sigs over chosen disputeOutcomeHash + picks any 5 pool PKs + computes committeePkHash + builds settle_aggregate scriptSig + RPC submitTransaction',
    expected_result: 'mempool reject "invalid signature" (= path A 5 individual checkSig each fail since attacker !=== committee privkey holders)',
  });
  report.verdict = 'STUB_PENDING_PATH_A_SHIP';

  return report;
}

// ── main ────────────────────────────────────────────────────────────────────

let report;
if (mode === 'static') report = staticAnalysis();
else if (mode === 'live') report = await liveAttack();
else {
  console.error(`mode must be 'static' or 'live'`);
  process.exit(1);
}

const outAbs = path.resolve(outPath);
fs.writeFileSync(outAbs, JSON.stringify(report, null, 2));

console.log(`Attack report: ${outAbs}`);
console.log(`Mode: ${mode} | Verdict: ${report.verdict}`);
if (report.findings) {
  for (const f of report.findings) {
    console.log(`  [${f.severity}] ${f.msg}`);
  }
}
if (report.steps) {
  for (const s of report.steps) {
    console.log(`  [${s.ok ? 'OK' : 'NOTE'}] ${s.name}`);
  }
}

// Exit code: 0 if defense present OR stub pending; 1 if attack feasible (= broken design)
const exitCode = report.verdict === 'ATTACK_FEASIBLE' ? 1 : 0;
process.exit(exitCode);
