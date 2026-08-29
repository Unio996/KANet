import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecoveryConfig, CLTV_ERR_CONFIG_OVERRIDE, planRecoveryDaa, canSubmitRecovery, assertRecoveryTxShape, RECOVERY_DAA_ENTRY } from './recovery-lock-builder.mjs';
import { _loadRecoveryConfigWithMaxForTests } from './recovery-lock-builder.testonly.mjs';   // test-only 变体已搬出生产模块 (NWT 8/29 only-path)
import * as _cp from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { CltvError, CLTV_ERR, DELAY_SANE_MAX_DAA, LOCK_TIME_THRESHOLD, MAX_TX_IN_SEQUENCE_NUM } from './cltv-locktime.mjs';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const throwsCode = (fn, code) => { try { fn(); } catch (e) { assert.ok(e instanceof CltvError, 'not CltvError: ' + e.message); assert.strictEqual(e.code, code); return; } throw new Error('did not throw'); };
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'recovery-lock-builder.mjs'), 'utf8');

// 审点②: 恢复路绝不 import test-only 零延迟入口; 审点①: 装载处调 assertPositiveDelay (源级钉死, 防日后改掉)
t('G0 源级: 不含 _cltvLockTimeAllowZeroForTests; loadRecoveryConfig 内调 assertPositiveDelay', () => {
  // 只看 import 语句 (头注释提到这个名字是为了说明"禁用", 不算); 任何 import/动态 import/解构里出现 = 红
  const importish = SRC.split('\n').filter((l) => /^\s*import\b|\bimport\(|\brequire\(/.test(l)).join('\n');
  assert.ok(!importish.includes('_cltvLockTimeAllowZeroForTests'), '恢复路 import 了 test-only 零延迟入口');
  const code = SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // 去掉整行注释后再查调用 (头注释里 "…ForTests(本文件…" 会误中)
  assert.ok(!/\b_cltvLockTimeAllowZeroForTests\b/.test(code), '恢复路代码里出现了 test-only 零延迟入口');
  const body = SRC.slice(SRC.indexOf('export function loadRecoveryConfig'), SRC.indexOf('const toBig'));
  assert.ok(/assertPositiveDelay\(/.test(body), 'loadRecoveryConfig(含其 impl) 没调 assertPositiveDelay');
  assert.ok(!/raw\.entry/.test(SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), '代码里不得读 raw.entry (Codex A)');
  // Codex 418fffbd + NWT 8/29 only-path: 两个生产模块去整行注释后不得含任何 *ForTests 符号 (定义也不许 —— surface 直接不存在)
  const noComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const CLTV_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cltv-locktime.mjs'), 'utf8');
  assert.ok(!/ForTests/.test(noComments(SRC)), 'recovery-lock-builder.mjs 生产代码含 ForTests 符号');
  assert.ok(!/ForTests/.test(noComments(CLTV_SRC)), 'cltv-locktime.mjs 生产代码含 ForTests 符号');
  assert.ok(!/allowZero/.test(noComments(CLTV_SRC)), 'cltv-locktime.mjs 不得残留 allowZero 分支');
});
t('C1 loadRecoveryConfig: n=100 ok(bigint, frozen, entry 3); 字符串 "100" ok', () => { const c = loadRecoveryConfig({ n_recovery_delay_daa: 100 }); assert.strictEqual(c.nDelayDaa, 100n); assert.ok(Object.isFrozen(c)); assert.strictEqual(c.entry, RECOVERY_DAA_ENTRY); assert.strictEqual(loadRecoveryConfig({ n_recovery_delay_daa: '100' }).nDelayDaa, 100n); });
t('C2 loadRecoveryConfig 拒: 0 / −1 / 缺 / null / 1e7(sane-max) / 5e11 / 非整数 / entry 非法', () => {
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 0 }), CLTV_ERR.DELAY_NONPOSITIVE);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: -1n }), CLTV_ERR.DELAY_NONPOSITIVE);
  throwsCode(() => loadRecoveryConfig({}), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: null }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => loadRecoveryConfig(), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: DELAY_SANE_MAX_DAA }), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: LOCK_TIME_THRESHOLD }), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 1.5 }), CLTV_ERR.ARGS_MISSING);
});
t('C3 (Codex A) raw 含 entry ⇒ 拒 CLTV_CONFIG_OVERRIDE_FORBIDDEN, 哪怕是另一个合法整数 2 / 等于默认的 3 / null; 且分支不变: 合法 cfg 的 entry 恒 = RECOVERY_DAA_ENTRY(3)', () => {
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 100, entry: 2 }), CLTV_ERR_CONFIG_OVERRIDE);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 100, entry: 3 }), CLTV_ERR_CONFIG_OVERRIDE);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 100, entry: null }), CLTV_ERR_CONFIG_OVERRIDE);
  const c = loadRecoveryConfig({ n_recovery_delay_daa: 100 }); assert.strictEqual(c.entry, RECOVERY_DAA_ENTRY); assert.strictEqual(planRecoveryDaa(c, { successorDaa: 1n }).sigPushesPrefix[1], 3);
});
t('C4 (Codex B) raw 含 max ⇒ 拒 CLTV_CONFIG_OVERRIDE_FORBIDDEN: {n:5e8, max:1e9} 不能放过 (n=5e8 ≥ 1e7); {n:100, max:1e9} 也拒(有 key 即拒); 单独 n=5e8 ⇒ DOMAIN_MIXED', () => {
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 500_000_000, max: 1_000_000_000 }), CLTV_ERR_CONFIG_OVERRIDE);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 100, max: 1_000_000_000 }), CLTV_ERR_CONFIG_OVERRIDE);
  throwsCode(() => loadRecoveryConfig({ n_recovery_delay_daa: 500_000_000 }), CLTV_ERR.DOMAIN_MIXED);
});
t('C5 test-only _loadRecoveryConfigWithMaxForTests(raw, 1000): 999 ok / 1000 拒; 它同样拒 raw 里的 max/entry; 生产 loadRecoveryConfig 源里不调它', () => {
  assert.strictEqual(_loadRecoveryConfigWithMaxForTests({ n_recovery_delay_daa: 999 }, 1000).nDelayDaa, 999n);
  throwsCode(() => _loadRecoveryConfigWithMaxForTests({ n_recovery_delay_daa: 1000 }, 1000), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => _loadRecoveryConfigWithMaxForTests({ n_recovery_delay_daa: 5, max: 9 }, 1000), CLTV_ERR_CONFIG_OVERRIDE);
  const body = SRC.slice(SRC.indexOf('export function loadRecoveryConfig'), SRC.indexOf('const toBig'));
  assert.ok(/DELAY_SANE_MAX_DAA/.test(body) && !/raw\.max/.test(body), '生产装载口须用代码钉的 DELAY_SANE_MAX_DAA, 不读 raw.max');
  assert.strictEqual(_loadRecoveryConfigWithMaxForTests({ n_recovery_delay_daa: 999 }, 1000)._unbranded_testonly, true, 'testonly 变体不带 BRAND');
  throwsCode(() => planRecoveryDaa(_loadRecoveryConfigWithMaxForTests({ n_recovery_delay_daa: 999 }, 1000), { successorDaa: 1n }), CLTV_ERR.ARGS_MISSING);   // only-path: 自定 max 的 cfg 在生产路不可用
});
const cfg = loadRecoveryConfig({ n_recovery_delay_daa: 100 });
t('P1 planRecoveryDaa 镜像探针 P: d=80,000,000, n=100 ⇒ E=lockTime=80,000,100 (<5e11), sequence 0n, sigPushes [0,3], earliest tip = E+1', () => {
  const p = planRecoveryDaa(cfg, { successorDaa: 80_000_000n });
  assert.strictEqual(p.E, 80_000_100n); assert.strictEqual(p.lockTime, 80_000_100n); assert.strictEqual(p.sequence, 0n);
  assert.deepStrictEqual(p.sigPushesPrefix, [0, 3]); assert.strictEqual(p.earliestSubmitTipDaa, 80_000_101n); assert.ok(Object.isFrozen(p)); assert.ok(!('sigPushes' in p), '旧字段名不得残留');
});
t('P2 planRecoveryDaa 拒: 手造 cfg(非 frozen) / cfg.nDelayDaa 非 bigint / successorDaa 缺 / 负 / ≥5e11 / 非整数 / sequence MAX / selfInputIndex 非法', () => {
  throwsCode(() => planRecoveryDaa({ nDelayDaa: 100n, entry: 3 }, { successorDaa: 1n }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => planRecoveryDaa(Object.freeze({ nDelayDaa: 100, entry: 3 }), { successorDaa: 1n }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => planRecoveryDaa(cfg, {}), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => planRecoveryDaa(cfg, { successorDaa: -1n }), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => planRecoveryDaa(cfg, { successorDaa: LOCK_TIME_THRESHOLD }), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => planRecoveryDaa(cfg, { successorDaa: 'x' }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => planRecoveryDaa(cfg, { successorDaa: 1n, sequence: MAX_TX_IN_SEQUENCE_NUM }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => planRecoveryDaa(cfg, { successorDaa: 1n, selfInputIndex: -1 }), CLTV_ERR.ARGS_MISSING);
});
t('P2-brand (NWT fix-up ①) 出处品牌: (a) 手造 frozen {nDelayDaa:0n, entry:3} ⇒ 拒 (绕过 assertPositiveDelay 的零延迟); (b) {...realCfg} spread 拷贝 ⇒ 拒 (WeakSet 认引用, Symbol 标记会被 spread 带走); (c) 真 cfg 本身 ⇒ 过', () => {
  const forged = Object.freeze({ nDelayDaa: 0n, entry: 3 });
  assert.ok(Object.isFrozen(forged) && typeof forged.nDelayDaa === 'bigint', '向量前提: 形状与真 cfg 一样, 只差出处');
  throwsCode(() => planRecoveryDaa(forged, { successorDaa: 1n }), CLTV_ERR.ARGS_MISSING);
  const copy = Object.freeze({ ...cfg });
  assert.deepStrictEqual(copy, { nDelayDaa: 100n, entry: 3 }, '向量前提: spread 拷贝内容完全相同');
  throwsCode(() => planRecoveryDaa(copy, { successorDaa: 1n }), CLTV_ERR.ARGS_MISSING);
  assert.strictEqual(planRecoveryDaa(cfg, { successorDaa: 1n }).E, 101n);
});
t('P3 域边界: d = 5e11−101, n=100 ⇒ E = 5e11−1 ok; d = 5e11−100 ⇒ E = 5e11 ⇒ DOMAIN_MIXED (溢出到时间域, 不静默)', () => {
  assert.strictEqual(planRecoveryDaa(cfg, { successorDaa: LOCK_TIME_THRESHOLD - 101n }).E, LOCK_TIME_THRESHOLD - 1n);
  throwsCode(() => planRecoveryDaa(cfg, { successorDaa: LOCK_TIME_THRESHOLD - 100n }), CLTV_ERR.DOMAIN_MIXED);
});
const plan = planRecoveryDaa(cfg, { successorDaa: 80_000_000n });
t('S1 canSubmitRecovery (N8): tip == E ⇒ false; tip == E+1 ⇒ true; tip < E ⇒ false', () => { assert.strictEqual(canSubmitRecovery(plan, plan.E), false); assert.strictEqual(canSubmitRecovery(plan, plan.E + 1n), true); assert.strictEqual(canSubmitRecovery(plan, plan.E - 5n), false); assert.strictEqual(canSubmitRecovery(plan, Number(plan.E) + 1), true); });
const good = { lockTime: 80_000_100n, inputs: [{ sequence: 0n }], outputs: [{ value: 1n }] };
t('T1 assertRecoveryTxShape: 正形 ok (bigint 与 string 字段皆可)', () => { assert.strictEqual(assertRecoveryTxShape(plan, good), true); assert.strictEqual(assertRecoveryTxShape(plan, { lockTime: '80000100', inputs: [{ sequence: '0' }], outputs: [{}] }), true); });
t('T2 assertRecoveryTxShape 拒 N6/N7/N9/续 covenant/空输出: lockTime E−1 / 时间量级 / sequence MAX / outputs 带 covenant / outputs []', () => {
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, lockTime: 80_000_099n }), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, lockTime: LOCK_TIME_THRESHOLD + 1n }), CLTV_ERR.DOMAIN_MIXED);
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, inputs: [{ sequence: MAX_TX_IN_SEQUENCE_NUM }] }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, inputs: [{ sequence: 7n }] }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, outputs: [{ value: 1n, covenant: { id: 'x' } }] }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, outputs: [] }), CLTV_ERR.ARGS_MISSING);
  throwsCode(() => assertRecoveryTxShape(plan, { ...good, inputs: [] }), CLTV_ERR.ARGS_MISSING);
});
// ── Codex 418fffbd wiring-time 要求 (Bettor GO 8/29): _loadRecoveryConfigWithMaxForTests 从生产模块导出, "test-only" 只是命名 ⇒ 机械 import-surface guard ──
// 走 spawn 跑 scripts/lint-kanet.mjs (不 import 它: 顶层自执行 = import 即执行, 同 runner 那条坑) 的 R-TESTONLY-EXPORT-IN-PROD; 阳性对照证规则真活。
t('G1 import-surface guard: lint R-TESTONLY-EXPORT-IN-PROD 对 kasia-relay/src/lib 两生产文件 + kasia-console/src/lib 生产 .mjs = 0 命中; 阳性对照 (scratch 临时文件 import _loadRecoveryConfigWithMaxForTests) 必报 1; 跑完删', () => {
  const { spawnSync } = _cp;
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const lint = join(ROOT, 'scripts', 'lint-kanet.mjs');
  assert.ok(existsSync(lint), 'scripts/lint-kanet.mjs 不在');
  const prodFiles = [join(ROOT, 'kasia-relay', 'src', 'lib', 'cltv-locktime.mjs'), join(ROOT, 'kasia-relay', 'src', 'lib', 'recovery-lock-builder.mjs')];
  const consoleLib = join(ROOT, 'kasia-console', 'src', 'lib');
  if (existsSync(consoleLib)) for (const f of readdirSync(consoleLib)) if (/\.(m?js)$/.test(f) && !/\.test\.m?js$/.test(f)) prodFiles.push(join(consoleLib, f));
  const hits = (out) => { const m = String(out).match(/R-TESTONLY-EXPORT-IN-PROD: (\d+) hit/); return m ? Number(m[1]) : 0; };
  const r0 = spawnSync(process.execPath, [lint, ...prodFiles], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.ok(/\[lint-kanet\]/.test(r0.stdout + r0.stderr), 'lint 没跑起来: ' + (r0.stderr || '').slice(0, 200));
  assert.strictEqual(hits(r0.stdout + r0.stderr), 0, `生产文件里出现 test-only 引用: ${(r0.stdout || '').split('\n').filter((l) => /ForTests/.test(l)).join(' | ').slice(0, 300)}`);
  // 阳性对照 (证规则真活, 非 vacuous): scratch 临时生产形文件 import test-only 导出 ⇒ 必报 1
  const posDir = join(ROOT, 'scratch', '_j2_testonly_guard_pos'); mkdirSync(posDir, { recursive: true });
  const posFile = join(posDir, 'positive_control.mjs');
  writeFileSync(posFile, "import { _loadRecoveryConfigWithMaxForTests } from '../../kasia-relay/src/lib/recovery-lock-builder.mjs';\nexport const cfg = 1;\n");   // 单行引用 ⇒ 恰 1 命中
  try {
    const r1 = spawnSync(process.execPath, [lint, posFile], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(hits(r1.stdout + r1.stderr), 1, '阳性对照未被报 = 规则死/未接线');
    assert.ok(/positive_control\.mjs:1:\d+/.test(r1.stdout + r1.stderr), '须报 文件:行:列');
  } finally { try { unlinkSync(posFile); } catch {} try { rmdirSync(posDir); } catch {} }
});
console.log(`recovery-lock-builder: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
