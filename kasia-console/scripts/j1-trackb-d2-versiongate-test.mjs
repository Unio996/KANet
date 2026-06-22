// J1 regression: D2 verifyClosePayoutRootBinding version-gate NaN-旁路 (NWT 红队 2026-06-22 抓)。
// 洞: `Number(signedTx.version) < 1` — Number(undefined)/Number('abc')=NaN, NaN<1=false → version 缺失/非数字漏过 gate。
// 修: Number.isInteger(ver) && ver>=1 (fail-closed)。本档守: 缺失/非数字/0 必拒; v1 过 version gate。
import { verifyClosePayoutRootBinding } from '../src/lib/bshard-close-enforce.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const psRedeem = 'aa'.repeat(600);            // 够长 (>52B) 让 v1 过 splice
const root = 'cc'.repeat(32);
const covOut = { covenant: { covenantId: 'x' }, scriptPublicKey: 'deadbeef' };
const mk = (o) => JSON.stringify(o);

console.log('== D2 version-gate NaN-旁路 regression ==');
// version 缺失 / 非数字 / 0 → 必因 version 拒
for (const [label, obj] of [
  ['version 省略', { outputs: [covOut] }],
  ["version='abc'", { version: 'abc', outputs: [covOut] }],
  ['version=0', { version: 0, outputs: [covOut] }],
  ['version=1.5(小数)', { version: 1.5, outputs: [covOut] }],
]) {
  const r = verifyClosePayoutRootBinding({ txSafeJson: mk(obj), psRedeemHex: psRedeem, reDerivedRoot: root });
  ok(r.ok === false && /version/i.test(r.reason || ''), `${label} → 拒 (version gate): ${(r.reason || '').slice(0, 46)}`);
}
// version=1 → 过 version gate (后续因假 spk 拒, reason 非 version → 证明 gate 对 v1 放行)
{
  const r = verifyClosePayoutRootBinding({ txSafeJson: mk({ version: 1, outputs: [covOut] }), psRedeemHex: psRedeem, reDerivedRoot: root });
  ok(r.ok === false && !/version/i.test(r.reason || ''), `version=1 → 过 version gate (后续因假数据拒, reason 非 version): ${(r.reason || '').slice(0, 40)}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
