// checkSigFromStack E2E — 测试向量生成 + **离线自验**（J2 2026-08-20, 报备层, 不上链）
//
// 🔴 本脚本【不广播、不碰链】。它只做两件事:
//   ① 生成 V0-V5 六组向量(合约 ctor + witness 入参);
//   ② **离线用 kaspa-wasm 自验每组向量的"应然"** —— 合法组必须离线验通过, 篡改组必须离线验失败。
//
// 🔴 为什么要有 ② (这是本脚本最该被审的一段):
//   若不自验, 一个"篡改组其实仍然合法"的向量 bug, 会在链上表现为 PASS,
//   而我们会把它读成 **"codegen 有洞"** —— 把【我的向量错】误报成【编译器错】。
//   ⇒ 上链之前, 必须先证明这批向量本身的应然是对的。**仪器要先自证, 再去测被测物。**
//
// 🔵 而离线验【不能替代】上链验: 离线用的是 kaspa-wasm 的实现, 链上跑的是 silverc 编出的脚本。
//   两者一致才说明 codegen 对; 只跑离线 = 只测了 kaspa-wasm, 那不是本卡的题。
//
// 编译坐标(硬断言, 见下 assertPinnedCompiler): versioned-builds/silverc-zk-8065184.exe
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

// P1(g) 离线腿(2026-08-27, Codex 8/22 窄 MUST-FIX: 用【重建出的】编译器跑冻结向量):
//   env P1G_SILVERC 覆盖被测编译器(如 item5 的 A = scratch/_p1g_verify/target/release/silverc.exe);
//   不设 ⇒ 默认仍是权威 C, 下方 assertPinnedCompiler 的语义不变。输出与 vectors.json 都打印编译器 sha256。
const SILVERC = process.env.P1G_SILVERC || 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const LEGACY = 'D:/silverscript/target/release/silverc.exe';
const SIL = 'D:/kanet-tn12/kasia-console/src/lib/CheckSigFromStackProbe.sil';
const OUT = 'D:/kanet-tn12/scratch/e2e';

// 🔴 编译坐标断言: 默认路径是 legacy-2c46231 的逐字节副本, 不认本内建。
//    这一条【必须在生成向量之前】跑 —— 否则我们会拿着一批向量去测一个编不出来的东西。
function assertPinnedCompiler() {
  if (!existsSync(SILVERC)) throw new Error(`pinned 编译器不存在: ${SILVERC}`);
  if (!existsSync(`${OUT}/_ctor.json`)) throw new Error(
    'ctor 文件不存在 —— 本断言必须在 ctor 生成【之后】跑; 否则 legacy 会因 file-not-found 失败, ' +
    '而那与"缺内建"在 catch 里长得一模一样 ⇒ 控制项以错误原因成立(Codex b41d51cc 逮到的 false-positive)');
  if (!existsSync(LEGACY)) { console.log('  ⓘ 默认路径不存在, 跳过对照臂(非失败)'); return; }
  // 🔴 断言的是【失败的原因】, 不是"失败了" —— 这正是 Codex 逮到的那一格。
  let stderr = '';
  let compiled = false;
  try {
    stderr = String(execFileSync(LEGACY, [SIL, '--ctor', `${OUT}/_ctor.json`, '-o', `${OUT}/_legacy_probe.json`],
      { stdio: 'pipe', encoding: 'utf8' }) || '');
    compiled = existsSync(`${OUT}/_legacy_probe.json`);
  } catch (e) { stderr = String(e?.stdout || '') + String(e?.stderr || '') + String(e?.message || ''); }
  const byMissingBuiltin = /unknown function call:\s*checkSigFromStack/i.test(stderr);
  const byFileNotFound = /failed to read|os error 2|no such file/i.test(stderr);
  if (compiled) {
    throw new Error('🔴 对照臂失效: 默认(legacy)路径居然编出了本内建 ⇒ 它被换过, 停下来核 MANIFEST');
  }
  if (byFileNotFound) {
    throw new Error(`🔴 对照臂【以错误原因成立】: legacy 因 file-not-found 失败, 不是因缺内建。原文: ${stderr.slice(0, 160)}`);
  }
  if (!byMissingBuiltin) {
    throw new Error(`🔴 对照臂原因不可辨: 既非 unknown-function 也非 file-not-found。原文: ${stderr.slice(0, 200)}`);
  }
  console.log('  ✅ 对照臂成立且【原因正确】: legacy 报 "unknown function call: checkSigFromStack"(非 file-not-found)');
}


