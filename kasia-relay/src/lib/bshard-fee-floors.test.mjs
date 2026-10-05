// bshard-fee-floors.test.mjs — 账本1861 A: 各站点手续费 ≥ 1.25× 节点实测下限, 且是 ≤ 旧值(只降不升, zkClose 除外: 旧 1.28× 抬到 1.30×);
// 自转普通转账只对"发给自己"降下限, 发给别人(含 SS escrow→P2SH)仍 3M。
// 实测下限来源: docs/provenance/2026-10-05-j2-fee-floor/measured_floors.json(simnet 官方 2.0.1 对 fee=1 的拒绝文本)。
// Run: cd kasia-relay && node src/lib/bshard-fee-floors.test.mjs     零 RPC 零 live。
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
process.env.KASPA_NETWORK ||= 'simnet';
const here = dirname(fileURLToPath(import.meta.url));
const floors = JSON.parse(readFileSync(join(here, '../../../docs/provenance/2026-10-05-j2-fee-floor/measured_floors.json'), 'utf8')).sites;
const { BSHARD_SITE_FEE_SOMPI: F } = await import('./p2sh.mjs');
const T = await import('./transaction.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

for (const site of ['consolidateV2', 'closeAttestV2', 'zkHandoff', 'zkClose', 'registerAppend']) {
  await t(`${site}: 常量 ≥ 1.25× 实测下限(${floors[site].floor}) 且 == 记录的 paid_after`, () => {
    const v = F[site];
    assert.ok(typeof v === 'bigint');
    assert.ok(v * 100n >= BigInt(floors[site].floor) * 125n, `${site}=${v} < 1.25×${floors[site].floor}`);
    assert.strictEqual(v, BigInt(floors[site].paid_after), 'measured_floors.json paid_after 与常量不一致(改常量要同步证据)');
  });
}
await t('只降不升(zkClose 例外: 25.0M→25.4M 把 1.28× 抬到 1.30×)', () => {
  for (const site of ['consolidateV2', 'closeAttestV2', 'zkHandoff', 'registerAppend']) assert.ok(F[site] <= BigInt(floors[site].paid_before), `${site} 比旧值还大`);
  assert.ok(F.zkClose >= 25_000_000n && F.zkClose <= 25_500_000n);
});
await t('常量表冻结(不能被运行期改低)', () => { assert.ok(Object.isFrozen(F)); });

await t('p2sh.mjs 各站点确实用表里的常量(不是又写回字面量)', () => {
  const src = readFileSync(join(here, 'p2sh.mjs'), 'utf8');
  for (const [site, re] of [['consolidateV2', /cmd\.fee_sompi \?\? BSHARD_SITE_FEE_SOMPI\.consolidateV2/], ['closeAttestV2', /cmd\.fee_sompi \?\? BSHARD_SITE_FEE_SOMPI\.closeAttestV2/], ['zkHandoff', /cmd\.fee_sompi \?\? BSHARD_SITE_FEE_SOMPI\.zkHandoff/], ['zkClose', /cmd\.fee_sompi \?\? BSHARD_SITE_FEE_SOMPI\.zkClose/], ['registerAppend', /registerAppendFee = BSHARD_SITE_FEE_SOMPI\.registerAppend/]]) {
    assert.match(src, re, `${site} 没接到常量表`);
  }
  assert.doesNotMatch(src, /const registerAppendFee = 15_000_000n/);
});

await t('transferPriorityFee: 自转 ⇒ 100k 下限', () => {
  const a = 'kaspa:qself';
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 50_000_000n, to: a, senderAddress: a, priorityFee: 0n }), 100_000n);
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 50_000_000n, to: a, senderAddress: a, priorityFee: 500_000n }), 500_000n);   // 调用方给更高则尊重
});
await t('transferPriorityFee: 发给别人地址(含 escrow) ⇒ 仍 3M', () => {
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 50_000_000n, to: 'kaspa:qother', senderAddress: 'kaspa:qself', priorityFee: 0n }), 3_000_000n);
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 50_000_000n, to: 'kaspa:pscripthash', senderAddress: 'kaspa:qself', priorityFee: 1_000_000n }), 3_000_000n);
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 50_000_000n, to: 'kaspa:qother', senderAddress: 'kaspa:qself', priorityFee: 9_000_000n }), 9_000_000n);
});
await t('transferPriorityFee: amount=0 且发给自己(broadcast/comm self-send) ⇒ 原样用 priorityFee(行为不变)', () => {
  const a = 'kaspa:qself';
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 0n, to: a, senderAddress: a, priorityFee: 12_345n }), 12_345n);
  assert.strictEqual(T.transferPriorityFee({ amountSompi: 0n, to: a, senderAddress: a, priorityFee: 0n }), 0n);
});
await t('_sendKaspaInner 经 transferPriorityFee 取 priorityFee(不是又内联一份)', () => {
  const src = readFileSync(join(here, 'transaction.mjs'), 'utf8');
  assert.match(src, /effectivePriorityFee = transferPriorityFee\(\{ amountSompi, to, senderAddress, priorityFee \}\)/);
});
await t('自转 100k + 节点要求的网络费 203,600 ≥ 1.25× 实测自转下限 203,600(整笔费用余量)', () => {
  assert.ok((T.SELF_ADDR_TRANSFER_FLOOR_SOMPI + 203_600n) * 100n >= BigInt(floors.selfTransfer.floor) * 125n);
});
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
