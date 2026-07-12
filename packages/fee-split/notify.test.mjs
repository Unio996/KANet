// notify.test.mjs — B线落3 notify 层验收(J2 2026-07-12, 设计 v1.2 §2.1, Bettor 注3 MUST 覆盖点)。
// 零链零 DB, 纯函数测试。Run: node packages/fee-split/notify.test.mjs
import { matchLandedFeeOutputs, emitLandedNotification } from './notify.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const LEAVES = [
  { pk: 'aa'.repeat(32), amount: '8000000', type: 'broker' },
  { pk: 'bb'.repeat(32), amount: '1000000', type: 'introducer' },
];
const ADDRS = ['addr-broker', 'addr-introducer'];

console.log('[test] ① 全部命中(地址+金额都对):');
{
  const outputs = [{ address: 'addr-broker', amount: '8000000', txid: 'tx1' }, { address: 'addr-introducer', amount: '1000000', txid: 'tx1' }];
  const m = matchLandedFeeOutputs(outputs, LEAVES, ADDRS);
  ok(m.every(r => r.state === 'matched'), '两条全 matched');
  ok(m[0].outputIndex === 0 && m[1].outputIndex === 1, 'outputIndex 对应正确');
}

console.log('[test] ② Bettor 注3-i: 地址对金额不对 → 显式 mismatch(非静默 matched):');
{
  const outputs = [{ address: 'addr-broker', amount: '9999999', txid: 'tx1' }];
  const m = matchLandedFeeOutputs(outputs, [LEAVES[0]], [ADDRS[0]]);
  ok(m[0].state === 'mismatch', `mismatch(非静默 matched): ${m[0].state}`);
  ok(m[0].output.amount === '9999999', 'mismatch 条目仍带 output 供调用方诊断');
}

console.log('[test] ③ Bettor 注3-ii: 每个 output 至多配一个 leaf(防重复认领):');
{
  // 两个 leaf 同地址(罕见但需支持), 只有一个 output — 第一个 leaf 占用, 第二个必须 unmatched(不能重复认领)
  const dupLeaves = [{ pk: 'cc'.repeat(32), amount: '500', type: 'a' }, { pk: 'dd'.repeat(32), amount: '500', type: 'b' }];
  const dupAddrs = ['same-addr', 'same-addr'];
  const outputs = [{ address: 'same-addr', amount: '500', txid: 'tx1' }];
  const m = matchLandedFeeOutputs(outputs, dupLeaves, dupAddrs);
  ok(m[0].state === 'matched' && m[0].outputIndex === 0, '第一个 leaf 占用该 output');
  ok(m[1].state === 'unmatched', `第二个 leaf 不重复认领同一 output(已被占用): ${m[1].state}`);
}

console.log('[test] ④ 未落地角色 → unmatched(非报错, 调用方决定重试):');
{
  const outputs = [{ address: 'addr-broker', amount: '8000000', txid: 'tx1' }];   // introducer 那笔没落地
  const m = matchLandedFeeOutputs(outputs, LEAVES, ADDRS);
  ok(m[0].state === 'matched' && m[1].state === 'unmatched', 'broker matched, introducer unmatched');
}

console.log('[test] ⑤ emitLandedNotification 只处理 matched, 每条恰好一次(单次调用内 at-most-once):');
{
  const outputs = [{ address: 'addr-broker', amount: '8000000', txid: 'txABC' }, { address: 'addr-introducer', amount: '999', txid: 'txABC' }];   // introducer 金额不符
  const m = matchLandedFeeOutputs(outputs, LEAVES, ADDRS);
  const delivered = [];
  const n = emitLandedNotification(m, { onLanded: (p) => delivered.push(p) });
  ok(n === 1 && delivered.length === 1, `只投递 matched 那条(mismatch/unmatched 不投递): emitted=${n}`);
  ok(delivered[0].role === 'broker' && delivered[0].amountSompi === '8000000' && delivered[0].txid === 'txABC', 'payload 形状正确(含 txid 透传)');
}

console.log('[test] ⑥ feeLeaves/leafAddresses 长度不符 → fail-loud(接口误用防线):');
{
  let threw = false;
  try { matchLandedFeeOutputs([], LEAVES, ['only-one-addr']); } catch { threw = true; }
  ok(threw, '长度不符 throw');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — notify 层: 命中/mismatch三态/output去重/unmatched/emit契约/接口误用防线'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
