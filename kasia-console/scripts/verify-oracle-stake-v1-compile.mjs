// Compile OracleStake_v1.sil with sample ctor + report redeem script size + P2SH addr.
// J1 SS step [1] per docs/2026-06-01-onchain-stake-oracle-pool-DECISION.md.
//
// Verify points:
//   - silverc OK (compile clean, artifact emitted)
//   - script bytes len finite + reasonable (< ~500 B target, leaving budget for storage_mass)
//   - 1 entrypoint emitted: timeout_unlock (Option C — slash deferred to v2)
//   - DAA-mode lockTime: lockUntilDaa = 600_000_000 < 500B threshold OK

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { blake2b } from '@noble/hashes/blake2b';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const STAKE_SIL = join(__dirname, '..', 'src', 'lib', 'OracleStake_v1.sil');

const NETWORK = process.argv[2] || 'testnet-12';

function bytes32Expr(hexStr) {
  if (hexStr.startsWith('0x')) hexStr = hexStr.slice(2);
  if (hexStr.length !== 64) throw new Error(`bytes32 needs 64 hex chars, got ${hexStr.length}`);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hexStr.substr(i*2, 2), 16);
  return { kind: 'array', data: Array.from(bytes, b => ({ kind: 'byte', data: b })) };
}
function intExpr(n) { return { kind: 'int', data: n }; }

const STAKER_PK_X = 'a1b2c3d4e5f607182930415263748596a7b8c9d0e1f2031425364758697a8b9c';
const LOCK_UNTIL_DAA = 600_000_000;
const MINER_FEE = 10_000;

const ctorJson = [
  bytes32Expr(STAKER_PK_X),
  intExpr(LOCK_UNTIL_DAA),
  intExpr(MINER_FEE),
];

const cacheDir = join(tmpdir(), 'kanet-ss-artifact-cache');
if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
const ctorPath = join(cacheDir, 'oracle-stake-v1-verify.ctor.json');
writeFileSync(ctorPath, JSON.stringify(ctorJson));

console.log('OracleStake_v1 compile-verify');
console.log('  SILVERC:', SILVERC);
console.log('  SIL:', STAKE_SIL);
console.log('  ctor.stakerPkX:', STAKER_PK_X);
console.log('  ctor.lockUntilDaa:', LOCK_UNTIL_DAA, '(<500B threshold => DAA-mode lockTime)');
console.log('  ctor.minerFee:', MINER_FEE);
console.log('');

let stdout;
try {
  stdout = execFileSync(SILVERC, [STAKE_SIL, '--ctor', ctorPath, '-c'], { stdio: 'pipe', timeout: 30_000 });
} catch (e) {
  const stderr = e.stderr?.toString() || '';
  console.error('SILVERC FAIL:', e.message);
  console.error('STDERR:', stderr.slice(0, 600));
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(stdout.toString());
} catch (e) {
  console.error('JSON parse fail:', e.message);
  console.error('STDOUT first 300:', stdout.toString().slice(0, 300));
  process.exit(1);
}

if (artifact.contract_name !== 'OracleStake_v1') {
  console.error(`contract_name mismatch: ${artifact.contract_name} (expected OracleStake_v1)`);
  process.exit(1);
}

const scriptBytes = new Uint8Array(artifact.script);
console.log('compile OK');
console.log('  contract_name:', artifact.contract_name);
console.log('  redeemScript size:', scriptBytes.length, 'B');
console.log('  entrypoints:', Object.keys(artifact.entrypoints || artifact.entries || {}).join(', ') || 'N/A');

const p2shHash = Buffer.from(blake2b(scriptBytes, { dkLen: 32 })).toString('hex');
console.log('  p2sh blake2b-256:', p2shHash);

try {
  const kaspa = await import('kaspa-wasm');
  const { ScriptBuilder, addressFromScriptPublicKey } = kaspa;
  const builder = ScriptBuilder.fromScript(scriptBytes);
  const p2shSpk = builder.createPayToScriptHashScript();
  const addr = addressFromScriptPublicKey(p2shSpk, NETWORK);
  console.log('  p2shAddr (' + NETWORK + '):', addr ? addr.toString() : '(undefined)');
} catch (e) {
  console.log('  kaspa-wasm import skip:', e.message);
}

console.log('');
console.log('VERIFY OK — OracleStake_v1.sil compiles clean, ready for J2/KANet-UI integration');
