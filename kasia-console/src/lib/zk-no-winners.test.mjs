// zk-no-winners.test.mjs — 账本1865: ZK 原生盘"判决已定但无赢家"⇒ 终态 completed + metadata.no_winners(零 KAS)。
// 条件(Bettor): ① 只在判决已定后写(ABSTAIN/未决议 ⇒ 照旧重试)  ② 状态复用 completed; 逐项验: cap 名额释放 / 老 settler·judge-propose·claim·close 不再碰 / 费用 pin 无 / broker-fee-emit 不当成待核对 / my-positions 全输。
// Run: cd kasia-console && node src/lib/zk-no-winners.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._ZKNW_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zknw_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _ZKNW_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
process.env.IBD_TICK_GATE = '0';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { sqlite } = await import('../db/client.js');
const NW = await import('./zk-no-winners.mjs');
const T = await import('./zk-autonomy-ticks.mjs');
const { liveMarketCapReached, listUnfinishedZkNativeMarkets } = await import('./mainnet-no-kas-stake-gate.mjs');
const { deriveClosePins } = await import('./fee-pins.mjs');
const { zkReadyCandidateRows } = await import('../db/phase2-indexes-v200.mjs');
const { handleNoSpineChipMarket } = await import('../services/pool-market-settler.js');
const { noWinnersInfo } = await import('./zk-native-position-result.mjs');
sqlite.pragma('foreign_keys = OFF');

