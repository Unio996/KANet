import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecoveryConfig, _loadRecoveryConfigWithMaxForTests, CLTV_ERR_CONFIG_OVERRIDE, planRecoveryDaa, canSubmitRecovery, assertRecoveryTxShape, RECOVERY_DAA_ENTRY } from './recovery-lock-builder.mjs';
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
  const body = SRC.slice(SRC.indexOf('export function loadRecoveryConfig'), SRC.indexOf('export function _loadRecoveryConfigWithMaxForTests'));
  assert.ok(/DELAY_SANE_MAX_DAA/.test(body) && !/raw\.max/.test(body), '生产装载口须用代码钉的 DELAY_SANE_MAX_DAA, 不读 raw.max');
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
console.log(`recovery-lock-builder: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
