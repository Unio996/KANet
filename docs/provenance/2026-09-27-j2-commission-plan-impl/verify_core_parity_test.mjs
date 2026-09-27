// 对比 checkout-static/verify-core.js(浏览器版 kaspa-wasm + vendored blake2b)与
// commission-plan-sdk.mjs(Node 版 kaspa-wasm + npm @noble/hashes)对同一批真实输入产出的结果是否
// 逐字节一致——证明"浏览器里跑的逻辑"不是分叉出来的第二套实现, 而是与 SDK 真正一致。
import { readFileSync } from 'node:fs';

// ── 浏览器版 kaspa-wasm(initSync 直接吃字节, Node 里没有 fetch(file://) 但可以这样加载) ──
const webWasmMod = await import('file:///D:/rusty-kaspa/wasm/web/kaspa/kaspa.js');
const wasmBytes = readFileSync('D:/rusty-kaspa/wasm/web/kaspa/kaspa_bg.wasm');
webWasmMod.initSync({ module: new WebAssembly.Module(wasmBytes) });

// ── vendored blake2b(浏览器路径实际用的那份文件, 不是 npm 包) ──
const { blake2b: vendoredBlake2b } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/src/lib/checkout-static/vendor/noble-hashes/blake2b.js');

// verify-core.js 顶层没有 import.meta 相对路径依赖问题(纯函数, 不 import 浏览器专属模块), 直接加载
globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
const verifyCore = await import('file:///D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/src/lib/checkout-static/verify-core.js');

// ── Node 版 SDK(生产代码路径) ──
process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/src/lib/commission-plan-sdk.mjs');
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { PrivateKey } = kaspa;

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

const merchantPriv = new PrivateKey('01'.repeat(32));
const brokerPriv = new PrivateKey('02'.repeat(32));
const ch1Priv = new PrivateKey('03'.repeat(32));
const ch2Priv = new PrivateKey('04'.repeat(32));
const net = 'testnet';
const addr = (priv) => priv.toPublicKey().toAddress(net).toString();

