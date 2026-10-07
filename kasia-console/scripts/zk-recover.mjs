#!/usr/bin/env node
// zk-recover.mjs — 账本1867: 回收操作员脚本(KanetTokenClaim.retire / PoolSideTicket.sweep)。设计 docs/2026-10-05-j2-retire-sweep-tool-design-v0.1.md。
//
// 默认【只读 dry-run】(--max 0): 打印 retirable(年龄够) / notYet(未到龄) / skipped(含原因) / 名额占用者, 不广播任何东西。
// 真执行必须显式 --max N(N≥1), 一次最多 N 笔; 每笔无签名、无钱包输入, 去向 = 盘上 zk_recovery_params 的 sink_pk(烤死在合约里)。
// 不碰私钥: 本脚本不加载钱包、不读任何 key env; 构造器(kasia-relay p2sh.mjs unlockClaimRetire/unlockTicketSweep)只广播。
//
// 用法:
//   DB_PATH=<console 库绝对路径> KASPA_RPC_URL=ws://... KASPA_NETWORK=<simnet|mainnet> \
//   ZK_TOKEN_TMPL_HASH=... ZK_CLAIM_TMPL_HASH=... (同 console env) \
//     node scripts/zk-recover.mjs [--max N] [--kind claim|ticket|all] [--market <id 或末段>] [--cov-id <末8位>=<64hex>] [--margin <DAA, 默认 1000>] [--json] [--mainnet-ok]
//   主网: 必须带 --mainnet-ok(防误跑); 强烈建议 DB_PATH 指向库的拷贝做 dry-run。
// 只读栏「live 名额占用者」= listUnfinishedZkNativeMarkets(与 create-v07 的 ZK_MAX_LIVE_MARKETS 闸同源): 卡死的盘会一直占名额。
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const optAll = (n) => argv.flatMap((a, i) => (a === n && i + 1 < argv.length ? [argv[i + 1]] : []));

const maxN = Number(opt('--max', '0'));
if (!Number.isInteger(maxN) || maxN < 0 || maxN > 50) { console.error('[zk-recover] --max 必须是 0..50 的整数(0 = 只读 dry-run)'); process.exit(2); }
const kind = opt('--kind', 'all');
if (!['claim', 'ticket', 'all'].includes(kind)) { console.error('[zk-recover] --kind 只能是 claim|ticket|all'); process.exit(2); }
const network = process.env.KASPA_NETWORK_ID || process.env.KASPA_NETWORK || '';
if (!network) { console.error('[zk-recover] 需要 KASPA_NETWORK(或 KASPA_NETWORK_ID)'); process.exit(2); }
if (/^mainnet/i.test(network) && !flag('--mainnet-ok')) { console.error('[zk-recover] 主网: 必须显式带 --mainnet-ok(即使是 dry-run)。拒绝。'); process.exit(2); }
if (!process.env.DB_PATH) { console.error('[zk-recover] 需要 DB_PATH(显式指向库; 建议主网用拷贝做 dry-run)'); process.exit(2); }
if (!process.env.KASPA_RPC_URL) { console.error('[zk-recover] 需要 KASPA_RPC_URL'); process.exit(2); }

const covIdOverrides = {};
for (const kv of optAll('--cov-id')) { const m = /^([^=]+)=([0-9a-f]{64})$/.exec(kv); if (!m) { console.error(`[zk-recover] --cov-id 格式: <盘id末段>=<64hex>, got ${kv}`); process.exit(2); } covIdOverrides[m[1]] = m[2]; }

const relay = await import(pathToFileURL(resolve(HERE, '../../kasia-relay/src/lib/p2sh.mjs')).href);
const { sqlite } = await import('../src/db/client.js');
const { readZkTemplateHashes } = await import('../src/lib/pool-shard-register.mjs');
const { enumerateRecovery, buildRetireCommand, buildSweepCommand } = await import('../src/lib/zk-recovery-enumerate.mjs');

const tmpl = readZkTemplateHashes();
if (!tmpl.ok) { console.error(`[zk-recover] ZK 模板 env 缺失/非法: ${[...tmpl.missing, ...tmpl.malformed].join('/')}`); process.exit(2); }

// rc: 与 relay IPC 同形的命令分发(同一份 builder, 不另起 relay 子进程 ⇒ 本脚本不持有钱包)。
const rc = async (cmd) => {
  try {
    if (cmd.type === 'get_address_utxos') return await relay.recoveryGetFacts(cmd.address, network);
    if (cmd.type === 'zk_claim_retire') return { ok: true, ...(await relay.unlockClaimRetire({ cmd, networkId: network })) };
    if (cmd.type === 'zk_ticket_sweep') return { ok: true, ...(await relay.unlockTicketSweep({ cmd, networkId: network })) };
    return { ok: false, error: `unsupported cmd ${cmd.type}` };
  } catch (e) { return { ok: false, error: e.message }; }
};
const p2sh = (redeemHex) => relay._addressFromRedeem(redeemHex, network);

