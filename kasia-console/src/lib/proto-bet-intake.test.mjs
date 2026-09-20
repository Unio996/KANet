// proto-bet-intake.test.mjs — oracle 整合批 D §6: 受理点 outcome_end 门的 DB 装配(checkBetIntake)。readPmt 注入; 真 migration 临时库; 零链 / 零 IPC。
// Run: cd kasia-console && node src/lib/proto-bet-intake.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_INTAKE_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_intake_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_INTAKE_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
const assert = (await import('node:assert/strict')).default;
const { sqlite } = await import('../db/client.js');
const { checkBetIntake } = await import('./proto-bet-intake.mjs');
const { JUDGED_COLUMNS } = await import('../db/proto-judged.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const NOW = '2026-09-20T00:00:00.000Z', OE = 1_790_000_000_000;
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', NOW);
let n = 0;
const mk = (extra = {}) => { const id = `i${++n}`; const cols = { id, token_def_id: 'tok1', deadline_ms: OE + 7_200_000, min_bet: 1, committee_pubkeys_json: '[]', committee_privkey_enc: 'e', rootclose_tmpl_hash: 'aa'.repeat(32), status: 'betting', created_at: NOW, updated_at: NOW, ...extra }; const k = Object.keys(cols); sqlite.prepare(`INSERT INTO proto_markets (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((c) => cols[c])); return id; };
const T_NOW = OE - 1_000_000;                                     // 注入的"墙钟"(早于 outcome_end 很多): 不依赖真实时钟
const chk = (o) => checkBetIntake({ nowMs: () => T_NOW, ...o });
const probe = (result) => { const calls = { n: 0 }; return { calls, readPmt: async () => { calls.n++; if (result instanceof Error) throw result; return result; } }; };

await t('X1 无判定题(operator 市场)豁免: 放行且【不读 pmt】(即使 outcome_end 已写且已过 / pmt 会无效)', async () => {
  for (const extra of [{}, { outcome_end_ms: OE - 1 }, { outcome_end_ms: null }]) { const id = mk(extra); const p = probe({ valid: false, reason: 'not_synced' }); const r = await chk({ db: sqlite, marketId: id, readPmt: p.readPmt }); assert.deepEqual(r, { accept: true, code: 'not_judged_exempt' }); assert.equal(p.calls.n, 0, '不得为无判定题市场读 pmt(不给 operator 路径引入新依赖)'); }
});
await t('X2 ▲ N3 判定题 ∧ outcome_end 空 ⇒ 409 outcome_end_missing(不读 pmt); 四个判定题列各自单独即算判定题', async () => {
  const vals = { resolution_rule_spec: 'r', outcome_market_source: 'polymarket', outcome_condition_id: '0xabc', outcome_oracle_relay_ids: '["r1"]' };
  for (const c of JUDGED_COLUMNS) { const id = mk({ [c]: vals[c] }); const p = probe({ valid: true, pmtMs: 1 }); const r = await chk({ db: sqlite, marketId: id, readPmt: p.readPmt }); assert.deepEqual([r.accept, r.code, r.http], [false, 'outcome_end_missing', 409], c); assert.equal(p.calls.n, 0, c); }
});
await t('X3 ▲ N4 判定题受理时 pmt 无效 / 读失败 / readPmt 抛 ⇒ 503 fail-closed(读了 1 次); 有效且 pmt < outcome_end ⇒ 受理; pmt = outcome_end−1 受理 / = outcome_end 拒 / 超过拒(409)', async () => {
  const id = mk({ resolution_rule_spec: 'r', outcome_end_ms: OE });
  for (const res of [{ valid: false, reason: 'not_synced' }, { valid: false, reason: 'read_failed' }, null, new Error('ipc down')]) { const p = probe(res); const r = await chk({ db: sqlite, marketId: id, readPmt: p.readPmt }); assert.deepEqual([r.accept, r.code, r.http], [false, 'pmt_unavailable_fail_closed', 503], String(res && res.message || JSON.stringify(res))); assert.equal(p.calls.n, 1); }
  const run = (pmtMs) => chk({ db: sqlite, marketId: id, readPmt: async () => ({ valid: true, pmtMs }) });
  assert.deepEqual(await run(OE - 1), { accept: true, code: 'ok' });
  for (const pmtMs of [OE, OE + 1, OE + 3_600_000]) { const r = await run(pmtMs); assert.deepEqual([r.accept, r.code, r.http], [false, 'outcome_end_passed', 409], String(pmtMs)); }
});
await t('X6 ▲ M2 取 max(墙钟, pmt): pmt = oe−140s ∧ 墙钟 = oe+1ms ⇒ 必拒(409)且【不再读 pmt】; 墙钟 < oe ∧ pmt 落后 ⇒ 收(读 1 次 pmt); 墙钟 < oe ∧ pmt ≥ oe ⇒ 拒; 墙钟恰 = oe ⇒ 拒', async () => {
  const id = mk({ resolution_rule_spec: 'r', outcome_end_ms: OE });
  const lag = { valid: true, pmtMs: OE - 140_000 };
  let p = probe(lag); let r = await checkBetIntake({ db: sqlite, marketId: id, readPmt: p.readPmt, nowMs: () => OE + 1 });
  assert.deepEqual([r.accept, r.code, r.http], [false, 'outcome_end_passed', 409]); assert.equal(p.calls.n, 0, '墙钟已过 ⇒ 不必读 pmt');
  p = probe(lag); r = await checkBetIntake({ db: sqlite, marketId: id, readPmt: p.readPmt, nowMs: () => OE }); assert.equal(r.accept, false); assert.equal(p.calls.n, 0);
  p = probe(lag); r = await checkBetIntake({ db: sqlite, marketId: id, readPmt: p.readPmt, nowMs: () => OE - 1 }); assert.deepEqual(r, { accept: true, code: 'ok' }); assert.equal(p.calls.n, 1);
  p = probe({ valid: true, pmtMs: OE }); r = await checkBetIntake({ db: sqlite, marketId: id, readPmt: p.readPmt, nowMs: () => OE - 1 }); assert.deepEqual([r.accept, r.code], [false, 'outcome_end_passed']);
  p = probe({ valid: false, reason: 'not_synced' }); r = await checkBetIntake({ db: sqlite, marketId: id, readPmt: p.readPmt, nowMs: () => OE + 3 }); assert.deepEqual([r.code, r.http], ['outcome_end_passed', 409], '墙钟已过 ⇒ 409, 即使 pmt 本来也读不到');
  p = probe(lag); r = await checkBetIntake({ db: sqlite, marketId: mk({ outcome_condition_id: 'c' }), readPmt: p.readPmt, nowMs: () => OE + 3 }); assert.equal(r.code, 'outcome_end_missing', '缺 outcome_end 仍先于墙钟判断');
  const plainId = mk(); p = probe(lag); r = await checkBetIntake({ db: sqlite, marketId: plainId, readPmt: p.readPmt, nowMs: () => OE + 999_999 }); assert.equal(r.accept, true); assert.equal(p.calls.n, 0, '无判定题: 墙钟再晚也豁免且不读 pmt');
});
await t('X4 市场不存在 ⇒ 404(不读 pmt); 参数校验: db / readPmt 必填', async () => {
  const p = probe({ valid: true, pmtMs: 1 }); const r = await chk({ db: sqlite, marketId: 'nope', readPmt: p.readPmt }); assert.deepEqual([r.accept, r.http], [false, 404]); assert.equal(p.calls.n, 0);
  await assert.rejects(() => checkBetIntake({ db: null, marketId: 'x', readPmt: async () => null }), TypeError); await assert.rejects(() => checkBetIntake({ db: sqlite, marketId: 'x' }), TypeError);
});
await t('X5 ▲ N4 门只在受理点: checkBetIntake 只读——不写任何表; 已受理注(proto_bets / proto_bet_intents 已存在)的 append 由驱动推进, 与本函数无关(它不读 bets / intents)', async () => {
  const id = mk({ resolution_rule_spec: 'r', outcome_end_ms: OE });
  sqlite.exec(`INSERT INTO proto_bets (id, market_id, bettor_pk, side, stake, status, created_at) VALUES ('b-${id}', '${id}', 'pk', 0, 1, 'pending', '${NOW}')`);
  const before = JSON.stringify([sqlite.prepare('SELECT * FROM proto_bets').all(), sqlite.prepare('SELECT * FROM proto_bet_intents').all(), sqlite.prepare('SELECT * FROM proto_markets').all()]);
  await chk({ db: sqlite, marketId: id, readPmt: async () => ({ valid: true, pmtMs: OE + 1 }) });
  assert.equal(JSON.stringify([sqlite.prepare('SELECT * FROM proto_bets').all(), sqlite.prepare('SELECT * FROM proto_bet_intents').all(), sqlite.prepare('SELECT * FROM proto_markets').all()]), before, '拒受理也不改任何行');
  const src = fs.readFileSync(new URL('./proto-bet-intake.mjs', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/proto_bets|proto_bet_intents|INSERT|UPDATE|DELETE/.test(src), '受理门源码不碰 bets / intents / 写语句');
});

console.log(`\nproto-bet-intake.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
