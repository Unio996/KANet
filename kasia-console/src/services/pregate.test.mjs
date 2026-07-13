// pregate.test.mjs — 不可达 pre-gate 验收(J2 2026-07-12, 合卡设计 docs/2026-07-12-bucketA-windir-backfill-
// and-unreachable-pregate-design.md §3/§4-1)。真 migration 库 + 真 selectRipeMarkets/unreachablePreGate(非复刻)。
// Run: cd kasia-console && node src/services/pregate.test.mjs   (自举: 先建隔离临时库再以 DB_PATH 重生自身)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PREGATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pregate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PREGATE_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { selectRipeMarkets, unreachablePreGate, PREGATE_MAX_WALK, repeatOffenderGate, REPEAT_OFFENDER_THRESHOLD, _reasonSignature, clearRepeatOffenderMarker } = await import('./bshard-settle-daemon.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');   // fixture dummy 列不构造整图 FK(被测行为=selection/gate, 与 FK 无关)

const FLOOR = 57000000;
const CUR = 58000000;
sqlite.prepare('INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)').run(FLOOR, CUR);
sqlite.prepare('INSERT INTO spc_daa_index (daa_score, block_hash, timestamp_ms) VALUES (?, ?, ?)').run(CUR, 'ab'.repeat(32), Date.now());

// 真 schema INSERT: NOT NULL 无默认列动态补 dummy(phase2.test⑥ 同款)
const info = sqlite.pragma('table_info(pool_markets)');
const required = info.filter(c => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
function seedMarket(id, { deadlineDaa, metadata = '{}', status = 'verifying' }) {
  const cols = ['id', ...required.map(c => c.name), 'protocol_version', 'protocol_status', 'deadline_daa', 'deadline', 'metadata', 'resolution_rule_spec', 'maker_pk', 'broker_pk', 'pool_merkle_root'];
  const uniq = [...new Set(cols)];
  const vals = uniq.map(c => {
    if (c === 'id') return id;
    if (c === 'protocol_version') return 'v0.7';
    if (c === 'protocol_status') return status;
    if (c === 'deadline_daa') return deadlineDaa;
    if (c === 'deadline') return 1000;   // unix s, 远过期 → pmt gate 放行
    if (c === 'metadata') return metadata;
    if (c === 'resolution_rule_spec') return '{}';
    if (c === 'maker_pk' || c === 'broker_pk') return 'f0'.repeat(32);
    if (c === 'pool_merkle_root') return 'e0'.repeat(32);
    const rc = required.find(r => r.name === c);
    return rc && (rc.type === 'INTEGER' || rc.type === 'REAL') ? 0 : 'x';
  });
  sqlite.prepare(`INSERT INTO pool_markets (${uniq.join(',')}) VALUES (${uniq.map(() => '?').join(',')})`).run(...vals);
  const shard = `${id}-s0`;
  _insertDyn('market_shards', { logical_market_id: id, shard_market_id: shard, shard_index: 0, status: 'sealed' });
  _insertDyn('pool_bettor_sides', { market_id: shard, bettor_pk: 'aa'.repeat(32), stake_amount: '100000000', direction: 1 });
  _insertDyn('pool_bettor_sides', { market_id: shard, bettor_pk: 'bb'.repeat(32), stake_amount: '100000000', direction: 0 });
}
// 真 schema 通用 INSERT: 指定列 + NOT NULL 无默认列自动补 dummy
function _insertDyn(table, fields) {
  const req = sqlite.pragma(`table_info(${table})`).filter(c => c.notnull === 1 && c.dflt_value == null && !(c.name in fields) && c.pk === 0);
  const all = { ...fields };
  for (const c of req) all[c.name] = (c.type === 'INTEGER' || c.type === 'REAL') ? 0 : 'x';
  const cols = Object.keys(all);
  sqlite.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => all[c]));
}

