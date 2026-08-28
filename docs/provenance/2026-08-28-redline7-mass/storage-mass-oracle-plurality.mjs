// NWT 独立 storage-mass oracle v2 — 加 UTXO plurality（Codex e6d3d2f8 MUST-FIX：J2 估算器全 p=1 低估）
// 纯从 git show 7b1e18cc:consensus/core/src/mass/mod.rs：
//   utxo_plurality(spk, has_cov) = ceil((63 + spk_len + (has_cov?32:0)) / 100)  (:83-99, UTXO_CONST_STORAGE=32+4+8+8+1+2+8=63)
//   calc_storage_mass 用 p²(harmonic)与 Σp(plurality/mean) 选分支  (:430-503)
// 🔴 plurality 【我从源独立算】(Codex ⑥:不调生产 helper); cell 只给原始 {amount, spkLen, hasCov}。
const C = 1_000_000_000_000n;

/** 源码 utxo_plurality: ceil((63 + spkLen + (hasCov?32:0)) / 100) */
export function pluralityOf(spkLen, hasCov) {
  const bytes = 63n + BigInt(spkLen) + (hasCov ? 32n : 0n);
  return (bytes + 99n) / 100n;           // div_ceil
}
const P = (x) => x.plurality != null ? BigInt(x.plurality) : pluralityOf(x.spkLen ?? 35, x.hasCov ?? false); // 默认 P2SH 35B 非 cov ⇒ p=1
const A = (x) => BigInt(x.amount);

/** storage mass（plurality-aware）。cell: {amount, spkLen, hasCov} 或 {amount, plurality}。 */
export function storageMass(inputs, outputs, isCoinbase = false) {
  if (isCoinbase) return 0n;
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
  const meanIns = sumIns / insPlurality;           // Σamount / Σplurality (:497)
  const arithmeticIns = insPlurality * (C / meanIns);
  return sat(harmonicOuts, arithmeticIns);
}

// P2SH = spkLen 35 非 cov ⇒ p=1; covenant = spkLen 35 + cov ⇒ (63+35+32)/100=1.3 ⇒ p=2
const PLAIN = (amount) => ({ amount, spkLen: 35, hasCov: false });
const COV   = (amount) => ({ amount, spkLen: 35, hasCov: true });

let pass = 0, fail = 0;
const t = (name, got, exp) => { const ok = got === exp; console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name} = ${got}` + (ok ? '' : ` (exp ${exp})`)); ok ? pass++ : fail++; };

// plurality 源公式自证
t('pluralityOf(P2SH 35, false) = 1', pluralityOf(35, false), 1n);
t('pluralityOf(covenant 35+32, true) = 2', pluralityOf(35, true), 2n);
t('pluralityOf(P2PK 33, false) = 1', pluralityOf(33, false), 1n);

// 🔴 P1 = Codex 例: plain(p=1) → 同值 covenant(p=2) ⇒ 共识 3C/v=30000; J2 p=1 给 0 (逮 bug)
t('P1 plain→cov 同值(100M): 3C/v', storageMass([PLAIN(100_000_000n)], [COV(100_000_000n)]), 30_000n);
// P2 cov→cov 异值(200M→100M): relaxed(|O|=|I| plurality=2) harmOuts=C·4/1e8=40000 harmIns=C·4/2e8=20000 ⇒ 20000
t('P2 cov→cov 异值(200M→100M)', storageMass([COV(200_000_000n)], [COV(100_000_000n)]), 20_000n);
// P3 cov→2plain(200M→100M/99M): outsPlur=2 insPlur=2 relaxed; harmOuts=C/1e8+C/9.9e7=10000+10101=20101 harmIns=C·4/2e8=20000 ⇒ 101
t('P3 cov→2plain(200M→100M,99M)', storageMass([COV(200_000_000n)], [PLAIN(100_000_000n), PLAIN(99_000_000n)]), 101n);
// P4 混合 general: 2 plain(100M)+1 cov(100M) 入 → 1 大 plain 出; insLen=3>2 general; insPlur=1+1+2=4; mean=300M/4=75M; arith=4·floor(C/75M)=4·13333=53332; harmOuts=C/2.99e8=3344 ⇒ sat(3344,53332)=0
t('P4 mixed general(2plain+1cov→1plain 299M)', storageMass([PLAIN(100_000_000n), PLAIN(100_000_000n), COV(100_000_000n)], [PLAIN(299_000_000n)]), 0n);
// P4b general 让 harmOuts 占优: 3 cov 入(各100M p=2)→ 8 小 plain 出(各1M p=1); insLen=3 general; insPlur=6; mean=300M/6=50M; arith=6·floor(C/50M)=6·20000=120000; harmOuts=8·C/1e6=8·1e6=8e6 ⇒ sat(8e6,120000)=7,880,000
t('P4b general 3cov→8×1M', storageMass([COV(100_000_000n),COV(100_000_000n),COV(100_000_000n)], Array(8).fill(0).map(()=>PLAIN(1_000_000n))), 7_880_000n);

// 回归: p=1 老向量仍对(H1-H5 用 amount-only ⇒ 默认 P2SH p=1)
t('H4 3-in/3-out 一般式(p=1 回归)', storageMass([{amount:70_000_000n},{amount:70_000_000n},{amount:60_000_000n}], [{amount:60_000_000n},{amount:70_000_000n},{amount:69_000_000n}]), 443n);

console.log(`\nNWT storage-mass oracle v2(plurality) 自测: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
