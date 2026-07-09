// coord-status-sign.selftest.mjs — D-010 落地①回归测试(J1tn, 2026-07-10)。
//
// 今晚教训(scout 归因卡撞出的, 见 docs/2026-07-10-scout-sender-attribution-input-based-design.md):
// selftest 用手工构造的 fixture 会掩盖"跟真实节点行为不一致"的问题(NWT: "fixture 塞了
// verboseData 没复刻真实节点=假绿")。本文件的 signedMessage/REAL_PUBKEY 不是手写的——
// 是 2026-07-10 用本机真实 J1tn relay(e7f51073-6b6c-41ea-b7fe-e82e98531a9a)跑通
// POST /api/admin/coord-status/sign 拿到的真实 schnorr 签名结果, 逐字节复制进来(非重新
// 手打转录, 避免转录本身引入字符级差异——今晚调试时真的手打错过一个字导致假阴性)。
//
// Run: cd kasia-console && node src/lib/coord-status-sign.selftest.mjs

import { verifyCoordStatusMessage, computeContentHashHex, splitSignedMessage, buildSignedMessage } from './coord-status-sign.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// 真实数据: 2026-07-10, 本机 J1tn relay ecdsa_sign 对 blake2b(content) 签名的真实产出。
const REAL_PUBKEY = '9b7f4fa33ba60ace1d41e340329a88ad8a00e1e265904538c2a608c7db18df57';
const REAL_HASH_HEX = 'f3f2219b1c544d161c5eae6d566eccc6eaf6c194e480ae48ec8da2c7473f0746';
const REAL_SIGNATURE = '2589e52ed63010c4b8e5215de452bce0db0123314d161c291bfeb8c9c1ba069f576ed0ac8431cc941271728687632e98947151f3f1944f3ce3b5ef1509631637';
const REAL_CONTENT = '【coord-status·测试】\n锚点: git HEAD=deadbeef\n主线: 测试D-010签名工具\n在飞: J1tn签名工具落码中';
const WRONG_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000';

console.log('[test] computeContentHashHex — 对真实内容重算的 blake2b 与真实relay产出的一致:');
ok(computeContentHashHex(REAL_CONTENT) === REAL_HASH_HEX, 'blake2b(REAL_CONTENT) 与当时 admin endpoint 返回的 hashHex byte-exact 一致');

console.log('\n[test] buildSignedMessage / splitSignedMessage 往返一致:');
const built = buildSignedMessage(REAL_CONTENT, REAL_SIGNATURE);
const { content: splitContent, signature: splitSig } = splitSignedMessage(built);
ok(splitContent === REAL_CONTENT, 'splitSignedMessage 拆出的正文与原始 REAL_CONTENT 一致');
ok(splitSig === REAL_SIGNATURE, 'splitSignedMessage 拆出的签名与 REAL_SIGNATURE 一致');

console.log('\n[test] 真实relay签名 + 真实公钥 验签通过(非合成fixture,真实schnorr产出):');
const r1 = await verifyCoordStatusMessage(built, REAL_PUBKEY);
ok(r1.valid === true, '真实签名用真实公钥验签通过');

console.log('\n[test] 篡改内容后验签失败:');
const tampered = built.replace('测试', '伪造');
const r2 = await verifyCoordStatusMessage(tampered, REAL_PUBKEY);
ok(r2.valid === false, '篡改内容后(即使只改一处), 同一个签名验不过');

console.log('\n[test] 错误公钥验签失败:');
const r3 = await verifyCoordStatusMessage(built, WRONG_PUBKEY);
ok(r3.valid === false, '真实内容+真实签名, 但用错公钥验不过');

console.log('\n[test] 缺 SIG 行 fail-closed(不静默通过):');
const noSig = built.split('\nSIG:')[0];
const r4 = await verifyCoordStatusMessage(noSig, REAL_PUBKEY);
ok(r4.valid === false && r4.error === 'no SIG: line found', '没有 SIG 行时明确报错, 非静默通过');

console.log('\n[test] 空 publicKeyHex 参数 fail-closed:');
const r5 = await verifyCoordStatusMessage(built, '');
ok(r5.valid === false && r5.error === 'publicKeyHex required', '公钥参数缺失时明确报错');

console.log('\n[test] SIG 行本身不参与哈希(尾部多余空白/换行不影响验签):');
const withTrailingNewline = built + '\n\n';
const r6 = await verifyCoordStatusMessage(withTrailingNewline, REAL_PUBKEY);
ok(r6.valid === true, '消息尾部多余空行不影响验签结果(splitSignedMessage 正确定位最后一行 SIG:)');

console.log('\n[test] NWT 2026-07-10 审查坐实的 bug 回归锁死:content 本身尾部带空白,签名侧和读端提取侧哈希必须一致:');
const contentWithTrailingSpace = '【回归测试】\n正文末尾带一个空格 ';
const hashAtSignTime = computeContentHashHex(contentWithTrailingSpace);
const signedWithTrailing = buildSignedMessage(contentWithTrailingSpace, 'deadbeef');
const { content: extractedContent } = splitSignedMessage(signedWithTrailing);
const hashAfterExtraction = computeContentHashHex(extractedContent);
ok(hashAtSignTime === hashAfterExtraction, '签名时对 content 算的 hash,与读端 splitSignedMessage 提取后重算的 hash byte-exact 一致(此前 buildSignedMessage 不 trim/splitSignedMessage 会 trim,两者不对称导致这条曾经会失败)');

console.log(fails === 0
  ? '\n✅✅ ALL PASS — coord-status 签名/验签: 真实relay schnorr签名验证通过, 篡改/错误公钥/缺签名/参数缺失均fail-closed'
  : `\n❌ ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
