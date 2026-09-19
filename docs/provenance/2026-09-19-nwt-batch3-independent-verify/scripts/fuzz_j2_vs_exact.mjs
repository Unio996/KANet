// NWT: 随机形状对拍 —— J2 handComputeStorageMass(被审) vs 我按 consensus 源码移植的 calcStorageMass(独立)。
// 找 J2 < 真值(低估=不安全方向)的形状。
import { calcStorageMass } from './port_mass.mjs';
const { handComputeStorageMass } = await import('../../src/lib/proto-mass-ceiling.mjs');
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const amt = () => BigInt(Math.floor(10 ** (3 + rnd() * 9.5))); // 1e3 .. ~3e12 sompi
let n = 0, under = 0, over = 0, equal = 0, worstUnder = 0n, worstShape = null, byPath = { relaxed: [0, 0, 0], arith: [0, 0, 0] };
for (let t = 0; t < 400000; t++) {
  const ni = ri(1, 4), no = ri(1, 5);
  const ins = Array.from({ length: ni }, () => ({ p: BigInt(ri(1, 3)), a: amt() }));
  const outs = Array.from({ length: no }, () => ({ p: BigInt(ri(1, 3)), a: amt() }));
  const ex = calcStorageMass(ins, outs);
  const j = handComputeStorageMass(outs.map(o => ({ plurality: o.p, amountSompi: o.a })), ins.map(i => ({ plurality: i.p, amountSompi: i.a })));
  n++;
  const k = ex.path.startsWith('relaxed') ? 'relaxed' : 'arith';
  if (j < ex.mass) { under++; byPath[k][0]++; const d = ex.mass - j; if (d > worstUnder) { worstUnder = d; worstShape = { ins, outs, exact: ex.mass, j2: j, path: ex.path }; } }
  else if (j > ex.mass) { over++; byPath[k][1]++; } else { equal++; byPath[k][2]++; }
}
console.log({ n, under, over, equal, worstUnder: String(worstUnder) });
console.log('by path [under, over, equal]:', JSON.stringify(byPath));
if (worstShape) console.log('worst under-estimate shape:', JSON.stringify(worstShape, (k, v) => typeof v === 'bigint' ? v.toString() : v));
