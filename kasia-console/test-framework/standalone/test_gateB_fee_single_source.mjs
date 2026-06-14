// J1tn gate B③ fork合 — fee-rate single-source drift guard.
//
// scope: INVARIANTS SYS-2 单源铁律 — 手构 TX(settle/refund/dispute/claim) fee 必走单一访问器 kip9-mass.mjs,
//   禁本地抄 fee 常数/公式 (抄 = fork, rate 改则副本不跟 = drift = 找零核弹类静默错).
// what this locks: pool-market-settler.js 的 fee-rate (SOMPI_PER_MASS) 必 import 自 kip9-mass.mjs 单源,
//   不准本地 `const SOMPI_PER_MASS = <literal>` 再 fork. (gate B③ fork合 1: 前 settler 本地 110n 副本已删.)
// run: node test-framework/standalone/test_gateB_fee_single_source.mjs   (exit 0=PASS, 1=FAIL)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SOMPI_PER_MASS } from '../../src/lib/kip9-mass.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const settlerPath = join(__dirname, '../../src/services/pool-market-settler.js');
const settlerSrc = readFileSync(settlerPath, 'utf8');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

// ── ① canonical pin: kip9-mass 单源 SOMPI_PER_MASS == 110 (mempool floor 100 + 10% margin; qlfpv 442000/4420=100) ──
check('① canonical SOMPI_PER_MASS == 110 (kip9-mass single source)', SOMPI_PER_MASS === 110, `got ${SOMPI_PER_MASS}`);

// ── ② settler imports the rate from kip9-mass (单源) — not a local copy ──
check('② settler imports SOMPI_PER_MASS from kip9-mass.mjs',
  /import\s*\{[^}]*\bSOMPI_PER_MASS\b[^}]*\}\s*from\s*['"]\.\.\/lib\/kip9-mass\.mjs['"]/s.test(settlerSrc),
  'no `import { ... SOMPI_PER_MASS ... } from "../lib/kip9-mass.mjs"` found in settler');

// ── ③ DRIFT GUARD (核心): settler 不准本地 fork SOMPI_PER_MASS 为数字字面量 (= 重 fork = 抄, INVARIANTS SYS-2 禁) ──
//   允许 `const SOMPI_PER_MASS_BI = BigInt(SOMPI_PER_MASS)` (单源 import 的 BigInt 包, 非 fork);
//   禁 `const SOMPI_PER_MASS = 110` / `= 110n` (= 本地数字副本, drift 源).
const localNumericFork = /const\s+SOMPI_PER_MASS\s*=\s*\d/.test(settlerSrc);  // 数字字面量赋值 = fork
check('③ no local numeric SOMPI_PER_MASS fork in settler (drift guard)',
  !localNumericFork,
  'found `const SOMPI_PER_MASS = <number>` local copy — re-fork of the single source (INVARIANTS SYS-2 violation)');

// ── ④ settler 的 BigInt 费率别名派生自单源 import (= BigInt(SOMPI_PER_MASS)), TX-fee 大数运算用它 ──
check('④ settler BigInt fee-rate derives from the single-source import',
  /const\s+SOMPI_PER_MASS_BI\s*=\s*BigInt\(\s*SOMPI_PER_MASS\s*\)/.test(settlerSrc),
  'expected `const SOMPI_PER_MASS_BI = BigInt(SOMPI_PER_MASS)` deriving from the import');

if (fails === 0) { console.log('\n✅ gate B③ fork合 fee-rate single-source: ALL PASS'); process.exit(0); }
else { console.error(`\n❌ ${fails} FAIL — fee-rate fork drift not guarded`); process.exit(1); }
