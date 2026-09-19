// NWT 终审: J2 7f1e339b 的 calcStorageMassExact / calcComputeMassExact vs 我按 consensus 源码独立移植(port_mass.mjs)。随机形状逐位对拍。
import { calcStorageMass, computeMass } from './port_mass.mjs';
const J2 = await import('file:///D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/proto-mass-ceiling.mjs');
let seed = 20260919; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const amt = () => BigInt(Math.floor(10 ** (3 + rnd() * 9.5)));
let n = 0, diff = 0, rel = 0, ar = 0, first = null;
for (let t = 0; t < 600000; t++) {
  const ni = ri(1, 5), no = ri(1, 6);
  const ins = Array.from({ length: ni }, () => ({ p: BigInt(ri(1, 3)), a: amt() }));
  const outs = Array.from({ length: no }, () => ({ p: BigInt(ri(1, 3)), a: amt() }));
  const mine = calcStorageMass(ins, outs);
  let theirs; try { theirs = J2.calcStorageMassExact(ins.map(x => ({ plurality: x.p, amountSompi: x.a })), outs.map(x => ({ plurality: x.p, amountSompi: x.a }))); } catch (e) { theirs = { mass: -1n, path: 'threw:' + e.message.slice(0, 40) }; }
  n++; const isRel = mine.path.startsWith('relaxed'); if (isRel) rel++; else ar++;
  if (theirs.mass !== mine.mass || (theirs.path === 'relaxed') !== isRel) { diff++; first = first ?? { ins, outs, mine: String(mine.mass), theirs: String(theirs.mass), pm: mine.path, pt: theirs.path }; }
}
console.log('storage differential: n=', n, 'relaxed=', rel, 'arithmetic=', ar, 'DIFF=', diff);
if (first) console.log('first diff', JSON.stringify(first, (k, v) => typeof v === 'bigint' ? v.toString() : v));
// compute: 随机 v1 tx
let cd = 0, cn = 0;
for (let t = 0; t < 200000; t++) {
  const ni = ri(1, 4), no = ri(1, 5), payload = ri(0, 3) === 0 ? ri(1, 50) : 0;
  const inputsF = Array.from({ length: ni }, () => ({ sigScriptBytes: ri(0, 40000), computeBudget: ri(0, 200) }));
  const outsF = Array.from({ length: no }, () => ({ spkByteLen: ri(20, 60), hasCovenant: rnd() < 0.5 }));
  const tx = { version: 1, payload: '00'.repeat(payload), inputs: inputsF.map(i => ({ signatureScript: '00'.repeat(i.sigScriptBytes), computeBudget: i.computeBudget })), outputs: outsF.map(o => ({ scriptPublicKey: '0000' + '00'.repeat(o.spkByteLen), covenant: o.hasCovenant ? {} : undefined })) };
  const mine = computeMass(tx); const theirs = J2.calcComputeMassExact({ version: 1, inputs: inputsF, outputs: outsF, payloadBytes: payload });
  cn++; if (mine.compute !== theirs.compute || mine.size !== theirs.size) cd++;
}
console.log('compute differential: n=', cn, 'DIFF=', cd);
