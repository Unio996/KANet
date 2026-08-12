// B-1 的**决定性验证**: 变异【真实生产调用点】`p2sh.mjs:2812`(unlockBshardRefund 里那句),
// 看指定用例会不会因正确原因变红。
//
// 判据 `3b395e6c` §4-B1 一票否决线:
//   · **变异真实调用点**(helper 不动) ⇒ 至少一个指定测试必须变红;
//   · 变异下仍全绿 ⇒ **报告该读数但【不许闭格】**(= 生产接缝无人观察);
//   · 只 grep 调用点 / 再直调 helper ⇒ 不满足。
//
// 🔴 本文件**临时改动钱路文件**(p2sh.mjs), 收尾**验 sha256 逐字节还原** —— 与我另两份 mutants 同规格。
//    还原对不上就 exit 2 并把路径打出来, 不让变异体留在库里。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || join(HERE, '..', '..', '..');
const SRC = join(ROOT, 'kasia-relay', 'src', 'lib', 'p2sh.mjs');
const TEST = join(HERE, 'u1-roundtrip-b1.test.mjs');
const CWD = join(ROOT, 'kasia-console');

const original = readFileSync(SRC, 'utf8');
const originalSha = createHash('sha256').update(original).digest('hex');

// 🔵 锚点唯一性已现查(全文件 1 处), 变异只碰 unlockBshardRefund 那一句, **不碰 helper**。
const CALLSITE = 'const newPoolAddr = _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(cmd.outputs.pool_continuation.state), networkId);';

const MUTANTS = [
  ['🔴 生产调用点传错 start(0) —— B-1 的那一格',
    (s) => s.replace(CALLSITE, CALLSITE.replace('networkId);', 'networkId, 0);'))],
  ['生产调用点传错 start(2) —— 换个错值, 排除"只对 0 敏感"',
    (s) => s.replace(CALLSITE, CALLSITE.replace('networkId);', 'networkId, 2);'))],
];

let det = 0; let miss = 0; let inert = 0; let broken = 0;
try {
  // 前置: 未变异时必须全绿, 否则下面的"红"没有意义
  let baseGreen = true;
  try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { baseGreen = false; }
  console.log(baseGreen ? '[baseline] 未变异 ⇒ 全绿 ✅' : '[baseline] 🔴 未变异就红了 —— 先修用例, 本轮变异读数无效');
  if (!baseGreen) process.exit(3);

  for (const [name, fn] of MUTANTS) {
    const mutated = fn(original);
    if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 锚点没命中, 这条什么也没测`); continue; }
    writeFileSync(SRC, mutated, 'utf8');
    let syntaxOk = true;
    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
    if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
    let green = true;
    try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
    if (green) { miss += 1; console.log(`[MISSED] ${name} — 🔴 调用点被改坏而用例【全绿】= 生产接缝无人观察 ⇒ 判据说: 报告该读数, 【不许闭格】`); }
    else { det += 1; console.log(`[detect] ${name}`); }
  }
} finally {
  writeFileSync(SRC, original, 'utf8');
  const back = createHash('sha256').update(readFileSync(SRC, 'utf8')).digest('hex');
  if (back === originalSha) console.log('\n[restore] 逐字节还原已验(sha256 相同)');
  else { console.log(`\n🔴🔴 [restore] 还原【对不上】! 手工检查 ${SRC}`); process.exit(2); }
}
console.log(`detected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`);
if (miss || inert || broken) process.exit(1);
