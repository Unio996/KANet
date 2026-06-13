// gateG: maker-addr byte-equal (single-source determinism, J2 fee-on-total 4c41137e/6502fe4a).
// 测 maker payout addr 派生 column-path(maker_pk 列) vs sentinel-path(cross-node:<pk> strip) byte-equal。
// 覆盖 ⓐ winner payout + ⓑ makerFee (都用 makerAddress = pk-derive(maker_pk), settler 派生一次共享, NWT 点)。
// ⓒ self-broker broker output 用 brokerAddress(broker_pk 列, 预先存在单源, 非此测新增域)。
// 两节点跑同脚本 → FINGERPRINT byte-equal = cross-node 派生确定 (column==sentinel + 无 kaspa-wasm 漂)。
// 跑: cd kasia-console && node scripts/gateG-maker-addr-byte-equal.mjs  (:3200=J2 / :3300=J1)。
const kw = await import('kaspa-wasm');

const NETWORK = 'testnet-12';
// 固定有效 x-only pk (secp256k1 G.x) — 测派生确定性非特定 maker; 两节点同常量 → reproducible。
const TEST_PK = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

// 复刻 settler dispatchPhase2 maker-addr 派生 (pool-market-settler.js @4c41137e):
//   makerPkCanonical = market.maker_pk || (sentinel startsWith 'cross-node:' ? strip : null);
//   makerAddress = XOnlyPublicKey(makerPkCanonical).toAddress(net)
function deriveMakerAddr(market) {
  const makerPkCanonical = market.maker_pk
    || (String(market.maker_relay_id).startsWith('cross-node:') ? market.maker_relay_id.replace(/^cross-node:/, '') : null);
  if (!makerPkCanonical) return null;
  return new kw.XOnlyPublicKey(makerPkCanonical).toAddress(NETWORK).toString();
}

const fixtures = [
  { name: '① cross-node maker · PEER view (maker_pk NULL → sentinel strip)', market: { maker_pk: null, maker_relay_id: `cross-node:${TEST_PK}` } },
  { name: '② cross-node maker · HOME view (maker_pk 列)',                    market: { maker_pk: TEST_PK, maker_relay_id: 'home-real-uuid-abcd' } },
  { name: '③ local maker (maker_pk 列)',                                    market: { maker_pk: TEST_PK, maker_relay_id: 'local-uuid-1234' } },
];

console.log('=== gateG maker-addr byte-equal (4c41137e single-source) ===');
console.log(`TEST_PK = ${TEST_PK}`);
const addrs = fixtures.map(f => {
  const a = deriveMakerAddr(f.market);
  console.log(`  ${f.name}\n      → ${a}`);
  return a;
});
// 断言: ①(sentinel-path) == ②③(column-path) 全同 = 同 maker_pk → 同 makerAddress (column==sentinel 核心)。
const allSame = addrs.every(a => a && a === addrs[0]);
console.log(`\nFINGERPRINT (两节点必逐字符同): ${addrs[0]}`);
console.log(`column-path == sentinel-path byte-equal: ${allSame ? 'PASS' : 'FAIL'}`);
process.exit(allSame ? 0 : 1);
