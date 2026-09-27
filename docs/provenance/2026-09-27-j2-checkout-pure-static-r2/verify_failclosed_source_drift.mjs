// verify_failclosed_source_drift.mjs — regression test for the NWT MUST fix (2026-09-27T11-37Z):
// resolve-order-browser.js's deriveCommissionOrderAddress must fail-closed when the sha256 of the
// CommissionSplit.sil source shipped with the page doesn't match order-template.js's recorded
// CS_SOURCE_SHA256(the source the fixed-byte template was generated from).
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');

const RB = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/checkout-static/resolve-order-browser.js');
const OT = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/checkout-static/order-template.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

const payerAddr = new kaspa.PrivateKey('55'.repeat(32)).toPublicKey().toAddress('testnet').toString();
const roleSpk = kaspa.payToAddressScript(new kaspa.Address(payerAddr));
const versionBytes = new Uint8Array([roleSpk.version & 0xff, (roleSpk.version >> 8) & 0xff]);
const scriptBytes = new Uint8Array(roleSpk.script.length / 2);
for (let i = 0; i < scriptBytes.length; i++) scriptBytes[i] = parseInt(roleSpk.script.substr(i * 2, 2), 16);
const spk = new Uint8Array(2 + scriptBytes.length);
spk.set(versionBytes, 0); spk.set(scriptBytes, 2);

const cfg = {
  network: 'testnet',
  finalRoles: [{ name: 'provider', amountSompi: 100_000_000n, spk }],
  payerRefundAddress: payerAddr,
  deadlineMs: 1234567890000, maxSplitFeeSompi: 40_000_000n, maxRefundFeeSompi: 10_000_000n,
};

// ── 1) missing sha256 arg entirely(undefined) → must throw, not silently proceed ──
try {
  RB.deriveCommissionOrderAddress(kaspa, cfg, undefined);
  check('undefined sha256 arg is rejected (fail-closed)', false, 'did not throw');
} catch (e) {
  check('undefined sha256 arg is rejected (fail-closed)', /sha256/.test(e.message) && /不一致|拒绝/.test(e.message), e.message);
}

// ── 2) wrong sha256(deliberately corrupted) → must throw ──
const wrongSha = '0'.repeat(64);
check('sanity: wrongSha really differs from CS_SOURCE_SHA256', wrongSha !== OT.CS_SOURCE_SHA256);
try {
  RB.deriveCommissionOrderAddress(kaspa, cfg, wrongSha);
  check('wrong sha256 is rejected (fail-closed)', false, 'did not throw');
} catch (e) {
  check('wrong sha256 is rejected (fail-closed)', /sha256/.test(e.message) && /不一致|拒绝/.test(e.message), e.message);
}

// ── 3) correct sha256(matches order-template.js's own recorded anchor) → must succeed ──
try {
  const result = RB.deriveCommissionOrderAddress(kaspa, cfg, OT.CS_SOURCE_SHA256);
  check('correct sha256 succeeds and returns a well-formed address', result.address.startsWith('kaspatest:'), result.address);
} catch (e) {
  check('correct sha256 succeeds and returns a well-formed address', false, e.message);
}

console.log(`\n=== fail-closed source-drift regression: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
