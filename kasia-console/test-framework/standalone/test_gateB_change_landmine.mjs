// J1tn gate B (DoD #4 / 找零核弹) regression — the 4-case money-safety test bar.
//
// scope: docs/2026-06-01-change-landmine-depth20-selfclaim-audit.md §5bis test bar + 红线 7/8/9.
//   Manual P2SH TX (settle/refund/dispute) have NO Generator change-handling → silent burn / overflow /
//   fee-too-low (qlfpv brick) / KIP-9 mass reject. This locks the 4 money-safety invariants down as regression.
// the 4 cases (audit §5bis):
//   ① fee-adequacy   — fee >= mass × mempool_floor (NOT just fee>0; qlfpv 第三面: fee=50000 < 442000 → reject)
//   ② dust-floor     — small output → KIP-9 storage-mass blows up → fee scales to cover it (not a fixed brick)
//   ③ BigInt 大额     — 90万-KAS-class pools don't overflow / lose precision
//   ④ Σ balance      — zero overspend, zero burn: Σ outputs == totalPool − minerFee
//
// 真调生产 export: kip9-mass.mjs (fee math, pure) + computePoolPayouts (pool-market-settler.js, pure) = 非拷贝.
// run: node test-framework/standalone/test_gateB_change_landmine.mjs   (exit 0=PASS, 1=FAIL)

import { estimateStorageMass, computeSingleOutputFee, computeMultiOutputFee, SOMPI_PER_MASS, MIN_BROKER_FEE_FLOOR } from '../../src/lib/kip9-mass.mjs';
import { computePoolPayouts } from '../../src/services/pool-market-settler.js';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

const MEMPOOL_FLOOR_RATE = 100; // sompi/mass (kaspad mempool standardness floor); SOMPI_PER_MASS=110 = 10% margin.
const e8 = 1e8;

// ── ① fee-adequacy (红线 7): dynamic fee >= mass × mempool_floor, NOT a fixed below-floor constant (qlfpv) ──
const f1 = computeSingleOutputFee(2000, 50 * e8);   // a normal settle-ish TX (compute mass 2000, 50-KAS output)
check('① fee covers mempool floor (fee >= totalMass × 100)', f1.dynamicFee >= f1.totalMass * MEMPOOL_FLOOR_RATE, JSON.stringify(f1));
check('① fee has the 10% margin (= totalMass × 110, unless min/max clamp)', f1.dynamicFee === Math.min(100_000_000, Math.max(2_000_000, f1.totalMass * SOMPI_PER_MASS)), JSON.stringify(f1));
// qlfpv re-creation: the failing TX had a SMALL output (high storage mass) yet fee was hard-wired 50000 → rejected.
// With the dynamic fn, the same small-output TX must produce a fee >> 50000 (= the qlfpv brick can't recur).
const fq = computeSingleOutputFee(1500, 1100);      // qlfpv-like: tiny ~1100-sompi output → storage mass explodes
check('① qlfpv brick cannot recur: tiny-output fee >> 50000 (old hardcoded brick)', fq.dynamicFee > 50000, JSON.stringify(fq));
check('① qlfpv: tiny output → storage mass dominates (>> compute mass)', fq.storageMass > 1500, JSON.stringify(fq));

// ── ② dust-floor: KIP-9 storage mass is INVERSELY proportional to output value (small = penalized) ──
check('② small output → high storage mass', estimateStorageMass(1000) > estimateStorageMass(100 * e8), `small=${estimateStorageMass(1000)} large=${estimateStorageMass(100*e8)}`);
check('② large legitimate output → low storage mass (min-pot pools not over-fee-penalized)', estimateStorageMass(1000 * e8) < 1000, `${estimateStorageMass(1000*e8)}`);
// multi-output (e.g. 5 committee bond outputs) accumulates each small output's mass → fee scales with count.
const fm1 = computeMultiOutputFee(3000, 1 * e8, 1);
const fm5 = computeMultiOutputFee(3000, 1 * e8, 5);
check('② multi-output fee scales with small-output count (5 > 1)', fm5.dynamicFee >= fm1.dynamicFee && fm5.storageMass === 5 * fm1.storageMass, `1=${JSON.stringify(fm1)} 5=${JSON.stringify(fm5)}`);

