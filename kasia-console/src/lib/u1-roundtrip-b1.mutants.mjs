// B-1 的**决定性验证**(post-Fix 版): 变异【真实生产码】, 看指定用例会不会因正确原因变红。
//
// 🔴 pre-Fix 版只变异 relay 调用点, 只能证"这参数敏感"。CP2-rev 之后, **权威产生步搬到了 builder**
//    (`pool-refund-builder.mjs`: 从模板前缀派生 + 验前缀确属这份 redeem)。Codex ⑦ 要的决定性变异
//    打的是**那一步**, 所以本文件从单文件改成**双文件**变异, 并新增 builder 侧锚点。
//
// 判据 `3b395e6c` §4-B1 一票否决线:
//   · **变异真实生产码**(helper 不动) ⇒ 至少一个指定测试必须变红;
//   · 变异下仍全绿 ⇒ **报告该读数但【不许闭格】**(= 生产接缝无人观察);
//   · 只 grep 调用点 / 再直调 helper ⇒ 不满足。
//
// 🔴 本文件**临时改动钱路文件**(p2sh.mjs / pool-refund-builder.mjs), 收尾**逐文件验 sha256 还原**。
//    还原对不上就 exit 2 并把路径打出来, 不让变异体留在库里。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || join(HERE, '..', '..', '..');
const RELAY = join(ROOT, 'kasia-relay', 'src', 'lib', 'p2sh.mjs');
const BUILDER = join(HERE, 'pool-refund-builder.mjs');
const TEST = join(HERE, 'u1-roundtrip-b1.test.mjs');
const CWD = join(ROOT, 'kasia-console');

const FILES = [RELAY, BUILDER];
const originals = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const shas = new Map(FILES.map((f) => [f, createHash('sha256').update(originals.get(f)).digest('hex')]));

// 🔵 每条锚点的**唯一性**由下方 `hits !== 1 ⇒ AMBIG` 现场兜底。
// 🔴 这半句以前写的是"由 INERT/多命中检查兜底"——**多命中检查当时并不存在**(@J1tn 19:50Z push-back)：
//    `s.replace(字符串锚)` **只换第一处**, 多命中时 `mutated !== orig` 照样成立 ⇒ INERT 永远抓不到,
//    变异会**静默打到错位置**而读数看着正常。同族"注释不是闸"。现在按它宣称的把守卫补上, 不是删注释。
// 🔵 形状换成 [名, 文件, **锚点**, 替换文本, 预期] —— 不再是闭包:
//    闭包把锚点藏在 `.replace()` 里, **外面数不出它命中几次**, 这正是上面那道守卫补不上的原因。
const MUTANTS = [
  // ── 权威产生步(builder) —— CP2-rev 新增的那一层 ─────────────────────────────
  ['权威步: builder 不再从前缀派生, 改回常量', BUILDER,
    'const poolStateStart = poolTemplatePrefixHex.length / 2;',
    'const poolStateStart = POOLROOT_STATE_START;', 'expect-MISSED-structural'],
  ['权威步: 拆掉"前缀必须确属这份 redeem"的绑定检查', BUILDER,
    '!poolRedeemHex.toLowerCase().startsWith(poolTemplatePrefixHex.toLowerCase())',
    'false', 'expect-detect'],
  ['权威步: builder 不把 state_start 写进命令', BUILDER,
    '        state_start: poolStateStart,\n', '', 'expect-detect'],
  // ── 传播 + 消费(relay) ────────────────────────────────────────────────────
  ['传播: relay 忽略命令值, 回落默认', RELAY,
    'networkId, Number(poolStateStart));', 'networkId);', 'expect-MISSED-structural'],
  ['传播: relay 篡改消费值(+1)', RELAY,
    'networkId, Number(poolStateStart));', 'networkId, Number(poolStateStart) + 1);', 'expect-detect'],
  ['闸: 缺失/null 不再抛', RELAY,
    'if (poolStateStart == null) {', 'if (false) {', 'expect-detect'],
  ['闸: 族不符不再抛', RELAY,
    'if (Number(poolStateStart) !== _POOL_STATE_START) {', 'if (false) {', 'expect-detect'],
];

