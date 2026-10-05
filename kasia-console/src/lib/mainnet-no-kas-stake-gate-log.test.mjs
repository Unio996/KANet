// 重开版闸日志: 放行 ⇒ 不得出现 "403" 日志; 真 403(网络未配 / id 不匹配 / 非重开路由的主网闸) 仍打 403。
import { assertNoKasStakeUnlessReopened, assertNoKasStakeOnMainnet, _resetNoKasStakeLogForTest } from './mainnet-no-kas-stake-gate.mjs';
let fails = 0;
const ok = (c, l) => { console.log(c ? '  ✅' : '  ❌', l); if (!c) fails++; };
const capture = (fn) => {
  const out = []; const w = console.warn, l = console.log;
  console.warn = (...a) => out.push(['warn', a.join(' ')]); console.log = (...a) => out.push(['log', a.join(' ')]);
  let r; try { r = fn(); } finally { console.warn = w; console.log = l; }
  return { r, out };
};
const has403 = (out) => out.some(([, m]) => /\] 403 /.test(m));

_resetNoKasStakeLogForTest();
{
  const { r, out } = capture(() => assertNoKasStakeUnlessReopened('create-v07', 'S2-zk-native-no-spine', { KASPA_NETWORK: 'mainnet' }));
  ok(r === null, '主网 + 重开路由 ⇒ 放行(null)');
  ok(!has403(out), '放行时不打 403 日志');
  ok(out.some(([, m]) => m.includes('reopened, allowed route=create-v07')), '放行时打 "reopened, allowed" 日志');
  const again = capture(() => assertNoKasStakeUnlessReopened('create-v07', 'S2-zk-native-no-spine', { KASPA_NETWORK: 'mainnet' }));
  ok(again.out.length === 0, '同路由第二次不再刷屏');
}
{
  const { r, out } = capture(() => assertNoKasStakeUnlessReopened('register-v07', 'S1-gateway-sponsor', { KASPA_NETWORK: 'testnet-12' }));
  ok(r === null && out.length === 0, '非不收 KAS 模式(testnet) ⇒ 放行且无任何日志(老行为逐字节不变)');
}
{
  const { r, out } = capture(() => assertNoKasStakeUnlessReopened('register-v07', 'S1-gateway-sponsor', {}));
  ok(r && r.http === 403 && r.body.network === 'unconfigured', '网络未配 ⇒ 仍 fail-closed 403');
  ok(has403(out), '真 403 仍打 403 日志');
}
{
  _resetNoKasStakeLogForTest();
  const { r, out } = capture(() => assertNoKasStakeUnlessReopened('create-v07', 'WRONG-ID', { KASPA_NETWORK: 'mainnet' }));
  ok(r && r.http === 403 && r.body.network === 'reopen-id-mismatch' && has403(out), 'id 不匹配 ⇒ 403 + 403 日志');
}
{
  _resetNoKasStakeLogForTest();
  const { r, out } = capture(() => assertNoKasStakeOnMainnet('some-other-route', { KASPA_NETWORK: 'mainnet' }));
  ok(r && r.http === 403 && has403(out), '未重开路由的主网闸 ⇒ 仍 403 + 403 日志');
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
