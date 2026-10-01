// verify_rebuild_node.mjs — 验收①: 干净进程 node 用公开 artifact(CommissionSplit.sil + 公开的 resolve-order-*.js)
// 按"订单凭据"重建订单地址, 赎回脚本字节与地址和出单时逐字一致; 重建过程不得调随机数/Date.now()。
// 用法: node verify_rebuild_node.mjs <worktree根> <silverc-wasm node 版 silverc_lang.js 的 file:// URL>
//   默认 worktree = 本文件所在 worktree; 默认 silverc node 构建 = scratch/_j2_commission_impl_research/silverc-wasm-out-node。
// 两个阶段在【独立子进程】里跑: 阶段 A 出单并写凭据文件; 阶段 B(全新进程, 且把 crypto.getRandomValues /
// Date.now 换成一调用就抛错的桩)只读凭据重建。
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WT = process.env.WT || join(here, '../../..');
const CS = pathToFileURL(join(WT, 'kasia-console/src/lib/checkout-static')).href;
const SILVERC = process.env.SILVERC_NODE || 'file:///D:/kanet-tn12/scratch/_j2_commission_impl_research/silverc-wasm-out-node/silverc_lang.js';
const phase = process.argv[2];
const receiptPath = process.argv[3];

const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const silverc = await import(SILVERC);
const RW = await import(`${CS}/resolve-order-wasm.js`);
const RB = await import(`${CS}/resolve-order-browser.js`);
const OT = await import(`${CS}/order-template.js`);
const { buildOrderReceipt, parseOrderReceipt } = await import(`${CS}/order-receipt.js`);
const src = readFileSync(join(WT, 'kasia-console/src/lib/checkout-static/vendor/sil-source/CommissionSplit.sil'), 'utf8');

function spkOf(addr) { // 与 resolve-order-*.js 内部同款 spk 字节(2B version + script)
  const spk = kaspa.payToAddressScript(new kaspa.Address(addr));
  const out = new Uint8Array(2 + spk.script.length / 2);
  out[0] = spk.version & 0xff; out[1] = (spk.version >> 8) & 0xff;
  for (let i = 0; i < spk.script.length / 2; i++) out[2 + i] = parseInt(spk.script.substr(i * 2, 2), 16);
  return out;
}
const net = 'testnet';
const addrOf = (hex) => new kaspa.PrivateKey(hex).toPublicKey().toAddress(net).toString();
const cfgBase = () => ({
  network: net,
  finalRoles: [
    { amountSompi: 700_000_000n, spk: spkOf(addrOf('01'.repeat(32))) },
    { amountSompi: 50_000_000n, spk: spkOf(addrOf('02'.repeat(32))) },
    { amountSompi: 250_000_000n, spk: spkOf(addrOf('03'.repeat(32))) },
  ],
  payerRefundAddress: addrOf('04'.repeat(32)),
  maxSplitFeeSompi: 40_000_000n, maxRefundFeeSompi: 10_000_000n,
});