const kaspa = await import('kaspa-wasm');
// 🔴 2026-08-20 V0 预检实测更正: 链上 checkSigFromStack 要的是【对 32B digest 的裸 BIP340 schnorr】
//   (TUTORIAL.md:851 "Verify a 64-byte Schnorr signature against a 32-byte digest")。
//   而 kaspa-wasm signMessage 会【先 hash 再签】(relay.mjs:640 注释), 签的是 hash(digest) ⇒ 链上必拒。
//   ⇒ 造签名与离线判据都改用 @noble/curves 的裸 BIP340。
const { schnorr } = await import('@noble/curves/secp256k1');

const newKey = () => {
  const acct = new kaspa.XPrv(new kaspa.Mnemonic(kaspa.Mnemonic.random().phrase).toSeed())
    .deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);
  const leaf = acct.deriveChild(0, false).deriveChild(0, false);
  const priv = (typeof leaf.toPrivateKey === 'function' ? leaf.toPrivateKey() : kaspa.PrivateKey.fromXPrv(leaf));
  const privBytes = Buffer.from(priv.toString(), 'hex');
  const pkXOnly = priv.toPublicKey().toXOnlyPublicKey().toString().toLowerCase();
  // 自查: kaspa 派生的 xonly 公钥必须与 noble 由同一私钥算出的一致, 否则两套体系对不上, 后面全白做
  const nobleXOnly = Buffer.from(schnorr.getPublicKey(privBytes)).toString('hex');
  if (nobleXOnly !== pkXOnly) throw new Error(`🔴 kaspa/noble 公钥不一致: ${pkXOnly} vs ${nobleXOnly}`);
  return { priv, privBytes, pkXOnly };
};

const flipBit = (hex) => {
  const b = Buffer.from(hex, 'hex');
  b[0] ^= 0x01;                       // 翻最低位 —— 最小扰动, 排除"因为长度/格式被拒"
  return b.toString('hex');
};

// 离线"应然"验签 —— 🔴 判据是【链上规则】(BIP340 裸验), 不是 kaspa-wasm 自己的另一半。
//   旧写法用 signMessage 签 / verifyMessage 验 = 自洽两半互相同意 ⇒ 必然全绿、零信息,
//   它对"签名口径根本不对"这个错完全失明(2026-08-20 实账: 八格全绿, 链上 V0 照样 NULLFAIL)。
const offlineVerify = (sigHex, digestHex, pkHex) => {
  try { return schnorr.verify(Buffer.from(sigHex, 'hex'), Buffer.from(digestHex, 'hex'), Buffer.from(pkHex, 'hex')) === true; }
  catch { return false; }
};

const KEY_A = newKey();
const KEY_B = newKey();                                   // V3 用: 另一把钥
const D1 = randomBytes(32).toString('hex');
const D2 = randomBytes(32).toString('hex');               // V5 用: 第二条消息
const sign = (key, digestHex) => Buffer.from(schnorr.sign(Buffer.from(digestHex, 'hex'), key.privBytes)).toString('hex');

const SIG_A_D1 = sign(KEY_A, D1);
const SIG_A_D2 = sign(KEY_A, D2);
const SIG_B_D1 = sign(KEY_B, D1);

// ── 向量表(预注册, 与设计稿 §3 + NWT V5 一一对应) ──────────────────────────
const VECTORS = [
  { id: 'V0', why: '合法三元组 —— 正路可用(但【不证明闸存在】)', sig: SIG_A_D1, digest: D1, expect: 'PASS' },
  { id: 'V1', why: 'sig 翻一位 ⇒ 证明签名参与了运算', sig: flipBit(SIG_A_D1), digest: D1, expect: 'REJECT' },
  { id: 'V2', why: 'digest 翻一位 ⇒ 证明 digest 参与了运算(最像 stub 那格)', sig: SIG_A_D1, digest: flipBit(D1), expect: 'REJECT' },
  { id: 'V3', why: '另一把钥的【格式完全合法】签名 ⇒ 排除"根本没在比对公钥"', sig: SIG_B_D1, digest: D1, expect: 'REJECT' },
  { id: 'V4', why: '全零 sig(长度合法非签名) ⇒ 不接受平凡值', sig: '00'.repeat(64), digest: D1, expect: 'REJECT' },
  // 🔵 V5 = NWT 2026-08-20 红队补: 单点扰动都盖不住"参数顺序类 bug"; 交叉配对两半各自合法, 只有【配对】错。
  { id: 'V5a', why: '交叉配对 (sigA@D1, D2) —— 两半各自合法, 只有配对错', sig: SIG_A_D1, digest: D2, expect: 'REJECT' },
  { id: 'V5b', why: '交叉配对 (sigA@D2, D1) —— 反向, 排除单向巧合', sig: SIG_A_D2, digest: D1, expect: 'REJECT' },
  // 🔵 V5 的阳性对照: 若不证明 (sigA@D2, D2) 本身能过, 上面两条 REJECT 可能只是"D2 这条消息有问题"
  { id: 'V5c', why: 'V5 的阳性对照: (sigA@D2, D2) 必须 PASS, 否则 V5a/V5b 的 REJECT 无归因', sig: SIG_A_D2, digest: D2, expect: 'PASS' },
];