// ── ③ BigInt 大额边界: 90万-KAS-class pool, no overflow / NaN / precision loss ──
const big = 900_000 * e8;     // 900,000 KAS = 9e13 sompi (within Number-safe but exercises large-value path)
const bigParts = [
  { stake: big, direction: 1, isMaker: true },   // maker NO (loser)
  { stake: big, direction: 0 },                  // bettor YES (winner)
];
const rb = computePoolPayouts({ participants: bigParts, winner: 0, brokerFeePct: 190, minerFee: 5_000_000, unanimous: true, silentOracleIndex: null, committeeMode: true, oracleCount: 5, oracleFeePct: 100, makerFeePct: 10, oracleBond: 0 });
const allAmounts = [...rb.winnerPayouts, ...rb.oracleBondReturns].map(x => Number(x.amount));
check('③ 90万KAS pool: all payouts finite (no NaN/Infinity/overflow)', allAmounts.every(a => Number.isFinite(a) && a >= 0), JSON.stringify(allAmounts));
check('③ 90万KAS winner payout is the dominant non-trivial value', rb.winnerPayouts.reduce((s, w) => s + Number(w.amount), 0) > big, `winnerSum=${rb.winnerPayouts.reduce((s,w)=>s+Number(w.amount),0)} pool=${2*big}`);

// ── ④ Σ balance: zero overspend / zero burn — Σ all outputs == totalPool − minerFee ──
const minerFee = 5_000_000;
const small = [
  { stake: 150 * e8, direction: 1, isMaker: true },  // maker NO (loser)
  { stake: 1 * e8, direction: 0 },                   // bettor YES (winner)
];
const totalPool = (150 + 1) * e8;
const rs = computePoolPayouts({ participants: small, winner: 0, brokerFeePct: 190, minerFee, unanimous: true, silentOracleIndex: null, committeeMode: true, oracleCount: 5, oracleFeePct: 100, makerFeePct: 10, oracleBond: 0 });
// sum EVERY output the settle TX emits (real computePoolPayouts fields): winner shares + the 3 fee scalars
// (brokerFee/oracleFeeTotal/makerFee) + committee bond returns + maker-extra (if any).
const sumArr = (arr) => (arr || []).reduce((s, x) => s + Number(x.amount !== undefined ? x.amount : x || 0), 0);
const makerExtra = rs.makerExtraOutput == null ? 0 : Number(rs.makerExtraOutput.amount ?? rs.makerExtraOutput);
const totalOut = sumArr(rs.winnerPayouts) + sumArr(rs.oracleBondReturns)
  + Number(rs.brokerFee || 0) + Number(rs.oracleFeeTotal || 0) + Number(rs.makerFee || 0) + makerExtra;
// conservation: Σ out + minerFee == totalPool (zero burn, zero overspend). allow ≤ a few sompi floor-rounding.
const diff = Math.abs((totalOut + minerFee) - totalPool);
check('④ Σ balance: Σ outputs + minerFee == totalPool (zero burn/overspend, ≤ dust rounding)', diff <= 10, `totalOut=${totalOut} +minerFee=${minerFee} vs pool=${totalPool} diff=${diff}`);
check('④ Σ matches contract _totalPool field exactly', (totalOut + minerFee) === Number(rs._totalPool), `out+fee=${totalOut+minerFee} _totalPool=${rs._totalPool}`);
check('④ no output negative (no silent burn into negative)', [...rs.winnerPayouts, ...(rs.oracleBondReturns||[])].every(x => Number(x.amount !== undefined ? x.amount : x) >= 0) && rs.brokerFee >= 0 && rs.oracleFeeTotal >= 0 && rs.makerFee >= 0, JSON.stringify({w:rs.winnerPayouts, bf:rs.brokerFee, of:rs.oracleFeeTotal, mf:rs.makerFee}));

console.log(fails === 0 ? '\n✅ gate B 找零核弹 4-case money-safety regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