const res = await enumerateRecovery({ db: sqlite, rc, p2sh, tmpl, env: process.env, covIdOverrides, onlyMarkets: opt('--market') ? [opt('--market')] : null, ...(opt('--margin') !== null ? { marginDaa: Number(opt('--margin')) } : {}) });
const wantClaim = kind !== 'ticket', wantTicket = kind !== 'claim';
const retirable = wantClaim ? res.retirable : [], sweepable = wantTicket ? res.sweepable : [];
const sompi = (s) => (Number(BigInt(s)) / 1e8).toFixed(8);

if (flag('--json')) console.log(JSON.stringify({ ...res, retirable, sweepable }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
else {
  const short = (x) => String(x).slice(-8);
  console.log(`[zk-recover] network=${network} max=${maxN} (${maxN === 0 ? 'DRY-RUN: 不广播' : '将真执行'}) kind=${kind}`);
  console.log(`\n== live 名额占用者 (${res.liveSlotHolders.length}/${res.cap}) ==`);
  for (const m of res.liveSlotHolders) console.log(`  ${m.id}  status=${m.protocol_status}`);
  console.log(`\n== 可 retire 的 claim (${retirable.length}) ==`);
  for (const it of retirable) console.log(`  market=…${short(it.market_id)} leaf=${it.leaf_index} amount=${it.amount} Σin=${sompi(it.sum_in_sompi)} KAS age=${it.age?.ageDaa}/${it.age?.requiredDaa} claim=${it.claim.outpoint.transactionId.slice(0, 12)}:${it.claim.outpoint.index} params=${it.params_source}`);
  console.log(`\n== 可 sweep 的票 (${sweepable.length}) ==`);
  for (const it of sweepable) console.log(`  market=…${short(it.market_id)} shard=${it.shard_index} pk=${it.bettor_pk.slice(0, 10)}… Σin=${sompi(it.sum_in_sompi)} KAS age=${it.age?.ageDaa}/${it.age?.requiredDaa} params=${it.params_source}`);
  console.log(`\n== 未到龄 (${res.notYet.length}) ==`);
  for (const it of res.notYet) console.log(`  ${it.kind} market=…${short(it.market_id)} age=${it.age?.ageDaa}/${it.age?.requiredDaa}(+余量 ${res.marginDaa}) 还差 ${Math.max(0, it.age.requiredDaa + res.marginDaa - it.age.ageDaa)} DAA`);
  console.log(`\n== skipped (${res.skipped.length}) ==`);
  for (const s of res.skipped) console.log(`  ${s.kind} market=…${short(s.market_id)} ${s.reason}`);
}

if (maxN === 0) { console.log('\n[zk-recover] dry-run 完成(--max 0), 未广播任何交易。'); process.exit(0); }

// ── 真执行(逐笔, 先 claim 后票; 每笔落链确认后才记账 = NO TX NO STATE CHANGE) ──
const queue = [...retirable.map((it) => ({ it, cmd: buildRetireCommand(it) })), ...sweepable.map((it) => ({ it, cmd: buildSweepCommand(it) }))].slice(0, maxN);
let done = 0, failed = 0;
for (const { it, cmd } of queue) {
  const r = await rc(cmd);
  if (r?.ok !== true || !r.txId) { failed++; console.error(`  ❌ ${it.kind} market=…${String(it.market_id).slice(-8)}: ${r?.error || JSON.stringify(r)}`); continue; }
  const sinkAddr = relay.recoverySinkAddress(it.sink_pk_hex, network);
  let landed = false;
  for (let i = 0; i < 20 && !landed; i++) { try { landed = (await relay.checkUtxoLanded(sinkAddr, r.txId, network, 3))?.landed === true; } catch { /* 重试 */ } if (!landed) await new Promise((res2) => setTimeout(res2, 1500)); }
  if (!landed) { failed++; console.error(`  ⚠️ ${it.kind} txid=${r.txId} 广播 OK 但落链确认超时 — 零记账, 请人工核链`); continue; }
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(it.market_id);
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  if (!Array.isArray(meta.zk_recovery_audit)) meta.zk_recovery_audit = [];
  meta.zk_recovery_audit.push({ kind: it.kind, txid: r.txId, at: new Date().toISOString(), sink_pk: it.sink_pk_hex, sum_in_sompi: it.sum_in_sompi, sink_value_sompi: r.sinkValueSompi, fee_sompi: r.feeSompi, ...(it.kind === 'claim' ? { leaf_index: it.leaf_index, bettor_pk: it.bettor_pk } : { shard_index: it.shard_index, bettor_pk: it.bettor_pk }) });
  sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), it.market_id);
  done++;
  console.log(`  ✅ ${it.kind} market=…${String(it.market_id).slice(-8)} txid=${r.txId} sink +${sompi(r.sinkValueSompi)} KAS(费 ${sompi(r.feeSompi)})`);
}
console.log(`\n[zk-recover] 执行完毕: 成功 ${done} / 失败 ${failed} / 计划 ${queue.length}(--max ${maxN})`);
process.exit(failed ? 1 : 0);