const quoteBase = {
  schema_v: 1, quote_id: 'parity-test-1', merchant_pubkey_hex: merchantPriv.toPublicKey().toString(),
  price_sompi: '1000000000',
  canonical_rules: { schema_v: 1, roles: [
    { name: 'provider', bps: 7000, address: addr(merchantPriv) },
    { name: 'broker', bps: 500, address: addr(brokerPriv) },
    { name: 'channel_1', bps: 900, fold_to: 'provider' },
    { name: 'channel_2', bps: 700, fold_to: 'provider' },
    { name: 'channel_3', bps: 500, fold_to: 'provider' },
    { name: 'channel_4', bps: 300, fold_to: 'provider' },
    { name: 'channel_5', bps: 100, fold_to: 'provider' },
  ] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now(), valid_until_ms: Date.now() + 86400000,
  channel_whitelist: null, require_channel_deposit: false, min_deposit_sompi: '100000000',
  max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000,
};
const signedQuote = SDK.signQuote(quoteBase, merchantPriv.toString());

// ── parity 1: canonicalQuoteBytes byte-equal ──
const sdkBytes = SDK.canonicalQuoteBytes(signedQuote);
const coreBytes = verifyCore.canonicalQuoteBytes(signedQuote);
check('canonicalQuoteBytes byte-equal (Node SDK vs verify-core)', Buffer.from(sdkBytes).equals(Buffer.from(coreBytes)));

// ── parity 2: verifyQuoteSignature agree (valid + tampered) ──
const sdkVerifyValid = SDK.verifyQuoteSignature(signedQuote);
const coreVerifyValid = verifyCore.verifyQuoteSignature(webWasmMod, signedQuote);
check('verifyQuoteSignature agree on VALID quote', sdkVerifyValid === true && coreVerifyValid === true, `sdk=${sdkVerifyValid} core=${coreVerifyValid}`);

const tampered = { ...signedQuote, price_sompi: '999' };
const sdkVerifyBad = SDK.verifyQuoteSignature(tampered);
const coreVerifyBad = verifyCore.verifyQuoteSignature(webWasmMod, tampered);
check('verifyQuoteSignature agree on TAMPERED quote', sdkVerifyBad === false && coreVerifyBad === false, `sdk=${sdkVerifyBad} core=${coreVerifyBad}`);

// ── parity 3: spkBytesFromAddress byte-equal ──
const testAddr = addr(ch1Priv);
const sdkSpk = SDK.spkBytesFromAddress(testAddr);
const coreSpk = verifyCore.spkBytesFromAddress(webWasmMod, testAddr);
check('spkBytesFromAddress byte-equal', Buffer.from(sdkSpk).equals(Buffer.from(coreSpk)), `sdk=${Buffer.from(sdkSpk).toString('hex')} core=${Buffer.from(coreSpk).toString('hex')}`);

// ── parity 4: dedupAndCapChannelSpks agree ──
const a = addr(ch1Priv), b = addr(ch2Priv);
const sdkDedup = SDK.dedupAndCapChannelSpks([a, b, a]);
const coreDedup = verifyCore.dedupAndCapChannelSpks(webWasmMod, [a, b, a]);
check('dedupAndCapChannelSpks agree (ok + null-slot pattern)', sdkDedup.ok === coreDedup.ok && sdkDedup.spks[2] === null && coreDedup.spks[2] === null);
check('dedupAndCapChannelSpks spk bytes byte-equal for slot 0', Buffer.from(sdkDedup.spks[0]).equals(Buffer.from(coreDedup.spks[0])));

// ── parity 5: full signature chain — sign with SDK, verify with verify-core (and vice versa is implicit since both use same verifyMessage) ──
const spk1 = SDK.spkBytesFromAddress(addr(ch1Priv));
const spk2 = SDK.spkBytesFromAddress(addr(ch2Priv));
const empty = SDK.verifyChain(signedQuote, [], 'testnet');
const e1 = SDK.signChainEntry(empty.chainDigest, 1, spk1, ch1Priv.toString());
// recompute digest1 manually (same as SDK internal) to sign e2
const blake2bNode = (await import('file:///D:/kanet-tn12/kasia-console/node_modules/@noble/hashes/blake2b.js')).blake2b;
const d1 = Buffer.from(blake2bNode(Buffer.concat([empty.chainDigest, Buffer.from([1]), spk1, e1.signing_pubkey]), { dkLen: 32 }));
const e2 = SDK.signChainEntry(d1, 2, spk2, ch2Priv.toString());

const sdkChainResult = SDK.verifyChain(signedQuote, [e1, e2], 'testnet');
const coreChainResult = verifyCore.verifyChain(webWasmMod, vendoredBlake2b, signedQuote, [
  { position: 1, address_spk: new Uint8Array(spk1), signing_pubkey: new Uint8Array(e1.signing_pubkey), sig: e1.sig },
  { position: 2, address_spk: new Uint8Array(spk2), signing_pubkey: new Uint8Array(e2.signing_pubkey), sig: e2.sig },
], 'testnet');
check('verifyChain agree (SDK-signed chain, verified by both)', sdkChainResult.ok === true && coreChainResult.ok === true, JSON.stringify({ sdk: sdkChainResult.ok, core: coreChainResult.ok, coreReason: coreChainResult.reason }));
check('verifyChain chainDigest byte-equal', Buffer.from(sdkChainResult.chainDigest).equals(Buffer.from(coreChainResult.chainDigest)));

// ── parity 6: tampered chain rejected by both ──
const tamperedEntries = [{ ...e1, position: 1 }, { ...e2, position: 2, address_spk: spk1 }]; // swap e2's address
const sdkTamperResult = SDK.verifyChain(signedQuote, tamperedEntries, 'testnet');
const coreTamperResult = verifyCore.verifyChain(webWasmMod, vendoredBlake2b, signedQuote, [
  { position: 1, address_spk: new Uint8Array(spk1), signing_pubkey: new Uint8Array(e1.signing_pubkey), sig: e1.sig },
  { position: 2, address_spk: new Uint8Array(spk1), signing_pubkey: new Uint8Array(e2.signing_pubkey), sig: e2.sig },
], 'testnet');
check('verifyChain agree on TAMPERED chain (both reject)', sdkTamperResult.ok === false && coreTamperResult.ok === false);

console.log(`\n=== verify-core.js <-> commission-plan-sdk.mjs parity: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
