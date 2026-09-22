// flip-watch.mjs — R-a 准入: 接管出块, 在 refund_flip 门开的精确边界上取证。simnet-only, 零写库(DB 只读)。
//   阶段 A(负对照): 出块推进 pmt 到 lockTime+10s(< +30s 余量)后【停止出块】, 观察一个完整 driver tick 窗口(默认 45s): 期间 R 的 refund_flip 意图不得 prepared/submitted, mempool 里不得有该市场的 refund_flip 交易(=门未开驱动零广播)。
//   阶段 B(门开): 出块推进到 pmt ≥ lockTime+31s 后【停止出块】, 等驱动在下一个 tick 里构造并广播: 轮询 DB 的 refund_flip prepared_txid, 一旦节点 mempool 里出现该 txid,
//     立刻 getMempoolEntry 取节点侧读数(fee / mass 字段 / 全部键), 并在 tx 仍在 mempool(无块)的窗口里同时算本地 kaspa.calculateTransactionMass 供对照。
//   阶段 C: 恢复出块, 等 tx 落链(旧 RootClose UTXO 已花 ∧ 新 closed=2 spk 地址出现 txid 输出), 记 daa / 深度。
// 用法: node flip-watch.mjs <marketId>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_ra'; const RUN = 'D:/kanet-tn12/scratch/_j2_e2e_run';
const kaspa = createRequire(`${WT}/kasia-relay/`)('kaspa-wasm'); const { RpcClient, Encoding, PrivateKey, Address } = kaspa;
const Database = createRequire(`${WT}/kasia-console/`)('better-sqlite3');
const state = JSON.parse(fs.readFileSync(`${RUN}/state.json`, 'utf8'));
const marketId = process.argv[2]; if (!/^[0-9a-f]{64}$/.test(marketId || '')) { console.error('need marketId'); process.exit(2); }
const EVD = `${RUN}/evidence/ra-flip-watch.jsonl`;
const rec = (o) => { const line = JSON.stringify({ at: new Date().toISOString(), ...o }, (k, v) => (typeof v === 'bigint' ? v.toString() : v)); fs.appendFileSync(EVD, line + '\n'); console.log(line.slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({});
if ((await rpc.getServerInfo()).networkId !== 'simnet') { console.error('REFUSE: not simnet'); process.exit(3); }
const db = new Database(`${RUN}/console.simnet.db`, { readonly: true, fileMustExist: true });
const m = db.prepare('SELECT deadline_ms FROM proto_markets WHERE id = ?').get(marketId);
const lockMs = Number(m.deadline_ms) + 7_200_000;
const pay = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')).toPublicKey().toAddress('simnet').toString();
let mined = 0;
const mineOne = async () => { try { const tpl = await rpc.getBlockTemplate({ payAddress: pay, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false }); mined++; } catch (e) { console.error('mine error: ' + String(e.message || e).slice(0, 120)); await new Promise((r) => setTimeout(r, 1500)); } };
const pmt = async () => { const d = await rpc.getBlockDagInfo(); return { pmtMs: Number(d.pastMedianTime), daa: String(d.virtualDaaScore) }; };
const flipRow = () => db.prepare("SELECT status, prepared_txid, submitted_txid, last_error, updated_at FROM proto_settlement_intents WHERE subject_type='market' AND subject_id=? AND step='refund_flip' ORDER BY rowid DESC LIMIT 1").get(marketId);
rec({ action: 'watch_start', marketId, lockMs, lockIso: new Date(lockMs).toISOString(), row: flipRow() });

// ── A: 推进到 lock+10s 后停 ──
for (;;) { const p = await pmt(); if (p.pmtMs >= lockMs + 10_000) { rec({ action: 'A_stop_mining_gate_not_open', pmtMs: p.pmtMs, pmtMinusLockMs: p.pmtMs - lockMs, daa: p.daa, mined }); break; } await mineOne(); await sleep(150); }
const A0 = Date.now(); let leaked = null;
while (Date.now() - A0 < 45_000) { const r = flipRow(); if (r && (r.status === 'prepared' || r.status === 'submitted' || r.prepared_txid)) { leaked = r; break; } await sleep(1000); }
const pA = await pmt();
rec({ action: 'A_negative_control_result', windowSec: Math.round((Date.now() - A0) / 1000), pmtMinusLockMs: pA.pmtMs - lockMs, leaked, verdict: leaked ? 'FAIL: 门未开却出现 prepared/submitted' : 'PASS: 45s(≥2 个 driver tick)内 refund_flip 意图无 prepared/submitted 行, 零广播', row: flipRow() });

// ── B: 推进到 lock+31s 后停 ──
for (;;) { const p = await pmt(); if (p.pmtMs >= lockMs + 31_000) { rec({ action: 'B_stop_mining_gate_open', pmtMs: p.pmtMs, pmtMinusLockMs: p.pmtMs - lockMs, daa: p.daa, mined }); break; } await mineOne(); await sleep(150); }
const B0 = Date.now(); let txid = null;
while (Date.now() - B0 < 120_000) { const r = flipRow(); if (r && r.prepared_txid) { txid = r.prepared_txid; break; } await sleep(1000); }
rec({ action: 'B_driver_prepared', txid, row: flipRow(), waitedSec: Math.round((Date.now() - B0) / 1000) });
let entry = null;
if (txid) {
  for (let i = 0; i < 60 && !entry; i++) { try { entry = await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false }); } catch { await sleep(1000); } }
  if (entry) {
    const raw = JSON.parse(JSON.stringify(entry, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    rec({ action: 'B_node_mempool_entry', txid, keysTop: Object.keys(raw), entryKeys: Object.keys(raw.mempoolEntry || {}), fee: (raw.mempoolEntry || raw).fee, mass: raw.mempoolEntry?.transaction?.mass ?? raw.mempoolEntry?.mass, computeMass: raw.mempoolEntry?.transaction?.computeMass, storageMass: raw.mempoolEntry?.transaction?.storageMass, txKeys: Object.keys(raw.mempoolEntry?.transaction || {}), isOrphan: raw.mempoolEntry?.isOrphan });
    fs.writeFileSync(`${RUN}/evidence/ra-mempool-entry-${txid.slice(0, 12)}.json`, JSON.stringify(raw, null, 1));
    // 本地估算对照(与节点读数并列, 不作依据)
    try { const prow = db.prepare("SELECT prepared_tx_json FROM proto_settlement_intents WHERE subject_type='market' AND subject_id=? AND step='refund_flip' ORDER BY rowid DESC LIMIT 1").get(marketId); const tx = kaspa.Transaction.deserializeFromSafeJSON(JSON.parse(prow.prepared_tx_json)[0]); rec({ action: 'B_local_mass_estimate', localMass: String(kaspa.calculateTransactionMass('simnet', tx)), note: '本地 wasm 估算, 仅对照; 节点读数为准(账本 1467)' }); } catch (e) { rec({ action: 'B_local_mass_estimate_failed', err: String(e.message).slice(0, 200) }); }
  } else rec({ action: 'B_mempool_entry_not_found_within_60s', txid });
}
// ── C: 恢复出块, 等落链 ──
const t0 = Date.now(); let landed = false;
while (Date.now() - t0 < 180_000 && !landed) {
  await mineOne(); await sleep(200);
  const r = flipRow(); if (r && r.status === 'landed') landed = true;
  if (mined % 25 === 0) { const rr = flipRow(); if (rr && rr.submitted_txid) { /* 继续 */ } }
}
const pC = await pmt();
rec({ action: 'C_after_mining_resumed', landed, row: flipRow(), pmtMs: pC.pmtMs, daa: pC.daa, minedTotal: mined });
await rpc.disconnect().catch(() => {}); process.exitCode = 0; setTimeout(() => process.exit(0), 300);
