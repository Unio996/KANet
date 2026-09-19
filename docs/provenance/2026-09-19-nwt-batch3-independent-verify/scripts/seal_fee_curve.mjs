// NWT: market_seal 形状, fee UTXO 面值 v 扫描。requiredFee(v)=100×localWasmMass(draft, change=leftover=v);
// localWasmMass ≡ 我的移植公式在"输入 plurality 恒=1"下的值(已对 J2 三个记录值 3/3 逐位复现)。
// 再算 final tx(change=v-fee)的 真 storage(输入 covenant p=2)。SIGNED_INPUT_CEILING=1.0KAS 是 fee UTXO 上限。
import { calcStorageMass } from './port_mass.mjs';
const P = (p, a) => ({ p: BigInt(p), a: BigInt(a) });
const M = 20_000_000n;
const rows = [];
for (let v = 30_000_000n; v <= 100_000_000n; v += 5_000_000n) {
  const draftChange = v; // leftover = v + CONT + held - CONT - GENESIS = v
  const outsD = [P(2, M), P(2, M), P(1, draftChange)];
  const local = calcStorageMass([P(1, M), P(1, M), P(1, v)], outsD).mass; // wasm: input p=1
  const fee = 100n * local;
  const change = v - fee;
  if (change <= 0n) { rows.push({ v: String(v), fee: String(fee), note: 'infeasible (change<=0)' }); continue; }
  const outsF = [P(2, M), P(2, M), P(1, change)];
  const trueStorage = calcStorageMass([P(2, M), P(2, M), P(1, v)], outsF).mass;
  rows.push({ v: String(v), requiredFee: String(fee), change: String(change), trueStorageFinal: String(trueStorage), pct: (Number(trueStorage) / 5000).toFixed(1) + '%', ceiling: String(fee * 2n < 100_000_000n ? fee * 2n : 100_000_000n) });
}
console.table(rows);
