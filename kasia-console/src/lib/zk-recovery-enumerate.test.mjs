// zk-recovery-enumerate.test.mjs — 账本1867: 回收枚举器(只读)。注入假 rc/p2sh, 自举临时 migration 库。
//   覆盖: 参数优先级(盘上 zk_recovery_params > 当前 env)、票: 终态/未终态/已被花(gone)/年龄边界两侧、claim: need_cov_id / 叶重算 / token 个数、live 名额栏、命令构造形。
//   "绝不早于年龄"= 枚举器软门(notYet) + relay builder 硬门(见 kasia-relay recovery-builders.test.mjs)。
// Run: cd kasia-console && node src/lib/zk-recovery-enumerate.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { createHash } from 'crypto';
if (!process.env._ZKRE_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zkre_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _ZKRE_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { sqlite } = await import('../db/client.js');
const E = await import('./zk-recovery-enumerate.mjs');
const A = await import('./pool-bshard-artifacts.mjs');
sqlite.pragma('foreign_keys = OFF');

const SINK = 'ab'.repeat(32), SINK2 = 'cd'.repeat(32);
const ENV = { KASPA_NETWORK: 'simnet', ZK_SYSTEM_SINK_PK: SINK, ZK_CLAIM_RETIRE_DAA: '400', ZK_TICKET_SWEEP_DAA: '6000' };
const TMPL = { tokenTmplHash: '33'.repeat(32) };
const PK1 = '11'.repeat(32), PK2 = '22'.repeat(32), PK3 = '44'.repeat(32);
const stamped = (o = {}) => ({ sink_pk: SINK, retire_daa: 400, sweep_daa: 6000, claim_out_value_sompi: 40_000_000, stamped_at: 'x', source: 'create-v07', ...o });

const insMarket = (id, status, meta, extra = {}) => {
  const cols = sqlite.pragma('table_info(pool_markets)').filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id' && !c.pk);
  const row = { id, protocol_status: status, protocol_version: 'v0.7', metadata: JSON.stringify(meta), resolution_rule_spec: JSON.stringify({ zk_native: true }), ...extra };
  for (const c of cols) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x';
  sqlite.prepare(`INSERT OR REPLACE INTO pool_markets (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
};
let _lockSeq = 0;
const insShardSide = (logical, idx, pk, dir, stake) => {
  const sid = `${logical}-s${idx}`;
  insMarket(sid, 'shard_internal', {});
  sqlite.prepare('INSERT OR IGNORE INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh) VALUES (?,?,?,?)').run(logical, idx, sid, 'p2sh-x');
  const cols = sqlite.pragma('table_info(pool_bettor_sides)').filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id' && !c.pk);
  const row = { market_id: sid, bettor_pk: pk, direction: dir, stake_amount: stake, side_p2sh: 'x', side_lock_tx: String(++_lockSeq).padStart(64, '0') };
  for (const c of cols) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x';
  sqlite.prepare(`INSERT INTO pool_bettor_sides (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
};

// 假链: 地址 → utxos; p2sh = redeem 的可读指纹; 假 relay 记录调用。
const p2sh = (hex) => `addr:${createHash('sha256').update(hex).digest('hex').slice(0, 24)}`;
const chain = new Map();   // address → utxos
const calls = [];
let dryAge = { ageDaa: 7000, requiredDaa: 6000 };   // 假 relay 回的年龄
const rc = async (cmd) => {
  calls.push(cmd.type);
  if (cmd.type === 'get_address_utxos') return { ok: true, facts: true, utxos: chain.get(cmd.address) || [], truncated: false };
  if (cmd.type === 'zk_ticket_sweep' || cmd.type === 'zk_claim_retire') return { ok: true, broadcasted: false, ...dryAge, requiredDaa: cmd.type === 'zk_claim_retire' ? 400 : 6000, eligible: dryAge.ageDaa >= (cmd.type === 'zk_claim_retire' ? 400 : 6000) + 50 };
  return { ok: false, error: 'unsupported' };
};
const utxo = (n, amount, cov = null) => ({ outpoint: { transactionId: String(n).padStart(2, '0').repeat(32), index: 0 }, amount: amount.toString(), scriptPublicKey: { version: 0, scriptHex: '00' }, covenantId: cov });
const run = (o = {}) => E.enumerateRecovery({ db: sqlite, rc, p2sh, tmpl: TMPL, env: ENV, marginDaa: 100, ...o });

console.log('[test] 1. 参数优先级: 盘上 zk_recovery_params > 当前 env');
{
  const s = E.resolveMarketRecoveryParams({ zk_recovery_params: stamped({ retire_daa: 111, sink_pk: SINK2 }) }, ENV);
  ok(s.source === 'stamped' && s.retireDaa === 111 && s.sinkPkHex === SINK2, '有铸造时记录 ⇒ 用它(即使当前 env 已变)');
  const f = E.resolveMarketRecoveryParams({}, ENV);
  ok(f.source === 'env-fallback' && f.sinkPkHex === SINK && f.retireDaa === 400 && f.sweepDaa === 6000, '无记录(legacy 盘) ⇒ 回落当前 env 且标 env-fallback');
  ok(E.resolveMarketRecoveryParams({}, { KASPA_NETWORK: 'mainnet' }) === null, '无记录且 env 不全 ⇒ null(不猜)');
  ok(E.resolveMarketRecoveryParams({ zk_recovery_params: { sink_pk: 'zz', retire_daa: 1, sweep_daa: 1 } }, ENV).source === 'env-fallback', '盘上记录畸形 ⇒ 不信, 回落 env(并标出来)');
}

console.log('[test] 2. 票: 终态 + 年龄边界 + gone + 未终态不扫');
{
  insMarket('mk-term', 'completed', { zk_recovery_params: stamped() });
  insShardSide('mk-term', 0, PK1, 0, 1_000_000_000);
  insMarket('mk-live', 'verifying', { zk_recovery_params: stamped() });
  insShardSide('mk-live', 0, PK2, 1, 2_000_000_000);
  const hex32 = (await import('@noble/hashes/blake2b')).blake2b;
  const pool0 = Buffer.from(hex32(Buffer.from('mk-term-shard-0'), { dkLen: 32 })).toString('hex');
  const art = A.computePoolSideTicketArtifact({ bettorPk: PK1, direction: 0, stake: 1_000_000_000, shardPoolId: pool0, sinkPkHex: SINK, sweepDaa: 6000 });
  chain.set(p2sh(art.script.toString('hex')), [utxo(7, 7_000_000)]);
  calls.length = 0;
  let r = await run({ onlyMarkets: ['mk-term', 'mk-live'] });
  ok(r.sweepable.length === 1 && r.sweepable[0].kind === 'ticket' && r.sweepable[0].market_id === 'mk-term' && r.sweepable[0].sum_in_sompi === '7000000', '终态盘的票 ⇒ sweepable');
  ok(r.sweepable[0].sink_pk_hex === SINK && r.sweepable[0].sweep_daa === 6000, '命令参数来自盘上记录');
  ok(r.skipped.some((s) => s.market_id === 'mk-live' && /market_not_terminal/.test(s.reason)) && !calls.some((c, i) => false), '未终态盘 ⇒ skipped(market_not_terminal), 不扫结算期内的票');
  ok(!r.sweepable.concat(r.notYet).some((i) => i.market_id === 'mk-live'), '未终态盘的票不进任何清单(即使链上有)');
  dryAge = { ageDaa: 6000 + 100 - 1, requiredDaa: 6000 };
  r = await run({ onlyMarkets: ['mk-term'] });
  ok(r.sweepable.length === 0 && r.notYet.length === 1 && r.notYet[0].eligible === false, '年龄 = 门槛 + 余量 − 1 ⇒ notYet(不在可执行清单)');
  dryAge = { ageDaa: 6000 + 100, requiredDaa: 6000 };
  r = await run({ onlyMarkets: ['mk-term'] });
  ok(r.sweepable.length === 1 && r.notYet.length === 0, '年龄 = 门槛 + 余量 ⇒ sweepable');
  dryAge = { ageDaa: 5999, requiredDaa: 6000 };
  r = await run({ onlyMarkets: ['mk-term'] });
  ok(r.sweepable.length === 0 && r.notYet.length === 1, '年龄 = 门槛 − 1 ⇒ notYet');
  chain.set(p2sh(art.script.toString('hex')), []);
  r = await run({ onlyMarkets: ['mk-term'] });
  ok(r.skipped.some((s) => s.kind === 'ticket' && /^gone/.test(s.reason)) && !r.sweepable.length && !r.notYet.length, 'UTXO 已不在(已回收) ⇒ skipped(gone), 重复运行幂等');
  chain.set(p2sh(art.script.toString('hex')), [utxo(7, 7_000_000)]);
  dryAge = { ageDaa: 9000, requiredDaa: 6000 };
  const rNoProbe = await run({ onlyMarkets: ['mk-term'], dryRunProbe: false });
  ok(rNoProbe.sweepable.length === 1 && rNoProbe.sweepable[0].age === undefined, 'dryRunProbe=false ⇒ 只列清单、不判年龄(不调 relay builder)');
  // 参数漂移: 盘上记录的 sink 与当前 env 不同 ⇒ 用盘上记录的 redeem(找得到票), 而不是 env 的(找不到)
  insMarket('mk-drift', 'completed', { zk_recovery_params: stamped({ sink_pk: SINK2 }) });
  insShardSide('mk-drift', 0, PK3, 0, 500_000_000);
  const pd = Buffer.from(hex32(Buffer.from('mk-drift-shard-0'), { dkLen: 32 })).toString('hex');
  const artD = A.computePoolSideTicketArtifact({ bettorPk: PK3, direction: 0, stake: 500_000_000, shardPoolId: pd, sinkPkHex: SINK2, sweepDaa: 6000 });
  chain.set(p2sh(artD.script.toString('hex')), [utxo(9, 7_000_000)]);
  r = await run({ onlyMarkets: ['mk-drift'] });
  ok(r.sweepable.length === 1 && r.sweepable[0].sink_pk_hex === SINK2 && r.sweepable[0].params_source === 'stamped', 'env 变了也能按铸造时 sink 找到并回收(漏回收 = 钱永远锁着)');
}

console.log('[test] 3. claim: need_cov_id / 叶重算 / token 个数 / 命令形');
{
  const logical = 'mk-claim';
  insMarket(logical, 'attested_v2', { zk_recovery_params: stamped(), zk_continuation: { exhausted: true, attestedWinner: 0, poolAtZkCloseSompi: '4000000000', outpoint: null, redeemHex: null } });
  insShardSide(logical, 0, PK1, 0, 1_000_000_000);
  insShardSide(logical, 0, PK2, 0, 2_000_000_000);   // 两个赢家押注额不同 ⇒ 叶面值不同 ⇒ 各自 KTT 地址不同
  insShardSide(logical, 0, PK3, 1, 1_000_000_000);
  let r = await run({ onlyMarkets: [logical] });
  ok(r.skipped.some((s) => s.kind === 'claim' && /^need_cov_id/.test(s.reason)), '续约已耗尽且盘上无 zk_self_cov_id ⇒ skipped(need_cov_id)(不猜)');
  const COV = 'ee'.repeat(32), CLAIMCOV = 'f1'.repeat(32);
  r = await run({ onlyMarkets: [logical], covIdOverrides: { [logical]: COV } });
  ok(!r.skipped.some((s) => /need_cov_id/.test(s.reason)), '运维 --cov-id 覆盖 ⇒ 继续');
  ok(r.skipped.filter((s) => s.kind === 'claim' && /^gone/.test(s.reason)).length >= 1, '链上无该叶 claim UTXO ⇒ skipped(gone)');
  // 种出每个赢家叶的 claim + token UTXO
  const { computePariMutuelPayout } = await import('./pool-shard-settle.mjs');
  const pm = computePariMutuelPayout({ bettors: [{ pk: PK1, stake: '1000000000', direction: 0 }, { pk: PK2, stake: '2000000000', direction: 0 }, { pk: PK3, stake: '1000000000', direction: 1 }], winningDirection: 0, poolTotalSompi: '4000000000', feeLeaves: [] });
  let n = 20;
  for (const l of pm.payoutLeaves) {
    const ca = A.computeKanetTokenClaimArtifact({ marketCovIdHex: COV, winnerPkHex: l.pk, amount: BigInt(l.amount), tokenTmplHashHex: TMPL.tokenTmplHash, sinkPkHex: SINK, retireDaa: 400 });
    chain.set(p2sh(ca.script.toString('hex')), [utxo(n++, 40_000_000, CLAIMCOV)]);
    const ktt = A.computeKttTokenArtifact({ amount: Number(l.amount), ownerCovIdHex: CLAIMCOV });
    chain.set(p2sh(ktt.script.toString('hex')), [utxo(n++, 40_000_000, 'a1'.repeat(32))]);
  }
  dryAge = { ageDaa: 5000, requiredDaa: 400 };
  r = await run({ onlyMarkets: [logical], covIdOverrides: { [logical]: COV } });
  ok(r.retirable.length === pm.payoutLeaves.length && r.retirable.every((i) => i.kind === 'claim' && i.sum_in_sompi === '80000000' && i.retire_daa === 400 && i.sink_pk_hex === SINK), `每个赢家叶一对(claim,token) ⇒ ${pm.payoutLeaves.length} 个 retirable, Σin = 两枚面值之和`);
  const cmd = E.buildRetireCommand(r.retirable[0], { dry_run: true });
  ok(cmd.type === 'zk_claim_retire' && cmd.dry_run === true && cmd.inputs.claim.index === 0 && cmd.witness.retire_dispatch_tag_hex === r.retirable[0].witness.claim_entry_abi.dispatch_tag && /^[0-9a-f]{8}$/.test(cmd.witness.retire_dispatch_tag_hex), 'retire 命令: 类型/dry_run/dispatch tag(来自编译 ABI)');
  ok(!('to' in cmd) && !('change_address' in cmd) && !('outputs' in cmd), '命令里没有 to/change_address/outputs(去向不可指定)');
  ok(!('dry_run' in E.buildRetireCommand(r.retirable[0])), '真执行命令不带 dry_run');
  const sw = E.buildSweepCommand({ sink_pk_hex: SINK, sweep_daa: 6000, ticket: { redeemHex: 'aa', outpoint: { transactionId: 'bb'.repeat(32), index: 0 } }, witness: { sweep_entry_abi: { dispatch_tag: '40775ad9' } } }, { dry_run: true });
  ok(sw.type === 'zk_ticket_sweep' && sw.witness.sweep_dispatch_tag_hex === '40775ad9' && sw.dry_run === true, 'sweep 命令形');
  dryAge = { ageDaa: 399, requiredDaa: 400 };
  r = await run({ onlyMarkets: [logical], covIdOverrides: { [logical]: COV } });
  ok(r.retirable.length === 0 && r.notYet.length === pm.payoutLeaves.length, 'claim 年龄 = 门槛 − 1 ⇒ 全部 notYet, retirable 为空');
  // token UTXO 个数 ≠ 1 ⇒ 不猜
  const l0 = pm.payoutLeaves[0];
  chain.set(p2sh(A.computeKttTokenArtifact({ amount: Number(l0.amount), ownerCovIdHex: CLAIMCOV }).script.toString('hex')), []);
  dryAge = { ageDaa: 5000, requiredDaa: 400 };
  r = await run({ onlyMarkets: [logical], covIdOverrides: { [logical]: COV } });
  ok(r.skipped.some((s) => /token_utxo_count=0/.test(s.reason)) && r.retirable.length === pm.payoutLeaves.length - 1, 'token UTXO 缺 ⇒ 该叶 skipped, 其余不受影响');
}

console.log('[test] 4. live 名额占用者栏(只读, 与 create-v07 同源)');
{
  insMarket('mk-stuck', 'verifying', {});
  const r = await run({ onlyMarkets: ['mk-term'] });
  ok(r.liveSlotHolders.some((m) => m.id === 'mk-stuck') && r.liveSlotHolders.some((m) => m.id === 'mk-live') && !r.liveSlotHolders.some((m) => m.id === 'mk-term'), '未完结盘列出, 终态盘不列');
  ok(r.cap === 1, 'cap = resolveMaxLiveMarkets(env)');
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
