// mm_cases.mjs — simnet only: 三种"真人会撞到"的筹码盘情形, 一次一盘串行跑完整条 ZK 链(close→handoff→claim), 报最终 protocol_status / 关键 metadata / 系统钱包 KAS 净成本 / my-positions。
//   C = 全押 YES 且 NO 赢(无赢家)   A = 只有 1 注(YES, YES 赢)   B = 单边 3 注全 YES 且 YES 赢
// 用法: node mm_cases.mjs <tag> [C,A,B]      需: simnet console(tag) 已起, POOL_SEED_TARGET=1 且 ZK_MAX_LIVE_MARKETS=1(一次一盘, 才能逐盘记账), 无 gamma 桩(本脚本自己起/杀桩)。
// 赢家方向由桩的 conditionId 奇偶决定: cond 字节偶 ⇒ YES(方向 0)赢, 奇 ⇒ NO(方向 1)赢。每盘用新 condBase(避开种子器去重)。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { relays, kaspa, rpcConnect, sleep, log } from '../2026-10-05-j2-strict-zero/szlib.mjs';

const TAG = process.argv[2] || 'fee3';
const ORDER = (process.argv[3] || 'C,A,B').split(',');
const OUT = 'D:/kanet-tn12/scratch/_j2_mm';
const Db = createRequire('D:/kanet-tn12/kasia-console/')('better-sqlite3');
const db = new Db(`${OUT}/console.mm.${TAG}.db`, { readonly: true });
const rpc = await rpcConnect();
const SYS = { maker: relays.maker, settler: relays.settler, fee: relays.fee };
const B = { bettorA: relays.bettorA, bettorB: relays.bettorB };
const CASES = {
  C: { name: 'C 无赢家: 3 注全 YES, NO 赢', winner: 1, bets: [['A', 0, 1e9], ['B', 0, 2e9], ['X', 0, 1e9]] },
  A: { name: 'A 只有 1 注: YES, YES 赢', winner: 0, bets: [['A', 0, 1e9]] },
  B: { name: 'B 单边赢: 3 注全 YES, YES 赢', winner: 0, bets: [['A', 0, 1e9], ['B', 0, 2e9], ['X', 0, 1e9]] },
};
const sysBal = async () => { let t = 0n; for (const r of Object.values(SYS)) t += BigInt((await rpc.getBalanceByAddress({ address: r.address })).balance); return t; };
const bettorBal = async () => Object.fromEntries(await Promise.all(Object.entries(B).map(async ([n, r]) => [n, String(BigInt((await rpc.getBalanceByAddress({ address: r.address })).balance))])));
const killStub = () => { try { spawn('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mm_stubs' -and $_.Name -match 'node' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' }); } catch {} };
const xonly = (i) => new kaspa.PrivateKey(Buffer.from(Array.from({ length: 32 }, (_, k) => (i * 11 + k * 17 + 77) & 0xff)).toString('hex')).toPublicKey().toXOnlyPublicKey().toString();
const who = { A: { linked_addr: B.bettorA.address }, B: { linked_addr: B.bettorB.address }, X: { bettor_pk: xonly(1) } };
const results = [];
let baseCounter = 160;
for (const key of ORDER) {
  const c = CASES[key];
  log(`\n===== case ${c.name} =====`);
  killStub(); await sleep(1500);
  baseCounter += 8;   // 160,168,176(偶): 每盘换一段 conditionId(避开种子器按 outcome_condition_id 去重)
  const condBase = baseCounter + (c.winner === 1 ? 1 : 0);   // 偶 ⇒ YES 赢, 奇 ⇒ NO 赢(桩: cond 首字节奇偶)
  const endMs = Date.now() + 7 * 60_000;
  spawn(process.execPath, [new URL('./mm_stubs.mjs', import.meta.url).pathname.replace(/^\//, ''), String(endMs), String(condBase)], { stdio: 'ignore', detached: true }).unref();
  await sleep(2500);
  const pre = new Set(db.prepare('SELECT id FROM pool_markets').all().map((r) => r.id));
  const bal0 = await sysBal(), bb0 = await bettorBal();
  await fetch('http://127.0.0.1:3399/arm', { method: 'POST' });
  let m = null;
  for (let t = 0; t < 120 && !m; t++) { m = db.prepare("SELECT id, outcome_condition_id, deadline FROM pool_markets WHERE protocol_status='pending_bettors' AND id NOT LIKE '%-s%'").all().find((r) => !pre.has(r.id)); if (!m) await sleep(3000); }
  if (!m) { results.push({ case: key, error: 'no market created' }); continue; }
  const condParity = parseInt(String(m.outcome_condition_id).slice(2, 4), 16) % 2;
  log(`market ${m.id} cond=${String(m.outcome_condition_id).slice(0, 12)}… 预期赢家方向=${condParity} (期望 ${c.winner}) deadline=${new Date(m.deadline * 1000).toISOString()}`);
  const betLog = [];
  for (const [w, dir, units] of c.bets) {
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:3298/api/pool/market/${m.id}/bettor/register-v07`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...who[w], direction: dir, stake_ktt: units }) });
    const j = await r.json().catch(() => ({}));
    betLog.push({ who: w, dir, units, status: r.status, ms: Date.now() - t0, bettor_pk: j.bettor_pk, err: r.status === 200 ? undefined : j });
    log(`  bet ${w} dir=${dir} units=${units} ⇒ ${r.status} (${Date.now() - t0}ms)`);
  }
  // 等终态
  const T0 = Date.now(); let last = '';
  let row;
  for (;;) {
    row = db.prepare('SELECT protocol_status s, metadata md FROM pool_markets WHERE id = ?').get(m.id);
    let meta = {}; try { meta = JSON.parse(row.md || '{}'); } catch {}
    const exhausted = meta.zk_continuation?.exhausted === true;
    const cur = `${row.s}${exhausted ? '/exhausted' : ''} claims=${(meta.zk_escape_audit || []).filter((e) => e.entry === 'claim').length}`;
    if (cur !== last) { log(`  ${new Date().toISOString().slice(11, 19)} ${cur}`); last = cur; }
    if (exhausted || ['cancelled', 'refunded', 'completed'].includes(row.s)) break;
    if (Date.now() - T0 > 30 * 60_000) { log('  TIMEOUT 30min'); break; }
    await sleep(10_000);
  }
  await sleep(15_000);
  const bal1 = await sysBal(), bb1 = await bettorBal();
  row = db.prepare('SELECT protocol_status s, metadata md FROM pool_markets WHERE id = ?').get(m.id);
  let meta = {}; try { meta = JSON.parse(row.md || '{}'); } catch {}
  const mp = {};
  for (const [n, r] of Object.entries(B)) { try { const res = await fetch(`http://127.0.0.1:3298/api/pool/my-positions?linked_addr=${encodeURIComponent(r.address)}`); const j = await res.json(); mp[n] = (j.positions || []).filter((p) => String(p.logical_market_id || p.market_id).startsWith(m.id)); } catch (e) { mp[n] = String(e.message); } }
  const keep = (({ zk_continuation, attestedWinner, zk_escape_audit, cancel_reason, cancel_pool_sompi, refund_reason, close_error, zk_handoff_state, judge_state }) => ({ zk_continuation, attestedWinner, zk_escape_audit, cancel_reason, cancel_pool_sompi, refund_reason, close_error, zk_handoff_state, judge_state }))(meta);
  const res1 = { case: key, name: c.name, market: m.id, finalStatus: row.s, systemWalletDeltaSompi: String(bal0 - bal1), systemWalletDeltaKAS: Number(bal0 - bal1) / 1e8, bettorBalBefore: bb0, bettorBalAfter: bb1, bets: betLog, metaKeys: Object.keys(meta), meta: keep, myPositions: mp, seconds: Math.round((Date.now() - T0) / 1000) };
  results.push(res1);
  log(`  FINAL ${row.s}  system wallets Δ = ${res1.systemWalletDeltaKAS} KAS  bettors Δ0=${JSON.stringify(bb0) === JSON.stringify(bb1)}`);
  writeFileSync(`${OUT}/mm_cases.${TAG}.json`, JSON.stringify(results, (k, v) => typeof v === 'bigint' ? String(v) : v, 1));
}
killStub();
log('\nALL CASES DONE');
setTimeout(() => process.exit(0), 300);
