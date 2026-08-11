// ⑤ blocker① (C) 的自证。**绿不是证据,「摘掉闸能看见红」才是**(交接单 §4 判据 3)。
//
// 🔴 这件活特定的做坏方式(交接单原话): 它是往测试框架【加载期】加一道 fail-closed 闸,
//    做错**不表现为崩, 表现为把 harness 变成假绿** —— 闸自己没生效, 而所有用例照常绿。
//    ⇒ 所以本文件末尾带一段**变异**: 把闸的判据拆掉, 下面这些格子必须**当场变红**。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertContained, effectiveRelayDir, isContainmentFixture,
  redirectToFixture, FIXTURE_DIR, MARKER_NAME,
} from './containment-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER = path.join(FIXTURE_DIR, MARKER_NAME);
let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message.split('\n')[0]}`); }
};
const withEnv = (v, fn) => {
  const old = process.env.RELAY_DIR; const oldRoot = process.env.KANET_ROOT;
  if (v === undefined) delete process.env.RELAY_DIR; else process.env.RELAY_DIR = v;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.RELAY_DIR; else process.env.RELAY_DIR = old;
    if (oldRoot === undefined) delete process.env.KANET_ROOT; else process.env.KANET_ROOT = oldRoot;
  }
};

t('① 指向假体 ⇒ 放行', () => {
  withEnv(FIXTURE_DIR, () => assertContained('selfproof-①'));
});

t('② 指向一个真目录 ⇒ 必抛', () => {
  withEnv(path.resolve(HERE, '../..'), () => {
    assert.throws(() => assertContained('selfproof-②'), /遏制不成立/);
  });
});

// 🔴 这一格是交接单陷阱二的直接体现: env 未设【不是】"没有遏制", 是"遏制指向了真 relay"。
//    判「env 空不空」的实现会在这一格放行, 因此这一格是那种实现与本实现的分界线。
t('③ RELAY_DIR 未设 ⇒ 必抛(fallback 是真目录, 不是"没有遏制")', () => {
  withEnv(undefined, () => {
    process.env.KANET_ROOT = 'D:/some-real-root';
    assert.throws(() => assertContained('selfproof-③'), /遏制不成立/);
  });
});

t('④ 报错里必须带调用点(否则"报错了"和"报错在哪"读数相同)', () => {
  withEnv(path.resolve(HERE, '../..'), () => {
    assert.throws(() => assertContained('某个特定调用点'), /某个特定调用点/);
  });
});

t('⑤ 不带调用点调用本身即拒', () => {
  assert.throws(() => assertContained(), /必须带调用点标识/);
});

t('⑥ 显式豁免放行, 但必须吵(横幅进 stderr)', () => {
  const old = process.env.KANET_ALLOW_REAL_RELAY;
  const errs = []; const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    process.env.KANET_ALLOW_REAL_RELAY = '1';
    withEnv(path.resolve(HERE, '../..'), () => assertContained('selfproof-⑥'));
  } finally {
    console.error = orig;
    if (old === undefined) delete process.env.KANET_ALLOW_REAL_RELAY; else process.env.KANET_ALLOW_REAL_RELAY = old;
  }
  assert.ok(errs.join('\n').includes('遏制已被显式豁免'), '豁免必须打横幅, 静默豁免与闸不存在同形');
});

// 🔴 判据用【定义】不用【它通常长什么样】: 把标记移走, 同一个目录立刻不再算假体。
t('⑦ 把假体的标记移走 ⇒ 同一目录不再算假体(判的是标记不是路径名)', () => {
  const body = fs.readFileSync(MARKER);
  fs.rmSync(MARKER);
  try {
    assert.strictEqual(isContainmentFixture(FIXTURE_DIR), false, '标记没了还认它作假体 ⇒ 判据其实是路径名');
    withEnv(FIXTURE_DIR, () => assert.throws(() => assertContained('selfproof-⑦'), /遏制不成立/));
    assert.throws(() => redirectToFixture(), /假体自己没有标记文件/);
  } finally { fs.writeFileSync(MARKER, body); }
});

t('⑧ 生效值必须与 relay-manager 的算法一致(逐字复刻那两行)', () => {
  const src = fs.readFileSync(path.resolve(HERE, '../../src/services/relay-manager.js'), 'utf8');
  assert.ok(src.includes("process.env.KANET_ROOT || 'D:/Anthropic'"), 'relay-manager 的 KANET_ROOT 行变了 ⇒ 本闸的复刻已过期');
  assert.ok(src.includes('process.env.RELAY_DIR ||'), 'relay-manager 的 RELAY_DIR 行变了 ⇒ 本闸的复刻已过期');
  withEnv(undefined, () => {
    process.env.KANET_ROOT = 'D:/xyz';
    assert.strictEqual(effectiveRelayDir(), path.resolve('D:/xyz/kasia-relay'));
  });
});

// ── 🔴 harness 级实证:闸到底在哪一层咬人 ─────────────────────────────────────
// 我第一版把这一格写成「跑测时 RELAY_DIR=真目录 ⇒ 整个跑必须拒绝」,**它没红**,
// 而当时我差点把那个绿当成通过。没红的原因是**设计使然**:bootstrap 无条件
// `redirectToFixture()` 把 RELAY_DIR 覆盖成假体(全量重定向 = Codex 原话),
// ⇒ 在 bootstrap 那一层遏制**不可能缺失**, 那道断言在那里是装饰。
// 🔨 所以这一格必须问对问题:**强制覆盖够不到的地方在哪?** = 用例在【自己的模块加载期】改走。
//    下面这一格造一个真会那么干的用例, 跑真 runner, 断言它**当场被拒**。
t('⑨ 用例在加载期把 RELAY_DIR 改到真目录 ⇒ 整个跑必须被拒(这才是闸真正咬人的地方)', () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'containment-'));
  const bad = path.join(tmp, 'evil_redirect.test.mjs');
  fs.writeFileSync(bad, [
    "import path from 'node:path';",
    // 模块加载期改走 —— 正是交接单陷阱一描述的那件事
    "process.env.RELAY_DIR = path.resolve('D:/kanet/kanet/kasia-relay');",
    'export default { id: "evil_redirect", steps: [] };',
  ].join('\n'), 'utf8');
  let out = ''; let code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/test.mjs', `--case=${bad}`],
      { cwd: path.resolve(HERE, '../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.ok(/遏制不成立/.test(out), `期望被遏制闸拒绝, 实际输出:\n${out.slice(0, 600)}`);
  assert.ok(/case:evil_redirect/.test(out), '报错必须点名是哪个用例改走的');
  assert.notStrictEqual(code, 0, '被拒时退出码不能是 0(否则 CI/人眼都看不出来)');
});

// ── 变异: 把闸的判据拆掉, 上面那些格子必须当场变红 ──────────────────────────────
const SRC = path.join(HERE, 'containment-guard.mjs');
const MUTANTS = [
  ['判据退化成「env 空不空」(陷阱二那种实现)',
    (s) => s.replace('  const dir = effectiveRelayDir();\n  if (isContainmentFixture(dir)) return;',
      '  if (process.env.RELAY_DIR) return;')],
  ['标记检查恒真(判据变成路径名/什么都不判)',
    (s) => s.replace('try { return fs.existsSync(path.join(dir, MARKER_NAME)); } catch { return false; }', 'return true;')],
  ['不抛改成返回(返回值会被人忘记检查)',
    (s) => s.replace('  throw new Error(\n    `[containment] 遏制不成立', '  return false; // eslint-disable-line\n  throw new Error(\n    `[containment] 遏制不成立')],
  ['豁免不打横幅(静默豁免)',
    (s) => s.replace('    console.error(\n      `\\n🔴🔴 [containment] 遏制已被显式豁免', '    void 0 && console.error(\n      `\\n🔴🔴 [containment] 遏制已被显式豁免')],
];
if (process.env.CONTAINMENT_SELFPROOF_MUTATE === '1') {
  console.log('\n(变异模式: 只报每个变异体下用例红没红)');
} else {
  const original = fs.readFileSync(SRC, 'utf8');
  let det = 0; let miss = 0; let broken = 0;
  for (const [name, fn] of MUTANTS) {
    const mutated = fn(original);
    if (mutated === original) { miss += 1; console.log(`[INERT ] ${name} — 变异没改动文件`); continue; }
    fs.writeFileSync(SRC, mutated, 'utf8');
    let syntaxOk = true;
    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
    if (!syntaxOk) { broken += 1; fs.writeFileSync(SRC, original, 'utf8'); console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
    let green = true;
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)],
        { stdio: 'ignore', env: { ...process.env, CONTAINMENT_SELFPROOF_MUTATE: '1' } });
    } catch { green = false; }
    fs.writeFileSync(SRC, original, 'utf8');
    if (green) { miss += 1; console.log(`[MISSED] ${name} — 判据被拆掉而自证【全绿】`); }
    else { det += 1; console.log(`[detect] ${name}`); }
  }
  console.log('');
  console.log(`mutants: detected=${det}  MISSED/INERT=${miss}  BROKEN=${broken}`);
  if (miss || broken) { console.log('result: 变异未全检出 ⇒ 这道闸与不存在在读数上同形'); process.exit(1); }
}

console.log('');
console.log(`result: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
