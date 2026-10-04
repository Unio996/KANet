// seg4_gate_zkclose.mjs — 门②(gateZkClose, zk_close 彩排)现行验收: 用段3 已出证的真实 market(proving ready + done job)现跑一遍 ⇒ 期望 pass;
//   再把 guestPayoutRoot 翻一位 ⇒ 期望 fail。(修的是: ctor 25→28 参、zk_close args 补 tok 见证、默认 debugger 改 pin 版、以及我在段3 提交里误把两个参数注释掉的缩进回归)
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const gate = await imp('lib/rehearsal-pre-broadcast-gate.mjs');
const { readPayoutShardV2AttestedState } = await imp('lib/bshard-close-enforce.mjs');
const kaspaZk = createRequire(import.meta.url)(process.env.ZKSDK_WASM_PATH || 'D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js');
const mid = JSON.parse(readFileSync(process.env.MARKET_JSON || 'D:/kanet-tn12/scratch/_j2_tok_sim/market_seg3_run1.json', 'utf8')).market_id;
const ps = db.prepare('select payout_redeem_hex from payout_shards where logical_market_id = ?').get(mid);
const st = readPayoutShardV2AttestedState(ps.payout_redeem_hex);
const beforeState = { gateTmplHash: process.env.ZK_GATE_TMPL_HASH, betsRootBaked: st.betsRootHex, refundRootBaked: st.refundRootHex, attestedAtMs: st.attestedAtMs, attestedWinner: st.attestedWinner, closed: 1, payoutRootHex: '00'.repeat(32), consolidatedPool: st.consolidatedPool };
const mk = (flip) => ({ getMarket: (m) => { const r = db.prepare('select metadata from pool_markets where id = ?').get(m); if (!flip) return r; const meta = JSON.parse(r.metadata); const g = meta.zk_continuation.proving.guestPayoutRootHex; meta.zk_continuation.proving.guestPayoutRootHex = g.slice(0, -2) + (g.slice(-2) === 'ff' ? '00' : 'ff'); return { metadata: JSON.stringify(meta) }; },
  getDoneJob: (m) => db.prepare("select receipt_hex from zk_prove_jobs where market_id = ? and status = 'done' order by id desc limit 1").get(m), kaspaZk: () => kaspaZk });
// 注: market 的 zk_continuation 已被 zk_close 推进(redeem 变 closed=2); gateZkClose 只用 proving 字段 + beforeState(来自 PS 状态), 与链上当时的 closed=1 genesis 一致
const g1 = gate.gateZkClose(mid, mk(false), beforeState, { gateUtxoValueSompi: 100000000 });
const g2 = gate.gateZkClose(mid, mk(true), beforeState, { gateUtxoValueSompi: 100000000 });
console.log('GATE zk_close honest:', g1.gate, g1.error ?? '', '| tampered guestPayoutRoot:', g2.gate, g2.error ?? '');
writeFileSync('seg4_gate_zkclose.json', JSON.stringify({ honest: { gate: g1.gate, error: g1.error, out: g1.debugger?.stdout?.slice(-300) }, tampered: { gate: g2.gate, error: g2.error, out: g2.debugger?.stdout?.slice(-500) } }, null, 1));
process.exit(0);
