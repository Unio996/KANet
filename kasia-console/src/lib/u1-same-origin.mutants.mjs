// u1 A2 的变异测试。**14 格全绿只说明用例跑到了, 不说明码是对的** ——
// 把每道闸逐条拆掉、看用例会不会红, 才是证据。(@Bettor 20:08Z: 落码阶段同规格, 变异/负测试照配。)
//
// 🔴 三类计数缺一不可(照 CIS 那份): MISSED(拆了没红=用例在说谎) / INERT(没改到文件=这条什么也没测)
//    / BROKEN(改成语法坏的=它必然"检出", 什么也没证)。
// 🔴 收尾必须**验还原逐字节相同** —— 变异体留在库里比不跑变异更糟。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'u1-same-origin.mjs');
const TEST = join(HERE, 'u1-same-origin.test.mjs');
const original = readFileSync(SRC, 'utf8');
const originalSha = createHash('sha256').update(original).digest('hex');

const MUTANTS = [
  // ① 我自己补的那格缺口(根比较不能比字符串)——拆掉它, 缺口(a) 两格必须红
  ['根指纹退回比字符串(kpub/xpub 会被当成两个根)',
    (s) => s.replace("return 'blake2b256:' + hex(blake2b(Buffer.from(pk + cc, 'hex'), { dkLen: 32 }));",
      'return String(rootXpub).trim();')],
  // ② 反向不谎报: 把 NOT_DECIDABLE 改成一个"看起来是结论"的东西
  ['不同根时谎报"不同源"(把无知报成安全)',
    (s) => s.replace('verdict: VERDICT.NOT_DECIDABLE,', "verdict: 'DIFFERENT_ORIGIN',")],
  // ③ 派生证明本体
  ['不比对派生结果(绑定恒过)',
    (s) => s.replace('if (derived !== claimed) {', 'if (false) {')],
  // ④ N3 锁 1 的索引闸
  ['identityIndex 越界放行',
    (s) => s.replace('if (r.identityIndex < 0 || r.identityIndex >= U1_IDENTITIES_PER_ACCOUNT) {', 'if (false) {')],
  // ⑤ N4 委员必须 mnemonic 型
  ['custody 闸拆掉(privkey-only 可入委员)',
    (s) => s.replace('if (!U1_ALLOWED_CUSTODY.includes(reg?.custody)) {', 'if (false) {')],
  // ⑥ N3 同根聚合阈值
  ['同根阈值放宽到 2(第二个身份不再是违规)',
    (s) => s.replace('if (ids.length > U1_IDENTITIES_PER_ACCOUNT) {', 'if (ids.length > 2) {')],
  // ⑦ V6 残余边界进运行时输出
  ['notice 置空(边界退回只活在文档里)',
    (s) => s.replace('export const RESIDUAL_BOUNDARY_NOTICE = [', 'export const RESIDUAL_BOUNDARY_NOTICE_UNUSED = [')
      .replace("].join('\\n');", "].join('\\n');\nexport const RESIDUAL_BOUNDARY_NOTICE = '';")],
  // ⑧ fail-closed: 坏绑定不许进聚合
  ['坏绑定也进同根聚合(把绑定错误谎报成构造性违规)',
    (s) => s.replace('      continue;   // 绑定不成立的行不参与"同根聚合", 否则会拿垃圾根算出假的违规/假的干净', '')],
  // ⑨ V5 地址归一化
  ['地址不去 kaspatest: 前缀(同一个地址被当成两个)',
    (s) => s.replace(".replace(/^kaspatest:/, '')", '')],
  // ⑩ classify 先验绑定那一步(拆了看有没有用例守着)
  ['classify 跳过绑定校验(直接比根)',
    (s) => s.replace('if (!a.ok || !b.ok) {', 'if (false) {')],
];

let det = 0; let miss = 0; let inert = 0; let broken = 0;
try {
  for (const [name, fn] of MUTANTS) {
    const mutated = fn(original);
    if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 变异没改动文件, 这条什么也没测`); continue; }
    writeFileSync(SRC, mutated, 'utf8');
    let syntaxOk = true;
    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
    if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 它必然"检出", 什么也没证`); continue; }
    let green = true;
    try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: join(HERE, '..', '..') }); } catch { green = false; }
    if (green) { miss += 1; console.log(`[MISSED] ${name} — 闸被拆掉而用例【全绿】`); }
    else { det += 1; console.log(`[detect] ${name}`); }
  }
} finally {
  writeFileSync(SRC, original, 'utf8');
  const back = createHash('sha256').update(readFileSync(SRC, 'utf8')).digest('hex');
  console.log(back === originalSha ? '\n[restore] 逐字节还原已验(sha256 相同)' : `\n🔴🔴 [restore] 还原【对不上】! 期望 ${originalSha.slice(0,12)} 实际 ${back.slice(0,12)} —— 手工检查 ${SRC}`);
  if (back !== originalSha) process.exit(2);
}
console.log(`detected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`);
if (miss || inert || broken) process.exit(1);
