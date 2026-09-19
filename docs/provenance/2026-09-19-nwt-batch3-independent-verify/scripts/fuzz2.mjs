import { calcStorageMass } from './port_mass.mjs';
const { handComputeStorageMass } = await import('../../src/lib/proto-mass-ceiling.mjs');
let seed = 987654; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const amt = () => BigInt(Math.floor(10 ** (6 + rnd() * 6.5))); // 1e6..3e12 sompi (0.01 KAS .. 30k KAS)
const TH = 475000n, LIM = 500000n;
let n = 0, under = 0, falsePass = 0, nearUnder = 0, maxUnderNear = 0n, ex1 = null, fp = null;
for (let t = 0; t < 1500000; t++) {
  const ni = ri(1, 4), no = ri(1, 5);
  const ins = Array.from({ length: ni }, () => ({ p: BigInt(ri(1, 3)), a: amt() }));
  const outs = Array.from({ length: no }, () => ({ p: BigInt(ri(1, 3)), a: amt() }));
  const ex = calcStorageMass(ins, outs).mass;
  const j = handComputeStorageMass(outs.map(o => ({ plurality: o.p, amountSompi: o.a })), ins.map(i => ({ plurality: i.p, amountSompi: i.a })));
  n++;
  if (j < ex) { under++; if (ex <= 2_000_000n) { nearUnder++; const d = ex - j; if (d > maxUnderNear) { maxUnderNear = d; ex1 = { ins, outs, exact: ex, j2: j }; } } }
  if (j < TH && ex >= LIM) { falsePass++; fp = fp ?? { ins, outs, exact: ex, j2: j }; }
}
const S = (o) => JSON.stringify(o, (k, v) => typeof v === 'bigint' ? v.toString() : v);
console.log({ n, under, nearUnder_exactLE2M: nearUnder, maxUnderWhenExactLE2M: String(maxUnderNear), falsePass_j2LT475k_exactGE500k: falsePass });
if (ex1) console.log('max under (exact<=2M):', S(ex1));
if (fp) console.log('first false-pass:', S(fp));
