const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const F = 'test-fixtures/source-scan/scan-non-test-sources.mjs'; const orig = fs.readFileSync(F, 'utf8'); const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('pattern matched ' + n + 'x: ' + a.slice(0, 60)); return s.replace(a, b); };
const M = [
  ['NWT-s3 line comment never ends at newline', R("if (state === 'line') { if (c === '\\n') { state = 'code'; out += c; } i++; continue; }", "if (state === 'line') { i++; continue; }")],
  ['NWT-s4 escaped char in code state not consumed', R("if (c === '\\\\') { out += c + (n ?? ''); i += 2; continue; }   // an escaped char in code never opens a comment", "")],
  ['NWT-s6 unterminated single-line string does not resync at newline', R("if (c === '\\n' && quote !== '`') { state = 'code'; }   // unterminated single-line string: resync at newline", "")],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(F, m);
  const r = cp.spawnSync(process.execPath, ['test-fixtures/source-scan/scan-non-test-sources.test.mjs'], { encoding: 'utf8', timeout: 120000 });
  out.push((r.status === 0 ? 'SURVIVED ' : 'killed   ') + n + (r.status === 0 ? '' : '   (' + ((r.stdout || '').match(/\[FAIL\]/g) || []).length + ' FAIL)'));
  fs.writeFileSync(F, orig);
}
fs.writeFileSync(F, orig);
console.log(out.join('\n')); console.log('restored identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')));
