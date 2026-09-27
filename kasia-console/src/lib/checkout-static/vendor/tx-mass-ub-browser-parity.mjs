// tx-mass-ub-browser-parity.mjs — 守 tx-mass-ub-browser.mjs 头注"逐字不改, 只是不再用 Buffer"这句话
// 不落空。对同一批随机构造的 tx 形状, 逐字段比对 mass/compute/storage/transient/size 五个数值。
import * as canonical from '../../../../../kasia-relay/src/lib/tx-mass-ub.mjs';
import * as browser from './tx-mass-ub-browser.mjs';

function randHex(nBytes) { let s = ''; for (let i = 0; i < nBytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0'); return s; }
function randBig(min, max) { const range = max - min; const bits = range.toString(2).length; let v; do { v = BigInt('0b' + Array.from({ length: bits }, () => Math.random() < 0.5 ? '0' : '1').join('')); } while (v > range); return min + v; }

let total = 0, mismatches = 0;

function compareResult(a, b, label) {
  total++;
  const fields = ['mass', 'compute', 'storage', 'transient', 'size'];
  for (const f of fields) {
    if (a[f] !== b[f]) { console.error(`MISMATCH[${label}].${f}: canonical=${a[f]} browser=${b[f]}`); mismatches++; return; }
  }
}

function runCase(shape, label) {
  let rC, rB, eC = null, eB = null;
  try { rC = canonical.estimateMassUpperBound(shape); } catch (e) { eC = e.message; }
  try { rB = browser.estimateMassUpperBound(shape); } catch (e) { eB = e.message; }
  total++;
  if (eC || eB) {
    if (eC !== eB) { console.error(`MISMATCH(error)[${label}]: canonical="${eC}" browser="${eB}"`); mismatches++; }
    return;
  }
  const fields = ['mass', 'compute', 'storage', 'transient', 'size'];
  for (const f of fields) {
    if (rC[f] !== rB[f]) { console.error(`MISMATCH[${label}].${f}: canonical=${rC[f]} browser=${rB[f]}`); mismatches++; return; }
  }
}

// ── 真实 CommissionSplit split/refund 形状(1-7 角色, 有/无找零) ──
function mkShape(nOutputs, hasCovInput) {
  return {
    version: 1,
    inputs: [{ signatureScript: randHex(300), computeBudget: 70, amount: 100_000_000_000n, spkLen: 37n, hasCovenant: hasCovInput }],
    outputs: Array.from({ length: nOutputs }, () => ({ value: randBig(10_000_000n, 100_000_000_000n), spk: randHex(36), covenant: false })),
  };
}
for (let n = 1; n <= 7; n++) { runCase(mkShape(n, true), `commission-split-like-${n}outputs-covenant`); runCase(mkShape(n, false), `commission-split-like-${n}outputs-nocovenant`); }

// ── 随机形状, 覆盖 v0/v1、多输入、极端金额、covenant 输出 ──
for (let i = 0; i < 40; i++) {
  const version = Math.random() < 0.5 ? 0 : 1;
  const nIn = 1 + Math.floor(Math.random() * 3);
  const nOut = 1 + Math.floor(Math.random() * 5);
  const shape = {
    version,
    inputs: Array.from({ length: nIn }, () => ({
      signatureScript: randHex(10 + Math.floor(Math.random() * 200)),
      sigOpCount: Math.floor(Math.random() * 3),
      computeBudget: version >= 1 ? 50 + Math.floor(Math.random() * 100) : undefined,
      amount: randBig(1n, 10_000_000_000_000n),
      spkLen: BigInt(20 + Math.floor(Math.random() * 20)),
      hasCovenant: Math.random() < 0.5,
    })),
    outputs: Array.from({ length: nOut }, () => ({
      value: randBig(1n, 10_000_000_000_000n),
      spk: randHex(20 + Math.floor(Math.random() * 20)),
      covenant: Math.random() < 0.3,
    })),
  };
  runCase(shape, `random#${i}(v${version},in${nIn},out${nOut})`);
}

// ── 边界/错误路径: 零值输出、极端 plurality ──
runCase({ version: 1, inputs: [{ signatureScript: '', computeBudget: 70, amount: 100n, spkLen: 36n, hasCovenant: false }], outputs: [{ value: 0n, spk: randHex(36), covenant: false }] }, 'zero-value-output');
runCase({ version: 1, inputs: [{ signatureScript: '', computeBudget: 70, amount: 100n, spkLen: 36n, hasCovenant: false }], outputs: [{ value: 100n, spk: randHex(20_000), covenant: false }] }, 'huge-spk-plurality-out-of-range');

console.log(`\ntotal cases: ${total}, mismatches: ${mismatches}`);
if (mismatches > 0) { console.error('FAIL'); process.exit(1); }
console.log('PASS: browser port 与 canonical tx-mass-ub.mjs 在全部随机/边界向量下数值逐字段一致');
