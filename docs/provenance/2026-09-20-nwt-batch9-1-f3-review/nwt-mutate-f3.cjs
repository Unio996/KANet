// NWT 批9-1 F3(9c2f4dc2) 独立变异; 在 kasia-console/ 下跑; 每个变异后还原并核 sha256。
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const FILES = { P: 'src/lib/proto-settlement-pointers.mjs', W: 'src/lib/proto-winner-bet.mjs', I: 'src/lib/proto-settlement-inputs.mjs', L: 'src/lib/proto-leaf-state.mjs', T: 'src/lib/proto-tx-assembly.mjs' };
const orig = {}, sha0 = {}; for (const [k, f] of Object.entries(FILES)) { orig[k] = fs.readFileSync(f, 'utf8'); sha0[k] = crypto.createHash('sha256').update(orig[k]).digest('hex'); }
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`pattern matched ${n}x: ${a.slice(0, 70)}`); return s.replace(a, b); };
const M = [
  ['P', 'NWT-i1 pointers takes deriveWinnerBet via inputs again (D-2 regression)', R("import { deriveWinnerBet } from './proto-winner-bet.mjs';", "import { deriveWinnerBet } from './proto-settlement-inputs.mjs';")],
  ['T', 'NWT-i2 tx-assembly imports encodeLeafStateBytes from leaf-state again', R("from './proto-leaf-state-encode.mjs';", "from './proto-leaf-state.mjs';")],
  ['W', 'NWT-i3 winner-bet imports the DB client', R("export function deriveWinnerBet(", "import { sqlite as _x } from '../db/client.js';\nexport function deriveWinnerBet(")],
  ['L', 'NWT-i4 leaf-state stops re-exporting encodeLeafStateBytes', R("export { encodeLeafStateBytes };", "")],
  ['W', 'NWT-i5 winner-bet: default who prefix removed (message prefix undefined)', R("{ db, who = `deriveWinnerBet(${marketId})` } = {}", "{ db, who } = {}")],
  ['I', 'NWT-i6 inputs delegation drops the who pass-through', R("return deriveWinnerBetPure(marketId, { db, who });", "return deriveWinnerBetPure(marketId, { db });")],
  ['P', 'NWT-i7 genesis-recompute probe TransactionOutput never freed', R("finally { try { probe.free(); } catch { /* 已释放 */ } }", "finally { }")],
  ['P', 'NWT-i8 Transaction never freed (finally free removed)', R("try { tx.free(); } catch { /* 已释放 */ }", "")],
  ['P', 'NWT-i9 probe freed only on the success path (not in finally)', R("try { genesisId = lc(kaspa.covenantId({ transactionId: auth.txid, index: auth.index }, [{ index: i, output: probe }])); } catch { genesisId = null; } finally { try { probe.free(); } catch { /* 已释放 */ } }", "try { genesisId = lc(kaspa.covenantId({ transactionId: auth.txid, index: auth.index }, [{ index: i, output: probe }])); probe.free(); } catch { genesisId = null; }")],
  ['P', 'NWT-i10 Transaction freed twice', R("try { tx.free(); } catch { /* 已释放 */ }", "try { tx.free(); } catch { } try { tx.free(); } catch { }")],
];
const TESTS = ['proto-settlement-pointers', 'proto-settlement-inputs', 'proto-leaf-state'];
const out = [];
for (const [k, n, fn] of M) {
  let m; try { m = fn(orig[k]); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  fs.writeFileSync(FILES[k], m);
  const res = TESTS.map((t) => { const r = cp.spawnSync('node', [`src/lib/${t}.test.mjs`], { encoding: 'utf8', timeout: 180000 }); const f = ((r.stdout || '').match(/\[FAIL\]/g) || []).length; return t.replace('proto-', '').replace('settlement-', '') + ':' + (r.status === 0 ? 'ok' : 'RED(f=' + f + ')'); });
  out.push((res.some((x) => x.includes('RED')) ? 'killed   ' : 'SURVIVED ') + n + '   ' + res.join(' '));
  fs.writeFileSync(FILES[k], orig[k]);
}
for (const [k, f] of Object.entries(FILES)) fs.writeFileSync(f, orig[k]);
console.log(out.join('\n')); console.log('restored identical: ' + Object.entries(FILES).every(([k, f]) => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8')).digest('hex') === sha0[k]));