const fill = (table, row) => { const info = sqlite.pragma(`table_info(${table})`).filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id' && !c.pk); for (const c of info) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x'; return row; };
const ins = (row) => { row = fill('pool_markets', row); sqlite.prepare(`INSERT OR REPLACE INTO pool_markets (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); };
const market = (id, over = {}) => ins({ id, maker_relay_id: 'maker-x', protocol_version: 'v0.7', protocol_status: 'verifying', spine_p2sh: null, maker_stake_amount: 0, deadline: 1_700_000_000, deadline_daa: 100, metadata: JSON.stringify({ no_spine: true, no_kas_stake: true }), resolution_rule_spec: JSON.stringify({ zk_native: true }), outcome_market_source: 'polymarket', outcome_condition_id: '0x' + 'cd'.repeat(32), broker_pk: 'ab'.repeat(32), ...over });
const row = (id) => sqlite.prepare('SELECT protocol_status s, metadata m FROM pool_markets WHERE id = ?').get(id);
const logs = []; const l0 = console.log; const w0 = console.warn;
const quiet = () => { console.log = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' ')); };
const loud = () => { console.log = l0; console.warn = w0; };
const DEGEN = 'buildProposeCloseRequestV2: degenerate payout(no winning-side bettors → refund)';

console.log('[test] 1. isNoWinnersError');
ok(NW.isNoWinnersError(new Error(DEGEN)) && NW.isNoWinnersError(DEGEN), '真实报错文本命中');
ok(!NW.isNoWinnersError(new Error('rpc timeout')) && !NW.isNoWinnersError(new Error('buildProposeCloseRequestV2: 2/3 bettors 仍 side_lock_daa NULL')) && !NW.isNoWinnersError(null), '其它错误不命中');

console.log('[test] 2. markZkNoWinners: 判决已定才写 / CAS / 不覆盖在途 close');
market('m-a');
{
  for (const bad of [undefined, null, 2, -1, 'YES', NaN]) { const r = NW.markZkNoWinners(sqlite, 'm-a', bad); if (r.ok || r.changed) { ok(false, `winningDirection=${String(bad)} 不该写`); } }
  ok(row('m-a').s === 'verifying' && !JSON.parse(row('m-a').m).no_winners, '非 0/1 的"判决"(含 ABSTAIN 形态)一律不写, 状态不动');
  const r = NW.markZkNoWinners(sqlite, 'm-a', 1, '2026-10-05T15:00:00.000Z');
  const m = JSON.parse(row('m-a').m);
  ok(r.ok && r.changed && row('m-a').s === 'completed', 'verdict=1 ⇒ completed');
  ok(m.no_winners === true && m.judged_winner === 1 && m.judged_at === '2026-10-05T15:00:00.000Z' && m.no_winners_source.type === 'polymarket' && /^0xcd/.test(m.no_winners_source.condition_id) && m.no_spine === true, 'metadata: no_winners / judged_winner / judged_at / no_winners_source, 原键保留');
  const r2 = NW.markZkNoWinners(sqlite, 'm-a', 0);
  ok(r2.ok && !r2.changed && JSON.parse(row('m-a').m).judged_winner === 1, '重复调用幂等, 不改 judged_winner');
  market('m-flight', { metadata: JSON.stringify({ no_spine: true, bshard_close_request_v2: { x: 1 } }) });
  const r3 = NW.markZkNoWinners(sqlite, 'm-flight', 1);
  ok(!r3.ok && row('m-flight').s === 'verifying', '已有在途 close 请求 ⇒ 拒绝(不覆盖)');
  market('m-zc', { metadata: JSON.stringify({ no_spine: true, zk_continuation: { exhausted: false } }) });
  ok(!NW.markZkNoWinners(sqlite, 'm-zc', 1).ok && row('m-zc').s === 'verifying', '已有 zk_continuation ⇒ 拒绝');
  ok(!NW.markZkNoWinners(sqlite, 'nope', 1).ok, '不存在的盘 ⇒ 不 ok');
}

console.log('[test] 3. cap 名额: 之前占着, 之后释放');
market('m-cap');
{
  const before = liveMarketCapReached(sqlite, { ZK_MAX_LIVE_MARKETS: '1', KASPA_NETWORK: 'simnet' });
  ok(before && before.ids.includes('m-cap'), `终态前 m-cap 算未完结(占名额; live=${before && before.live})`);
  NW.markZkNoWinners(sqlite, 'm-cap', 0);
  const after = listUnfinishedZkNativeMarkets(sqlite);
  ok(!after.some((x) => x.id === 'm-cap' || x.id === 'm-a'), '终态后不在"未完结"集 ⇒ 名额释放');
}

console.log('[test] 4. judge-propose tick: degenerate ⇒ 终态; ABSTAIN/其它错误 ⇒ 照旧重试');
{
  const mk = (over = {}) => { const calls = { build: 0, judge: 0 }; return { calls, ctx: { getCurrentDaaScore: async () => 10_000_000, judgeWinDir: async () => { calls.judge++; return 1; }, endBlockHash: async () => 'ab'.repeat(32), buildProposeCloseRequestV2: async () => { calls.build++; throw new Error(DEGEN); }, settlerRelayId: 's', ...over } }; };
  sqlite.prepare('DELETE FROM pool_markets').run();   // 清掉上面 2/3 节的夹具, 本节 tick 只看本节的盘
  market('m-tick');
  const { calls, ctx } = mk();
  quiet(); const r1 = await T.zkJudgeProposeAutonomousTick(ctx); loud();
  const m = JSON.parse(row('m-tick').m);
  ok(r1.noWinners === 1 && r1.errored === 0 && row('m-tick').s === 'completed' && m.no_winners === true && m.judged_winner === 1, `degenerate ⇒ completed + no_winners(tick: ${JSON.stringify(r1)})`);
  ok(calls.build === 1 && !m.bshard_close_request_v2 && !m.zk_continuation, '只调了一次 propose, 没有 close 请求/continuation(零链上动作)');
  quiet(); const r2 = await T.zkJudgeProposeAutonomousTick(ctx); loud();
  ok(r2.candidates === 0 && calls.build === 1, '第二轮: 不再是候选, 不再重试');
  const ev = sqlite.prepare("SELECT COUNT(*) c FROM events WHERE event_type = 'zkJudgeProposeTick_propose_error' AND summary LIKE '%m-tick%'").get().c;
  ok(ev === 0, '没有写 propose_error 事件(不再刷错误)');

  // ABSTAIN: judge 抛 ⇒ 不到 propose, 不写终态
  market('m-abst');
  const ab = mk({ judgeWinDir: async () => { throw new Error('ABSTAIN: polymarket condition not resolved'); } });
  quiet(); const r3 = await T.zkJudgeProposeAutonomousTick(ab.ctx); loud();
  ok(r3.errored === 1 && r3.noWinners === 0 && ab.calls.build === 0 && row('m-abst').s === 'verifying' && !JSON.parse(row('m-abst').m).no_winners, 'ABSTAIN ⇒ errored, 不 propose, 状态 verifying 不变, 无 no_winners(照旧重试)');
  // 其它 propose 错误(非 degenerate) ⇒ 照旧
  market('m-rpc');
  const rp = mk({ buildProposeCloseRequestV2: async () => { throw new Error('RPC timeout while building'); } });
  quiet(); const r4 = await T.zkJudgeProposeAutonomousTick(rp.ctx); loud();
  ok(r4.errored === 1 && r4.noWinners === 0 && row('m-rpc').s === 'verifying', '非 degenerate 的 propose 错误 ⇒ 照旧重试, 状态不动');
}

console.log('[test] 4b. 前置判定: 赢向一侧没人押 ⇒ 不 propose(省掉 consolidate 的链上花费)');
{
  ok(NW.hasWinningSideBettor([{ direction: 0, stake: '5' }], 0) === true && NW.hasWinningSideBettor([{ direction: 0, stake: 5 }], 1) === false && NW.hasWinningSideBettor([{ direction: 1, stake: 0 }], 1) === false && NW.hasWinningSideBettor([], 1) === false, 'hasWinningSideBettor: 同向有注 ⇒ true; 反向/零注/空 ⇒ false');
  const addBets = (logical, dirs) => { sqlite.prepare("INSERT OR REPLACE INTO pool_markets (id, maker_relay_id, protocol_version, protocol_status, deadline, market_metadata_hash, created_at, updated_at) VALUES (?, 'r', 'v0.7', 'shard_internal', 1, 'h', datetime('now'), datetime('now'))").run(logical + '-s0'); sqlite.prepare("INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at) VALUES (?, 0, ?, 'kaspasim:x', 'open', datetime('now'))").run(logical, logical + '-s0'); dirs.forEach((d, i) => sqlite.prepare("INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, created_at) VALUES (?, ?, ?, ?, 'p', ?, datetime('now'))").run(logical + '-s0', String(i + 1).repeat(64).slice(0, 64), d, 1000, `tx-${logical}-${i}`)); };
  const mk2 = () => { const calls = { build: 0 }; return { calls, ctx: { getCurrentDaaScore: async () => 10_000_000, judgeWinDir: async () => 1, endBlockHash: async () => 'ab'.repeat(32), buildProposeCloseRequestV2: async () => { calls.build++; return {}; }, settlerRelayId: 's' } }; };
  // 全押 YES(0), 判 NO(1) ⇒ 前置判定终态, build 一次都没调
  market('m-pre'); addBets('m-pre', [0, 0, 0]);
  const a = mk2(); quiet(); const ra = await T.zkJudgeProposeAutonomousTick(a.ctx); loud();
  ok(ra.noWinners === 1 && a.calls.build === 0 && row('m-pre').s === 'completed' && JSON.parse(row('m-pre').m).judged_winner === 1, `赢向无人押 ⇒ 终态且 propose 调用 0 次(tick ${JSON.stringify(ra)})`);
  // 有人押赢向 ⇒ 照常 propose
  sqlite.prepare('DELETE FROM pool_markets').run(); sqlite.prepare('DELETE FROM market_shards').run(); sqlite.prepare('DELETE FROM pool_bettor_sides').run();
  market('m-win'); addBets('m-win', [0, 1]);
  const b = mk2(); quiet(); const rb = await T.zkJudgeProposeAutonomousTick(b.ctx); loud();
  ok(rb.noWinners === 0 && b.calls.build === 1 && row('m-win').s === 'verifying', '赢向有人押 ⇒ 照常调 propose(前置判定不拦)');
  sqlite.prepare('DELETE FROM pool_markets').run(); sqlite.prepare('DELETE FROM market_shards').run(); sqlite.prepare('DELETE FROM pool_bettor_sides').run();
}

console.log('[test] 5. 其它 tick / 路径不再碰终态盘');
{ sqlite.prepare('DELETE FROM pool_markets').run(); market('m-tick'); NW.markZkNoWinners(sqlite, 'm-tick', 1); }
{
  const meta = JSON.parse(row('m-tick').m);
  ok(!zkReadyCandidateRows(sqlite).some((r) => r.id === 'm-tick'), 'close/claim/handoff 的候选 SQL 不含它(无 zk_continuation.proving.ready)');
  ok(deriveClosePins(sqlite).pins.every((p) => !String(p.tag || '').includes('m-tick')) && !meta.bshard_close_request_v2, 'resyncClosePins 无该盘(无 close 请求 ⇒ 没有 fee 钉, 释放无物)');
  const st = handleNoSpineChipMarket(sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get('m-tick'), sqlite, 2_000_000_000);
  ok(st.skip === true && st.action === 'left_to_zk_path' && row('m-tick').s === 'completed', '老 settler: handleNoSpineChipMarket 不动(status 已非 verifying/collecting_sigs)');
  const src = fs.readFileSync(new URL('../services/pool-market-settler.js', import.meta.url), 'utf8');
  ok(/protocol_status IN \('verifying', 'collecting_sigs', 'refunding', 'disputed'\)/.test(src), '老 settler 主选盘 SQL 只选 verifying/collecting_sigs/refunding/disputed(不含 completed)');
  // broker-fee-emit 候选条件(逐字同 services/broker-fee-emit.mjs): (completed ∧ settle_txid 非空) ∨ zk_continuation.exhausted=1
  const cand = sqlite.prepare(`SELECT id FROM pool_markets WHERE broker_pk IS NOT NULL AND json_extract(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at') IS NULL AND ((protocol_status = 'completed' AND settle_txid IS NOT NULL) OR json_extract(COALESCE(metadata, '{}'), '$.zk_continuation.exhausted') = 1)`).all();
  ok(!cand.some((r) => r.id === 'm-tick' || r.id === 'm-a'), 'broker-fee-emit 候选(settle_txid 空 ∧ 无 exhausted)不含它 ⇒ 不会去核对不存在的 claim 费');
  const feeSrc = fs.readFileSync(new URL('../services/broker-fee-emit.mjs', import.meta.url), 'utf8');
  ok(feeSrc.includes("(protocol_status = 'completed' AND settle_txid IS NOT NULL)") && feeSrc.includes("'$.zk_continuation.exhausted') = 1"), '上面那条 SQL 与 broker-fee-emit.mjs 的真实条件一致(防漂移)');
}

console.log('[test] 6. my-positions 辅助 + 结构');
{
  ok(noWinnersInfo({ no_winners: true, judged_winner: 1 })?.winDirection === 1 && noWinnersInfo({ no_winners: true, judged_winner: 0 })?.winDirection === 0, 'noWinnersInfo: judged_winner 0/1 ⇒ 返回');
  ok(noWinnersInfo({ no_winners: true }) === null && noWinnersInfo({ judged_winner: 1 }) === null && noWinnersInfo({ no_winners: true, judged_winner: 2 }) === null && noWinnersInfo(null) === null, 'noWinnersInfo: 缺/非法 ⇒ null(不乱判)');
  const pool = fs.readFileSync(new URL('../api/pool.js', import.meta.url), 'utf8');
  const iNW = pool.indexOf("noWinnersInfo(meta)"); const iZK = pool.indexOf('meta.zk_continuation.attestedWinner === 0 || meta.zk_continuation.attestedWinner === 1');
  ok(iNW > 0 && iZK > iNW && pool.includes('no_winners: noWinnersFlag'), 'pool.js: 无赢家分支在 ZK 原生分支之前, 输出恒带 no_winners 键');
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
