import { readFileSync } from 'node:fs';
const C = 1_000_000_000_000n;
const pluralityOf = (spkLen, hasCov) => (63n + BigInt(spkLen) + (hasCov ? 32n : 0n) + 99n) / 100n; // ceil((63+spk+(cov?32:0))/100)
function storageMass(inputs, outputs) {
  const P = (x) => pluralityOf(x.spkLen, x.hasCov), A = (x) => BigInt(x.amount);
  let outsPl = 0n, hOuts = 0n;
  for (const o of outputs) { const p = P(o); outsPl += p; hOuts += (C * p * p) / A(o); }
  const insLen = inputs.length, insPl = inputs.reduce((s, i) => s + P(i), 0n);
  const relaxed = outsPl === 1n || (insLen <= 2 && (insPl === 1n || (outsPl === 2n && insPl === 2n)));
  const sat = (a, b) => (a > b ? a - b : 0n);
  if (relaxed) { let hIns = 0n; for (const i of inputs) { const p = P(i); hIns += (C * p * p) / A(i); } return sat(hOuts, hIns); }
  const sumIns = inputs.reduce((s, i) => s + A(i), 0n), mean = sumIns / insPl;
  return sat(hOuts, insPl * (C / mean));
}
const fx = JSON.parse(readFileSync(new URL('./plurality-fixtures.json', import.meta.url), 'utf8'));
const cell = (c) => ({ amount: c.amount, spkLen: 35, hasCov: c.has_covenant === true });
let pass = 0, fail = 0;
for (const g of fx.groups) {
  const ins = g.cells.filter(c => c.side === 'in').map(cell), outs = g.cells.filter(c => c.side === 'out').map(cell);
  const got = storageMass(ins, outs), exp = BigInt(g.expect.storage);
  const ok = got === exp;
  const pIn = ins.map(c => pluralityOf(c.spkLen, c.hasCov).toString()), pOut = outs.map(c => pluralityOf(c.spkLen, c.hasCov).toString());
  const pOk = JSON.stringify(pIn.map(Number)) === JSON.stringify(g.expect.p_in) && JSON.stringify(pOut.map(Number)) === JSON.stringify(g.expect.p_out);
  console.log(`${ok && pOk ? '[PASS]' : '[FAIL]'} ${g.id}: NWT storage=${got} (J2=${exp}) | NWT p_in=[${pIn}] p_out=[${pOut}] (J2 p_in=[${g.expect.p_in}] p_out=[${g.expect.p_out}]) branch=${g.expect.branch} old_p1=${g.expect.old_p1_impl}`);
  (ok && pOk) ? pass++ : fail++;
}
console.log(`\nNWT 独立(纯从源) vs J2 手算 G1-G5: ${pass} PASS / ${fail} FAIL`);
