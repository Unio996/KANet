// verify-selfcheck.mjs — 给 verify-arms.mjs 做"检查器不空转"的自检: 对演练留下的 DB 拷贝 / 臂映射 / 参数做破坏, 断言检查器【会】变红或标 VACUOUS。
// Run(先 E2E_KEEP=<dir> node rehearse-local.mjs): node verify-selfcheck.mjs <keep dir>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const keep = process.argv[2]; if (!keep) { console.error('usage: node verify-selfcheck.mjs <keep dir>'); process.exit(2); }
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const KC = process.env.E2E_REPO_KC || 'D:/kanet-tn12/scratch/_j2_wt_pointers_shape/kasia-console';
const tmp = path.join(process.env.TEMP || '/tmp', `_j2_verify_selfcheck_${process.pid}`); fs.mkdirSync(tmp, { recursive: true });
const arms = JSON.parse(fs.readFileSync(path.join(keep, 'arms.json'), 'utf8')); const pmtNow = fs.readFileSync(path.join(keep, 'pmt-now.txt'), 'utf8').trim();
const run = ({ db, armsObj = arms, pmt = pmtNow, scenario = path.join(keep, 'scenario.json') }) => {
  const af = path.join(tmp, 'arms.json'); fs.writeFileSync(af, JSON.stringify(armsObj));
  const r = spawnSync(process.execPath, [path.join(here, 'verify-arms.mjs'), '--arms', af, '--pmt-now', String(pmt), '--scenario', scenario], { env: { ...process.env, DB_PATH: db, E2E_REPO_KC: KC }, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const copyDb = (name) => { const d = path.join(tmp, name + '.db'); fs.copyFileSync(path.join(keep, 'rehearsal.db'), d); return d; };
let pass = 0, fail = 0; const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message.split('\n')[0]); } };
// 直接改库拷贝需要绕开 append-only / 单向触发器: 用 DROP TRIGGER(仅在拷贝上)
const mutateDb = async (db, sql) => { process.env.DB_PATH = db; const { default: Database } = await import(pathToFileURL(path.join(KC, 'node_modules/better-sqlite3/lib/index.js')).href).catch(() => ({ default: null })); if (!Database) throw new Error('better-sqlite3 not found'); const h = new Database(db); for (const t of h.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()) h.exec(`DROP TRIGGER "${t.name}"`); h.exec(sql); h.close(); };

t('S0 基线: 未破坏的拷贝 ⇒ 全绿(exit 0, fail=0)', () => { const r = run({ db: copyDb('base') }); assert.equal(r.code, 0, r.out.slice(-400)); assert.match(r.out, /fail=0 vacuous=0/); });
t('S1 臂映射被调换(H↔D 的 id)⇒ 必红', () => { const r = run({ db: copyDb('swap'), armsObj: { ...arms, H: arms.D, D: arms.H } }); assert.equal(r.code, 1); assert.match(r.out, /^FAIL/m); });
t('S2 pmt-now 早于 deadline+30s(观察窗不够)⇒ "close_commit 意图=0" 标 VACUOUS 而非 PASS', () => { const r = run({ db: copyDb('early'), pmt: 1_000_000 }); assert.match(r.out, /^VACUOUS .*close_commit 意图=0/m); assert.doesNotMatch(r.out, /^PASS .*\[D\] close_commit 意图=0/m); assert.match(r.out, /VACUOUS\(不得当证据\)/); });
const scen = JSON.parse(fs.readFileSync(path.join(keep, 'scenario.json'), 'utf8')); const cond = Object.keys(scen.polymarket)[0]; scen.polymarket[cond] = { prices: ['0', '1'] };
const badScen = path.join(tmp, 'scenario-bad.json'); fs.writeFileSync(badScen, JSON.stringify(scen));
t('S3 场景被改(uma 价格翻转)⇒ evidence_ref 哈希复算对不上 ⇒ 必红', () => { const r = run({ db: copyDb('scen'), scenario: badScen }); assert.equal(r.code, 1); assert.match(r.out, /^FAIL .*uma evidence_ref 哈希/m); });
const dbMut = [
  ['S4 H 的批准票 pmt_at 改成早于 oe ⇒ 必红', 'UPDATE proto_market_verdicts SET pmt_at = 1 WHERE market_id = \'' + arms.H + '\' AND source_kind = \'uma\'', /^FAIL .*\[H\]/m],
  ['S5 D 臂解冻 ⇒ 必红', 'UPDATE proto_markets SET settlement_frozen_at = NULL, frozen_reason = NULL WHERE id = \'' + arms.D + '\'', /^FAIL .*\[D\] 已冻结/m],
  ['S6 A 臂的 extractor 行 outcome 改成 1(不再是 ABSTAIN)⇒ 必红', 'UPDATE proto_market_verdicts SET outcome = 1 WHERE market_id = \'' + arms.A + '\' AND source_kind = \'extractor\'', /^FAIL .*\[A\]/m],
  ['S7 L 臂混进一条 verdict ⇒ 必红', 'INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) VALUES (\'' + arms.L + '\', \'llm\', 1, \'x#sha256:' + 'a'.repeat(64) + '\', \'2026-01-01\', NULL)', /^FAIL .*\[L\] verdict 行 0/m],
  ['S8 F 臂出现 close_commit(resolve)意图 ⇒ 必红', null, /^FAIL .*\[F\] close_commit 意图=0/m],
  ['S9 全局: 制造重复 (market, source_kind, evidence_ref) 行 ⇒ 必红', 'INSERT INTO proto_market_verdicts (market_id, source_kind, outcome, evidence_ref, created_at, pmt_at) SELECT market_id, source_kind, outcome, evidence_ref, created_at, pmt_at FROM proto_market_verdicts WHERE market_id = \'' + arms.H + '\' AND source_kind = \'uma\'', /^FAIL .*\[\*\] 无重复/m],
];
for (const [name, sql, re] of dbMut) {
  let db = copyDb('m' + name.slice(0, 2));
  let s2 = sql;
  if (s2 === null) { const cols = 'subject_type, subject_id, step, status, created_at, updated_at'; s2 = `INSERT INTO proto_settlement_intents (${cols}) VALUES ('market', '${arms.F}', 'resolve', 'submitted', '2026-01-01', '2026-01-01')`; }
  try { await mutateDb(db, s2); } catch (e) { fail++; console.log('[FAIL] ' + name + ' :: 变异写库失败(夹具问题): ' + e.message.split('\n')[0]); continue; }
  t(name, () => { const r = run({ db }); assert.equal(r.code, 1, r.out.slice(-300)); assert.match(r.out, re, r.out.slice(-500)); });
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nverify-selfcheck: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
