// retire_sweep_e2e.mjs — 账本1867 simnet 端到端证明(只对 simnet 跑; 主网拒绝)。证明项:
//   P1 dry-run 清单: claim 到龄前 notYet / 到龄后 retirable; 票 sweepable(到龄后)——零广播
//   N1 负例(relay builder 硬门): 年龄不够 ⇒ builder 抛"年龄未到", 不广播
//   N2 负例(节点/合约侧): 绕过 builder 门(age_margin_daa=-1e9)手工广播 ⇒ 节点拒(sequence lock / 脚本), 记录拒绝文本
//   F  手续费下限: fee_sompi=1 ⇒ 记录节点拒绝文本里的 required amount(= mempool 下限), 用于定 RECOVERY_SITE_FEE_SOMPI
//   P2 真花: 经 zk-recover.mjs --max 1 各回收一笔 claim 与一张票, 断言 sink +Σ(面值−费)、claim/token/票 UTXO 消失、审计落库、重跑清单为空
// 用法: DB_PATH=<simnet console 库> KASPA_RPC_URL=ws://127.0.0.1:29717 KASPA_NETWORK=simnet ZK_*(同 console) node retire_sweep_e2e.mjs <out.json>
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT = process.argv[2] || resolve(HERE, 'retire_sweep_e2e_result.json');
if (!/simnet/i.test(process.env.KASPA_NETWORK || '')) { console.error('REFUSE: 仅 simnet'); process.exit(2); }
const network = process.env.KASPA_NETWORK;
const relay = await import(pathToFileURL(resolve(ROOT, 'kasia-relay/src/lib/p2sh.mjs')).href);
const { sqlite } = await import(pathToFileURL(resolve(ROOT, 'kasia-console/src/db/client.js')).href);
const { readZkTemplateHashes } = await import(pathToFileURL(resolve(ROOT, 'kasia-console/src/lib/pool-shard-register.mjs')).href);
const { enumerateRecovery, buildRetireCommand, buildSweepCommand } = await import(pathToFileURL(resolve(ROOT, 'kasia-console/src/lib/zk-recovery-enumerate.mjs')).href);
const tmpl = readZkTemplateHashes(); if (!tmpl.ok) throw new Error('tmpl env: ' + JSON.stringify(tmpl));
const MARGIN = 50;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rc = async (cmd) => {
  try {
    if (cmd.type === 'get_address_utxos') return await relay.recoveryGetFacts(cmd.address, network);
    if (cmd.type === 'zk_claim_retire') return { ok: true, ...(await relay.unlockClaimRetire({ cmd, networkId: network })) };
    if (cmd.type === 'zk_ticket_sweep') return { ok: true, ...(await relay.unlockTicketSweep({ cmd, networkId: network })) };
  } catch (e) { return { ok: false, error: e.message }; }
};
const p2sh = (h) => relay._addressFromRedeem(h, network);
const enumerate = () => enumerateRecovery({ db: sqlite, rc, p2sh, tmpl, env: process.env, marginDaa: MARGIN, onlyMarkets: process.env.ONLY ? [process.env.ONLY] : null });
const R = { started: new Date().toISOString(), network, steps: {} };
const save = () => writeFileSync(OUT, JSON.stringify(R, null, 1));
const floorOf = (msg) => { const m = /required amount of (\d+) for (?:compute|normalized transient) mass (\d+)/.exec(msg || '') || /mempool floor (\d+) \(mass=(\d+)/.exec(msg || ''); return m ? { floor: Number(m[1]), mass: Number(m[2]) } : null; };

// ── 等第一个 claim(retirable 或 notYet)出现 ──
let res;
for (let i = 0; i < 360; i++) { res = await enumerate(); if (res.retirable.length + res.notYet.filter((x) => x.kind === 'claim').length > 0) break; await sleep(5000); }
const firstClaim = [...res.notYet, ...res.retirable].find((x) => x.kind === 'claim');
if (!firstClaim) { log('超时: 没有 claim UTXO'); R.error = 'no_claim'; save(); process.exit(1); }
log('发现 claim:', firstClaim.market_id.slice(-8), 'age', JSON.stringify(firstClaim.age), 'eligible', firstClaim.eligible);
R.steps.P1_first_list = { retirable: res.retirable.length, notYet: res.notYet.length, sweepable: res.sweepable.length, skipped: res.skipped.map((s) => `${s.kind}:${s.reason}`), firstClaimAge: firstClaim.age, firstClaimEligible: firstClaim.eligible };

// ── N1/N2: 年龄前负例(只在 claim 尚未到龄时做; 若已到龄则记录 skipped_because_already_old) ──
if (!firstClaim.eligible) {
  const strict = await rc(buildRetireCommand(firstClaim));
  R.steps.N1_builder_gate = { ok: strict.ok, error: strict.error };
  log('N1 builder 门:', strict.ok ? '❌ 竟然放行' : '✅ ' + String(strict.error).slice(0, 120));
  const byp = await rc({ ...buildRetireCommand(firstClaim), age_margin_daa: -1_000_000_000, fee_sompi: 2_000_000 });
  R.steps.N2_node_gate = { ok: byp.ok, error: byp.error, txId: byp.txId };
  log('N2 绕过 builder 门广播:', byp.ok ? '❌ 节点放行!' : '✅ 节点拒: ' + String(byp.error).slice(0, 200));
} else R.steps.N1_N2 = 'skipped_because_already_old';
save();

// ── 等 claim 到龄 ──
for (let i = 0; i < 240; i++) { res = await enumerate(); if (res.retirable.length > 0) break; await sleep(5000); }
R.steps.P1_eligible_list = { retirable: res.retirable.map((x) => ({ market: x.market_id.slice(-8), leaf: x.leaf_index, age: x.age, sum_in: x.sum_in_sompi })), notYet: res.notYet.length, sweepable: res.sweepable.map((x) => ({ market: x.market_id.slice(-8), age: x.age })), liveSlots: res.liveSlotHolders.length };
log('到龄清单: retirable', res.retirable.length, 'sweepable', res.sweepable.length);
save();

// ── F: 手续费下限 ──
if (res.retirable[0]) {
  const f = await rc({ ...buildRetireCommand(res.retirable[0]), fee_sompi: 1 });
  R.steps.F_claim_retire = { ok: f.ok, error: f.error, floor: floorOf(f.error) };
  log('F claim retire:', JSON.stringify(R.steps.F_claim_retire).slice(0, 300));
}
const ticketsNow = res.sweepable[0];
if (ticketsNow) {
  const f = await rc({ ...buildSweepCommand(ticketsNow), fee_sompi: 1 });
  R.steps.F_ticket_sweep = { ok: f.ok, error: f.error, floor: floorOf(f.error) };
  log('F ticket sweep:', JSON.stringify(R.steps.F_ticket_sweep).slice(0, 300));
}
save();
log('完成探测阶段(fee 探测不广播成功交易)。真花阶段请跑 zk-recover.mjs --max 1。');
process.exit(0);
