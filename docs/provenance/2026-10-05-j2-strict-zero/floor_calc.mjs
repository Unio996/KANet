const C = 1_000_000_000_000n;
function mass(ins, outs) { let op = 0n, h = 0n; for (const o of outs) { op += o.p; h += C * o.p * o.p / o.v; }
  let relaxed = op === 1n ? true : ins.length > 2 ? false : (() => { const ip = ins.reduce((a, i) => a + i.p, 0n); return ip === 1n || (op === 2n && ip === 2n); })();
  if (relaxed) { const hi = ins.reduce((a, i) => a + C * i.p * i.p / i.v, 0n); return h > hi ? h - hi : 0n; }
  const ip = ins.reduce((a, i) => a + i.p, 0n), s = ins.reduce((a, i) => a + i.v, 0n); const ar = ip * (C / (s / ip)); return h > ar ? h - ar : 0n; }
const P = (v, p) => ({ v: BigInt(v), p: BigInt(p) });
const Vs = 20_000_000, Vt = 40_000_000, NET = 40_000_000;
console.log('claim-family non-last / last storage mass vs V (ceiling 500000):');
for (const V of [20e6, 30e6, 35e6, 40e6, 45e6, 50e6, 60e6, 100e6]) {
  const Vf = 3 * V + NET + 20_000_000;
  const chg = Vs + Vt + Vf - Vs - 3 * V - NET;   // as relay: change = Σin - Σout - fee
  const nonLast = mass([P(Vs, 2), P(Vt, 2), P(Vf, 1)], [P(Vs, 2), P(V, 2), P(V, 2), P(V, 2), P(chg, 1)]);
  const Vt2 = V; // last claim: pool token == amount? worst: token value Vt, 2 outputs
  const chgL = Vs + Vt + Vf - 2 * V - NET;
  const last = mass([P(Vs, 2), P(Vt, 2), P(Vf, 1)], [P(V, 2), P(V, 2), P(chgL, 1)]);
  console.log((V / 1e8).toFixed(2), 'KAS  nonLast', String(nonLast), ' last', String(last), nonLast <= 400000n ? '(<=400k)' : nonLast <= 500000n ? '(<=500k)' : 'OVER');
}
console.log('register first-bet (ins: leaf0.2 p2, chip/seed 0.2 p2, funding 1.0 p1 ; outs: leaf 0.2 p2, ticket T p1, tok 0.2 p2, change p1):');
for (const T of [3e6, 5e6, 7e6, 10e6, 20e6]) {
  const fund = 100_000_000, fee = 10_000_000;
  const chg = 20_000_000 + 20_000_000 + fund - 20_000_000 - T - 20_000_000 - fee;
  console.log((T / 1e8).toFixed(3), 'KAS ticket  mass', String(mass([P(20e6, 2), P(20e6, 2), P(fund, 1)], [P(20e6, 2), P(T, 1), P(20e6, 2), P(chg, 1)])));
}
