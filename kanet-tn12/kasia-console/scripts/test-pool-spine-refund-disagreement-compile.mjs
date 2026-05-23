// B2 v0.5 area-4 refund_disagreement SS entry — compile-time regression.
//
// Verifies the new entrypoint added to PoolSpine.sil compiles cleanly via silverc.exe
// with representative ctor args (= 5 pubkeys + 4 ints + metadata hash, same shape as
// production calls in pool-p2sh.mjs). Also confirms the contract bytecode actually grew
// vs the pre-refund_disagreement baseline (~700B) so we know the new entry is in.
//
// silverc.exe path is env-overridable via SILVERC_PATH (= matches pool-p2sh.mjs).
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe';
const SPINE_SIL = 'src/lib/PoolSpine.sil';
const CTOR_PATH = join(tmpdir(), `_test-poolspine-refund-disagreement-ctor.json`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

if (!existsSync(SILVERC)) {
  console.log(`  SKIP silverc.exe not at ${SILVERC} — set SILVERC_PATH or skip in CI without compiler`);
  process.exit(0);
}

const bytes32 = () => ({ kind: 'array', data: Array.from({ length: 32 }, (_, i) => ({ kind: 'byte', data: i + 1 })) });
const intExpr = (n) => ({ kind: 'int', data: n });

const ctor = [
  bytes32(), bytes32(), bytes32(), bytes32(), bytes32(),  // 5 pubkeys
  intExpr(1716470400),  // deadline (sec)
  intExpr(20000),       // minerFee
  intExpr(100),         // brokerFeePct
  intExpr(100_000_000), // oracleBondAmount
  intExpr(100_000_000), // makerStakeAmount
  bytes32(),            // marketMetadataHash
];

writeFileSync(CTOR_PATH, JSON.stringify(ctor));

let artifact;
try {
  const stdout = execFileSync(SILVERC, [SPINE_SIL, '--ctor', CTOR_PATH, '-c'], { stdio: 'pipe', timeout: 30_000 });
  artifact = JSON.parse(stdout.toString());
} catch (e) {
  const stderr = e.stderr?.toString() || '';
  ok(false, `silverc compile fail: ${e.message}${stderr ? ` | ${stderr.slice(0, 500)}` : ''}`);
  console.log(`\ntest-pool-spine-refund-disagreement-compile: ${pass} PASS / ${fail} FAIL`);
  process.exit(1);
}

ok(artifact.contract_name === 'PoolSpine', `contract_name = "PoolSpine"`);
ok(Array.isArray(artifact.script) && artifact.script.length > 0, `compiled script is non-empty (length=${artifact.script.length})`);
// Pre-refund_disagreement PoolSpine was ~700-1000 bytes; with the new entry it should be larger.
// The exact threshold is a soft sanity bound — silverc may optimize differently across versions.
ok(artifact.script.length >= 900, `script length ${artifact.script.length} ≥ 900 (= grew vs pre-entry baseline)`);

console.log(`\ntest-pool-spine-refund-disagreement-compile: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
