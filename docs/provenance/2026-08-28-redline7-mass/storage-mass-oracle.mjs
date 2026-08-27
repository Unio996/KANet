// NWT 独立 storage-mass oracle — 纯从 git show 7b1e18cc:consensus/core/src/mass/mod.rs 实现
// (calc_storage_mass :430-503; C=STORAGE_MASS_PARAMETER=SOMPI_PER_KASPA*10_000=1e12, constants.rs:25)
// 🔴 【不看 J2 tx-mass-ub.mjs 原型】—— 作为 J2 实现的独立 oracle 对拍。
// 承重取整(源码逐字):
//   harmonic 项 = floor(C·p²/amount)   (:451 checked_mul(p)?.checked_mul(p)?/amount)
//   arithmetic_ins = |I| · floor(C/mean_ins)  (:500 ins_plurality.saturating_mul(storm_param / mean_ins)) —— C/mean 先 floor 再 ×|I|
//   mean_ins = floor(ΣA / Σplurality)  (:497)
//   relaxed 条件(:466-479): |O|=1  或  (inputs.len()<=2 且 (|I|=1 或 |O|=|I|=2))   [用 cell 计数 len(), plurality 求和判 1/2]
//   return: relaxed ⇒ saturating_sub(harmonic_outs, harmonic_ins); 否则 saturating_sub(harmonic_outs, arithmetic_ins)
const C = 1_000_000_000_000n;

/** inputs/outputs: [{ amount:BigInt|number, plurality?:number }] (plurality 默认 1) */
export function storageMass(inputs, outputs, isCoinbase = false) {
  if (isCoinbase) return 0n;
  const P = (x) => BigInt(x.plurality ?? 1), A = (x) => BigInt(x.amount);
  let outsPlurality = 0n, harmonicOuts = 0n;
  for (const o of outputs) { const p = P(o); outsPlurality += p; harmonicOuts += (C * p * p) / A(o); }
  const insLen = inputs.length;
  const insPlurality = inputs.reduce((s, i) => s + P(i), 0n);
  const relaxed = outsPlurality === 1n
    || (insLen <= 2 && (insPlurality === 1n || (outsPlurality === 2n && insPlurality === 2n)));
  const sat = (a, b) => (a > b ? a - b : 0n);
  if (relaxed) {
    let harmonicIns = 0n;
    for (const i of inputs) { const p = P(i); harmonicIns += (C * p * p) / A(i); }
    return sat(harmonicOuts, harmonicIns);
  }
  const sumIns = inputs.reduce((s, i) => s + A(i), 0n);
  const meanIns = sumIns / insPlurality;          // floor
  const arithmeticIns = insPlurality * (C / meanIns);  // floor(C/mean) 先, 再 ×|I|
  return sat(harmonicOuts, arithmeticIns);
}

// ── 自测: 我能手算的两例(Bettor 给的 7b1e18cc 期望) ──
const T = [
  { n: '2-in/2-out (150M,50M→100M,99M) relaxed ⇒ 0', ins: [{amount:150_000_000n},{amount:50_000_000n}], outs: [{amount:100_000_000n},{amount:99_000_000n}], exp: 0n },
  // 手算校验: harmonic_outs = C/1e8 + C/99e6 = 10000 + 10101 = 20101; harmonic_ins = C/1.5e8 + C/5e7 = 6666 + 20000 = 26666; sat(20101,26666)=0
  { n: '|I|=1 single (in 1e8 → out 5e7) relaxed(|I|=1) ⇒ C/5e7 - C/1e8 = 20000-10000=10000', ins: [{amount:100_000_000n}], outs: [{amount:50_000_000n}], exp: 10000n },
  { n: '3-in/3-out general 例(等额 in 1e8×3 → out 大额) ⇒ 走 arithmetic 路径(演示取整序)', ins: [{amount:100_000_000n},{amount:100_000_000n},{amount:100_000_000n}], outs: [{amount:1_000_000_000n},{amount:100_000_000n},{amount:100_000_000n}], exp: null },
];
let pass = 0, fail = 0;
for (const t of T) {
  const got = storageMass(t.ins, t.outs);
  if (t.exp === null) { console.log(`[INFO] ${t.n} = ${got}`); continue; }
  const ok = got === t.exp;
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${t.n} = ${got}` + (ok ? '' : ` (exp ${t.exp})`));
  ok ? pass++ : fail++;
}
console.log(`\nNWT storage-mass oracle 自测(能手算的): ${pass} PASS / ${fail} FAIL`);
