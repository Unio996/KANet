// pool-market-anchor-cp4.mutants.mjs — CP4 §4 判据④/⑤ 的**决定性变异**(Codex (222)):
//   ④ 变异"命名 resolver 换成候选算 hash" ⇒ 必红
//   ⑤ 变异"省/改建市持久化" ⇒ 必红(DB/集成测试)
// 外加两条护栏变异(NULL fail-closed / MUST1 结构绑定), 证那两道闸不是摆设。
//
// 方法(照 u1-roundtrip-b1.mutants.mjs 同族): 变异**真实生产码**(pool-refund-builder.mjs / pool-market-anchor.mjs),
// 跑 pool-market-anchor-cp4.test.mjs, 看指定断言会不会因正确原因变红。收尾逐文件 sha256 还原, 对不上 exit 2。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || join(HERE, '..', '..', '..');
const BUILDER = join(HERE, 'pool-refund-builder.mjs');
const ANCHOR = join(HERE, 'pool-market-anchor.mjs');
const TEST = join(HERE, 'pool-market-anchor-cp4.test.mjs');
const CWD = join(ROOT, 'kasia-console');

const FILES = [BUILDER, ANCHOR];
const originals = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const shas = new Map(FILES.map((f) => [f, createHash('sha256').update(originals.get(f)).digest('hex')]));

const MUTANTS = [
  // ④ resolver 换成候选自算 hash —— Codex 点名的循环白验形态。正确码从库拿真锚; 变异后拿候选自己算的 ⇒
  //    rogue redeem 自洽通过 ⇒ "④ 承重" 那格(库锚=真、rogue 自洽) 必翻红。
  ['④ resolver 换成候选自算 hash(循环)', BUILDER,
    'const expectedRootTmplHashHex = getMarketRootAnchor(db, marketId);',
    'const expectedRootTmplHashHex = actualTmplHash;', 'expect-detect'],
  // ⑤a 省建市持久化(UPDATE 变 no-op) ⇒ persist 后回读为空 ⇒ "⑤ 承重" 格翻红。
  ['⑤a 省建市持久化(UPDATE no-op)', ANCHOR,
    'const res = stmt.run(anchor, marketId);',
    'const res = { changes: 0 };', 'expect-detect'],
  // ⑤b 改建市持久化(绕过结构绑定, 直接吃 rootTmplHash) ⇒ MUST1"不符即拒"格翻红。
  ['⑤b 绕过 MUST1 结构绑定校验', ANCHOR,
    'if (bakedHex !== hash) {',
    'if (false) {', 'expect-detect'],
  // ② NULL fail-closed 闸拿掉 ⇒ "② fail-closed NULL" 格翻红。
  ['② NULL fail-closed 闸拿掉', ANCHOR,
    'if (row.anchor == null) {',
    'if (false) {', 'expect-detect'],
];

// 守卫自检: 唯一性三态(AMBIG/ok/INERT)当场验(照 u1-roundtrip-b1.mutants.mjs)。
{
  const probe = (s, a) => { const h = s.split(a).length - 1; return h === 0 ? 'INERT' : h !== 1 ? 'AMBIG' : 'ok'; };
  const cases = [['xAyAz', 'A', 'AMBIG'], ['xAy', 'A', 'ok'], ['xyz', 'A', 'INERT']];
  for (const [s, a, want] of cases) {
    if (probe(s, a) !== want) { console.log(`🔴 守卫自检失败: ${JSON.stringify(s)}/${a}`); process.exit(4); }
  }
  console.log('[self-check] 唯一性守卫三态验过 ✅');
}

let det = 0; let miss = 0; let inert = 0; let broken = 0; let ambig = 0;
const surprises = [];
try {
  let baseGreen = true;
  try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { baseGreen = false; }
  console.log(baseGreen ? '[baseline] 未变异 ⇒ 全绿 ✅' : '[baseline] 🔴 未变异就红了 — 先修用例');
  if (!baseGreen) process.exit(3);

  for (const [name, file, anchor, replacement, expect] of MUTANTS) {
    const orig = originals.get(file);
    const hits = orig.split(anchor).length - 1;
    if (hits === 0) { inert += 1; console.log(`[INERT ] ${name} — 锚点 0 命中`); continue; }
    if (hits !== 1) { ambig += 1; console.log(`[AMBIG ] ${name} — 🔴 锚点 ${hits} 命中`); continue; }
    const mutated = orig.split(anchor).join(replacement);
    if (mutated === orig) { inert += 1; console.log(`[INERT ] ${name} — 替换后无变化`); continue; }
    writeFileSync(file, mutated, 'utf8');
    let outcome;
    try {
      let syntaxOk = true;
      try { execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' }); } catch { syntaxOk = false; }
      if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏`); continue; }
      let green = true;
      try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
      outcome = green ? 'MISSED' : 'detect';
      if (green) { miss += 1; console.log(`[MISSED] ${name} — 用例全绿`); }
      else { det += 1; console.log(`[detect] ${name}`); }
    } finally {
      writeFileSync(file, orig, 'utf8');
    }
    const want = expect === 'expect-detect' ? 'detect' : 'MISSED';
    if (outcome !== want) surprises.push(`${name}: 预期 ${want}, 实得 ${outcome}`);
  }
} finally {
  let restoreOk = true;
  for (const f of FILES) {
    writeFileSync(f, originals.get(f), 'utf8');
    const back = createHash('sha256').update(readFileSync(f, 'utf8')).digest('hex');
    if (back === shas.get(f)) console.log(`[restore] 逐字节还原已验(sha256 相同): ${f}`);
    else { restoreOk = false; console.log(`🔴🔴 [restore] 还原对不上! 手工检查 ${f}`); }
  }
  if (!restoreOk) process.exit(2);
}
console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}  AMBIG=${ambig}`);
if (surprises.length) { console.log('🔴 预期不符:\n  ' + surprises.join('\n  ')); process.exit(1); }
if (miss || inert || broken || ambig) process.exit(1);
console.log('✅ 四条变异全部 detected, 读数与预期一致');
