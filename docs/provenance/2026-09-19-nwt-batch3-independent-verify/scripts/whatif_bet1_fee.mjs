// NWT: register_append#1 形状, fee UTXO=95M 时, change/fee 变化对 storage mass 的影响(纯公式, 我移植的 consensus calc_storage_mass)。
import { calcStorageMass } from './port_mass.mjs';
const P = (p, a) => ({ p: BigInt(p), a: BigInt(a) });
const f = (v, fee) => { const c = v + 20000000 - 60000000 - fee; return { fee, change: c, storage: String(calcStorageMass([P(2, 20000000), P(1, v)], [P(2, 20000000), P(1, 20000000), P(2, 20000000), P(1, c)]).mass) }; };
console.log('95M fee=actual 43,339,900 :', f(95000000, 43339900));
console.log('95M fee=relay-min≈3,691,400:', f(95000000, 3691400));
console.log('85M fee≈43.4M :', f(85000000, 43400000));
console.log('90M fee≈43.36M:', f(90000000, 43360000));
console.log('100M fee≈43.3M:', f(100000000, 43300000));
// raw_post(cofactors) 见 params.rs:132
