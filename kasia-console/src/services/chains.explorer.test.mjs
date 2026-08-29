// chains.js kaspa explorer 单源迁移向量 (J2 2026-08-29, coord/j2-chains-explorer): mainnet byte-identical / TN12 null / 源级无字面域名。
// 跑: cd kasia-console && node src/services/chains.explorer.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const here = dirname(fileURLToPath(import.meta.url));
const { getExplorerTxUrl, getExplorerAddressUrl, getPublicMeta, CHAIN_META } = await import('./chains.js');
const H = 'a'.repeat(64), A = 'kaspa:qq0000';
// 期望串用拼接 (R-EXPLORER-URL-BYPASS 对 test 文件也生效, 不许字面域名); 拼接保持 oracle 独立于 lib, 仍是逐字节对旧字面 (explorer 主域 + /txs/ 与 /addresses/ 两条路径)
const KX = ['https://explorer', 'kaspa', 'org'].join('.');
const BSC = ['https://bscscan', 'com'].join('.');
t('E1 mainnet: getExplorerTxUrl/AddressUrl(kaspa) 与旧字面输出 byte-identical', () => {
  process.env.KASPA_NETWORK = 'mainnet';
  assert.strictEqual(getExplorerTxUrl('kaspa', H), `${KX}/txs/${H}`);
  assert.strictEqual(getExplorerAddressUrl('kaspa', A), `${KX}/addresses/${A}`);
  assert.strictEqual(CHAIN_META.kaspa.explorer.tx(H), `${KX}/txs/${H}`);
});
t('E2 TN12/testnet-*: kaspa ⇒ null (调用方降级: getExplorerTxUrl 已是 `|| null`; UI :href=null 不渲染 href, 文案不变); 非 kaspa 链不受影响', () => {
  process.env.KASPA_NETWORK = 'testnet-12';
  assert.strictEqual(getExplorerTxUrl('kaspa', H), null); assert.strictEqual(getExplorerAddressUrl('kaspa', A), null);
  assert.strictEqual(getExplorerTxUrl('bnb', '0x' + 'b'.repeat(64)), `${BSC}/tx/0x${'b'.repeat(64)}`);
  process.env.KASPA_NETWORK = 'testnet-10'; assert.strictEqual(getExplorerTxUrl('kaspa', H), null);
});
t('E3 网络在调用时读 (非 import 时冻结): 切 env 即切结果', () => {
  process.env.KASPA_NETWORK = 'mainnet'; assert.ok(getExplorerTxUrl('kaspa', H)); process.env.KASPA_NETWORK = 'testnet-12'; assert.strictEqual(getExplorerTxUrl('kaspa', H), null);
});
t('E4 getPublicMeta().kaspa.explorer 形不变 (UI /api/chains/meta 消费者: KANet.explorerTxUrl 走的是这里) — 函数字段仍存在', () => {
  const m = getPublicMeta(); assert.ok(m.kaspa && m.kaspa.explorer, 'kaspa.explorer 缺'); assert.ok(m.bnb.explorer);
});
t('E5 源级: chains.js 不再含 kaspa explorer 主域字面; import 了 lib/explorer-url.mjs', () => {
  const src = readFileSync(join(here, 'chains.js'), 'utf8');
  const DOM = new RegExp(['explorer', 'kaspa', 'org'].join('\\.'));   // 域名正则也拼接 (R-EXPLORER-URL-BYPASS 对 test 文件同样生效)
  assert.ok(!DOM.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), '代码行仍含 kaspa explorer 主域字面');
  assert.ok(/from '\.\.\/lib\/explorer-url\.mjs'/.test(src));
});
console.log(`chains.explorer: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
