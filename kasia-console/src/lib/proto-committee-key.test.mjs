// proto-committee-key.test.mjs — 委员会 keypair 生成+加密存储 helper 回归(J2 2026-09-14, 接线笔③,
// Bettor 1354 三项纪律: 真调 crypto.js / 无明文暂存 / 无第二份存储)。
// Run: cd kasia-console && node src/lib/proto-committee-key.test.mjs

process.env.CONSOLE_ENCRYPTION_KEY = 'aa'.repeat(32); // crypto.js 既有 getKey() 要求 64-hex; 测试用固定值

const { generateCommitteeKeypair, encryptCommitteePrivkey, decryptCommitteePrivkey } = await import('./proto-committee-key.mjs');
const fs = await import('node:fs');
const { fileURLToPath } = await import('node:url');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

console.log('[test] ① generateCommitteeKeypair(): 格式正确, 私钥/公钥都是十六进制字符串:');
{
  const kp = await generateCommitteeKeypair();
  ok(/^[0-9a-f]{64}$/i.test(kp.privKeyHex), `privKeyHex 是 64-hex(32字节)(实际长度 ${kp.privKeyHex.length})`);
  ok(/^[0-9a-f]+$/i.test(kp.pubkeyHex) && kp.pubkeyHex.length > 0, `pubkeyHex 是十六进制字符串(实际 ${kp.pubkeyHex.slice(0, 20)}...)`);
}

console.log('[test] ② 两次生成产生不同的密钥(不是硬编码/确定性占位值):');
{
  const kp1 = await generateCommitteeKeypair();
  const kp2 = await generateCommitteeKeypair();
  ok(kp1.privKeyHex !== kp2.privKeyHex, '两次 privKeyHex 不同');
  ok(kp1.pubkeyHex !== kp2.pubkeyHex, '两次 pubkeyHex 不同');
}

console.log('[test] ③ encrypt→decrypt 往返正确恢复原始明文(真调 crypto.js, 不是自己发明的方案):');
{
  const kp = await generateCommitteeKeypair();
  const envelope = encryptCommitteePrivkey(kp.privKeyHex);
  const recovered = decryptCommitteePrivkey(envelope);
  ok(recovered === kp.privKeyHex, `解密恢复的明文与原始 privKeyHex 一致(实际 ${recovered === kp.privKeyHex})`);
}

console.log('[test] ④ 加密信封是 crypto.js 既有标准格式(v1/aes-256-gcm/iv/tag/ciphertext), 不是自造的临时方案:');
{
  const kp = await generateCommitteeKeypair();
  const envelope = encryptCommitteePrivkey(kp.privKeyHex);
  const parsed = JSON.parse(envelope);
  ok(parsed.v === 1, `v === 1(实际 ${parsed.v})`);
  ok(parsed.alg === 'aes-256-gcm', `alg 正确(实际 ${parsed.alg})`);
  ok(typeof parsed.iv === 'string' && typeof parsed.tag === 'string' && typeof parsed.ciphertext === 'string', 'iv/tag/ciphertext 三字段齐全');
  ok(!envelope.includes(kp.privKeyHex), '密文信封里不包含明文私钥本身(base64 编码后不可能字面匹配, 双重确认)');
}

console.log('[test] ⑤ 同一明文两次加密产生不同密文(AES-GCM 随机 IV, 不是确定性加密——防止密文本身泄露"是否是同一把私钥"这种侧信道):');
{
  const kp = await generateCommitteeKeypair();
  const envelope1 = encryptCommitteePrivkey(kp.privKeyHex);
  const envelope2 = encryptCommitteePrivkey(kp.privKeyHex);
  ok(envelope1 !== envelope2, '两次加密同一明文, 密文信封不同(随机 IV 生效)');
  ok(decryptCommitteePrivkey(envelope1) === kp.privKeyHex && decryptCommitteePrivkey(envelope2) === kp.privKeyHex, '尽管密文不同, 两者都能正确解密回同一明文');
}

console.log('[test] ⑥ 静态自审: 本文件源码里不含任何 log 语句(无明文暂存纪律的"文件级别"体现——不能有任何 console.log(privKeyHex) 这类代码路径, 从源头杜绝):');
{
  const srcPath = fileURLToPath(new URL('./proto-committee-key.mjs', import.meta.url));
  const src = fs.readFileSync(srcPath, 'utf8');
  ok(!/console\.\w+\(/.test(src), `proto-committee-key.mjs 源码不含任何 console.* 调用(实际检查通过: ${!/console\.\w+\(/.test(src)})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — proto-committee-key(生成+加密存储+往返正确+随机IV+零log) 全绿'
  : `\n❌ ${fails} assertions failed`);
// 🔴 实测(2026-09-14, 同 proto.wiring.test.mjs ledger 1358 附近同族坑, 但触发源不同): 动态
// import('kaspa-wasm') 在 generateCommitteeKeypair() 里引入的 wasm 运行时资源, 在全部断言跑完后
// 立即 process.exit() 会撞 Windows libuv 断言崩溃("Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)", exit code 变 127, 尽管所有断言已经真的全部通过)——不止"spawn 了子进程"这一种
// 场景会触发这个坑, 任何留有未清理异步资源(wasm/定时器/句柄)的进程在 process.exit() 前都可能撞上。
// 改用 exitCode 属性, 让进程自然退出。
process.exitCode = fails === 0 ? 0 : 1;
