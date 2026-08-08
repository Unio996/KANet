// (i) DoD ① -- mutation test: does changing a baked ctor field actually change the redeem?
//
// THE CLAIM UNDER TEST (precond6 v0.2.1 C-2, until now only [strong-inference]):
//   A ctor parameter the .sil body never references is dropped by silverc and never reaches the
//   compiled redeem. If true, brokerFeePct / oracleFeePct -- declared in the v0.6/v0.7 ctors but
//   used in no function body -- are NOT committed by the P2SH, so "this market committed to that
//   fee rate" is simply false for them.
//
// WHY REDEEM AND NOT P2SH ADDRESS:
//   P2SH = blake2b(redeem), a deterministic function, so redeem-changed <=> P2SH-changed. Going
//   straight to the compiler output avoids pool-p2sh.mjs:102 `await import('kaspa-wasm')`, which
//   cannot resolve on the mining host (its three node_modules/kaspa-wasm copies are empty shells;
//   only shared/vendor holds a real one). Scope note: this therefore exercises the same COMPILER
//   and the same ctor JSON as production, but not production's address-derivation code path.
//
// WHY THE POSITIVE CONTROLS ARE NOT OPTIONAL:
//   "the redeem did not change" and "I never compiled anything" print identically. minerFee and
//   deadline ARE referenced in the bodies, so mutating them MUST change the redeem. If a control
//   does not move, the run measures this harness, not the compiler, and must not be cited.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SILVERC = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';
const LIB = process.env.FEE_MUT_LIB || 'D:/kanet-tn12/kasia-console/src/lib';

const PK_A = 'f63c284e2c2b920818d6f916f542f987cab9a902cce13dfe91ec5aa2192e018e';
const PK_B = '453b287aaab98d1b9ccf1e4cbf8d173d0e3a320358ec4e27f1d098495c250af7';
const ROOT = 'e962f13e19d8bc585cf25c0b2fd296753405e683fd735379736562da562bee8f';
const META = '0000000000000000000000000000000000000000000000000000000000000001';
const MKID = '00000000000000000000000000000000000000000000000000000000000000aa';

// Ctor encoding copied from the production helpers (pool-p2sh.mjs:56-63), not guessed --
// my first attempt invented {type,value} and silverc rejected it with "missing field `kind`".
const b32 = (h) => ({ kind: 'array', data: Array.from(Buffer.from(h, 'hex'), (b) => ({ kind: 'byte', data: b })) });
const i = (n) => ({ kind: 'int', data: Number(n) });

// Ctor shapes are per contract and were READ OFF EACH SOURCE, not assumed shared:
// v0.7 carries three fields v0.6 does not (shard_id, shard_count, market_id), which is exactly
// why the first run died with "constructor argument count mismatch".
const SHAPES = {
  'PoolSpine_v06': (f) => [
    b32(f.makerPk), b32(f.brokerPk), b32(f.poolMerkleRoot), i(f.deadline), i(f.minerFee),
    i(f.brokerFeePct), i(f.oracleFeePct), i(f.oracleBondAmount), i(f.makerStakeAmount), b32(f.marketMetadataHash),
  ],
  'PoolSpine_v07': (f) => [
    b32(f.makerPk), b32(f.brokerPk), b32(f.poolMerkleRoot), i(f.deadline), i(f.minerFee),
    i(f.brokerFeePct), i(f.oracleFeePct), i(f.oracleBondAmount), i(f.makerStakeAmount), b32(f.marketMetadataHash),
    i(f.shard_id), i(f.shard_count), b32(f.market_id),
  ],
};

const BASE = {
  makerPk: PK_A, brokerPk: PK_B, poolMerkleRoot: ROOT, deadline: 1800000000,
  minerFee: 50000, brokerFeePct: 100, oracleFeePct: 500, oracleBondAmount: 100000000,
  makerStakeAmount: 10000000000, marketMetadataHash: META,
  shard_id: 0, shard_count: 1, market_id: MKID,
};