// -- 判据自身的对照臂(2026-08-20 立): 先证明【这把尺会红】, 再用它量向量。 --
//   上一版判据(signMessage 签 / verifyMessage 验)也是八格全绿, 而它【永远】全绿 = 零判别力。
//   ⇒ 全绿本身不是证据; 必须先看到它对一个【已知错】的输入报 REJECT。
{
  const probeD = randomBytes(32).toString('hex');
  const wrongSig = kaspa.signMessage({ message: probeD, privateKey: KEY_A.priv }); // 旧口径 = 已知链上不合法
  const rightSig = sign(KEY_A, probeD);                                           // 新口径 = 应合法
  const wrongOk = offlineVerify(wrongSig, probeD, KEY_A.pkXOnly);
  const rightOk = offlineVerify(rightSig, probeD, KEY_A.pkXOnly);
  console.log('');
  console.log("=== 判据自身的对照臂(先证这把尺会红) ===");
  console.log('  旧口径 signMessage 签名 -> ' + (wrongOk ? 'PASS' : 'REJECT') + ' (必须 REJECT)');
  console.log('  新口径 裸 BIP340 签名   -> ' + (rightOk ? 'PASS' : 'REJECT') + ' (必须 PASS)');
  if (wrongOk || !rightOk) {
    console.log('🔴 判据失效: 这把尺不会红(或把对的判成错) ⇒ 下面八格无论什么结果都【不可采信】');
    process.exit(1);
  }
  console.log('  ✅ 判据有判别力(会红也会绿) ⇒ 下面八格的读数才有意义');
}

  console.log('');
  console.log("=== 向量【离线自验】: 应然 vs BIP340 裸验(= 链上规则) ===");
let bad = 0;
for (const v of VECTORS) {
  const actual = offlineVerify(v.sig, v.digest, KEY_A.pkXOnly) ? 'PASS' : 'REJECT';
  const ok = actual === v.expect;
  if (!ok) bad++;
  console.log(`  ${ok ? '✅' : '🔴'} ${v.id.padEnd(4)} 期望 ${v.expect.padEnd(6)} 离线得 ${actual.padEnd(6)} — ${v.why}`);
}
console.log(bad === 0
  ? '\n✅ 八格全部与应然一致 ⇒ 这批向量【本身是对的】, 可以拿去测链上行为'
  : `\n🔴 ${bad} 格与应然不符 ⇒ **向量本身有问题, 绝不可上链** —— 否则会把我的向量错误报成 codegen 错误`);

mkdirSync(OUT, { recursive: true });
const ctorArg = { kind: 'array', data: [...Buffer.from(KEY_A.pkXOnly, 'hex')].map((b) => ({ kind: 'byte', data: b })) };
writeFileSync(`${OUT}/_ctor.json`, JSON.stringify([ctorArg]));

console.log('\n=== 编译坐标断言(必须在 ctor 生成【之后】跑) ===');
assertPinnedCompiler();
// 用被测编译器真编一次 probe, 记录编译器 sha256 与产出 script sha256 —— "哪个二进制产出了这段字节"必须在证据里, 不能只写路径
const compilerSha = sha256File(SILVERC);
const probeOut = `${OUT}/probe_${compilerSha.slice(0, 8)}.json`;
execFileSync(SILVERC, [SIL, '--ctor', `${OUT}/_ctor.json`, '-o', probeOut], { stdio: 'pipe', encoding: 'utf8' });
const probeJson = JSON.parse(readFileSync(probeOut, 'utf8'));
const scriptHex = Buffer.from(probeJson.script).toString('hex');
const scriptSha = createHash('sha256').update(scriptHex).digest('hex');
console.log(`  编译器 ${SILVERC}\n  compiler sha256=${compilerSha}\n  probe script ${scriptHex.length / 2}B sha256(hex)=${scriptSha} → ${probeOut}`);
writeFileSync(`${OUT}/vectors.json`, JSON.stringify({
  compiler: SILVERC, compiler_sha256: compilerSha, probe_script_sha256: scriptSha, probe_script_bytes: scriptHex.length / 2,
  sil: SIL, pkBaked: KEY_A.pkXOnly,
  note: '🔴 privkey 不入此文件; 上链跑时现签或另传。本文件可公开。',
  vectors: VECTORS.map(({ id, why, sig, digest, expect }) => ({ id, why, sig, digest, expect })),
}, null, 1));
console.log(`\n已写 ${OUT}/vectors.json 与 _ctor.json(pk 烤值)。**未广播、未碰链。**`);
if (bad > 0) process.exitCode = 1;