if (phase === 'issue') {
  const order = RW.deriveCommissionOrderAddress(kaspa, silverc, src, { ...cfgBase(), deadlineMs: Date.now() + 3 * 86400000 });
  const orderB = RB.deriveCommissionOrderAddress(kaspa, { ...cfgBase(), deadlineMs: order.deadlineMs }, OT.CS_SOURCE_SHA256);
  const receipt = buildOrderReceipt({ network: net, link: 'http://x/checkout.html?q=AAA', refundAddress: cfgBase().payerRefundAddress, order, totalSompi: 1_000_000_000n });
  writeFileSync(receiptPath, JSON.stringify({ receipt, redeemScriptHex: order.redeemScriptHex, fallbackAddress: orderB.address, fallbackNonce: orderB.orderNonceHex, fallbackDeadline: orderB.deadlineMs }, null, 2));
  console.log('issued', order.address);
} else if (phase === 'rebuild') {
  // 毒化: 重建期间一旦碰随机数或 Date.now 就炸
  const realDateNow = Date.now;
  globalThis.crypto.getRandomValues = () => { throw new Error('POISON: getRandomValues called during rebuild'); };
  Date.now = () => { throw new Error('POISON: Date.now called during rebuild'); };
  const saved = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const receipt = parseOrderReceipt(JSON.stringify(saved.receipt));
  let pass = 0, fail = 0;
  const check = (n, c, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
  const cfg = { ...cfgBase(), orderNonceHex: receipt.order_nonce_hex, deadlineMs: receipt.deadline_ms };
  const re = RW.rebuildCommissionOrderAddress(kaspa, silverc, src, cfg);
  check('wasm 主路径: 重建地址与出单地址逐字一致', re.address === receipt.order_address, `${re.address} vs ${receipt.order_address}`);
  check('wasm 主路径: 赎回脚本字节与出单时逐字一致', re.redeemScriptHex === saved.redeemScriptHex);
  check('wasm 主路径: 重建返回的 nonce/deadline 即凭据值', re.orderNonceHex === receipt.order_nonce_hex && re.deadlineMs === receipt.deadline_ms);
  const reB = RB.rebuildCommissionOrderAddress(kaspa, cfg, OT.CS_SOURCE_SHA256);
  check('降级路径与 wasm 主路径同 nonce/deadline 下地址相同(两路 parity)', reB.address === re.address, `${reB.address} vs ${re.address}`);
  const expectThrow = (n, fn, re2) => { try { fn(); check(n, false, '未抛错'); } catch (e) { check(n, re2.test(e.message), e.message); } };
  const { orderNonceHex: _n, ...noNonce } = cfg; const { deadlineMs: _d, ...noDeadline } = cfg;
  expectThrow('wasm 重建缺 nonce 报错(不兜底随机)', () => RW.rebuildCommissionOrderAddress(kaspa, silverc, src, noNonce), /orderNonceHex/);
  expectThrow('wasm 重建缺 deadline 报错(不兜底 Date.now)', () => RW.rebuildCommissionOrderAddress(kaspa, silverc, src, noDeadline), /deadlineMs/);
  expectThrow('降级重建缺 nonce 报错', () => RB.rebuildCommissionOrderAddress(kaspa, noNonce, OT.CS_SOURCE_SHA256), /orderNonceHex/);
  expectThrow('降级重建缺 deadline 报错', () => RB.rebuildCommissionOrderAddress(kaspa, noDeadline, OT.CS_SOURCE_SHA256), /deadlineMs/);
  expectThrow('nonce 非 32 hex 报错', () => RW.rebuildCommissionOrderAddress(kaspa, silverc, src, { ...cfg, orderNonceHex: 'zz' }), /orderNonceHex/);
  expectThrow('deadline 非整数报错', () => RW.rebuildCommissionOrderAddress(kaspa, silverc, src, { ...cfg, deadlineMs: 1.5 }), /deadlineMs/);
  const tweaked = RW.rebuildCommissionOrderAddress(kaspa, silverc, src, { ...cfg, orderNonceHex: '00'.repeat(16) });
  check('篡改 nonce 得到不同地址(页面据此拒绝)', tweaked.address !== receipt.order_address);
  const tweaked2 = RW.rebuildCommissionOrderAddress(kaspa, silverc, src, { ...cfg, deadlineMs: cfg.deadlineMs + 1 });
  check('篡改 deadline 得到不同地址(页面据此拒绝)', tweaked2.address !== receipt.order_address);
  Date.now = realDateNow;
  console.log(`\n=== rebuild(干净进程, 随机数/Date.now 已毒化): ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
} else {
  const f = join(process.env.TEMP || '/tmp', `receipt-${process.pid}.json`);
  const self = fileURLToPath(import.meta.url);
  console.log(execFileSync('node', [self, 'issue', f], { encoding: 'utf8', env: { ...process.env, WT } }));
  try { console.log(execFileSync('node', [self, 'rebuild', f], { encoding: 'utf8', env: { ...process.env, WT } })); }
  catch (e) { console.log(e.stdout); console.log(e.stderr); process.exit(1); }
}