// 🔵 **守卫自检**: 一道没人见它响过的闸, 与没有这道闸在读数上一模一样(这正是被 push-back 的那半句
//    注释的病)。用合成串当场证明分类逻辑会响, 再去跑真锚点。
{
  const probe = (s, a) => { const h = s.split(a).length - 1; return h === 0 ? 'INERT' : h !== 1 ? 'AMBIG' : 'ok'; };
  const cases = [['xAyAz', 'A', 'AMBIG'], ['xAy', 'A', 'ok'], ['xyz', 'A', 'INERT']];
  for (const [s, a, want] of cases) {
    const got = probe(s, a);
    if (got !== want) { console.log(`🔴 守卫自检失败: ${JSON.stringify(s)}/${a} 预期 ${want} 实得 ${got}`); process.exit(4); }
  }
  console.log('[self-check] 唯一性守卫三态(AMBIG/ok/INERT)当场验过 ✅');
}

let det = 0; let miss = 0; let inert = 0; let broken = 0; let ambig = 0;
const surprises = [];
try {
  let baseGreen = true;
  try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { baseGreen = false; }
  console.log(baseGreen ? '[baseline] 未变异 ⇒ 全绿 ✅' : '[baseline] 🔴 未变异就红了 —— 先修用例, 本轮变异读数无效');
  if (!baseGreen) process.exit(3);

  for (const [name, file, anchor, replacement, expect] of MUTANTS) {
    const orig = originals.get(file);
    // 🔴 唯一性守卫(@J1tn 19:50Z push-back 补): `replace(字符串)` 只换第一处 ⇒ 锚点多命中时
    //    变异**静默打到错位置**, 而 `mutated !== orig` 仍成立 ⇒ INERT 抓不到, 读数看着完全正常。
    //    ⇒ 命中数必须 **恰为 1**; 0 走 INERT(什么也没测), ≥2 走 AMBIG(打的位置不确定, 读数无效)。
    const hits = orig.split(anchor).length - 1;
    if (hits === 0) { inert += 1; console.log(`[INERT ] ${name} — 锚点 0 命中, 这条什么也没测`); continue; }
    if (hits !== 1) { ambig += 1; console.log(`[AMBIG ] ${name} — 🔴 锚点 ${hits} 命中, 变异会打到不确定的位置 ⇒ 本条读数无效`); continue; }
    const mutated = orig.split(anchor).join(replacement);
    if (mutated === orig) { inert += 1; console.log(`[INERT ] ${name} — 替换后无变化, 这条什么也没测`); continue; }
    writeFileSync(file, mutated, 'utf8');
    let outcome;
    try {
      let syntaxOk = true;
      try { execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' }); } catch { syntaxOk = false; }
      if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
      let green = true;
      try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
      outcome = green ? 'MISSED' : 'detect';
      if (green) { miss += 1; console.log(`[MISSED] ${name} — 用例全绿`); }
      else { det += 1; console.log(`[detect] ${name}`); }
    } finally {
      writeFileSync(file, orig, 'utf8');   // 每条即刻还原, 不让两条变异叠加
    }
    // 🔴 预期与读数不符 ⇒ 单独喊出来: "MISSED 数字对得上"不等于"MISSED 的是同一批"
    const want = expect === 'expect-detect' ? 'detect' : 'MISSED';
    if (outcome !== want) surprises.push(`${name}: 预期 ${want}, 实得 ${outcome}`);
  }
} finally {
  let restoreOk = true;
  for (const f of FILES) {
    writeFileSync(f, originals.get(f), 'utf8');
    const back = createHash('sha256').update(readFileSync(f, 'utf8')).digest('hex');
    if (back === shas.get(f)) console.log(`[restore] 逐字节还原已验(sha256 相同): ${f}`);
    else { restoreOk = false; console.log(`🔴🔴 [restore] 还原【对不上】! 手工检查 ${f}`); }
  }
  if (!restoreOk) process.exit(2);
}
console.log(`\ndetected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}  AMBIG=${ambig}`);
// 🔴 结构性 MISSED (2 条) 是**已知且已上报**的残余, 不是本轮新发现:
//    ① builder 改回常量 / ② relay 回落默认 —— 两者在**权威值恰好等于默认值(1)** 时行为不可分。
//    要让它们变红, 需要一条 start≠1 的真实 typed 路径(RootClaim 单-entry 那族)进 B-1, 现无夹具。
//    ⇒ 判据说: **报告该读数, 不许据此闭格**。
if (surprises.length) { console.log('🔴 预期不符:\n  ' + surprises.join('\n  ')); process.exit(1); }
if (inert || broken || ambig) process.exit(1);
console.log(miss === 2 ? '✅ 读数与预期一致(含 2 条【已上报的结构性 MISSED】—— 不构成闭合)' : '');