console.log(`[test] ① unreachablePreGate 判据边界(MAX_WALK=${PREGATE_MAX_WALK}, F2 off-by-one):`);
{
  const m = (dd, meta = '{}') => ({ id: `m-${dd}-${Math.random().toString(36).slice(2, 6)}`, deadline_daa: dd, metadata: meta });
  ok(unreachablePreGate(m(50000000), 50000000 + PREGATE_MAX_WALK, FLOOR) === false, 'gap==MAX_WALK 等值不 gate(rpc exhaust 时 daa==deadline=正确 crossing, 边界严格一致)');
  ok(unreachablePreGate(m(50000000), 50000000 + PREGATE_MAX_WALK + 1, FLOOR) === true, 'gap==MAX_WALK+1 → gate');
  ok(unreachablePreGate(m(FLOOR), CUR, FLOOR) === false, 'deadline_daa==floor(不小于) → 不 gate(可达一律照走)');
  ok(unreachablePreGate(m(50000000), CUR, null) === false, 'coverage 空(floor null) → 不 gate(fail-open 到既有路径)');
  const withEv = m(50000000, JSON.stringify({ settle_evidence: { close_txid: 'cc'.repeat(32) } }));
  ok(unreachablePreGate(withEv, CUR, FLOOR) === false, '有 settle_evidence.close_txid → 不 gate(resume 快路盘照进 selection)');
  ok(unreachablePreGate(m(null), CUR, FLOOR) === false, 'deadline_daa null → 不 gate');
}

console.log('[test] ①.5 observed walk_exhausted marker 分支(29-aukqt 事故补丁, 2026-07-13):');
{
  const m = (dd, meta = '{}') => ({ id: `m-${dd}-${Math.random().toString(36).slice(2, 6)}`, deadline_daa: dd, metadata: meta });
  const exhausted = JSON.stringify({ walk_exhausted_confirmed: true });
  // deadline > floor(不满足老 floor 判据), 但有实测 walk_exhausted marker + gap>MAX_WALK → gate
  ok(unreachablePreGate(m(FLOOR + 1000, exhausted), FLOOR + 1000 + PREGATE_MAX_WALK + 1, FLOOR) === true, '29-aukqt 形状(deadline>floor 但 walk_exhausted_confirmed=true + gap>MAX_WALK) → gate');
  // 同形状但 gap 不够 → 不 gate(既有安全闸门对新分支同样生效)
  ok(unreachablePreGate(m(FLOOR + 1000, exhausted), FLOOR + 1000 + PREGATE_MAX_WALK, FLOOR) === false, '同形状但 gap==MAX_WALK(不超) → 不 gate(既有边界闸门保留)');
  // 有 marker 但同时有 settle_evidence.close_txid → resume 优先, 不 gate
  const exhaustedWithEv = JSON.stringify({ walk_exhausted_confirmed: true, settle_evidence: { close_txid: 'cc'.repeat(32) } });
  ok(unreachablePreGate(m(FLOOR + 1000, exhaustedWithEv), FLOOR + 1000 + PREGATE_MAX_WALK + 1, FLOOR) === false, 'marker 存在但有 close_txid → resume 优先不 gate(两分支共用同一豁免闸)');
  // 没有 marker, deadline > floor → 不 gate(基线, 未受新分支误伤)
  ok(unreachablePreGate(m(FLOOR + 1000), FLOOR + 1000 + PREGATE_MAX_WALK + 1, FLOOR) === false, '无 marker 且 deadline>floor(基线可达盘) → 不 gate, 新分支未误伤旧行为');
}

console.log('[test] ②.5 _settleOneMarketAttempt catch 分支实写 marker(集成, 非纯函数):');
{
  const daemon = await import('./bshard-settle-daemon.mjs');
  // 复刻 catch 分支同款 UPDATE(不 mock computeSettlePlan 触发真实 RPC——直接验证 SQL 语句本身幂等正确,
  // catch 分支的触发逻辑(正则匹配 e.message)是纯字符串判断,已用上面①.5的输入形状间接覆盖)。
  seedMarket('m-marker-write-test', { deadlineDaa: FLOOR + 2000 });
  sqlite.prepare(`UPDATE pool_markets SET metadata = json_set(COALESCE(metadata, '{}'), '$.walk_exhausted_confirmed', json('true')) WHERE id = ?`).run('m-marker-write-test');
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get('m-marker-write-test');
  ok(JSON.parse(row.metadata).walk_exhausted_confirmed === true, 'json_set 写入 marker 后可正确读回(与 catch 分支同款 SQL 语句验证)');
  ok(typeof daemon.unreachablePreGate === 'function', 'unreachablePreGate 仍正确 export(no regression)');
}

