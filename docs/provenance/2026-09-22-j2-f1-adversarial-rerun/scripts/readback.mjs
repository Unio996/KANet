// readback.mjs — 只读: 对【库快照拷贝】读 F/D/H/A 臂关键行, 并向 simnet 节点回读 F1 prepared_txid 与 D refund_flip 新输出(节点侧证据)。
// 用法: node readback.mjs <db 拷贝路径>   (只 readonly 打开; 不读写打开证据原件)
import { createRequire } from 'node:module';
const DB = process.argv[2]; if (!DB) { console.error('need db copy path'); process.exit(2); }
const WT = 'D:/kanet-tn12/scratch/_j2_wt_e2e';
const Database = createRequire(`${WT}/kasia-console/`)('better-sqlite3');
const kaspa = createRequire(`${WT}/kasia-relay/`)('kaspa-wasm'); const { RpcClient, Encoding, Address } = kaspa;
const db = new Database(DB, { readonly: true, fileMustExist: true });
const arms = { H: '376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d', D: '41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9', F: 'd7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a', A: 'ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d' };
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);
for (const [arm, id] of Object.entries(arms)) {
  const m = db.prepare('SELECT id, status, winning_side, winning_side_source, settlement_frozen_at, frozen_reason, deadline_ms, outcome_end_ms FROM proto_markets WHERE id = ?').get(id);
  console.log(`\n=== ${arm} market ${id.slice(0, 8)} ===`); console.log(JSON.stringify({ ...m, settlement_frozen_at_iso: iso(m.settlement_frozen_at), deadline_iso: iso(m.deadline_ms) }));
  const its = db.prepare("SELECT intent_key, step, status, prepared_txid, submitted_txid, last_error, created_at, updated_at FROM proto_settlement_intents WHERE subject_id = ? OR subject_id IN (SELECT id FROM proto_claims WHERE market_id = ?) ORDER BY created_at, rowid").all(id, id);
  its.forEach((r) => console.log('intent ' + JSON.stringify(r)));
  db.prepare('SELECT id, source_kind, outcome, pmt_at FROM proto_market_verdicts WHERE market_id = ? ORDER BY id').all(id).forEach((v) => console.log('verdict ' + JSON.stringify(v)));
}
// 节点侧回读
const state = JSON.parse((await import('node:fs')).readFileSync('D:/kanet-tn12/scratch/_j2_f1adv_run/state.json', 'utf8'));
const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({});
const si = await rpc.getServerInfo(); if (si.networkId !== 'simnet') { console.error('REFUSE not simnet'); process.exit(3); }
console.log('\n=== node ==='); const dag = await rpc.getBlockDagInfo(); console.log(JSON.stringify({ networkId: si.networkId, isSynced: si.isSynced, pmtMs: Number(dag.pastMedianTime), daa: String(dag.virtualDaaScore) }));
const spkToAddr = (hex) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, String(hex).replace(/^0x/i, '').toLowerCase()), 'simnet').toString();
const checkTx = async (label, txid, tx) => {
  const outs = (tx ? tx.outputs : []).map((o) => ({ value: String(o.value), spk: String(o.scriptPublicKey.script ?? o.scriptPublicKey) }));
  const found = [];
  for (const o of outs) { try { const es = (await rpc.getUtxosByAddresses([new Address(spkToAddr(o.spk))])).entries || []; es.filter((e) => String(e.outpoint.transactionId) === txid).forEach((e) => found.push({ idx: Number(e.outpoint.index), amount: String(e.amount), daa: String(e.blockDaaScore) })); } catch (e) { found.push({ err: String(e.message || e).slice(0, 80) }); } }
  const inMem = await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false }).then(() => true).catch(() => false);
  console.log(`${label} ${txid} inMempool=${inMem} unspentOutputsFoundOnNode=${JSON.stringify(found)}`);
};
const f = db.prepare("SELECT prepared_txid, prepared_tx_json FROM proto_settlement_intents WHERE intent_key = ?").get(`settle:market:${arms.F}:resolve`);
if (f?.prepared_tx_json) { const tx = kaspa.Transaction.deserializeFromSafeJSON(JSON.parse(f.prepared_tx_json)[0]); await checkTx('F1 resolve prepared_txid', f.prepared_txid, tx); } else console.log('F1 prepared_tx_json 已被清空(landed 后清理)——以 actions.jsonl 的 seed_prepared_close_observed 原始行为准');
await rpc.disconnect().catch(() => {}); process.exitCode = 0; setTimeout(() => process.exit(0), 200);
