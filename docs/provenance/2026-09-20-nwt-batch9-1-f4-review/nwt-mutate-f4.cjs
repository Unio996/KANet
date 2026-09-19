// NWT 批9-1 F4(fa72891e) 独立变异; 目标 src/lib/proto-settlement-c1.mjs; 在 kasia-console/ 下跑
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const F = 'src/lib/proto-settlement-c1.mjs'; const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x: ${a.slice(0, 70)}`); return s.replace(a, b); };
const M = [
  ['NWT-k1 third arg to requestFacts dropped', R(".then(() => requestFacts(address, payload, { timeoutMs: ipcTimeoutMs }))", ".then(() => requestFacts(address, payload))")],
  ['NWT-k2 third arg carries budgetMs instead of ipcTimeoutMs', R("{ timeoutMs: ipcTimeoutMs }))", "{ timeoutMs: budgetMs }))")],
  ['NWT-k3 third arg hard-coded 15000', R("{ timeoutMs: ipcTimeoutMs }))", "{ timeoutMs: 15000 }))")],
  ['NWT-k4 production entry no longer rejects a timers key', R("if (opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'timers')) {", "if (false) {")],
  ['NWT-k5 production entry rejects only a defined timers value (misses {timers: undefined})', R("Object.prototype.hasOwnProperty.call(opts, 'timers')", "opts.timers !== undefined")],
  ['NWT-k6 test-only entry: clearTimeout not validated (f22)', R("typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers", "typeof timers.setTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers")],
  ['NWT-k7 production entry passes an injectable holder (uses opts.timers when present, AND no key check)', R("return verifyCore(opts, { setTimeout, clearTimeout });", "return verifyCore(opts, (opts && opts.timers) || { setTimeout, clearTimeout });")],
  ['NWT-k8 verifyCore budget timer cleared with the global clearTimeout, not the injected one', R("finally { timers.clearTimeout(timer); }", "finally { clearTimeout(timer); }")],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(F, m);
  const r = cp.spawnSync('node', ['src/lib/proto-settlement-c1.test.mjs'], { encoding: 'utf8', timeout: 180000 });
  const f = ((r.stdout || '').match(/\[FAIL\]/g) || []).length;
  out.push((r.status === 0 ? 'SURVIVED ' : 'killed   ') + n + (r.status === 0 ? '' : '   RED(f=' + f + ')'));
  fs.writeFileSync(F, orig);
}
fs.writeFileSync(F, orig);
console.log(out.join('\n')); console.log('restored identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')));
