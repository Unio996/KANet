// budget_search.mjs — simnet only: 找 retire/sweep 各输入最小可行 computeBudget(预算越小 compute mass 越小 ⇒ 手续费下限越低)。
// 失败的尝试不花钱(脚本被拒); 第一次成功即真花一笔(simnet)。用法: 同 retire_sweep_e2e.mjs 的 env; node budget_search.mjs <claim|ticket> <b1,b2,...> [tokBudget]
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (!/simnet/i.test(process.env.KASPA_NETWORK || '')) { console.error('REFUSE: 仅 simnet'); process.exit(2); }
const network = process.env.KASPA_NETWORK;
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const relay = await imp('kasia-relay/src/lib/p2sh.mjs'); const { sqlite } = await imp('kasia-console/src/db/client.js');
const { readZkTemplateHashes } = await imp('kasia-console/src/lib/pool-shard-register.mjs');
const { enumerateRecovery, buildRetireCommand, buildSweepCommand } = await imp('kasia-console/src/lib/zk-recovery-enumerate.mjs');
const kind = process.argv[2], budgets = process.argv[3].split(',').map(Number), tokB = Number(process.argv[4] || 100);
const rc = async (cmd) => { try {
  if (cmd.type === 'get_address_utxos') return await relay.recoveryGetFacts(cmd.address, network);
  if (cmd.type === 'zk_claim_retire') return { ok: true, ...(await relay.unlockClaimRetire({ cmd, networkId: network })) };
  if (cmd.type === 'zk_ticket_sweep') return { ok: true, ...(await relay.unlockTicketSweep({ cmd, networkId: network })) };
} catch (e) { return { ok: false, error: e.message }; } };
const res = await enumerateRecovery({ db: sqlite, rc, p2sh: (h) => relay._addressFromRedeem(h, network), tmpl: readZkTemplateHashes(), env: process.env, marginDaa: 50, onlyMarkets: process.env.ONLY ? [process.env.ONLY] : null });
const it = kind === 'claim' ? res.retirable[0] : res.sweepable[0];
if (!it) { console.log('无可用项'); process.exit(1); }
for (const b of budgets) {
  const cmd = kind === 'claim' ? { ...buildRetireCommand(it), compute_budget_claim: b, compute_budget_token: tokB, fee_sompi: 5_000_000 } : { ...buildSweepCommand(it), compute_budget: b, fee_sompi: 1_500_000 };
  const r = await rc(cmd);
  console.log(`BUDGET ${b}${kind === 'claim' ? '/tok ' + tokB : ''}: ${r.ok ? 'SUCCESS txid=' + r.txId : 'REJECT ' + String(r.error).replace(/\s+/g, ' ').slice(0, 260)}`);
  if (r.ok) break;
}
process.exit(0);
