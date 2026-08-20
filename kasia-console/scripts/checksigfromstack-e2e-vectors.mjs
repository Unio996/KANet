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
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const SILVERC = 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
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

const newKey = () => {
  const acct = new kaspa.XPrv(new kaspa.Mnemonic(kaspa.Mnemonic.random().phrase).toSeed())
    .deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true);
  const leaf = acct.deriveChild(0, false).deriveChild(0, false);
  const priv = (typeof leaf.toPrivateKey === 'function' ? leaf.toPrivateKey() : kaspa.PrivateKey.fromXPrv(leaf));
  return { priv, pkXOnly: priv.toPublicKey().toXOnlyPublicKey().toString().toLowerCase() };
};

const flipBit = (hex) => {
  const b = Buffer.from(hex, 'hex');
  b[0] ^= 0x01;                       // 翻最低位 —— 最小扰动, 排除"因为长度/格式被拒"
  return b.toString('hex');
};

// 离线"应然"验签: 用 kaspa-wasm 同一实现判这组向量【本该】通过还是失败
const offlineVerify = (sigHex, digestHex, pkHex) => {
  try { return kaspa.verifyMessage({ message: digestHex, signature: sigHex, publicKey: pkHex }) === true; }
  catch { return false; }
};

const KEY_A = newKey();
const KEY_B = newKey();                                   // V3 用: 另一把钥
const D1 = randomBytes(32).toString('hex');
const D2 = randomBytes(32).toString('hex');               // V5 用: 第二条消息
const sign = (key, digestHex) => kaspa.signMessage({ message: digestHex, privateKey: key.priv });

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

console.log('\n=== 向量【离线自验】: 应然 vs kaspa-wasm 实测 ===');
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
writeFileSync(`${OUT}/vectors.json`, JSON.stringify({
  compiler: SILVERC, sil: SIL, pkBaked: KEY_A.pkXOnly,
  note: '🔴 privkey 不入此文件; 上链跑时现签或另传。本文件可公开。',
  vectors: VECTORS.map(({ id, why, sig, digest, expect }) => ({ id, why, sig, digest, expect })),
}, null, 1));
console.log(`\n已写 ${OUT}/vectors.json 与 _ctor.json(pk 烤值)。**未广播、未碰链。**`);
if (bad > 0) process.exitCode = 1;