const MUTATIONS = [
  { field: 'oracleFeePct', to: 900,  role: 'SUBJECT' },
  { field: 'brokerFeePct', to: 700,  role: 'SUBJECT' },
  // market_id is the field NWT FINDING-2 recorded as dropped-when-unused, causing fund
  // commingling. v0.7 added it to the ctor; whether it survives into the redeem is a
  // money-safety question, not a style one.
  { field: 'market_id', to: '00000000000000000000000000000000000000000000000000000000000000bb', role: 'SUBJECT', only: ['PoolSpine_v07'] },
  { field: 'minerFee', to: 77777, role: 'CONTROL' },
  { field: 'deadline', to: 1900000000, role: 'CONTROL' },
];

function compile(contract, fields) {
  const silPath = path.join(LIB, `${contract}.sil`);
  const ctor = SHAPES[contract](fields);
  const tmp = path.join(os.tmpdir(), `fee-mut-${createHash('sha256').update(contract + JSON.stringify(ctor)).digest('hex').slice(0, 16)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(ctor));
  const out = execFileSync(SILVERC, [silPath, '--ctor', tmp, '-c'], { stdio: 'pipe', timeout: 60_000 }).toString();
  const art = JSON.parse(out);
  // silverc emits `script` as a BYTE ARRAY (verified: Array[1946] for v0.6), not a hex string.
  // Keys confirmed by inspection: contract_name, compiler_version, script, ast, abi, ...
  if (!Array.isArray(art.script)) {
    throw new Error(`artifact.script is not an array (got ${typeof art.script}); keys=${Object.keys(art).join(',')}`);
  }
  const buf = Buffer.from(art.script);
  return { script: buf, len: buf.length, sha: createHash('sha256').update(buf).digest('hex').slice(0, 16) };
}

console.log(`silverc  = ${SILVERC}`);
console.log(`lib      = ${LIB}\n`);

let controlsRun = 0, controlsMoved = 0, baselinesOk = 0;
const contracts = (process.env.FEE_MUT_CONTRACTS || 'PoolSpine_v06,PoolSpine_v07').split(',').map((s) => s.trim());

for (const c of contracts) {
  let base;
  try { base = compile(c, BASE); baselinesOk++; }
  catch (e) { console.log(`=== ${c}\n  🔴 BASELINE FAILED: ${String(e.stderr || e.message).slice(0, 220)}\n`); continue; }
  console.log(`=== ${c}   baseline redeem sha=${base.sha}  len=${base.len}`);
  for (const m of MUTATIONS) {
    if (m.only && !m.only.includes(c)) continue;
    let r;
    try { r = compile(c, { ...BASE, [m.field]: m.to }); }
    catch (e) { console.log(`  ${m.field.padEnd(16)} 🔴 COMPILE FAILED: ${String(e.stderr || e.message).slice(0, 140)}`); continue; }
    const changed = r.sha !== base.sha;
    if (m.role === 'CONTROL') { controlsRun++; if (changed) controlsMoved++; }
    const verdict = m.role === 'CONTROL'
      ? (changed ? '✅ changed (control OK)' : '🔴 UNCHANGED -- CONTROL FAILED')
      : (changed ? '✅ changed -> IS baked into redeem' : '🔴 UNCHANGED -> NOT in redeem (compiler dropped it)');
    console.log(`  ${m.field.padEnd(16)} [${m.role.padEnd(7)}] ${verdict}   sha=${r.sha}`);
  }
  console.log();
}

console.log(`baselines ${baselinesOk}/${contracts.length}   controls run ${controlsRun}   controls that moved ${controlsMoved}`);
if (controlsRun === 0) {
  console.log('🔴 NO CONTROL EVER RAN -- this run proves NOTHING. Do not cite any SUBJECT result.');
  process.exitCode = 1;
} else if (controlsMoved < controlsRun) {
  console.log('🔴 A CONTROL DID NOT MOVE -- measuring the harness, not the compiler. Do not cite.');
  process.exitCode = 1;
} else {
  console.log('✅ all controls moved => unchanged SUBJECT fields are a real compiler result.');
}
