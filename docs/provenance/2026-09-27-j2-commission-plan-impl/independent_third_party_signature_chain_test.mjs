// independent_third_party_signature_chain_test.mjs — 零 import commission-plan-sdk.mjs 的独立第三方
// 复现(同 InstantSplit PMT 修复那一轮 independent_third_party_test_v2_pmt_fixed.mjs 同一条纪律):
// 从零手写签名链的构造/验证逻辑(只依赖 kaspa-wasm 与 @noble/hashes 这两个第三方库本身, 不 import
// commission-plan-sdk.mjs 里任何一行), 独立验证 §3.4 signChainEntry/verifyChain 的密码学声明——
// 域分隔根摘要、位置绑定、5 种攻击抵抗——是否真的成立, 不是读了 SDK 代码就信。
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { PrivateKey, signMessage, verifyMessage } = kaspa;
const blake2bPath = require.resolve('@noble/hashes/blake2b');
const { blake2b } = await import('file://' + blake2bPath.replace(/\\/g, '/'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } }

const DOMAIN = 'KANET-COMMISSION-CHAIN-V1';

// 独立手写: 不调用 SDK 任何函数, 完全按设计稿 §3.4.2/§3.4.3 文字重新实现一遍
function myChainDigest0(quoteHash32, network) {
  return Buffer.from(blake2b(Buffer.concat([Buffer.from(DOMAIN, 'utf8'), quoteHash32, Buffer.from(network, 'utf8')]), { dkLen: 32 }));
}
function myMessageBytes(prevDigest, position, addressSpk, signingPubkey) {
  return Buffer.concat([prevDigest, Buffer.from([position & 0xff]), addressSpk, signingPubkey]);
}
function mySign(prevDigest, position, addressSpk, privKeyHex) {
  const priv = new PrivateKey(privKeyHex);
  const pub = Buffer.from(priv.toPublicKey().toString(), 'hex');
  const msg = myMessageBytes(prevDigest, position, addressSpk, pub);
  const sig = signMessage({ message: msg.toString('hex'), privateKey: priv });
  return { position, address_spk: addressSpk, signing_pubkey: pub, sig };
}
function myVerifyChain(quoteHash32, network, entries) {
  let d = myChainDigest0(quoteHash32, network);
  for (let k = 1; k <= entries.length; k++) {
    const e = entries[k - 1];
    if (e.position !== k) return { ok: false, reason: `position mismatch at ${k}` };
    const msg = myMessageBytes(d, k, e.address_spk, e.signing_pubkey);
    if (!verifyMessage({ message: msg.toString('hex'), signature: e.sig, publicKey: e.signing_pubkey.toString('hex') })) return { ok: false, reason: `sig fail at ${k}` };
    d = Buffer.from(blake2b(msg, { dkLen: 32 }));
  }
  return { ok: true, chainDigest: d };
}

const quoteHash = Buffer.from(blake2b(Buffer.from('independent-test-quote-content', 'utf8'), { dkLen: 32 }));
const network = 'simnet';
const A = new PrivateKey('11'.repeat(32));
const B = new PrivateKey('22'.repeat(32));
const C = new PrivateKey('33'.repeat(32));
const spkA = Buffer.from('aa'.repeat(37), 'hex');
const spkB = Buffer.from('bb'.repeat(37), 'hex');
const spkC = Buffer.from('cc'.repeat(37), 'hex');

const d0 = myChainDigest0(quoteHash, network);
const eA = mySign(d0, 1, spkA, A.toString());
const dA = Buffer.from(blake2b(myMessageBytes(d0, 1, spkA, eA.signing_pubkey), { dkLen: 32 }));
const eB = mySign(dA, 2, spkB, B.toString());
const dB = Buffer.from(blake2b(myMessageBytes(dA, 2, spkB, eB.signing_pubkey), { dkLen: 32 }));
const eC = mySign(dB, 3, spkC, C.toString());

// ── happy path ──
const vFull = myVerifyChain(quoteHash, network, [eA, eB, eC]);
check('independent: root->A->B->C verifies', vFull.ok, vFull.reason);

// ── truncation is policy, not an attack (§3.4.4) ──
const vTrunc = myVerifyChain(quoteHash, network, [eA, eB]);
check('independent: truncation root->A->B verifies fine', vTrunc.ok);

// ── delete A: present root->B->C directly ──
const vDelA = myVerifyChain(quoteHash, network, [{ ...eB, position: 1 }, { ...eC, position: 2 }]);
check('independent: delete A -> fails', vDelA.ok === false);

// ── insert X between A and B (B reuses old sig at new position) ──
const X = new PrivateKey('44'.repeat(32));
const spkX = Buffer.from('dd'.repeat(37), 'hex');
const eX = mySign(dA, 2, spkX, X.toString());
const vInsertX = myVerifyChain(quoteHash, network, [eA, eX, { ...eB, position: 3 }]);
check('independent: insert X before B (B keeps old sig) -> fails', vInsertX.ok === false);

// ── replay: sign under a different quote hash, replay into this one ──
const otherQuoteHash = Buffer.from(blake2b(Buffer.from('a-totally-different-quote', 'utf8'), { dkLen: 32 }));
const d0Other = myChainDigest0(otherQuoteHash, network);
const eForeign = mySign(d0Other, 1, spkA, A.toString());
const vReplay = myVerifyChain(quoteHash, network, [eForeign]);
check('independent: replay signature from different quote context -> fails', vReplay.ok === false);

// ── network replay: same quote hash, different network string ──
const d0DiffNet = myChainDigest0(quoteHash, 'mainnet');
const eDiffNet = mySign(d0DiffNet, 1, spkA, A.toString());
const vDiffNet = myVerifyChain(quoteHash, network, [eDiffNet]);
check('independent: replay signature from different network -> fails', vDiffNet.ok === false);

// ── X replaces A (uses own key, content differs) — position itself must fail if claiming to BE A without A's key ──
// (constructing "X's own valid entry at position 1" is NOT an attack — it's X legitimately joining;
//  the actual attack tested here is: can someone forge A's signature over X's content without A's key?
//  We verify structurally that a mismatched (address_spk, signing_pubkey, sig) triple never validates.)
const forgedEntry = { position: 1, address_spk: spkX, signing_pubkey: eA.signing_pubkey, sig: eA.sig }; // reuse A's real sig, swap in X's address
const vForge = myVerifyChain(quoteHash, network, [forgedEntry]);
check('independent: reusing As real sig with swapped address (X impersonating A) -> fails', vForge.ok === false);

console.log(`\n=== independent third-party (zero SDK import): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