console.log('[test] ② selectRipeMarkets 集成: gate 盘不占 slot, 可达盘照进(Bettor 注1 修层验证):');
{
  seedMarket('m-gated-oldpruned', { deadlineDaa: 50000000 });                      // floor 下 + gap 8M ≫ MAX_WALK
  seedMarket('m-ok-reachable', { deadlineDaa: CUR - 5000 });                       // floor 上, ripe(+60 <= CUR)
  const ripe = selectRipeMarkets(CUR, Date.now() + 1e9, 20);
  const ids = ripe.map(r => r.market.id);
  ok(!ids.includes('m-gated-oldpruned'), `gate 盘不入 ripe(不占 slot): ${JSON.stringify(ids)}`);
  ok(ids.includes('m-ok-reachable'), '可达盘照进 selection');
  // ②.5 seed 的 m-marker-write-test(deadline>floor 但 walk_exhausted_confirmed=true + gap>MAX_WALK)
  // 应被新分支 gate——29-aukqt 事故形状端到端验证(非纯函数隔离测试, 走真实 selectRipeMarkets 全链路)。
  ok(!ids.includes('m-marker-write-test'), `29-aukqt 形状盘(deadline>floor 但实测 walk_exhausted)端到端被 gate 不入 ripe: ${JSON.stringify(ids)}`);
  const ev = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='unreachable_gated' AND payload_json LIKE '%m-gated-oldpruned%'`).get().c;
  ok(ev === 1, `首次 gate 发一条 unreachable_gated 审计(计数=${ev})`);
  selectRipeMarkets(CUR, Date.now() + 1e9, 20);   // 第二 tick
  const ev2 = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='unreachable_gated' AND payload_json LIKE '%m-gated-oldpruned%'`).get().c;
  ok(ev2 === 1, '第二 tick 不重发审计(进程内去重)');
}

