// NWT 批9-1 F1(11c30eb7) 独立变异: 目标 src/lib/proto-settlement-c1.mjs, 在 kasia-console/ 下跑; 每个变异后还原并核 sha256。只打 F1 新增逻辑。
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const F = 'src/lib/proto-settlement-c1.mjs';
const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x (need 1): ${a.slice(0, 70)}`); return s.replace(a, b); };
const M = [
  ['NWT-f1 role version!=0 check removed', R("if (it && it.scriptPublicKey.version !== 0) {", "if (false) {")],
  ['NWT-f2 fee candidate version check removed', R("u.covenantId !== null || u.scriptPublicKey.version !== 0 || normHex(", "u.covenantId !== null || normHex(")],
  ['NWT-f3 fee lower bound exclusive (equal must pass)', R("u.amount < feeMinAmount || u.amount >", "u.amount <= feeMinAmount || u.amount >")],
  ['NWT-f4 fee upper bound exclusive (equal must pass)', R("u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++", "u.amount >= SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++")],
  ['NWT-f5 fee upper bound not rechecked', R("u.amount < feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++", "u.amount < feeMinAmount) { skippedOutOfRange++")],
  ['NWT-f6 fee lower bound not rechecked', R("u.amount < feeMinAmount || u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++", "u.amount > SIGNED_INPUT_CEILING_SOMPI) { skippedOutOfRange++")],
  ['NWT-f7 out-of-range not counted toward saturated', R("(skippedPoisoned > 0 || skippedOutOfRange > 0 || truncated ? 'saturated' : 'none')", "(skippedPoisoned > 0 || truncated ? 'saturated' : 'none')")],
  ['NWT-f8 out-of-range event dropped', R("if (skippedOutOfRange > 0) events.push(", "if (false) events.push(")],
  ['NWT-f9 grader onSuccess(key) clears ALL keys', R("onSuccess(key) { needKey(key, 'onSuccess'); states.delete(key); },", "onSuccess(key) { needKey(key, 'onSuccess'); states.clear(); },")],
  ['NWT-f10 grader onFailure: key not required', R("needKey(key, 'onFailure');", "")],
  ['NWT-f11 grader collapses to one shared key', R("const st = states.get(key) || { count: 0, lastTick: undefined };", "key = 'shared'; const st = states.get(key) || { count: 0, lastTick: undefined };")],
  ['NWT-f12 entry assertStepBudget removed', R("assertStepBudget(budgetMs, tickIntervalMs);", "")],
  ['NWT-f13 entry assertFactsIpcTimeout removed', R("assertFactsIpcTimeout(ipcTimeoutMs);", "")],
  ['NWT-f14 ipcTimeoutMs finite check removed', R("if (!Number.isFinite(ipcTimeoutMs)) throw new TypeError(", "if (false) throw new TypeError(")],
  ['NWT-f15 budget timer never cleared', R("finally { timers.clearTimeout(timer); }", "finally { }")],
  ['NWT-f16 classify returns null again for unknown', R("return { eventType: 'settlement_c1_programming_error', transient: false, code: code ?? 'unrecognized_error' };", "return null;")],
  ['NWT-f17 classify drops err.code', R("code: code ?? 'unrecognized_error' };", "code: 'unrecognized_error' };")],
  ['NWT-f18 role chainParents outpoint index forced 0', R("outpoint: { txid: u.outpoint.transactionId, index: u.outpoint.index } };", "outpoint: { txid: u.outpoint.transactionId, index: 0 } };")],
  ['NWT-f19 fee chainParents outpoint index forced 0', R("outpoint: { txid: feeCandidate.txid, index: feeCandidate.vout } } };", "outpoint: { txid: feeCandidate.txid, index: 0 } } };")],
  ['NWT-f20 withFeeParent accepts malformed txid', R("|| typeof feeCandidate.txid !== 'string' || !HEX64.test(feeCandidate.txid)", "|| typeof feeCandidate.txid !== 'string'")],
  ['NWT-f21 withFeeParent accepts negative vout', R("|| !Number.isInteger(feeCandidate.vout) || feeCandidate.vout < 0) {", "|| !Number.isInteger(feeCandidate.vout)) {")],
  ['NWT-f22 injected timers not validated', R("if (!timers || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') throw new TypeError(", "if (false) throw new TypeError(")],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(F, m);
  const r = cp.spawnSync('node', ['src/lib/proto-settlement-c1.test.mjs'], { encoding: 'utf8', timeout: 180000 });
  const f = ((r.stdout || '').match(/\[FAIL\]/g) || []).length;
  out.push((r.status === 0 ? 'SURVIVED ' : 'killed   ') + n + '   ' + (r.status === 0 ? 'ok' : 'RED(f=' + f + ',x=' + r.status + ')'));
}
fs.writeFileSync(F, orig);
console.log(out.join('\n')); console.log('restored sha256 identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')));
