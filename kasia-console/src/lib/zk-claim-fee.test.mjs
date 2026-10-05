// zk-claim-fee.test.mjs — 账本1861 A: claim 的网络费 CLAIM_NET_FEE_SOMPI ≥ 1.25× 节点实测下限, 且 fee 输入面值仍覆盖 3 个新输出 + 费 + 20M 余量。
// 实测: docs/provenance/2026-10-05-j2-fee-floor/measured_floors.json。Run: cd kasia-console && node src/lib/zk-claim-fee.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
delete process.env.ZK_CLAIM_OUT_VALUE_SOMPI;
const here = dirname(fileURLToPath(import.meta.url));
const floors = JSON.parse(readFileSync(join(here, '../../../docs/provenance/2026-10-05-j2-fee-floor/measured_floors.json'), 'utf8')).sites;
const O = await import('./zk-token-claim-orchestrator.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
await t('CLAIM_NET_FEE_SOMPI ≥ 1.25× 实测 claim 下限, == paid_after, < 旧值 40M', () => {
  assert.ok(O.CLAIM_NET_FEE_SOMPI * 100 >= floors.claim.floor * 125, `${O.CLAIM_NET_FEE_SOMPI} < 1.25×${floors.claim.floor}`);
  assert.strictEqual(O.CLAIM_NET_FEE_SOMPI, floors.claim.paid_after);
  assert.ok(O.CLAIM_NET_FEE_SOMPI < floors.claim.paid_before);
});
await t('claimFeeInputSompi = 3×out + fee + 20M, 且仍 > 3×out + fee(找零 ≥ 20M 不退化)', () => {
  const need = 3 * O.CLAIM_OUT_VALUE_SOMPI + O.CLAIM_NET_FEE_SOMPI;
  assert.strictEqual(O.claimFeeInputSompi(), need + 20_000_000);
  assert.ok(O.claimFeeInputSompi() - need >= 20_000_000);
});
await t('claim 出口面值默认 0.5 KAS(未设 env), 本次不动', () => { assert.strictEqual(O.CLAIM_OUT_VALUE_SOMPI, 50_000_000); });
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
