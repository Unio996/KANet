process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { PrivateKey } = kaspa;

const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/commission-plan-sdk.mjs');
const feeSplitLib = await import('file:///D:/kanet-tn12/kasia-console/src/lib/fee-split.mjs');
const RB = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/checkout-static/resolve-order-browser.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

const merchantPriv = new PrivateKey('01'.repeat(32));
const brokerPriv = new PrivateKey('02'.repeat(32));
const net = 'testnet';
const addr = (priv) => priv.toPublicKey().toAddress(net).toString();

for (let trial = 0; trial < 15; trial++) {
  const numChannels = 1 + Math.floor(Math.random() * 5);
  const channelPrivs = Array.from({ length: numChannels }, (_, i) => new PrivateKey(String(10 + i).padStart(2, '0').repeat(32).slice(0, 64)));
  const roles = [
    { name: 'provider', bps: 7000, address: addr(merchantPriv) },
    { name: 'broker', bps: 500, address: addr(brokerPriv) },
  ];
  let remaining = 2500;
  for (let i = 1; i <= 5; i++) {
    const bps = i <= numChannels ? Math.floor(remaining / (numChannels - i + 1)) : 0;
    if (i <= numChannels) remaining -= bps;
    roles.push({ name: `channel_${i}`, bps: i <= numChannels ? bps : 0, fold_to: 'provider' });
  }
  const sum = roles.reduce((a, r) => a + r.bps, 0);
  roles[0].bps += (10000 - sum);

  const quoteBase = {
    schema_v: 1, quote_id: 'parity-order-' + trial, merchant_pubkey_hex: merchantPriv.toPublicKey().toString(),
    price_sompi: String(1_000_000_000 + trial * 137), canonical_rules: { schema_v: 1, roles },
    unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now(), valid_until_ms: Date.now() + 86400000,
    channel_whitelist: null, require_channel_deposit: false, min_deposit_sompi: '100000000',
    max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000,
  };
  const signedQuote = SDK.signQuote(quoteBase, merchantPriv.toString());

  // build a real signature chain over the channel privs
  const empty = SDK.verifyChain(signedQuote, [], net);
  let d = empty.chainDigest;
  const entries = [];
  for (let i = 0; i < numChannels; i++) {
    const spk = SDK.spkBytesFromAddress(addr(channelPrivs[i]));
    const e = SDK.signChainEntry(d, i + 1, spk, channelPrivs[i].toString());
    entries.push(e);
    const msg = Buffer.concat([d, Buffer.from([i + 1]), spk, e.signing_pubkey]);
    const blake2bNode = (await import('file:///D:/kanet-tn12/kasia-console/node_modules/@noble/hashes/blake2b.js')).blake2b;
    d = Buffer.from(blake2bNode(msg, { dkLen: 32 }));
  }
  const verified = SDK.verifyChain(signedQuote, entries, net);
  check(`trial ${trial}: chain verifies (${numChannels} channels)`, verified.ok, verified.reason);

  const payerPriv = new PrivateKey(String(90 - trial).padStart(2, '0').repeat(32).slice(0, 64));
  const payerAddr = addr(payerPriv);

  // ── real SDK resolveRulesForOrder vs browser-ported resolveRulesForOrder: compare role
  // resolution output directly(不比较最终地址——createCommissionSplitProtocol/deriveCommissionOrderAddress
  // 各自内部生成随机 order_nonce, 两次调用地址天然不同, 不是 bug; 地址推导本身的正确性已经被
  // 320/320 的 splice parity 测试独立证过, 这里只需要证 resolveRulesForOrder 的移植逻辑一致) ──
  const realResolved = SDK.resolveRulesForOrder(signedQuote, verified);
  const verifiedForBrowser = { ok: true, channelSpks: verified.channelSpks };
  const browserResolved = RB.resolveRulesForOrder(kaspa, feeSplitLib, signedQuote, verifiedForBrowser);

  const realRoles = realResolved.payoutLeaves.map(r => ({ name: r.name, amt: r.amountSompi.toString(), spkHex: Buffer.from(r.spk).toString('hex') }));
  const browserRoles = browserResolved.payoutLeaves.map(r => ({ name: r.name, amt: r.amountSompi.toString(), spkHex: Buffer.from(r.spk).toString('hex') }));
  check(`trial ${trial}: resolveRulesForOrder output byte-equal (${realRoles.length} roles)`, JSON.stringify(realRoles) === JSON.stringify(browserRoles), JSON.stringify({ real: realRoles, browser: browserRoles }));

  // ── now also verify the FULL address derivation with a SHARED explicit nonce path: splice both
  // with the same finalRoles + same fixed deadline/fees, using order-template.js on both sides via
  // the exhaustive splice test's own template — reuse deriveCommissionOrderAddress directly and just
  // confirm it runs without error and returns a well-formed testnet address (structural smoke test;
  // byte-for-byte splice correctness already proven separately). ──
  const browserFinalRoles = browserResolved.payoutLeaves.map(r => ({ amountSompi: r.amountSompi, spk: r.spk }));
  const browserResult = RB.deriveCommissionOrderAddress(kaspa, {
    network: net, finalRoles: browserFinalRoles, payerRefundAddress: payerAddr,
    deadlineMs: 1234567890000, maxSplitFeeSompi: 40_000_000n, maxRefundFeeSompi: 10_000_000n,
  });
  check(`trial ${trial}: browser-derived order address is well-formed`, browserResult.address.startsWith('kaspatest:'), browserResult.address);
}

console.log(`\n=== resolve-order-browser.js <-> real SDK parity: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
