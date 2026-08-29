import assert from 'node:assert';
import { cltvLockTime, _cltvLockTimeAllowZeroForTests, cltvSequence, assertPositiveDelay, DELAY_SANE_MAX_DAA, classifyLockReject, CltvError, CLTV_ERR, LOCK_TIME_THRESHOLD, TIME_DOMAIN_UPPER, MAX_TX_IN_SEQUENCE_NUM } from './cltv-locktime.mjs';
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const throwsCode = (fn, code) => { try { fn(); } catch (e) { assert.ok(e instanceof CltvError, 'not CltvError'); assert.strictEqual(e.code, code); return; } throw new Error('did not throw'); };
const T = LOCK_TIME_THRESHOLD;

t('D0 daa 下界 0: 生产 API 一律 REJECT (Codex ④ 零延迟=无锁; 传 allowZero:true 也不放); test-only _cltvLockTimeAllowZeroForTests 才 ok', () => { throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [0n] }), CLTV_ERR.DELAY_NONPOSITIVE); throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [0n], allowZero: true }), CLTV_ERR.DELAY_NONPOSITIVE); assert.strictEqual(_cltvLockTimeAllowZeroForTests({ domain: 'daa', bounds: [0n] }), 0n); });
t('D1 daa 单输入 ⇒ 原值', () => assert.strictEqual(cltvLockTime({ domain: 'daa', bounds: [80_000_100n] }), 80_000_100n));
t('D2 daa 多输入 ⇒ max', () => assert.strictEqual(cltvLockTime({ domain: 'daa', bounds: [5n, 80_000_100n, 77n] }), 80_000_100n));
t('D3 daa 边界 5e11-1 ⇒ ok; 5e11 ⇒ DOMAIN_MIXED', () => { assert.strictEqual(cltvLockTime({ domain: 'daa', bounds: [T - 1n] }), T - 1n); throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [T] }), CLTV_ERR.DOMAIN_MIXED); });
t('D4 daa 负值 ⇒ DOMAIN_MIXED', () => throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [-1n] }), CLTV_ERR.DOMAIN_MIXED));
t('D5 daa 混入 time 量级 ⇒ DOMAIN_MIXED (不静默取 max)', () => throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [80_000_100n, T + 5n] }), CLTV_ERR.DOMAIN_MIXED));
t('T1 time 边界 5e11 ⇒ ok; 5e11-1 ⇒ DOMAIN_MIXED', () => { assert.strictEqual(cltvLockTime({ domain: 'time', bounds: [T] }), T); throwsCode(() => cltvLockTime({ domain: 'time', bounds: [T - 1n] }), CLTV_ERR.DOMAIN_MIXED); });
t('T2 time 上界 2^63-1 ⇒ ok; 2^63 ⇒ DOMAIN_MIXED (Bettor 附加: 对称上界)', () => { assert.strictEqual(cltvLockTime({ domain: 'time', bounds: [TIME_DOMAIN_UPPER - 1n] }), TIME_DOMAIN_UPPER - 1n); throwsCode(() => cltvLockTime({ domain: 'time', bounds: [TIME_DOMAIN_UPPER] }), CLTV_ERR.DOMAIN_MIXED); });
t('T3 time 多输入 ⇒ max', () => assert.strictEqual(cltvLockTime({ domain: 'time', bounds: [T + 10n, T + 3n] }), T + 10n));
t('A1 空数组 ⇒ BOUNDS_EMPTY (不回落 0n)', () => throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [] }), CLTV_ERR.BOUNDS_EMPTY));
t('A2 缺 domain / 错 domain / 缺 opts / bounds 非数组 ⇒ ARGS_MISSING', () => { throwsCode(() => cltvLockTime({ bounds: [1n] }), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvLockTime({ domain: 'ms', bounds: [1n] }), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvLockTime(), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvLockTime({ domain: 'daa', bounds: 5n }), CLTV_ERR.ARGS_MISSING); });
t('A3 number 安全整数可用; 非安全/非整数 ⇒ ARGS_MISSING', () => { assert.strictEqual(cltvLockTime({ domain: 'daa', bounds: [80000100] }), 80_000_100n); throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [1.5] }), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvLockTime({ domain: 'daa', bounds: ['7'] }), CLTV_ERR.ARGS_MISSING); });
t('S1 sequence 默认 0n; MAX ⇒ throw; 负 ⇒ throw', () => { assert.strictEqual(cltvSequence(), 0n); assert.strictEqual(cltvSequence(5), 5n); throwsCode(() => cltvSequence(MAX_TX_IN_SEQUENCE_NUM), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvSequence(-1n), CLTV_ERR.ARGS_MISSING); });
t('S2 (Codex ③) sequence 上界闭: MAX−1 PASS / MAX REJECT / MAX+1 REJECT / 2^70 REJECT / 非整数 REJECT', () => { assert.strictEqual(cltvSequence(MAX_TX_IN_SEQUENCE_NUM - 1n), MAX_TX_IN_SEQUENCE_NUM - 1n); throwsCode(() => cltvSequence(MAX_TX_IN_SEQUENCE_NUM), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvSequence(MAX_TX_IN_SEQUENCE_NUM + 1n), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvSequence(1n << 70n), CLTV_ERR.ARGS_MISSING); throwsCode(() => cltvSequence('x'), CLTV_ERR.ARGS_MISSING); });
t('Z1 (Codex ④) daa 域 E=0 REJECT(CLTV_DELAY_NONPOSITIVE); 多输入含 0 也拒; E=1 ok', () => { throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [0n] }), CLTV_ERR.DELAY_NONPOSITIVE); throwsCode(() => cltvLockTime({ domain: 'daa', bounds: [5n, 0n] }), CLTV_ERR.DELAY_NONPOSITIVE); assert.strictEqual(cltvLockTime({ domain: 'daa', bounds: [1n] }), 1n); });
t('Z2 (Codex ④ + NWT sane-max) assertPositiveDelay: 100 PASS / 1e7−1 PASS / 0 REJECT / −1 REJECT / 1e7 REJECT(sane-max) / 5e11 REJECT / 非整数 REJECT / 自定义 max=1000 时 1000 REJECT 999 PASS', () => { assert.strictEqual(assertPositiveDelay(100), 100n); assert.strictEqual(assertPositiveDelay(DELAY_SANE_MAX_DAA - 1n), DELAY_SANE_MAX_DAA - 1n); throwsCode(() => assertPositiveDelay(0), CLTV_ERR.DELAY_NONPOSITIVE); throwsCode(() => assertPositiveDelay(-1n), CLTV_ERR.DELAY_NONPOSITIVE); throwsCode(() => assertPositiveDelay(DELAY_SANE_MAX_DAA), CLTV_ERR.DOMAIN_MIXED); throwsCode(() => assertPositiveDelay(T), CLTV_ERR.DOMAIN_MIXED); throwsCode(() => assertPositiveDelay('n'), CLTV_ERR.ARGS_MISSING); throwsCode(() => assertPositiveDelay(1000, 'n', { max: 1000 }), CLTV_ERR.DOMAIN_MIXED); assert.strictEqual(assertPositiveDelay(999, 'n', { max: 1000 }), 999n); });
t('C1 拒因分类: 三种 CLTV 文本 + NotFinalized ⇒ lock-reject 带共识坐标; 其它 ⇒ inconclusive', () => {
  assert.deepStrictEqual(classifyLockReject('x: mismatched locktime types -- tx locktime 0, stack locktime 5'), { kind: 'lock-reject', reason: 'domain_mismatch', consensus_site: 'opcodes/mod.rs:1034' });
  assert.strictEqual(classifyLockReject('locktime requirement not satisfied -- ...').reason, 'not_yet');
  assert.strictEqual(classifyLockReject('transaction input is finalized').reason, 'sequence_max');
  assert.strictEqual(classifyLockReject('Rejected transaction abc: transaction input #0 is not finalized').reason, 'not_finalized');   // 逐字 = errors/tx.rs:33 Display
  assert.strictEqual(classifyLockReject('transaction input #3 is not finalized').consensus_site.startsWith('consensus/core/src/errors/tx.rs:33'), true);
  assert.strictEqual(classifyLockReject('input #0 is not finalized').kind, 'inconclusive');   // 非逐字形不认 (防把别的 "finalized" 文本误归)
  assert.strictEqual(classifyLockReject('transaction has 1000 fees which is under the required amount').kind, 'inconclusive');
  assert.strictEqual(classifyLockReject('').kind, 'inconclusive');
});
console.log(`cltv-locktime: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