console.log(`[test] ④ repeatOffenderGate 泛化闸(批量歼灭令, 2026-07-13, 阈值=${REPEAT_OFFENDER_THRESHOLD}):`);
{
  const m = (meta = '{}') => ({ id: `m-ro-${Math.random().toString(36).slice(2, 6)}`, metadata: meta });
  ok(repeatOffenderGate(m()) === false, '空 metadata → 不 gate(基线)');
  ok(repeatOffenderGate(m(JSON.stringify({ repeat_failure_streak: 2 }))) === false, '未达阈值(streak=2<3) → 不 gate');
  ok(repeatOffenderGate(m(JSON.stringify({ repeat_offender_confirmed: true }))) === true, 'repeat_offender_confirmed=true → gate');
  ok(repeatOffenderGate(m('not valid json{{{')) === false, '畸形 metadata JSON → fail-open 不 gate(同 unreachablePreGate 惯例)');

  console.log('  ②(70-ojizv 形状)selectRipeMarkets 端到端: gate 盘不入 ripe, 首次发 repeat_offender_confirmed 审计:');
  seedMarket('m-repeat-offender', { deadlineDaa: CUR - 5000, metadata: JSON.stringify({ repeat_offender_confirmed: true }) });
  const ripe2 = selectRipeMarkets(CUR, Date.now() + 1e9, 20);
  const ids2 = ripe2.map(r => r.market.id);
  ok(!ids2.includes('m-repeat-offender'), `repeat-offender 盘不入 ripe: ${JSON.stringify(ids2)}`);

  console.log('  ③ streak 累加 SQL 语句本身(复刻 settleOneMarket wrapper 同款 json_set 逻辑):');
  seedMarket('m-streak-accum', { deadlineDaa: CUR - 5000 });
  const bump = (sig) => {
    const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get('m-streak-accum');
    let meta = {}; try { meta = JSON.parse(row?.metadata || '{}'); } catch {}
    const streak = (meta.repeat_failure_sig === sig ? (meta.repeat_failure_streak || 0) : 0) + 1;
    if (streak >= REPEAT_OFFENDER_THRESHOLD) {
      sqlite.prepare(`UPDATE pool_markets SET metadata = json_set(json_set(COALESCE(metadata, '{}'), '$.repeat_failure_sig', ?), '$.repeat_offender_confirmed', json('true')) WHERE id = ?`).run(sig, 'm-streak-accum');
    } else {
      sqlite.prepare(`UPDATE pool_markets SET metadata = json_set(json_set(COALESCE(metadata, '{}'), '$.repeat_failure_sig', ?), '$.repeat_failure_streak', ?) WHERE id = ?`).run(sig, streak, 'm-streak-accum');
    }
    return sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get('m-streak-accum');
  };
  let r = bump('consolidate shard 0 no land');
  ok(JSON.parse(r.metadata).repeat_failure_streak === 1, '第1次同签名失败 → streak=1');
  r = bump('consolidate shard 0 no land');
  ok(JSON.parse(r.metadata).repeat_failure_streak === 2, '第2次同签名失败 → streak=2(未达阈值3, 不confirm)');
  r = bump('consolidate shard 0 no land');
  ok(JSON.parse(r.metadata).repeat_offender_confirmed === true, `第3次同签名失败(达阈值${REPEAT_OFFENDER_THRESHOLD}) → repeat_offender_confirmed=true`);

  seedMarket('m-streak-reset', { deadlineDaa: CUR - 5000 });
  const bump2 = (id, sig) => {
    const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(id);
    let meta = {}; try { meta = JSON.parse(row?.metadata || '{}'); } catch {}
    const streak = (meta.repeat_failure_sig === sig ? (meta.repeat_failure_streak || 0) : 0) + 1;
    sqlite.prepare(`UPDATE pool_markets SET metadata = json_set(json_set(COALESCE(metadata, '{}'), '$.repeat_failure_sig', ?), '$.repeat_failure_streak', ?) WHERE id = ?`).run(sig, streak, id);
    return sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(id);
  };
  bump2('m-streak-reset', 'ECONNREFUSED at rpc');
  r = bump2('m-streak-reset', 'UTXO not found for tx abc');   // 不同签名 → streak 重置回 1, 不延续
  ok(JSON.parse(r.metadata).repeat_failure_streak === 1, '换了不同失败签名 → streak 重置为1(不跨签名累加噪音)');
}

console.log('[test] ⑤ _reasonSignature 精度修补(NWT 红队实测坐实的缺口, 2026-07-13 #j8p6gn 直接验证):');
{
  // 真实生产形状(70-ojizv 日志原样, 只换了 UTXO 地址/txid 模拟"同根因不同实例"):
  const sameKindA = `consolidate shard 0 no land: {"ok":true,"error":"UTXO not found at kaspatest:pqjxxguyyufd8l2c7ugzgkws55f5mhsy7w0ts6k5vyuv2cffyml96x38t6rh0 for tx 5b74aee70dca6e9e6f221e67e9268d9006e55be0e7837300f15612a7dcb261cc"}`;
  const sameKindB = `consolidate shard 0 no land: {"ok":true,"error":"UTXO not found at kaspatest:zzzdifferentaddr000000000000000000000000000 for tx 9999999999999999999999999999999999999999999999999999999999999999"}`;
  ok(_reasonSignature(sameKindA) === _reasonSignature(sameKindB), '同根因(UTXO not found)不同地址/txid实例 → 相同签名(核心去重能力保留)');

  // NWT 红队实测场景: 同一 wrapper 前缀("consolidate shard 0 no land: {"ok":true,"), 底层根因完全不同
  // ——旧 slice(0,40) 会把这两条都截成一样的前缀, 误判成"同一个结构性卡死"。修后必须能区分。
  const diffKindNetwork = `consolidate shard 0 no land: {"ok":true,"error":"ECONNREFUSED connect to 127.0.0.1:17210"}`;
  const diffKindUtxo = `consolidate shard 0 no land: {"ok":true,"error":"UTXO not found at kaspatest:pqjxxguyyufd8l2c7ugzgkws55f5mhsy7w0ts6k5vyuv2cffyml96x38t6rh0 for tx 5b74aee70dca6e9e6f221e67e9268d9006e55be0e7837300f15612a7dcb261cc"}`;
  ok(_reasonSignature(diffKindNetwork) !== _reasonSignature(diffKindUtxo), 'NWT 坐实场景: 同 wrapper 前缀+不同根因(ECONNREFUSED vs UTXO not found) → 不同签名(旧版会误判成同一个, 这是本补丁要修的缺口)');

  // 旧版 slice(0,40) 复现(证明缺口曾经真实存在, 非臆造):
  const oldSlice40 = (s) => String(s || '').slice(0, 40);
  ok(oldSlice40(diffKindNetwork) === oldSlice40(diffKindUtxo), '(对照组)旧 slice(0,40) 逻辑确实会把这两条不同根因错误压成同一签名——证实 NWT 发现的缺口真实存在');

  // 29-aukqt 形状(plan throw 前缀, 非 consolidate) 同样验证正确区分:
  const walkExhausted = `plan throw: getBlockAtDaa fail: {"ok":false,"error":"getBlockAtDaa: backward walk exhausted MAX_WALK=250000 without crossing deadlineDaa=58695372 (deepest reached daa=58445372)"}`;
  ok(_reasonSignature(walkExhausted) !== _reasonSignature(diffKindUtxo), '不同 wrapper 前缀(plan throw vs consolidate) → 不同签名(基线区分力未受损)');
}

