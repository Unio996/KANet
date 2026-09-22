// pc-scenario.mjs — F1 对抗重跑(1621③)正对照: resolve 在未冻结时【合法落地】(真 driver, 真广播, 真节点确认),
// 落地之后再冻结市场 —— 核对账不搁置(intent 仍 landed, 不被 F1 闸误挡)。
// 复用: sim-actions.mjs freeze / harness-lib(经 sim-actions create 已用)、proto-settlement-intent 真读。
// 用法: node pc-scenario.mjs watch   (轮询到 resolve intent landed 为止, 然后冻结, 再读回两次确认无回退)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RUN = 'D:/kanet-tn12/scratch/_j2_f1adv_run';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_e2e';
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_j2_f1adv_run')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
const EVD = `${RUN}/evidence`; fs.mkdirSync(EVD, { recursive: true });
const arms = JSON.parse(fs.readFileSync(`${RUN}/arms.json`, 'utf8'));
const marketId = arms.PC;
if (!marketId) { console.error('arms.json 里没有 PC'); process.exit(2); }
const rec = (o) => fs.appendFileSync(`${EVD}/actions.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const lib = (rel) => import(pathToFileURL(`${WT}/kasia-console/src/${rel}`).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { sqlite } = await lib('db/client.js');
const { freezeMarket, isMarketFrozen } = await lib('lib/proto-settlement-freeze.mjs');
const key = `settle:market:${marketId}:resolve`;
const getIntent = () => sqlite.prepare('SELECT intent_key, status, prepared_txid, submitted_txid, last_error FROM proto_settlement_intents WHERE intent_key = ?').get(key);
const getMarket = () => sqlite.prepare('SELECT id, status, winning_side, settlement_frozen_at, frozen_reason FROM proto_markets WHERE id = ?').get(marketId);

console.log('PC market', marketId, 'watching resolve intent for landed (natural, unfrozen)…');
const t0 = Date.now();
let it = getIntent();
while ((!it || it.status !== 'landed') && Date.now() - t0 < 20 * 60_000) {
  it = getIntent();
  const m = getMarket();
  if (m.settlement_frozen_at) throw new Error('PC 意外被冻结(不该发生, 检查是否与别的臂共享了操作)');
  process.stdout.write(`\r  t+${Math.round((Date.now() - t0) / 1000)}s market.status=${m.status} ws=${m.winning_side} intent.status=${it ? it.status : 'none'}   `);
  await sleep(5000);
}
console.log('');
if (!it || it.status !== 'landed') throw new Error(`超时(20min): resolve intent 未 landed, 实际 ${JSON.stringify(it)}`);
const landedIntent = it; const landedMarket = getMarket();
rec({ action: 'pc_resolve_landed_before_freeze', marketId, intent: landedIntent, market: landedMarket });
console.log('✅ resolve landed BEFORE freeze:', JSON.stringify(landedIntent));

// 现在冻结(落地之后)
const r = freezeMarket({ db: sqlite, marketId, reason: 'operator_emergency_stop', pmt: null, wallMs: Date.now(), log: console });
const afterFreeze = getMarket();
rec({ action: 'pc_freeze_after_landed', marketId, freezeChanges: r.changes, market: afterFreeze });
console.log('froze market after landed:', JSON.stringify(afterFreeze));

// 两次读回(间隔 15s, 跨至少一次真 driver tick=20s), 确认 intent 状态不回退、无 last_error 新增
const read1 = getIntent();
await sleep(25_000);
const read2 = getIntent();
rec({ action: 'pc_readback_after_freeze', marketId, read1, read2, isFrozen: isMarketFrozen(sqlite, marketId) });
console.log(JSON.stringify({ read1, read2, isFrozen: isMarketFrozen(sqlite, marketId) }, null, 1));

const ok = read1.status === 'landed' && read2.status === 'landed' && read1.submitted_txid === landedIntent.submitted_txid && read2.submitted_txid === landedIntent.submitted_txid && !read2.last_error;
console.log(ok ? '\n✅✅ 正对照通过: resolve 冻结前合法落地, 冻结后状态不回退/不被搁置(last_error 为空)' : '\n❌ 正对照未通过, 见上方读回');
process.exitCode = ok ? 0 : 1;
