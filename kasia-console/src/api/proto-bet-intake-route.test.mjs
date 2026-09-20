// proto-bet-intake-route.test.mjs — oracle 整合批 D §6: HTTP bet 路由的受理点 outcome_end 门【接线】回归(真 Fastify + app.inject + 真 migration 临时库)。
// 门的判定矩阵在 lib/proto-bet-intake.test.mjs(readPmt 注入); 这里只验路由确实调它、拒绝发生在任何 DB 写 / IPC 之前、无判定题市场行为不变。
// 测试环境无 relay(PROTO_RELAY_ID 未配): 判定题 ∧ outcome_end 有限 ⇒ 读 pmt 必失败 ⇒ 按 fail-closed 拒受理(N4)——这本身就是要验的行为。
// Run: cd kasia-console && node src/api/proto-bet-intake-route.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PROTO_INTAKE_ROUTE_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_intake_route_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_INTAKE_ROUTE_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_NETWORK = 'simnet';   // 批 B B5: 判定题受理门要已配置的网络(非主网放行; 未配 ⇒ fail-closed 403)——专属矩阵见 proto-bet-intake.test.mjs / proto-oracle-create-route.test.mjs
delete process.env.PROTO_DRIVER_ENABLED; delete process.env.PROTO_RELAY_ID;   // 与 proto.test.mjs 同: driver 关 ⇒ 过了校验 / 门之后一律 409 proto_driver_disabled
import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const { registerProtoRoutes } = await import('./proto.js');

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const app = Fastify(); await registerProtoRoutes(app); await app.ready();
const NOW = new Date().toISOString(), OE = Date.now() + 3_600_000;
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'Test', 'TST', NOW);
let n = 0;
const mk = (extra = {}) => { const id = `r${++n}`; const cols = { id, token_def_id: 'tok1', deadline_ms: Date.now() + 7_200_000, min_bet: 1, committee_pubkeys_json: '["' + 'ab'.repeat(32) + '"]', committee_privkey_enc: 'e', rootclose_tmpl_hash: 'aa'.repeat(32), status: 'betting', created_at: NOW, updated_at: NOW, ...extra }; const k = Object.keys(cols); sqlite.prepare(`INSERT INTO proto_markets (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((c) => cols[c])); return id; };
const SPEC = JSON.stringify({ side_map: { yes: 1, no: 0 } });   // 批 B C1: 判定题受理门读 side_map; direction 0 ⇒ side_label 'no'
const bet = (id) => app.inject({ method: 'POST', url: `/api/proto-markets/${id}/bet`, payload: { direction: 0, amount: 5, side_label: 'no' } });
const betRows = (id) => sqlite.prepare('SELECT count(*) n FROM proto_bets WHERE market_id = ?').get(id).n;
const intentRows = (id) => sqlite.prepare('SELECT count(*) n FROM proto_bet_intents i JOIN proto_bets b ON b.id = i.bet_id WHERE b.market_id = ?').get(id).n;

console.log('[test] 受理点门接线:');
{
  const plain = mk(); const r0 = await bet(plain);
  ok(r0.statusCode === 409 && JSON.parse(r0.body).error === 'proto_driver_disabled', `无判定题市场: 行为不变——过门后仍走到 driver 关闭的 409(实际 ${r0.statusCode} ${r0.body.slice(0, 80)})`);
  ok(betRows(plain) === 1 && intentRows(plain) === 1, '无判定题: pending 行 + append 意图照常落表(门没有误伤 operator 路径)');

  const noEnd = mk({ resolution_rule_spec: SPEC }); const r1 = await bet(noEnd);
  ok(r1.statusCode === 409 && JSON.parse(r1.body).error === 'outcome_end_missing', `判定题 ∧ outcome_end 空 ⇒ 409 outcome_end_missing(实际 ${r1.statusCode} ${r1.body.slice(0, 80)})`);
  ok(betRows(noEnd) === 0 && intentRows(noEnd) === 0, '拒受理发生在任何 DB 写之前: 无 bets / 意图行');

  const withEnd = mk({ resolution_rule_spec: SPEC, outcome_condition_id: '0xabc', outcome_end_ms: OE }); const r2 = await bet(withEnd);
  ok(r2.statusCode === 503 && JSON.parse(r2.body).error === 'pmt_unavailable_fail_closed', `判定题 ∧ outcome_end 有限 ∧ pmt 读不到(无 relay)⇒ 503 fail-closed(实际 ${r2.statusCode} ${r2.body.slice(0, 100)})`);
  ok(betRows(withEnd) === 0 && intentRows(withEnd) === 0, 'fail-closed 拒受理: 无 bets / 意图行');

  const gone = await bet('no-such'); ok(gone.statusCode === 404, `不存在的市场仍 404(实际 ${gone.statusCode})`);
  const sealed = mk({ status: 'sealed', resolution_rule_spec: SPEC }); const r3 = await bet(sealed);
  ok(r3.statusCode === 409 && /not accepting bets/.test(r3.body), `状态校验先于门: sealed ⇒ 既有 409 not accepting bets(实际 ${r3.statusCode})`);
  const badDir = await app.inject({ method: 'POST', url: `/api/proto-markets/${withEnd}/bet`, payload: { direction: 2, amount: 5, side_label: 'no' } });
  ok(badDir.statusCode === 400, `参数校验(direction)先于门: 400(实际 ${badDir.statusCode})`);
}
await app.close();
console.log(fails ? `\n❌ ${fails} 项失败` : '\n✅✅ ALL PASS — 受理点 outcome_end 门路由接线(无判定题不变 / 判定题缺 outcome_end 拒 / pmt 读不到 fail-closed / 拒在写之前)');
process.exit(fails ? 1 : 0);