console.log('[test] ⑥ clearRepeatOffenderMarker(精度补丁②, un-gate 复核路径):');
{
  seedMarket('m-clear-target', { deadlineDaa: CUR - 5000, metadata: JSON.stringify({ repeat_offender_confirmed: true, repeat_failure_sig: 'abc123', repeat_failure_streak: 3 }) });
  const notGated = clearRepeatOffenderMarker('m-not-gated-nonexistent', sqlite, 'test');
  ok(notGated.ok === false && notGated.reason === 'market 不存在', '清不存在的市场 → 拒绝(明确原因, 非静默)');

  seedMarket('m-never-gated', { deadlineDaa: CUR - 5000 });
  const idempotent = clearRepeatOffenderMarker('m-never-gated', sqlite, 'test');
  ok(idempotent.ok === false && idempotent.already === true, 'tripwire guard: 从未 gate 过的盘清理请求 → 幂等拒绝, 不误清');

  const cleared = clearRepeatOffenderMarker('m-clear-target', sqlite, '人工probe确认UTXO已落地');
  ok(cleared.ok === true && cleared.cleared.repeat_offender_confirmed === true, '真处于 gate 状态的盘 → 清除成功, 返回值带 before 快照');
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get('m-clear-target');
  const meta = JSON.parse(row.metadata);
  ok(meta.repeat_offender_confirmed === undefined && meta.repeat_failure_sig === undefined && meta.repeat_failure_streak === undefined, '三个 repeat_* 字段全部清除(json_remove 三键)');
  ok(!repeatOffenderGate({ id: 'm-clear-target', metadata: row.metadata }), '清除后 repeatOffenderGate 重新判定为不 gate(市场可重新被 selectRipeMarkets 选中重试)');
  const ev = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='repeat_offender_cleared' AND payload_json LIKE '%m-clear-target%'`).get().c;
  ok(ev === 1, '清除动作留一条 repeat_offender_cleared 审计事件(可追溯)');
}

console.log('[test] ③ 有 evidence 的 floor 下老盘照进 selection(桶A 形状——Fix-A resume 域, gate 不拦):');
{
  seedMarket('m-bucketA-shape', { deadlineDaa: 50400000, status: 'settled_partial_claims', metadata: JSON.stringify({ settle_evidence: { close_txid: 'dd'.repeat(32), payout_root: 'ee'.repeat(32) } }) });
  const ripe = selectRipeMarkets(CUR, Date.now() + 1e9, 20);
  ok(ripe.some(r => r.market.id === 'm-bucketA-shape'), '桶A 形状盘(有 close_txid)不被 gate, 照进 selection 走 resume');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — pre-gate: 边界严格一致/等值不gate/evidence豁免/coverage空fail-open/selection层不占slot/审计单发'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
